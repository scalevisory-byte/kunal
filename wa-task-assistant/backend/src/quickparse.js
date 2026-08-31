import { today, normalizeDueDate } from './dates.js';
import { config } from './config.js';

/**
 * Turns a message you wrote yourself into a task, with no AI involved.
 *
 * This is plain pattern matching, and it only works because YOU are the author:
 * the words are yours, so "kal" really does mean tomorrow. The same approach
 * applied to other people's incoming messages is unreliable - that is what the
 * AI mode is for.
 */

const DAY_NAMES = {
  sunday: 0, sun: 0, ravivar: 0,
  monday: 1, mon: 1, somvar: 1,
  tuesday: 2, tue: 2, tues: 2, mangalvar: 2,
  wednesday: 3, wed: 3, budhvar: 3,
  thursday: 4, thu: 4, thurs: 4, guruvar: 4,
  friday: 5, fri: 5, shukravar: 5,
  saturday: 6, sat: 6, shanivar: 6,
};

const HIGH_WORDS = /\b(urgent|asap|turant|jaldi|important|critical)\b/i;

/**
 * Find a clock time: "10 baje", "at 5pm", "5:30 PM", "17:00".
 * Returns { hour, minute, match } or null.
 */
function findTime(text) {
  const patterns = [
    // 5:30 pm / 5.30pm / 17:00
    [/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/i, (m) => ({
      hour: Number(m[1]), minute: Number(m[2]), ampm: m[3],
    })],
    // 5 pm / 5pm
    [/\b(\d{1,2})\s*(am|pm)\b/i, (m) => ({ hour: Number(m[1]), minute: 0, ampm: m[2] })],
    // 10 baje / 10 baje subah
    [/\b(\d{1,2})\s*baje(?:\s*(subah|shaam|raat|dopahar))?\b/i, (m) => ({
      hour: Number(m[1]), minute: 0,
      ampm: /shaam|raat/i.test(m[2] || '') ? 'pm' : /subah/i.test(m[2] || '') ? 'am' : null,
    })],
  ];

  for (const [re, resolve] of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const { hour, minute, ampm } = resolve(m);
    if (minute > 59) continue;

    let h = hour;
    if (ampm) {
      const pm = /pm/i.test(ampm);
      if (h === 12) h = pm ? 12 : 0;
      else if (pm) h += 12;
    } else if (h >= 0 && h <= 7) {
      // "10 baje" with no qualifier reads as daytime; 1-7 almost always means evening.
      h += 12;
    }
    if (h > 23) continue;
    return { hour: h, minute, match: m[0] };
  }
  return null;
}

/** Build an ISO instant for a wall-clock time on a given date in the configured zone. */
export function isoAtLocal(dateIso, hour, minute, tz) {
  const wall = `${dateIso}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  // Work out the zone's offset for that moment, then subtract it to get UTC.
  const guess = new Date(`${wall}Z`);
  const asZoned = new Date(
    guess.toLocaleString('en-US', { timeZone: tz })
  );
  const asUtc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offsetMs = asZoned.getTime() - asUtc.getTime();
  return new Date(guess.getTime() - offsetMs).toISOString();
}

function isoFromOffset(days) {
  const base = new Date(`${today()}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Days ahead to the next occurrence of a weekday (never today - "Friday" said on Friday means next Friday). */
function daysToWeekday(target) {
  const todayDow = new Date(`${today()}T00:00:00Z`).getUTCDay();
  const delta = (target - todayDow + 7) % 7;
  return delta === 0 ? 7 : delta;
}

/** Next occurrence of a bare day-of-month, e.g. "12th" -> the 12th of this month or next. */
function nextDayOfMonth(day) {
  const now = new Date(`${today()}T00:00:00Z`);
  const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
  if (candidate.getUTCDate() !== day) return null; // e.g. 31st in a 30-day month
  if (candidate < now) {
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, day));
    return next.getUTCDate() === day ? next.toISOString().slice(0, 10) : null;
  }
  return candidate.toISOString().slice(0, 10);
}

/**
 * Look for a date. Returns { date, match } so the caller can strip the phrase
 * out of the title, or null when nothing matched.
 */
function findDate(text) {
  const patterns = [
    [/\b(today|aaj)\b/i, () => isoFromOffset(0)],
    [/\b(tomorrow|tmrw|kal)\b/i, () => isoFromOffset(1)],
    [/\b(parso|day after tomorrow)\b/i, () => isoFromOffset(2)],
    [/\bnext week\b/i, () => isoFromOffset(7)],
    [/\bin (\d{1,2}) days?\b/i, (m) => isoFromOffset(Number(m[1]))],
    [/\b(\d{4}-\d{2}-\d{2})\b/, (m) => normalizeDueDate(m[1])],
    // 12/09 or 12-09-2026, read day-first as written in India
    [/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/, (m) => {
      const day = Number(m[1]);
      const month = Number(m[2]);
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      let year = m[3] ? Number(m[3]) : new Date(`${today()}T00:00:00Z`).getUTCFullYear();
      if (year < 100) year += 2000;
      const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return normalizeDueDate(iso);
    }],
    [/\b(\d{1,2})(?:st|nd|rd|th)\b/i, (m) => nextDayOfMonth(Number(m[1]))],
    [new RegExp(`\\b(${Object.keys(DAY_NAMES).join('|')})\\b`, 'i'),
      (m) => isoFromOffset(daysToWeekday(DAY_NAMES[m[1].toLowerCase()]))],
  ];

  for (const [re, resolve] of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const date = resolve(m);
    if (date) return { date, match: m[0] };
  }
  return null;
}

/**
 * @param {string} raw   the message text as you typed or forwarded it
 * @param {string} trigger  optional prefix to strip, e.g. "#task"
 */
export function parseQuickTask(raw, { trigger = '' } = {}) {
  let text = String(raw || '').trim();
  if (!text) return null;

  if (trigger) {
    const re = new RegExp(`^${trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i');
    text = text.replace(re, '').trim();
  }

  // A leading or trailing "!" is the quickest way to flag something as urgent.
  let priority = 'medium';
  if (/(^!|!$)/.test(text) || HIGH_WORDS.test(text)) priority = 'high';
  text = text.replace(/^!+\s*/, '').replace(/\s*!+$/, '').trim();

  const time = findTime(text);
  if (time) {
    // Strip the time phrase before the date pass, so "kal 10 baje" leaves a clean title.
    text = text
      .replace(new RegExp(`\\b(at|by|pe|par)?\\s*${time.match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  const found = findDate(text);
  let title = text;
  if (found) {
    // Drop the date phrase along with whatever framed it. English puts the
    // preposition first ("by Friday"); Hindi puts it after ("kal tak").
    const escaped = found.match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    title = title
      .replace(
        new RegExp(`\\b(by|before|on|due|latest)?\\s*${escaped}\\s*(tak|tk|se pehle|se phle|ko)?\\b`, 'i'),
        ' '
      )
      .replace(/\s{2,}/g, ' ')
      .replace(/[\s,;:-]+$/, '')
      .trim();
  }

  // Long forwards: keep the first line as the title, the rest as the note.
  const lines = title.split('\n').map((l) => l.trim()).filter(Boolean);
  let description = null;
  if (lines.length > 1) {
    title = lines[0];
    description = lines.slice(1).join('\n');
  } else if (title.length > 120) {
    description = title;
    title = title.slice(0, 117).trimEnd() + '…';
  }

  if (!title) return null;

  const dueDate = found ? found.date : time ? today() : null;
  const remindAt = time && dueDate ? isoAtLocal(dueDate, time.hour, time.minute, config.timezone) : null;

  return { title, description, due_date: dueDate, remind_at: remindAt, priority };
}
