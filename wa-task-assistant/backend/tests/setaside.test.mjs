/**
 * Work that is captured but is not the day's work.
 *
 * Vacancies land on a recruitment desk dozens a week. Each is a real thing, but
 * none of it belongs beside "Pay TDS today": mixed in, it buries everything
 * else, and thrown away it is lost. So a group can be set aside — kept, grouped,
 * and out of every view and every mechanism that answers "what do I owe".
 *
 * The tests that matter are the negative ones. "Not a task" has to mean the
 * reminder engine will not touch it, or it is just a label.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-aside-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const DB = await import('../src/db.js');
const G = await import('../src/groups.js');
const L = await import('../src/task-lifecycle.js');
const S = await import('../src/scheduling.js');
const { unshout } = await import('../src/titlecase.js');

let passed = 0;
let failed = 0;
const run = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
};

const today = new Date().toISOString().slice(0, 10);
const vacancies = G.createGroup({ name: 'Vacancies', keywords: ['vacancy', 'candidate'], separate: true });
const bnf = G.createGroup({ name: 'BNF' });

const task = (title, extra = {}) =>
  DB.createTask({ title, status: 'open', source: 'manual', due_date: today, ...extra });

const vacancy = task('Source driver candidates for Vesu route', { group_id: vacancies.id });
const real = task('Pay BNF TDS', { group_id: bnf.id });
const loose = task('Call the auditor');

console.log('\nsetting a group aside');

run('the flag is stored and comes back as a boolean', () => {
  assert.equal(G.getGroup(vacancies.id).separate, true);
  assert.equal(G.getGroup(bnf.id).separate, false);
});

run('an ordinary group is unaffected by the column existing', () => {
  assert.equal(G.getGroup(bnf.id).separate, false);
  assert.ok(DB.listTasks({ status: 'pending' }).some((t) => t.id === real.id));
});

run('it can be turned on and off again', () => {
  G.updateGroup(bnf.id, { separate: true });
  assert.equal(G.getGroup(bnf.id).separate, true);
  assert.ok(!DB.listTasks({ status: 'pending' }).some((t) => t.id === real.id), 'gone at once');
  G.updateGroup(bnf.id, { separate: false });
  assert.ok(DB.listTasks({ status: 'pending' }).some((t) => t.id === real.id), 'and back');
});

console.log('\nit stays out of the day\'s work');

run('the main list does not carry it', () => {
  const ids = DB.listTasks({ status: 'pending' }).map((t) => t.id);
  assert.ok(!ids.includes(vacancy.id));
  assert.ok(ids.includes(real.id) && ids.includes(loose.id), 'everything else is still there');
});

run("the group's own page still does", () => {
  const ids = DB.listTasks({ status: 'pending', includeSetAside: true }).map((t) => t.id);
  assert.ok(ids.includes(vacancy.id), 'asking for it by name is the way to see it');
});

run('the figures on the dashboard leave it out', () => {
  const stats = DB.taskStats();
  const all = DB.listTasks({ status: 'pending', includeSetAside: true }).length;
  assert.ok(stats.open < all, 'the count is of work owed, not of rows');
});

run('the twice-daily digest never mentions it', () => {
  assert.ok(!DB.pendingReminders(today).some((t) => t.id === vacancy.id));
});

run('an exact-time reminder is never queued for it', () => {
  const at = new Date(Date.now() - 60_000).toISOString();
  DB.updateTask(vacancy.id, { remind_at: at });
  DB.updateTask(real.id, { remind_at: at });
  const due = DB.dueExactReminders(new Date().toISOString()).map((t) => t.id);
  assert.ok(!due.includes(vacancy.id));
  assert.ok(due.includes(real.id), 'and real work still is');
});

console.log('\nthe engine does not chase it');

run('no ladder is built for it', () => {
  /*
   * The test that makes "not a task" mean something. A label that still
   * produced reminders would be no different from a colour.
   */
  const walked = L.tasksWithDeadlines().map((t) => t.id);
  assert.ok(!walked.includes(vacancy.id));
  assert.ok(walked.includes(real.id));
});

run('it cannot be flagged as needing attention', () => {
  DB.updateTask(vacancy.id, { needs_attention: 1 });
  DB.updateTask(real.id, { needs_attention: 1 });
  const flagged = S.engineOverview().attention.map((t) => t.id);
  assert.ok(!flagged.includes(vacancy.id));
  assert.ok(flagged.includes(real.id));
});

console.log('\nthe list is ordered by arrival when asked');

run('recent puts the newest first', () => {
  const newest = task('Just came in');
  const rows = DB.listTasks({ status: 'all', order: 'recent', includeSetAside: true });
  assert.equal(rows[0].id, newest.id);
});

console.log('\na shouted title is made readable');

run('all caps becomes a line you can read', () => {
  assert.equal(unshout('ADV IDMC AUDIT QUERY REVIW'), 'ADV IDMC Audit Query Reviw');
  assert.equal(unshout('PAY BNF TDS TODAY'), 'Pay BNF TDS Today');
});

run('acronyms and codes are left exactly as they are', () => {
  assert.equal(unshout('SEND GSTR-3B TO MEERA'), 'Send GSTR-3B to Meera');
  assert.match(unshout('FILE ITR BEFORE AY 2026-27'), /ITR .* AY 2026-27/);
});

run("a person's name is never lowercased", () => {
  /*
   * The reason this capitalises rather than using sentence case. No rule here
   * can tell a name from an ordinary word, and "send invoice to meera" is worse
   * than the shouting was — he stops recognising the task as his own.
   */
  assert.match(unshout('SEND INVOICE TO MEERA'), /Meera/);
  assert.match(unshout('REVIEW KUNAL MUNJAL TAX DOCUMENTS'), /Kunal Munjal/);
  assert.match(unshout('CHECK VESU RRTM ROUTE'), /Vesu/);
});

run('a title written normally is left completely alone', () => {
  for (const t of ['Pay Arrohan TDS', 'call ajay at idmc', 'Submit Bhavya mediclaim documents']) {
    assert.equal(unshout(t), t);
  }
});

run('one word is not a sentence', () => {
  assert.equal(unshout('TDS'), 'TDS', 'and may simply be a name or a code');
  assert.equal(unshout('MEERA'), 'MEERA');
});

run('spelling is left to the extractor, which has the message', () => {
  // "Reviw" survives here on purpose: a rule that guessed at spelling would
  // eventually rewrite somebody's name into a word that is not their name.
  assert.match(unshout('AUDIT QUERY REVIW'), /Reviw/);
});

run('every new task goes through it, whichever way it was made', () => {
  assert.equal(
    DB.createTask({ title: 'FILL ACCOUNTANT VACANCY IN SURAT', source: 'manual' }).title,
    'Fill Accountant Vacancy in Surat'
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
