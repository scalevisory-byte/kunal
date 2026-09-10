/**
 * A blocked chat that got through anyway.
 *
 * Reported exactly as it happened: CYBER CHATHAN was on the blocked list and
 * its messages kept arriving in Messages read. The check was reading
 * `chat?.name` alone, and `getChat()` fails often enough - a Meta-hosted
 * business chat, a contact that will not resolve - that a message whose name
 * the *row* worked out perfectly well was tested against nothing at all.
 *
 * These hold the rule the panel promises: if the name it is stored under
 * matches the blocklist, it is never stored.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-block-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'ai';
process.env.TIMEZONE = 'Asia/Kolkata';
process.env.BATCH_QUIET_SECONDS = '30';

const { db, listBlockedChats, blockChat, unblockChat } = await import('../src/db.js');
const WA = await import('../src/whatsapp.js');

WA.setClientForTests({ info: { wid: { _serialized: 'me@c.us' } }, getChats: async () => [] });
WA.state.status = 'ready';
WA.state.me = 'me@c.us';

let n = 0;
/** A message whose chat lookup behaves as the caller says. */
const message = ({ chat, contact, from = '919111111111@c.us', body = 'Upto 72% off, buy here' } = {}) => {
  n += 1;
  return {
    id: { _serialized: `blk-${n}` },
    body,
    timestamp: Math.floor(Date.now() / 1000),
    from,
    to: 'me@c.us',
    fromMe: false,
    isStatus: false,
    hasMedia: false,
    type: 'chat',
    mentionedIds: [],
    getChat: chat === 'fails'
      ? async () => { throw new Error('chat lookup failed'); }
      : async () => chat,
    getContact: contact === 'fails'
      ? async () => { throw new Error('contact lookup failed'); }
      : async () => contact,
  };
};

const stored = () => db.prepare('SELECT chat_name, body FROM messages').all();

beforeEach(() => {
  db.prepare('DELETE FROM messages').run();
  for (const row of listBlockedChats()) unblockChat(row.id);
  WA.state.blockedCount = 0;
});

describe('a whole group', () => {
  const groupMessage = (extra = {}) => {
    const m = message({
      from: '120363111@g.us',
      body: 'Forwarded: 10 tips for interviews',
      ...extra,
    });
    m.author = '919333333333@c.us';
    return m;
  };

  it('is dropped whoever in it is writing', async () => {
    blockChat('LeDroit India');
    const chat = { id: { _serialized: '120363111@g.us' }, name: 'LeDroit India 36', isGroup: true };

    // Three different people, one blocked group.
    for (const who of ['Ramesh', 'Priya', 'Kiran']) {
      await WA.handleMessage(groupMessage({ chat, contact: { pushname: who, number: '9193333333' } }));
    }
    assert.equal(stored().length, 0, 'nobody in a blocked group gets through');
    assert.equal(WA.state.blockedCount, 3);
  });

  it('is dropped when the group name is only known from the id', async () => {
    /*
     * The gap this found. When getChat() fails on a group, the row still gets
     * its name - the app asks WhatsApp for it by id, and caches the answer -
     * but that lookup happened AFTER the block check, so a group blocked by
     * name was stored under exactly the name it was blocked by.
     */
    WA.setGroupNameForTests('120363111@g.us', 'LeDroit India 36');
    blockChat('LeDroit India');
    await WA.handleMessage(groupMessage({
      chat: 'fails',
      contact: { pushname: 'Ramesh', number: '9193333333' },
    }));
    assert.deepEqual(stored(), [], 'the name it would be filed under is the name it was blocked by');
  });
});

describe('a chat on the blocked list', () => {
  it('is dropped when WhatsApp names it', async () => {
    blockChat('CYBER CHATHAN');
    await WA.handleMessage(message({
      chat: { id: { _serialized: '919111111111@c.us' }, name: 'CYBER CHATHAN', isGroup: false },
      contact: { pushname: 'CYBER CHATHAN', number: '919111111111' },
    }));
    assert.equal(stored().length, 0);
    assert.equal(WA.state.blockedCount, 1);
  });

  it('is dropped when the chat lookup fails and only the contact has the name', async () => {
    // The reported bug. The row would have been stored as "CYBER CHATHAN"
    // because that is what the contact says, but the block check never saw it.
    blockChat('CYBER CHATHAN');
    await WA.handleMessage(message({
      chat: 'fails',
      contact: { pushname: 'CYBER CHATHAN', number: '919111111111' },
    }));
    assert.deepEqual(stored(), [], 'stored under a name it was told never to store');
    assert.equal(WA.state.blockedCount, 1);
  });

  it('is dropped on a message he sent into it', async () => {
    blockChat('CYBER CHATHAN');
    const own = message({
      chat: 'fails',
      contact: { pushname: 'CYBER CHATHAN', number: '919111111111' },
      body: 'ok',
    });
    own.fromMe = true;
    own.from = 'me@c.us';
    own.to = '919111111111@c.us';
    await WA.handleMessage(own);
    assert.equal(stored().length, 0, 'his own end of a blocked chat is still that chat');
  });

  it('is dropped by number when nothing has a name at all', async () => {
    blockChat('919111111111');
    await WA.handleMessage(message({ chat: 'fails', contact: 'fails' }));
    assert.equal(stored().length, 0);
  });

  it('still lets an unblocked chat through', async () => {
    blockChat('CYBER CHATHAN');
    await WA.handleMessage(message({
      chat: 'fails',
      contact: { pushname: 'Meera Jariwala', number: '919222222222' },
      from: '919222222222@c.us',
      body: 'GST invoice bhej dena',
    }));
    assert.equal(stored().length, 1);
    assert.equal(stored()[0].chat_name, 'Meera Jariwala');
  });
});
