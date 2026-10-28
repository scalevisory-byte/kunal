/**
 * Task names, notes and steps, written properly.
 *
 * Asked as "sare task name and details apne aap proper likhe jaye - kuch small
 * kuch capital, spelling mistake nahi". They are typed fast on a phone, to his
 * own chat, and read back on a list for weeks: "Icici Bank Od Rebewal",
 * "Nidhi Regstartion", "need to file a case agaienst IBFW". In manual mode
 * there is no model to tidy them, so this does it with rules - and the rules
 * are narrow on purpose, because the one thing worse than a typo is a name
 * "corrected" into a word that is not the name.
 *
 * A word is corrected only when ALL of these hold:
 *   - it is not a word already (61,500 English words, SCOWL sizes 10-50);
 *   - it is five letters or longer (short words are mostly Hinglish or names);
 *   - exactly one dictionary word is closest to it, with the same first
 *     letter, one edit away (two for long words) - a swap of two letters
 *     counts as one edit, which is how "documnet" is typed;
 *   - and for words under seven letters, that word is on the short business
 *     list below. Names live in exactly that range (Vikas, Daman, Astar, Cibil
 *     all sit one letter from an English word), so there only the words a task
 *     list is actually made of are offered.
 * Measured against his own typos and 70 Gujarati names and Hinglish verbs:
 * every typo fixed, no name or Hinglish word touched.
 *
 * Case: a shouted or all-lowercase line goes through `unshout` (titlecase.js);
 * acronyms (GST, BNF, ICICI) are put back in capitals wherever they appear;
 * and every line starts with a capital. A word he capitalised himself stays
 * capitalised, because no rule can tell a name from a word.
 *
 * A rename is never tidied: that is him correcting the app, and the app must
 * not correct him back.
 */
import fs from 'node:fs';
import { ACRONYMS, unshout } from './titlecase.js';

/*
 * What a task list is made of. Offered as corrections at any length, and the
 * only words offered under seven letters. Each is also accepted as correct.
 */
const BUSINESS = `
  account accounts address advance against agreement amount application
  approval approve approved audit balance bank billing benefit certificate
  certify client company complete completed compliance confirm contract
  deposit director discuss discussion document documents employee employees
  entry expense expenses filing follow invoice interest ledger legal loan
  meeting needed notice payment pending penalty portal provisional purchase
  quarter quarterly query quotation received reconciliation refund
  registration renewal reply return returns review revise revised salary
  sanction schedule statement submission submit submitted supplier tomorrow
  transaction transfer upgrade vendor verification verify networth
`.trim().split(/\s+/);
const BUSINESS_SET = new Set(BUSINESS);

/* Phrases a word-at-a-time pass cannot see. */
const PHRASES = [
  // "Followup", "follow up" - one word that is two, and the dictionary has neither.
  [/\bfollow[ -]?up\b/gi, (m) => (m[0] === 'F' ? 'Follow-up' : 'follow-up')],
  // "Sena It Return" is the Income Tax return, not the pronoun.
  [/\b[Ii][Tt](?= +(?:return|returns|notice|department|portal|filing|refund)\b)/gi, () => 'IT'],
];

/* Acronyms beyond the shouted-title list that his tasks are full of. */
const MORE_ACRONYMS = ['od', 'fd', 'icici', 'hdfc', 'sbi', 'idbi', 'esic', 'tds', 'gst'];
const ALL_ACRONYMS = new Set([...ACRONYMS, ...MORE_ACRONYMS]);

let dictionary = null;
function words() {
  if (dictionary) return dictionary;
  const valid = new Set();
  const byFirst = new Map();
  const text = fs.readFileSync(new URL('./data/english-words.txt', import.meta.url), 'utf8');
  const offer = (w) => {
    if (!byFirst.has(w[0])) byFirst.set(w[0], []);
    byFirst.get(w[0]).push(w);
  };
  for (const line of text.split('\n')) {
    if (!line) continue;
    // A trailing * marks a rarer word: correct as typed, never offered.
    const rare = line.endsWith('*');
    const w = rare ? line.slice(0, -1) : line;
    valid.add(w);
    if (!rare) offer(w);
  }
  for (const w of BUSINESS) {
    if (!valid.has(w)) offer(w);
    valid.add(w);
  }
  dictionary = { valid, byFirst };
  return dictionary;
}

/** Edits between two words, a swap of neighbours counting as one. */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

const sorted = (w) => [...w].sort().join('');

/** The word this was meant to be, or null when that is not certain. */
export function correctWord(word) {
  const lw = word.toLowerCase();
  if (lw.length < 5 || !/^[a-z]+$/.test(lw)) return null;
  const { valid, byFirst } = words();
  if (valid.has(lw)) return null;

  const businessMax = lw.length >= 8 ? 2 : 1;
  const generalMax = lw.length >= 9 ? 2 : lw.length >= 7 ? 1 : 0;
  let best = Infinity;
  let found = [];
  for (const w of byFirst.get(lw[0]) || []) {
    const max = BUSINESS_SET.has(w) ? businessMax : generalMax;
    if (!max || Math.abs(w.length - lw.length) > max) continue;
    // "followup" is not "follow" with a typo: a word plus a tail is a compound.
    if (lw.startsWith(w) && lw.length - w.length >= 2) continue;
    const d = distance(lw, w);
    if (d > max) continue;
    if (d < best) { best = d; found = [w]; } else if (d === best) found.push(w);
  }
  if (found.length > 1) {
    const business = found.filter((w) => BUSINESS_SET.has(w));
    if (business.length) found = business;
  }
  // "reviwe" is review with two letters swapped, not revise: same letters wins.
  if (found.length > 1) {
    const same = found.filter((w) => sorted(w) === sorted(lw));
    if (same.length === 1) found = same;
  }
  if (found.length !== 1) return null;

  const fixed = found[0];
  // In the shape it was typed: SUBMITED -> SUBMITTED, Rebewal -> Renewal.
  if (word === word.toUpperCase()) return fixed.toUpperCase();
  if (word[0] === word[0].toUpperCase()) return fixed[0].toUpperCase() + fixed.slice(1);
  return fixed;
}

/* A word on its own: not part of an email, a link, a code or a number. */
const WORD = /(^|[^A-Za-z0-9@./_-])([A-Za-z]{5,})(?=$|[^A-Za-z0-9@_])/g;

function tidyLine(line) {
  let text = line.replace(/[ \t]+/g, ' ').trim();
  if (!text) return text;
  for (const [pattern, to] of PHRASES) text = text.replace(pattern, to);
  text = text.replace(WORD, (m, lead, word) => lead + (correctWord(word) || word));
  // Shouted or all lowercase: readable case, as a title has always had - but
  // a line that starts with an email or a link keeps it as typed.
  const first = text.split(' ')[0];
  const linkFirst = /[@/]|^www\./i.test(first);
  text = unshout(text);
  if (linkFirst) text = first + text.slice(first.length);
  // Acronyms in capitals wherever they are: "Icici Bank Od" -> "ICICI Bank OD".
  text = text.replace(/\b[A-Za-z]{2,5}\b/g, (w) => (ALL_ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w));
  // Ordinals stay small: title case would make "1st Floor" read "1St Floor".
  text = text.replace(/\b(\d+)(St|Nd|Rd|Th|ST|ND|RD|TH)\b/g, (m, n, s) => n + s.toLowerCase());
  // Quarters: "q2" is Q2.
  text = text.replace(/\bq([1-4])\b/g, 'Q$1');
  // Shift held a beat too long: "HImansu" is Himansu. Two capitals and then
  // lower case is a slip, never an acronym (those are capitals throughout).
  text = text.replace(/\b([A-Z])([A-Z])([a-z]{2,})\b/g, (m, a, b, rest) => a + b.toLowerCase() + rest);
  // And a capital to start, so the list does not read "need to…" under
  // "Call…" - unless it starts with an address or a link, which have no case.
  if (linkFirst) return text;
  // A line that starts with a number ("1st Floor") has no first word to raise.
  return text.replace(/^([^A-Za-z0-9]*)([a-z])/, (m, lead, c) => lead + c.toUpperCase());
}

/** A task name, a note or a step, tidied line by line. Null stays null. */
export function tidyText(value) {
  if (value === null || value === undefined) return value;
  const text = String(value);
  if (!text.trim()) return text;
  return text.split('\n').map(tidyLine).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
