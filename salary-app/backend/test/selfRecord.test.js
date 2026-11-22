import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  FILLABLE_NAMES,
  ONCE_ONLY,
  UPLOADABLE_KINDS,
  applySelf,
  canSet,
  mayUpload,
  selfForm,
  selfProgress,
} from '../../shared/selfRecord.js';
import { THEIRS_TO_FILL } from '../../shared/onboardingFlow.js';
import { ALL_FIELDS } from '../../shared/employeeMaster.js';

/* ================================================================= *
 * the rule, on its own
 * ================================================================= */

test('the fields are the joining form’s own, not a second list', () => {
  /*
   * The whole reason this module imports instead of listing: an employee
   * completing their record and a new joiner filling the same form must be
   * asked for the same things, or the two drift the first time a field is
   * added to one of them.
   */
  for (const field of FILLABLE_NAMES) {
    assert.ok(THEIRS_TO_FILL.includes(field), `${field} is not on the joining form`);
    assert.ok(ALL_FIELDS.some((f) => f.field === field), `${field} is not on the master`);
  }
  assert.ok(FILLABLE_NAMES.length > 30, 'the form asks for almost nothing');
});

test('nothing that moves money is on the list', () => {
  /*
   * A figure typed by the person it is paid to is the one thing this must
   * never accept. None of these is an input to calculateRow by being absent
   * from the list at all.
   */
  for (const never of [
    'monthly_salary', 'basic', 'hra', 'conveyance', 'medical', 'pf', 'esi',
    'joined_on', 'left_on', 'active', 'is_draft', 'code', 'company_id',
    'designation', 'department', 'cl_quota', 'sl_quota', 'pl_quota',
    'reports_to_id', 'payment_mode',
  ]) {
    assert.ok(!FILLABLE_NAMES.includes(never), `${never} is theirs to change, and must not be`);
    assert.equal(canSet(never, { current: '', next: '9' }).ok, false);
  }
});

test('a blank statutory number may be filled in; one already set may not be changed', () => {
  for (const field of ONCE_ONLY) {
    assert.equal(canSet(field, { current: '', next: 'ABCDE1234F' }).ok, true, `${field} blank`);
    assert.equal(canSet(field, { current: null, next: 'X' }).ok, true, `${field} null`);

    const no = canSet(field, { current: 'ALREADY', next: 'SOMETHING-ELSE' });
    assert.equal(no.ok, false, `${field} already set`);
    // The refusal says what to do about it, or the screen cannot.
    assert.match(no.why, /ask the office/);

    // Sending back the SAME value is not a change, so a form that saves on
    // blur does not refuse every box somebody tabs through.
    assert.equal(canSet(field, { current: 'ALREADY', next: 'ALREADY' }).ok, true);
    assert.equal(canSet(field, { current: 'ALREADY', next: ' ALREADY ' }).ok, true);
  }
});

test('their own facts stay theirs, set or not', () => {
  // Nobody in the office knows these better than they do, and a bank
  // account already wrote through from the portal before this release.
  for (const field of ['phone', 'email', 'bank_account', 'ifsc', 'address_line1', 'emergency_phone', 'dob']) {
    assert.equal(canSet(field, { current: 'something', next: 'something else' }).ok, true, field);
  }
});

test('applySelf names what it refused instead of dropping it', () => {
  const { patch, refused } = applySelf(
    { pan: 'ABCDE1234F', phone: '900' },
    { phone: '911', monthly_salary: 999999, pan: 'ZZZZZ9999Z', dob: '1990-01-01' }
  );
  assert.deepEqual(patch, { phone: '911', dob: '1990-01-01' });
  assert.deepEqual(refused.map((r) => r.field).sort(), ['monthly_salary', 'pan']);
  /*
   * Silently dropping is how somebody types a salary into a form, is told
   * "Saved", and believes it.
   */
  assert.ok(refused.every((r) => r.why && r.why.length > 10));
});

test('what is still wanted is what the office chases, not every box', () => {
  const nothing = selfProgress({});
  assert.equal(nothing.percent, 0);
  assert.ok(nothing.missing.includes('PAN'));
  assert.ok(nothing.missing.includes('UAN'));
  // Not these: a list opening with "Spouse's name" is a list nobody reads,
  // and the PF return does not ask for an alternate mobile.
  assert.ok(!nothing.missing.includes('Alternate mobile'));
  assert.ok(!nothing.missing.includes("Spouse's name"));

  const done = {};
  for (const field of FILLABLE_NAMES) done[field] = 'x';
  const all = selfProgress(done);
  assert.equal(all.percent, 100);
  assert.equal(all.done, true);
  assert.deepEqual(all.missing, []);
});

test('a permanent address nobody typed is not counted as missing', () => {
  const a = selfProgress({ name: 'A' });
  const b = selfProgress({ name: 'A', perm_line1: 'somewhere' });
  // Typing one brings the other four into the count, so the figure drops.
  assert.ok(b.want > a.want, 'the permanent lines should start out of the count');
});

test('the form travels as data, with every field labelled', () => {
  const sections = selfForm();
  assert.deepEqual(
    sections.map((s) => s.key),
    ['basic', 'address', 'emergency', 'statutory', 'bank']
  );
  const flat = sections.flatMap((s) => s.fields);
  assert.equal(flat.length, FILLABLE_NAMES.length, 'a field is on the list and on no section');
  assert.ok(flat.every((f) => f.label && f.kind), 'a box with no label is a box nobody can fill');
  // Pay is not on a page somebody fills in about themselves.
  assert.ok(!flat.some((f) => f.field === 'monthly_salary'));
});

test('the papers the office issues are not theirs to upload', () => {
  assert.equal(mayUpload('aadhaar'), true);
  assert.equal(mayUpload('pan'), true);
  assert.equal(mayUpload('photo'), true);
  // Issued BY the office - the one kind worth forging.
  assert.equal(mayUpload('offer_letter'), false);
  assert.equal(mayUpload('appointment'), false);
  assert.equal(mayUpload('whatever-they-typed'), false);
  assert.ok(UPLOADABLE_KINDS.length >= 6);
});

/* ================================================================= *
 * end to end, through the real server
 * ================================================================= */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'selfrec-'));
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
delete process.env.APP_PASSWORD;

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

function session() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    for (const c of res.headers.getSetCookie?.() || []) cookie = c.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, raw: text };
  };
  call.cookie = () => cookie;
  return call;
}

const admin = session();
const staff = session();
let amit;
let riya;
let periodId;

test('the scene: two people, a month, and a login for one of them', async () => {
  await admin('POST', '/api/auth/setup', {
    username: 'dinesh', name: 'Dinesh Parmar', password: 'a-long-enough-password',
  });
  const company = (await admin('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  amit = (await admin('POST', '/api/employees', {
    company_id: company.id, name: 'Amit Shah', monthly_salary: 26000,
    joined_on: '2024-04-01', designation: 'Ticketing', pan: 'ABCDE1234F',
  })).body;
  riya = (await admin('POST', '/api/employees', {
    company_id: company.id, name: 'Riya Pal', monthly_salary: 48000, joined_on: '2023-01-01',
  })).body;

  periodId = (await admin('POST', '/api/periods', { year: 2026, month: 10 })).body.id;
  await admin('GET', `/api/periods/${periodId}/payroll`);

  const list = (await admin('POST', '/api/auth/staff', { employee_ids: [amit.id] })).body.made[0];
  await admin('POST', `/api/auth/users/${list.user_id || ''}/password`, {}); // ignored if absent
  const mine = (await admin('GET', '/api/auth/staff')).body.staff.find((s) => s.employee_id === amit.id);
  await admin('POST', `/api/auth/users/${mine.user_id}/password`, { password: 'amits-own-long-password' });
  const inn = await staff('POST', '/api/auth/login', {
    username: mine.username, password: 'amits-own-long-password',
  });
  assert.equal(inn.status, 200);
  assert.deepEqual(inn.body.user.abilities, ['self']);
});

test('the form comes back with its own shape and what is still wanted', async () => {
  const got = await staff('GET', '/api/me/profile');
  assert.equal(got.status, 200);
  assert.equal(got.body.employee.id, amit.id);
  assert.equal(got.body.employee.name, 'Amit Shah');
  // The office's half, to read.
  assert.equal(got.body.employee.designation, 'Ticketing');
  assert.equal(got.body.employee.company_name, 'BOOKNFLY');
  // Pay is not on it at all.
  assert.ok(!('monthly_salary' in got.body.employee));
  assert.ok(got.body.sections.length === 5);
  assert.ok(got.body.progress.missing.includes('UAN'));
});

test('they fill in their own record, and it lands on the master', async () => {
  const saved = await staff('PATCH', '/api/me/profile', {
    dob: '1994-07-11',
    gender: 'Male',
    father_name: 'Suresh Shah',
    address_line1: '14 Alkapuri',
    city: 'Vadodara',
    uan: '100200300400',
    esic_no: '3100123456',
    bank_name: 'YES BANK',
    bank_account: '92991900011940',
    ifsc: 'YESB0000929',
    emergency_name: 'Meena Shah',
    emergency_phone: '9876500000',
    marital_status: 'Married',
    phone: '9327003358',
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.employee.uan, '100200300400');
  assert.deepEqual(saved.body.refused, []);

  // The office sees the same record.
  const office = (await admin('GET', `/api/employees/${amit.id}`)).body;
  assert.equal(office.uan, '100200300400');
  assert.equal(office.bank_account, '92991900011940');
  assert.equal(office.dob, '1994-07-11');

  // And it is on the change history, by name, because a bank account moving
  // the week before payday has to be something somebody can look back at.
  const record = (await admin('GET', `/api/employees/${amit.id}/record`)).body;
  const rows = record.history;
  const bank = rows.find((r) => r.field === 'bank_account');
  assert.ok(bank, 'the bank account change was not recorded');
  assert.match(String(bank.note || ''), /employee/i);
  assert.ok(rows.some((r) => r.field === 'uan'), 'the UAN was not recorded');
});

test('a statutory number already on the record is the office’s to correct', async () => {
  // The office typed Amit's PAN when he was hired.
  const no = await staff('PATCH', '/api/me/profile', { pan: 'ZZZZZ9999Z' });
  assert.equal(no.status, 400);
  assert.match(no.body.error, /ask the office/);

  const office = (await admin('GET', `/api/employees/${amit.id}`)).body;
  assert.equal(office.pan, 'ABCDE1234F', 'the PAN moved');

  // A blank one they supply themselves still goes in.
  const yes = await staff('PATCH', '/api/me/profile', { aadhaar: '123412341234' });
  assert.equal(yes.status, 200);
  assert.equal(yes.body.employee.aadhaar, '123412341234');
});

test('a salary sent on that form is refused by name, and nothing moves', async () => {
  const before = (await admin('GET', `/api/periods/${periodId}/payroll`)).body;
  const mineBefore = before.rows.find((r) => r.employee_id === amit.id);

  const tried = await staff('PATCH', '/api/me/profile', {
    monthly_salary: 999999,
    basic: 999999,
    joined_on: '2020-01-01',
    active: 0,
    company_id: 99,
    /* one real field, so the patch is not empty and the refusals are the
       interesting half rather than the whole of it */
    blood_group: 'B+',
  });
  assert.equal(tried.status, 200);
  assert.equal(tried.body.employee.blood_group, 'B+');
  assert.deepEqual(
    tried.body.refused.map((r) => r.field).sort(),
    ['active', 'basic', 'company_id', 'joined_on', 'monthly_salary']
  );

  const office = (await admin('GET', `/api/employees/${amit.id}`)).body;
  assert.equal(Number(office.monthly_salary), 26000);
  assert.equal(office.joined_on, '2024-04-01');
  assert.equal(Number(office.active), 1);

  const after = (await admin('GET', `/api/periods/${periodId}/payroll`)).body;
  const mineAfter = after.rows.find((r) => r.employee_id === amit.id);
  // THE CLAIM THE WHOLE THING RESTS ON: filling in your own record cannot
  // move a rupee. Not one field on the list is an input to calculateRow.
  assert.equal(mineAfter.gross_salary, mineBefore.gross_salary);
  assert.equal(mineAfter.net_salary, mineBefore.net_salary);
  assert.equal(mineAfter.final_payable, mineBefore.final_payable);
  assert.equal(after.totals.net_salary, before.totals.net_salary);
});

/* ---------------- their own papers ---------------- */

const upload = async (kind, name, text) => {
  const form = new FormData();
  form.set('document', new Blob([text || 'a scan'], { type: 'application/pdf' }), name);
  form.set('kind', kind);
  const res = await fetch(`${base}/api/me/documents`, {
    method: 'POST',
    headers: { cookie: staff.cookie() },
    body: form,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

let docId;

test('they send in their own Aadhaar, and it lands UNCHECKED', async () => {
  const sent = await upload('aadhaar', 'aadhaar.pdf');
  assert.equal(sent.status, 201);
  docId = sent.body.document.id;
  assert.equal(sent.body.document.kind, 'aadhaar');
  // The path never leaves the server.
  assert.equal(sent.body.document.file_path, undefined);

  // Not checked is a third state, and it is NOT rejected: somebody in the
  // office still has to open the card and say it is the right one.
  const rows = (await admin('GET', `/api/employees/${amit.id}/record`)).body.documents;
  const mine = rows.find((d) => d.id === docId);
  assert.ok(mine, 'the office cannot see what the employee sent in');
  assert.equal(mine.verified === null || mine.verified === undefined, true);
  assert.equal(mine.file_path, undefined);
});

test('an offer letter is not theirs to upload', async () => {
  const no = await upload('offer_letter', 'offer.pdf');
  assert.equal(no.status, 400);
  assert.match(no.body.error, /issued by the office/);
});

test('they can read back their own, and nobody else’s', async () => {
  const mine = await fetch(`${base}/api/me/documents/${docId}/file`, {
    headers: { cookie: staff.cookie() },
  });
  assert.equal(mine.status, 200);

  // Riya's document, asked for on Amit's login.
  const hers = new FormData();
  hers.set('document', new Blob(['hers'], { type: 'application/pdf' }), 'pan.pdf');
  hers.set('kind', 'pan');
  const put = await fetch(`${base}/api/employees/${riya.id}/documents`, {
    method: 'POST', headers: { cookie: admin.cookie() }, body: hers,
  });
  const herDoc = (await put.json()).document;

  const peek = await fetch(`${base}/api/me/documents/${herDoc.id}/file`, {
    headers: { cookie: staff.cookie() },
  });
  /*
   * 404 and not 403: this route has no business confirming that somebody
   * else's document exists.
   */
  assert.equal(peek.status, 404);

  const del = await staff('DELETE', `/api/me/documents/${herDoc.id}`);
  assert.equal(del.status, 404);
});

test('they may take back one nobody has looked at, and not one that is checked', async () => {
  const office = session();
  await office('POST', '/api/auth/login', { username: 'dinesh', password: 'a-long-enough-password' });
  const checked = await office('POST', `/api/employees/${amit.id}/documents/${docId}/verify`, {
    verified: true,
  });
  assert.equal(checked.status, 200);

  const no = await staff('DELETE', `/api/me/documents/${docId}`);
  assert.equal(no.status, 400);
  assert.match(no.body.error, /already checked/);

  const fresh = await upload('qualification', 'degree.pdf');
  const yes = await staff('DELETE', `/api/me/documents/${fresh.body.document.id}`);
  assert.equal(yes.status, 204);
});

test('a staff login still cannot reach the office', async () => {
  // Nothing here widened what the employee role can do.
  for (const url of ['/api/employees', '/api/periods', `/api/employees/${riya.id}`]) {
    const res = await staff('GET', url);
    assert.ok(res.status === 403 || res.status === 401, `${url} answered ${res.status}`);
  }
});
