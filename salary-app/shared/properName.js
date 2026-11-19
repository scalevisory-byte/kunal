/**
 * TIDYING THE CAPITALISATION OF NAMES.
 *
 * Dinesh, pointing at the roll call: *"sab ke letters thik karo"* — ANSHIKA
 * GUPTA in capitals sitting next to Mahek Gotawala in ordinary letters,
 * because eighty-five names were typed by different people over two years.
 *
 * THE RULE THE WHOLE THING RESTS ON: **only a name that is ALL CAPITALS or
 * all lower case is touched.** A name somebody has already mixed — McDonald,
 * D'Souza, de Souza, DiMaggio, NaRayan — is left exactly as it is, because
 * there is no way to tell a deliberate capital from an accidental one, and
 * "fixing" those is how a register ends up with names their owners do not
 * recognise. What this does is take the shouting out, nothing more.
 *
 * It is a **suggestion, not a rewrite**: `namePlan` says what would change and
 * the office presses the button. Nothing here saves anything, and nothing runs
 * on its own — a person's name is theirs, and this app has never changed one
 * without being asked.
 *
 * Dependency-free, like the rest of shared/.
 */

/** A word that is one letter, or one letter and a full stop: an initial. */
const isInitial = (word) => /^[A-Za-z]\.?$/.test(word);

/**
 * One word, capitalised.
 *
 * An apostrophe and a hyphen both start a new word — D'SOUZA is D'Souza and
 * JEAN-PAUL is Jean-Paul — because both are joins inside a name rather than
 * punctuation between two of them.
 */
function capitalise(word) {
  return word.replace(/[A-Za-z]+/g, (part, at) => {
    const before = word[at - 1];
    // After an apostrophe, a single letter stays as it is: O'Brien, not O'brien,
    // but also d'souza -> D'Souza. The letter after ' is capitalised too.
    const head = part[0].toUpperCase();
    return head + part.slice(1).toLowerCase() + (before === '' ? '' : '');
  });
}

/** Is this worth touching at all — i.e. is it shouted or whispered? */
export function needsTidying(name) {
  const value = String(name ?? '').trim();
  if (!value) return false;
  const letters = value.replace(/[^A-Za-z]/g, '');
  if (!letters) return false;
  const allCaps = letters === letters.toUpperCase();
  const allLower = letters === letters.toLowerCase();
  if (!allCaps && !allLower) return false;      // already mixed: leave it alone.
  return tidyName(value) !== value;
}

/**
 * The tidied name.
 *
 * Also squeezes runs of spaces, because "RAKESH  DAS" and "RAKESH DAS" are
 * two different rows to a computer and one name to everybody else.
 */
export function tidyName(name) {
  const value = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!value) return '';
  return value
    .split(' ')
    .map((word) => (isInitial(word) ? word.toUpperCase() : capitalise(word)))
    .join(' ');
}

/**
 * What would change, for the office to look at before anything is saved.
 *
 * Returns the rows that WOULD move and counts the rest, because "63 names,
 * 12 of them shouting" is the sentence somebody needs in order to press a
 * button that renames people.
 */
export function namePlan(people = []) {
  const changing = [];
  let mixed = 0;
  let already = 0;
  for (const person of people) {
    const name = String(person?.name ?? '').trim();
    if (!name) continue;
    const letters = name.replace(/[^A-Za-z]/g, '');
    const shouted = letters && letters === letters.toUpperCase();
    const whispered = letters && letters === letters.toLowerCase();
    if (!shouted && !whispered) {
      mixed += 1;                                // left alone, on purpose.
      continue;
    }
    const tidy = tidyName(name);
    if (tidy === name) {
      already += 1;
      continue;
    }
    changing.push({ id: person.id, code: person.code || '', from: name, to: tidy });
  }
  return {
    changing,
    count: changing.length,
    // Named so the screen can say WHY the other rows are not on the list.
    left_mixed: mixed,
    already_tidy: already,
    total: people.length,
  };
}
