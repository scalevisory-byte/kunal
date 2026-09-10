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
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { config } from './config.js';
import { log } from './logger.js';
import { db, recordUsage } from './db.js';
import { fetchFeed } from './feeds.js';
import { CATEGORIES, saveUpdate, composeDigest, listUpdates } from './law-updates.js';
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
  // Read first, and known to work: these are what the digest has been built
  // from since it shipped.
  { name: 'Income Tax', url: 'https://taxguru.in/income-tax/feed/' },
  { name: 'GST', url: 'https://taxguru.in/goods-and-service-tax/feed/' },
  { name: 'Company Law', url: 'https://taxguru.in/company-law/feed/' },
  { name: 'Corporate / Labour', url: 'https://taxguru.in/corporate-law/feed/' },
  { name: 'SEBI / RBI / Finance', url: 'https://taxguru.in/finance/feed/' },

  /*
   * The regulators' own feeds.
   *
   * An article about a circular and the circular are not the same thing, and
   * the page marks them differently - a link to rbi.org.in is an official
   * source, a link to a write-up of it is a secondary one. So these are read
   * as well.
   *
   * They have NOT been reached from the machine this was written on (no route
   * to them here), so treat the URLs as unproven: a feed that does not answer
   * is reported by name on the page and costs nothing else. Replace or drop
   * them with LAW_FEEDS if one turns out to be wrong.
   */
  { name: 'RBI', url: 'https://www.rbi.org.in/pressreleases_rss.xml' },
  { name: 'SEBI', url: 'https://www.sebi.gov.in/sebirss.xml' },
  { name: 'PIB — Finance Ministry', url: 'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3' },
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

/*
 * What one article has to be turned into.
 *
 * Every field is either in the article or empty. The prompt says so and the
 * schema makes the empty case cheap to express, because the failure that
 * matters here is not a missing field - it is a confident sentence about a
 * deadline nobody announced.
 */
const UpdateSchema = z.object({
  updates: z.array(
    z.object({
      source_index: z.number().describe('Index of the article this came from.'),
      category: z.string().describe(
        `Exactly one of: ${CATEGORIES.join(' | ')}`
      ),
      title: z.string().describe('The update in one line, max ~90 characters.'),
      summary: z.string().describe('Two sentences at most: what a professional needs to know.'),
      what_changed: z.string().describe('The change itself. Empty if the article does not say.'),
      previous_position: z.string().describe('What the rule was before, only if the article states it.'),
      new_position: z.string().describe('What the rule is now, only if the article states it.'),
      applies_to: z.string().describe(
        'Who it generally applies to - "companies with turnover above X", "all GST registrants". Never a named client.'
      ),
      action_required: z.string().describe('What has to be done, if the article says. Empty otherwise.'),
      effective_date: z.string().describe('YYYY-MM-DD if the article states one. Empty otherwise.'),
      deadline: z.string().describe('YYYY-MM-DD if the article states a due date. Empty otherwise.'),
      deadline_confirmed: z.boolean().describe(
        'True only when the article itself states the deadline. False if you inferred or assumed it.'
      ),
      doc_type: z.string().describe('notification | circular | order | judgment | press release | news | empty'),
      doc_number: z.string().describe('The notification / circular / order number, exactly as written. Empty if none.'),
      priority: z.string().describe(
        'critical for a deadline or a rule taking effect now; important for a real change; general otherwise.'
      ),
      ai_explanation: z.string().describe(
        'Plain-language explanation in this exact shape, one line each, skipping any line the article cannot answer:\n'
          + 'WHAT HAPPENED?\nWHAT CHANGED?\nEFFECTIVE FROM?\nWHO DOES IT GENERALLY APPLY TO?\n'
          + 'WHAT ACTION IS REQUIRED?\nDEADLINE?\nSOURCE?'
      ),
    })
  ),
});

const SYSTEM_PROMPT = `You read Indian tax and compliance articles for a CA firm (Scale Visory,
Gujarat) whose clients are small and medium businesses, proprietors and private companies.

Keep only what is a real development: a notification, a circular, an order, a rule change, a
due date, a rate or threshold change, a new form, or a judgment that changes how something is
done. Drop opinion pieces, explainers, "what is GST" articles, course advertisements and
listicles.

Absolute rules, because this is legal information:
- Write nothing the article does not say. An empty field is correct; a plausible sentence is not.
- Never invent a notification number, a section, a date or a deadline.
- deadline_confirmed is true ONLY when the article states the date itself.
- Copy notification and circular numbers, and section numbers, exactly as printed.
- Use the source's own words for the legal position; do not restate a holding more strongly
  than the article does.
- Plain professional English. No greetings, no disclaimers, no marketing.
- One entry per development. If two articles cover the same notification, return it once.`;

const heading = (now) => `📋 *Law Update – ${dateLabel(now)}*`;

/*
 * The five sections the WhatsApp message is written in.
 *
 * They live in law-updates.js now, because the message is composed from stored
 * rows rather than written by the model in one go - but the shape a reader sees
 * has not changed, and this is still the only place it is described.
 */
const SECTIONS = [
  { label: 'GST' },
  { label: 'Income Tax / TDS' },
  { label: 'MCA / ROC' },
  { label: 'PF / ESI / Labour' },
  { label: 'Case law' },
];

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
 * The articles, as structured updates. One call, measured into `api_usage`.
 *
 * Returns rows ready for `saveUpdate` - the source link and name come from the
 * article the model was given rather than from the model, so a hallucinated URL
 * cannot become a citation.
 */
export async function extractUpdates(items, { now = new Date() } = {}) {
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
      content: `Today is ${dateLabel(now)}. Read these ${items.length} articles and return the real developments.\n\nARTICLES:\n${articles}`,
    }],
    output_config: { format: zodOutputFormat(UpdateSchema, 'law_updates') },
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

  if (response.stop_reason === 'max_tokens') {
    log.warn('Law digest: the reply was cut off at the token ceiling; some updates may be missing.');
  }

  const parsed = response.parsed_output?.updates ?? [];
  return parsed.map((u) => {
    // The article is the citation. The model is asked which one it read, not
    // for a link - a link it wrote itself is a link nobody can check.
    const article = items[u.source_index] || null;
    return {
      ...u,
      day: localDay(now),
      published_at: article?.published || null,
      source_url: article?.link || null,
      source_name: article?.category || null,
      model: config.model,
    };
  });
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

  const day = localDay(now);
  let stored = 0;
  let duplicates = 0;

  const extracted = items.length ? await extractUpdates(items, { now }) : [];
  for (const update of extracted) {
    // A notification carried by three feeds is one notification. The store
    // decides that, by fingerprint, so a re-run adds nothing and loses nothing.
    const { created } = saveUpdate(update);
    if (created) stored += 1;
    else duplicates += 1;
  }

  const digest = composeDigest(day, { heading: heading(now), nothingNew: NOTHING_NEW(now) });
  saveDigest(day, { text: digest.text, items: digest.count, sources });

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
