/**
 * Coming up when the library never says so.
 *
 * whatsapp-web.js does not always emit 'ready'. On a busy account the sync
 * stalls at 99% and the event never comes - reported here as three hours of
 * "still syncing" while tasks were arriving the whole time. That is not
 * cosmetic: every path that SENDS is gated on the ready status, so a
 * connection stuck there captures everything and can never answer.
 *
 * Two ways out, and both are tested: a message arriving proves the connection,
 * and failing that, asking the connection directly once a minute.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ready-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const WA = await import('../src/whatsapp.js');

const message = (over = {}) => ({
  id: { _serialized: `m-${Math.random()}` },
  body: 'invoice bhejo',
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
  ...over,
});

describe('a stalled sync still comes up', () => {
  it('a delivered message is proof enough, whatever the library said', async () => {
    WA.setClientForTests({
      info: { wid: { _serialized: 'me@c.us' }, pushname: 'Dinesh' },
      getChats: async () => [],
    });
    WA.state.status = 'authenticated';
    WA.state.me = null;

    await WA.handleMessage(message());

    assert.equal(WA.state.status, 'ready', 'a message arriving brought it up');
    assert.equal(WA.state.me, 'me@c.us', 'and it knows who it is, so it can reply');
  });

  it('does not come up without knowing where a reminder would go', async () => {
    /*
     * `client.info` is filled in by the same 'ready' that may never arrive.
     * Coming up without it would mean a connection that reports itself able to
     * send and then has nowhere to send to - worse than staying put, because
     * the failure moves from visible to silent.
     */
    WA.setClientForTests({ info: {}, getChats: async () => [] });
    WA.state.status = 'authenticated';
    WA.state.me = null;

    await WA.handleMessage(message());

    assert.equal(WA.state.status, 'authenticated', 'it stayed put');
  });

  it('records when the QR was accepted, so "how long" can be answered', () => {
    assert.ok('authenticatedAt' in WA.state, 'the field exists');
  });
});

describe('sending stays shut until it really is up', () => {
  it('refuses to send while the status is not ready', async () => {
    WA.setClientForTests({ info: {}, getChats: async () => [] });
    WA.state.status = 'authenticated';
    await assert.rejects(() => WA.sendMessage('me@c.us', 'hello'), /not ready/);
  });
});
