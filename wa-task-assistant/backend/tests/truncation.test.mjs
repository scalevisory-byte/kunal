/**
 * An answer that ran out of room must not read as "nothing here".
 *
 * A batch of forty messages can carry a lot of work. When the reply hits the
 * token ceiling it comes back half-written: it fails the schema, the parsed
 * output is null, and the old code read that as an empty answer and marked
 * every message in the batch as read. The messages were gone and the tasks
 * were never made - reported as "there is more task, couldn't read properly".
 *
 * These hold the two guarantees that fix it: a cut-off answer is split and
 * asked again, and an unreadable one fails loudly so the messages survive.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-trunc-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'ai';
process.env.ANTHROPIC_API_KEY = 'test-key-not-used';
process.env.TIMEZONE = 'Asia/Kolkata';

const extractor = await import('../src/extractor.js');

const messages = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    chat_id: '919909993565@c.us',
    chat_name: 'Meera',
    contact_name: 'Meera',
    body: `invoice ${i} bhej dena`,
    is_group: 0,
    from_me: 0,
    sent_at: new Date().toISOString(),
  }));

/** Stand in for the Anthropic client, one scripted reply per call. */
function scripted(replies) {
  let call = 0;
  const calls = [];
  const client = {
    messages: {
      parse: async (req) => {
        calls.push(req);
        const reply = replies[Math.min(call, replies.length - 1)];
        call += 1;
        return { usage: {}, ...reply };
      },
    },
  };
  extractor.setClientForTests(client);
  return calls;
}

const task = (title) => ({
  title, description: '', contact: '', chat_name: 'Meera', due_date: '',
  remind_time: '', priority: 'medium', confidence: 'high', source_index: 0,
  assigned_to: '', stage: '',
});

describe('a reply that hit the ceiling', () => {
  it('is split and asked again rather than accepted', async () => {
    const calls = scripted([
      // The whole batch: cut off, nothing readable.
      { stop_reason: 'max_tokens', parsed_output: null },
      // Each half answers properly.
      { stop_reason: 'end_turn', parsed_output: { tasks: [task('first half')] } },
      { stop_reason: 'end_turn', parsed_output: { tasks: [task('second half')] } },
    ]);

    const out = await extractor.extractTasks(messages(8));

    assert.equal(calls.length, 3, 'one whole, then two halves');
    assert.deepEqual(out.map((t) => t.title), ['first half', 'second half']);
  });

  it('keeps narrowing until a half fits', async () => {
    const calls = scripted([
      { stop_reason: 'max_tokens', parsed_output: null },
      { stop_reason: 'max_tokens', parsed_output: null },
      { stop_reason: 'end_turn', parsed_output: { tasks: [task('a')] } },
      { stop_reason: 'end_turn', parsed_output: { tasks: [task('b')] } },
      { stop_reason: 'end_turn', parsed_output: { tasks: [task('c')] } },
    ]);

    const out = await extractor.extractTasks(messages(8));
    assert.ok(calls.length > 3, `it narrowed: ${calls.length} calls`);
    assert.ok(out.length >= 2, 'and got tasks out of the pieces');
  });

  it('asks for enough room in the first place', async () => {
    const calls = scripted([{ stop_reason: 'end_turn', parsed_output: { tasks: [] } }]);
    await extractor.extractTasks(messages(3));
    assert.ok(calls[0].max_tokens >= 16000, `max_tokens was ${calls[0].max_tokens}`);
  });
});

describe('an unreadable reply', () => {
  it('throws, so the messages stay for another try', async () => {
    scripted([{ stop_reason: 'end_turn', parsed_output: null }]);
    await assert.rejects(
      () => extractor.extractTasks(messages(1)),
      /did not match the expected shape/
    );
  });

  it('says so plainly when it was cut off and cannot be split further', async () => {
    scripted([{ stop_reason: 'max_tokens', parsed_output: null }]);
    await assert.rejects(
      () => extractor.extractTasks(messages(1)),
      /ran out of room/
    );
  });
});

describe('an ordinary reply', () => {
  it('is returned as tasks, one call, no splitting', async () => {
    const calls = scripted([{ stop_reason: 'end_turn', parsed_output: { tasks: [task('pay TDS')] } }]);
    const out = await extractor.extractTasks(messages(5));
    assert.equal(calls.length, 1);
    assert.deepEqual(out.map((t) => t.title), ['pay TDS']);
  });
});
