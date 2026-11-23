/**
 * How many punches each person actually has — just to look at.
 *
 * Dinesh: *"sare employee ka total punches dekhne ho alag se ek uska report
 * bhi banana / o sirf dekhne k liye hoga"*.
 *
 * ---------------------------------------------------------------------------
 * IT WRITES NOTHING, and it is not a second opinion about attendance.
 *
 * A punch is the raw thing the reader on the wall recorded. What it BECOMES -
 * present, half day, the hours - is worked out by `punchesToMarks` and lives
 * on the attendance grid, and that is what the sheet is paid from. This
 * counts the raw events and nothing else, so it can never disagree with a
 * payslip: it is not asked the same question.
 *
 * What it is for is the question that has no other home: **is this person's
 * attendance arriving at all?** Somebody with 180 punches is on the readers;
 * somebody with none either has no punch ID, has left, or walks through a
 * door nobody enrolled them on. The Punch ID report says whether they COULD
 * be reached; this says whether they actually are.
 * ---------------------------------------------------------------------------
 *
 * Dependency-free. The caller gathers the punches - from our own readers, from
 * the Bizcompass spool, or both - and says where each came from.
 */

import { normalId, reachOf } from './punchIdReport.js';

/** A day, off a 'YYYY-MM-DD HH:MM:SS' or ISO-ish stamp. Null if unreadable. */
export const dayOf = (stamp) => {
  const text = String(stamp || '').trim();
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

const timeOf = (stamp) => {
  const m = String(stamp || '').match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
};

/**
 * One line per employee, plus the reader numbers that belong to nobody.
 *
 * @param punches  [{ code, at, source }] - `at` sortable, `source` free text
 * @param people   the staff list
 */
export function punchTotals(punches = [], people = [], { activeOnly = true } = {}) {
  /* Which employee a reader number belongs to, the way the importer matches:
     the Punch ID when there is one, else a purely numeric employee code. */
  const byId = new Map();
  const staff = people.filter((p) => (activeOnly ? p.active !== 0 : true) && !p.is_draft);
  for (const p of staff) {
    const own = normalId(p.device_code);
    const fallback = normalId(p.code);
    if (own) byId.set(own, p);
    else if (fallback && /^\d+$/.test(String(p.code || '').trim())) byId.set(fallback, p);
  }

  const seen = new Map(); // normalised id -> tally
  for (const punch of punches) {
    const id = normalId(punch.code);
    if (!id) continue;
    let tally = seen.get(id);
    if (!tally) {
      tally = { id, raw: String(punch.code), punches: 0, days: new Set(), sources: new Set(), first: '', last: '' };
      seen.set(id, tally);
    }
    tally.punches += 1;
    const day = dayOf(punch.at);
    if (day) tally.days.add(day);
    if (punch.source) tally.sources.add(punch.source);
    const at = String(punch.at || '');
    if (at && (!tally.first || at < tally.first)) tally.first = at;
    if (at && (!tally.last || at > tally.last)) tally.last = at;
  }

  const lineFor = (person) => {
    const own = normalId(person.device_code);
    const fallback = normalId(person.code);
    const id = own || (/^\d+$/.test(String(person.code || '').trim()) ? fallback : '');
    const tally = id ? seen.get(id) : null;
    return {
      employee_id: person.id,
      employee_name: person.name,
      code: person.code || '',
      company_name: person.company_name || '',
      department: person.department || '',
      punch_id: person.device_code || '',
      reach: reachOf(person),
      // Null, not 0, when they cannot be reached at all: "no punch can ever
      // find them" and "the reader saw them nought times" are different
      // answers, and only the first is somebody's job to fix.
      punches: tally ? tally.punches : reachOf(person) === 'none' ? null : 0,
      days: tally ? tally.days.size : reachOf(person) === 'none' ? null : 0,
      sources: tally ? [...tally.sources].sort() : [],
      first_at: tally ? tally.first : '',
      last_at: tally ? tally.last : '',
      first_day: tally ? dayOf(tally.first) : '',
      last_day: tally ? dayOf(tally.last) : '',
      last_time: tally ? timeOf(tally.last) : '',
    };
  };

  const lines = staff.map(lineFor);

  /* Nobody first, then nothing arriving, then fewest - the report exists for
     the top of that list, not the bottom. */
  const rank = (l) => (l.punches === null ? 0 : l.punches === 0 ? 1 : 2);
  lines.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.punches ?? 0) - (b.punches ?? 0) ||
      a.employee_name.localeCompare(b.employee_name)
  );

  const unknown = [...seen.values()]
    .filter((t) => !byId.has(t.id))
    .map((t) => ({
      id: t.raw,
      punches: t.punches,
      days: t.days.size,
      first_day: dayOf(t.first),
      last_day: dayOf(t.last),
      sources: [...t.sources].sort(),
    }))
    .sort((a, b) => b.punches - a.punches);

  const counted = lines.filter((l) => l.punches !== null);
  return {
    lines,
    unknown,
    totals: {
      people: lines.length,
      // Null when nothing at all has been collected: "no punches have come in"
      // and "every number is accounted for" are different answers.
      punches: punches.length || null,
      reaching: counted.filter((l) => l.punches > 0).length,
      silent: counted.filter((l) => l.punches === 0).length,
      unreachable: lines.length - counted.length,
      unknownPunches: punches.length ? unknown.reduce((n, u) => n + u.punches, 0) : null,
      days: new Set([...seen.values()].flatMap((t) => [...t.days])).size,
    },
  };
}

export const PUNCH_TOTAL_COLUMNS = [
  { key: 'employee_name', label: 'Employee' },
  { key: 'code', label: 'Employee code' },
  { key: 'punch_id', label: 'Punch ID' },
  { key: 'company_name', label: 'Company' },
  { key: 'department', label: 'Department' },
  { key: 'punches', label: 'Punches' },
  { key: 'days', label: 'Days seen' },
  { key: 'first_day', label: 'First' },
  { key: 'last_day', label: 'Last' },
];
