/**
 * Legal & court updates, and the wall between them and the tax module.
 *
 * The two lists must not leak into each other: a judgment filed as a compliance
 * step, or a circular filed as a precedent, is worse than either being missed.
 * These hold that wall, the legal-only fields, and the rule that matters most
 * in this module - a case number or a holding the report did not state comes
 * back empty rather than plausible.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-legal-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';
process.env.LEGAL_FEEDS = ['LiveLaw|https://legal.test/a', 'Bar & Bench|https://legal.test/b'].join(',');

const { db } = await import('../src/db.js');
const U = await import('../src/law-updates.js');
const S = await import('../src/scheduling.js');
const wa = await import('../src/whatsapp.js');
const legal = await import('../src/law-legal.js');

const NOW = new Date('2026-09-10T04:00:00Z');

const feedXml = (title, hoursAgo = 2, link = 'https://livelaw.in/one') => `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title><![CDATA[${title}]]></title>
    <link>${link}</link>
    <pubDate>${new Date(NOW.getTime() - hoursAgo * 3600000).toUTCString()}</pubDate>
    <description><![CDATA[<p>Report of the judgment.</p>]]></description>
  </item>
</channel></rss>`;

const ok = (body) => ({ ok: true, status: 200, text: async () => body });
const answering = (body) => async () => ok(body);

const model = (...updates) => ({
  messages: {
    parse: async () => ({
      parsed_output: {
        updates: updates.map((u) => ({
          source_index: 0,
          category: 'ITAT Judgments',
          legal_area: 'Income tax',
          title: 'Tribunal deletes addition',
          case_name: 'Sharma v ACIT',
          case_number: 'ITA No. 412/Nag/2025',
          court: 'ITAT Nagpur',
          bench: '',
          petitioner: '',
          respondent: '',
          judgment_date: '2026-09-08',
          act_section: 'Section 69A, Income-tax Act 1961',
          key_issue: 'Whether jewellery held by the wife can be added to the husband.',
          decision: 'It cannot; the addition was deleted.',
          principle: 'Ownership follows the person, not the residence.',
          implication: 'Similar additions can be resisted on the same facts.',
          ruling_type: 'new precedent',
          summary: 'ITAT Nagpur deleted a section 69A addition.',
          priority: 'important',
          ai_explanation: 'CASE:\nSharma v ACIT',
          ...u,
        })),
      },
      usage: { input_tokens: 800, output_tokens: 200 },
      stop_reason: 'end_turn',
    }),
  },
});

const legalRows = () => U.listUpdates({ module: 'legal' });
const taxRows = () => U.listUpdates({ module: 'tax' });

beforeEach(() => {
  db.prepare('DELETE FROM law_updates').run();
  db.prepare('DELETE FROM legal_digests').run();
  db.prepare('DELETE FROM briefings').run();
  db.prepare('DELETE FROM api_usage').run();
  wa.state.status = 'disconnected';
  wa.state.me = null;
  S.saveSettings({ legalDigest: false, legalDigestTime: '09:00' });
});

describe('the two modules', () => {
  it('do not share categories', () => {
    assert.ok(U.LEGAL_CATEGORIES.includes('NCLT Judgments & Orders'));
    assert.ok(!U.CATEGORIES.includes('NCLT Judgments & Orders'), 'a tribunal is not a tax head');
    assert.ok(U.CATEGORIES.includes('GST Circulars'));
    assert.ok(!U.LEGAL_CATEGORIES.includes('GST Circulars'), 'a circular is not a judgment');
  });

  it('do not show each other\'s rows', async () => {
    legal.setClientForTests(model({}));
    await legal.buildLegalDigest({ now: NOW, fetchImpl: answering(feedXml('ITAT deletes addition')) });

    assert.equal(legalRows().total, 1);
    assert.equal(taxRows().total, 0, 'a judgment never appears in the compliance list');
  });

  it('keep their digests in separate tables and separate claims', async () => {
    legal.setClientForTests(model({}));
    const out = await legal.buildLegalDigest({ now: NOW, fetchImpl: answering(feedXml('x')) });

    assert.ok(legal.legalDigestFor(out.day), 'stored as a legal digest');
    assert.equal(legal.legalKey(NOW), 'legal:2026-09-10');
    assert.notEqual(legal.legalKey(NOW), `law:${out.day}`, 'its own claim key');
  });
});

describe('what a judgment records', () => {
  it('keeps the court, the case, the number and the holding', async () => {
    legal.setClientForTests(model({}));
    await legal.buildLegalDigest({ now: NOW, fetchImpl: answering(feedXml('ITAT deletes addition')) });

    const [row] = legalRows().updates;
    assert.equal(row.court, 'ITAT Nagpur');
    assert.equal(row.case_name, 'Sharma v ACIT');
    assert.equal(row.case_number, 'ITA No. 412/Nag/2025');
    assert.equal(row.act_section, 'Section 69A, Income-tax Act 1961');
    assert.equal(row.decision, 'It cannot; the addition was deleted.');
    assert.equal(row.ruling_type, 'new precedent');
    assert.equal(row.group_key, 'tax_tribunal', 'an ITAT ruling files under the tribunals');
  });

  it('leaves a field the report did not state empty', async () => {
    legal.setClientForTests(model({ bench: '', case_number: '', judgment_date: '' }));
    await legal.buildLegalDigest({ now: NOW, fetchImpl: answering(feedXml('unreported')) });

    const [row] = legalRows().updates;
    assert.equal(row.bench, null);
    assert.equal(row.case_number, null);
    assert.equal(row.judgment_date, null, 'an empty field beats a plausible one');
  });

  it('refuses a ruling type it was not offered', async () => {
    legal.setClientForTests(model({ ruling_type: 'sounds about right' }));
    await legal.buildLegalDigest({ now: NOW, fetchImpl: answering(feedXml('x')) });
    assert.equal(legalRows().updates[0].ruling_type, null);
  });

  it('treats the same case from two sites as one', async () => {
    legal.setClientForTests(model({}, { title: 'Same case, another site' }));
    await legal.buildLegalDigest({ now: NOW, fetchImpl: answering(feedXml('x')) });
    assert.equal(legalRows().total, 1, 'the case number is the case, however many write it up');
  });
});

describe('the legal digest', () => {
  it('reads by court and closes on what moved', async () => {
    legal.setClientForTests(model(
      { priority: 'critical', category: 'Supreme Court Judgments', case_name: 'A v B', case_number: 'CA 1/2026', ruling_type: 'position changed / overruled' },
      { category: 'NCLAT Judgments & Orders', case_name: 'C v D', case_number: 'CA 2/2026', ruling_type: 'final judgment' },
    ));
    const out = await legal.buildLegalDigest({ now: NOW, fetchImpl: answering(feedXml('x')) });

    assert.match(out.text, /Legal & Court Digest/);
    assert.match(out.text, /🔴 \*Landmark \/ urgent\*/);
    assert.match(out.text, /\*🏢 NCLT \/ NCLAT:\*/);
    assert.match(out.text, /⚠️ \*Important developments\*/);
    assert.match(out.text, /position changed \/ overruled — A v B/);
    assert.ok(!out.text.includes('Deadlines'), 'a judgment has no filing deadline to close on');
    assert.match(out.text, /📣 \*Client ko batane layak:\*/);
  });

  it('says so plainly when the courts had nothing', async () => {
    const empty = '<rss><channel><title>Feed</title></channel></rss>';
    const out = await legal.buildLegalDigest({ now: NOW, fetchImpl: answering(empty) });
    assert.equal(out.items, 0);
    assert.match(out.text, /koi naya judgment/);
  });

  it('fails rather than inventing a quiet day when no source answers', async () => {
    await assert.rejects(
      () => legal.buildLegalDigest({ now: NOW, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }),
      /no legal feed could be read/
    );
  });

  it('goes to the linked account and nowhere else, once a day', async () => {
    wa.state.status = 'ready';
    wa.state.me = '919909993565@c.us';
    const sent = [];
    wa.setClientForTests({ sendMessage: async (to, text) => sent.push({ to, text }) });
    legal.setClientForTests(model({}));
    S.saveSettings({ legalDigest: true, legalDigestTime: '09:00' });
    const fetchImpl = answering(feedXml('x'));

    const first = await legal.maybeSendLegalDigest({ now: NOW, fetchImpl });
    const second = await legal.maybeSendLegalDigest({ now: NOW, fetchImpl });

    assert.equal(first.sent, true);
    assert.equal(sent[0].to, '919909993565@c.us');
    assert.equal(second.sent, false);
    assert.equal(second.reason, 'already sent');
    assert.equal(sent.length, 1);
  });

  it('is measured into api_usage under its own name', async () => {
    legal.setClientForTests(model({}));
    await legal.buildLegalDigest({ now: NOW, fetchImpl: answering(feedXml('x')) });
    const rows = db.prepare('SELECT kind, COUNT(*) n FROM api_usage GROUP BY kind').all();
    assert.deepEqual(rows, [{ kind: 'legal_digest', n: 1 }]);
  });
});

describe('the message about a judgment', () => {
  it('names the case and the court, and claims nothing more', async () => {
    legal.setClientForTests(model({}));
    await legal.buildLegalDigest({ now: NOW, fetchImpl: answering(feedXml('x')) });
    const [row] = legalRows().updates;

    const whatsapp = U.clientMessage(row, 'whatsapp');
    assert.match(whatsapp, /Sharma v ACIT/);
    assert.match(whatsapp, /ITAT Nagpur/);
    assert.match(whatsapp, /Section 69A/);
    assert.match(whatsapp, /salah nahi/, 'it says it is not advice');

    const email = U.clientMessage(row, 'email');
    assert.match(email, /^Subject: ITAT Nagpur — Sharma v ACIT/);
    assert.match(email, /not advice on any particular matter/);
  });
});
