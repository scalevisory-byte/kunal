/**
 * When a batch of messages actually goes out.
 *
 * The quiet window is a courtesy: a conversation arrives as one thought rather
 * than as six separate half-tasks. On its own it is also a debounce with no
 * maximum, and on a real working account - two hundred chats, messages landing
 * seconds apart all morning - the deadline was pushed back by every new
 * message and the batch was never sent at all. Reported as "task add hi nahi
 * hue": a morning of traffic and one task.
 *
 * These tests hold the ceiling that stops the courtesy becoming a refusal.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-batch-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';
// Short enough to test in real time, same shape as production.
process.env.BATCH_QUIET_SECONDS = '1';
process.env.BATCH_MAX_WAIT_SECONDS = '3';
process.env.BATCH_MAX_MESSAGES = '5';

const { config } = await import('../src/config.js');
const WA = await import('../src/whatsapp.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let n = 0;
const message = () => {
  n += 1;
  return {
    id: { _serialized: `m-${n}-${Math.random()}` },
    body: `invoice ${n} bhejo`,
    timestamp: Math.floor(Date.now() / 1000),
    from: '919909993565@c.us',
    to: 'me@c.us',
    fromMe: false,
    isStatus: false,
    hasMedia: false,
    type: 'chat',
    mentionedIds: [],
    getChat: async () => ({ id: { _serialized: '919909993565@c.us' }, name: 'Meera', isGroup: false }),
    getContact: async () => ({ pushname: 'Meera', number: '919909993565' }),
  };
};

WA.setClientForTests({
  info: { wid: { _serialized: 'me@c.us' }, pushname: 'Dinesh' },
  getChats: async () => [],
});
WA.state.status = 'ready';
WA.state.me = 'me@c.us';

describe('the settings that bound the wait', () => {
  it('reads a ceiling and a size cap, not just a quiet window', () => {
    assert.equal(config.batchQuietMs, 1000);
    assert.equal(config.batchMaxWaitMs, 3000);
    assert.equal(config.batchMaxMessages, 5);
  });
});

describe('a steady stream still gets through', () => {
  it('goes out on the ceiling even when messages never stop', async () => {
    /*
     * A message every 400ms, for four seconds. The quiet window is one second
     * and is therefore never reached - which is the exact shape of the bug.
     * The ceiling is three seconds, so the buffer must empty before the end.
     */
    let drained = false;
    const stream = (async () => {
      for (let i = 0; i < 10; i += 1) {
        await WA.handleMessage(message());
        await wait(400);
        if (WA.state.bufferedCount === 0 && i > 2) drained = true;
      }
    })();
    await stream;
    assert.ok(drained, 'the buffer emptied at least once while messages kept arriving');
  });

  it('a full batch does not wait for quiet at all', async () => {
    // Five is the cap here; sending five back to back must empty it without
    // any pause between them.
    for (let i = 0; i < 5; i += 1) await WA.handleMessage(message());
    await wait(50);
    assert.equal(WA.state.bufferedCount, 0, 'it went as soon as it was full');
  });

  it('a quiet conversation still waits, so it arrives as one batch', async () => {
    await WA.handleMessage(message());
    await WA.handleMessage(message());
    // Well inside the quiet window: it must NOT have gone yet.
    await wait(300);
    assert.equal(WA.state.bufferedCount, 2, 'still gathering');
    await wait(1200);
    assert.equal(WA.state.bufferedCount, 0, 'and then it went');
  });
});

describe('messages that were never extracted can be run again', () => {
  it('counts what is waiting and puts every one of them through', async () => {
    const DB = await import('../src/db.js');
    // A message the pipeline took in and never sent: exactly the shape a
    // deferred batch or a failed API call leaves behind.
    DB.insertMessage({
      wa_message_id: `stranded-${Math.random()}`,
      chat_id: '919909993565@c.us',
      chat_name: 'Meera',
      contact_name: 'Meera',
      contact_number: '919909993565',
      body: 'kal tak invoice bhej dena',
      is_group: 0,
      from_me: 0,
      sent_at: new Date().toISOString(),
    });

    const waiting = DB.unprocessedCount();
    assert.ok(waiting > 0, 'something is waiting');

    const out = await WA.reprocessStored({ limit: 500 });
    assert.equal(out.ran, waiting, 'it ran every one of them');
    assert.ok(out.batches >= 1, 'in at least one batch');
  });

  it('leaves them waiting when the extractor fails, so nothing is lost', async () => {
    /*
     * There is no API key in a test run, so extraction fails - which is the
     * same shape as the API being down in production. A message must survive
     * that: marked processed only when a batch genuinely came back, so it is
     * still there to be run again. This is the guarantee that makes the
     * re-run button safe to press twice.
     */
    const DB = await import('../src/db.js');
    assert.ok(DB.unprocessedCount() > 0, 'still waiting after a failed run');

    const again = await WA.reprocessStored({ limit: 500 });
    assert.ok(again.ran > 0, 'and a second press picks them up again');
  });

  it('refuses to start a second run over the first', async () => {
    const [a, b] = await Promise.all([WA.reprocessStored(), WA.reprocessStored()]);
    const skipped = [a, b].filter((r) => r.skipped);
    assert.equal(skipped.length, 1, 'exactly one of the two stood down');
  });
});
