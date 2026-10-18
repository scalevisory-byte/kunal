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

describe('manual mode never sends anything to the AI door', () => {
  it('re-running stored messages does nothing in manual mode', async () => {
    const r = await WA.reprocessStored();
    assert.equal(r.ran, 0);
    assert.match(r.skipped, /manual/);
  });

  it('catch-up after a reconnect goes through his own-message door in manual mode', () => {
    const src = fs.readFileSync(new URL('../src/whatsapp.js', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('export async function catchUp'), src.indexOf('export function loadCounters'));
    assert.match(body, /extractionMode === 'manual' \? handleOwnMessage : handleMessage/);
    assert.doesNotMatch(body, /await handleMessage\(message\)/);
  });
});

/*
 * TSRV, 18 Oct, after TASK_TRIGGER was emptied so every note to himself is a
 * task: "Airfix gst adress change by Tommorow" made nothing. One message can be
 * addressed from his number to his linked identity, so neither "the chat is
 * state.me" nor "from === to" holds, and without a trigger it was dropped.
 */
describe('his own chat, whichever id WhatsApp files it under', () => {
  const now = () => Math.floor(Date.now() / 1000);

  it('a note from his number to his linked identity is a task', async () => {
    WA.resetOwnPollForTests();
    WA.state.myIds = ['919909993565@c.us', '202383321759941@lid'];
    await WA.handleOwnMessage(own('Airfix gst adress change by tomorrow', {
      from: '919909993565@c.us', to: '202383321759941@lid', chatFails: true,
    }));
    assert.ok(titles().some((t) => /Airfix gst adress change/.test(t)));
  });

  it('the poll learns his ids from the page and trusts its own "this is you"', async () => {
    WA.state.myIds = [];
    WA.resetOwnPollForTests(now() - 60);
    const page = { evaluate: async () => ({
      total: 5,
      mine: ['919909993565@c.us', '202383321759941@lid'],
      rows: [{
        id: 'true_202383321759941@lid_X1', body: 'Sena GST refund follow up',
        from: '919909993565@c.us', to: '202383321759941@lid', chat: '202383321759941@lid', self: true, t: now(),
      }],
    }) };
    assert.equal(await WA.pollOwnMessages(page), 1);
    assert.ok(titles().includes('Sena GST refund follow up'));
    assert.deepEqual(WA.state.myIds, ['919909993565@c.us', '202383321759941@lid']);
  });

  it('still ignores an untagged message to somebody else, ids known or not', async () => {
    WA.state.myIds = ['919909993565@c.us', '202383321759941@lid'];
    await WA.handleOwnMessage(own('haan theek hai kal dekhte', { to: '919825011122@c.us' }));
    assert.ok(!titles().some((t) => /dekhte/i.test(t)));
  });

  it('after a restart the poll starts just past the last message it read, at most a day back', async () => {
    const { setMeta } = await import('../src/db.js');
    const last = now() - 3600;
    setMeta('own_poll_last_t', String(last));
    WA.resetOwnPollForTests();
    let asked = null;
    await WA.pollOwnMessages({ evaluate: async (fn, since) => { asked = since; return { total: 0, rows: [], mine: [] }; } });
    assert.equal(asked, last + 1);

    setMeta('own_poll_last_t', String(now() - 5 * 86400));
    WA.resetOwnPollForTests();
    await WA.pollOwnMessages({ evaluate: async (fn, since) => { asked = since; return { total: 0, rows: [], mine: [] }; } });
    assert.ok(asked >= now() - 86400 - 2 && asked <= now() - 86400 + 2);
  });

  it('manual mode never shows messages as "waiting to be read"', () => {
    const src = fs.readFileSync(new URL('../src/routes/system.js', import.meta.url), 'utf8');
    assert.match(src, /waitingToExtract: config\.extractionMode === 'manual' \? 0 : unprocessedCount\(\)/);
  });
});

describe('"tomorrow" as it is typed on a phone', async () => {
  const { parseQuickTask } = await import('../src/quickparse.js');
  const { today } = await import('../src/dates.js');
  const plus = (n) => { const d = new Date(`${today()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  it('"by Tommorow" is tomorrow, and leaves the title', () => {
    const t = parseQuickTask('Airfix gst adress change by Tommorow');
    assert.equal(t.due_date, plus(1));
    assert.equal(t.title, 'Airfix gst adress change');
    for (const w of ['tommorrow', 'tomorow', 'tomorrw', 'tmrw', 'tmr']) {
      assert.equal(parseQuickTask(`Call bank ${w}`).due_date, plus(1), w);
    }
  });

  it('"day after tomorrow" is two days, not one', () => {
    assert.equal(parseQuickTask('Pay rent day after tomorrow').due_date, plus(2));
    assert.equal(parseQuickTask('Pay rent day after tommorow').due_date, plus(2));
  });

  it('a "Task" label line is not the title; "Task test 1" still is', () => {
    assert.equal(parseQuickTask('Task\nAirfix gst address change').title, 'Airfix gst address change');
    assert.equal(parseQuickTask('Task: call bank').title, 'call bank');
    assert.equal(parseQuickTask('Task test 1').title, 'Task test 1');
    assert.equal(parseQuickTask('buy tomatoes').due_date, null);
  });
});

/*
 * "This is a single lead": a forwarded number, a forwarded address and his own
 * "New lead follow-up", sent to himself in the same minute, made two tasks -
 * the address dated Nov 1 from its "1st Floor" - and the number was lost.
 */
describe('a lead sent as several messages is one task', () => {
  const at = (t, body, extra = {}) => ({ ...own(body), timestamp: t, ...extra });
  const row = (title) => db.prepare('SELECT * FROM tasks WHERE title = ?').get(title);

  it('forwards before a note become that note\'s details', async () => {
    WA.resetOwnPollForTests();
    const t = Math.floor(Date.now() / 1000);
    await WA.handleOwnMessage(at(t, '7043767616', { isForwarded: true }));
    await WA.handleOwnMessage(at(t, 'LAXMI TOURS AND TRAVELS\n1st Floor 8 Heta Complex,\nNr LP Savani School, H.P Road,\nAdajan', { isForwarded: true }));
    await WA.handleOwnMessage(at(t + 20, 'New lead follow-up'));
    const task = row('New lead follow-up');
    assert.ok(task, 'the note is the task');
    assert.match(task.description, /7043767616/);
    assert.match(task.description, /LAXMI TOURS/);
    assert.equal(task.due_date, null, '"1st Floor" is not a date');
    assert.ok(!titles().some((x) => /LAXMI/.test(x)), 'the address is not a task of its own');
  });

  it('a forward sent just after the note joins it too', async () => {
    WA.resetOwnPollForTests();
    const t = Math.floor(Date.now() / 1000);
    await WA.handleOwnMessage(at(t, 'Shah Traders quotation follow up'));
    await WA.handleOwnMessage(at(t + 30, '9898012345', { isForwarded: true }));
    assert.match(row('Shah Traders quotation follow up').description, /9898012345/);
  });

  it('notes typed one after another stay separate tasks', async () => {
    WA.resetOwnPollForTests();
    const t = Math.floor(Date.now() / 1000);
    await WA.handleOwnMessage(at(t, 'Bmd visit for Sep salary'));
    await WA.handleOwnMessage(at(t + 5, 'Devangbhai cibil score'));
    assert.ok(row('Bmd visit for Sep salary'));
    assert.ok(row('Devangbhai cibil score'));
  });

  it('a forward with no note becomes a task of its own; a lone number does not', async () => {
    WA.resetOwnPollForTests();
    const t = Math.floor(Date.now() / 1000);
    await WA.handleOwnMessage(at(t, 'Renew Gumasta licence for Arrohan', { isForwarded: true }));
    await WA.handleOwnMessage(at(t, '9909000000', { isForwarded: true }));
    const made = WA.flushMaterial({ all: true });
    assert.equal(made.title, 'Renew Gumasta licence for Arrohan');
    assert.match(made.description, /9909000000/);

    WA.resetOwnPollForTests();
    await WA.handleOwnMessage(at(t, '9909111111', { isForwarded: true }));
    assert.equal(WA.flushMaterial({ all: true }), null);
  });

  it('a bare "15th" is a date only when framed as one', async () => {
    const { parseQuickTask } = await import('../src/quickparse.js');
    assert.equal(parseQuickTask('LAXMI TOURS 1st Floor 8 Heta').due_date, null);
    assert.ok(parseQuickTask('Pay rent by 15th').due_date.endsWith('-15'));
    assert.ok(parseQuickTask('GST 20th tak').due_date.endsWith('-20'));
  });
});
