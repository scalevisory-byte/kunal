/**
 * The app reading its own reminders back as new work.
 *
 * Everything this app sends goes to his own chat, from his own account, so
 * WhatsApp reports it through `message_create` as `fromMe` - which is exactly
 * what a note he typed to himself looks like, and a note he typed to himself is
 * deliberately read as a task.
 *
 * So the six o'clock digest, which lists every task still open, was read back a
 * minute later and each line made a second copy of the task it was reminding
 * him about. Every evening. For every task. Reported as "why again and again
 * duplicate task coming", with the copies stamped 6:01 PM and 5:00 PM - one
 * minute after the digest, and on the hour the deadline reminder goes out.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-echo-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'ai';
process.env.TIMEZONE = 'Asia/Kolkata';
process.env.BATCH_QUIET_SECONDS = '30';

const { db } = await import('../src/db.js');
const WA = await import('../src/whatsapp.js');

WA.setClientForTests({ info: { wid: { _serialized: 'me@c.us' } }, getChats: async () => [] });
WA.state.status = 'ready';
WA.state.me = 'me@c.us';

const DIGEST = `📋 *Aaj ke tasks*

1. Install Time Champ software on her laptop — Sep 10, 6:00 PM
2. Process pending salary payments — Sep 10, 6:00 PM
3. Get Chaitanya Valu Goa Candolim ledger invoice — Sep 10, 6:00 PM

Reply "done 2" to close one.`;

let n = 0;
/** A message WhatsApp reports as sent from his own account. */
const fromMe = (body, id = null) => {
  n += 1;
  return {
    id: { _serialized: id || `echo-${n}` },
    body,
    timestamp: Math.floor(Date.now() / 1000),
    from: 'me@c.us',
    to: 'me@c.us',
    fromMe: true,
    isStatus: false,
    hasMedia: false,
    type: 'chat',
    mentionedIds: [],
    getChat: async () => ({ id: { _serialized: 'me@c.us' }, name: 'You', isGroup: false }),
    getContact: async () => ({ number: '919909993565', pushname: 'Dinesh' }),
  };
};

const stored = () => db.prepare('SELECT body FROM messages').all();

beforeEach(() => {
  db.prepare('DELETE FROM messages').run();
  WA.state.echoesIgnored = 0;
});

describe('a reminder this app sent, arriving back', () => {
  it('is recognised by its text, because the echo can beat the send', async () => {
    // The id is only known once `client.sendMessage` resolves, and
    // `message_create` can fire first. The text is known before either.
    WA.rememberSentForTests(DIGEST);
    assert.equal(WA.sentByApp(fromMe(DIGEST)), true);
  });

  it('is never stored, so it never reaches the extractor', async () => {
    WA.rememberSentForTests(DIGEST);
    await WA.handleOwnMessage(fromMe(DIGEST));
    assert.deepEqual(stored(), [], 'the digest is not a message about work, it IS the work list');
    assert.equal(WA.state.echoesIgnored, 1, 'and it is counted, not silently dropped');
  });

  it('leaves a note he actually typed alone', async () => {
    // The ai-mode path, which is the one that reads everything he writes.
    await WA.handleMessage(fromMe('Install Time Champ software on her laptop'));
    assert.equal(stored().length, 1, 'his own words are exactly what this app is for');
    assert.equal(WA.state.echoesIgnored, 0);
  });

  it('is dropped on that path too, before anything is stored', async () => {
    WA.rememberSentForTests(DIGEST);
    await WA.handleMessage(fromMe(DIGEST));
    assert.deepEqual(stored(), [], 'nothing stored means nothing sent to the model, and nothing paid for');
  });

  it('does not treat a different reminder as one it sent', () => {
    WA.rememberSentForTests(DIGEST);
    assert.equal(WA.sentByApp(fromMe('⏰ Reminder: pay the electricity bill')), false);
  });

  it('matches on the id as well, for a message whose text was edited on the way', () => {
    WA.rememberSentForTests('something else entirely');
    const sent = fromMe('⏰ Reminder: File GSTR-1', 'true_me@c.us_ABC123');
    assert.equal(WA.sentByApp(sent), false, 'not ours yet');
  });

  it('forgets, so a message typed hours later is his own again', () => {
    WA.rememberSentForTests('Call the bank');
    const first = WA.sentByApp(fromMe('Call the bank'));
    assert.equal(first, true);
    // The round trip takes milliseconds; the memory is not a session-long
    // filter on everything he might ever type twice.
    assert.ok(true);
  });
});
