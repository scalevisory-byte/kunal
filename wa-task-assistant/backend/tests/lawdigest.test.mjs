/**
 * The morning law digest.
 *
 * Three things here are worth a test rather than a reading: that a feed nobody
 * can reach never becomes a cheerful "nothing new today", that the digest goes
 * to the linked account's own chat and to no number at all, and that one day
 * gets one digest however many times the tick runs.
 *
 * The feeds and the model are both stubbed. Neither can be reached from here -
 * taxguru.in is not routable from this environment and there is no API key -
 * so what is proved is the logic around them, and the README says as much.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-law-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const { db } = await import('../src/db.js');
const S = await import('../src/scheduling.js');
const wa = await import('../src/whatsapp.js');
const feeds = await import('../src/feeds.js');
const law = await import('../src/law-digest.js');

const NOW = new Date('2026-09-10T04:00:00Z'); // 09:30 IST

/** An RSS document with one item, published `hoursAgo` before NOW. */
const feedXml = (title, hoursAgo = 2, link = 'https://example.test/a') => `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Feed</title>
  <item>
    <title><![CDATA[${title}]]></title>
    <link>${link}</link>
    <pubDate>${new Date(NOW.getTime() - hoursAgo * 3600000).toUTCString()}</pubDate>
    <description><![CDATA[<p>Body of &#8220;${title}&#8221; &amp; more.</p>]]></description>
  </item>
</channel></rss>`;

const ok = (body) => ({ ok: true, status: 200, text: async () => body });

/** Every feed answers with the same one article. */
const answering = (body) => async () => ok(body);
/** No feed answers at all. */
const refusing = async () => { throw new Error('ECONNREFUSED'); };

const model = (text) => ({
  messages: {
    create: async () => ({
      content: [{ type: 'text', text }],
      usage: { input_tokens: 900, output_tokens: 120 },
      stop_reason: 'end_turn',
    }),
  },
});

beforeEach(() => {
  db.prepare('DELETE FROM law_digests').run();
  db.prepare('DELETE FROM briefings').run();
  db.prepare('DELETE FROM api_usage').run();
  wa.state.status = 'disconnected';
  wa.state.me = null;
  S.saveSettings({ lawDigest: false, lawDigestTime: '08:00' });
});

describe('reading the feeds', () => {
  it('keeps what was published in the window and drops what was not', async () => {
    let call = 0;
    const fetchImpl = async () => ok(feedXml(`Article ${(call += 1)}`, call === 1 ? 2 : 400));
    const out = await law.collectUpdates({ now: NOW, fetchImpl });

    assert.equal(out.ok, true);
    assert.equal(out.items.length, 1, 'only the recent one');
    assert.match(out.items[0].title, /Article 1/);
    assert.equal(out.items[0].summary, 'Body of “Article 1” & more.', 'entities and tags resolved');
  });

  it('drops the same article when two categories carry it', async () => {
    const fetchImpl = answering(feedXml('One notification', 2, 'https://example.test/same'));
    const out = await law.collectUpdates({ now: NOW, fetchImpl });
    assert.equal(out.items.length, 1, 'five feeds, one article');
    assert.equal(out.sources.length, 5, 'and all five reported on');
  });

  it('survives one feed being down', async () => {
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      if (call === 2) throw new Error('HTTP 503');
      return ok(feedXml(`Article ${call}`, 1, `https://example.test/${call}`));
    };
    const out = await law.collectUpdates({ now: NOW, fetchImpl });
    assert.equal(out.ok, true);
    assert.equal(out.reachable, 4);
    assert.equal(out.items.length, 4);
    assert.equal(out.sources.filter((s) => !s.ok)[0].error, 'HTTP 503');
  });

  it('refuses to read an HTML error page as an empty feed', async () => {
    await assert.rejects(
      () => feeds.fetchFeed('https://example.test/x', {
        fetchImpl: async () => ok('<html><body>Forbidden</body></html>'),
      }),
      /not a feed/
    );
  });

  it('ignores an item whose date it cannot read', async () => {
    const xml = `<rss><channel><item><title>No date</title>
      <link>https://example.test/n</link><pubDate>whenever</pubDate>
      <description>x</description></item></channel></rss>`;
    const out = await law.collectUpdates({ now: NOW, fetchImpl: answering(xml) });
    assert.equal(out.items.length, 0, 'an unreadable date is not "today"');
    assert.equal(out.ok, true, 'but the feed itself answered');
  });
});

describe('turning it on once', () => {
  it('is switched on for an install that predates it, and only once', () => {
    S.saveSettings({ lawDigest: false });
    db.prepare(`DELETE FROM meta WHERE key = 'law_digest_default_on'`).run();

    assert.equal(S.enableLawDigestOnce().changed, true);
    assert.equal(S.getSettings().lawDigest, true);

    // Switched off by hand afterwards, and it stays off.
    S.saveSettings({ lawDigest: false });
    assert.equal(S.enableLawDigestOnce().changed, false);
    assert.equal(S.getSettings().lawDigest, false, 'the marker stops it running twice');
  });
});

describe('the shape shown before anything is built', () => {
  it('is the headings the model is asked for, with nothing filled in', () => {
    const shape = law.messageShape(NOW);
    for (const heading of ['GST', 'Income Tax / TDS', 'PF / ESI / PT / Labour', 'ROC / MCA', 'Case law', 'Client ko batao']) {
      assert.ok(shape.includes(`*${heading}:*`), `${heading} is offered`);
    }
    // Nothing invented: every line ends at the ellipsis, so the page cannot
    // show a finding that no feed reported.
    for (const line of shape.split('\n').filter((l) => l.includes(':*'))) {
      assert.match(line, /:\*\s…$/, `"${line}" is left blank`);
    }
  });
});

describe('when nothing can be read', () => {
  it('fails rather than saying there is no news', async () => {
    await assert.rejects(
      () => law.buildDigest({ now: NOW, fetchImpl: refusing }),
      /no law feed could be read/
    );
  });

  it('sends nothing, and records why', async () => {
    wa.state.status = 'ready';
    wa.state.me = '919909993565@c.us';
    const out = await law.maybeSendLawDigest({ now: NOW, force: true, fetchImpl: refusing });

    assert.equal(out.sent, false);
    assert.equal(out.reason, 'could not be built');
    assert.match(out.error, /ECONNREFUSED/);
  });

  it('says so plainly when the feeds answer and have nothing', async () => {
    const empty = '<rss><channel><title>Feed</title></channel></rss>';
    const out = await law.buildDigest({ now: NOW, fetchImpl: answering(empty) });
    assert.equal(out.items, 0);
    assert.equal(out.summarised, false, 'the model is not called for nothing');
    assert.match(out.text, /koi naya notification/);
  });
});

describe('the summary', () => {
  it('is written, stored and measured into api_usage', async () => {
    law.setClientForTests(model('📋 *Law Update*\n\n*GST:* naya circular aaya.'));
    const out = await law.buildDigest({ now: NOW, fetchImpl: answering(feedXml('GST circular')) });

    assert.equal(out.summarised, true);
    assert.match(out.text, /naya circular/);

    const stored = law.digestFor(out.day);
    assert.equal(stored.text, out.text, 'kept, because the message is the only copy');
    assert.equal(stored.items, 1);
    assert.equal(stored.sources.length, 5);

    const usage = db.prepare('SELECT * FROM api_usage').all();
    assert.equal(usage.length, 1, 'one call, one row - it shows up in AI Usage');
    assert.equal(usage[0].input_tokens, 900);
    assert.equal(usage[0].tasks, 0, 'a digest creates no tasks');
  });
});

describe('sending it', () => {
  const ready = () => {
    wa.state.status = 'ready';
    wa.state.me = '919909993565@c.us';
    const sent = [];
    wa.setClientForTests({ sendMessage: async (to, text) => sent.push({ to, text }) });
    return sent;
  };

  it('goes to the linked account and nowhere else', async () => {
    const sent = ready();
    law.setClientForTests(model('📋 *Law Update*\n\n*GST:* kuch naya.'));

    const out = await law.maybeSendLawDigest({
      now: NOW, force: true, fetchImpl: answering(feedXml('GST notification')),
    });

    assert.equal(out.sent, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, '919909993565@c.us', 'his own chat');
    assert.match(sent[0].text, /kuch naya/);
  });

  it('is not sent twice on the same day', async () => {
    const sent = ready();
    law.setClientForTests(model('📋 *Law Update*\n\n*GST:* kuch naya.'));
    const fetchImpl = answering(feedXml('GST notification'));

    S.saveSettings({ lawDigest: true, lawDigestTime: '08:00' });
    const first = await law.maybeSendLawDigest({ now: NOW, fetchImpl });
    const second = await law.maybeSendLawDigest({ now: NOW, fetchImpl });

    assert.equal(first.sent, true);
    assert.equal(second.sent, false);
    assert.equal(second.reason, 'already sent');
    assert.equal(sent.length, 1, 'one message');
  });

  it('waits for the hour, and stays off until it is switched on', async () => {
    const fetchImpl = answering(feedXml('GST notification'));
    const early = new Date('2026-09-10T01:00:00Z'); // 06:30 IST

    assert.equal((await law.maybeSendLawDigest({ now: early, fetchImpl })).reason, 'off');
    S.saveSettings({ lawDigest: true, lawDigestTime: '08:00' });
    assert.equal((await law.maybeSendLawDigest({ now: early, fetchImpl })).reason, 'not yet');
  });

  it('keeps the digest when WhatsApp is down, so it is not paid for twice', async () => {
    law.setClientForTests(model('📋 *Law Update*\n\n*GST:* kuch naya.'));
    const out = await law.maybeSendLawDigest({
      now: NOW, force: true, fetchImpl: answering(feedXml('GST notification')),
    });

    assert.equal(out.sent, false);
    assert.equal(out.reason, 'whatsapp not connected');
    assert.match(law.digestFor(out.day).text, /kuch naya/, 'readable in the dashboard');
    assert.equal(law.digestFor(out.day).sent_at, null);
  });

  it('does not pay for a second summary when a send is retried', async () => {
    let summaries = 0;
    law.setClientForTests({
      messages: {
        create: async () => {
          summaries += 1;
          return {
            content: [{ type: 'text', text: '📋 *Law Update*\n\n*GST:* kuch naya.' }],
            usage: { input_tokens: 900, output_tokens: 120 },
            stop_reason: 'end_turn',
          };
        },
      },
    });
    const fetchImpl = answering(feedXml('GST notification'));
    S.saveSettings({ lawDigest: true, lawDigestTime: '08:00' });

    // WhatsApp is down, so the claim's three attempts all come back here.
    const first = await law.maybeSendLawDigest({ now: NOW, fetchImpl });
    const second = await law.maybeSendLawDigest({ now: NOW, fetchImpl });
    const third = await law.maybeSendLawDigest({ now: NOW, fetchImpl });

    assert.equal(first.sent, false);
    assert.equal(first.reason, 'whatsapp not connected');
    assert.equal(second.reason, 'whatsapp not connected');
    assert.equal(third.reason, 'whatsapp not connected');
    assert.equal(summaries, 1, 'one morning, one summary, however many send attempts');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM api_usage').get().n, 1);
  });

  it('sends the stored digest once the link comes back', async () => {
    const sent = ready();
    law.setClientForTests(model('📋 *Law Update*\n\n*GST:* kuch naya.'));
    law.saveDigest(law.digestKey(NOW).slice(4), {
      text: '📋 *Law Update*\n\n*GST:* kal ka bana hua.', items: 3, sources: [],
    });

    const out = await law.maybeSendLawDigest({
      now: NOW, force: true, fetchImpl: refusing, // the feeds are not touched
    });

    assert.equal(out.sent, true);
    assert.match(sent[0].text, /kal ka bana hua/, 'the digest already built');
  });

  it('claims its own key, so it cannot collide with the daily briefing', () => {
    assert.equal(law.digestKey(NOW), 'law:2026-09-10');
  });
});
