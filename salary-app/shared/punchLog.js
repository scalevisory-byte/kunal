/**
 * THE PUNCH LOG — every punch the readers recorded, one line each.
 *
 * Dinesh: *"sare logs kaha dikhte he?"* — and the honest answer was that this
 * one did not exist. The counts were on Reports → Punch totals and a day's
 * punches showed under the out time on a statement, but there was nowhere to
 * open and read the record itself.
 *
 * ---------------------------------------------------------------------------
 * IT IS THE RAW RECORD, AND IT IS NOT ATTENDANCE.
 *
 * A punch is one door opening. What the day BECOMES — present, half day, the
 * hours, the lunch break — is `punchesToMarks`' job and lives on the grid,
 * which is what the sheet is paid from. The two cannot disagree because they
 * are not asked the same question. Nothing here writes anything.
 *
 * A punch that belongs to NOBODY is listed and named as such rather than
 * dropped. Those are the whole reason somebody opens this: a number nobody
 * carries is attendance arriving for a person it can never reach.
 * ---------------------------------------------------------------------------
 *
 * Dependency-free. The caller gathers the punches and says where each came
 * from; `matcherFor` decides whose it is, the same way every importer does.
 */

import { matcherFor } from './punchTotals.js';
import { normalId } from './punchIdReport.js';

/** The most rows a page may carry. A month is tens of thousands of punches. */
export const PUNCH_LOG_LIMIT = 1500;

/*
 * To the SECOND, deliberately.
 *
 * Everywhere else in the app a time is a minute, because that is what pay is
 * worked out from. Here it is the raw record, and two punches forty seconds
 * apart are two door openings - printed as minutes they read as the same row
 * twice, which looks like a fault in the log rather than what the machine
 * actually saw. This is the one screen whose job is settling an argument
 * about a morning, so it says exactly what was recorded.
 */
const dayOf = (at) => {
  const m = String(at || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return {
    day: Number(m[3]),
    date: `${m[1]}-${m[2]}-${m[3]}`,
    time: `${m[4]}:${m[5]}${m[6] ? `:${m[6]}` : ''}`,
  };
};

/**
 * @param punches  [{ code, at, source }] — `at` sortable
 * @param people   the staff list
 * @param day      narrow to one day of the month, or 0 for all
 * @param employeeId  narrow to one person, or 0 for everybody
 */
export function punchLog(punches = [], people = [], { day = 0, employeeId = 0, limit = PUNCH_LOG_LIMIT } = {}) {
  const { who } = matcherFor(people);

  const all = [];
  let unreadable = 0;
  for (const punch of punches) {
    const when = dayOf(punch.at);
    if (!when) {
      unreadable += 1;
      continue;
    }
    if (day && when.day !== day) continue;
    const person = who(punch.code);
    if (employeeId && person?.id !== employeeId) continue;
    all.push({
      date: when.date,
      day: when.day,
      time: when.time,
      punch_id: String(punch.code ?? ''),
      // `null`, not a name and not an empty string: nobody carries this
      // number, and that is a fact worth reading as a fact.
      employee_id: person ? person.id : null,
      employee_name: person ? person.name : '',
      code: person ? person.code || '' : '',
      company_name: person ? person.company_name || '' : '',
      where: punch.source || '',
    });
  }

  // Newest first: somebody opening this is almost always asking about today.
  all.sort((a, b) => (a.date === b.date ? b.time.localeCompare(a.time) : b.date.localeCompare(a.date)));

  const people_seen = new Set(all.filter((r) => r.employee_id).map((r) => r.employee_id));
  const unknownIds = new Set(all.filter((r) => !r.employee_id).map((r) => normalId(r.punch_id)));

  return {
    // Capped, and the caller is TOLD by how much. A list silently cut short
    // reads as "that is all there was", which on a punch log is a lie that
    // sends somebody looking for a feed that is working perfectly.
    rows: all.slice(0, limit),
    shown: Math.min(all.length, limit),
    total: all.length,
    more: Math.max(0, all.length - limit),
    counts: {
      punches: all.length,
      people: people_seen.size,
      days: new Set(all.map((r) => r.date)).size,
      unmatched: all.filter((r) => !r.employee_id).length,
      unknownIds: unknownIds.size,
      unreadable,
    },
  };
}

export const PUNCH_LOG_COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'time', label: 'Time' },
  { key: 'punch_id', label: 'Punch ID' },
  { key: 'employee_name', label: 'Employee' },
  { key: 'code', label: 'Employee code' },
  { key: 'company_name', label: 'Company' },
  { key: 'where', label: 'Seen by' },
];

/**
 * Whether a day's punches add anything to what the In and Out columns are
 * already showing.
 *
 * The first rule was simply "more than two", on the reasoning that two
 * punches ARE the in and the out and printing them again is noise. v2.0.0
 * broke it: a one-punch day and a day whose last punch is the return from
 * lunch both have their OUT TIME SUPPRESSED, because neither of those is a
 * departure. So the punch was on the record, the Out column read a dash, and
 * nothing on the page showed it - which is exactly what Dinesh reported as
 * *"employee me bhi nahi dikh rahe"*.
 *
 * So the rule is counted, not guessed: show them whenever the two columns do
 * not between them account for every punch.
 */
export function showPunches(day = {}, punches = []) {
  if (punches.length > 2) return true;
  if (!punches.length) return false;
  const ends = (day.in_time ? 1 : 0) + (day.out_time ? 1 : 0);
  return punches.length > ends;
}

/**
 * A day's punches as one readable line.
 *
 * Minutes, because that is the language of every other time in the app - but
 * SECONDS wherever a minute occurs twice in the same day. Two touches of the
 * door forty seconds apart print as "10:50 · 10:50", which reads as a fault
 * rather than as what happened; and that is precisely the day whose out time
 * is blank and most needs explaining.
 */
export function punchTimes(punches = []) {
  const times = punches.map((p) => String(p.at ?? '').trim()).filter(Boolean);
  const minutes = times.map((t) => t.slice(0, 5));
  const twice = new Set(minutes.filter((m, i) => minutes.indexOf(m) !== i));
  return times.map((t, i) => (twice.has(minutes[i]) ? t : minutes[i])).join(' \u00b7 ');
}
