/**
 * ONE PERSON'S ASSET LEDGER.
 *
 * What these pin:
 *
 *  - **Still out comes first**, because that is what somebody opened the page
 *    for.
 *  - **An asset standing against somebody with no open handover row is "held
 *    with no slip on file"** — not "never issued", and never dropped. A
 *    thousand imported rows carry a holder and no slip.
 *  - A returned asset keeps its line: "what did he ever hold" is the other
 *    half of the question.
 *  - **The value is reported, never deducted.**
 *  - The CSV carries every line, including the returned ones.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assetLedger, daysBetween, ledgerCsv } from '../../shared/assetLedger.js';

const TODAY = '2026-11-19';
const AMIT = { id: 7, name: 'Amit Shah', code: 'BNF-EMP-0140', company_name: 'BOOKNFLY PRIVATE LIMITED' };

const HANDOVERS = [
  {
    id: 1, asset_id: 11, employee_id: 7, code: 'BPL-ASSETS-000001', kind: 'Laptop',
    label: 'Dell Latitude 3420', identifier: 'DL3420-9981', purchase_cost: 47500,
    issued_on: '2026-04-02', issued_by: 'Dinesh', returned_on: null, acknowledged_on: '2026-04-03',
  },
  {
    id: 2, asset_id: 12, employee_id: 7, code: 'BPL-ASSETS-000009', kind: 'Mobile',
    label: 'Redmi Note 12', identifier: '352000000000001', purchase_cost: 13999,
    issued_on: '2025-06-10', issued_by: 'Dinesh', returned_on: '2026-03-31', returned_by: 'Store',
    condition_in: 'screen scratched',
  },
];

// On the register against Amit, with no handover row at all - imported.
const REGISTER = [
  {
    id: 13, employee_id: 7, code: 'BPL-ASSETS-000044', kind: 'Chair', label: 'Godrej revolving chair',
    purchase_cost: 4200, issued_on: '2024-11-05', returned_on: null,
  },
  // Somebody else's, and a written-off one of his: neither belongs here.
  { id: 14, employee_id: 9, code: 'BPL-ASSETS-000045', label: 'Somebody else’s desk', purchase_cost: 9000 },
  {
    id: 15, employee_id: 7, code: 'BPL-ASSETS-000046', label: 'Scrapped printer',
    purchase_cost: 12500, written_off_on: '2026-02-01',
  },
];

test('what they still hold comes first, and what came back is kept below', () => {
  const led = assetLedger({ employee: AMIT, handovers: HANDOVERS, assets: REGISTER, today: TODAY });
  assert.deepEqual(led.lines.map((l) => l.code), [
    'BPL-ASSETS-000001',       // out since April
    'BPL-ASSETS-000044',       // out since 2024, no slip
    'BPL-ASSETS-000009',       // returned
  ]);
  assert.equal(led.totals.out, 2);
  assert.equal(led.totals.returned, 1);
  assert.equal(led.totals.ever, 3);
});

test('on the register with no handover row reads "no slip on file", never "never issued"', () => {
  const led = assetLedger({ employee: AMIT, handovers: HANDOVERS, assets: REGISTER, today: TODAY });
  const chair = led.lines.find((l) => l.code === 'BPL-ASSETS-000044');
  assert.equal(chair.source, 'register');
  assert.equal(chair.no_slip, true);
  assert.equal(chair.open, true);
  assert.equal(led.totals.no_slip, 1);
  assert.equal(led.totals.unsigned, 1, 'the laptop WAS acknowledged, so only the chair is unsigned');
});

test('an asset covered by an open handover is not listed twice', () => {
  const alsoOnRegister = [
    ...REGISTER,
    { id: 11, employee_id: 7, code: 'BPL-ASSETS-000001', label: 'Dell Latitude 3420', purchase_cost: 47500 },
  ];
  const led = assetLedger({ employee: AMIT, handovers: HANDOVERS, assets: alsoOnRegister, today: TODAY });
  assert.equal(led.lines.filter((l) => l.code === 'BPL-ASSETS-000001').length, 1);
});

test('somebody else’s asset, and a written-off one, are not on this page', () => {
  const led = assetLedger({ employee: AMIT, handovers: HANDOVERS, assets: REGISTER, today: TODAY });
  assert.ok(!led.lines.some((l) => l.code === 'BPL-ASSETS-000045'), 'somebody else’s desk');
  assert.ok(!led.lines.some((l) => l.code === 'BPL-ASSETS-000046'), 'a scrapped printer is not held');
});

test('days held counts to today for something still out, and to the return date otherwise', () => {
  const led = assetLedger({ employee: AMIT, handovers: HANDOVERS, assets: REGISTER, today: TODAY });
  const laptop = led.lines.find((l) => l.code === 'BPL-ASSETS-000001');
  const mobile = led.lines.find((l) => l.code === 'BPL-ASSETS-000009');
  assert.equal(laptop.days, daysBetween('2026-04-02', TODAY));
  assert.equal(mobile.days, daysBetween('2025-06-10', '2026-03-31'));
  assert.ok(laptop.days > 0 && mobile.days > 0);
});

test('the worth is what is STILL out, reported and not deducted from anything', () => {
  const led = assetLedger({ employee: AMIT, handovers: HANDOVERS, assets: REGISTER, today: TODAY });
  assert.equal(led.totals.out_value, 47500 + 4200, 'the returned mobile is not counted against him');
  assert.equal(led.totals.oldest_out, '2024-11-05');
  // Nothing in here is a deduction, a charge or a settlement figure.
  assert.ok(!('deduct' in led.totals) && !('owed' in led.totals));
});

test('the CSV carries every line, returned ones included', () => {
  const csv = ledgerCsv(assetLedger({ employee: AMIT, handovers: HANDOVERS, assets: REGISTER, today: TODAY }));
  assert.match(csv, /^﻿Code,Kind,What/);
  assert.match(csv, /BPL-ASSETS-000009/);
  assert.match(csv, /no slip on file/);
  assert.equal(csv.trim().split('\n').length, 4, 'a header and three assets');
});

test('nobody holding anything is an empty ledger, not an error', () => {
  const led = assetLedger({ employee: AMIT, handovers: [], assets: [], today: TODAY });
  assert.equal(led.lines.length, 0);
  assert.equal(led.totals.out, 0);
  assert.equal(led.totals.out_value, 0);
  assert.equal(led.totals.oldest_out, '');
});

/* ---------------- taking it back, end to end ---------------- */

test('somebody leaving: everything comes back in one go, and only what was ticked', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-returns-'));
  process.env.APP_PASSWORD = 'the-key';
  process.env.SERVE_FRONTEND = 'false';
  const { createServer } = await import('../src/server.js');
  const server = createServer().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, url, body) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { authorization: 'Bearer the-key', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    const company = await api('POST', '/api/companies', { name: 'BNF' });
    const who = await api('POST', '/api/employees', {
      name: 'Amit Shah', company_id: company.body.id, monthly_salary: 26000, joined_on: '2026-01-01',
    });
    const made = [];
    for (const label of ['Laptop', 'Phone', 'ID card']) {
      const a = await api('POST', '/api/people/assets', {
        company_id: company.body.id, kind: label, label: `${label} one`, purchase_cost: 1000,
      });
      made.push(a.body.id);
      await api('POST', `/api/people/assets/${a.body.id}/issue`, { employee_id: who.body.id, issued_on: '2026-04-01' });
    }

    const before = await api('GET', `/api/people/assets/ledger/${who.body.id}`);
    assert.equal(before.body.ledger.totals.out, 3);

    // Two come back; the phone does not - it is not lost, it is simply still
    // with them, and the register has to keep saying so.
    const done = await api('POST', '/api/people/assets/return-many', {
      asset_ids: [made[0], made[2]],
      returned_on: '2026-11-19',
      condition: 'fine',
    });
    assert.equal(done.status, 200);
    assert.equal(done.body.returned.length, 2);
    assert.equal(done.body.returned_on, '2026-11-19');

    const after = await api('GET', `/api/people/assets/ledger/${who.body.id}`);
    assert.equal(after.body.ledger.totals.out, 1, 'the phone is still with them');
    assert.equal(after.body.ledger.totals.returned, 2);
    assert.equal(after.body.ledger.holding[0].label, 'Phone one');
    // The history is kept, with the date and the condition on it.
    const laptop = after.body.ledger.returned.find((l) => l.label === 'Laptop one');
    assert.equal(laptop.returned_on, '2026-11-19');
    assert.equal(laptop.condition_in, 'fine');

    // Nothing was written off, and nothing is a deduction.
    const register = await api('GET', '/api/people/assets?written_off=true');
    assert.ok(!register.body.assets.some((a) => a.written_off_on), 'not returned is not lost');

    // Asking again does not re-date a handover that closed.
    const twice = await api('POST', '/api/people/assets/return-many', { asset_ids: [made[0]] });
    assert.equal(twice.body.returned.length, 0);
    assert.equal(twice.body.already.length, 1);
    const unchanged = await api('GET', `/api/people/assets/ledger/${who.body.id}`);
    assert.equal(
      unchanged.body.ledger.returned.find((l) => l.label === 'Laptop one').returned_on,
      '2026-11-19',
      'a second return moved the date on a handover that was already closed'
    );

    // And the full and final still names what is out, valued and not deducted.
    await api('PUT', `/api/people/exits/${who.body.id}`, {
      type: 'resigned', resigned_on: '2026-11-01', last_working_day: '2026-11-30',
    });
    const exit = await api('GET', `/api/people/exits/${who.body.id}`);
    const out = exit.body.settlement?.assets_out || [];
    assert.equal(out.length, 1, 'the phone is named on the settlement');
    assert.ok(out[0].value >= 0);
  } finally {
    server.close();
  }
});

test('taking back something that never had a slip keeps it in their history', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-noslip-'));
  process.env.APP_PASSWORD = 'the-key';
  process.env.SERVE_FRONTEND = 'false';
  const { createServer } = await import('../src/server.js');
  const server = createServer().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, url, body) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { authorization: 'Bearer the-key', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    // Its own name: this file's two end-to-end tests share one database,
    // because db.js is initialised once per process.
    const company = await api('POST', '/api/companies', { name: 'BNF VENTURE' });
    const who = await api('POST', '/api/employees', {
      name: 'Priya Nair', company_id: company.body.id, monthly_salary: 24000, joined_on: '2026-01-01',
    });
    const chair = await api('POST', '/api/people/assets', {
      company_id: company.body.id, kind: 'Chair', label: 'Godrej chair', purchase_cost: 4200,
    });
    // Straight onto the register against her, the way an import leaves it:
    // a holder and no handover row at all.
    await api('PATCH', `/api/people/assets/${chair.body.id}`, {
      employee_id: who.body.id, issued_on: '2024-11-05',
    });

    assert.equal(who.status, 201, JSON.stringify(who.body));
    assert.equal(chair.status, 201, JSON.stringify(chair.body));
    const before = await api('GET', `/api/people/assets/ledger/${who.body.id}`);
    assert.equal(before.status, 200, JSON.stringify(before.body));
    assert.equal(before.body.ledger.totals.out, 1);
    assert.equal(before.body.ledger.totals.no_slip, 1);

    await api('POST', '/api/people/assets/return-many', {
      asset_ids: [chair.body.id], returned_on: '2026-11-19', condition: 'arm loose',
    });

    const after = await api('GET', `/api/people/assets/ledger/${who.body.id}`);
    assert.equal(after.body.ledger.totals.out, 0);
    assert.equal(
      after.body.ledger.totals.ever,
      1,
      'it disappeared from her ledger entirely — no longer held, and nothing saying it ever was'
    );
    const line = after.body.ledger.returned[0];
    assert.equal(line.returned_on, '2026-11-19');
    assert.equal(line.issued_on, '2024-11-05', 'from when the register said she had it');
    assert.equal(line.condition_in, 'arm loose');
    assert.match(line.note, /no slip was on file/);
  } finally {
    server.close();
  }
});

/* ---------------- the Tally-style movement ledger ---------------- */

test('the ledger runs in date order with a balance that follows it', async () => {
  const { ledgerTransactions } = await import('../../shared/assetLedger.js');
  const lines = [
    { asset_id: 11, code: 'A-1', kind: 'Laptop', label: 'Dell', value: 47500, issued_on: '2026-04-02', returned_on: '', open: true },
    { asset_id: 12, code: 'A-2', kind: 'Mobile', label: 'Redmi', value: 13999, issued_on: '2025-06-10', returned_on: '2026-03-31', open: false },
  ];
  const book = ledgerTransactions({ lines, today: '2026-11-19' });

  assert.deepEqual(
    book.rows.map((r) => [r.on, r.type, r.in, r.out, r.balance]),
    [
      ['2025-06-10', 'Asset issued', 1, 0, 1],
      ['2026-03-31', 'Asset returned', 0, 1, 0],
      ['2026-04-02', 'Asset issued', 1, 0, 1],
    ]
  );
  assert.equal(book.closing.qty, 1);
  assert.equal(book.closing.value, 47500, 'the returned mobile is off the balance');
  assert.deepEqual(book.totals, { issued: 2, returned: 1, maintenance: 0, maintenance_cost: 0 });
});

test('a transfer is only called a transfer where the other handover says so', async () => {
  const { ledgerTransactions } = await import('../../shared/assetLedger.js');
  const lines = [
    { asset_id: 11, code: 'A-1', label: 'Dell', value: 47500, issued_on: '2026-04-02', returned_on: '2026-09-01' },
    { asset_id: 12, code: 'A-2', label: 'Chair', value: 4200, issued_on: '2026-04-02', returned_on: '2026-09-01' },
  ];
  const others = [
    // Priya picked the laptop up the same day Amit gave it back.
    { asset_id: 11, employee_id: 9, employee_name: 'Priya Nair', issued_on: '2026-09-01', returned_on: null },
  ];
  const book = ledgerTransactions({ lines, others, today: '2026-11-19' });
  const laptop = book.rows.find((r) => r.code === 'A-1' && r.out);
  const chair = book.rows.find((r) => r.code === 'A-2' && r.out);
  assert.equal(laptop.type, 'Transferred out');
  assert.match(laptop.particulars, /Priya Nair/);
  assert.equal(chair.type, 'Asset returned', 'no evidence of a transfer, so it is not called one');
});

test('maintenance lines move no quantity, and only for the time it was with them', async () => {
  const { ledgerTransactions } = await import('../../shared/assetLedger.js');
  const lines = [{ asset_id: 11, code: 'A-1', label: 'Dell', value: 47500, issued_on: '2026-04-02', returned_on: '2026-09-01' }];
  const services = [
    { asset_id: 11, serviced_on: '2026-05-04', kind: 'Repair', work: 'keyboard', vendor: 'Shree', cost: 2400 },
    { asset_id: 11, serviced_on: '2026-01-10', kind: 'Service', cost: 900 },  // before they had it
    { asset_id: 11, serviced_on: '2026-10-02', kind: 'Service', cost: 700 },  // after they gave it back
  ];
  const book = ledgerTransactions({ lines, services, today: '2026-11-19' });
  const repairs = book.rows.filter((r) => r.type === 'Maintenance');
  assert.equal(repairs.length, 1, 'a repair from before they were given it is not theirs');
  assert.equal(repairs[0].value, 2400);
  assert.equal(repairs[0].in + repairs[0].out, 0, 'a repair is not a handover');
  assert.equal(book.totals.maintenance_cost, 2400);
  assert.equal(book.closing.qty, 0, 'and it did not move the balance');
});

test('a date window gives an opening balance rather than hiding what came before', async () => {
  const { ledgerTransactions } = await import('../../shared/assetLedger.js');
  const lines = [
    { asset_id: 11, code: 'A-1', label: 'Dell', value: 47500, issued_on: '2025-06-10', returned_on: '' },
    { asset_id: 12, code: 'A-2', label: 'Chair', value: 4200, issued_on: '2026-10-01', returned_on: '' },
  ];
  const book = ledgerTransactions({ lines, from: '2026-01-01', to: '2026-12-31' });
  assert.equal(book.opening.qty, 1, 'the laptop was already with them when the window opened');
  assert.equal(book.opening.value, 47500);
  assert.equal(book.rows.length, 1);
  assert.equal(book.closing.qty, 2);
});

test('the ledger, the API and the CSV all agree', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-book-'));
  process.env.APP_PASSWORD = 'the-key';
  process.env.SERVE_FRONTEND = 'false';
  const { createServer } = await import('../src/server.js');
  const server = createServer().listen(0);
  const at = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, url, body) => {
    const res = await fetch(`${at}${url}`, {
      method,
      headers: { authorization: 'Bearer the-key', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    // Its own company name: this file's servers share one database.
    const company = await api('POST', '/api/companies', { name: 'BNF LEDGER' });
    const amit = await api('POST', '/api/employees', {
      name: 'Ledger Person', company_id: company.body.id, monthly_salary: 20000, joined_on: '2024-01-01',
    });
    const laptop = await api('POST', '/api/people/assets', {
      company_id: company.body.id, kind: 'Laptop', label: 'Ledger laptop', purchase_cost: 47500,
    });
    await api('POST', `/api/people/assets/${laptop.body.id}/issue`, {
      employee_id: amit.body.id, issued_on: '2026-04-02',
    });
    await api('POST', `/api/people/assets/${laptop.body.id}/services`, {
      serviced_on: '2026-05-04', kind: 'Repair', work: 'keyboard', cost: 2400,
    });

    const got = await api('GET', `/api/people/assets/ledger/${amit.body.id}`);
    assert.equal(got.status, 200);
    const { ledger, neighbours } = got.body;
    assert.ok(ledger.book, 'the movement ledger rides along with the page');
    assert.equal(
      ledger.book.closing.qty,
      ledger.totals.out,
      'the running balance and the holding count have to agree, or the page argues with itself'
    );
    assert.equal(ledger.book.totals.maintenance_cost, 2400, 'the repair is on their ledger');
    assert.ok(Array.isArray(neighbours.all));

    const csv = await fetch(`${at}/api/people/assets/ledger/${amit.body.id}/transactions.csv`, {
      headers: { authorization: 'Bearer the-key' },
    });
    const text = await csv.text();
    assert.match(text, /Opening balance/);
    assert.match(text, /Closing balance/);
    assert.match(text, /keyboard/);
  } finally {
    server.close();
  }
});

test('a placeholder actor is not printed as if it were a person', async () => {
  const { ledgerTransactions } = await import('../../shared/assetLedger.js');
  const lines = [
    { asset_id: 11, code: 'A-1', label: 'Dell', value: 1000, issued_on: '2026-04-02', issued_by: 'nobody (open)', returned_on: '2026-05-02', returned_by: 'the API key' },
    { asset_id: 12, code: 'A-2', label: 'Chair', value: 500, issued_on: '2026-04-02', issued_by: 'Dinesh', returned_on: '' },
  ];
  const book = ledgerTransactions({ lines });
  const open = book.rows.find((r) => r.code === 'A-1' && r.in);
  const back = book.rows.find((r) => r.code === 'A-1' && r.out);
  assert.equal(open.particulars, 'Issued', '"Issued by nobody (open)" says nothing, at length');
  assert.equal(back.particulars, 'Returned');
  assert.equal(book.rows.find((r) => r.code === 'A-2').particulars, 'Issued by Dinesh', 'a real name still prints');
});
