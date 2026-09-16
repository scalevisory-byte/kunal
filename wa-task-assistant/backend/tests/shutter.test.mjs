/**
 * Three things asked for at once, on one screen each.
 *
 * "is tab ko minimize ya shutter bandh karne ka option do" - six unsure
 * extractions were the whole first screen of the dashboard, and they are the
 * least urgent thing on it, because nothing there is being chased.
 *
 * "kya block he kya unblock he proper kuch pata nahi chal raha" - every row in
 * the busiest-chats list carried the same "Block this chat" button whether it
 * was already blocked or not, so the only way to know was to remember.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-shutter-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'ai';
process.env.TIMEZONE = 'Asia/Kolkata';

const { db, insertMessage, blockChat, messageVolumeByChat } = await import('../src/db.js');
const read = (p) => fs.readFileSync(new URL(`../../frontend/src/${p}`, import.meta.url), 'utf8');

beforeEach(() => {
  db.prepare('DELETE FROM messages').run();
  db.prepare('DELETE FROM blocked_chats').run();
});

const arrived = (chat, n, group = 1) => {
  for (let i = 0; i < n; i++) {
    insertMessage({
      wa_message_id: `${chat}-${i}-${Math.random()}`, chat_id: `${chat}@g.us`, chat_name: chat,
      contact_name: 'Someone', contact_number: '919000000000', body: `msg ${i}`,
      is_group: group, from_me: 0, sent_at: new Date().toISOString(),
    });
  }
};

describe('which chats are blocked', () => {
  it('says so on the row, and names the pattern that does it', () => {
    arrived('CYBER CHATHAN', 5);
    arrived('Surat Final Accountant Job', 7);
    blockChat('cyber chathan');

    const rows = messageVolumeByChat(30);
    const cyber = rows.find((r) => r.chat === 'CYBER CHATHAN');
    const surat = rows.find((r) => r.chat === 'Surat Final Accountant Job');
    assert.equal(cyber.blockedBy?.pattern, 'cyber chathan');
    assert.equal(surat.blockedBy, null, 'a chat nobody blocked must not be marked');
  });

  it('decides it with the listener\'s own rule, not by matching the name', () => {
    /* "aditya" blocks "Aditya Consultancy": a list that compared names would
       go on offering to block a chat that is already blocked. */
    arrived('Aditya Consultancy', 4);
    blockChat('aditya');
    assert.ok(messageVolumeByChat(30)[0].blockedBy, 'the loose rule must apply here too');
  });

  it('carries the id, so the row itself can lift the block', () => {
    arrived('Taxscan', 3);
    blockChat('Taxscan');
    const row = messageVolumeByChat(30)[0];
    assert.equal(typeof row.blockedBy.id, 'number');
  });

  it('offers Unblock where it is blocked and Block where it is not', () => {
    const page = read('components/UsagePage.jsx');
    assert.match(page, /\{cover \? \(/);
    assert.match(page, /Unblock this chat/);
    assert.match(page, /Block this chat/);
    assert.match(page, /className="chat-blocked"/, 'the row itself must say so');
  });
});

describe('putting the unsure panel away', () => {
  const panel = read('components/NeedsConfirmation.jsx');

  it('rolls up and stays rolled up', () => {
    assert.match(panel, /localStorage\.getItem\(SHUT\)/);
    assert.match(panel, /localStorage\.setItem\(SHUT/);
  });

  it('keeps the count on the header when it is shut', () => {
    /* Put away and never mentioned again is how work goes missing. The header
       - count included - is outside the collapsed part. */
    const header = panel.match(/<header>[\s\S]*?<\/header>/)?.[0] ?? '';
    assert.match(header, /\{tasks\.length\} waiting/);
    assert.ok(panel.indexOf('</header>') < panel.indexOf('{shut ? null :'),
      'the header must not be inside the part that collapses');
  });

  it('survives a browser that refuses storage', () => {
    assert.match(panel, /catch \{ return false; \}/);
    assert.match(panel, /catch \{ \/\* private window \*\/ \}/);
  });
});
