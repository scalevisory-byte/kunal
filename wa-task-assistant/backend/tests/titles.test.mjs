/**
 * Titles that say what the job is.
 *
 * "Talk with Vikas Gupta" twice is two conversations, days apart, about
 * different things - reported exactly that way: *"ek hi kaam nahi, alag alag
 * purpose he na"*. A title that names only a person cannot be told apart from
 * the next one, by him or by the app, so the extractor is asked for the subject
 * and the tidy-up pass is given the original message for the ones that already
 * lack it. It is the one fix that cannot be made from the title alone.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-titles-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const E = await import('../src/extractor.js');

let sent = '';
const stub = (titles) => E.setClientForTests({
  messages: {
    parse: async (req) => {
      sent = req.messages[0].content;
      return { parsed_output: { titles }, usage: { input_tokens: 100, output_tokens: 20 } };
    },
  },
});

beforeEach(() => { sent = ''; });

describe('the tidy-up pass', () => {
  it('is given the original message, and only for a title that needs it', async () => {
    stub([]);
    await E.tidyTitles([
      { id: 1, title: 'Talk with Vikas Gupta', source_message: 'Vikas bhai ko bolo Sena ka GST refund status batae' },
      { id: 2, title: 'File GSTR-3B', source_message: null },
    ]);

    assert.match(sent, /original message: Vikas bhai/, 'the vague one carries its message');
    assert.equal(
      (sent.match(/original message/g) || []).length, 1,
      'and the merely misspelt one does not - sending every message would multiply the bill'
    );
  });

  it('proposes the subject it found in that message', async () => {
    stub([{ id: 1, title: 'Talk with Vikas Gupta about the Sena GST refund', changed: true }]);
    const [proposal] = await E.tidyTitles([
      { id: 1, title: 'Talk with Vikas Gupta', source_message: 'Sena ka GST refund' },
    ]);

    assert.equal(proposal.from, 'Talk with Vikas Gupta');
    assert.match(proposal.to, /Sena GST refund/);
  });

  it('proposes nothing when the rewrite comes back unchanged', async () => {
    stub([{ id: 1, title: 'Talk with Vikas Gupta', changed: false }]);
    const out = await E.tidyTitles([{ id: 1, title: 'Talk with Vikas Gupta', source_message: 'aa jao' }]);
    assert.deepEqual(out, [], 'a title it could not improve is left exactly as it is');
  });
});
