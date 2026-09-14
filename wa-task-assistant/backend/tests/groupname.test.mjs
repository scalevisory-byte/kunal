/**
 * Getting a group's name back out of WhatsApp.
 *
 * Reported six times now, and every earlier fix worked on the wrong layer.
 * The row said "Preeti Khandelwal" with no group beside it because the group's
 * name was never stored: `getChat()` failed when the message arrived, the row
 * kept the chat's id in place of a name, the id is not something a row can
 * show, and so the task fell back to the sender.
 *
 * Nothing in the database can recover that. WhatsApp can - the id is exactly
 * what it takes to ask - so these cases are about asking, once per group, and
 * writing the answer onto what was stored without it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-gname-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const DB = await import('../src/db.js');
const GN = await import('../src/group-names.js');

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

const VIKAS = '120363000111@g.us';
const NAME = 'Vikas Travel | Pinetree accounting services I';

const message = (row) =>
  DB.db
    .prepare(
      `INSERT INTO messages (chat_id, chat_name, contact_name, body, is_group, sent_at)
       VALUES (@chat_id, @chat_name, @contact_name, @body, @is_group, @sent_at)`
    )
    .run({ body: 'x', is_group: 1, sent_at: '2026-09-08T00:00:00Z', contact_name: null, ...row });

const task = (row) =>
  DB.db
    .prepare(
      `INSERT INTO tasks (title, chat_name, contact, chat_id, is_group, status, source, origin)
       VALUES (@title, @chat_name, @contact, @chat_id, @is_group, 'open', 'whatsapp', 'ai')`
    )
    .run({ is_group: 0, contact: null, chat_name: null, ...row });

const taskNamed = (title) =>
  DB.db.prepare(`SELECT * FROM tasks WHERE title = ?`).get(title);

console.log('\nwhat an id is not');

await run('an id, a wid and a bare number are not names', () => {
  assert.equal(GN.looksLikeId('120363000111@g.us'), true);
  assert.equal(GN.looksLikeId('919909993565@c.us'), true);
  assert.equal(GN.looksLikeId('+91 99099 93565'), true);
  assert.equal(GN.looksLikeId(''), true);
  assert.equal(GN.looksLikeId(null), true);
});

await run('a real group name is', () => {
  assert.equal(GN.looksLikeId(NAME), false);
  assert.equal(GN.looksLikeId('BNF - GROWTH TEAM'), false);
  // A name that merely contains digits is still a name.
  assert.equal(GN.looksLikeId('BNF 2026 Growth'), false);
});

console.log('\nasking WhatsApp for what was never stored');

await run('the deployed shape: id for a name, sender on the task', async () => {
  // Exactly what is on the running service. The message kept the id because
  // the lookup failed; the task took the model's guess, which was the sender.
  message({ chat_id: VIKAS, chat_name: VIKAS, contact_name: 'Preeti Khandelwal' });
  task({
    title: 'Check with your China contact about rep office formalities',
    chat_name: 'Preeti Khandelwal', contact: 'Preeti Khandelwal', chat_id: VIKAS,
  });
  task({
    title: 'Advise on opening a branch in China',
    chat_name: 'Vikas Gupta', contact: 'Vikas Gupta', chat_id: VIKAS,
  });

  const asked = [];
  const result = await GN.repairGroupNames(async (id) => {
    asked.push(id);
    return NAME;
  });

  assert.deepEqual(asked, [VIKAS], 'asked once, by id');
  assert.equal(result.tasks, 2);

  const one = taskNamed('Check with your China contact about rep office formalities');
  assert.equal(one.chat_name, NAME, 'the group is on the task');
  assert.equal(one.contact, 'Preeti Khandelwal', 'and the sender is still the sender');
  assert.equal(one.is_group, 1);
  assert.notEqual(one.chat_name, one.contact, 'two facts, so the row prints both');

  assert.equal(taskNamed('Advise on opening a branch in China').chat_name, NAME);
});

await run('the messages are named too, so the next task is right first time', () => {
  const row = DB.db.prepare(`SELECT * FROM messages WHERE chat_id = ?`).get(VIKAS);
  assert.equal(row.chat_name, NAME);
  assert.equal(row.is_group, 1);
});

await run('a group already named is not asked about again', async () => {
  const asked = [];
  await GN.repairGroupNames(async (id) => { asked.push(id); return NAME; });
  assert.deepEqual(asked, [], 'nothing left to ask');
});

console.log('\nwhen the answer is no use');

await run('an id coming back as the name changes nothing', async () => {
  const chat = '120363000222@g.us';
  message({ chat_id: chat, chat_name: chat, contact_name: 'Hasmukh' });
  task({ title: 'Unnamed group task', chat_name: 'Hasmukh', contact: 'Hasmukh', chat_id: chat });

  await GN.repairGroupNames(async () => chat);
  assert.equal(taskNamed('Unnamed group task').chat_name, 'Hasmukh',
    'the wrong name is left rather than replaced with an id');
});

await run('one unreachable group does not stop the others', async () => {
  const bad = '120363000333@g.us';
  const good = '120363000444@g.us';
  message({ chat_id: bad, chat_name: bad });
  message({ chat_id: good, chat_name: good });
  task({ title: 'From the unreachable one', chat_name: null, chat_id: bad });
  task({ title: 'From the reachable one', chat_name: null, chat_id: good });

  const result = await GN.repairGroupNames(async (id) => {
    if (id === bad) throw new Error('chat not found');
    if (id === good) return 'BNF - GROWTH TEAM';
    return null;
  });

  assert.ok(result.named >= 1);
  assert.equal(taskNamed('From the reachable one').chat_name, 'BNF - GROWTH TEAM');
  assert.equal(taskNamed('From the unreachable one').chat_name, null, 'left as it was');
});

console.log('\nwhat can be settled without asking at all');

await run('one message that got the name through names the whole chat', async () => {
  /*
   * The same chat is not read the same way twice: getChat() fails on one
   * message and works on the next. One row holding the real name is as good an
   * answer as WhatsApp would give, and it needs no session - which matters,
   * because the session spends its first minutes unable to answer anything.
   */
  const chat = '120363000666@g.us';
  message({ chat_id: chat, chat_name: chat, contact_name: 'Krishna' });
  message({ chat_id: chat, chat_name: chat, contact_name: 'HR' });
  message({ chat_id: chat, chat_name: 'BOOKNFLY TEAM', contact_name: 'HR' });
  task({ title: 'From the half-read chat', chat_name: 'Krishna', contact: 'Krishna', chat_id: chat });

  const result = GN.repairFromStored();
  assert.ok(result.named >= 1);
  assert.equal(taskNamed('From the half-read chat').chat_name, 'BOOKNFLY TEAM');
  assert.equal(taskNamed('From the half-read chat').is_group, 1);
});

await run('an id stored more often than the name still loses to it', () => {
  const chat = '120363000777@g.us';
  for (let i = 0; i < 5; i += 1) message({ chat_id: chat, chat_name: chat });
  message({ chat_id: chat, chat_name: 'ACCT - SENA GLOBAL DMC' });
  task({ title: 'Outvoted', chat_name: null, chat_id: chat });

  GN.repairFromStored();
  assert.equal(taskNamed('Outvoted').chat_name, 'ACCT - SENA GLOBAL DMC');
});

await run('a task with no chat id of its own is linked through its message', () => {
  // Early versions did not put the chat id on the task, so a repair that works
  // chat by chat could not see them at all.
  const chat = '120363000888@g.us';
  const info = DB.db
    .prepare(`INSERT INTO messages (chat_id, chat_name, contact_name, body, is_group, sent_at)
              VALUES (?, ?, ?, 'x', 1, '2026-09-08T00:00:00Z')`)
    .run(chat, 'BNF - GROWTH TEAM', 'Hasmukh');
  DB.db
    .prepare(`INSERT INTO tasks (title, chat_name, contact, message_id, status, source, origin)
              VALUES ('No chat id', 'Hasmukh', 'Hasmukh', ?, 'open', 'whatsapp', 'ai')`)
    .run(info.lastInsertRowid);

  assert.equal(GN.linkChatIds() >= 1, true);
  GN.repairFromStored();
  assert.equal(taskNamed('No chat id').chat_name, 'BNF - GROWTH TEAM');
});

console.log('\nwhat is left alone');

await run('a one-to-one chat is never touched', async () => {
  task({ title: 'A private chat task', chat_name: 'Meera Jariwala', contact: 'Meera Jariwala', chat_id: '9198@c.us' });
  await GN.repairGroupNames(async () => 'SOMETHING ELSE');
  assert.equal(taskNamed('A private chat task').chat_name, 'Meera Jariwala');
});

await run('a group whose name is already right keeps it', async () => {
  const chat = '120363000555@g.us';
  message({ chat_id: chat, chat_name: 'ACCT - SENA GLOBAL DMC', contact_name: 'Bhavesh' });
  task({ title: 'Already right', chat_name: 'ACCT - SENA GLOBAL DMC', contact: 'Bhavesh', chat_id: chat, is_group: 1 });

  const asked = [];
  await GN.repairGroupNames(async (id) => { asked.push(id); return 'ACCT - SENA GLOBAL DMC'; });
  assert.equal(asked.includes(chat), false, 'nothing to ask about');
  assert.equal(taskNamed('Already right').chat_name, 'ACCT - SENA GLOBAL DMC');
});


/*
 * "Still name not coming."
 *
 * The first fix worked, and on the wrong set: it covered `@g.us` only, so the
 * chats that showed NOTHING - a one-to-one chat WhatsApp never named - were
 * exactly the ones nothing was going back to ask about. A `@lid` id is the
 * worst of them: a linked identity has no dialable number inside it, so there
 * is not even a phone number to print instead.
 */
console.log('\nthe chats that were never asked about');

const LID = '89309717786799@lid';
const CUS = '919825011122@c.us';

await run('a one-to-one chat stored under its id is asked about too', async () => {
  message({ chat_id: LID, chat_name: LID, is_group: 0 });
  task({ title: 'Confirm Gulab Changulani x3 flight', chat_id: LID, chat_name: LID });

  const asked = [];
  await GN.repairGroupNames(async (id) => {
    asked.push(id);
    return id === LID ? 'Gulab Changulani' : null;
  });

  assert.ok(asked.includes(LID), `a @lid chat was never asked about: ${asked.join(', ')}`);
  assert.equal(taskNamed('Confirm Gulab Changulani x3 flight').chat_name, 'Gulab Changulani');
});

await run('and so is a @c.us one', async () => {
  message({ chat_id: CUS, chat_name: CUS, is_group: 0 });
  task({ title: 'Pay Nitin Bhai August rent', chat_id: CUS, chat_name: CUS });

  await GN.repairGroupNames(async (id) => (id === CUS ? 'Nitin Bhai' : null));
  assert.equal(taskNamed('Pay Nitin Bhai August rent').chat_name, 'Nitin Bhai');
});

await run('naming a one-to-one chat does NOT turn it into a group', async () => {
  // is_group is not decoration: the blocklist's chat-is-not-a-person rule reads
  // it, and so does the row, which prints "sender · group" for one and a single
  // name for the other. Fixing the label by corrupting the fact underneath it
  // would be worse than the blank.
  const row = taskNamed('Pay Nitin Bhai August rent');
  assert.equal(row.is_group, 0, 'it is still a one-to-one chat');
  const msg = DB.db.prepare(`SELECT is_group FROM messages WHERE chat_id = ?`).get(CUS);
  assert.equal(msg.is_group, 0);
});

await run('a group still becomes a group, because that one really is', async () => {
  const G = '120363555777@g.us';
  message({ chat_id: G, chat_name: G, is_group: 1 });
  task({ title: 'Send the GST working', chat_id: G, chat_name: G });
  await GN.repairGroupNames(async (id) => (id === G ? 'BNF - GROWTH TEAM' : null));
  const row = taskNamed('Send the GST working');
  assert.equal(row.chat_name, 'BNF - GROWTH TEAM');
  assert.equal(row.is_group, 1);
});

await run('a row whose chat cannot be named says so rather than nothing', () => {
  // The client-side half: every road ended in null and the row printed an empty
  // line, which reads as a bug rather than as a missing name.
  const lib = fs.readFileSync(new URL('../../frontend/src/lib/task.js', import.meta.url), 'utf8');
  const fn = lib.slice(lib.indexOf('export function taskSource'), lib.indexOf('/** Free-text match'));
  assert.match(fn, /Unnamed chat/, 'it names the gap');
  assert.match(fn, /task\?\.chat_id \|\| task\?\.message_id/, 'but only when a chat really is behind it');
});



/*
 * "Name abhi nahi aya" — the second time, over rows that showed nothing at
 * all, not even "Unnamed chat".
 *
 * Because the first fix only spoke for a task carrying some trace of its chat.
 * One that came out of WhatsApp with neither an id nor a message still fell
 * through to a blank — and a blank reads as something broken rather than
 * something missing. The three causes look identical on the row and need
 * completely different answers, so the app counts them rather than leaving it
 * to be guessed from the outside.
 */
console.log('\nwhy a row cannot say where it came from');

await run('the message knows the name even when the task has no chat id', async () => {
  // applyGroupName works chat by chat, so a task with a null chat_id was never
  // reached by it — even when its own message has had the name all along.
  const m = DB.db
    .prepare(`INSERT INTO messages (chat_id, chat_name, body, is_group, sent_at)
              VALUES ('919825011122@c.us', 'CA Vishal Joshi', 'x', 0, '2026-09-08T00:00:00Z')`)
    .run();
  DB.db
    .prepare(`INSERT INTO tasks (title, chat_name, chat_id, message_id, status, source, origin)
              VALUES ('Share GST working', NULL, NULL, ?, 'open', 'whatsapp', 'ai')`)
    .run(m.lastInsertRowid);

  assert.equal(GN.nameFromMessages(), 1);
  assert.equal(taskNamed('Share GST working').chat_name, 'CA Vishal Joshi');
});

await run('the three causes are counted apart, because they need different answers', () => {
  // askable: an id to ask WhatsApp about. noSource: nothing to ask at all.
  task({ title: 'Confirm the flight', chat_name: '8930971@lid', chat_id: '8930971@lid' });
  task({ title: 'Send March GSTR-1', chat_name: null, chat_id: null });

  const state = GN.taskChatState();
  assert.ok(state.named >= 1, 'the repaired one counts as named');
  assert.ok(state.askable >= 1, 'the @lid one can still be asked about');
  assert.ok(state.noSource >= 1, 'the one with nothing on it cannot');
});

await run('a task he typed by hand is not counted as a blank', () => {
  // It has no chat because it never came from one, the row already says "By
  // hand", and counting it would make the panel disagree with the list.
  const before = GN.taskChatState().noSource;
  DB.db
    .prepare(`INSERT INTO tasks (title, chat_name, chat_id, message_id, status, source, origin)
              VALUES ('Renew shop licence', NULL, NULL, NULL, 'open', 'manual', 'manual')`)
    .run();
  assert.equal(GN.taskChatState().noSource, before, 'unchanged');
});

await run('and the row stays quiet for it, by the same rule', () => {
  const lib = fs.readFileSync(new URL('../../frontend/src/lib/task.js', import.meta.url), 'utf8');
  const fn = lib.slice(lib.indexOf('export function taskSource'), lib.indexOf('/** Free-text match'));
  assert.match(fn, /No chat/, 'a WhatsApp task with nothing on it says so');
  assert.match(fn, /task\?\.origin === 'ai' \|\| task\?\.source === 'whatsapp'/,
    'but only one that came from WhatsApp');
});



/*
 * The panel said 449 rows were showing their chat while the list showed none.
 *
 * Both could not be true, and the count was the liar: three different rules for
 * "is this a name" had grown up in three places, and the loosest of them called
 * a phone number a name. So every one of those rows was filed as fine, no
 * repair ever went looking for what the chat was really called, and the row
 * printed a bare number or nothing.
 *
 * One rule now, everywhere: a name has letters in it; an id does not.
 */
console.log('\na name has letters, an id does not');

await run('a linked identity carrying its device number is an id', () => {
  // The shape that slipped through: the old rule allowed digits, spaces and
  // dashes only, so the colon made "202383321759941:33" look like a name — and
  // applyGroupName would then write it onto tasks AS their chat name.
  assert.equal(GN.looksLikeId('202383321759941:33'), true);
  assert.equal(GN.looksLikeId('919825011122'), true);
  assert.equal(GN.looksLikeId('+91 99099 93565'), true);
});

await run('and a real name is not, in any script', () => {
  assert.equal(GN.looksLikeId('BOOK N FLY X AADRESS'), false);
  assert.equal(GN.looksLikeId('CA Vishal Joshi'), false);
  // The rule cannot be "has A-Z": most of his chats are named in Gujarati.
  assert.equal(GN.looksLikeId('મમ્મી'), false);
  assert.equal(GN.looksLikeId('सोनू भाई'), false);
});

await run('the count applies the same rule the row does', () => {
  DB.db.prepare('DELETE FROM tasks').run();
  const add = (title, chat_name, chat_id) =>
    DB.db
      .prepare(`INSERT INTO tasks (title, chat_name, chat_id, status, source, origin)
                VALUES (?, ?, ?, 'open', 'whatsapp', 'ai')`)
      .run(title, chat_name, chat_id);

  add('Renewal agreement', '202383321759941:33', '202383321759941:33@lid');
  add('Travelogy supplier', '919825011122', '919825011122@c.us');
  add('Scan documents', '89309717786799', null);
  add('Dehradun rent', 'BOOK N FLY X AADRESS', '120363111@g.us');
  add('Mummy ko batao', 'મમ્મી', '919000000002@c.us');

  const state = GN.taskChatState();
  assert.equal(state.named, 2, 'only the two real names, Gujarati included');
  assert.equal(state.askable, 2, 'the two ids that can still be looked up');
  assert.equal(state.noSource, 1, 'and the one with nothing to look up from');
});

await run('and the panel can show what those rows actually hold', () => {
  // Three rounds went on guessing this from a screenshot. The stored value says
  // which cause it is on sight.
  const held = GN.blankChatExamples().map((r) => r.chat_name);
  assert.ok(held.includes('202383321759941:33'));
  assert.ok(held.includes('919825011122'));
  assert.ok(!held.includes('BOOK N FLY X AADRESS'), 'a named row is not a blank');
});

await run('a number is never written onto a task as its name', () => {
  DB.db.prepare('DELETE FROM tasks').run();
  DB.db
    .prepare(`INSERT INTO tasks (title, chat_name, chat_id, status, source, origin)
              VALUES ('Needs a name', NULL, '120363777@g.us', 'open', 'whatsapp', 'ai')`)
    .run();
  assert.deepEqual(GN.applyGroupName('120363777@g.us', '919825011122'), { messages: 0, tasks: 0 });
  assert.equal(taskNamed('Needs a name').chat_name, null, 'left blank rather than given a number');
});


console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
