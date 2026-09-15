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

describe('the messages that produced nothing', () => {
  it('names them, and who sent them', async () => {
    const { messagesWithoutTasks, quietSenders } = await import('../src/db.js');
    const row = (waId, chat, who, body) => ({
      wa_message_id: waId, chat_id: `${chat}@x`, chat_name: chat,
      contact_name: who, contact_number: null, body,
      is_group: 1, from_me: 0, sent_at: '2026-09-10 09:00:00',
    });
    insertMessage(row('q1', 'Society', 'Anita', 'Good morning'));
    insertMessage(row('q2', 'Society', 'Anita', 'Forwarded: health tips'));
    const kept = insertMessage(row('q3', 'Society', 'Secretary', 'AGM Sunday - minutes bhejna hai'));
    db.prepare(
      `INSERT INTO tasks (title, message_id, status, priority, source)
       VALUES ('Send AGM minutes', ?, 'open', 'medium', 'whatsapp')`
    ).run(kept);

    const quiet = messagesWithoutTasks({ chat: 'Society' });
    assert.equal(quiet.length, 2, 'only the two that left no mark');
    assert.ok(quiet.every((m) => m.body !== 'AGM Sunday - minutes bhejna hai'));

    const senders = quietSenders(30).filter((q) => q.chat === 'Society');
    assert.equal(senders[0].sender, 'Anita');
    assert.equal(senders[0].messages, 2);
    assert.ok(!senders.some((q) => q.sender === 'Secretary'), 'the one that produced a task is not listed');
  });

  it('leaves out a message that was merged into a task that already existed', async () => {
    const { messagesWithoutTasks, noteMessageMerged } = await import('../src/db.js');
    const id = insertMessage({
      wa_message_id: 'dup', chat_id: 'c@x', chat_name: 'Dup', contact_name: 'A',
      contact_number: null, body: 'wahi kaam phir se', is_group: 0, from_me: 0,
      sent_at: '2026-09-10 09:00:00',
    });
    const task = db.prepare(
      `INSERT INTO tasks (title, status, priority, source) VALUES ('x', 'open', 'medium', 'whatsapp')`
    ).run().lastInsertRowid;
    noteMessageMerged(id, task);

    assert.equal(
      messagesWithoutTasks({ chat: 'Dup' }).length, 0,
      'it did produce something - it recognised work already on the list'
    );
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

/*
 * Whether switching model could pay is a measurement, not an opinion.
 *
 * The page said "not being cached" and stopped, which invites exactly one
 * wrong move: pick a model that caches shorter prompts. That only pays if the
 * calls land close enough together to read a warm entry, and a miss costs more
 * than never asking. These cases pin the two figures that decide it.
 */
describe('could a cache even be hit', () => {
  const at = (iso, kind = 'extract') =>
    db.prepare(
      `INSERT INTO api_usage (at, day, kind, model, input_tokens, messages)
       VALUES (?, ?, ?, 'claude-haiku-4-5', 3200, 3)`
    ).run(iso, iso.slice(0, 10), kind);

  it('counts a run as warm only when the one before it was inside the window', async () => {
    const { cacheReach } = await import('../src/db.js');
    at('2026-09-15 08:00:00');
    at('2026-09-15 08:03:00');   /* 3 min  - warm */
    at('2026-09-15 08:20:00');   /* 17 min - cold */
    at('2026-09-15 08:24:00');   /* 4 min  - warm */

    const reach = cacheReach(30);
    assert.equal(reach.runs, 4);
    assert.equal(reach.warm, 2);
    /* Three gaps between four runs - the first run can never be warm. */
    assert.equal(reach.rate, 2 / 3);
  });

  it('answers null rather than 0% when there is nothing to divide', async () => {
    const { cacheReach } = await import('../src/db.js');
    assert.equal(cacheReach(30).rate, null);
    at('2026-09-15 08:00:00');
    assert.equal(cacheReach(30).rate, null, 'one run has no gap behind it');
  });

  it('measures the extractor only, not the once-a-day digests', async () => {
    const { cacheReach } = await import('../src/db.js');
    at('2026-09-15 08:00:00');
    at('2026-09-15 08:02:00');
    at('2026-09-15 09:00:00', 'law_digest');
    at('2026-09-15 09:01:00', 'legal_digest');

    const reach = cacheReach(30);
    assert.equal(reach.runs, 2, 'a digest is not a chat-reading run');
    assert.equal(reach.warm, 1);
  });

  it('the rate a switch needs is the candidate\'s best case, so a miss can only make it worse', async () => {
    const { cacheBreakEven, PRICES: P, CACHE_WRITE_RATE, CACHE_READ_RATE } = await import('../src/pricing.js');
    const found = cacheBreakEven({ model: 'claude-haiku-4-5', promptTokens: 3200 });
    assert.equal(found.model, 'claude-sonnet-5');

    /* Exactly the rate at which the candidate's cached input equals haiku's. */
    const cheap = P['claude-haiku-4-5'].input;
    const dear = P['claude-sonnet-5'].input;
    const cost = dear * (CACHE_READ_RATE * found.needs + CACHE_WRITE_RATE * (1 - found.needs));
    assert.ok(Math.abs(cost - cheap) < 1e-9, 'break-even must actually break even');
  });

  it('offers no model that would decline this prompt too', async () => {
    const { cacheBreakEven, CACHE_MINIMUM: MIN } = await import('../src/pricing.js');
    const found = cacheBreakEven({ model: 'claude-haiku-4-5', promptTokens: 700 });
    /* Under every minimum but opus-5's 512, so that is the only honest answer. */
    assert.ok(!found || MIN[found.model] <= 700);
  });

  it('never proposes a switch that could not pay at any hit rate', async () => {
    const { cacheBreakEven } = await import('../src/pricing.js');
    for (const model of ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5']) {
      const found = cacheBreakEven({ model, promptTokens: 4096 });
      if (found) assert.ok(found.needs <= 1, `${model} -> ${found.model} needs ${found.needs}`);
    }
  });
});
