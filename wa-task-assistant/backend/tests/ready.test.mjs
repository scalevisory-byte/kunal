/**
 * A delivered message is proof of a working connection.
 *
 * whatsapp-web.js does not reliably emit 'ready'. On a busy account the sync
 * stalls at 99% and the event never arrives, while messages are delivered
 * perfectly well throughout — so the dashboard says "still syncing" beside a
 * task list that is visibly growing.
 *
 * That contradiction is not cosmetic, and this is the half worth testing: every
 * path that SENDS is gated on 'ready'. Stuck at authenticated, the app captures
 * everything and can never answer — no digest, no daily briefing, no follow-up,
 * no nudge. Which is exactly the "no WhatsApp message arrived" that was
 * reported and blamed on something else.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ready-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

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

const message = (body, from = '9199@c.us') => ({
  id: { _serialized: `${from}-${body}-${Math.random()}` },
  body, timestamp: Math.floor(Date.now() / 1000), from, to: 'me@c.us',
  fromMe: false, isStatus: false, hasMedia: false, type: 'chat', mentionedIds: [],
  getChat: async () => ({ id: { _serialized: from }, name: 'Booknfly', isGroup: true }),
  getContact: async () => ({ number: '9199', pushname: 'Hasmukh' }),
});

const linkedClient = () => ({
  info: { wid: { _serialized: '919909993565@c.us' }, pushname: 'Scale' },
  getChats: async () => [],
  sendMessage: async () => ({ ok: true }),
});

console.log('\nstuck after logging in');

await run('nothing can be sent while it is only authenticated', async () => {
  WA.state.status = 'authenticated';
  WA.state.me = null;
  WA.setClientForTests(linkedClient());
  await assert.rejects(() => WA.sendMessage('919909993565@c.us', 'hello'), /not ready/);
});

console.log('\na message arriving settles it');

await run('one delivered message is treated as the connection being up', async () => {
  WA.state.status = 'authenticated';
  WA.state.me = null;
  WA.setClientForTests(linkedClient());
  await WA.handleMessage(message('kal tak ledger chahiye'));
  assert.equal(WA.state.status, 'ready');
});

await run('and the account it learns is the one replies go to', async () => {
  // Without this, reminderChatId() has nowhere to send even once it is ready,
  // and nothing can tell his own notes chat from anybody else's.
  assert.equal(WA.state.me, '919909993565@c.us');
  assert.equal(WA.reminderChatId(), '919909993565@c.us');
});

await run('so sending works from then on', async () => {
  await WA.sendMessage(WA.reminderChatId(), 'the digest');   // must not throw
});

await run('the connection log says why it decided that', async () => {
  const said = WA.state.events.filter((e) => e.kind === 'ready').map((e) => e.detail);
  assert.ok(said.some((d) => d && /messages are arriving/.test(d)), said.join(' | '));
});

console.log('\nit does not overreach');

await run('a client that does not yet know who it is stays put', async () => {
  WA.state.status = 'authenticated';
  WA.state.me = null;
  WA.setClientForTests({ info: {}, getChats: async () => [] });
  await WA.handleMessage(message('too early'));
  assert.equal(WA.state.status, 'authenticated', 'no account id means no promotion');
});

await run('a disconnection is not undone by an old message', async () => {
  WA.state.status = 'disconnected';
  WA.setClientForTests(null);
  await WA.handleMessage(message('while offline'));
  assert.equal(WA.state.status, 'disconnected', 'with no client there is nothing to promote');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
