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

/*
 * REWRITTEN FOR v2.31, not patched. These three used to assert that what an
 * employee typed landed on the master at once. Dinesh then asked for "profile
 * approve karne ka right HR ke paas", so the rule is now the leave queue's:
 * what they send never writes the record; HR's approval does.
 */
const FILLED = {
  dob: '1994-07-11',
  gender: 'Male',
  father_name: 'Suresh Shah',
  father_occupation: 'Retired teacher',
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
};

test('they fill in their own record, and it WAITS for HR - the master has not moved', async () => {
  const saved = await staff('PATCH', '/api/me/profile', FILLED);
  assert.equal(saved.status, 200);
  // Their own page shows what they typed...
  assert.equal(saved.body.employee.uan, '100200300400');
  assert.deepEqual(saved.body.refused, []);
  // ...and says which boxes are not on the record yet.
  assert.deepEqual([...saved.body.waiting].sort(), Object.keys(FILLED).sort());
  assert.ok(!saved.body.on_record.includes('uan'), 'a UAN that is only waiting is not locked');

  // THE RULE: the office's record is exactly what it was.
  const office = (await admin('GET', `/api/employees/${amit.id}`)).body;
  assert.ok(!office.uan, 'the UAN reached the record without anybody approving it');
  assert.ok(!office.bank_account);
  assert.ok(!office.dob);
  const record = (await admin('GET', `/api/employees/${amit.id}/record`)).body;
  assert.ok(!record.history.some((r) => r.field === 'uan'), 'nothing is on the history yet either');

  // It is on HR's list instead, one block for the person.
  const queue = (await admin('GET', '/api/employees/profile-changes')).body;
  assert.equal(queue.waiting.people, 1);
  assert.equal(queue.people[0].employee_name, 'Amit Shah');
  assert.equal(queue.people[0].changes.length, Object.keys(FILLED).length);
  const uan = queue.people[0].changes.find((c) => c.field === 'uan');
  assert.equal(uan.label, 'UAN');
  assert.equal(uan.to, '100200300400');

  // Typing a box again replaces what is waiting; it does not queue a second.
  await staff('PATCH', '/api/me/profile', { city: 'Surat' });
  const again = (await admin('GET', '/api/employees/profile-changes')).body.people[0].changes;
  assert.equal(again.filter((c) => c.field === 'city').length, 1);
  assert.equal(again.find((c) => c.field === 'city').to, 'Surat');
  // A UAN that is only waiting can still be corrected by them.
  const fixed = await staff('PATCH', '/api/me/profile', { uan: '100200300401' });
  assert.equal(fixed.status, 200);
  // And typing the record's own value back withdraws it.
  const back = await staff('PATCH', '/api/me/profile', { marital_status: '' });
  assert.deepEqual(back.body.withdrawn, ['marital_status']);
  assert.ok(!back.body.waiting.includes('marital_status'));
});

test('a staff login cannot approve anything, their own included', async () => {
  const queue = (await admin('GET', '/api/employees/profile-changes')).body.people[0].changes;
  const tried = await staff('POST', '/api/employees/profile-changes/decide', { ids: queue.map((c) => c.id), approve: true });
  assert.equal(tried.status, 403);
  assert.equal((await staff('GET', '/api/employees/profile-changes')).status, 403);
});

test('HR turns one down with a reason they read, and approves the rest onto the master', async () => {
  let queue = (await admin('GET', '/api/employees/profile-changes')).body.people[0].changes;
  const phone = queue.find((c) => c.field === 'phone');

  // No reason, no refusal.
  assert.equal((await admin('POST', '/api/employees/profile-changes/decide', { ids: [phone.id], approve: false })).status, 400);
  const no = await admin('POST', '/api/employees/profile-changes/decide', { ids: [phone.id], approve: false, note: 'That is the office landline' });
  assert.equal(no.body.rejected, 1);
  const mine = (await staff('GET', '/api/me/profile')).body;
  assert.equal(mine.turned_down[0].label, 'Mobile');
  assert.match(mine.turned_down[0].note, /landline/);
  assert.notEqual(mine.employee.phone, '9327003358', 'a refused value is not shown as theirs');

  queue = (await admin('GET', '/api/employees/profile-changes')).body.people[0].changes;
  const yes = await admin('POST', '/api/employees/profile-changes/decide', { ids: queue.map((c) => c.id), approve: true });
  assert.equal(yes.body.approved, queue.length);
  assert.deepEqual(yes.body.held, []);

  // NOW it is the record.
  const office = (await admin('GET', `/api/employees/${amit.id}`)).body;
  assert.equal(office.uan, '100200300401');
  assert.equal(office.bank_account, '92991900011940');
  assert.equal(office.dob, '1994-07-11');
  assert.equal(office.city, 'Surat');
  assert.equal(office.father_occupation, 'Retired teacher');
  assert.notEqual(office.phone, '9327003358');

  // On the history by name: who typed it and who let it through.
  const rows = (await admin('GET', `/api/employees/${amit.id}/record`)).body.history;
  const bank = rows.find((r) => r.field === 'bank_account');
  assert.ok(bank, 'the bank account change was not recorded');
  assert.match(String(bank.note || ''), /employee/i);
  assert.match(String(bank.note || ''), /approved by/i);
  assert.ok(rows.some((r) => r.field === 'uan'), 'the UAN was not recorded');

  // Decided once.
  assert.equal((await admin('POST', '/api/employees/profile-changes/decide', { ids: [queue[0].id], approve: true })).status, 400);
  assert.equal((await admin('GET', '/api/employees/profile-changes')).body.waiting.changes, 0);
  // And their own page now shows the UAN as on the record, so locked.
  const after = (await staff('GET', '/api/me/profile')).body;
  assert.ok(after.on_record.includes('uan'));
  assert.deepEqual(after.waiting, []);
});

test('a statutory number already on the record is the office’s to correct', async () => {
  // The office typed Amit's PAN when he was hired.
  const no = await staff('PATCH', '/api/me/profile', { pan: 'ZZZZZ9999Z' });
  assert.equal(no.status, 400);
  assert.match(no.body.error, /ask the office/);

  const office = (await admin('GET', `/api/employees/${amit.id}`)).body;
  assert.equal(office.pan, 'ABCDE1234F', 'the PAN moved');

  // A blank one they supply themselves is accepted - and waits like the rest.
  const yes = await staff('PATCH', '/api/me/profile', { aadhaar: '123412341234' });
  assert.equal(yes.status, 200);
  assert.equal(yes.body.employee.aadhaar, '123412341234');
  assert.deepEqual(yes.body.waiting, ['aadhaar']);

  /*
   * The office types a DIFFERENT Aadhaar onto the record meanwhile. Approving
   * theirs must not overwrite it: two sources now disagree about one number,
   * and that is settled with the card.
   */
  await admin('PATCH', `/api/employees/${amit.id}`, { aadhaar: '999988887777' });
  const change = (await admin('GET', '/api/employees/profile-changes')).body.people[0].changes[0];
  const held = await admin('POST', '/api/employees/profile-changes/decide', { ids: [change.id], approve: true });
  assert.equal(held.body.approved, 0);
  assert.equal(held.body.held.length, 1);
  assert.match(held.body.held[0].why, /already says 999988887777/);
  assert.equal((await admin('GET', `/api/employees/${amit.id}`)).body.aadhaar, '999988887777');
  await admin('POST', '/api/employees/profile-changes/decide', { ids: [change.id], approve: false, note: 'Checked against the card' });
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
  // A refused field is not even on HR's list: there is nothing to approve.
  const queue = (await admin('GET', '/api/employees/profile-changes')).body.people[0].changes;
  assert.deepEqual(queue.map((c) => c.field), ['blood_group']);
  await admin('POST', '/api/employees/profile-changes/decide', { ids: queue.map((c) => c.id), approve: true });

  const office = (await admin('GET', `/api/employees/${amit.id}`)).body;
  assert.equal(Number(office.monthly_salary), 26000);
  assert.equal(office.joined_on, '2024-04-01');
  assert.equal(Number(office.active), 1);
  assert.equal(office.blood_group, 'B+');

  const after = (await admin('GET', `/api/periods/${periodId}/payroll`)).body;
  const mineAfter = after.rows.find((r) => r.employee_id === amit.id);
  // THE CLAIM THE WHOLE THING RESTS ON: filling in your own record cannot
  // move a rupee - sent, waiting or approved. Not one field on the list is an
  // input to calculateRow.
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
