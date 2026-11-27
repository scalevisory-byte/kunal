/**
 * Leave without approval costs double - automatically.
 *
 * Dinesh, having seen the priced tool: "double deduction automatic kar do".
 * These tests are mostly about what an automatic rule must NOT do, because
 * nobody is watching it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { calculateRow } from '../../shared/calc.js';
import { autoDoubles, doubleStanding, unapprovedLeave, wasAutoDoubled } from '../../shared/unapprovedLeave.js';
import { todayIso } from '../../shared/today.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-double-'));
process.env.APP_PASSWORD = 'the-key';
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
const { createServer } = await import('../src/server.js');
const store = await import('../src/db.js');
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
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

/* A month wholly in the past, so "has this day happened" never depends on
   the day the suite is run. */
const YEAR = 2026;
const MONTH = 9;
let period;
let company;
const people = {};
const mark = (entries) => api('POST', `/api/periods/${period.id}/attendance`, { entries });
const month = async () => (await api('GET', `/api/periods/${period.id}/payroll`)).body;
const dayOf = async (name, day) => (await month()).rows.find((r) => r.employee_id === people[name].id).attendance[day];
const working = (id, days) => days.map((day) => ({ employee_id: id, day, code: 'P' }));

test('the rule in words: a plain absence unless approved; unpaid leave only when refused', () => {
  assert.equal(doubleStanding({ code: 'A' }), 'undecided');
  assert.equal(doubleStanding({ code: 'A', approved: false }), 'refused');
  assert.equal(doubleStanding({ code: 'A', approved: true }), 'approved');
  assert.equal(doubleStanding({ code: 'UL', approved: false }), 'refused');
  assert.equal(doubleStanding({ code: 'UL' }), null, 'the office’s own unpaid leave, and what the sandwich tool writes');
  assert.equal(doubleStanding({ code: 'CL', approved: false }), null);
  assert.equal(doubleStanding({ code: 'HF', approved: false }), null);
  assert.deepEqual(
    [{ code: 'A' }, { code: 'A', approved: 0 }, { code: 'A', approved: 1 }, { code: 'UL' }, { code: 'UL', approved: 0 }].map(autoDoubles),
    [true, true, false, false, true]
  );
  assert.equal(wasAutoDoubled({ code: 'AD', doubled_from: 'A' }), true);
  assert.equal(wasAutoDoubled({ code: 'AD' }), false, 'typed by hand is not the rule’s');
  // The priced tool leaves an undecided UL alone as well.
  const tool = unapprovedLeave([{ employee_id: 1, salary: 26000, attendance: { 3: { code: 'UL' }, 4: { code: 'A' } } }], { year: YEAR, month: MONTH }, { countUndecided: true });
  assert.deepEqual(tool.people[0].days.map((d) => d.day), [4]);
});

test('a database with nothing in it starts with the rule OFF, and an absence stays single', async () => {
  assert.equal(store.autoDoubleRule().on, false);
  company = (await api('POST', '/api/companies', { name: 'BNF' })).body;
  for (const name of ['Riya Pal', 'Amit Shah', 'Never Enrolled', 'Gone Early']) {
    people[name] = (await api('POST', '/api/employees', { name, company_id: company.id, monthly_salary: 26000, joined_on: '2026-01-01' })).body;
  }
  period = (await api('POST', '/api/periods', { month: MONTH, year: YEAR })).body;
  await api('PATCH', `/api/periods/${period.id}`, { late_policy: 'none' });
  await mark([...working(people['Riya Pal'].id, [1, 2, 3]), ...working(people['Amit Shah'].id, [1, 2, 3]), ...working(people['Gone Early'].id, [1, 2, 3])]);
  await mark([{ employee_id: people['Riya Pal'].id, day: 4, code: 'A' }]);
  assert.equal((await dayOf('Riya Pal', 4)).code, 'A');
});

test('an install that is already running gets it ON from the day of the update - and nothing earlier is touched', async () => {
  // What the update does on a live server: there are months, and no setting yet.
  store.db.prepare(`DELETE FROM settings WHERE key = ?`).run(store.AUTO_DOUBLE_KEY);
  const rule = store.ensureAutoDoubleRule({ today: '2026-09-10' });
  assert.deepEqual([rule.on, rule.from], [true, '2026-09-10']);
  // Asked a second time, it does not move the date.
  assert.equal(store.ensureAutoDoubleRule({ today: '2026-09-20' }).from, '2026-09-10');

  // Riya's absence on the 4th is BEFORE the rule began: still single.
  await month();
  assert.equal((await dayOf('Riya Pal', 4)).code, 'A', 'a rule does not reach back');

  // One on the 14th, with nobody deciding anything: doubled on the write.
  await mark([{ employee_id: people['Riya Pal'].id, day: 14, code: 'A', reason: 'did not come' }]);
  const day = await dayOf('Riya Pal', 14);
  assert.equal(day.code, 'AD');
  assert.equal(day.doubled_from, 'A');
  assert.equal(day.reason, 'did not come', 'the reason is kept');

  // Priced by the payslip's own function: one absence at one day, one at two.
  const row = (await month()).rows.find((r) => r.employee_id === people['Riya Pal'].id);
  assert.equal(calculateRow(row, (await month()).period, row.attendance).absent_days, 3);
});

test('an approval puts it back to single, and taking the approval away doubles it again', async () => {
  const id = people['Riya Pal'].id;
  await mark([{ employee_id: id, day: 14, approved: true }]);
  let day = await dayOf('Riya Pal', 14);
  assert.equal(day.code, 'A', 'proof accepted: one day');
  assert.equal(day.doubled_from, undefined);
  assert.equal(day.approved, true);

  await mark([{ employee_id: id, day: 14, approved: false }]);
  day = await dayOf('Riya Pal', 14);
  assert.equal(day.code, 'AD');

  // Back to approved for the tests below.
  await mark([{ employee_id: id, day: 14, approved: true }]);
  assert.equal((await dayOf('Riya Pal', 14)).code, 'A');
});

test('what it will not double: leave, unpaid leave nobody refused, a hand-typed mark, somebody gone', async () => {
  const amit = people['Amit Shah'].id;
  await mark([
    { employee_id: amit, day: 15, code: 'CL' },
    { employee_id: amit, day: 16, code: 'UL' },
    { employee_id: amit, day: 17, code: 'HF' },
    { employee_id: amit, day: 18, code: 'UL', approved: false },
  ]);
  assert.equal((await dayOf('Amit Shah', 15)).code, 'CL');
  assert.equal((await dayOf('Amit Shah', 16)).code, 'UL', 'the office recorded it as unpaid leave');
  assert.equal((await dayOf('Amit Shah', 17)).code, 'HF');
  assert.equal((await dayOf('Amit Shah', 18)).code, 'AD', 'unpaid leave somebody REFUSED');
  assert.equal((await dayOf('Amit Shah', 18)).doubled_from, 'UL');
  await mark([{ employee_id: amit, day: 18, approved: true }]);
  assert.equal((await dayOf('Amit Shah', 18)).code, 'UL', 'and it goes back to what it was, not to A');

  // Somebody who left on the 12th: an absence after that is not leave taken.
  await api('PATCH', `/api/employees/${people['Gone Early'].id}`, { active: 0, left_on: '2026-09-12' });
  await mark([
    { employee_id: people['Gone Early'].id, day: 11, code: 'A' },
    { employee_id: people['Gone Early'].id, day: 20, code: 'A' },
  ]);
  assert.equal((await dayOf('Gone Early', 11)).code, 'AD');
  assert.equal((await dayOf('Gone Early', 20)).code, 'A');
});

test('SOMEBODY THE MACHINE NEVER SAW IS HELD AND NAMED, NOT DOUBLED', async () => {
  // What a machine report does to a person it has never enrolled.
  const id = people['Never Enrolled'].id;
  await mark([10, 11, 14, 15, 16].map((day) => ({ employee_id: id, day, code: 'A' })));
  for (const day of [10, 11, 14, 15, 16]) assert.equal((await dayOf('Never Enrolled', day)).code, 'A');
  const status = (await api('GET', `/api/leave/auto-double?period_id=${period.id}`)).body;
  assert.deepEqual(status.held.map((h) => [h.employee_name, h.days]), [['Never Enrolled', [10, 11, 14, 15, 16]]]);
  // The day they are seen at work, the rule has something to stand on.
  await mark([{ employee_id: id, day: 17, code: 'P' }]);
  assert.equal((await dayOf('Never Enrolled', 14)).code, 'AD');
  assert.equal((await dayOf('Never Enrolled', 10)).code, 'AD');
});

test('a day that has not happened yet is left alone until it has', async () => {
  const id = people['Amit Shah'].id;
  await mark([{ employee_id: id, day: 25, code: 'A' }]);
  assert.equal((await dayOf('Amit Shah', 25)).code, 'AD', 'September is over: it has happened');
  // The same sweep, asked as though it were still the 20th, would have waited.
  await mark([{ employee_id: id, day: 25, approved: true }]);
  store.db.prepare(`UPDATE attendance SET approved = NULL WHERE period_id = ? AND employee_id = ? AND day = 25`).run(period.id, id);
  assert.equal(store.applyAutoDouble(period.id, { today: '2026-09-20' }).doubled, 0);
  assert.equal(store.applyAutoDouble(period.id, { today: '2026-09-25' }).doubled, 1);
});

test('it never writes into a locked month, and a read with sync:false writes nothing', async () => {
  const id = people['Riya Pal'].id;
  // A stray single absence put straight into the table, as an old month would hold one.
  store.db.prepare(`UPDATE attendance SET approved = NULL WHERE period_id = ? AND employee_id = ? AND day = 14`).run(period.id, id);
  await api('GET', `/api/periods/${period.id}/payroll?sync=false`);
  assert.equal(store.db.prepare(`SELECT code FROM attendance WHERE period_id = ? AND employee_id = ? AND day = 14`).get(period.id, id).code, 'A');
  store.db.prepare(`UPDATE periods SET locked = 1 WHERE id = ?`).run(period.id);
  assert.deepEqual(store.applyAutoDouble(period.id), { doubled: 0, restored: 0, held: [] });
  store.db.prepare(`UPDATE periods SET locked = 0 WHERE id = ?`).run(period.id);
  // An ordinary read of the open month settles it.
  await month();
  assert.equal((await dayOf('Riya Pal', 14)).code, 'AD');
});

test('switching it: off stops NEW doubling, an approval still restores, and on always carries a date', async () => {
  const off = await api('PUT', '/api/leave/auto-double', { on: false, period_id: period.id });
  assert.equal(off.body.rule.on, false);
  const id = people['Amit Shah'].id;
  await mark([{ employee_id: id, day: 26, code: 'A' }]);
  assert.equal((await dayOf('Amit Shah', 26)).code, 'A', 'off means off');
  // What it had already doubled is not undone by switching off...
  assert.equal((await dayOf('Riya Pal', 14)).code, 'AD');
  // ...but approving one still puts it back.
  await mark([{ employee_id: people['Riya Pal'].id, day: 14, approved: true }]);
  assert.equal((await dayOf('Riya Pal', 14)).code, 'A');

  // On again, from a named date: it covers the 26th, and not Riya's 4th.
  const on = await api('PUT', '/api/leave/auto-double', { on: true, from: '2026-09-21', period_id: period.id });
  assert.deepEqual([on.body.rule.on, on.body.rule.from], [true, '2026-09-21']);
  assert.equal(on.body.did.doubled, 1);
  assert.equal((await dayOf('Amit Shah', 26)).code, 'AD');
  assert.equal((await dayOf('Riya Pal', 4)).code, 'A');
  // On with no date falls to today, never to "always".
  const dated = await api('PUT', '/api/leave/auto-double', { on: true });
  assert.equal(dated.body.rule.from, todayIso());
});

test('the office changing a doubled day to something else is the office’s decision', async () => {
  await api('PUT', '/api/leave/auto-double', { on: true, from: '2026-09-01', period_id: period.id });
  const id = people['Amit Shah'].id;
  assert.equal((await dayOf('Amit Shah', 26)).code, 'AD');
  await mark([{ employee_id: id, day: 26, code: 'P' }]);
  const day = await dayOf('Amit Shah', 26);
  assert.equal(day.code, 'P', 'they were in after all');
  assert.equal(day.doubled_from, undefined, 'and the memory of the old mark goes with it');
  // An AD somebody typed by hand is never "restored" by an approval.
  await mark([{ employee_id: id, day: 27, code: 'AD', approved: true }]);
  assert.equal((await dayOf('Amit Shah', 27)).code, 'AD');
});

test('a staff login cannot read or switch the rule, and the audit trail names the rule', async () => {
  const lines = store.db.prepare(`SELECT who, to_value FROM audit_log WHERE who = 'the double-deduction rule'`).all();
  assert.ok(lines.some((l) => /AD \(not approved, so double\)/.test(l.to_value)));
  assert.ok(lines.some((l) => /approved, so single/.test(l.to_value)));
  const none = await fetch(`${base}/api/leave/auto-double`);
  assert.equal(none.status, 401);
});

test('the sandwich finder still sees an absence the rule doubled', async () => {
  const { DEFAULT_TRIGGERS } = await import('../../shared/sandwich.js');
  assert.ok(DEFAULT_TRIGGERS.includes('AD'), 'or switching the rule on would quietly switch that tool off');
});

test('the day menu can be scrolled to the tick that undoes a double', () => {
  /*
   * Found by driving it at 1440x1000: the card is ~1,500px tall on a fixed
   * backdrop and had no scroll of its own, so the Allowed button was below
   * the bottom of the screen and nothing could reach it.
   */
  const css = fs.readFileSync(new URL('../../frontend/src/styles.css', import.meta.url), 'utf8');
  const rule = css.match(/^\.picker \{[^}]*\}/m)?.[0] || '';
  assert.match(rule, /max-height: calc\(100vh - 2rem\)/);
  assert.match(rule, /overflow-y: auto/);
  const menu = fs.readFileSync(new URL('../../frontend/src/components/Attendance.jsx', import.meta.url), 'utf8');
  assert.match(menu, /entry\.doubled_from \?/, 'a doubled day says so, where the tick is');
  const panel = fs.readFileSync(new URL('../../frontend/src/components/UnapprovedLeave.jsx', import.meta.url), 'utf8');
  assert.ok(!/calculateRow/.test(panel), 'the screen prices nothing itself');
  for (const cls of ['auto-double', 'auto-double-earlier']) assert.ok(css.includes(`.${cls}`), `${cls} has a rule`);
});
