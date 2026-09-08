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

console.log('\nwork handed over from a set-aside group');

run('the page and the sidebar badge count the same thing', () => {
  /*
   * They did not. The badge runs its own query with no set-aside filter; the
   * page went through listTasks, which drops set-aside work. So a vacancy
   * handed to a recruiter was counted and not shown — badge 2, page 1 — and
   * since recruitment is most of what gets handed over, the page was empty of
   * very nearly every automatic delegation. Which is how "Task allotted is not
   * working" survived five rounds of looking at the extractor.
   */
  const G = DB.db.prepare(
    `INSERT INTO task_groups (name, colour, keywords, position, separate) VALUES (?,?,?,?,1)`
  ).run('Set aside', 'slate', '[]', 99).lastInsertRowid;

  task('Fill or forward accountant position', { assigned_to: 'Krupa', group_id: G });

  const badge = A.delegationCounts().allotted;
  const page = DB.listTasks({ status: 'pending', limit: 500, includeSetAside: true })
    .filter((t) => t.assigned_to).length;
  assert.equal(page, badge, `page ${page} vs badge ${badge}`);
});

run('"who owes what" is a different question from "what is due today"', () => {
  // The task stays out of the day's work and out of the figures; it is only
  // the delegation pages that have to see it, because the person is real.
  const listed = DB.listTasks({ status: 'pending', limit: 500 }).map((t) => t.title);
  assert.ok(!listed.includes('Fill or forward accountant position'), 'still off the main list');
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
  /*
   * The case that made "Task allotted" empty on the live dashboard. His notes
   * chat and a team group are both messages he wrote; only one of them is him
   * handing work over, and the wording does not distinguish them.
   */
  const out = extract(answer({ assigned_to: 'Scale Visory' }), [
    message({ from_me: 1, is_self: 1, chat_name: 'Scale Visory' }),
  ]);
  assert.equal(out.tasks[0].assigned_to, null, 'a note to himself is his own work');
  assert.equal(out.tasks[0].requested_by, null, 'and nobody asked him for it');
});

run('the prompt tells the model which of the three it is looking at', () => {
  const notes = extract(answer(), [message({ from_me: 1, is_self: 1 })]);
  assert.match(notes.prompt, /notes-to-self/);

  const group = extract(answer(), [
    message({ from_me: 1, is_group: 1, chat_name: 'Booknfly Accounts' }),
  ]);
  assert.match(group.prompt, /the team in "Booknfly Accounts"/);
});

run('an instruction into a team group is work handed to that team', () => {
  const out = extract(answer({ assigned_to: 'Booknfly Accounts' }), [
    message({ from_me: 1, is_group: 1, chat_name: 'Booknfly Accounts',
      body: 'Need all tds entry till aug 26' }),
  ]);
  assert.equal(out.tasks[0].assigned_to, 'Booknfly Accounts');
  assert.equal(out.tasks[0].assigned_to_wid, '9199@c.us', 'a nudge goes to the group');
});

run('a group message aimed at somebody else says so in the prompt', () => {
  /*
   * "please advise for payment @abdul bhai kiski tkt he?" — written by the
   * accounts team, in a group, to Abdul. It became a task on the user's own
   * list, so he was being chased for Abdul's job. The @mention is the one part
   * of "who is this for" that does not have to be inferred: WhatsApp hands over
   * the ids, so it is stated as a fact rather than left to the wording, which
   * reads the same whoever it is addressed to.
   */
  const out = extract(answer(), [message({
    from_me: 0, is_group: 1, chat_name: 'Booknfly Accounts',
    mentions_someone: 1, mentions_me: 0,
    body: 'please advise for payment @abdul bhai kiski tkt he ?',
  })]);
  assert.match(out.prompt, /addressed to somebody else in the group, not to him/);
});

run('a group message that mentions him is not marked as somebody else\'s', () => {
  const out = extract(answer(), [message({
    from_me: 0, is_group: 1, mentions_someone: 1, mentions_me: 1,
  })]);
  assert.ok(!/addressed to somebody else/.test(out.prompt));
});

run('a message naming nobody is a request to the group, so it is his', () => {
  const out = extract(answer(), [message({ from_me: 0, is_group: 1, mentions_someone: 0 })]);
  assert.ok(!/addressed to somebody else/.test(out.prompt));
  assert.equal(out.tasks[0].requested_by, 'Rahul');
});

run('a one-to-one message is never marked as aimed elsewhere', () => {
  // Only a group can hold a conversation he is merely present for.
  const out = extract(answer(), [message({ from_me: 0, is_group: 0, mentions_someone: 1 })]);
  assert.ok(!/addressed to somebody else/.test(out.prompt));
});

run('in a group, the message\'s own sender beats the model\'s guess', () => {
  /*
   * The row showed "Bhavesh- sena global dmc" once and nothing beside it. The
   * model had filled `contact` with the group's own name, so the sender and the
   * group were the same text - and a label that repeats itself collapses to
   * one, losing exactly the name the group was meant to sit beside. The message
   * knows who sent it; a guess does not get to overrule that.
   */
  const out = extract(answer({ contact: 'ACCT - SENA GLOBAL DMC' }), [
    message({
      from_me: 0, is_group: 1,
      chat_name: 'ACCT - SENA GLOBAL DMC', contact_name: 'Bhavesh',
    }),
  ]);
  assert.equal(out.tasks[0].contact, 'Bhavesh');
  assert.equal(out.tasks[0].chat_name, 'ACCT - SENA GLOBAL DMC', 'and the group is still the chat');
});

run('in a one-to-one chat the model may still name somebody', () => {
  // There the message's sender is the chat, so a name the model read out of
  // the text is the more useful answer.
  const out = extract(answer({ contact: 'Ajay at IDMC' }), [
    message({ from_me: 0, is_group: 0, contact_name: 'Meera' }),
  ]);
  assert.equal(out.tasks[0].contact, 'Ajay at IDMC');
});

run('an unnamed sender falls back to their number, never to nothing', () => {
  const out = extract(answer(), [message({ from_me: 0, contact_name: null })]);
  assert.equal(out.tasks[0].requested_by, '9199');
});

console.log('\nwhich chat a task came from');

/*
 * The group name is not a judgement call - the message arrived in a chat, and
 * that chat has a name. These cases exist because the model was answering
 * "which chat?" with the person who wrote the message, and that answer was
 * winning over the fact.
 */

run("the group's own name is kept, whatever the model calls the chat", () => {
  const out = extract(
    answer({ chat_name: 'Preeti Khandelwal' }),
    [message({
      from_me: 0, is_group: 1,
      chat_name: 'Vikas Travel | Pinetree accounting services',
      contact_name: 'Preeti Khandelwal',
    })]
  );
  assert.equal(out.tasks[0].chat_name, 'Vikas Travel | Pinetree accounting services');
  assert.equal(out.tasks[0].contact, 'Preeti Khandelwal', 'and the sender stays the sender');
  assert.equal(out.tasks[0].is_group, 1);
});

run('the sender and the group are two different things on the row', () => {
  const out = extract(
    answer({ chat_name: 'BNF - GROWTH TEAM', contact: 'BNF - GROWTH TEAM' }),
    [message({ from_me: 0, is_group: 1, chat_name: 'BNF - GROWTH TEAM', contact_name: 'Hasmukh' })]
  );
  assert.equal(out.tasks[0].chat_name, 'BNF - GROWTH TEAM');
  assert.equal(out.tasks[0].contact, 'Hasmukh');
  assert.notEqual(out.tasks[0].chat_name, out.tasks[0].contact,
    'the same text twice is what collapsed the row to one name');
});

run('a one-to-one chat still carries the person it is with', () => {
  const out = extract(answer({ chat_name: 'somewhere else' }),
    [message({ from_me: 0, is_group: 0, chat_name: 'Meera Jariwala' })]);
  assert.equal(out.tasks[0].chat_name, 'Meera Jariwala');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
for (const d of extractDirs) fs.rmSync(d, { recursive: true, force: true });
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
