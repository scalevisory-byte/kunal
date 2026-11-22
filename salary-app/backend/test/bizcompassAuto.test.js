/**
 * The scheduled read of the punch spool.
 *
 * Nobody is watching when this runs, so what it must NOT do matters more than
 * what it does: it never opens a month, never writes into a locked one, never
 * overrules a mark somebody decided, and never throws.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-auto-'));
const SPOOL = fs.mkdtempSync(path.join(os.tmpdir(), 'autospool-'));
process.env.DATA_DIR = DATA;
process.env.APP_PASSWORD = 'the-key';
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
process.env.BIZCOMPASS_DIR = SPOOL;

const { createServer } = await import('../src/server.js');
const biz = await import('../src/bizcompass.js');
const db = await import('../src/db.js');

const server = createServer().listen(0);
test.after(() => {
  biz.stopAutoSync();
  server.close();
});

const G = '17c5b74f-8de9-4840-b565-9fcc32280df3';
const batch = (name, lines) =>
  fs.writeFileSync(path.join(SPOOL, name), lines.map((l) => `${l}\t255\t${G}\t0`).join('\n'));

const NOW = new Date(2026, 10, 20, 19, 0, 0); // 20 Nov 2026
let period;
let amit;

test('a month, a person with a punch ID, and a spool', () => {
  const company = db.createCompany({ name: 'BNF' });
  amit = db.createEmployee({
    name: 'AMIT SHAH', code: 'BNF-EMP-0001', device_code: '37',
    company_id: company.id, monthly_salary: 26000, joined_on: '2024-01-01',
  });
  period = db.createPeriod({ month: 11, year: 2026 });
  batch('LogFile_11_20_09_15_00_000.dat', ['37\t20-11-2026 09:14:00']);
  batch('LogFile_11_20_18_25_00_000.dat', ['37\t20-11-2026 18:12:00']);
});

test('off unless the office asks for it', () => {
  delete process.env.BIZCOMPASS_AUTO_MINUTES;
  assert.equal(biz.autoMinutes(), 0);
  assert.equal(biz.startAutoSync(), null, 'it must not start a timer by itself');
});

test('a silly interval is floored, because the tool only writes every ten minutes', () => {
  process.env.BIZCOMPASS_AUTO_MINUTES = '1';
  assert.equal(biz.autoMinutes(), 5);
  process.env.BIZCOMPASS_AUTO_MINUTES = '60';
  assert.equal(biz.autoMinutes(), 60);
  process.env.BIZCOMPASS_AUTO_MINUTES = 'rubbish';
  assert.equal(biz.autoMinutes(), 0);
  delete process.env.BIZCOMPASS_AUTO_MINUTES;
});

test('it writes the open month and says what it did', () => {
  const run = biz.autoSyncOnce(NOW);
  assert.equal(run.ok, true, JSON.stringify(run));
  assert.equal(run.written, 1);
  assert.equal(run.people, 1);

  const stored = db.listAttendance(period.id).find((r) => r.employee_id === amit.id && r.day === 20);
  assert.equal(stored.code, 'P');
  assert.equal(stored.in_time, '09:14');
  assert.equal(stored.out_time, '18:12');
});

test('IT NEVER OVERRULES A MARK SOMEBODY DECIDED', () => {
  // Somebody on casual leave who came in for ten minutes keeps their CL, and
  // the hours still land on the day.
  db.setAttendance(period.id, [{ employee_id: amit.id, day: 20, code: 'CL' }]);
  const run = biz.autoSyncOnce(NOW);
  assert.equal(run.ok, true);
  assert.ok(run.keptMarks >= 1, 'it should say it left a mark alone');

  const stored = db.listAttendance(period.id).find((r) => r.employee_id === amit.id && r.day === 20);
  assert.equal(stored.code, 'CL', 'the leave was overwritten');
  assert.equal(stored.in_time, '09:14', 'the hours should still land');
});

test('IT NEVER OPENS A MONTH', () => {
  // December is not open. A scheduled job has no business deciding that a
  // month exists - that is somebody's decision, not a timer's.
  const run = biz.autoSyncOnce(new Date(2026, 11, 3, 19, 0, 0));
  assert.equal(run.ok, false);
  assert.match(run.why, /not open/);
  assert.ok(!db.listPeriods().some((p) => p.month === 12 && p.year === 2026));
});

test('IT NEVER WRITES INTO A LOCKED MONTH', () => {
  db.updatePeriod(period.id, { locked: 1 });
  const run = biz.autoSyncOnce(NOW);
  assert.equal(run.ok, false);
  assert.match(run.why, /locked/i);
  db.updatePeriod(period.id, { locked: 0 });
});

test('with no folder set it says so rather than throwing', () => {
  const was = process.env.BIZCOMPASS_DIR;
  delete process.env.BIZCOMPASS_DIR;
  const run = biz.autoSyncOnce(NOW);
  assert.equal(run.ok, false);
  assert.match(run.why, /no folder/i);
  process.env.BIZCOMPASS_DIR = was;
});

test('the last run is readable, so the screen can say when it last ran', () => {
  biz.autoSyncOnce(NOW);
  const last = biz.lastAutoRun();
  assert.ok(last.at);
  assert.equal(typeof last.ok, 'boolean');
});
