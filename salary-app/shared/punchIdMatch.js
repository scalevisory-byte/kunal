/**
 * Giving each person the number the punch reader knows them by.
 *
 * The Bizcompass spool carries no names - only a reader user number - so
 * until `employees.device_code` is filled, nobody's punches reach anybody.
 * The machine's own Basic Work Duration report carries BOTH: its "Emp. Code"
 * is that same number, with the name beside it. So the mapping already exists
 * on paper; this works out who is who.
 *
 * NOTHING HERE IS APPLIED BY ITSELF, and that is not caution for its own
 * sake. The two lists are typed by different people and do not agree:
 * "AJEET UPADHYAY" on the machine is "AJEETKUMAR UPDHYAY" on the payroll,
 * "ALIFIYA CHIKHALIWAL" is "ALIFAYA CHIKHALIWALA". A fuzzy match that wrote
 * itself through would put one person's attendance on another person's
 * payslip, and nobody would find it until somebody queried their own pay.
 *
 * So every pair comes back with a confidence and the office ticks it. Exact
 * matches arrive ticked; anything less arrives UNTICKED with what differs.
 */

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** Case, punctuation and double spaces thrown away; nothing else. */
export const normaliseName = (value) =>
  text(value)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokens = (value) => normaliseName(value).split(' ').filter(Boolean);

/** How many single-character edits turn one word into the other. */
export function editDistance(a = '', b = '') {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/** Two words count as the same person's word if one is a near-miss or a
 *  prefix of the other - AJEET/AJEETKUMAR, UPDHYAY/UPADHYAY. */
function wordsMatch(a, b) {
  if (a === b) return true;
  const long = a.length >= b.length ? a : b;
  const short = a.length >= b.length ? b : a;
  if (short.length >= 4 && long.startsWith(short)) return true;
  const allowed = short.length <= 4 ? 1 : 2;
  return editDistance(a, b) <= allowed;
}

/**
 * 0 to 1, where 1 is the same name written the same way.
 *
 * Measured on the WORDS, because that is how these two lists differ: a middle
 * name present on one side, a surname spelt a letter differently, the order
 * swapped. Scored over the shorter name's words, so "AJEET UPADHYAY" against
 * "AJEETKUMAR UPDHYAY" is a strong match and "AJEET" alone against
 * "AJEET UPADHYAY" is only a partial one.
 */
export function nameScore(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.length || !right.length) return 0;
  if (normaliseName(a) === normaliseName(b)) return 1;

  const spare = [...right];
  let hit = 0;
  let exact = 0;
  for (const word of left) {
    const at = spare.findIndex((other) => wordsMatch(word, other));
    if (at >= 0) {
      if (spare[at] === word) exact += 1;
      hit += 1;
      spare.splice(at, 1);
    }
  }
  const shorter = Math.min(left.length, right.length);
  const longer = Math.max(left.length, right.length);
  // Every word of the shorter name found, and the lengths close: a strong
  // match. Words only near-missed rather than equal costs a little.
  const covered = hit / shorter;
  const balance = shorter / longer;
  const crispness = hit ? 0.9 + 0.1 * (exact / hit) : 0;
  return Math.round(covered * balance * crispness * 100) / 100;
}

/** Ticked by default, or shown and left for somebody to decide. */
export const SURE = 0.82;
export const MAYBE = 0.6;

/**
 * The proposal.
 *
 * @param people     [{ code, name, company }] off the machine's report
 * @param employees  the staff list
 * @returns { pairs, onlyOnMachine, stillWithout, conflicts }
 *   pairs carry `suggest` (tick it by default) and `why`.
 */
export function matchPunchIds({ people = [], employees = [] } = {}) {
  const staff = employees.filter((e) => e.active !== 0 && !e.is_draft);
  const taken = new Map();
  for (const e of staff) {
    const has = text(e.device_code);
    if (has) taken.set(has, e);
  }

  const pairs = [];
  const onlyOnMachine = [];
  const claimed = new Set();

  for (const person of people) {
    const code = text(person.code);
    const name = text(person.name);
    if (!code || !name) continue;

    let best = null;
    let bestScore = 0;
    for (const employee of staff) {
      const score = nameScore(name, employee.name);
      if (score > bestScore) {
        bestScore = score;
        best = employee;
      }
    }

    if (!best || bestScore < MAYBE) {
      onlyOnMachine.push({ code, name, company: person.company || '', best: best?.name || '', score: bestScore });
      continue;
    }

    const already = text(best.device_code);
    const heldBy = taken.get(code);
    const pair = {
      code,
      machine_name: name,
      company: person.company || '',
      employee_id: best.id,
      employee_name: best.name,
      employee_code: best.code || '',
      score: bestScore,
      already: already || null,
      // Exact spelling, nothing already set, nobody else holding the number.
      suggest: bestScore >= SURE && !already && (!heldBy || heldBy.id === best.id),
      why: '',
    };

    if (already && already !== code) {
      pair.suggest = false;
      pair.why = `already has ${already}`;
    } else if (already === code) {
      pair.suggest = false;
      pair.why = 'already set';
    } else if (heldBy && heldBy.id !== best.id) {
      pair.suggest = false;
      pair.why = `${code} is already on ${heldBy.name}`;
    } else if (bestScore < SURE) {
      pair.why = 'the names are not spelt the same';
    }

    pairs.push(pair);
    claimed.add(best.id);
  }

  // Two machine numbers wanting the same person: both are shown, neither is
  // ticked - one of them is somebody else and nobody here can say which.
  const perEmployee = new Map();
  for (const pair of pairs) {
    perEmployee.set(pair.employee_id, (perEmployee.get(pair.employee_id) || 0) + 1);
  }
  const conflicts = [];
  for (const pair of pairs) {
    if (perEmployee.get(pair.employee_id) > 1) {
      pair.suggest = false;
      pair.why = pair.why || 'two numbers point at this person';
      conflicts.push({ employee_name: pair.employee_name, code: pair.code });
    }
  }

  const stillWithout = staff
    .filter((e) => !text(e.device_code) && !claimed.has(e.id))
    .map((e) => ({ id: e.id, name: e.name, code: e.code || '' }));

  return {
    pairs: pairs.sort((a, b) => b.score - a.score || a.employee_name.localeCompare(b.employee_name)),
    onlyOnMachine,
    stillWithout,
    conflicts,
    counts: {
      machine: people.length,
      staff: staff.length,
      suggested: pairs.filter((p) => p.suggest).length,
      toCheck: pairs.filter((p) => !p.suggest && p.why !== 'already set').length,
      alreadySet: pairs.filter((p) => p.why === 'already set').length,
    },
  };
}
