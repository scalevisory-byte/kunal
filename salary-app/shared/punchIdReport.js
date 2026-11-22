/**
 * Who the punch readers can actually reach.
 *
 * Dinesh, after filling in 58 of them: *"punch id report kahi dikhta he?"* —
 * and no, it did not. The number was a column on the Employees table and a
 * list inside the import panel that vanished when the file was closed. There
 * was nowhere to open on an ordinary Tuesday and ask **whose attendance is
 * not going to arrive**.
 *
 * THE DISTINCTION THIS REPORT EXISTS FOR, and nothing else in the app draws
 * it: **having a number is not the same as being reachable.** These machines
 * send a NUMBER and no names whatever. Somebody whose record says
 * `BNF-EMP-0043` and nothing else has a code, looks complete on every screen,
 * and no punch will ever find them. So each person comes out as one of three
 * things, never two:
 *
 *   `own`       a Punch ID is typed on their record — the plain case
 *   `fallback`  no Punch ID, but their employee code IS a number, so the
 *               importer's fallback can still match them
 *   `none`      neither — their attendance cannot arrive, however well the
 *               readers run
 *
 * It counts and sorts. It changes nothing.
 */

/** The reader sends a number, so only a number can ever match one. */
export const isNumericId = (value) => /^\d+$/.test(String(value ?? '').trim());

/** The same id the importer compares on, so this cannot disagree with it. */
export const normalId = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return isNumericId(raw) ? String(Number(raw)) : raw.toLowerCase();
};

export const REACH = {
  own: 'own',
  fallback: 'fallback',
  none: 'none',
};

export const REACH_LABEL = {
  own: 'Punch ID set',
  fallback: 'Matches on their code',
  none: 'Cannot be reached',
};

/** How a punch would find this person, if at all. */
export function reachOf(employee = {}) {
  /*
   * A typed Punch ID is taken at its word, numeric or not. It is what the
   * office says the machine calls this person, and some readers really do
   * send a non-numeric id. Second-guessing it would flag a working setup.
   * The fallback is different: nobody chose it, so it only counts when the
   * code could actually be sent by a reader.
   */
  if (String(employee.device_code || '').trim()) return REACH.own;
  return isNumericId(employee.code) ? REACH.fallback : REACH.none;
}

/** The id a punch would be matched against — '' when there is none. */
export const matchingId = (employee = {}) => {
  const device = String(employee.device_code || '').trim();
  if (device) return normalId(device);
  return isNumericId(employee.code) ? normalId(employee.code) : '';
};

/**
 * `people` is the staff list. `seen` is optional: the reader numbers that have
 * actually sent punches, with a count and when they were last seen. Without it
 * the report still answers who CAN be reached, which is the half that matters
 * most; with it, it can also say which numbers belong to nobody.
 */
export function punchIdReport({ people = [], seen = [] } = {}) {
  const staff = people.filter((p) => p.active !== 0 && !p.is_draft);

  const rows = staff.map((p) => {
    const reach = reachOf(p);
    return {
      employee_id: p.id,
      name: p.name || '',
      code: p.code || '',
      company: p.company_name || '',
      department: p.department || '',
      device_code: String(p.device_code || '').trim(),
      matches_on: matchingId(p),
      reach,
      reach_label: REACH_LABEL[reach],
    };
  });

  /*
   * TWO PEOPLE ON ONE NUMBER is the quiet disaster, not a tidiness problem:
   * every punch on that number lands on whichever of them the importer meets
   * first, so one person is paid for the other's attendance. Found on his real
   * data the first time this was run (ALPESH SHUKLA enrolled as 60 and 82).
   */
  const byId = new Map();
  for (const r of rows) {
    if (!r.matches_on) continue;
    if (!byId.has(r.matches_on)) byId.set(r.matches_on, []);
    byId.get(r.matches_on).push(r);
  }
  const clashes = [...byId.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([id, list]) => ({ id, people: list.map((r) => r.name) }));
  const clashed = new Set(clashes.flatMap((c) => c.people));
  for (const r of rows) r.clash = clashed.has(r.name);

  const known = new Set(rows.map((r) => r.matches_on).filter(Boolean));
  const unknown = seen
    .map((s) => ({
      id: normalId(s.device_code ?? s.id),
      punches: Number(s.punches) || 0,
      last_at: s.last_at || null,
    }))
    .filter((s) => s.id && !known.has(s.id))
    .sort((a, b) => b.punches - a.punches);

  const counts = {
    staff: rows.length,
    own: rows.filter((r) => r.reach === REACH.own).length,
    fallback: rows.filter((r) => r.reach === REACH.fallback).length,
    none: rows.filter((r) => r.reach === REACH.none).length,
    clashes: clashes.length,
    unknown: unknown.length,
    /*
     * `null`, not 0, when nothing has been collected: "no punches have come in
     * yet" and "every number is accounted for" are very different answers and
     * must not share a figure.
     */
    unknownPunches: seen.length ? unknown.reduce((n, u) => n + u.punches, 0) : null,
  };

  return {
    rows: rows.sort((a, b) => {
      // The people who cannot be reached go first - they are the point.
      const order = { none: 0, fallback: 1, own: 2 };
      if (order[a.reach] !== order[b.reach]) return order[a.reach] - order[b.reach];
      return a.name.localeCompare(b.name);
    }),
    clashes,
    unknown,
    counts,
  };
}

/** For the CSV and the print, in the order somebody reads them. */
export const PUNCH_ID_COLUMNS = [
  ['name', 'Name'],
  ['code', 'Employee code'],
  ['company', 'Company'],
  ['department', 'Department'],
  ['device_code', 'Punch ID'],
  ['matches_on', 'A punch matches on'],
  ['reach_label', 'Attendance can arrive'],
];
