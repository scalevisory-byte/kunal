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

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
