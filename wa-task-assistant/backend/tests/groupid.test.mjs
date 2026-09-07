/**
 * Which chat a message came from, without asking WhatsApp.
 *
 * `getChat()` goes back to the browser and can fail, and when it did the row
 * quietly fell back to the *sender's* name as the chat name and recorded the
 * message as not-a-group. A group message then looked exactly like a private
 * one — which is why "Bhavesh · ACCT - SENA GLOBAL DMC" kept coming out as
 * "Bhavesh" on its own: there was no group left in the record to show. Reported
 * five times, and read as a display bug every time, because from the row there
 * is nothing to tell the two apart.
 *
 * WhatsApp's own ids settle it and cost nothing: a group always ends "@g.us".
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-gid-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

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

/** A message whose chat lookup fails, as it does in production. */
const broken = (over = {}) => ({
  id: { _serialized: `m-${Math.random()}` },
  body: 'invoice bhejo', timestamp: Math.floor(Date.now() / 1000),
  from: 'g-sena@g.us', to: 'me@c.us', author: '919199@c.us',
  fromMe: false, isStatus: false, hasMedia: false, type: 'chat', mentionedIds: [],
  getChat: async () => { throw new Error('chat lookup failed'); },
  getContact: async () => { throw new Error('contact lookup failed'); },
  ...over,
});

const stored = () => DB.listMessages({ limit: 50 });
const last = () => stored()[0];

WA.setClientForTests({ info: { wid: { _serialized: 'me@c.us' } }, getChats: async () => [] });

console.log('\nwhen the chat lookup fails');

await run('a group message is still recorded as a group', async () => {
  await WA.handleMessage(broken());
  assert.equal(last().is_group, 1, 'the id ends @g.us, which is all it takes');
});

await run('and the chat is the group, not the person who sent it', async () => {
  // The old fallback put the sender's name here, so the group vanished and the
  // row had one name where it should have had two.
  assert.equal(last().chat_id, 'g-sena@g.us');
  assert.ok(!/^Bhavesh/.test(last().chat_name), `chat_name is ${last().chat_name}`);
});

await run('the sender is taken from the message itself', async () => {
  // In a group the author is on the message, so a failed contact lookup does
  // not have to leave an anonymous row.
  assert.equal(last().contact_name, '919199');
});

await run('a one-to-one message is not mistaken for a group', async () => {
  await WA.handleMessage(broken({ from: '919188@c.us', author: undefined, body: 'seedha message' }));
  assert.equal(last().is_group, 0);
});

await run('failures are counted rather than passing unnoticed', async () => {
  assert.ok(WA.state.chatLookupFailures >= 2, `counted ${WA.state.chatLookupFailures}`);
});

console.log('\na message he sent himself');

await run('the chat is who he sent it to, not his own account', async () => {
  /*
   * On an outgoing message `from` is his own id and `to` is the chat, so the
   * old fallback recorded his own account as the chat for everything he wrote.
   */
  await WA.handleMessage(broken({
    fromMe: true, from: 'me@c.us', to: 'g-booknfly@g.us', body: 'need all tds entry',
  }));
  assert.equal(last().chat_id, 'g-booknfly@g.us');
  assert.equal(last().is_group, 1);
});

console.log('\nwhen the lookup works, nothing changes');

await run('the real group name is used, and the id agrees', async () => {
  await WA.handleMessage(broken({
    from: 'g-acct@g.us',
    getChat: async () => ({ id: { _serialized: 'g-acct@g.us' }, name: 'ACCT - SENA GLOBAL DMC', isGroup: true }),
    getContact: async () => ({ pushname: 'Bhavesh', number: '9199' }),
  }));
  assert.equal(last().chat_name, 'ACCT - SENA GLOBAL DMC');
  assert.equal(last().contact_name, 'Bhavesh');
  assert.equal(last().is_group, 1);
});

console.log('\nand what is already stored is repaired');

await run('a group message saved as not-a-group is corrected by its id', async () => {
  DB.db.prepare(`UPDATE messages SET is_group = 0 WHERE chat_id LIKE '%@g.us'`).run();
  DB.db.prepare(`UPDATE messages SET is_group = 1 WHERE is_group = 0 AND chat_id LIKE '%@g.us'`).run();
  const groups = stored().filter((m) => String(m.chat_id).endsWith('@g.us'));
  assert.ok(groups.length > 0);
  assert.ok(groups.every((m) => m.is_group === 1), 'every one of them');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
