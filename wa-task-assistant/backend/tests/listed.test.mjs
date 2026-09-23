/*
 * "Jitni chat add kare wahi read kare, aur usme se task aaye" - read only the
 * chats he lists, and make tasks only from those.
 *
 * The other shape of chat filtering beside the blocklist. The cases here pin
 * the three things that would make it dangerous: silencing his own notes chat,
 * switching into reading nothing, and paying to read a chat before knowing
 * whether it is kept.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-listed-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';
delete process.env.DASHBOARD_PASSWORD;

const DB = await import('../src/db.js');
const { readsChat, isListedChat } = await import('../src/blocklist.js');
const { saveSettings, getSettings } = await import('../src/scheduling.js');
const { createServer } = await import('../src/server.js');

const wa = fs.readFileSync(new URL('../src/whatsapp.js', import.meta.url), 'utf8');

let server; let base;
before(async () => {
  server = await new Promise((resolve) => { const s = createServer().listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = async (method, url, body) => {
  const res = await fetch(`${base}/api${url}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

beforeEach(() => {
  DB.db.prepare('DELETE FROM allowed_chats').run();
  DB.db.prepare('DELETE FROM blocked_chats').run();
  saveSettings({ onlyListedChats: false });
});

const ME = '919909900000@c.us';
const rows = (...patterns) => patterns.map((pattern, i) => ({ id: i + 1, pattern }));

describe('which chats are read', () => {
  it('reads everything when the mode is off, list or no list', () => {
    assert.equal(readsChat({ onlyListed: false, rows: [], names: ['Anybody'], chatId: 'x@c.us' }), true);
  });

  it('reads only a listed chat when it is on', () => {
    const list = rows('Sena Global');
    const at = (names, chatId) => readsChat({ onlyListed: true, rows: list, selfId: ME, names, chatId });
    assert.equal(at(['ACCT - SENA GLOBAL DMC'], '1203@g.us'), true, 'a listed name, spelt loosely');
    assert.equal(at(['Family ❤️'], '555@g.us'), false, 'an unlisted chat');
  });

  it('never silences his own notes chat', () => {
    // That is where tasks are written down on purpose.
    assert.equal(readsChat({ onlyListed: true, rows: [], selfId: ME, names: [], chatId: ME }), true);
  });

  it('tests every name the chat could be filed under, and an id exactly', () => {
    const list = rows('Vikas Gupta', '120363999@g.us');
    assert.equal(isListedChat(list, { names: [null, 'Vikas Gupta'], chatId: '91980@c.us' }), true,
      'the chat lookup failed and only the contact had the name');
    assert.equal(isListedChat(list, { names: [], chatId: '120363999@g.us' }), true, 'a whole id');
    assert.equal(isListedChat(list, { names: [], chatId: '120363999000@g.us' }), false, 'not a prefix of one');
  });
});

describe('the listener decides before it pays', () => {
  const body = wa.slice(wa.indexOf('export async function handleMessage'));
  it('checks the block, then the list, then reads photos and voice notes', () => {
    const block = body.indexOf("return drop('blocked');\n    }\n\n    /*\n     * Only the chats he listed");
    const list = body.indexOf('readsChat({');
    const photo = body.indexOf('await downloadImage(message)');
    const voice = body.indexOf('await transcribeVoice(message)');
    const store = body.indexOf('insertMessage(row)');
    assert.ok(block > 0 && block < list, 'a block must win over a listing');
    assert.ok(list < photo && list < voice, 'an unlisted chat must not be paid for');
    assert.ok(list < store, 'an unlisted chat must not be stored');
  });

  it('applies the same list to the "read them now" road', () => {
    const re = wa.slice(wa.indexOf('export async function reprocessStored'));
    assert.ok(re.indexOf('readsChat(') > -1 && re.indexOf('readsChat(') < re.indexOf('processBatch('));
  });
});

describe('the switch and the list', () => {
  it('refuses to switch on with an empty list, because that reads nothing', async () => {
    const res = await call('POST', '/listed-chats/mode', { on: true });
    assert.equal(res.status, 400);
    assert.equal(getSettings().onlyListedChats, false);
  });

  it('adds by picking a chat, keeps its name, and says what each entry matches', async () => {
    DB.insertMessage({ wa_message_id: 'm1', chat_id: '1203@g.us', chat_name: 'ACCT - SENA GLOBAL DMC', contact_name: 'B',
      contact_number: null, body: 'hi', is_group: 1, from_me: 0, sent_at: new Date().toISOString() });
    let res = await call('POST', '/listed-chats', { pattern: '1203@g.us', label: 'ACCT - SENA GLOBAL DMC' });
    assert.equal(res.status, 201);
    res = await call('POST', '/listed-chats', { pattern: 'nobody by this name' });
    const [byId, byTypo] = [res.body.listed.find((r) => r.pattern === '1203@g.us'), res.body.listed.find((r) => r.pattern === 'nobody by this name')];
    assert.equal(byId.label, 'ACCT - SENA GLOBAL DMC');
    assert.equal(byId.matches, 1);
    assert.equal(byTypo.matches, 0, 'a name that catches nothing must say so');
    assert.equal(res.body.chats.find((c) => c.chat_id === '1203@g.us').listed, true);
  });

  it('switches on once there is a list, and back off when the last entry goes', async () => {
    await call('POST', '/listed-chats', { pattern: 'Sena' });
    let res = await call('POST', '/listed-chats/mode', { on: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.on, true);
    res = await call('DELETE', `/listed-chats/${res.body.listed[0].id}`);
    assert.equal(res.body.switchedOff, true);
    assert.equal(getSettings().onlyListedChats, false, 'an empty list must not leave it reading nothing');
  });
});
