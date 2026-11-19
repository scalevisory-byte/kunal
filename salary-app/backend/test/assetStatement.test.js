/**
 * THE WHOLE REGISTER AS ONE STATEMENT — "total asset ka register".
 *
 * What these pin:
 *
 *  - **Written-off assets are apart from the total**, never folded in: a
 *    register that counted them would overstate what the business holds.
 *  - Every figure is **what it cost to buy** — there is no depreciation in
 *    this app, and the page says so.
 *  - Blocks add up to the grand total, so a printed page cannot disagree with
 *    its own footer.
 *  - **What is missing is counted, not hidden.**
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assetStatement, statementCsv } from '../../shared/assetStatement.js';

const REGISTER = [
  { id: 1, code: 'BPL-ASSETS-000001', kind: 'Laptop', label: 'Dell 3420', company_name: 'BOOKNFLY', purchase_cost: 47500, purchase_date: '2025-04-01', employee_id: 7, employee_name: 'Amit Shah' },
  { id: 2, code: 'BPL-ASSETS-000002', kind: 'Laptop', label: 'HP ProBook', company_name: 'BOOKNFLY', purchase_cost: 52000, purchase_date: '2025-06-01' },
  { id: 3, code: 'BPL-ASSETS-000003', kind: 'Chair', label: 'Godrej chair', company_name: 'BOOKNFLY', purchase_cost: 4200 },
  { id: 4, code: 'SCL-ASSETS-000001', kind: 'Printer', label: 'HP LaserJet', company_name: 'SCALE', purchase_cost: 12500, purchase_date: '2024-02-10' },
  { id: 5, kind: 'Fan', label: 'Orient ceiling fan', purchase_cost: 0 },                 // no code, no company, no cost
  { id: 6, code: 'BPL-ASSETS-000009', kind: 'Laptop', label: 'Old Lenovo', company_name: 'BOOKNFLY', purchase_cost: 38000, written_off_on: '2026-02-01', written_off_why: 'board failed' },
];

test('the written-off laptop is apart, not inside the total', () => {
  const st = assetStatement(REGISTER);
  assert.equal(st.totals.count, 5);
  assert.equal(st.totals.cost, 47500 + 52000 + 4200 + 12500 + 0);
  assert.equal(st.written_off.count, 1);
  assert.equal(st.written_off.cost, 38000);
  assert.ok(!st.blocks.some((b) => b.rows.some((r) => r.code === 'BPL-ASSETS-000009')));
});

test('the blocks add up to the footer', () => {
  const st = assetStatement(REGISTER);
  const summed = st.blocks.reduce((sum, b) => sum + b.cost, 0);
  const counted = st.blocks.reduce((sum, b) => sum + b.count, 0);
  assert.equal(summed, st.totals.cost);
  assert.equal(counted, st.totals.count);
  // ...and each block's groups add up to the block.
  for (const block of st.blocks) {
    assert.equal(block.groups.reduce((s, g) => s + g.cost, 0), block.cost, block.name);
    assert.equal(block.groups.reduce((s, g) => s + g.count, 0), block.count, block.name);
  }
});

test('an asset against no company is a block of its own, never dropped', () => {
  const st = assetStatement(REGISTER);
  const orphan = st.blocks.find((b) => b.name === 'Not against a company');
  assert.ok(orphan, 'the fan with no company vanished from the register');
  assert.equal(orphan.count, 1);
});

test('what is out with staff is counted, and the office is a place not a hole', () => {
  const st = assetStatement(REGISTER);
  assert.equal(st.totals.out, 1);
  assert.equal(st.totals.out_cost, 47500);
  assert.equal(st.totals.in_office, 4);
  const amit = st.blocks.flatMap((b) => b.rows).find((r) => r.code === 'BPL-ASSETS-000001');
  assert.equal(amit.holder, 'Amit Shah');
  assert.equal(amit.where, 'with staff');
  const chair = st.blocks.flatMap((b) => b.rows).find((r) => r.code === 'BPL-ASSETS-000003');
  assert.equal(chair.where, 'in the office');
  assert.equal(chair.holder, '');
});

test('what is missing is counted at the foot, not hidden', () => {
  const st = assetStatement(REGISTER);
  assert.equal(st.missing.no_cost, 1);
  assert.equal(st.missing.no_code, 1);
  assert.equal(st.missing.no_company, 1);
  assert.equal(st.missing.no_purchase_date, 2, 'the chair and the fan');
});

test('it can be blocked by group instead of by company', () => {
  const st = assetStatement(REGISTER, { by: 'group' });
  assert.equal(st.by, 'group');
  const computer = st.blocks.find((b) => b.name === 'Computer');
  assert.ok(computer, 'Laptops and the printer belong to Computer');
  assert.equal(computer.cost, 47500 + 52000 + 12500);
  // Same grand total, whichever way it is blocked.
  assert.equal(st.totals.cost, assetStatement(REGISTER).totals.cost);
});

test('the CSV carries the subtotals and says the written-off are outside the total', () => {
  const csv = statementCsv(assetStatement(REGISTER));
  assert.match(csv, /^﻿Company,Group,Code/);
  assert.match(csv, /BOOKNFLY — 3 assets/);
  assert.match(csv, /TOTAL — 5 assets/);
  assert.match(csv, /not in the total above/);
});

/* ---------------- staff-wise ---------------- */

test('by person: one block per holder, and what nobody holds is the office', () => {
  const st = assetStatement(REGISTER, { by: 'person' });
  const names = st.blocks.map((b) => b.name);
  assert.ok(names.includes('Amit Shah'));
  assert.ok(names.includes('In the office'));
  // The office is a place, not a person, so it sits at the foot of the list
  // however much it holds - here three assets against Amit Shah's one.
  assert.equal(names[names.length - 1], 'In the office');
  const office = st.blocks.find((b) => b.name === 'In the office');
  assert.equal(office.count, 4);
  assert.equal(office.out, 0);
  const amit = st.blocks.find((b) => b.name === 'Amit Shah');
  assert.equal(amit.count, 1);
  assert.equal(amit.out, 1);
  assert.equal(amit.cost, 47500);
});

test('by person: the written-off one is still apart, and the blocks still add up', () => {
  const st = assetStatement(REGISTER, { by: 'person' });
  assert.equal(
    st.blocks.reduce((sum, b) => sum + b.count, 0),
    st.totals.count
  );
  assert.equal(
    st.blocks.reduce((sum, b) => sum + b.cost, 0),
    st.totals.cost
  );
  assert.equal(st.written_off.count, 1);
});

test('an unknown way of blocking it falls back to company rather than breaking', () => {
  const st = assetStatement(REGISTER, { by: 'colour' });
  assert.equal(st.by, 'company');
  assert.ok(st.blocks.some((b) => b.name === 'BOOKNFLY'));
});

test('a staff-wise block carries the id, so the name on it can open that ledger', () => {
  const st = assetStatement(REGISTER, { by: 'person' });
  const amit = st.blocks.find((b) => b.name === 'Amit Shah');
  assert.equal(amit.employee_id, 7);
  // The office is a place, not a person: there is no ledger to open.
  assert.equal(st.blocks.find((b) => b.name === 'In the office').employee_id, null);
  // And the row carries it too, for a register listing every asset.
  assert.equal(amit.rows[0].employee_id, 7);
});
