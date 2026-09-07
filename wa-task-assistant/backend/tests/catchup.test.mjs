/**
 * Messages that arrived while this was not running.
 *
 * The client only hears what is sent while it is connected; there is no replay.
 * Every restart is therefore a hole — a request sent on Tuesday afternoon, with
 * the service redeployed that evening, is seen by nothing and becomes no task,
 * and nobody knows it was lost. That is the worst property a capture tool can
 * have, and this session alone redeployed a dozen times.
 *
 * What the tests are really guarding is the other side: reading history is how
 * you turn one boot into a very large API bill, so every bound here matters
 * more than the feature does.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-catchup-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';
process.env.CATCH_UP_PER_CHAT = '5';
process.env.CATCH_UP_MAX = '8';

const DB = await import('../src/db.js');
const WA = await import('../src/whatsapp.js');

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

const secs = (iso) => Math.floor(new Date(iso).getTime() / 1000);

/** A message as whatsapp-web.js hands one over. */
const msg = (body, at, from = '9199@c.us') => ({
  id: { _serialized: `${from}-${at}-${body}` },
  body, timestamp: secs(at), from, to: 'me@c.us', fromMe: false,
  isStatus: false, hasMedia: false, type: 'chat',
  mentionedIds: [],
  getChat: async () => ({ id: { _serialized: from }, name: 'Legal team', isGroup: true }),
  getContact: async () => ({ number: '9199', pushname: 'Hasmukh' }),
});

/** A stub client with the chats and messages a catch-up would find. */
function stub(chats) {
  return {
    getChats: async () => chats,
    info: { wid: { _serialized: 'me@c.us' } },
  };
}

const chat = (unread, messages) => ({
  unreadCount: unread,
  fetchMessages: async ({ limit }) => messages.slice(-limit),
});

const seen = () => DB.listTasks({ status: 'all', limit: 500 }).length;
const messages = () => DB.listMessages({ limit: 500 }).length;

console.log('\nthe first boot has no gap to fill');

await run('with nothing ever seen, it reads nothing and starts the clock', async () => {
  /*
   * The one case where "catch up" would mean the whole of history. With no
   * record of what has been seen, now is the only honest starting point.
   */
  let asked = false;
  WA.setClientForTests({ getChats: async () => { asked = true; return []; } });
  await WA.catchUp();
  assert.equal(asked, false, 'it did not even list the chats');
  assert.ok(DB.getMeta('last_message_at'), 'but it recorded where to start from');
});

console.log('\nafter an outage');

await run('messages newer than the last one seen are read', async () => {
  DB.setMeta('last_message_at', '2026-09-07T04:00:00.000Z');
  WA.setClientForTests(stub([
    chat(2, [msg('older, already seen', '2026-09-07T03:00:00Z'),
             msg('Send Notice to Odisha Vacation', '2026-09-07T05:00:00Z'),
             msg('and this one too', '2026-09-07T05:30:00Z')]),
  ]));
  const before = messages();
  await WA.catchUp();
  assert.equal(messages() - before, 2, 'the two after the watermark, not the one before');
});

await run('a chat with nothing unread is never fetched from', async () => {
  DB.setMeta('last_message_at', '2026-09-07T04:00:00.000Z');
  let fetched = false;
  WA.setClientForTests(stub([
    { unreadCount: 0, fetchMessages: async () => { fetched = true; return []; } },
  ]));
  await WA.catchUp();
  assert.equal(fetched, false, 'unread is what marks the gap');
});

console.log('\nthe bounds, which are the point');

await run('each chat gives up only so many', async () => {
  DB.setMeta('last_message_at', '2026-09-07T04:00:00.000Z');
  let askedFor = null;
  WA.setClientForTests(stub([
    { unreadCount: 400, fetchMessages: async ({ limit }) => { askedFor = limit; return []; } },
  ]));
  await WA.catchUp();
  assert.equal(askedFor, 5, 'CATCH_UP_PER_CHAT, not the 400 unread');
});

await run('and the total is capped across all of them', async () => {
  DB.setMeta('last_message_at', '2026-09-07T04:00:00.000Z');
  const many = Array.from({ length: 5 }, (_, c) =>
    chat(5, Array.from({ length: 5 }, (_, i) =>
      msg(`chat ${c} message ${i}`, `2026-09-07T0${5 + (i % 4)}:0${c}:00Z`, `chat${c}@g.us`))));
  const before = messages();
  WA.setClientForTests(stub(many));
  await WA.catchUp();
  const read = messages() - before;
  assert.ok(read <= 8, `read ${read}, cap is 8`);
  assert.ok(read > 0, 'and it did read some');
});

await run('one unreadable chat does not abandon the rest', async () => {
  DB.setMeta('last_message_at', '2026-09-07T04:00:00.000Z');
  const before = messages();
  WA.setClientForTests(stub([
    { unreadCount: 3, fetchMessages: async () => { throw new Error('chat gone'); } },
    chat(1, [msg('this one still gets read', '2026-09-07T06:00:00Z', 'ok@g.us')]),
  ]));
  await WA.catchUp();
  assert.equal(messages() - before, 1);
});

await run('a client that cannot list chats at all is survived', async () => {
  DB.setMeta('last_message_at', '2026-09-07T04:00:00.000Z');
  WA.setClientForTests({ getChats: async () => { throw new Error('not ready'); } });
  await WA.catchUp();   // must not throw
});

console.log('\nthe watermark moves as messages arrive');

await run('a message that is stored records where to resume from', async () => {
  const at = '2026-09-07T09:15:00.000Z';
  WA.setClientForTests(stub([]));
  await WA.handleMessage(msg('a live message', at, 'live@g.us'));
  const mark = DB.getMeta('last_message_at');
  assert.ok(mark >= '2026-09-07T09:15', `watermark is ${mark}`);
});

await run('so the next catch-up does not read it a second time', async () => {
  const before = messages();
  WA.setClientForTests(stub([
    chat(1, [msg('a live message', '2026-09-07T09:15:00.000Z', 'live@g.us')]),
  ]));
  await WA.catchUp();
  assert.equal(messages(), before, 'nothing new: it is not after the watermark');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
