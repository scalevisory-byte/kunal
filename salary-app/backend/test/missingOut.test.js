/**
 * A day with an arrival and no departure is a half day, automatically.
 *
 * Dinesh (v2.34.0): *"agar punch missing he to half day lag jaye automatic"*,
 * and *"agar uske bad manually change karna he to kar denge"*. So the rule is
 * on, and every choice a person makes about one of these days must stick.
 *
 * What these hold:
 *   - a finished day with no departure is HF, and the rule is named on it;
 *   - a day that has not finished yet is never HF (nothing is judged early);
 *   - a mark a person set, or a mark from before the rule, is never overwritten;
 *   - a typed departure puts the rule's half day back to what the hours say;
 *   - switching the rule off gives P again, and nothing already written moves.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PUNCH_MAPPING, parseLogText, punchRows } from '../../shared/bizcompassLogs.js';
import { punchesToMarks } from '../../shared/punches.js';
import { MISSING_OUT_CODE, missingOutRule, wroteByRule } from '../../shared/missingOut.js';

/* ------------------------- the rule, on its own ------------------------- */

const staff = [{ id: 1, name: 'AJEETKUMAR UPDHYAY', code: 'E48', device_code: '48', active: 1 }];
const day = (ddmmyyyy, time) => `48\t${ddmmyyyy} ${time}\t255\tG1\t0`;
const marks = (raw, { on, now }) => {
  const { punches } = parseLogText(raw);
  const { rows } = punchRows(punches, staff);
  return punchesToMarks({
    rows,
    mapping: PUNCH_MAPPING,
    employees: staff,
    period: { month: 11, year: 2026, hours_per_day: 9 },
    missingOutHalfDay: on,
    now,
  });
};
const PAST = new Date('2026-12-05T10:00:00+05:30');
const SAME_DAY_MORNING = new Date('2026-11-27T11:00:00+05:30');

test('a finished day with an arrival and no departure is a half day, and is named as the rule', () => {
  const result = marks(day('27-11-2026', '10:29:00'), { on: true, now: PAST });
  const [entry] = result.entries;
  assert.equal(entry.code, MISSING_OUT_CODE);
  assert.equal(entry.missing_out, 1, 'the day remembers the rule wrote it');
  assert.equal(entry.minutes, 0, 'a half day is paid at half - no shortfall on top');
  assert.equal(entry.out_time, '', 'nothing invents a departure');
  assert.equal(result.summary.missingOut, 1);
});

test('switched off, the same day is present as it always was', () => {
  const [entry] = marks(day('27-11-2026', '10:29:00'), { on: false, now: PAST }).entries;
  assert.equal(entry.code, 'P');
  assert.equal(entry.missing_out, null, 'an ordinary punch is not the rule’s');
});

test('a day that has not finished yet is never a half day, however long ago the arrival was', () => {
  // Arrived 10:29 on the 27th, it is 11:00 that morning: the day is still on.
  const [entry] = marks(day('27-11-2026', '10:29:00'), { on: true, now: SAME_DAY_MORNING }).entries;
  assert.equal(entry.code, 'P');
  assert.equal(entry.missing_out, null);
});

test('a complete day is never touched by the rule', () => {
  const raw = [day('27-11-2026', '10:29:00'), day('27-11-2026', '19:02:00')].join('\n');
  const [entry] = marks(raw, { on: true, now: PAST }).entries;
  assert.notEqual(entry.code, MISSING_OUT_CODE);
  assert.equal(entry.missing_out, null);
});

test('the rule is on when nothing has ever been stored, and off only when someone says so', () => {
  assert.equal(missingOutRule(null).on, true, 'what was asked for, from the start');
  assert.equal(missingOutRule({ on: false, by: 'Dinesh' }).on, false);
  assert.equal(missingOutRule({ on: true }).on, true);
  // A value that is not a clear yes is not a yes: a corrupt setting reads as off.
  assert.equal(missingOutRule('yes please').on, false);
});

test('only a mark the rule wrote is the rule’s to take back', () => {
  assert.equal(wroteByRule({ missing_out: 1 }), true);
  assert.equal(wroteByRule({ missing_out: 0 }), false, 'a person decided this one');
  assert.equal(wroteByRule({ missing_out: null }), false, 'written before the rule existed');
  assert.equal(wroteByRule(undefined), false);
});

/* ------------------------- through the database ------------------------- */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'missing-out-'));
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
delete process.env.APP_PASSWORD;

const db = await import('../src/db.js');
const { applyPunches } = await import('../src/punchApply.js');

const company = db.createCompany({ name: 'BOOKNFLY' });
const ajeet = db.createEmployee({
  company_id: company.id,
  name: 'AJEETKUMAR UPDHYAY',
  code: 'BNF-EMP-0048',
  device_code: '48',
  monthly_salary: 26000,
  joined_on: '2024-01-01',
});
const period = db.createPeriod({ year: 2026, month: 11 });
const cell = (d) =>
  db.listAttendance(period.id).find((r) => r.employee_id === ajeet.id && r.day === d) || null;
const importOf = (raw, opts = {}) => {
  const { punches } = parseLogText(raw);
  return applyPunches(db.getPeriod(period.id), punches, { dryRun: false, ...opts });
};

test('the import writes HF with the rule’s flag, and the grid reads it back', () => {
  // A past day: 3 November is well behind "today", whatever the clock says.
  importOf(day('03-11-2026', '09:40:00'));
  const row = cell(3);
  assert.equal(row.code, 'HF');
  assert.equal(row.missing_out, 1);
  assert.equal(row.out_time, null, 'no departure was invented');
});

test('a mark a person set by hand is never overwritten by the rule', () => {
  // Somebody put P on the 4th by hand (a correction, a reason, anything).
  db.setAttendance(period.id, [{ employee_id: ajeet.id, day: 4, code: 'P', by: 'Dinesh' }]);
  assert.equal(cell(4).missing_out, 0, 'a named mark is a decision');
  const out = importOf(day('04-11-2026', '09:40:00'));
  assert.equal(cell(4).code, 'P', 'the person’s P stands');
  assert.equal(out.missingOutKept, 1, 'and the import says it held one back');
});

test('a mark from before the rule existed is not rewritten either', () => {
  // A row written with no flag at all, the way every existing day is.
  db.setAttendance(period.id, [{ employee_id: ajeet.id, day: 5, code: 'P', missing_out: null }]);
  importOf(day('05-11-2026', '09:40:00'));
  assert.equal(cell(5).code, 'P', 'paid on P last month - nothing rewrites it on its own');
});

test('a typed departure puts the rule’s half day back to what the hours say', () => {
  assert.equal(cell(3).code, 'HF');
  db.setAttendance(period.id, [
    { employee_id: ajeet.id, day: 3, in_time: '09:40', out_time: '19:10' },
  ]);
  const row = cell(3);
  assert.equal(row.code, 'P', 'the day is a full day now');
  assert.equal(row.missing_out, null, 'and nothing says the rule did it');
  assert.ok(row.minutes > 0, 'worked out again from the times, not kept from the half day');
});

test('switching the rule off stops it from the next import, and writes nothing back', () => {
  db.setMissingOutSetting({ on: false }, 'Dinesh');
  assert.equal(db.missingOutSetting().on, false);
  importOf(day('06-11-2026', '09:40:00'));
  assert.equal(cell(6).code, 'P', 'an ordinary present day');
  assert.equal(cell(3).code, 'P', 'the day it already wrote is not touched by switching off');
  db.setMissingOutSetting({ on: true }, 'Dinesh');
});

test('a human correction clears the rule’s flag, so a later import cannot take it back', () => {
  importOf(day('07-11-2026', '09:40:00'));
  assert.equal(cell(7).code, 'HF');
  // Dinesh changes it to Absent on the grid.
  db.setAttendance(period.id, [{ employee_id: ajeet.id, day: 7, code: 'A', by: 'Dinesh' }]);
  assert.equal(cell(7).missing_out, 0);
  importOf(day('07-11-2026', '09:41:00'));
  assert.equal(cell(7).code, 'A', 'the decision outlives the next pull');
});
