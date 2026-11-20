import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { courierKpis, inwardNumber, isPending } from '../../shared/frontOffice.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-cou-'));
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

const DAY = '2026-11-20';
let riya;
test.before(async () => {
  const company = (await api('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  riya = (await api('POST', '/api/employees', {
    company_id: company.id, name: 'Riya Pal', department: 'Accounts', monthly_salary: 22000,
  })).body;
});

const inward = (over = {}) =>
  api('POST', '/api/front-office/courier', {
    day: DAY, direction: 'Inward', company: 'DTDC', party: 'Head office', ...over,
  });

test('an inward parcel gets its own number, and an outward one does not', async () => {
  const got = (await inward({ ref_no: 'X9981' })).body;
  assert.match(got.inward_no, /^CR-IN-2026-\d{4}$/);

  const sent = (await api('POST', '/api/front-office/courier', {
    day: DAY, direction: 'Outward', company: 'Blue Dart', party: 'CA office',
  })).body;
  assert.equal(sent.inward_no, null, 'nothing was received, so there is nothing to number');
  assert.equal(sent.status, 'Sent');

  assert.equal(inwardNumber(2026, 3), 'CR-IN-2026-0003');
});

test('A PARCEL FOR SOMEBODY IS PENDING UNTIL THEY TAKE IT', async () => {
  /*
   * The whole point of the register: "it came on Tuesday" is not the
   * question anybody asks a week later - "where is it now" is.
   */
  const forRiya = (await inward({ recipient_employee_id: riya.id, description: 'Bank statements' })).body;
  assert.equal(forRiya.status, 'Pending handover');
  assert.equal(forRiya.recipient_name, 'Riya Pal');
  /* The department comes off the employee, so nobody types it twice. */
  assert.equal(forRiya.department, 'Accounts');
  assert.ok(isPending(forRiya));

  // Nothing addressed to anybody is simply received.
  const general = (await inward({ party: 'GST office' })).body;
  assert.equal(general.status, 'Received');

  const { rows } = (await api('GET', '/api/front-office/courier/pending')).body;
  assert.ok(rows.some((r) => r.id === forRiya.id));
  assert.ok(!rows.some((r) => r.id === general.id));
});

test('WRITING A HANDOVER IS WHAT MAKES IT DELIVERED', async () => {
  const parcel = (await inward({ recipient_employee_id: riya.id })).body;
  const done = (await api('POST', `/api/front-office/courier/${parcel.id}/handover`, {
    to_employee_id: riya.id, acknowledged: true, remark: 'signed the book',
  })).body;

  assert.equal(done.status, 'Delivered');
  assert.equal(done.handed_to, 'Riya Pal');
  assert.ok(done.handed_on, 'the date it changed hands');

  /* The log keeps what happened; the row carries only where it has got to.
     The two answer different questions, so they cannot drift. */
  const { handovers } = (await api('GET', `/api/front-office/courier/${parcel.id}`)).body;
  assert.equal(handovers.length, 1);
  assert.equal(handovers[0].acknowledged, 1);
  assert.ok(handovers[0].handed_by, 'who handed it over');

  // It is off the pending list the moment it is delivered.
  const { rows } = (await api('GET', '/api/front-office/courier/pending')).body;
  assert.ok(!rows.some((r) => r.id === parcel.id));
});

test('a handover needs somebody to have taken it, and only something received can be', async () => {
  const parcel = (await inward()).body;
  assert.equal((await api('POST', `/api/front-office/courier/${parcel.id}/handover`, {})).status, 400);

  const sent = (await api('POST', '/api/front-office/courier', {
    day: DAY, direction: 'Outward', company: 'Professional', party: 'CA office',
  })).body;
  const no = await api('POST', `/api/front-office/courier/${sent.id}/handover`, { to_name: 'anyone' });
  assert.equal(no.status, 400);
  assert.match(no.body.error, /received/);
});

test('returned is recorded by hand, because nothing else can tell', async () => {
  const parcel = (await inward()).body;
  const back = (await api('PATCH', `/api/front-office/courier/${parcel.id}`, {
    status: 'Returned', remark: 'wrong address',
  })).body;
  assert.equal(back.status, 'Returned');

  const bad = await api('PATCH', `/api/front-office/courier/${parcel.id}`, { status: 'Lost in the post' });
  assert.equal(bad.status, 400);

  const { entries } = (await api('GET', `/api/people/audit?entity=fo_courier&entity_id=${parcel.id}`)).body;
  assert.ok(entries.some((e) => e.to_value === 'Returned' && e.note === 'wrong address'));
});

test('a courier entry is archived, never deleted', async () => {
  const parcel = (await inward({ ref_no: 'TO-ARCHIVE' })).body;
  assert.equal((await api('DELETE', `/api/front-office/courier/${parcel.id}`)).status, 204);
  const open = (await api('GET', `/api/front-office/courier?day=${DAY}`)).body;
  assert.ok(!open.rows.some((r) => r.id === parcel.id));
  const kept = (await api('GET', `/api/front-office/courier?day=${DAY}&archived=true`)).body;
  assert.ok(kept.rows.some((r) => r.id === parcel.id));
});

test('the register can be searched and narrowed', async () => {
  const parcel = (await inward({ ref_no: 'FINDME123', description: 'Chequebook' })).body;
  for (const q of ['FINDME123', 'Chequebook', 'DTDC']) {
    const { rows } = (await api('GET', `/api/front-office/courier?q=${encodeURIComponent(q)}`)).body;
    assert.ok(rows.some((r) => r.id === parcel.id), `"${q}" should find it`);
  }
  const { rows } = (await api('GET', `/api/front-office/courier?employee_id=${riya.id}`)).body;
  assert.ok(rows.every((r) => r.recipient_employee_id === riya.id));
});

test('the figures count what is in the register', () => {
  const k = courierKpis([
    { direction: 'Inward', status: 'Pending handover' },
    { direction: 'Inward', status: 'Delivered' },
    { direction: 'Inward', status: 'Returned' },
    { direction: 'Outward', status: 'Sent' },
  ]);
  assert.deepEqual(
    { total: k.total, inward: k.inward, outward: k.outward, pending: k.pending, delivered: k.delivered, returned: k.returned },
    { total: 4, inward: 3, outward: 1, pending: 1, delivered: 1, returned: 1 }
  );
});
