/**
 * Where the money goes, and what stops it going there.
 *
 * The bill was ₹175 in one day: six hundred calls, three thousand tokens each,
 * two or three WhatsApp lines per call. Almost all of it was the same
 * instructions re-sent. These cases hold the three things that answer for that
 * - the preamble is offered for caching, cached tokens are priced as cached,
 * and every call says which part of the app made it.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-spend-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'ai';
process.env.TIMEZONE = 'Asia/Kolkata';

const { db, recordUsage, usageByKind, messageVolumeByChat, insertMessage } = await import('../src/db.js');
const { costOf, CACHE_MINIMUM, PRICES } = await import('../src/pricing.js');
const extractor = await import('../src/extractor.js');

beforeEach(() => {
  db.prepare('DELETE FROM api_usage').run();
});

describe('what one call carries', () => {
  it('offers the instructions for caching, and puts nothing volatile before them', async () => {
    let sent = null;
    extractor.setClientForTests({
      messages: {
        parse: async (request) => {
          sent = request;
          return { parsed_output: { tasks: [] }, usage: {}, stop_reason: 'end_turn' };
        },
      },
    });

    await extractor.extractTasks([
      { id: 1, chat_name: 'Meera', contact_name: 'Meera', body: 'invoice bhej dena', sent_at: '2026-09-10 09:00:00' },
    ]);

    assert.ok(Array.isArray(sent.system), 'the system prompt is a block, so it can be marked');
    assert.deepEqual(
      sent.system.at(-1).cache_control, { type: 'ephemeral' },
      'and it is marked - a cached read costs a tenth of a fresh one'
    );

    const prefix = sent.system.map((b) => b.text).join('\n');
    assert.ok(prefix.includes('WhatsApp'), 'the instructions are in it');
    assert.ok(!/Current date:/.test(prefix), 'the date is not: it would change the prefix daily');

    const user = sent.messages[0].content[0].text;
    assert.match(user, /Current date:/, 'the date rides in the user turn instead');
    assert.match(user, /invoice bhej dena/);
  });

  it('sends the business list once, inside the cached block', async () => {
    db.prepare(`INSERT INTO task_groups (name) VALUES ('Book N Fly')`).run();
    let sent = null;
    extractor.setClientForTests({
      messages: {
        parse: async (request) => {
          sent = request;
          return { parsed_output: { tasks: [] }, usage: {}, stop_reason: 'end_turn' };
        },
      },
    });

    await extractor.extractTasks([
      { id: 2, chat_name: 'X', body: 'kuch karna hai', sent_at: '2026-09-10 09:00:00' },
    ]);

    const prefix = sent.system.map((b) => b.text).join('\n');
    assert.ok(prefix.includes('Book N Fly'), 'the list is in the part that gets cached');
    assert.ok(
      !sent.messages[0].content[0].text.includes('Book N Fly'),
      'and not repeated in the part that does not'
    );
  });
});

describe('pricing what was cached', () => {
  it('charges a read at a tenth and a write at a quarter more', () => {
    const model = 'claude-haiku-4-5';
    const rate = PRICES[model].input;

    const fresh = costOf({ model, input_tokens: 1e6 });
    const read = costOf({ model, cache_read: 1e6 });
    const write = costOf({ model, cache_write: 1e6 });

    assert.equal(fresh.usd, rate);
    assert.ok(Math.abs(read.usd - rate * 0.1) < 1e-9, 'a tenth');
    assert.ok(Math.abs(write.usd - rate * 1.25) < 1e-9, 'a quarter more');
  });

  it('does not quietly drop cached tokens from the bill', () => {
    // The old formula counted input_tokens only, so switching caching on would
    // have made the page report a fall in spend that had not happened.
    const both = costOf({ model: 'claude-haiku-4-5', input_tokens: 1000, cache_read: 9000 });
    assert.ok(both.usd > costOf({ model: 'claude-haiku-4-5', input_tokens: 1000 }).usd);
  });

  it('knows this model will not cache a short prompt', () => {
    assert.equal(CACHE_MINIMUM['claude-haiku-4-5'], 4096, 'four thousand, and silent about it');
    assert.equal(CACHE_MINIMUM['claude-sonnet-5'], 1024, 'a quarter of that');
  });
});

describe('who spent it', () => {
  it('separates reading chats from the buttons and the digest', () => {
    recordUsage({ kind: 'extract', model: 'm', input_tokens: 3000, messages: 3, tasks: 1 });
    recordUsage({ kind: 'extract', model: 'm', input_tokens: 3000, messages: 2, tasks: 0 });
    recordUsage({ kind: 'tidy', model: 'm', input_tokens: 9000 });
    recordUsage({ kind: 'law_digest', model: 'm', input_tokens: 14000 });

    const rows = Object.fromEntries(usageByKind(30).map((r) => [r.kind, r]));
    assert.equal(rows.extract.calls, 2);
    assert.equal(rows.extract.input_tokens, 6000);
    assert.equal(rows.tidy.calls, 1);
    assert.equal(rows.law_digest.input_tokens, 14000);
  });

  it('defaults a row with no kind to the one they all used to be', () => {
    db.prepare(
      `INSERT INTO api_usage (day, model, input_tokens) VALUES (date('now'), 'm', 100)`
    ).run();
    const rows = usageByKind(30);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'extract');
  });
});

describe('which chats the volume comes from', () => {
  it('counts messages read and the tasks they produced, busiest first', () => {
    const row = (waId, chat, group) => ({
      wa_message_id: waId, chat_id: `${chat}@x`, chat_name: chat,
      contact_name: chat, contact_number: null, body: 'text',
      is_group: group, from_me: 0, sent_at: '2026-09-10 09:00:00',
    });
    for (let i = 0; i < 5; i += 1) insertMessage(row(`n${i}`, 'Society Group', 1));
    insertMessage(row('m1', 'Meera', 0));

    const rows = messageVolumeByChat(30);
    assert.equal(rows[0].chat, 'Society Group', 'the loudest chat is the one to look at');
    assert.equal(rows[0].messages, 5);
    assert.equal(rows[0].tasks, 0, 'five messages, nothing to show for them');
  });
});
