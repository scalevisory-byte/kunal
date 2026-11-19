/**
 * HANDING AN ASSET STRAIGHT TO SOMEBODY ELSE — from the ledger.
 *
 * Dinesh: *"ledger me se direct asset transfer karne ka option do"*. Before
 * this it took two steps on two screens — take it back today, issue it
 * tomorrow — and in between the register said the thing was in a cupboard it
 * was never in.
 *
 * What these pin:
 *
 *  - **ONE DATE FOR BOTH SIDES.** It leaves one ledger and lands on the other
 *    on the same day, which is what makes both read "Transferred" instead of a
 *    return on Tuesday and an issue on Friday.
 *  - **The handover log is added to, never rewritten.** The old handover is
 *    closed and a new one opened; nothing is deleted.
 *  - **`from_employee_id` is checked**, so a page left open while somebody
 *    else moved the laptop refuses by name rather than moving it twice.
 *  - **Nothing written off moves**, and nobody is handed what they already
 *    hold.
 *  - **It is all-or-nothing per asset, never per request**: what can move,
 *    moves; what cannot is reported with the reason.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-transfer-'));
process.env.APP_PASSWORD = 'the-key';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { authorization: 'Bearer the-key', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed, text };
};

let company;
let alpesh;
let priya;
let laptop;
let mobile;
let chair;

test('set the scene: Alpesh holds a laptop and a mobile', async () => {
  company = (await api('POST', '/api/companies', { name: 'BOOKNFLY' })).body.id;
  alpesh = (await api('POST', '/api/employees', { company_id: company, name: 'Alpesh Shah', monthly_salary: 32000 })).body.id;
  priya = (await api('POST', '/api/employees', { company_id: company, name: 'Priya Nair', monthly_salary: 28000 })).body.id;

  laptop = (await api('POST', '/api/people/assets', { company_id: company, kind: 'Laptop', label: 'Dell Latitude 5420', purchase_cost: 54000 })).body.id;
  mobile = (await api('POST', '/api/people/assets', { company_id: company, kind: 'Mobile', label: 'Redmi Note 12', purchase_cost: 14000 })).body.id;
  chair = (await api('POST', '/api/people/assets', { company_id: company, kind: 'Chair', label: 'Godrej revolving', purchase_cost: 6500 })).body.id;

  await api('POST', `/api/people/assets/${laptop}/issue`, { employee_id: alpesh, issued_on: '2026-02-01' });
  await api('POST', `/api/people/assets/${mobile}/issue`, { employee_id: alpesh, issued_on: '2026-02-01' });
});

test('the laptop goes straight to Priya, and both ledgers read it on the same day', async () => {
  const done = await api('POST', '/api/people/assets/transfer', {
    asset_ids: [laptop],
    from_employee_id: alpesh,
    to_employee_id: priya,
    on: '2026-11-19',
    condition: 'working, charger included',
    note: 'moved to the Surat desk',
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.moved.length, 1);
  assert.equal(done.body.to.name, 'Priya Nair');
  assert.equal(done.body.on, '2026-11-19');

  const alpeshBook = (await api('GET', `/api/people/assets/ledger/${alpesh}`)).body.ledger.book;
  const priyaBook = (await api('GET', `/api/people/assets/ledger/${priya}`)).body.ledger.book;
  const out = alpeshBook.rows.find((r) => r.type === 'Transferred out');
  const into = priyaBook.rows.find((r) => r.type === 'Transferred in');
  assert.ok(out, 'Alpesh should show it going out');
  assert.ok(into, 'Priya should show it coming in');
  assert.equal(out.on, into.on, 'the same day on both sides, or it belongs to nobody in between');
  assert.ok(out.particulars.includes('Priya Nair'));
  assert.ok(into.particulars.includes('Alpesh Shah'));
});

test('the old handover is closed, not deleted — the log keeps both', async () => {
  const slips = (await api('GET', `/api/people/assets/handovers?asset_id=${laptop}`)).body.handovers;
  assert.equal(slips.length, 2, 'one closed slip and one open one');
  const closed = slips.find((h) => h.returned_on);
  const open = slips.find((h) => !h.returned_on);
  assert.equal(closed.employee_id, alpesh);
  assert.equal(closed.returned_on, '2026-11-19');
  assert.equal(open.employee_id, priya);
  assert.equal(open.issued_on, '2026-11-19');
  assert.equal(open.condition_out, 'working, charger included');
});

test('a page left open cannot move what is no longer with them', async () => {
  // Alpesh's screen still thinks he has the laptop; it is Priya's now.
  const again = await api('POST', '/api/people/assets/transfer', {
    asset_ids: [laptop],
    from_employee_id: alpesh,
    to_employee_id: priya,
    on: '2026-11-20',
  });
  assert.equal(again.status, 200);
  assert.equal(again.body.moved.length, 0);
  assert.equal(again.body.refused.length, 1);
  assert.match(again.body.refused[0].why, /Priya Nair has it/);
  // And nothing was written: still one open slip, still dated the 19th.
  const open = (await api('GET', `/api/people/assets/handovers?asset_id=${laptop}`)).body.handovers.filter(
    (h) => !h.returned_on
  );
  assert.equal(open.length, 1);
  assert.equal(open[0].issued_on, '2026-11-19');
});

test('nobody is handed what they already hold', async () => {
  const res = await api('POST', '/api/people/assets/transfer', {
    asset_ids: [laptop],
    to_employee_id: priya,
    on: '2026-11-20',
  });
  assert.equal(res.body.moved.length, 0);
  assert.match(res.body.refused[0].why, /already has it/);
});

test('what can move moves, and what cannot is named with the reason', async () => {
  // The mobile is Alpesh's; the chair is nobody's, so it is not his to pass on.
  const res = await api('POST', '/api/people/assets/transfer', {
    asset_ids: [mobile, chair],
    from_employee_id: alpesh,
    to_employee_id: priya,
    on: '2026-11-19',
  });
  assert.equal(res.body.moved.length, 1);
  assert.equal(res.body.refused.length, 1);
  assert.match(res.body.refused[0].why, /in the office/);
  const stillHere = (await api('GET', `/api/people/assets/${chair}`)).body;
  assert.ok(!stillHere.employee_id, 'the chair did not move');
});

test('a written-off asset does not move, and a transfer to nobody is refused', async () => {
  const dead = (await api('POST', '/api/people/assets', { company_id: company, kind: 'Laptop', label: 'Old Lenovo', purchase_cost: 38000 })).body.id;
  await api('POST', `/api/people/assets/${dead}/issue`, { employee_id: alpesh, issued_on: '2026-01-01' });
  await api('POST', `/api/people/assets/${dead}/return`, { returned_on: '2026-05-01' });
  await api('POST', `/api/people/assets/${dead}/write-off`, { written_off_on: '2026-05-02', why: 'board failed' });

  const res = await api('POST', '/api/people/assets/transfer', { asset_ids: [dead], to_employee_id: priya });
  assert.equal(res.body.moved.length, 0);
  assert.match(res.body.refused[0].why, /written off/);

  const nowhere = await api('POST', '/api/people/assets/transfer', { asset_ids: [mobile], to_employee_id: 99999 });
  assert.equal(nowhere.status, 400);

  const nothing = await api('POST', '/api/people/assets/transfer', { asset_ids: [], to_employee_id: priya });
  assert.equal(nothing.status, 400);
});

test('the ledger page carries the people it could go to, and no salaries', async () => {
  const res = await api('GET', `/api/people/assets/ledger/${alpesh}`);
  const names = res.body.people.map((p) => p.name);
  assert.ok(names.includes('Priya Nair'));
  assert.ok(!names.includes('Alpesh Shah'), 'nobody transfers to themselves');
  assert.ok(!JSON.stringify(res.body.people).includes('monthly_salary'));
  assert.ok(!JSON.stringify(res.body.people).includes('28000'));
});
