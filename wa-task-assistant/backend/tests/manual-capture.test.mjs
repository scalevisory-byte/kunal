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

describe('when WhatsApp\'s own message event never fires', () => {
  // What page.evaluate would hand back from WhatsApp Web's message collection.
  const fakePage = (rows) => ({ evaluate: async () => rows });
  const now = () => Math.floor(Date.now() / 1000);

  it('reads his own #task straight from the page', async () => {
    WA.resetOwnPollForTests(now() - 60);
    const handled = await WA.pollOwnMessages(fakePage([
      { id: 'true_919909993565@c.us_P1', body: '#task Renew Arrohan trade licence', from: '919909993565@c.us', to: '919909993565@c.us', t: now() },
    ]));
    assert.equal(handled, 1);
    assert.ok(titles().includes('Renew Arrohan trade licence'));
  });

  it('never makes the same task twice when the event and the poll both see it', async () => {
    WA.resetOwnPollForTests(now() - 60);
    const msg = own('#task Send Zynta invoice to Patel');
    msg.id = { $1: 'true_919909993565@c.us_DUP' };   // as WhatsApp Web now names it
    await WA.handleOwnMessage(msg);
    await WA.pollOwnMessages(fakePage([
      { id: 'true_919909993565@c.us_DUP', body: '#task Send Zynta invoice to Patel', from: msg.from, to: msg.to, t: now() },
    ]));
    assert.equal(titles().filter((t) => t === 'Send Zynta invoice to Patel').length, 1);
  });

  it('puts the old key name back on an id that arrives with only $1', () => {
    const m = WA.normaliseMessageId({ id: { fromMe: true, $1: 'true_x@c.us_ABC' } });
    assert.equal(m.id._serialized, 'true_x@c.us_ABC');
  });

  it('a page that cannot answer costs nothing and throws nothing', async () => {
    WA.resetOwnPollForTests(now() - 60);
    assert.equal(await WA.pollOwnMessages({ evaluate: async () => { throw new Error('r'); } }), 0);
    assert.equal(await WA.pollOwnMessages(fakePage(null)), 0);
  });
});

describe('dates written the way he writes them', async () => {
  const { parseQuickTask } = await import('../src/quickparse.js');
  const due = (s) => parseQuickTask(s, { trigger: '#task' });

  it('reads "25 oct 2099" and "oct 25 2099" and takes them out of the title', () => {
    assert.equal(due('#task Sharma ko invoice bhejna 25 oct 2099').due_date, '2099-10-25');
    assert.equal(due('#task Sharma ko invoice bhejna 25 oct 2099').title, 'Sharma ko invoice bhejna');
    assert.equal(due('#task Pay rent oct 25 2099').due_date, '2099-10-25');
    assert.equal(due('#task Audit 5th November 2099').due_date, '2099-11-05');
  });

  it('a month without a year is the next one to come, never one already gone', () => {
    const d = due('#task Renew licence 1 jan').due_date;
    assert.ok(d && d.endsWith('-01-01') && d >= new Date().toISOString().slice(0, 10));
  });

  it('a month word with no day is not a date', () => {
    assert.equal(due('#task May se pehle meeting').due_date, null);
    assert.equal(due('#task 31 nov 2099 filing').due_date, null);
  });
});

describe('his own chat is also where he keeps numbers and links', () => {
  it('a bare number or link sent to himself is not a task', async () => {
    WA.resetOwnPollForTests();
    for (const body of ['9081903590', '`', 'https://maps.app.goo.gl/abc']) await WA.handleOwnMessage(own(body));
    assert.ok(!titles().some((t) => /9081903590|maps\.app|^`$/.test(t)));
  });

  it('words in any script are a task, and #task makes even a number one', async () => {
    await WA.handleOwnMessage(own('Sharma ko invoice bhejna'));
    await WA.handleOwnMessage(own('બેંક જવું'));
    await WA.handleOwnMessage(own('#task 9898475959 ko call'));
    const t = titles();
    assert.ok(t.includes('Sharma ko invoice bhejna'));
    assert.ok(t.includes('બેંક જવું'));
    assert.ok(t.some((x) => x.includes('9898475959')));
  });
});
