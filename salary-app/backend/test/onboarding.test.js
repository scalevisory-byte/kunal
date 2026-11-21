import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'onboard-'));
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
process.env.ALLOW_OPEN = 'true';
delete process.env.APP_PASSWORD;

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const call = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

let company;
let invitation;
let token;

test('the office invites somebody', async () => {
  company = (await call('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  const made = await call('POST', '/api/onboarding', {
    company_id: company.id,
    name: 'Nisha Rawal',
    phone: '9825099887',
    designation: 'Accounts Executive',
    department: 'Accounts',
    employment_type: 'Permanent',
    joined_on: '2026-12-01',
  });
  assert.equal(made.status, 201);
  invitation = made.body;
  assert.equal(invitation.status, 'invited');
  assert.ok(invitation.link.includes('/join/'));
  token = invitation.link.split('/join/')[1];
});

test('one mobile number, one person', async () => {
  /* The cheapest place to stop one person becoming two records. */
  const again = await call('POST', '/api/onboarding', {
    company_id: company.id, name: 'Nisha R', phone: '+91 98250 99887',
  });
  assert.equal(again.status, 400);
  assert.match(again.body.error, /already has an invitation open/);
});

test('the link shows them what the office decided, and their own blank form', async () => {
  const seen = await call('GET', `/api/join/${token}`);
  assert.equal(seen.status, 200);
  assert.equal(seen.body.status, 'opened', 'opening it is recorded');
  assert.equal(seen.body.office.designation, 'Accounts Executive');
  assert.equal(seen.body.office.joined_on, '2026-12-01');
  /* No ids of anybody, and nothing about pay. */
  const text = JSON.stringify(seen.body);
  assert.ok(!text.includes('company_id'));
  assert.ok(!text.includes('monthly_salary'));
});

test('a bad token reaches nothing', async () => {
  assert.equal((await call('GET', '/api/join/not-a-token')).status, 404);
  /* And a token of the right shape with the wrong signature is no better. */
  const tampered = `${token.split('.')[0]}.AAAA`;
  assert.equal((await call('GET', `/api/join/${tampered}`)).status, 404);
});

test('they fill it in, and a draft is merged rather than replaced', async () => {
  await call('PATCH', `/api/join/${token}`, { name: 'Nisha Rawal', phone: '9825099887' });
  const second = await call('PATCH', `/api/join/${token}`, { dob: '1998-04-11' });
  assert.equal(second.status, 200);
  /* The first save is still there: two tabs open would otherwise have the
     last save wipe the other's answers. */
  assert.equal(second.body.draft.name, 'Nisha Rawal');
  assert.equal(second.body.draft.dob, '1998-04-11');
  assert.ok(second.body.progress.percent > 0);
});

test('it cannot be sent in without the declaration, or half filled', async () => {
  const noDeclaration = await call('POST', `/api/join/${token}/submit`, {});
  assert.equal(noDeclaration.status, 400);
  assert.match(noDeclaration.body.error, /declaration/);

  const half = await call('POST', `/api/join/${token}/submit`, { declared: true });
  assert.equal(half.status, 400);
  assert.match(half.body.error, /still wanted/);
});

test('sent in, and then it cannot be changed under the office', async () => {
  await call('PATCH', `/api/join/${token}`, {
    address_line1: '14 Gokul Flats',
    emergency_name: 'Rakesh Rawal',
    emergency_phone: '9898012345',
    pan: 'ABCDE1234F',
    bank_account: '50100123456789',
    /* Things that are NOT theirs to decide, sent anyway. */
    monthly_salary: 999999,
    active: 0,
  });
  const sent = await call('POST', `/api/join/${token}/submit`, { declared: true });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.status, 'submitted');

  const after = await call('PATCH', `/api/join/${token}`, { phone: '0000000000' });
  assert.equal(after.status, 400);
  assert.match(after.body.error, /send it back/);
});

test('an approval is the ONLY thing that makes an employee, and it ignores what they typed about pay', async () => {
  const before = (await call('GET', '/api/employees')).body.employees.length;

  const done = await call('POST', `/api/onboarding/${invitation.id}/approve`, {
    code: 'BOO-001',
    extra: { monthly_salary: 24000, payment_mode: 'Bank' },
  });
  assert.equal(done.status, 200);
  const employee = done.body.employee;
  assert.equal(employee.name, 'Nisha Rawal');
  /* The office's own decisions came from the INVITATION. */
  assert.equal(employee.designation, 'Accounts Executive');
  assert.equal(employee.joined_on, '2026-12-01');
  /* THE SALARY IS THE OFFICE'S, not the one in the draft. */
  assert.equal(employee.monthly_salary, 24000);
  assert.equal(employee.active, 1);
  /* And their own details came across. */
  assert.equal(employee.address_line1, '14 Gokul Flats');
  assert.equal(employee.pan, 'ABCDE1234F');

  assert.equal((await call('GET', '/api/employees')).body.employees.length, before + 1);
});

test('approving twice does not make a second person', async () => {
  const again = await call('POST', `/api/onboarding/${invitation.id}/approve`, {});
  assert.equal(again.status, 400);
  assert.match(again.body.error, /already on the staff list/);
});

test('an approved link is dead', async () => {
  assert.equal((await call('GET', `/api/join/${token}`)).status, 404);
});

test('a form is sent back with remarks, and remarks are required', async () => {
  const made = (await call('POST', '/api/onboarding', {
    company_id: company.id, name: 'Second Person', phone: '9000000001',
  })).body;
  const t = made.link.split('/join/')[1];
  await call('PATCH', `/api/join/${t}`, {
    name: 'Second Person', phone: '9000000001', dob: '1995-01-01',
    address_line1: 'somewhere', emergency_name: 'Somebody', emergency_phone: '9000000002',
  });
  await call('POST', `/api/join/${t}/submit`, { declared: true });

  const silent = await call('POST', `/api/onboarding/${made.id}/return`, {});
  assert.equal(silent.status, 400);

  const sent = await call('POST', `/api/onboarding/${made.id}/return`, {
    remarks: 'the Aadhaar number is missing',
  });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.status, 'returned');

  /* They can edit again, and the remarks tell them what to fix. */
  const theirs = await call('GET', `/api/join/${t}`);
  assert.equal(theirs.body.remarks, 'the Aadhaar number is missing');
  assert.equal((await call('PATCH', `/api/join/${t}`, { aadhaar: '123456781234' })).status, 200);

  /* And an unsubmitted form cannot be approved at all. */
  const early = await call('POST', `/api/onboarding/${made.id}/approve`, {});
  assert.equal(early.status, 400);
  assert.match(early.body.error, /submitted/);
});

test('a cancelled invitation stops working at once', async () => {
  const made = (await call('POST', '/api/onboarding', {
    company_id: company.id, name: 'Third Person', phone: '9000000003',
  })).body;
  const t = made.link.split('/join/')[1];
  assert.equal((await call('GET', `/api/join/${t}`)).status, 200);
  await call('POST', `/api/onboarding/${made.id}/cancel`, { why: 'offer withdrawn' });
  assert.equal((await call('GET', `/api/join/${t}`)).status, 404);
});

test('every step is on the invitation’s own history', async () => {
  const one = (await call('GET', `/api/onboarding/${invitation.id}`)).body;
  assert.deepEqual(
    one.history.map((h) => h.status),
    ['invited', 'opened', 'submitted', 'approved']
  );
});

/*
 * THE PAPERWORK SOMEBODY SENDS IN BEFORE THEY EXIST.
 */
test('documents uploaded on a joining form come across at approval, unchecked', async () => {
  const made = (await call('POST', '/api/onboarding', {
    company_id: company.id, name: 'Fourth Person', phone: '9000000004', joined_on: '2026-12-01',
  })).body;
  const t = made.link.split('/join/')[1];

  /* A real multipart upload, as a phone would send it. */
  const send = async (kind, name) => {
    const form = new FormData();
    form.append('document', new Blob([Buffer.from('%PDF-1.4 test')], { type: 'application/pdf' }), name);
    form.append('kind', kind);
    const res = await fetch(`${base}/api/join/${t}/documents`, { method: 'POST', body: form });
    return { status: res.status, body: await res.json() };
  };

  const pan = await send('pan', 'pan.pdf');
  assert.equal(pan.status, 201);
  /* The server's own filename never travels: it is a path. */
  assert.ok(!('file_path' in pan.body));
  await send('aadhaar', 'aadhaar.pdf');

  const theirs = await call('GET', `/api/join/${t}/documents`);
  assert.equal(theirs.body.documents.length, 2);
  assert.ok(!JSON.stringify(theirs.body).includes('file_path'));

  /* One can be taken back off and replaced while the form is still theirs. */
  const gone = await call('DELETE', `/api/join/${t}/documents/${pan.body.id}`);
  assert.equal(gone.body.deleted, true);
  await send('pan', 'the-right-pan.pdf');

  await call('PATCH', `/api/join/${t}`, {
    name: 'Fourth Person', phone: '9000000004', dob: '1994-02-02',
    address_line1: 'somewhere', emergency_name: 'Somebody', emergency_phone: '9000000005',
  });
  await call('POST', `/api/join/${t}/submit`, { declared: true });

  const done = await call('POST', `/api/onboarding/${made.id}/approve`, { code: 'BOO-444' });
  assert.equal(done.status, 200);

  const record = await call('GET', `/api/employees/${done.body.employee.id}/record`);
  const kinds = record.body.documents.map((d) => d.kind).sort();
  assert.deepEqual(kinds, ['aadhaar', 'pan']);
  /*
   * THEY ARRIVE UNCHECKED. Approving a joining form is not the same as
   * having looked at the Aadhaar card behind it, and a tick against a
   * document nobody read is worse than no tick at all.
   */
  assert.ok(record.body.documents.every((d) => d.verified === null));
  /* And the path never leaves the server, here either. */
  assert.ok(!JSON.stringify(record.body.documents).includes('file_path'));
});

test('a document is checked, or sent back with a reason', async () => {
  const people = (await call('GET', '/api/employees')).body.employees;
  const person = people.find((e) => e.name === 'Fourth Person');
  const docs = (await call('GET', `/api/employees/${person.id}/record`)).body.documents;

  const ok = await call('POST', `/api/employees/${person.id}/documents/${docs[0].id}/verify`, {
    verified: true,
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.verified, 1);

  /* A rejection with no reason is one nobody can put right. */
  const silent = await call('POST', `/api/employees/${person.id}/documents/${docs[1].id}/verify`, {
    verified: false,
  });
  assert.equal(silent.status, 400);

  const no = await call('POST', `/api/employees/${person.id}/documents/${docs[1].id}/verify`, {
    verified: false, note: 'the photograph is cut off',
  });
  assert.equal(no.body.verified, 0);
  assert.equal(no.body.verify_note, 'the photograph is cut off');

  /* And the decision can be handed back to nobody-has-looked. */
  const back = await call('POST', `/api/employees/${person.id}/documents/${docs[1].id}/verify`, {
    verified: null,
  });
  assert.equal(back.body.verified, null);
});

test('the register says whose file is short, and counts unchecked apart from rejected', async () => {
  const reg = await call('GET', '/api/documents/register');
  assert.equal(reg.status, 200);
  const row = reg.body.rows.find((r) => r.name === 'Fourth Person');
  assert.equal(row.kinds.pan.key, 'verified');
  assert.equal(row.kinds.aadhaar.key, 'unchecked');
  assert.equal(row.kinds.photo.key, 'missing');
  assert.ok(row.missing.includes('Photograph'));

  /* All four on file and all four CHECKED are different questions, and an
     audit asks the second. */
  assert.ok(reg.body.totals.checked <= reg.body.totals.complete);
  assert.ok(!JSON.stringify(reg.body).includes('file_path'));
});

test('a withdrawn invitation takes its files with it', async () => {
  const made = (await call('POST', '/api/onboarding', {
    company_id: company.id, name: 'Fifth Person', phone: '9000000006',
  })).body;
  const t = made.link.split('/join/')[1];
  const form = new FormData();
  form.append('document', new Blob([Buffer.from('%PDF-1.4 x')], { type: 'application/pdf' }), 'x.pdf');
  form.append('kind', 'pan');
  await fetch(`${base}/api/join/${t}/documents`, { method: 'POST', body: form });

  await call('POST', `/api/onboarding/${made.id}/cancel`, { why: 'offer withdrawn' });
  /* Nothing will ever own that file, so it does not sit in the store for
     ever with no row pointing at it. */
  const after = await call('GET', `/api/onboarding/${made.id}`);
  assert.deepEqual(after.body.documents, []);
});
