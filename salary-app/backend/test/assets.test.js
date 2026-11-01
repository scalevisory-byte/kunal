/**
 * The asset register, end to end.
 *
 * What these pin, in order of how much they matter:
 *
 *  - **Handover history is kept.** Issuing to a second person used to overwrite
 *    the first, so "asset history" had nothing behind it.
 *  - **"Not checked" is not "missing."** A stock take that treats the two the
 *    same invents losses.
 *  - **An asset code is never reused**, because an old service bill and a signed
 *    handover slip still refer to it.
 *  - **Anything with a history is written off, not deleted.**
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-assets-'));
process.env.APP_PASSWORD = 'the-key';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      authorization: 'Bearer the-key',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
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

let companyId;
let branchId;
let vaibhav;
let riya;
let laptop;

test('set the scene', async () => {
  const company = await api('POST', '/api/companies', { name: 'BOOKNFLY PRIVATE LIMITED' });
  companyId = company.body.id;
  branchId = (await api('POST', '/api/companies/branches', { company_id: companyId, name: 'Vadodara' })).body.id;
  vaibhav = (await api('POST', '/api/employees', { company_id: companyId, name: 'Vaibhav Gupta', monthly_salary: 26000 })).body.id;
  riya = (await api('POST', '/api/employees', { company_id: companyId, name: 'Riya Pal', monthly_salary: 24000 })).body.id;
});

/* ---------------- the code on the label ---------------- */

test('an asset gets a readable code, and the purchase side is recorded', async () => {
  const made = await api('POST', '/api/people/assets', {
    company_id: companyId,
    branch_id: branchId,
    kind: 'Laptop',
    label: 'Dell Latitude 3420',
    identifier: 'SN-884421',
    purchase_cost: 42000,
    purchase_date: '2026-07-01',
    vendor: 'Rajhans Computers',
    invoice_no: 'RC/26-27/118',
    warranty_until: '2029-07-01',
  });
  assert.equal(made.status, 201);
  laptop = made.body.id;
  assert.equal(made.body.code, 'BPL-LAP-001');
  assert.equal(made.body.purchase_cost, 42000);
  assert.equal(made.body.vendor, 'Rajhans Computers');
  assert.equal(made.body.branch_name, 'Vadodara');
});

test('the series runs on, per company and kind', async () => {
  const second = await api('POST', '/api/people/assets', { company_id: companyId, kind: 'Laptop', label: 'HP 240' });
  assert.equal(second.body.code, 'BPL-LAP-002');
  const sim = await api('POST', '/api/people/assets', { company_id: companyId, kind: 'SIM card', label: 'Jio 9909993565' });
  assert.equal(sim.body.code, 'BPL-SIM-001');
});

test('an office with its own stickers can type its own code', async () => {
  const mine = await api('POST', '/api/people/assets', {
    company_id: companyId,
    kind: 'Laptop',
    label: 'Already labelled',
    code: 'bnf/old/77',
  });
  assert.equal(mine.body.code, 'BNF/OLD/77', 'tidied, not rejected');

  const clash = await api('POST', '/api/people/assets', {
    company_id: companyId,
    kind: 'Laptop',
    label: 'Clashing',
    code: 'BNF/OLD/77',
  });
  assert.equal(clash.status, 400);
  assert.match(clash.body.error, /already on something else/);
});

test('scanning a label finds the asset', async () => {
  const found = await api('GET', '/api/people/assets/by-code/bpl-lap-001');
  assert.equal(found.status, 200);
  assert.equal(found.body.id, laptop);

  const nothing = await api('GET', '/api/people/assets/by-code/BPL-LAP-999');
  assert.equal(nothing.status, 404);
  assert.match(nothing.body.error, /BPL-LAP-999/, 'and says which code it could not find');
});

test('the label prints as a barcode', async () => {
  const res = await fetch(`${base}/api/people/assets/${laptop}/label.svg`, {
    headers: { authorization: 'Bearer the-key' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
  const svg = await res.text();
  assert.match(svg, /BPL-LAP-001<\/text>/);
  assert.match(svg, /mm"/, 'sized to print');
});

/* ---------------- handovers, and keeping their history ---------------- */

test('issuing, returning, and issuing again keeps all three on the record', async () => {
  await api('POST', `/api/people/assets/${laptop}/issue`, {
    employee_id: vaibhav,
    issued_on: '2026-07-02',
    condition: 'new',
  });
  let asset = (await api('GET', `/api/people/assets?out=true`)).body.assets.find((a) => a.id === laptop);
  assert.equal(asset.employee_name, 'Vaibhav Gupta');

  await api('POST', `/api/people/assets/${laptop}/return`, {
    returned_on: '2026-09-30',
    condition: 'screen scratched',
  });
  await api('POST', `/api/people/assets/${laptop}/issue`, {
    employee_id: riya,
    issued_on: '2026-10-01',
    condition: 'scratched screen, working',
  });

  const { body } = await api('GET', `/api/people/assets/handovers?asset_id=${laptop}`);
  assert.equal(body.handovers.length, 2, 'both handovers are kept, not overwritten');
  const [latest, first] = body.handovers;
  assert.equal(latest.employee_name, 'Riya Pal');
  assert.equal(latest.returned_on, null, 'still out');
  assert.equal(first.employee_name, 'Vaibhav Gupta');
  assert.equal(first.returned_on, '2026-09-30');
  assert.equal(first.condition_in, 'screen scratched');
});

test('passing it straight to somebody else closes the first handover rather than losing it', async () => {
  const hp = (await api('GET', '/api/people/assets')).body.assets.find((a) => a.code === 'BPL-LAP-002');
  await api('POST', `/api/people/assets/${hp.id}/issue`, { employee_id: vaibhav, issued_on: '2026-08-01' });
  // Straight to Riya, with no return in between - which happens.
  await api('POST', `/api/people/assets/${hp.id}/issue`, { employee_id: riya, issued_on: '2026-08-15' });

  const { body } = await api('GET', `/api/people/assets/handovers?asset_id=${hp.id}`);
  assert.equal(body.handovers.length, 2);
  const vaibhavs = body.handovers.find((h) => h.employee_name === 'Vaibhav Gupta');
  assert.equal(vaibhavs.returned_on, '2026-08-15');
  assert.equal(vaibhavs.condition_in, 'passed on directly', 'and it says that is what happened');
  assert.equal(body.handovers.find((h) => h.employee_name === 'Riya Pal').returned_on, null);
});

test('issuing to the person who already has it does nothing', async () => {
  const before = (await api('GET', `/api/people/assets/handovers?asset_id=${laptop}`)).body.handovers.length;
  await api('POST', `/api/people/assets/${laptop}/issue`, { employee_id: riya });
  const after = (await api('GET', `/api/people/assets/handovers?asset_id=${laptop}`)).body.handovers.length;
  assert.equal(after, before, 'no second row for the same person');
});

/* ---------------- one asset's whole life ---------------- */

test('the history reads as a timeline, in date order', async () => {
  const { body } = await api('GET', `/api/people/assets/${laptop}/history`);
  const line = body.events.map((e) => `${e.on} ${e.what}${e.who ? ` ${e.who}` : ''}`);
  assert.deepEqual(line, [
    '2026-07-01 Bought',
    '2026-07-02 Issued Vaibhav Gupta',
    '2026-09-30 Returned Vaibhav Gupta',
    '2026-10-01 Issued Riya Pal',
  ]);
  assert.equal(body.events[0].amount, 42000);
  assert.match(body.events[0].detail, /Rajhans Computers/);
});

/* ---------------- a stock take ---------------- */

test('a round starts with everything unchecked, which is not the same as missing', async () => {
  const { body } = await api('GET', '/api/people/rounds/2026-11%20stock%20take');
  assert.equal(body.found, 0);
  assert.equal(body.missing, 0, 'nothing has been declared missing');
  assert.equal(body.not_checked, 4, 'everything is simply not looked at yet');
  assert.equal(body.total, 4);
});

test('ticking assets off, and naming one that is not there', async () => {
  const assets = (await api('GET', '/api/people/assets')).body.assets;
  const round = '2026-11 stock take';
  for (const a of assets.filter((x) => x.code !== 'BNF/OLD/77')) {
    const res = await api('POST', `/api/people/assets/${a.id}/verify`, { round, found: true, by: 'Dinesh' });
    assert.equal(res.status, 200);
  }
  const missing = assets.find((x) => x.code === 'BNF/OLD/77');
  await api('POST', `/api/people/assets/${missing.id}/verify`, {
    round,
    found: false,
    note: 'nobody knows where it went',
    by: 'Dinesh',
  });

  const { body } = await api('GET', `/api/people/rounds/${encodeURIComponent(round)}`);
  assert.equal(body.found, 3);
  assert.equal(body.missing, 1);
  assert.equal(body.not_checked, 0);
  assert.equal(body.missing_assets[0].code, 'BNF/OLD/77');
});

test('checking one again replaces the verdict rather than leaving two that disagree', async () => {
  const round = '2026-11 stock take';
  const missing = (await api('GET', `/api/people/rounds/${encodeURIComponent(round)}`)).body.missing_assets[0];
  await api('POST', `/api/people/assets/${missing.id}/verify`, {
    round,
    found: true,
    note: 'turned up in the store cupboard',
    by: 'Dinesh',
  });
  const { body } = await api('GET', `/api/people/rounds/${encodeURIComponent(round)}`);
  assert.equal(body.missing, 0);
  assert.equal(body.found, 4);
});

test('an asset added after a round started is not checked, not missing', async () => {
  const round = '2026-11 stock take';
  await api('POST', '/api/people/assets', { company_id: companyId, kind: 'Mobile', label: 'Bought yesterday' });
  const { body } = await api('GET', `/api/people/rounds/${encodeURIComponent(round)}`);
  assert.equal(body.not_checked, 1);
  assert.equal(body.missing, 0, 'it is new, not lost');
});

test('the rounds list says how each one went', async () => {
  const { body } = await api('GET', '/api/people/rounds');
  const round = body.rounds.find((r) => r.round === '2026-11 stock take');
  assert.equal(round.checked, 4);
  assert.equal(round.found, 4);
  assert.equal(round.missing, 0);
});

test('a round needs a name', async () => {
  const res = await api('POST', `/api/people/assets/${laptop}/verify`, { round: '  ' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /which round/);
});

/* ---------------- writing off ---------------- */

test('writing one off brings it back first, and keeps its code', async () => {
  const hp = (await api('GET', '/api/people/assets')).body.assets.find((a) => a.code === 'BPL-LAP-002');
  assert.ok(hp.employee_id, 'it is out with Riya');

  const refused = await api('POST', `/api/people/assets/${hp.id}/write-off`, {});
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /say why/);

  const done = await api('POST', `/api/people/assets/${hp.id}/write-off`, {
    on: '2026-10-31',
    why: 'motherboard failed, not worth repairing',
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.written_off_on, '2026-10-31');

  const handover = (await api('GET', `/api/people/assets/handovers?asset_id=${hp.id}`)).body.handovers[0];
  assert.equal(handover.returned_on, '2026-10-31', 'nobody is left holding something that is gone');
  assert.equal(handover.condition_in, 'written off');

  // Off the register, but still there when asked for.
  const live = await api('GET', '/api/people/assets');
  assert.equal(live.body.assets.some((a) => a.id === hp.id), false);
  const all = await api('GET', '/api/people/assets?written_off=true');
  assert.equal(all.body.assets.some((a) => a.id === hp.id), true);
});

test('a written-off code is never handed to the next asset', async () => {
  const next = await api('POST', '/api/people/assets', { company_id: companyId, kind: 'Laptop', label: 'Replacement' });
  assert.equal(next.body.code, 'BPL-LAP-003', 'not 002, which is written off');
});

test('a written-off asset cannot be issued to anybody', async () => {
  const hp = (await api('GET', '/api/people/assets?written_off=true')).body.assets.find((a) => a.code === 'BPL-LAP-002');
  const res = await api('POST', `/api/people/assets/${hp.id}/issue`, { employee_id: vaibhav });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /written off/);
});

test('anything with a history is written off, not deleted', async () => {
  const res = await api('DELETE', `/api/people/assets/${laptop}`);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /write it off instead/);

  // Something never issued can still just go.
  const typo = await api('POST', '/api/people/assets', { company_id: companyId, kind: 'Other', label: 'Typo' });
  assert.equal((await api('DELETE', `/api/people/assets/${typo.body.id}`)).body.deleted, true);
});

/* ---------------- the reports ---------------- */

test('the register totals say what is out of the building', async () => {
  const { body } = await api('GET', '/api/people/assets');
  assert.ok(body.totals.count >= 4);
  assert.equal(body.totals.out >= 1, true);
  assert.equal(body.totals.written_off >= 0, true);
  assert.equal(body.totals.out_value >= 42000, true, 'the laptop Riya has');
});

test('the register and the handovers download as CSV', async () => {
  const register = await fetch(`${base}/api/people/assets/register.csv`, {
    headers: { authorization: 'Bearer the-key' },
  });
  assert.equal(register.status, 200);
  const bytes = Buffer.from(await register.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'a BOM, so Excel opens it right');
  const csv = bytes.toString('utf8');
  assert.match(csv, /Code,Kind,What/);
  assert.match(csv, /BPL-LAP-001/);
  assert.match(csv, /Rajhans Computers/);
  assert.match(csv, /in the office|Riya Pal/, 'where it is reads as words');

  const handovers = await api('GET', '/api/people/assets/handovers.csv');
  assert.equal(handovers.status, 200);
  assert.match(handovers.text, /Vaibhav Gupta/);
  assert.match(handovers.text, /Still out/);
});

test('a handover slip lists only what somebody still has, and what they are signing', async () => {
  const { body } = await api('GET', `/api/people/assets/slip/${riya}`);
  assert.equal(body.employee, 'Riya Pal');
  assert.equal(body.company, 'BOOKNFLY PRIVATE LIMITED');
  assert.equal(body.items.length, 1, 'the written-off one is not on it');
  assert.equal(body.items[0].code, 'BPL-LAP-001');
  assert.equal(body.total, 42000);
  assert.match(body.undertaking, /return them/);

  const vaibhavs = await api('GET', `/api/people/assets/slip/${vaibhav}`);
  assert.equal(vaibhavs.body.items.length, 0, 'he has handed everything back');
});

test('the trail carries the asset moves by code and by name', async () => {
  const { body } = await api('GET', '/api/people/audit?entity=assets');
  const actions = body.entries.map((e) => e.action);
  for (const action of ['created', 'issued', 'returned', 'verified', 'not found', 'written off']) {
    assert.ok(actions.includes(action), `the trail should carry "${action}"`);
  }
  const issued = body.entries.find((e) => e.action === 'issued');
  assert.match(issued.label, /BPL-LAP-|BNF\/OLD/, 'labelled by code');
  assert.ok(issued.to_value, 'and says who got it');
});
