/**
 * Legal & court updates: judgments, orders, Acts and amendments.
 *
 * A separate module from the tax digest, and separate on purpose. A GST
 * circular tells a client what to do by a date; a judgment tells a firm where
 * its arguments now stand. Reading them as one list would file one of them as
 * the other, so they have their own categories, their own feeds, their own
 * digest and their own morning.
 *
 * What they share is the machinery underneath - one store, one review workflow,
 * one search - because "mark this reviewed" is the same act whichever list it
 * happens in.
 *
 * The rule that matters most here is the one about not inventing: a case
 * number, a bench, a section or a holding that the article did not state must
 * come back empty. A confidently wrong citation is worse than no citation, and
 * this is the module where somebody might repeat it to a client.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { config } from './config.js';
import { log } from './logger.js';
import { db, recordUsage } from './db.js';
import { fetchFeed } from './feeds.js';
import {
  getSettings, localParts, claimBriefing, recordBriefingSent, recordBriefingFailed, briefingFor,
} from './scheduling.js';
import { localDay } from './briefing.js';
import { sendMessage, reminderChatId, state } from './whatsapp.js';
import { LEGAL_CATEGORIES, RULING_TYPES, saveUpdate, composeDigest } from './law-updates.js';

/*
 * Where the judgments are read from.
 *
 * The courts publish their own orders, and those are the citation - a write-up
 * is a secondary source and the page says so. The reporting sites are here
 * because they are what actually carry the day's judgments in a readable form;
 * between them the record gets both.
 *
 * None of these has been reached from the machine this was written on. A feed
 * that does not answer is reported by name on the page and costs nothing else;
 * LEGAL_FEEDS replaces the list without a deploy.
 */
export const DEFAULT_LEGAL_FEEDS = [
  { name: 'LiveLaw', url: 'https://www.livelaw.in/rss/top-stories' },
  { name: 'Bar & Bench', url: 'https://www.barandbench.com/feed' },
  { name: 'SCC Online', url: 'https://www.scconline.com/blog/feed/' },
  { name: 'Judiciary — TaxGuru', url: 'https://taxguru.in/category/judiciary/feed/' },
];

export function legalFeeds() {
  const raw = (process.env.LEGAL_FEEDS || '').trim();
  if (!raw) return DEFAULT_LEGAL_FEEDS;
  const parsed = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, url] = entry.split('|').map((s) => s.trim());
      return url ? { name, url } : { name: 'Legal', url: name };
    })
    .filter((f) => /^https?:\/\//i.test(f.url));
  return parsed.length ? parsed : DEFAULT_LEGAL_FEEDS;
}

/* ---------------- storage of the day's digest ---------------- */

db.exec(`
  CREATE TABLE IF NOT EXISTS legal_digests (
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

export function saveLegalDigest(day, { text, items, sources, model }) {
  db.prepare(
    `INSERT INTO legal_digests (day, text, items, sources, model)
     VALUES (@day, @text, @items, @sources, @model)
     ON CONFLICT(day) DO UPDATE SET
       text = excluded.text, items = excluded.items, sources = excluded.sources,
       model = excluded.model, built_at = datetime('now')`
  ).run({
    day, text, items: items || 0,
    sources: JSON.stringify(sources || []),
    model: model || config.model,
  });
}

export const markLegalSent = (day) =>
  db.prepare(`UPDATE legal_digests SET sent_at = datetime('now'), error = NULL WHERE day = ?`).run(day);

export const markLegalFailed = (day, error) =>
  db.prepare(`UPDATE legal_digests SET error = ? WHERE day = ?`).run(String(error).slice(0, 400), day);

const readSources = (value) => {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export function legalDigestFor(day) {
  const row = db.prepare(`SELECT * FROM legal_digests WHERE day = ?`).get(day);
  return row ? { ...row, sources: readSources(row.sources) } : null;
}

export const recentLegalDigests = (limit = 7) =>
  db.prepare(`SELECT * FROM legal_digests ORDER BY day DESC LIMIT ?`).all(limit)
    .map((row) => ({ ...row, sources: readSources(row.sources) }));

/* ---------------- reading the feeds ---------------- */

export async function collectLegal({ now = new Date(), hours = 26, fetchImpl } = {}) {
  const since = now.getTime() - hours * 3600_000;
  const items = [];
  const sources = [];
  const seen = new Set();

  for (const feed of legalFeeds()) {
    try {
      const entries = await fetchFeed(feed.url, fetchImpl ? { fetchImpl } : {});
      let kept = 0;
      for (const entry of entries) {
        if (!entry.publishedAt || entry.publishedAt.getTime() < since) continue;
        const key = entry.link || entry.title;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ category: feed.name, ...entry, summary: entry.summary.slice(0, 500) });
        kept += 1;
      }
      sources.push({ name: feed.name, ok: true, items: kept });
    } catch (err) {
      log.warn(`Legal digest: ${feed.name} feed failed — ${err?.message || err}`);
      sources.push({ name: feed.name, ok: false, error: String(err?.message || err) });
    }
  }

  const reachable = sources.filter((s) => s.ok).length;
  return { items, sources, ok: reachable > 0, reachable, tried: sources.length };
}

/* ---------------- the model ---------------- */

let client = null;

function anthropic() {
  if (!client) {
    client = config.anthropicApiKey
      ? new Anthropic({ apiKey: config.anthropicApiKey })
      : new Anthropic();
  }
  return client;
}

/** Test seam. Nothing in production calls this. */
export function setClientForTests(stub) {
  client = stub;
}

const LegalSchema = z.object({
  updates: z.array(
    z.object({
      source_index: z.number().describe('Index of the article this came from.'),
      category: z.string().describe(`Exactly one of: ${LEGAL_CATEGORIES.join(' | ')}`),
      legal_area: z.string().describe('The area of law in a few words - insolvency, contract, GST, service tax.'),
      title: z.string().describe('The development in one line, max ~100 characters.'),
      case_name: z.string().describe('Party v Party, exactly as written. Empty if the article does not name it.'),
      case_number: z.string().describe('Appeal / petition number exactly as printed. Empty if not stated.'),
      court: z.string().describe('The court or authority - "Supreme Court", "ITAT Nagpur", "NCLAT". Empty if unclear.'),
      bench: z.string().describe('The judges, if the article names them. Empty otherwise.'),
      petitioner: z.string().describe('Appellant or petitioner, if named. Empty otherwise.'),
      respondent: z.string().describe('Respondent, if named. Empty otherwise.'),
      judgment_date: z.string().describe('YYYY-MM-DD of the judgment or order, if stated. Empty otherwise.'),
      act_section: z.string().describe('The Act and section in question, exactly as cited. Empty if not stated.'),
      key_issue: z.string().describe('The question the court had to answer, in one sentence.'),
      decision: z.string().describe('What the court actually held. Never stated more strongly than the article does.'),
      principle: z.string().describe('The legal principle it turns on, in one sentence. Empty if the article does not draw one.'),
      implication: z.string().describe('What it means in practice for businesses or their advisers. Empty if unclear.'),
      ruling_type: z.string().describe(`One of: ${RULING_TYPES.join(' | ')} - or empty if the article does not say.`),
      summary: z.string().describe('Two sentences at most, for somebody scanning a list.'),
      priority: z.string().describe(
        'critical for a landmark or a position overruled; important for a real change; general otherwise.'
      ),
      ai_explanation: z.string().describe(
        'Plain-language note in this exact shape, one line each, skipping any line the article cannot answer:\n'
          + 'CASE:\nCOURT:\nDATE:\nISSUE:\nRELEVANT LAW / SECTION:\nWHAT THE COURT DECIDED:\n'
          + 'KEY LEGAL PRINCIPLE:\nPRACTICAL IMPACT:\nIMPORTANT TAKEAWAY:'
      ),
    })
  ),
});

const SYSTEM_PROMPT = `You read Indian legal reporting for a firm of accountants, auditors and
advisers (Scale Visory, Gujarat). They need to know about judgments, orders, Acts, amendments
and rules that bear on how businesses and their advisers act.

Keep judgments, orders, new Acts, amendments, rules, ordinances and legal notifications. Drop
opinion columns, law-school explainers, event notices, appointments and career posts.

Absolute rules, because a wrong citation is worse than no citation:
- Never invent a case number, a bench, a date, a section, an Act or a holding. If the article
  does not state it, return an empty string.
- Copy case names, case numbers and section references exactly as printed.
- Report what the court held, in the article's own terms. Do not strengthen a holding, do not
  turn an interim order into a final one, and do not describe something as settled law unless
  the article does.
- Where the article is a report ABOUT a judgment, that is what you are summarising - say what
  it reports, not what you know.
- Plain professional English. No advice, no recommendations to any particular party.
- One entry per development: the same judgment covered by two sites is one entry.`;

const heading = (now) => `⚖️ *Legal & Court Digest – ${dateLabel(now)}*`;

export const dateLabel = (now = new Date()) =>
  now.toLocaleDateString('en-IN', {
    timeZone: config.timezone, day: '2-digit', month: 'short', year: 'numeric',
  });

export const NOTHING_NEW = (now = new Date()) =>
  `⚖️ *Legal & Court Digest – ${dateLabel(now)}*\n\nAaj koi naya judgment / order nahi mila. ✅`;

/** The empty shape, shown before anything has been fetched. */
export const legalShape = (now = new Date()) => `${heading(now)}

⚖️ *Supreme Court:* …
⚖️ *High Courts:* …
🏢 *NCLT / NCLAT:* …
📊 *ITAT / CESTAT / GSTAT:* …
📜 *Legislation:* …

📣 *Client ko batane layak:* …`;

/** The articles, as structured legal updates. Measured into `api_usage`. */
export async function extractLegal(items, { now = new Date() } = {}) {
  if (!items.length) return [];

  const articles = items
    .map((item, index) =>
      `${index}. [${item.category}] ${item.title}\n   ${item.summary}\n   ${item.link}`)
    .join('\n');

  const response = await anthropic().messages.parse({
    model: config.model,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Today is ${dateLabel(now)}. Read these ${items.length} reports and return the legal developments.\n\nARTICLES:\n${articles}`,
    }],
    output_config: { format: zodOutputFormat(LegalSchema, 'legal_updates') },
  });

  const usage = response.usage || {};
  recordUsage({
    kind: 'legal_digest',
    model: config.model,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read: usage.cache_read_input_tokens,
    cache_write: usage.cache_creation_input_tokens,
    messages: items.length,
    tasks: 0,
  });

  if (response.stop_reason === 'max_tokens') {
    log.warn('Legal digest: the reply was cut off; some judgments may be missing.');
  }

  return (response.parsed_output?.updates ?? []).map((u) => {
    const article = items[u.source_index] || null;
    return {
      ...u,
      module: 'legal',
      day: localDay(now),
      published_at: article?.published || null,
      // The article is the citation. A link the model wrote itself is a link
      // nobody can check, and in this module that is the whole risk.
      source_url: article?.link || null,
      source_name: article?.category || null,
      model: config.model,
    };
  });
}

/** Today's legal digest, built from scratch: fetch, extract, store, compose. */
export async function buildLegalDigest({ now = new Date(), fetchImpl } = {}) {
  const { items, sources, ok, tried } = await collectLegal({ now, fetchImpl });
  if (!ok) {
    const why = sources.map((s) => `${s.name}: ${s.error}`).join('; ');
    throw new Error(`no legal feed could be read (${tried} tried) — ${why}`);
  }

  const day = localDay(now);
  let stored = 0;
  let duplicates = 0;

  const extracted = items.length ? await extractLegal(items, { now }) : [];
  for (const update of extracted) {
    const { created } = saveUpdate(update);
    if (created) stored += 1;
    else duplicates += 1;
  }

  const digest = composeDigest(day, {
    module: 'legal',
    heading: heading(now),
    nothingNew: NOTHING_NEW(now),
  });
  saveLegalDigest(day, { text: digest.text, items: digest.count, sources });

  return {
    day,
    text: digest.text,
    items: digest.count,
    read: items.length,
    stored,
    duplicates,
    sources,
    summarised: digest.count > 0,
  };
}

/* ---------------- sending ---------------- */

export function legalDue(now, settings) {
  const [h, m] = String(settings.legalDigestTime || '09:00').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false;
  const local = localParts(now, config.timezone);
  return local.hour * 60 + local.minute >= h * 60 + m;
}

/** Its own claim key, so it can never collide with the tax digest's. */
export const legalKey = (now = new Date()) => `legal:${localDay(now)}`;

/**
 * Sent at most once a day, by the mechanism the other two digests use.
 *
 * A digest already built today is reused rather than rebuilt: the claim allows
 * three attempts, and three paid readings of one morning's judgments for one
 * message is not a retry, it is a bill.
 */
export async function maybeSendLegalDigest({ now = new Date(), force = false, fetchImpl } = {}) {
  const settings = getSettings();
  if (!force && !settings.legalDigest) return { sent: false, reason: 'off' };
  if (!force && !legalDue(now, settings)) return { sent: false, reason: 'not yet' };

  const key = legalKey(now);
  const day = localDay(now);
  if (!force && briefingFor(key)?.sent_at) return { sent: false, reason: 'already sent' };

  const claim = force ? { day: key } : claimBriefing(key);
  if (!claim) return { sent: false, reason: 'claimed elsewhere' };

  const stored = legalDigestFor(day);
  let digest = stored?.text
    ? { day, text: stored.text, items: stored.items, reused: true }
    : null;

  if (!digest) {
    try {
      digest = await buildLegalDigest({ now, fetchImpl });
    } catch (err) {
      if (!force) recordBriefingFailed(key, err?.message || err);
      markLegalFailed(day, err?.message || err);
      log.error('Legal digest build failed:', err?.message || err);
      return { sent: false, reason: 'could not be built', error: String(err?.message || err) };
    }
  }

  if (state.status !== 'ready') {
    if (!force) recordBriefingFailed(key, 'WhatsApp not connected');
    return { sent: false, reason: 'whatsapp not connected', text: digest.text, day };
  }

  try {
    await sendMessage(reminderChatId(), digest.text);
  } catch (err) {
    if (!force) recordBriefingFailed(key, err?.message || err);
    markLegalFailed(day, err?.message || err);
    log.error('Legal digest send failed:', err?.message || err);
    return { sent: false, reason: 'send failed', error: String(err?.message || err), text: digest.text };
  }

  markLegalSent(day);
  recordBriefingSent(key, digest.items);
  log.info(`Legal digest sent for ${day}: ${digest.items} update(s).`);
  return { sent: true, day, items: digest.items, text: digest.text };
}
