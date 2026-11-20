import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { offerLetterHtml } from '../../shared/offer.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-logo-'));
process.env.DATA_DIR = dataDir;
process.env.APP_PASSWORD = '';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

/** A real 1x1 PNG, so multer and the sniffing see an actual picture. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function putLogo(companyId, { bytes = PNG, name = 'logo.png', type = 'image/png' } = {}) {
  const form = new FormData();
  form.append('logo', new Blob([bytes], { type }), name);
  const res = await fetch(`${base}/api/companies/${companyId}/logo`, { method: 'POST', body: form });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

let bnf;
let scale;
test.before(async () => {
  bnf = (await api('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  scale = (await api('POST', '/api/companies', { name: 'SCALE VISORY' })).body;
});

/* ---------------- the picture itself ---------------- */

test('a logo is stored against ONE company, and the other keeps none', async () => {
  assert.equal((await putLogo(bnf.id)).status, 200);
  const { companies } = (await api('GET', '/api/companies')).body;
  const byName = Object.fromEntries(companies.map((c) => [c.name, c]));
  assert.equal(byName.BOOKNFLY.has_logo, true);
  assert.equal(byName['SCALE VISORY'].has_logo, false);
});

test('the file path NEVER travels - the browser is told only that there is one', async () => {
  /*
   * The rule the employee photographs and the candidate CVs already follow.
   * A path is the server's business, and one in a payload is how a file ends
   * up fetched by name.
   */
  const { companies } = (await api('GET', '/api/companies')).body;
  for (const company of companies) {
    assert.ok(!('logo_path' in company), 'logo_path must not be in a companies payload');
    assert.equal(typeof company.has_logo, 'boolean');
  }
  const patched = (await api('PATCH', `/api/companies/${bnf.id}`, { sort_order: 1 })).body;
  assert.ok(!('logo_path' in patched));
});

test('a patch cannot point a company at a file', async () => {
  /*
   * Setting it by name would let a caller aim a company at anything on the
   * disk. It is set by uploading a picture, and no other way.
   */
  await api('PATCH', `/api/companies/${bnf.id}`, { logo_path: '../../etc/passwd' });
  const letter = await fetch(`${base}/api/companies/${bnf.id}/logo`);
  assert.equal(letter.status, 200);
  assert.match(letter.headers.get('content-type') || '', /image\/png/);
});

test('an SVG is refused, because it can carry script into a letter', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const out = await putLogo(scale.id, { bytes: svg, name: 'logo.svg', type: 'image/svg+xml' });
  assert.equal(out.status, 400);
  assert.match(out.body.error, /SVG/);
  // And nothing was stored: the company still has no logo.
  const { companies } = (await api('GET', '/api/companies')).body;
  assert.equal(companies.find((c) => c.id === scale.id).has_logo, false);
});

test('removing a logo leaves the company, not a broken picture', async () => {
  const id = (await api('POST', '/api/companies', { name: 'BNF VENTURE' })).body.id;
  await putLogo(id);
  assert.equal((await api('DELETE', `/api/companies/${id}/logo`)).body.has_logo, false);
  assert.equal((await fetch(`${base}/api/companies/${id}/logo`)).status, 404);
  // The company is still there.
  const { companies } = (await api('GET', '/api/companies')).body;
  assert.ok(companies.some((c) => c.id === id));
});

/* ---------------- on the letter ---------------- */

async function offerFor(companyId, name) {
  const v = (await api('POST', '/api/hiring/vacancies', {
    company_id: companyId, title: 'Travel Consultant', status: 'published',
  })).body;
  const c = (await api('POST', '/api/hiring/candidates', {
    name, phone: String(9300000000 + Math.floor(Math.random() * 99999999)),
  })).body;
  const { application } = (await api('POST', '/api/hiring/applications', {
    vacancy_id: v.id ?? v.vacancy?.id, candidate_id: c.id ?? c.candidate?.id,
  })).body;
  await api('PUT', `/api/hiring/applications/${application.id}/offer`, {
    salary: '24000', designation: 'Travel Consultant',
    joining_date: '2099-02-01', valid_till: '2099-01-01',
  });
  await api('POST', `/api/hiring/applications/${application.id}/offer/move`, { to: 'approved' });
  const res = await fetch(`${base}/api/hiring/applications/${application.id}/offer/letter`);
  return { application, html: await res.text() };
}

test('the letter carries the logo of ITS OWN company, inlined', async () => {
  /*
   * These are separate businesses. An offer from BOOKNFLY must not go out
   * under another company's mark, so the letter looks the logo up from the
   * opening's company and not from a setting somewhere.
   */
  const { html } = await offerFor(bnf.id, 'Rohit Patel');
  assert.match(html, /<img src="data:image\/png;base64,/);

  // SCALE VISORY has none: its letter has no picture at all, and is not broken.
  const other = await offerFor(scale.id, 'Neha Joshi');
  assert.ok(!other.html.includes('<img'), 'a company with no logo must not get a broken image');
  assert.match(other.html, /SCALE VISORY/);
});

test('the letter still loads NOTHING from the internet', async () => {
  /*
   * It is opened on a phone with no signal as often as not, and a letter that
   * phones home tells us every time a candidate shows it to somebody. The
   * logo travels inside the file or not at all.
   */
  const { html } = await offerFor(bnf.id, 'Imran Shaikh');
  assert.ok(!/src="http/.test(html));
  assert.ok(!/href="http/.test(html));
  assert.ok(!/<link /.test(html));
});

test('the offer screen is told whether there is a logo - never the picture', async () => {
  const { application } = await offerFor(bnf.id, 'Farida Ansari');
  const got = (await api('GET', `/api/hiring/applications/${application.id}/offer`)).body;
  assert.equal(got.has_logo, true);
  assert.ok(!JSON.stringify(got).includes('base64'), 'the panel must not carry the picture');
});

/* ---------------- what the shared letter will accept ---------------- */

test('only a data: image is written into the letter', () => {
  const offer = { candidate_name: 'Rohit', company_name: 'BOOKNFLY', designation: 'Clerk' };

  const good = offerLetterHtml(offer, { logo: 'data:image/png;base64,iVBORw0KGgo=' });
  assert.match(good, /<img src="data:image\/png;base64,iVBORw0KGgo="/);

  /*
   * A src is the one place in this document a URL somebody else chose could
   * reach back out of it - the letter is handed to strangers and forwarded.
   */
  for (const bad of [
    'https://example.com/logo.png',
    'data:text/html;base64,PHNjcmlwdD4=',
    'javascript:alert(1)',
    'data:image/png;base64,abc" onerror="alert(1)',
  ]) {
    const html = offerLetterHtml(offer, { logo: bad });
    assert.ok(!html.includes('<img'), `a logo of "${bad}" must be ignored`);
  }

  // And with none at all the letter is unchanged from what it always was.
  assert.ok(!offerLetterHtml(offer).includes('<img'));
});

/* ---------------- on the payslip ---------------- */

test('the payslip forwarded on WhatsApp carries the logo inside it', async () => {
  const { payslipHtml } = await import('../../shared/payslipPage.js');
  const row = {
    employee_name: 'Amit Shah', company_name: 'BOOKNFLY', salary: 24000,
    net_salary: 23800, per_day: 923, present_days: 26, working_days: 26,
  };
  const period = { label: 'October 2026', year: 2026, month: 10 };

  const withLogo = payslipHtml({
    employee: { name: 'Amit Shah', company_name: 'BOOKNFLY' },
    period, row, logo: 'data:image/png;base64,iVBORw0KGgo=',
  });
  assert.match(withLogo, /<img class="logo" src="data:image\/png;base64,iVBORw0KGgo="/);
  // And it is still one self-contained file that fetches nothing.
  assert.ok(!/src="http/.test(withLogo));

  // No logo: the name in type, exactly as the slip always looked.
  const plain = payslipHtml({ employee: { name: 'Amit Shah' }, period, row });
  assert.ok(!plain.includes('<img'));

  // The same gate as the letter - a URL is ignored, never written out.
  const url = payslipHtml({
    employee: { name: 'Amit Shah' }, period, row, logo: 'https://example.com/logo.png',
  });
  assert.ok(!url.includes('<img'));
});

test('a staff login gets its OWN company logo, and no list of the others', async () => {
  /*
   * The slip an employee prints should carry the same letterhead as the
   * office's copy - but /companies/logos needs `read`, which a staff login
   * does not have and must not be given. /me/logos answers for the one
   * company they work for, with the employee id taken off the login.
   */
  const me = await import('../src/routes/me.js');
  assert.ok(me.meRouter, 'the staff router exists');
  const file = fs.readFileSync(new URL('../src/routes/me.js', import.meta.url), 'utf8');
  assert.match(file, /meRouter\.get\('\/logos'/);
  // One company - their own, read from the employee the LOGIN names.
  assert.match(file, /getEmployee\(req\.employeeId\)/);
  assert.match(file, /logoDataUri\(employee\.company_id\)/);
});

test('the logos route hands over the pictures, and only for companies that have one', async () => {
  const { logos } = (await api('GET', '/api/companies/logos')).body;
  assert.ok(Array.isArray(logos));
  for (const row of logos) {
    assert.match(row.logo, /^data:image\/[a-z]+;base64,/);
    assert.ok(row.id && row.name);
  }
  // BOOKNFLY has one from the first test; SCALE VISORY never got one.
  assert.ok(logos.some((l) => l.name === 'BOOKNFLY'));
  assert.ok(!logos.some((l) => l.name === 'SCALE VISORY'));
});
