/**
 * Notes: things to remember, as opposed to things to do.
 *
 * The line between the two is what these cases are mostly about. A note has no
 * status, no deadline pressing on it and no follow-up; nothing in the app is
 * allowed to chase him about one, and nothing turns a note into a task except
 * a person asking for it. The rest is the ordinary care every store here gets:
 * archive rather than delete, one reminder delivered once, and a note that is
 * private to the account.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-notes-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const DB = await import('../src/db.js');
const N = await import('../src/notes.js');
const G = await import('../src/groups.js');
const S = await import('../src/scheduling.js');

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

console.log('\nwriting something down');

let gst;
let note;

run('a note keeps what was written, and when', () => {
  gst = G.createGroup({ name: 'GST' });
  note = N.createNote({
    title: 'GST work',
    body: 'GSTR-1 filing points\nCheck invoices from Dipen',
    group_id: gst.id,
    tags: ['GST', 'audit'],
  });
  assert.equal(note.title, 'GST work');
  assert.match(note.body, /Dipen/);
  assert.equal(note.group_name, 'GST', 'it can belong to a business');
  assert.deepEqual(note.tags, ['GST', 'audit']);
  assert.ok(note.created_at, 'when it was written is always recorded');
  assert.equal(note.pinned, false);
  assert.equal(note.archived, false);
});

run('a note has no status, deadline or follow-up', () => {
  // The whole point: a note is information. Nothing here is owed.
  for (const field of ['status', 'due_at', 'due_date', 'follow_up_count', 'needs_attention']) {
    assert.equal(field in note, false, `a note must not carry ${field}`);
  }
});

run('an empty note is not written at all', () => {
  assert.throws(() => N.createNote({}), /title or something in it/);
  assert.throws(() => N.createNote({ title: '   ', body: '  ' }), /title or something in it/);
});

run('a heading alone, or a body alone, is a real note', () => {
  assert.ok(N.createNote({ title: 'Audit discussion points' }));
  assert.ok(N.createNote({ body: 'Account number 5012 — ask before using' }));
});

console.log('\nediting, pinning, and the record of both');

run('editing keeps the note and records that it changed', () => {
  const before = N.getNote(note.id).updated_at;
  const after = N.updateNote(note.id, { body: `${note.body}\nAsk the CA about ITC` });
  assert.match(after.body, /ITC/);
  assert.ok(after.updated_at >= before);
  assert.ok(N.noteEvents(note.id).some((e) => e.kind === 'edited'));
});

run('pinning is remembered, and so is unpinning', () => {
  N.updateNote(note.id, { pinned: true });
  assert.equal(N.getNote(note.id).pinned, true);
  N.updateNote(note.id, { pinned: false });
  assert.equal(N.getNote(note.id).pinned, false);

  const kinds = N.noteEvents(note.id).map((e) => e.kind);
  assert.ok(kinds.includes('pinned') && kinds.includes('unpinned'), 'both moves are kept');
});

run('a pinned note is listed once, at the top', () => {
  N.updateNote(note.id, { pinned: true });
  const list = N.listNotes();
  assert.equal(list[0].id, note.id, 'pinned first');
  assert.equal(list.filter((n) => n.id === note.id).length, 1, 'and only once');
  N.updateNote(note.id, { pinned: false });
});

console.log('\nfinding it again');

run('search reads the title, the body, the tags and the business', () => {
  assert.ok(N.searchNotes('gstr-1').some((n) => n.id === note.id), 'body');
  assert.ok(N.searchNotes('GST work').some((n) => n.id === note.id), 'title');
  assert.ok(N.searchNotes('audit').length > 0, 'tags and other notes');
  assert.ok(N.searchNotes('gst').some((n) => n.id === note.id), 'business');
  assert.deepEqual(N.searchNotes('   '), [], 'an empty search is not everything');
});

run('filters do what they say', () => {
  const tagged = N.listNotes({ tag: 'GST' });
  assert.ok(tagged.every((n) => n.tags.some((t) => t.toLowerCase() === 'gst')));
  assert.ok(N.listNotes({ groupId: gst.id }).every((n) => n.group_id === gst.id));
  assert.ok(N.tagCounts().some((t) => t.tag === 'GST'));
});

console.log('\narchive, not delete');

run('archiving takes it off the list and keeps it', () => {
  const spare = N.createNote({ title: 'Old meeting points', body: 'From last year' });
  N.archiveNote(spare.id);

  assert.equal(N.listNotes().some((n) => n.id === spare.id), false, 'gone from the main list');
  assert.equal(N.listNotes({ archived: true }).some((n) => n.id === spare.id), true, 'still there');
  assert.ok(N.searchNotes('meeting points').some((n) => n.id === spare.id),
    'and still findable, which is the reason to keep it');

  N.restoreNote(spare.id);
  assert.equal(N.listNotes().some((n) => n.id === spare.id), true, 'and it comes back');
});

run('deleting for good is still possible, and really removes it', () => {
  const gone = N.createNote({ title: 'Typed by mistake' });
  assert.equal(N.deleteNote(gone.id), true);
  assert.equal(N.getNote(gone.id), null);
});

console.log('\nthe one reminder a note can have');

let reminded;

run('a reminder is one moment, delivered once', () => {
  const when = new Date(Date.now() - 60_000).toISOString();
  reminded = N.createNote({ title: 'Call CA about the audit', remind_at: when });

  const due = N.dueNoteReminders(new Date().toISOString());
  assert.ok(due.some((n) => n.id === reminded.id), 'its moment has come');

  assert.ok(N.claimNoteReminder(reminded.id), 'the first caller gets it');
  for (let i = 0; i < 5; i += 1) {
    assert.equal(N.claimNoteReminder(reminded.id), null, 'and nobody else ever does');
  }
  assert.equal(N.dueNoteReminders(new Date().toISOString()).some((n) => n.id === reminded.id), false);
});

run('a note reminder builds no ladder', () => {
  // Reminders and follow-ups belong to tasks. A note being remembered must not
  // put a row in the engine's own table, or it would be chased like work.
  const rows = S.remindersForTask(reminded.id);
  assert.deepEqual(rows.filter((r) => r.kind === 'follow_up'), []);
});

run('moving the reminder lets it fire again', () => {
  const later = new Date(Date.now() - 30_000).toISOString();
  N.updateNote(reminded.id, { remind_at: later });
  assert.ok(N.dueNoteReminders(new Date().toISOString()).some((n) => n.id === reminded.id),
    'a moved reminder has not been sent yet');
});

run('an archived note is never reminded about', () => {
  const quiet = N.createNote({ title: 'Archived reminder', remind_at: new Date(Date.now() - 1000).toISOString() });
  N.archiveNote(quiet.id);
  assert.equal(N.dueNoteReminders(new Date().toISOString()).some((n) => n.id === quiet.id), false);
});

console.log('\na note that turns out to be work');

run('nothing becomes a task on its own', () => {
  const before = DB.db.prepare(`SELECT COUNT(*) AS n FROM tasks`).get().n;
  N.createNote({ title: 'BNF salary', body: 'Check TDS\nPrepare calculation\nSend final sheet' });
  N.updateNote(note.id, { body: 'Pay the GST tomorrow, urgent, deadline today' });
  assert.equal(DB.db.prepare(`SELECT COUNT(*) AS n FROM tasks`).get().n, before,
    'writing something down is not asking for it to be chased');
});

run('when asked, it makes an ordinary task and says so', () => {
  const task = DB.createTask({ title: 'Send BNF salary sheet', note_id: note.id, source: 'manual' });
  N.recordNoteEvent(note.id, N.NOTE_EVENT.taskCreated, task.title);

  const related = N.tasksFromNote(note.id);
  assert.equal(related.length, 1);
  assert.equal(related[0].title, 'Send BNF salary sheet');
  assert.equal(N.getNote(note.id).task_count, 1, 'the note says what came out of it');
  assert.ok(N.noteEvents(note.id).some((e) => e.kind === 'converted to task'));

  // And it is a task like any other - the same table, the same fields.
  assert.equal(DB.getTask(task.id).status, 'open');
});

run('deleting the note leaves the work', () => {
  const spare = N.createNote({ title: 'Throwaway' });
  const task = DB.createTask({ title: 'Real work from it', note_id: spare.id });
  N.deleteNote(spare.id);
  const after = DB.getTask(task.id);
  assert.ok(after, 'the task survives');
  assert.equal(after.note_id, null, 'it just no longer points anywhere');
});

console.log('\nwhose notes these are');

run('nothing here can send a note to anybody else', () => {
  const src = fs.readFileSync(new URL('../src/notes.js', import.meta.url), 'utf8');
  assert.ok(!/sendMessage|client\.send/.test(src), 'notes.js sends nothing at all');

  const engine = fs.readFileSync(new URL('../src/reminders.js', import.meta.url), 'utf8');
  const noteBlock = engine.slice(engine.indexOf('async function deliverNoteReminders'));
  assert.match(noteBlock.slice(0, 1400), /sendMessage\(reminderChatId\(\)/,
    "a note reminder goes to the account's own chat");
  assert.ok(!/sendMessage\((?!reminderChatId)/.test(noteBlock.slice(0, 1400)),
    'and to nowhere else');
});

run('a note is only ever saved from WhatsApp on purpose', () => {
  const wa = fs.readFileSync(new URL('../src/whatsapp.js', import.meta.url), 'utf8');
  const block = wa.slice(wa.indexOf('export async function maybeSaveNote'));
  assert.match(block.slice(0, 400), /if \(!message\.fromMe\) return false;/,
    "somebody else's message can never become a note");
  assert.match(block.slice(0, 700), /NOTE_PREFIX/, 'and only when it says so');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
