/**
 * Manual mode on a freshly linked WhatsApp (TSRV, 18 Oct): "#task GST payment
 * check kal 5 baje" sent to himself made no task. Two weak spots in the manual
 * listener: an unguarded getChat() that throws on a fresh link and loses the
 * message, and a self-chat test against his number when WhatsApp files his own
 * chat under his linked identity (@lid). And "Delivered by WhatsApp" stayed 0
 * because manual mode never counted what arrived.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-manual-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const { db } = await import('../src/db.js');
const WA = await import('../src/whatsapp.js');

WA.setClientForTests({ info: { wid: { _serialized: '919909993565@c.us' } }, getChats: async () => [] });
WA.state.status = 'ready';
WA.state.me = '919909993565@c.us';

let n = 0;
const own = (body, { from = '919909993565@c.us', to = '919909993565@c.us', chatFails = false } = {}) => {
  n += 1;
  return {
    id: { _serialized: `m-${n}` }, body, fromMe: true, from, to,
    timestamp: Math.floor(Date.now() / 1000),
    getChat: async () => {
      if (chatFails) throw new Error('Cannot read properties of undefined');
      return { id: { _serialized: to }, name: 'Some chat' };
    },
  };
};
const titles = () => db.prepare('SELECT title FROM tasks').all().map((r) => r.title);

describe('manual capture', () => {
  it('keeps a #task message even when the chat lookup fails', async () => {
    await WA.handleOwnMessage(own('#task GST payment check kal 5 baje', { chatFails: true }));
    assert.ok(titles().includes('GST payment check'));
  });

  it('reads his own chat when WhatsApp files it under his linked identity', async () => {
    await WA.handleOwnMessage(own('Call bank about OD limit', {
      from: '202383321759941@lid', to: '202383321759941@lid', chatFails: true,
    }));
    assert.ok(titles().includes('Call bank about OD limit'));
  });

  it('still ignores an untagged message he sends in somebody else\'s chat', async () => {
    await WA.handleOwnMessage(own('ok bhai kal milte', { to: '919825011122@c.us' }));
    assert.ok(!titles().some((t) => /milte/i.test(t)));
  });

  it('counts every message that arrives, so the panel can say whether any do', async () => {
    const before = WA.state.rawSeen;
    await WA.handleOwnMessage({ ...own('hello'), fromMe: false });
    assert.equal(WA.state.rawSeen, before + 1);
  });
});
