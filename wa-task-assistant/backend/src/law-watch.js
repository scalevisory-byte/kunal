/**
 * A watch goes looking.
 *
 * The first day of the Section 138 watch is what this is for. The legal feeds
 * are general top-story feeds; a cheque-bounce judgment reaches them perhaps
 * once a week, and a watch that only filters what those feeds happened to bring
 * reads "0" while the practice it names goes on happening. Filtering is not
 * finding.
 *
 * So a watch carries its own sources and reads them over a month rather than a
 * day, and what comes back goes through the module's own extractor - the tax
 * one for a tax watch, the legal one for a legal watch - so a judgment found
 * this way is an ordinary row, indistinguishable from one the morning digest
 * brought in. Nothing downstream learns that there is a second kind of update.
 *
 * The cost rule is the one that matters: a month of articles re-read every day
 * would be the same summary bought thirty times. Articles already recorded are
 * dropped BEFORE the model is called, so a day with nothing new costs nothing
 * at all - not a cheaper call, no call.
 */
import { config } from './config.js';
import { log } from './logger.js';
import { fetchFeed } from './feeds.js';
import { localDay } from './briefing.js';
import { claimBriefing, recordBriefingSent } from './scheduling.js';
import {
  listWatches, watchSources, watchTerms, setWatchFetch, knownUrls, saveUpdate,
} from './law-updates.js';
import { extractUpdates } from './law-digest.js';
import { extractLegal } from './law-legal.js';

/* How far back a watch reads, and how much of it is ever sent to the model. */
const LOOKBACK_DAYS = Number(process.env.WATCH_LOOKBACK_DAYS || 30);
const MAX_ARTICLES = Number(process.env.WATCH_MAX_ARTICLES || 12);

/**
 * Does this article actually mention what the watch is for?
 *
 * A search feed answers with what its own search engine thought fit, and an
 * aggregator is looser still. Checking the words here - against the headline
 * and the excerpt, the only text there is before the model is paid - is what
 * keeps a watch from summarising a page of unrelated news at its owner's
 * expense.
 */
export const mentions = (item, terms) => {
  const text = `${item?.title || ''} ${item?.summary || ''}`.toLowerCase();
  return terms.some((term) => text.includes(String(term).toLowerCase()));
};

/** Every source of one watch, read and filtered, with a note on each. */
export async function collectForWatch(watch, { now = new Date(), fetchImpl, days = LOOKBACK_DAYS } = {}) {
  const terms = watchTerms(watch);
  const since = now.getTime() - days * 86400_000;
  const items = [];
  const sources = [];
  const seen = new Set();

  for (const feed of watchSources(watch)) {
    try {
      const entries = await fetchFeed(feed.url, fetchImpl ? { fetchImpl } : {});
      let kept = 0;
      for (const entry of entries) {
        // A search feed can answer without dates; that is not a reason to drop
        // a judgment, only a reason not to claim when it was published.
        if (entry.publishedAt && entry.publishedAt.getTime() < since) continue;
        if (!mentions(entry, terms)) continue;
        const key = entry.link || entry.title;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          ...entry,
          category: entry.sourceName || feed.name,
          summary: String(entry.summary || '').slice(0, 500),
        });
        kept += 1;
      }
      sources.push({ name: feed.name, ok: true, items: kept });
    } catch (err) {
      log.warn(`Watch "${watch.label}": ${feed.name} failed — ${err?.message || err}`);
      sources.push({ name: feed.name, ok: false, error: String(err?.message || err) });
    }
  }

  return { items, sources, reachable: sources.filter((s) => s.ok).length, tried: sources.length };
}

const noteFor = ({ sources, found, stored, skipped }) => {
  const failed = sources.filter((s) => !s.ok);
  const parts = [];
  if (!sources.length) parts.push('no sources set');
  else if (!failed.length) parts.push(`${found} found`);
  else if (failed.length === sources.length) parts.push(`no source answered — ${failed.map((s) => `${s.name}: ${s.error}`).join('; ')}`);
  else parts.push(`${found} found; ${failed.map((s) => s.name).join(', ')} did not answer`);
  if (stored) parts.push(`${stored} new`);
  else if (skipped) parts.push('nothing new');
  return parts.join(' · ');
};

/**
 * One watch, read and recorded.
 *
 * Returns what it did rather than logging it, because the page shows this: a
 * watch that found nothing and a watch whose sources all refused are different
 * facts, and only one of them is about the law.
 */
export async function fetchWatch(watch, { now = new Date(), fetchImpl, days } = {}) {
  const mod = watch.module === 'legal' ? 'legal' : 'tax';
  const { items, sources, reachable, tried } = await collectForWatch(watch, { now, fetchImpl, days });

  // Paid for once. An article already in the record is dropped here, before
  // the model, not after it.
  const already = knownUrls(items.map((i) => i.link));
  const fresh = items.filter((i) => !already.has(i.link)).slice(0, MAX_ARTICLES);

  const result = {
    watch: watch.label,
    module: mod,
    found: items.length,
    fresh: fresh.length,
    skipped: items.length - fresh.length,
    stored: 0,
    duplicates: 0,
    sources,
    reachable,
    tried,
  };

  if (fresh.length) {
    const extracted = mod === 'legal'
      ? await extractLegal(fresh, { now })
      : await extractUpdates(fresh, { now });

    for (const update of extracted) {
      const article = fresh.find((f) => f.link === update.source_url) || null;
      const { created } = saveUpdate({
        ...update,
        day: localDay(now),
        // The aggregator's link is the one that resolves; the publisher's
        // domain is what decides whether this is an official source.
        publisher_url: article?.sourceUrl || null,
        source_name: article?.sourceName || update.source_name,
      });
      if (created) result.stored += 1;
      else result.duplicates += 1;
    }
  }

  setWatchFetch(watch.id, { found: result.found, note: noteFor(result) });
  return result;
}

/** Every watch on a module. One failing watch never stops the next. */
export async function fetchWatches(mod = 'legal', { now = new Date(), fetchImpl, days } = {}) {
  const runs = [];
  for (const watch of listWatches(mod)) {
    try {
      runs.push(await fetchWatch(watch, { now, fetchImpl, days }));
    } catch (err) {
      log.error(`Watch "${watch.label}" failed:`, err?.message || err);
      setWatchFetch(watch.id, { found: 0, note: `failed — ${err?.message || err}` });
      runs.push({ watch: watch.label, module: mod, error: String(err?.message || err) });
    }
  }
  return runs;
}

/** Its own claim key, so "once a day" is the same guarantee the digests get. */
export const watchKey = (now = new Date()) => `watch:${localDay(now)}`;

/**
 * The daily sweep, claimed once a day.
 *
 * It rides the reminder tick like the digests do, and is claimed the same way:
 * the engine ticks every few minutes, and a watch that read its month on every
 * tick would be a bill rather than a feature. It runs before the digests so
 * what it finds is in the morning's message rather than a day late.
 */
export async function refreshWatchesDaily({ now = new Date(), fetchImpl, force = false } = {}) {
  if (!config.anthropicApiKey && !force) return { ran: false, reason: 'no api key' };
  const key = watchKey(now);
  if (!force && !claimBriefing(key)) return { ran: false, reason: 'already run today' };

  const runs = [...await fetchWatches('legal', { now, fetchImpl }), ...await fetchWatches('tax', { now, fetchImpl })];
  const stored = runs.reduce((n, r) => n + (r.stored || 0), 0);
  if (!force) recordBriefingSent(key, stored);
  if (stored) log.info(`Watches: ${stored} new update(s) found by what you are watching.`);
  return { ran: true, runs, stored };
}
