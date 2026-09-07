/**
 * Making a shouted title readable.
 *
 * These are typed fast on a phone, and a good number arrive as "ADV IDMC AUDIT
 * QUERY REVIW". The title is what gets read back on a list for weeks, so it is
 * worth writing properly - but only the *case* is safe to change here. Spelling
 * is left to the extractor, which has the message in front of it and knows what
 * a word was meant to be; guessing at spelling with a rule would turn somebody's
 * name into a word that is not their name.
 *
 * The rule is narrow on purpose: only a title that is entirely uppercase is
 * touched, because that is a shout rather than a choice. A title with any
 * lowercase in it was written deliberately and is left exactly as it is.
 */

/*
 * Words that are uppercase because they are, not because the caps lock was on.
 * Anything here survives; anything with a digit or a hyphen (GSTR-3B, Q1, A2G)
 * survives too. Everything else is a word that was shouted.
 */
const ACRONYMS = new Set([
  'gst', 'gstr', 'tds', 'tcs', 'pan', 'tan', 'noc', 'jv', 'hr', 'ca', 'cs',
  'itr', 'pf', 'esi', 'msme', 'kyc', 'emi', 'neft', 'rtgs', 'imps', 'upi',
  'llp', 'pvt', 'ltd', 'inr', 'ay', 'fy', 'b2b', 'b2c', 'dp', 'adv', 'idmc',
  'bnf', 'rrtm', 'roc', 'din', 'ddt', 'mca', 'sez', 'iec', 'ifsc', 'nach',
  'po', 'grn', 'crm', 'erp', 'sop', 'mou', 'nda', 'usd', 'pdf', 'otp', 'id',
]);

/*
 * Small words that stay down, so the result reads as a line rather than a sign.
 * Everything else is capitalised - including words that do not need it.
 *
 * That is deliberate. Sentence case is what a person would write, but no rule
 * here can tell a name from an ordinary word, and sentence case turned "SEND
 * GSTR-3B TO MEERA" into "...to meera". A name in lowercase is worse than the
 * shouting was: he stops recognising the task as his own. Over-capitalising
 * "Tax Documents" costs nothing by comparison, so the failure is put on that
 * side on purpose.
 */
const SMALL = new Set([
  'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or',
  'the', 'to', 'via', 'with', 'per', 'vs', 'till', 'ka', 'ki', 'ke', 'me',
]);

const SHOUTED = /^[^a-z]*$/;
// Nothing capitalised anywhere: typed in a hurry, lower case throughout.
const MUMBLED = /^[^A-Z]*$/;

/** One word, cased the way it should be read. */
function fix(word, first) {
  const bare = word.replace(/[^A-Za-z0-9]/g, '');
  if (!bare) return word;
  // Codes keep their shape: GSTR-3B is not "Gstr-3b".
  if (/\d/.test(bare) || ACRONYMS.has(bare.toLowerCase())) return word;
  const lower = word.toLowerCase();
  if (!first && SMALL.has(bare.toLowerCase())) return lower;
  // Capitalise the first letter wherever it is, so "(ay" becomes "(Ay".
  return lower.replace(/[a-z]/, (c) => c.toUpperCase());
}

/** The same word from a lower-case title: only the first, and the acronyms. */
function lift(word, first) {
  const bare = word.replace(/[^A-Za-z0-9]/g, '');
  if (!bare) return word;
  // "pay bnf tds" is three words worth reading as "Pay BNF TDS".
  if (ACRONYMS.has(bare.toLowerCase())) return word.toUpperCase();
  if (!first) return word;
  return word.replace(/[a-z]/, (c) => c.toUpperCase());
}

/**
 * A title cased the way it should be read, or the title unchanged.
 *
 * Two shapes are worth touching and everything else is left exactly alone:
 *
 *   ALL CAPS      - a shout rather than a choice; put into readable case.
 *   all lowercase - typed in a hurry; the first letter is raised and the
 *                   acronyms are restored, and nothing else is guessed at.
 *
 * A title with any capital in it already was cased deliberately. And a single
 * word is left alone in both directions - "TDS" must stay "TDS", and "salary"
 * on its own may be exactly what was meant.
 *
 * Proper nouns are the deliberate gap. A rule cannot know that "odisha" is a
 * place and "nidhi" a person, and it cannot know which "pendig" was meant.
 * That is what the extractor is for; see the prompt in extractor.js.
 */
export function unshout(title) {
  const text = String(title ?? '').trim();
  if (!text) return text;

  const shouted = SHOUTED.test(text);
  const mumbled = MUMBLED.test(text);
  if (!shouted && !mumbled) return text;

  const parts = text.split(/(\s+)/);
  const words = parts.filter((p) => p.trim());
  if (words.length < 2) return text;

  let seenWord = false;
  return parts
    .map((part) => {
      if (!part.trim()) return part;
      const cased = shouted ? fix(part, !seenWord) : lift(part, !seenWord);
      seenWord = true;
      return cased;
    })
    .join('');
}
