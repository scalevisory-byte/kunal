/**
 * v2.36.0: one count for every asset screen.
 *
 * Dinesh's live register read "with staff 359" on one screen and 363 on the
 * other. The register counted anybody holding something whatever its state;
 * the dashboard counted status Assigned. These pin the single answer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assetCounts, assetOddities, onRegister } from '../../shared/assetStatus.js';
import { registerTotals } from '../../shared/assetReport.js';
import { assetDashboard } from '../../shared/assetDashboard.js';

const register = [
  { id: 1, code: 'A1', employee_id: 7, employee_name: 'Amit', purchase_cost: 50000 },            // assigned
  { id: 2, code: 'A2', employee_id: 7, employee_name: 'Amit', state: 'maintenance', purchase_cost: 40000 }, // held + repair
  { id: 3, code: 'A3', purchase_cost: 1000 },                                                     // available
  { id: 4, code: 'A4', state: 'maintenance', purchase_cost: 2000 },                               // repair, in office
  { id: 5, code: 'A5', employee_id: 8, employee_name: 'Riya', state: 'damaged', purchase_cost: 3000 }, // held + damaged
  { id: 6, code: 'A6', state: 'missing', purchase_cost: 0 },                                      // missing, no cost
  { id: 7, code: 'A7', state: 'disposed', purchase_cost: 9000 },                                  // disposed, not written off
  { id: 8, code: 'A8', written_off_on: '2026-01-01', employee_id: 9, employee_name: 'Kiran', purchase_cost: 7000 }, // gone, still in a name
];

test('every asset is in exactly one line, and the lines add up to the register', () => {
  const c = assetCounts(register);
  assert.deepEqual(c.by, { available: 1, assigned: 1, maintenance: 2, damaged: 1, missing: 1, written_off: 1, disposed: 1 });
  assert.equal(c.live, 6);
  assert.equal(c.gone, 2);
  assert.equal(c.live + c.gone, c.total);
  assert.equal(c.check, true);
  assert.equal(c.cost.live, 50000 + 40000 + 1000 + 2000 + 3000);
  assert.equal(c.cost.all, c.cost.live + 9000 + 7000);
});

test('"held" is its own figure, not "with staff" - the 359 / 363 mismatch', () => {
  const c = assetCounts(register);
  assert.equal(c.by.assigned, 1, 'with staff = issued and in use');
  assert.equal(c.held, 3, 'in somebody’s name, any state, still on the register');
});

test('the register and the dashboard now give the same figures', () => {
  const t = registerTotals(register.filter((a) => !a.written_off_on)); // the register's default load
  const d = assetDashboard({ assets: register, today: '2026-11-27' });
  const card = (k) => d.cards.find((x) => x.key === k).n;
  assert.equal(t.out, card('assigned'));
  assert.equal(t.in_office, card('available'));
  assert.equal(t.count, card('all'));
  assert.equal(t.maintenance, card('maintenance'));
  assert.equal(d.counts.check, true);
});

test('a disposed asset is off the register, not "in the office"', () => {
  assert.equal(onRegister({ state: 'disposed' }), false);
  assert.equal(registerTotals([{ state: 'disposed', purchase_cost: 9000 }]).in_office, 0);
  assert.equal(registerTotals([{ state: 'disposed', purchase_cost: 9000 }]).cost, 0);
});

test('records that pull two ways are named, and the list changes nothing', () => {
  const before = JSON.stringify(register);
  const groups = Object.fromEntries(assetOddities(register).map((g) => [g.key, g.rows.map((r) => r.code)]));
  assert.deepEqual(groups.held_with_state, ['A2', 'A5']);
  assert.deepEqual(groups.held_when_gone, ['A8']);
  assert.deepEqual(groups.disposed_not_written_off, ['A7']);
  assert.deepEqual(groups.no_cost, ['A6']);
  assert.equal(JSON.stringify(register), before, 'not one record touched');
});

test('the register chips are statuses, the same ones the dashboard cards hand over', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const assets = fs.readFileSync(path.join(here, '../../frontend/src/components/people/Assets.jsx'), 'utf8');
  assert.equal((assets.match(/filter === 'out' && assetStatus\(a\) !== 'assigned'/g) || []).length, 3);
  assert.equal((assets.match(/filter === 'office' && assetStatus\(a\) !== 'available'/g) || []).length, 3);
  assert.ok(!/filter === 'out' && !isOut\(a\)/.test(assets), 'the old "anybody holding it" chip is gone');
  assert.equal((assets.match(/filter !== 'gone' && !onRegister\(a\)/g) || []).length, 3);
});
