import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-left-'));
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

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = new Date();
const daysAway = (n) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + n);
  return iso(d);
};

let company;
let period;
test.before(async () => {
  company = (await api('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  period = (await api('POST', '/api/periods', {
    year: TODAY.getFullYear(), month: TODAY.getMonth() + 1, label: 'This month',
  })).body;
});

const hire = async (name, salary = 20000) =>
  (await api('POST', '/api/employees', { company_id: company.id, name, monthly_salary: salary })).body;

/* ---------------- the bug he reported ---------------- */

test('a last working day that has PASSED takes them off the list', async () => {
  /*
   * "exited employee abhi bhi dikha rahe he current list me". Typing the
   * date used to record the date and nothing else, so the person stayed on
   * the payroll and in every picker until somebody also remembered to untick
   * Active. Two switches for one fact.
   */
  const person = await hire('Mahesh Shinde');
  assert.equal(person.active, 1);

  const after = (await api('PATCH', `/api/employees/${person.id}`, { left_on: daysAway(-3) })).body;
  assert.equal(after.active, 0, 'a date in the past means they have left');

  const live = (await api('GET', '/api/employees?active=true')).body.employees;
  assert.ok(!live.some((e) => e.id === person.id));
});

test('a last working day STILL TO COME leaves them working', async () => {
  /*
   * Somebody serving a month's notice is still here, still paid, and must
   * stay on this month's sheet. The date is recorded; nothing else changes.
   */
  const person = await hire('Riya Pal');
  const after = (await api('PATCH', `/api/employees/${person.id}`, { left_on: daysAway(20) })).body;
  assert.equal(after.active, 1);
  assert.equal(after.left_on, daysAway(20));
});

test('putting somebody back on is still one tick', async () => {
  const person = await hire('Imran Shaikh');
  await api('PATCH', `/api/employees/${person.id}`, { left_on: daysAway(-10) });
  // `active` sent in the same patch always wins over the date rule.
  const back = (await api('PATCH', `/api/employees/${person.id}`, { active: 1 })).body;
  assert.equal(back.active, 1);
});

/* ---------------- and the half that must NOT change ---------------- */

test('SOMEBODY WHO LEFT MID-MONTH KEEPS THIS MONTH’S ROW, marked or not', async () => {
  /*
   * An unmarked month pays a full month, so an untouched row is not an empty
   * row - it is this month's pay. Deleting it would quietly stop somebody
   * being paid for the days they worked before they left.
   */
  const person = await hire('Vaibhav Gupta', 26000);
  await api('GET', `/api/periods/${period.id}/payroll`);

  // Left earlier this month, nothing marked against them at all.
  const first = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}-01`;
  const leftOn = daysAway(-1) >= first ? daysAway(-1) : first;
  await api('PATCH', `/api/employees/${person.id}`, { left_on: leftOn });

  const { rows } = (await api('GET', `/api/periods/${period.id}/payroll`)).body;
  assert.ok(
    rows.some((r) => r.employee_id === person.id),
    'they worked part of this month and are owed it'
  );
});

test('somebody who was already gone before the month began is not on it', async () => {
  const person = await hire('Old Hand');
  // Gone last year: no row for a month they were never here for.
  await api('PATCH', `/api/employees/${person.id}`, { left_on: `${TODAY.getFullYear() - 1}-03-31` });
  const { rows } = (await api('GET', `/api/periods/${period.id}/payroll`)).body;
  assert.ok(!rows.some((r) => r.employee_id === person.id));
});

test('a leaver still has every record that was made against them', async () => {
  /*
   * The line this draws: they go from the lists you choose FROM, and stay in
   * every list of what already happened. A settlement is worked out from
   * exactly those - the asset never returned, the loan still outstanding.
   */
  const person = await hire('Kiran Joshi');
  await api('POST', '/api/loans', {
    employee_id: person.id, amount: 10000, instalments: 5, taken_on: daysAway(-40),
  });
  await api('PATCH', `/api/employees/${person.id}`, { left_on: daysAway(-2) });

  const { loans } = (await api('GET', '/api/loans')).body;
  assert.ok(loans.some((l) => l.employee_id === person.id), 'the debt does not vanish with them');

  // And they are still readable by id - the record is not deleted.
  assert.equal((await api('GET', `/api/employees/${person.id}`)).status, 200);
});

test('every "pick somebody" box offers only people who are still here', () => {
  /*
   * One rule in one file rather than nine filters that drift: a laptop
   * cannot be issued to somebody who left in August, nor a warning written
   * against them, nor a licence seat handed over.
   */
  const dir = new URL('../../frontend/src/components/', import.meta.url);
  const read = (rel) => fs.readFileSync(new URL(rel, dir), 'utf8');

  const helper = fs.readFileSync(new URL('../../frontend/src/onStaff.js', import.meta.url), 'utf8');
  assert.match(helper, /employees\.filter\(\(e\) => e\.active\)/);

  for (const file of [
    'people/Claims.jsx', 'people/Records.jsx', 'people/Tasks.jsx', 'people/Appraisals.jsx',
    'people/Penalties.jsx', 'people/Helpdesk.jsx', 'people/Assets.jsx', 'people/Licenses.jsx',
    'people/Leaving.jsx', 'WeeklyOff.jsx', 'Loans.jsx',
  ]) {
    const src = read(file);
    assert.match(src, /onStaff\(employees\)\.map/, `${file} still offers everybody`);
    assert.ok(
      !/\{employees\.map\(\(e\) => \(/.test(src),
      `${file} has a picker that was missed`
    );
  }
});
