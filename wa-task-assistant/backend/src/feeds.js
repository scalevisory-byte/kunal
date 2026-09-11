/**
 * Reading an RSS feed, with nothing installed.
 *
 * The obvious answer is `rss-parser`, which brings xml2js and sax with it. What
 * is actually needed is four fields out of each `<item>` of a WordPress RSS 2.0
 * feed - TaxGuru, and everything else in that category, publishes exactly that
 * shape. So this reads those four fields and nothing else.
 *
 * It is deliberately forgiving rather than correct: a feed is somebody else's
 * output and can be malformed, truncated by a proxy, or an HTML error page
 * wearing a feed's URL. Every function here returns what it could read and
 * throws only when it could not read anything at all - one bad feed must never
 * be able to take the day's digest down with it.
 */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  ndash: '–', mdash: '—', hellip: '…', middot: '·',
};

/** `&amp;`, `&#8217;` and `&#x27;` all become the character they stand for. */
export function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeChar(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);
}

const safeChar = (code) =>
  Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';

const withoutTags = (html) =>
  String(html ?? '')
    // Script and style carry no prose and would otherwise arrive as code.
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');

/**
 * The readable words inside a chunk of feed HTML, on one line.
 *
 * Stripped, decoded, and stripped again: an aggregator escapes the markup
 * inside a description (`&lt;a href=…&gt;`), so decoding once leaves the anchor
 * behind as visible text - and then that text is what gets sent to the model
 * and stored as a summary.
 */
export function stripTags(html) {
  return withoutTags(decodeEntities(withoutTags(html)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The publisher behind an aggregated item.
 *
 * Google News RSS gives every item a `<source url="https://www.livelaw.in">
 * LiveLaw</source>` and a link that points back through news.google.com. The
 * link is the only one that resolves, so it stays - but whether a source is
 * official is read off a domain, and news.google.com is nobody's domain. This
 * is where the real one comes from.
 */
function sourceOf(block) {
  const match = /<source(\s[^>]*)?>([\s\S]*?)<\/source>/i.exec(block);
  if (!match) return { sourceName: '', sourceUrl: '' };
  const url = /url\s*=\s*["']([^"']+)["']/i.exec(match[1] || '');
  return { sourceName: stripTags(match[2]), sourceUrl: url ? decodeEntities(url[1]).trim() : '' };
}

/** The text of the first `<tag>` inside a block, CDATA unwrapped. */
function tag(block, name) {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i').exec(block);
  if (!match) return '';
  const raw = match[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(raw);
  return (cdata ? cdata[1] : raw).trim();
}

/**
 * The items of an RSS 2.0 document.
 *
 * `pubDate` is kept as the feed wrote it and parsed separately, because a date
 * this cannot read must not silently become 1970 and then look like something
 * published fifty years ago.
 */
export function parseFeed(xml) {
  const text = String(xml ?? '');
  const items = [];

  for (const match of text.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const title = stripTags(tag(block, 'title'));
    // `content:encoded` is the whole article; `description` is the excerpt. The
    // excerpt is what a digest wants, and the article is the fallback.
    const body = tag(block, 'description') || tag(block, 'content:encoded');
    const link = decodeEntities(tag(block, 'link')).trim();
    const published = tag(block, 'pubDate');

    if (!title && !link) continue; // not an item in any useful sense

    items.push({
      title,
      link,
      published,
      publishedAt: parseDate(published),
      summary: stripTags(body),
      ...sourceOf(block),
    });
  }

  return items;
}

/** An RSS date, or null when it cannot be read - never a wrong date. */
export function parseDate(value) {
  if (!value) return null;
  const ms = Date.parse(String(value).trim());
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * One feed, fetched and parsed.
 *
 * A real User-Agent because several publishers refuse the default one, and a
 * timeout because a feed that never answers must not hold up the four others.
 */
export async function fetchFeed(url, { timeoutMs = 20_000, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: 'application/rss+xml, application/xml, text/xml, */*',
      'user-agent': 'WA-Tasks-Digest/1.0 (+personal use)',
    },
    redirect: 'follow',
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.text();
  const items = parseFeed(body);
  // An HTML error page parses to nothing. Saying so beats reporting "0 new".
  if (!items.length && !/<rss|<feed|<channel/i.test(body)) {
    throw new Error('the reply was not a feed');
  }
  return items;
}
