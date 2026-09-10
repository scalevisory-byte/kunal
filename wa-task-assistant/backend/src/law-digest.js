/**
 * The morning law digest.
 *
 * Five lines on WhatsApp: GST, Income Tax, PF/ESI/PT, ROC and any case law
 * worth knowing, read out of the tax and corporate-law feeds and written for a
 * Gujarat CA practice's clients rather than for a lawyer. Scale Visory work,
 * not task work - which is why it lives beside the briefing rather than inside
 * the extractor: no task is created, nothing is chased, it is a thing to read.
 *
 * Three things are deliberately different from the script this grew out of:
 *
 *   1. It goes to the linked account's own chat and nowhere else. The original
 *      took a DIGEST_TO number, which is one config typo away from messaging a
 *      client every morning. Nothing in this app sends to a contact.
 *   2. "No updates today" is only ever said when the feeds actually answered
 *      and had nothing new. If they could not be reached the digest fails
 *      loudly instead, because a silent green tick when the network is down is
 *      worse than no message at all.
 *   3. One per day is a claim in the database, the same one the daily briefing
 *      uses - so a restart, a retry, a second worker or a "send now" all find
 *      the day taken.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { log } from './logger.js';
import { db, recordUsage } from './db.js';
import { fetchFeed } from './feeds.js';
import {
  getSettings, localParts, claimBriefing, recordBriefingSent, recordBriefingFailed, briefingFor,
} from './scheduling.js';
import { localDay } from './briefing.js';
import { sendMessage, reminderChatId, state } from './whatsapp.js';

/*
 * What is read every morning. TaxGuru publishes a feed per category and covers
 * notifications, circulars and rulings the day they land, which is what a
 * practice needs; the AI is what turns forty articles into five lines.
 *
 * Overridable with LAW_FEEDS as `Name|url` pairs separated by commas, so a
 * source can be added or dropped without a deploy of new code.
 */
export const DEFAULT_FEEDS = [
  { name: 'Income Tax', url: 'https://taxguru.in/income-tax/feed/' },
  { name: 'GST', url: 'https://taxguru.in/goods-and-service-tax/feed/' },
  { name: 'Company Law', url: 'https://taxguru.in/company-law/feed/' },
  { name: 'Corporate / Labour', url: 'https://taxguru.in/corporate-law/feed/' },
  { name: 'SEBI / RBI / Finance', url: 'https://taxguru.in/finance/feed/' },
];

export function feeds() {
  const raw = (process.env.LAW_FEEDS || '').trim();
  if (!raw) return DEFAULT_FEEDS;
  const parsed = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, url] = entry.split('|').map((s) => s.trim());
      return url ? { name, url } : { name: 'Updates', url: name };
    })
    .filter((f) => /^https?:\/\//i.test(f.url));
  return parsed.length ? parsed : DEFAULT_FEEDS;
}

/* ---------------- storage ---------------- */

/*
 * The digest itself is kept, not just the fact that one was sent.
 *
 * The `briefings` table records a claim and a count, which is all a task list
 * needs because the tasks are still in the database afterwards. A law update is
 * not: once the message has gone, the text is the only copy. Keeping it means
 * the dashboard can show this morning's digest, and yesterday's, without paying
 * for the model again - and it means a digest built while WhatsApp was down is
 * still readable rather than lost.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS law_digests (
    day        TEXT PRIMARY KEY,
    built_at   TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at    TEXT,
    text       TEXT NOT NULL,
    items      INTEGER NOT NULL DEFAULT 0,
    sources    TEXT,
    model      TEXT,
    error      TEXT
  );
`);

export function saveDigest(day, { text, items, sources, model }) {
  db.prepare(
    `INSERT INTO law_digests (day, text, items, sources, model)
     VALUES (@day, @text, @items, @sources, @model)
     ON CONFLICT(day) DO UPDATE SET
       text = excluded.text, items = excluded.items, sources = excluded.sources,
       model = excluded.model, built_at = datetime('now')`
  ).run({
    day,
    text,
    items: items || 0,
    sources: JSON.stringify(sources || []),
    model: model || config.model,
  });
}

export const markDigestSent = (day) =>
  db.prepare(`UPDATE law_digests SET sent_at = datetime('now'), error = NULL WHERE day = ?`).run(day);

export const markDigestFailed = (day, error) =>
  db.prepare(`UPDATE law_digests SET error = ? WHERE day = ?`).run(String(error).slice(0, 400), day);

export function digestFor(day) {
  const row = db.prepare(`SELECT * FROM law_digests WHERE day = ?`).get(day);
  return row ? { ...row, sources: readSources(row.sources) } : null;
}

export function recentDigests(limit = 7) {
  return db
    .prepare(`SELECT * FROM law_digests ORDER BY day DESC LIMIT ?`)
    .all(limit)
    .map((row) => ({ ...row, sources: readSources(row.sources) }));
}

const readSources = (value) => {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/* ---------------- the feeds ---------------- */

/**
 * Everything published in the last `hours`, across every feed.
 *
 * A feed that fails is reported rather than thrown: four sources answering is a
 * digest worth sending. All five failing is not, and `ok` says which happened
 * so the caller can tell "nothing was published" from "nothing could be read".
 */
export async function collectUpdates({ now = new Date(), hours = 26, fetchImpl } = {}) {
  const since = now.getTime() - hours * 3600_000;
  const items = [];
  const sources = [];
  const seen = new Set();

  for (const feed of feeds()) {
    try {
      const entries = await fetchFeed(feed.url, fetchImpl ? { fetchImpl } : {});
      let kept = 0;
      for (const entry of entries) {
        // No readable date means no way to know it is new; a daily digest that
        // repeats last month's article every morning is worse than a short one.
        if (!entry.publishedAt || entry.publishedAt.getTime() < since) continue;
        const key = entry.link || entry.title;
        if (seen.has(key)) continue; // the same article files under two categories
        seen.add(key);
        items.push({ category: feed.name, ...entry, summary: entry.summary.slice(0, 400) });
        kept += 1;
      }
      sources.push({ name: feed.name, ok: true, items: kept });
    } catch (err) {
      log.warn(`Law digest: ${feed.name} feed failed — ${err?.message || err}`);
      sources.push({ name: feed.name, ok: false, error: String(err?.message || err) });
    }
  }

  const reachable = sources.filter((s) => s.ok).length;
  return { items, sources, ok: reachable > 0, reachable, tried: sources.length };
}

/* ---------------- the summary ---------------- */

let client = null;

function anthropic() {
  if (!client) {
    client = config.anthropicApiKey
      ? new Anthropic({ apiKey: config.anthropicApiKey })
      : new Anthropic();
  }
  return client;
}

/** Stand in for the Anthropic client, for tests only. Nothing calls this in production. */
export function setClientForTests(stub) {
  client = stub;
}

export const dateLabel = (now = new Date()) =>
  now.toLocaleDateString('en-IN', {
    timeZone: config.timezone, day: '2-digit', month: 'short', year: 'numeric',
  });

const SYSTEM_PROMPT = `Tum ek Indian CA firm (Scale Visory, Gujarat) ke liye daily compliance digest banate ho.
Clients: small aur medium businesses, proprietors, Pvt Ltd companies.

Diye gaye articles me se SIRF wahi lo jo naya rule, notification, circular, due date
ya important court ruling hai aur jo chhote-medium clients ko affect karta hai.
General articles, opinion pieces aur "what is" type basic content chhod do.

Rules:
- Hinglish (Roman Hindi) me likho, WhatsApp ke liye.
- Har line zyada se zyada 25 shabd.
- Section ka naam mat badlo.
- Line ke end me source link daalo jab available ho.
- Jo baat articles me nahi hai wo mat likho. Kuch na mile to us line par
  "koi naya update nahi" likho - guess mat karo.
- Koi intro, koi disclaimer, koi extra text nahi.`;

/*
 * The five headings, written once.
 *
 * They are both what the model is told to produce and what the dashboard shows
 * when no digest has been built yet - so a reader can see the shape of the
 * message before paying for one. Two copies of this list would drift, and the
 * page would then promise a line the prompt never asks for.
 */
const SECTIONS = [
  { label: 'GST', ask: '<1 line, ya "koi naya update nahi">' },
  { label: 'Income Tax / TDS', ask: '<1 line, ya "koi naya update nahi">' },
  { label: 'PF / ESI / PT / Labour', ask: '<1 line, ya "koi naya update nahi">' },
  { label: 'ROC / MCA', ask: '<1 line, ya "koi naya update nahi">' },
  {
    label: 'Case law',
    ask: '<1 line agar koi important HC/SC/ITAT ruling hai, warna ye line hata do>',
  },
];

const heading = (now) => `📋 *Law Update – ${dateLabel(now)}*`;

const template = (now) => `${heading(now)}

${SECTIONS.map((s) => `*${s.label}:* ${s.ask}`).join('\n')}

⚠️ *Client ko batao:* <agar koi action ya due date hai to 1 line, warna "aaj kuch nahi">`;

/**
 * The shape of the message, with the lines left blank.
 *
 * Shown where a digest would be if one had been built. It is not an example
 * digest and carries no invented findings - every line is empty on purpose,
 * because the only honest thing to show before the feeds have been read is
 * which questions get answered.
 */
export const messageShape = (now = new Date()) => `${heading(now)}

${SECTIONS.map((s) => `*${s.label}:* …`).join('\n')}

⚠️ *Client ko batao:* …`;

export const NOTHING_NEW = (now = new Date()) =>
  `📋 *Law Update – ${dateLabel(now)}*\n\nAaj koi naya notification / circular nahi aaya. ✅`;

/**
 * The articles, as five lines. Every call is measured into `api_usage`, so this
 * shows up in the AI Usage page beside the extractor rather than as a surprise
 * on the Anthropic bill.
 */
export async function summarise(items, { now = new Date() } = {}) {
  if (!items.length) return null;

  const articles = items
    .map((item, index) =>
      `${index + 1}. [${item.category}] ${item.title}\n   ${item.summary}\n   ${item.link}`)
    .join('\n');

  const response = await anthropic().messages.create({
    model: config.model,
    max_tokens: 1200,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Output bilkul is format me do:\n\n${template(now)}\n\nARTICLES:\n${articles}`,
    }],
  });

  const usage = response.usage || {};
  recordUsage({
    kind: 'law_digest',
    model: config.model,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read: usage.cache_read_input_tokens,
    cache_write: usage.cache_creation_input_tokens,
    messages: items.length,
    tasks: 0,
  });

  const text = (response.content || [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();

  if (response.stop_reason === 'max_tokens') {
    log.warn('Law digest: the summary was cut off at the token ceiling.');
  }
  return text || null;
}

/**
 * Today's digest, built from scratch: fetch, summarise, store.
 *
 * Throws when nothing could be read at all. That is the case the original
 * script turned into a cheerful "koi update nahi aaya ✅" - a message that says
 * the opposite of what happened, on the one morning something might have been
 * missed.
 */
export async function buildDigest({ now = new Date(), fetchImpl } = {}) {
  const { items, sources, ok, tried } = await collectUpdates({ now, fetchImpl });
  if (!ok) {
    const why = sources.map((s) => `${s.name}: ${s.error}`).join('; ');
    throw new Error(`no law feed could be read (${tried} tried) — ${why}`);
  }

  const summary = items.length ? await summarise(items, { now }) : null;
  const text = summary || NOTHING_NEW(now);
  const day = localDay(now);
  saveDigest(day, { text, items: items.length, sources });
  return { day, text, items: items.length, sources, summarised: Boolean(summary) };
}

/* ---------------- sending ---------------- */

/** True once the configured hour has arrived on the user's clock. */
export function digestDue(now, settings) {
  const [h, m] = String(settings.lawDigestTime || '08:00').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false;
  const local = localParts(now, config.timezone);
  return local.hour * 60 + local.minute >= h * 60 + m;
}

/** The claim key. Its own namespace so it can never collide with a day's briefing. */
export const digestKey = (now = new Date()) => `law:${localDay(now)}`;

/**
 * Sent at most once a day, by exactly the mechanism the daily briefing uses.
 *
 * The claim is taken before the model is called, so a restart mid-run costs a
 * digest rather than sending two - and, unlike the briefing, rather than paying
 * for the same summary twice.
 */
export async function maybeSendLawDigest({ now = new Date(), force = false, fetchImpl } = {}) {
  const settings = getSettings();
  if (!force && !settings.lawDigest) return { sent: false, reason: 'off' };
  if (!force && !digestDue(now, settings)) return { sent: false, reason: 'not yet' };

  const key = digestKey(now);
  const day = localDay(now);
  if (!force && briefingFor(key)?.sent_at) return { sent: false, reason: 'already sent' };

  const claim = force ? { day: key } : claimBriefing(key);
  if (!claim) return { sent: false, reason: 'claimed elsewhere' };

  /*
   * A digest already built today is not built again.
   *
   * The claim allows three attempts, so a send that fails - WhatsApp down, most
   * likely - comes back here twice more. Rebuilding each time means three paid
   * summaries of the same morning's news for one message. The stored text is
   * the same text, so the retries are retries of the *send*.
   */
  const stored = digestFor(day);
  let digest = stored?.text
    ? { day, text: stored.text, items: stored.items, reused: true }
    : null;

  if (!digest) {
    try {
      digest = await buildDigest({ now, fetchImpl });
    } catch (err) {
      if (!force) recordBriefingFailed(key, err?.message || err);
      markDigestFailed(day, err?.message || err);
      log.error('Law digest build failed:', err?.message || err);
      return { sent: false, reason: 'could not be built', error: String(err?.message || err) };
    }
  }

  if (state.status !== 'ready') {
    if (!force) recordBriefingFailed(key, 'WhatsApp not connected');
    // Built and stored all the same: it is readable in the dashboard, and the
    // model is not asked for it a second time when the link comes back.
    return { sent: false, reason: 'whatsapp not connected', text: digest.text, day };
  }

  try {
    await sendMessage(reminderChatId(), digest.text);
  } catch (err) {
    if (!force) recordBriefingFailed(key, err?.message || err);
    markDigestFailed(day, err?.message || err);
    log.error('Law digest send failed:', err?.message || err);
    return { sent: false, reason: 'send failed', error: String(err?.message || err), text: digest.text };
  }

  markDigestSent(day);
  recordBriefingSent(key, digest.items);
  log.info(`Law digest sent for ${day}: ${digest.items} article(s) read.`);
  return { sent: true, day, items: digest.items, text: digest.text };
}
