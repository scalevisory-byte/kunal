/**
 * Saying whose job a task is, from the list.
 *
 * It was already possible - in the drawer, behind a text field - and so it was
 * not done: reading down a list of forty tasks, "this one is Meera's" has to
 * be one press or it does not happen at all. And until it is said, the row
 * gives no sign either way, which is the question the list is actually read
 * with: is this mine?
 *
 * Handing a task over changes nothing about how it is chased. The app still
 * reminds HIM; the person hears from it only when he presses send on their
 * chat. These tests hold that line.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-assign-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const DB = await import('../src/db.js');
const A = await import('../src/assignment.js');
const S = await import('../src/scheduling.js');
const L = await import('../src/task-lifecycle.js');

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

const task = (title, extra = {}) =>
  DB.createTask({ title, status: 'open', source: 'whatsapp', origin: 'ai', ...extra });

console.log('\nnaming somebody');

let payment;

run('a task starts as his own', () => {
  payment = task('Follow up for payment', { chat_name: 'Sena Travel Solutions' });
  assert.equal(payment.assigned_to, null);
  assert.equal(A.directionOf(payment), 'own');
});

run('naming somebody hands it over and records when', () => {
  A.assignTask(payment.id, 'Krishna');
  const after = DB.getTask(payment.id);
  assert.equal(after.assigned_to, 'Krishna');
  assert.ok(after.assigned_at, 'and when it changed hands');
  assert.equal(A.directionOf(after), 'allotted');
});

run('it then appears under that person, and under nobody else', () => {
  assert.ok(A.tasksFor('Krishna').some((t) => t.id === payment.id));
  assert.equal(A.tasksFor('Meera').some((t) => t.id === payment.id), false);

  const names = A.delegates().map((p) => p.name);
  assert.ok(names.includes('Krishna'), 'and the name is offered next time');
});

run('the same name twice is one person, not two', () => {
  A.assignTask(task('Second job').id, 'Krishna');
  const rows = A.delegates().filter((p) => p.name === 'Krishna');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].open, 2, 'carrying both');
});

run('naming nobody takes it back, and that is the same operation', () => {
  const mine = task('Mine again');
  A.assignTask(mine.id, 'Meera');
  assert.equal(DB.getTask(mine.id).assigned_to, 'Meera');

  A.assignTask(mine.id, '');
  const back = DB.getTask(mine.id);
  assert.equal(back.assigned_to, null);
  assert.equal(back.assigned_to_wid, null);
  assert.equal(back.assigned_at, null, 'nothing is left claiming it changed hands');
  assert.equal(A.directionOf(back), 'own');
});

run('a name is trimmed and capped rather than stored as typed', () => {
  const t = task('Long name');
  A.assignTask(t.id, `  ${'K'.repeat(200)}  `);
  assert.equal(DB.getTask(t.id).assigned_to.length, 80);
});

console.log('\nwhat handing it over does not change');

run('it is still chased, and still his', () => {
  const t = task('Send the salary sheet', { due_date: '2026-12-01', due_at: '2026-12-01T12:30:00.000Z' });
  L.planTask(t);
  const before = S.remindersForTask(t.id).length;

  A.assignTask(t.id, 'Krishna');
  L.planTask(DB.getTask(t.id));
  assert.equal(S.remindersForTask(t.id).length, before,
    'the same ladder, unchanged: a delegated task is still owed by him');
});

run('nothing about assigning sends anybody anything', () => {
  const src = fs.readFileSync(new URL('../src/assignment.js', import.meta.url), 'utf8');
  const assign = src.slice(src.indexOf('export function assignTask'), src.indexOf('export function openTaskFor'));
  assert.ok(!/sendMessage|client\.send/.test(assign), 'assigning is a database write and nothing else');
});

run('the reminder for a delegated task still goes to him', () => {
  const engine = fs.readFileSync(new URL('../src/reminders.js', import.meta.url), 'utf8');
  const deliver = engine.slice(engine.indexOf('async function deliver('), engine.indexOf('async function deliverNoteReminders'));
  const sends = [...deliver.matchAll(/sendMessage\(([^,]+),/g)].map((m) => m[1].trim());
  assert.deepEqual(sends, ['reminderChatId()'],
    `a task with somebody else's name on it still reminds him: ${sends.join(', ')}`);
  assert.match(deliver, /With \$\{task\.assigned_to\}/, 'it just says whose desk it is on');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
