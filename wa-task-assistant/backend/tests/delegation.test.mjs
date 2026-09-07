/**
 * Work given out, and work taken on.
 *
 * Two things decide the shape of this feature, and both are about not being
 * wrong in public:
 *
 *  1. Direction comes from who *sent* a message, never from what it says.
 *     "kar dena" reads the same whether he wrote it or received it, and filing
 *     a task against the wrong person means chasing somebody who was never
 *     asked.
 *
 *  2. The app messages nobody but its user on its own. A delegated task still
 *     reminds *him*; the assignee hears from the app only when a person presses
 *     Send. These tests hold that line by counting sends.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-deleg-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const DB = await import('../src/db.js');
const A = await import('../src/assignment.js');
const E = await import('../src/task-events.js');

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
  DB.createTask({ title, status: 'open', source: 'manual', ...extra });

console.log('\nthe two columns');

run('a plain task belongs to nobody but the user', () => {
  const t = task('BNF salary');
  assert.equal(t.assigned_to, null);
  assert.equal(t.requested_by, null);
  assert.equal(A.directionOf(t), 'own');
});

run('a task he gave out names the person', () => {
  const t = task('GST documents', { assigned_to: 'Rahul', assigned_to_wid: '9199@c.us' });
  assert.equal(t.assigned_to, 'Rahul');
  assert.equal(A.directionOf(t), 'allotted');
  assert.ok(t.assigned_at, 'and records when');
});

run('a task he was asked for names who asked', () => {
  const t = task('Send invoice', { requested_by: 'Mehta Sir', requested_by_wid: '9188@c.us' });
  assert.equal(t.requested_by, 'Mehta Sir');
  assert.equal(A.directionOf(t), 'received');
});

run('a request he passed on counts as given out', () => {
  // Both columns set. He is still answerable for it, and somebody else is doing
  // it - "allotted" is the answer to "where is this sitting".
  const t = task('Audit papers', { requested_by: 'Mehta Sir', assigned_to: 'Priya' });
  assert.equal(A.directionOf(t), 'allotted');
});

run('a name is trimmed and capped rather than stored as given', () => {
  const t = task('x', { assigned_to: `  ${'R'.repeat(200)}  ` });
  assert.equal(t.assigned_to.length, 80);
});

console.log('\nthe two lists');

run('each side counts only what is still open', () => {
  const before = A.delegationCounts();
  const t = task('Bank letter', { assigned_to: 'Rahul' });
  assert.equal(A.delegationCounts().allotted, before.allotted + 1);

  DB.updateTask(t.id, { status: 'done' });
  assert.equal(A.delegationCounts().allotted, before.allotted, 'finished work stops badging');
});

run('a person carries their own open count', () => {
  task('One', { assigned_to: 'Kiran' });
  task('Two', { assigned_to: 'Kiran' });
  const done = task('Three', { assigned_to: 'Kiran' });
  DB.updateTask(done.id, { status: 'done' });

  const kiran = A.delegates().find((d) => d.name === 'Kiran');
  assert.equal(kiran.open, 2);
  assert.equal(kiran.total, 3, 'and still remembers the finished one');
});

run('the same person spelled differently is not merged', () => {
  // Deliberate: "Rahul" and "Rahul Shah" may be two people, and quietly
  // merging them would put one person's work on another's list.
  task('Something', { assigned_to: 'Rahul Shah' });
  const names = A.delegates().map((d) => d.name);
  assert.ok(names.includes('Rahul') && names.includes('Rahul Shah'));
});

run('an archived task leaves both lists', () => {
  const t = task('Old handover', { assigned_to: 'Zeel' });
  assert.ok(A.delegates().some((d) => d.name === 'Zeel'));
  DB.updateTask(t.id, { archived_at: new Date().toISOString() });
  assert.ok(!A.delegates().some((d) => d.name === 'Zeel'));
});

run('people who asked him are listed the same way', () => {
  task('Quotation', { requested_by: 'Sunshine' });
  task('Follow up bank', { requested_by: 'Sunshine' });
  const who = A.requesters().find((r) => r.name === 'Sunshine');
  assert.equal(who.open, 2);
});

console.log('\nhanding over, and taking back');

run('assigning names the person and records it', () => {
  const t = task('Vendor payment');
  A.assignTask(t.id, 'Rahul', '9199@c.us');
  const fresh = DB.getTask(t.id);
  assert.equal(fresh.assigned_to, 'Rahul');
  assert.equal(fresh.assigned_to_wid, '9199@c.us');
  assert.ok(fresh.assigned_at);
});

run('clearing the name takes the task back completely', () => {
  const t = task('Vendor payment 2', { assigned_to: 'Rahul', assigned_to_wid: '9199@c.us' });
  assert.equal(A.assignTask(t.id, ''), null);
  const fresh = DB.getTask(t.id);
  assert.equal(fresh.assigned_to, null);
  assert.equal(fresh.assigned_to_wid, null, 'the chat goes too - nothing left to message');
  assert.equal(fresh.assigned_at, null);
});

run('whitespace is not a person', () => {
  const t = task('Nothing doing', { assigned_to: 'Rahul' });
  A.assignTask(t.id, '    ');
  assert.equal(DB.getTask(t.id).assigned_to, null);
});

run('the handover is in the task history', () => {
  const t = task('Registration');
  A.assignTask(t.id, 'Priya');
  E.recordEvent(t.id, E.EVENT.assigned, 'Priya');
  const kinds = E.eventsForTask(t.id).map((e) => e.kind);
  assert.ok(kinds.includes('assigned'));
});

console.log('\nfinding the one task a reply is about');

run('one open task for that person is a match', () => {
  task('Only thing', { assigned_to: 'Solo' });
  assert.equal(A.openTaskFor('Solo').title, 'Only thing');
});

run('two open tasks is no match at all', () => {
  task('A', { assigned_to: 'Busy' });
  task('B', { assigned_to: 'Busy' });
  assert.equal(A.openTaskFor('Busy'), null, 'closing the wrong one is worse than closing none');
});

run('a finished task is not a candidate', () => {
  const t = task('Finished', { assigned_to: 'Gone' });
  DB.updateTask(t.id, { status: 'done' });
  assert.equal(A.openTaskFor('Gone'), null);
});

run('the name is matched however it is capitalised', () => {
  task('Case test', { assigned_to: 'Nirav' });
  assert.ok(A.openTaskFor('nirav'));
  assert.ok(A.openTaskFor('  NIRAV  '));
});

console.log('\nthe nudge is written before it is sent');

run('the preview names the person, the task and the deadline', () => {
  const t = task('GST return', { assigned_to: 'Rahul', due_date: '2026-09-01' });
  const text = A.followUpText(DB.getTask(t.id));
  assert.ok(text.includes('Rahul'));
  assert.ok(text.includes('GST return'));
  // A date somebody can read, in his timezone - not the database's ISO string.
  assert.match(text, /1 Sep/);
});

run('the deadline is put in the right tense', () => {
  const day = (offset) => {
    const at = new Date();
    at.setDate(at.getDate() + offset);
    return at.toISOString().slice(0, 10);
  };
  const past = task('Late one', { assigned_to: 'Rahul', due_date: day(-30) });
  const soon = task('Coming one', { assigned_to: 'Rahul', due_date: day(30) });

  assert.match(A.followUpText(DB.getTask(past.id)), /It was due/);
  // "It was due next month" would read as a reproach for something that has
  // not happened yet - which is exactly the message not to send to somebody
  // doing you a favour.
  assert.match(A.followUpText(DB.getTask(soon.id)), /It is due/);
});

run('a task with no deadline does not invent one', () => {
  const t = task('Undated thing', { assigned_to: 'Rahul' });
  const text = A.followUpText(DB.getTask(t.id));
  assert.ok(!/due/i.test(text), text);
});

console.log('\nwhich way round the work is going');

/*
 * The extractor, against a stubbed Messages API.
 *
 * What is being tested is not Claude's judgement - it is that the direction of
 * a message survives the trip. The model is told who wrote each message, and
 * whatever it answers, a name it puts on a task is honoured only when the
 * message came from the user. A request somebody sends him cannot become work
 * he has handed out, however it is phrased.
 */
const extractDirs = [];
function extract(model, messages) {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ext-'));
  extractDirs.push(box);
  const script = `
    globalThis.fetch = async (url, init) => {
      globalThis.__body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        id: 'msg', type: 'message', role: 'assistant', model: 'stub',
        content: [{ type: 'text', text: ${JSON.stringify(JSON.stringify(model))} }],
        stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const { extractTasks } = await import('./src/extractor.js');
    const tasks = await extractTasks(${JSON.stringify(messages)});
    process.stdout.write('@@' + JSON.stringify({
      tasks, prompt: globalThis.__body?.messages?.[0]?.content?.[0]?.text,
    }) + '@@');
  `;
  const raw = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: path.resolve(process.cwd()),
    env: {
      ...process.env,
      DATA_DIR: box,
      EXTRACTION_MODE: 'ai',
      ANTHROPIC_API_KEY: 'test-key',
      TIMEZONE: 'Asia/Kolkata',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(raw.split('@@')[1]);
}

const answer = (extra = {}) => ({
  tasks: [{
    title: 'GST documents bhejna', description: '', contact: '', chat_name: '',
    due_date: '', remind_time: '', priority: 'medium', confidence: 'high',
    assigned_to: '', group: '', source_index: 0, ...extra,
  }],
});

const message = (extra = {}) => ({
  id: 1, chat_id: '9199@c.us', chat_name: 'Rahul', contact_name: 'Rahul',
  contact_number: '9199', is_group: 0, from_me: 0,
  body: 'GST documents kal bhej dena', sent_at: '2026-09-07T04:00:00Z', ...extra,
});

run('the prompt says who wrote each message', () => {
  const out = extract(answer(), [message({ from_me: 1 })]);
  assert.match(out.prompt, /HE WROTE THIS/);

  const incoming = extract(answer(), [message({ from_me: 0 })]);
  assert.match(incoming.prompt, /Rahul wrote this to him/);
});

run('a name on a message he wrote is honoured', () => {
  const out = extract(answer({ assigned_to: 'Rahul' }), [message({ from_me: 1 })]);
  assert.equal(out.tasks[0].assigned_to, 'Rahul');
  assert.equal(out.tasks[0].assigned_to_wid, '9199@c.us');
  assert.equal(out.tasks[0].requested_by, null, 'he was not asked - he asked');
});

run('a name on a message somebody sent him is refused', () => {
  // The guard that matters. Even if the model decides "Rahul" is the assignee,
  // a request arriving from Rahul is work the user owes Rahul, not the reverse.
  const out = extract(answer({ assigned_to: 'Rahul' }), [message({ from_me: 0 })]);
  assert.equal(out.tasks[0].assigned_to, null);
  assert.equal(out.tasks[0].requested_by, 'Rahul');
});

run('an incoming request records who asked and from where', () => {
  const out = extract(answer(), [message({ from_me: 0 })]);
  assert.equal(out.tasks[0].requested_by, 'Rahul');
  assert.equal(out.tasks[0].requested_by_wid, '9199@c.us');
});

run('a note he made himself belongs to nobody', () => {
  const out = extract(answer(), [message({ from_me: 1 })]);
  assert.equal(out.tasks[0].assigned_to, null);
  assert.equal(out.tasks[0].requested_by, null);
});

run('an unnamed sender falls back to their number, never to nothing', () => {
  const out = extract(answer(), [message({ from_me: 0, contact_name: null })]);
  assert.equal(out.tasks[0].requested_by, '9199');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
for (const d of extractDirs) fs.rmSync(d, { recursive: true, force: true });
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
