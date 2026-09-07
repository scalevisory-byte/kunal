/**
 * The record of what was read.
 *
 * "Why did this message not become a task?" has two answers that look the same
 * from outside - it never arrived, or it arrived and nothing was made of it.
 * These cases pin down that the log tells them apart, and that a message which
 * produced two tasks is still one message rather than appearing to have
 * arrived twice.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-msglog-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const db = await import('../src/db.js');

let passed = 0;
let failed = 0;
const run = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
};

let seq = 0;
const arrive = (over = {}) =>
  db.insertMessage({
    wa_message_id: `wa-${seq += 1}`,
    chat_id: '120@g.us',
    chat_name: 'BOOK N FLY LEGAL TEAM',
    contact_name: 'Jayesh Chelaramani',
    contact_number: '919909993565',
    body: 'kindly confirm for signing so can send toms',
    is_group: 1,
    from_me: 0,
    sent_at: new Date().toISOString(),
    ...over,
  });

console.log('\nmessages read');

await run('nothing read yet reads as nothing, not as an error', () => {
  assert.deepEqual(db.listMessagesWithOutcome(), []);
});

await run('a message that produced no task says so', () => {
  const id = arrive();
  const [row] = db.listMessagesWithOutcome();
  assert.equal(row.id, id);
  assert.equal(row.body, 'kindly confirm for signing so can send toms');
  assert.deepEqual(row.tasks, [], 'it arrived, and nothing was made of it');
});

await run('a message that produced a task names it', () => {
  const id = arrive({ body: 'SEND NOTICE ONCE', from_me: 1 });
  db.createTask({ title: 'Send legal notice', message_id: id, assigned_to: 'Jayesh Chelaramani' });
  const row = db.listMessagesWithOutcome().find((m) => m.id === id);
  assert.equal(row.tasks.length, 1);
  assert.equal(row.tasks[0].title, 'Send legal notice');
  assert.equal(row.tasks[0].assigned_to, 'Jayesh Chelaramani');
});

await run('two tasks from one message is still one message', () => {
  const id = arrive({ body: 'salary process karo aur audit file kar do', from_me: 1 });
  db.createTask({ title: 'Process BNF salary', message_id: id });
  db.createTask({ title: 'File the audit', message_id: id });
  const rows = db.listMessagesWithOutcome();
  const mine = rows.filter((m) => m.id === id);
  assert.equal(mine.length, 1, 'a join would have repeated the message once per task');
  assert.equal(mine[0].tasks.length, 2);
});

await run('an archived task is still shown, and says it was archived', () => {
  const id = arrive({ body: 'odisha vacancy 5 candidates', from_me: 1 });
  const task = db.createTask({ title: 'Odisha vacancy', message_id: id });
  db.updateTask(task.id, { archived_at: new Date().toISOString() });
  const row = db.listMessagesWithOutcome().find((m) => m.id === id);
  assert.equal(row.tasks.length, 1);
  assert.ok(row.tasks[0].archived_at, 'the message still explains where the task went');
});

await run('newest is first, so the message just sent is at the top', () => {
  const id = arrive({ body: 'last one in', sent_at: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(db.listMessagesWithOutcome()[0].id, id);
});

await run('the limit is capped so the panel cannot ask for the whole table', () => {
  assert.ok(db.listMessagesWithOutcome({ limit: 100000 }).length <= 200);
  assert.equal(db.listMessagesWithOutcome({ limit: 1 }).length, 1);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
