/**
 * A watch that goes looking.
 *
 * The Section 138 watch read "0" on its first morning, and it was right to:
 * the legal feeds are general top-story feeds and no cheque-bounce judgment had
 * come through them. Filtering is not finding, which is what these cases are
 * about - that a watch reads its own sources, that it refuses articles that do
 * not actually mention what it is for, that an article already recorded is
 * dropped BEFORE the model is paid, and that a source which does not answer
 * says so rather than looking like a quiet day in the courts.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-watch-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const { db } = await import('../src/db.js');
const U = await import('../src/law-updates.js');
const legal = await import('../src/law-legal.js');
const W = await import('../src/law-watch.js');

const NOW = new Date('2026-09-11T04:00:00Z');

/* Google News answers in this shape: the link points back through the
 * aggregator and the publisher is named in <source url>. */
const newsXml = (items) => `<?xml version="1.0"?>
<rss version="2.0"><channel>
${items.map((i) => `  <item>
    <title><![CDATA[${i.title}]]></title>
    <link>${i.link || 'https://news.google.com/rss/articles/CBMi' + encodeURIComponent(i.title).slice(0, 12)}</link>
    <pubDate>${new Date(NOW.getTime() - (i.daysAgo ?? 2) * 86400000).toUTCString()}</pubDate>
    <description>${i.body || '&lt;a href="x"&gt;Report of the judgment.&lt;/a&gt;'}</description>
    <source url="${i.publisher || 'https://www.livelaw.in'}">${i.publisherName || 'LiveLaw'}</source>
  </item>`).join('\n')}
</channel></rss>`;

const ok = (body) => ({ ok: true, status: 200, text: async () => body });

/* Only the first source answers; the other two refuse, as a real morning
 * might. */
const oneAnswers = (body) => async (url) =>
  (url.includes('news.google.com') ? ok(body) : { ok: false, status: 403 });

let calls = 0;
const model = (rows) => ({
  messages: {
    parse: async (req) => {
      calls += 1;
      return {
        parsed_output: {
          updates: rows.map((r, index) => ({
            source_index: index,
            category: 'Cheque Bounce / Negotiable Instruments (S.138)',
            legal_area: 'Negotiable instruments',
            title: r.title,
            case_name: r.case_name || 'Ramesh Traders v Kiran Enterprises',
            case_number: r.case_number || '',
            court: 'Supreme Court of India',
            bench: '', petitioner: '', respondent: '',
            judgment_date: '2026-09-09',
            act_section: 'Section 138, Negotiable Instruments Act 1881',
            key_issue: 'Where a cheque-bounce complaint may be filed.',
            decision: 'At the payee bank branch.',
            principle: 'Jurisdiction follows the payee account.',
            implication: 'Recovery complaints can be filed locally.',
            ruling_type: 'precedent reaffirmed',
            summary: r.summary || 'Territorial jurisdiction reaffirmed.',
            priority: 'important',
            ai_explanation: 'CASE:\nRamesh Traders v Kiran Enterprises',
            ...r.over,
          })),
          // The request is kept so a case can assert what was actually sent.
          _sent: req,
        },
        usage: { input_tokens: 900, output_tokens: 300 },
        stop_reason: 'end_turn',
      };
    },
  },
});

const watch138 = () => {
  U.seedDefaultWatchesOnce();
  return U.listWatches('legal')[0];
};

beforeEach(() => {
  db.prepare('DELETE FROM law_updates').run();
  db.prepare('DELETE FROM law_watches').run();
  db.prepare(`DELETE FROM meta WHERE key = 'law_watches_seeded'`).run();
  db.prepare('DELETE FROM api_usage').run();
  db.prepare('DELETE FROM briefings').run();
  calls = 0;
});

describe('where a watch looks', () => {
  it('has sources of its own, built from what it is for', () => {
    const watch = watch138();
    const urls = watch.sourceList.map((s) => s.url).join(' ');
    assert.match(urls, /news\.google\.com/, 'the aggregator covers the sites with no search feed');
    assert.match(urls, /taxguru\.in\/\?s=/, 'a WordPress site answers a real search feed');
    assert.match(decodeURIComponent(urls), /"section 138"/);
  });

  it('is not the day digest\'s 26 hours — a judgment last week still counts', async () => {
    legal.setClientForTests(model([{ title: 'Cheque dishonour: payee branch has jurisdiction' }]));
    const run = await W.fetchWatch(watch138(), {
      now: NOW,
      fetchImpl: oneAnswers(newsXml([
        { title: 'SC on cheque dishonour jurisdiction', daysAgo: 9 },
      ])),
    });
    assert.equal(run.found, 1);
    assert.equal(run.stored, 1);
  });
});

describe('what a watch refuses to pay for', () => {
  it('drops an article that does not mention what the watch is for', async () => {
    legal.setClientForTests(model([]));
    const run = await W.fetchWatch(watch138(), {
      now: NOW,
      fetchImpl: oneAnswers(newsXml([
        { title: 'Supreme Court on arbitration clause survival' },
        { title: 'Delhi HC on EWS certificates' },
      ])),
    });
    assert.equal(run.found, 0, 'a search engine answering loosely is not a reason to buy a summary');
    assert.equal(calls, 0, 'nothing reached the model');
  });

  it('drops an article already recorded, before the model is called', async () => {
    const link = 'https://news.google.com/rss/articles/AAA';
    const feed = newsXml([{ title: 'SC on cheque bounce jurisdiction', link }]);
    legal.setClientForTests(model([{ title: 'Cheque bounce: payee branch has jurisdiction' }]));

    const first = await W.fetchWatch(watch138(), { now: NOW, fetchImpl: oneAnswers(feed) });
    assert.equal(first.stored, 1);
    assert.equal(calls, 1);

    // The same month re-read tomorrow: the same article, already recorded.
    const second = await W.fetchWatch(watch138(), { now: NOW, fetchImpl: oneAnswers(feed) });
    assert.equal(second.found, 1);
    assert.equal(second.fresh, 0);
    assert.equal(second.skipped, 1);
    assert.equal(calls, 1, 'a day with nothing new costs nothing at all');
  });
});

describe('what a watch records', () => {
  it('files the publisher, not the aggregator it came through', async () => {
    legal.setClientForTests(model([{ title: 'Cheque bounce jurisdiction reaffirmed' }]));
    await W.fetchWatch(watch138(), {
      now: NOW,
      fetchImpl: oneAnswers(newsXml([
        { title: 'SC on cheque bounce', publisher: 'https://www.livelaw.in', publisherName: 'LiveLaw' },
      ])),
    });

    const [row] = U.listUpdates({ module: 'legal' }).updates;
    assert.equal(row.source_authority, 'LiveLaw');
    assert.equal(row.source_kind, 'secondary');
    assert.match(row.source_url, /news\.google\.com/, 'the link that actually resolves is kept');
  });

  it('calls a judgment from a court\'s own site official', async () => {
    legal.setClientForTests(model([{ title: 'Cheque bounce: order uploaded' }]));
    await W.fetchWatch(watch138(), {
      now: NOW,
      fetchImpl: oneAnswers(newsXml([
        {
          title: 'Cheque dishonour order',
          publisher: 'https://gujarathc-casestatus.nic.in',
          publisherName: 'Gujarat High Court',
        },
      ])),
    });
    const [row] = U.listUpdates({ module: 'legal' }).updates;
    assert.equal(row.source_kind, 'official');
  });

  it('becomes an ordinary row — the watch chip and the digest both find it', async () => {
    legal.setClientForTests(model([{ title: 'Cheque dishonour: payee branch has jurisdiction' }]));
    await W.fetchWatch(watch138(), { now: NOW, fetchImpl: oneAnswers(newsXml([{ title: 'SC on cheque bounce' }])) });

    const [counted] = U.watchCounts('legal');
    assert.equal(counted.count, 1);

    const digest = U.composeDigest(U.listUpdates({ module: 'legal' }).updates[0].day, {
      module: 'legal', heading: 'Legal update', nothingNew: 'kuch nahi',
    });
    assert.match(digest.text, /Section 138 NI Act/);
  });
});

describe('when a source does not answer', () => {
  it('says so on the watch, instead of looking like a quiet day in the courts', async () => {
    await W.fetchWatch(watch138(), { now: NOW, fetchImpl: async () => ({ ok: false, status: 403 }) });
    const [watch] = U.listWatches('legal');
    assert.equal(watch.last_fetch_found, 0);
    assert.match(watch.last_fetch_note, /no source answered/);
    assert.match(watch.last_fetch_note, /403/);
    assert.ok(watch.last_fetch_at, 'and when it last looked');
  });

  it('records a real find with the count, so "0" is never ambiguous', async () => {
    legal.setClientForTests(model([{ title: 'Cheque bounce jurisdiction' }]));
    await W.fetchWatch(watch138(), { now: NOW, fetchImpl: oneAnswers(newsXml([{ title: 'SC on cheque bounce' }])) });
    const [watch] = U.listWatches('legal');
    assert.match(watch.last_fetch_note, /1 found/);
    assert.match(watch.last_fetch_note, /1 new/);
  });
});

describe('the daily sweep', () => {
  it('runs once a day, however often the engine ticks', async () => {
    watch138();
    legal.setClientForTests(model([]));
    const fetchImpl = oneAnswers(newsXml([]));

    const first = await W.refreshWatchesDaily({ now: NOW, fetchImpl, force: false });
    const second = await W.refreshWatchesDaily({ now: NOW, fetchImpl, force: false });

    // Without a key the sweep does not reach the network at all, which is the
    // right answer on an install with no model configured.
    if (first.ran) {
      assert.equal(second.ran, false);
      assert.equal(second.reason, 'already run today');
    } else {
      assert.equal(first.reason, 'no api key');
    }
  });
});
