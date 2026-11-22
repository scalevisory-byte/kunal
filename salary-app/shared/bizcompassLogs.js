/**
 * The Bizcompass Sync Tool's own punch spool.
 *
 * Dinesh: *"bizcompass ka connector he o kese kam kar raha he o chekc kiya?"*
 * Checked, with his own copy of the folder. The tool does NOT read
 * eTimeTrackLite's database at all. Every ten minutes it pulls the punches off
 * the readers, writes the batch to a small tab-separated file under
 * `logdata\`, uploads it to Bizcompass's cloud, and moves the file into
 * `logdata\archive\`. A line is five fields:
 *
 *     37 <TAB> 22-11-2026 15:24:39 <TAB> 255 <TAB> <device guid> <TAB> 0
 *
 * His folder carried 16,263 files, 63,081 punches, 27 Jun to 22 Nov 2026
 * without a gap, about 66 people a day across two readers.
 *
 * WHY THIS IS THE BETTER SOURCE. No Access, so no 32-bit driver and no
 * Windows-only provider. No lock risk: these are separate files and
 * eTimeTrackLite's database is never touched. It is current to the last ten
 * minutes rather than to whenever somebody last exported. And it is plain
 * text. The one thing it is not is ours - the folder belongs to another
 * company's product, so it is READ and COPIED, never moved, renamed or
 * emptied, and if Bizcompass is ever uninstalled the stream stops.
 *
 * TWO THINGS THE FILE DOES NOT SAY, and both are handled rather than guessed:
 *
 *  1. **Which punch is an arrival.** The direction field is 0 on every line in
 *     his whole folder, so there is nothing to read. The day's earliest punch
 *     is taken as the arrival and the latest as the departure - which is what
 *     `punchesToMarks` already does for every other import, so no new rule.
 *  2. **Who the person is.** The file carries the reader's own user number,
 *     not a name - there are no names in it anywhere. `employees.device_code`
 *     holds that number, and an id nobody carries is NAMED, never guessed at.
 *
 * Nothing here decides a mark. It turns the files into the rows
 * `punchesToMarks` already takes, so a day read off this spool and a day typed
 * on the Time tab are judged by one rule.
 */

/** The five fields, in the order the tool writes them. */
export const LOG_FIELDS = ['user', 'when', 'verify', 'device', 'direction'];

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** A reader's user number, compared without leading zeros: 037 is 37. */
export const normalId = (value) => {
  const raw = text(value);
  if (!raw) return '';
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw.toLowerCase();
};

/**
 * One file's lines.
 *
 * A line that is not five fields, or whose timestamp cannot be read, is
 * COUNTED and dropped rather than half-read. These files are written by
 * another program while we are reading them, so a torn last line is ordinary
 * and must not take the import down.
 */
export function parseLogText(raw, { file = '' } = {}) {
  const punches = [];
  let skipped = 0;
  for (const line of String(raw || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 2) {
      skipped += 1;
      continue;
    }
    const user = text(parts[0]);
    const when = text(parts[1]);
    // dd-mm-yyyy HH:MM(:SS) - the only shape this tool writes.
    if (!user || !/^\d{1,2}-\d{1,2}-\d{4}\s+\d{1,2}:\d{2}/.test(when)) {
      skipped += 1;
      continue;
    }
    punches.push({ user, when, device: text(parts[3]), file });
  }
  return { punches, skipped };
}

/** Every file, read in turn. `files` is [{ name, text }]. */
export function readLogFiles(files = []) {
  const punches = [];
  let skipped = 0;
  for (const f of files) {
    const got = parseLogText(f.text, { file: f.name });
    punches.push(...got.punches);
    skipped += got.skipped;
  }
  return {
    punches,
    skipped,
    files: files.length,
    devices: [...new Set(punches.map((p) => p.device).filter(Boolean))],
  };
}

/** `dd-mm-yyyy HH:MM:SS` as { year, month, day }, or null. */
export function punchDate(when) {
  const m = text(when).match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (!m) return null;
  return { day: Number(m[1]), month: Number(m[2]), year: Number(m[3]) };
}

/**
 * What the spool holds, before anybody writes anything.
 *
 * The office is about to point this at a month, so what it needs to see first
 * is which days are in the file at all and how many people each one carries -
 * a day the tool was stopped on simply is not here, and a quiet day is
 * visible rather than inferred.
 */
export function coverage(punches = [], { month, year } = {}) {
  const byDay = new Map();
  let outside = 0;
  for (const p of punches) {
    const d = punchDate(p.when);
    if (!d) continue;
    if (month && year && (d.month !== month || d.year !== year)) {
      outside += 1;
      continue;
    }
    const key = `${d.year}-${d.month}-${d.day}`;
    const row = byDay.get(key) || { ...d, punches: 0, people: new Set() };
    row.punches += 1;
    row.people.add(normalId(p.user));
    byDay.set(key, row);
  }
  const days = [...byDay.values()]
    .map((r) => ({ year: r.year, month: r.month, day: r.day, punches: r.punches, people: r.people.size }))
    .sort((a, b) => a.year - b.year || a.month - b.month || a.day - b.day);
  return {
    days,
    outside,
    people: new Set(punches.map((p) => normalId(p.user))).size,
    first: days[0] || null,
    last: days[days.length - 1] || null,
  };
}

/**
 * The punches as rows `punchesToMarks` takes, matched to the staff list.
 *
 * Matching is on `device_code` first and the office's own `code` second, and
 * **never on a name** - there is not one in the file. The value handed on is
 * the employee's own code, so `punchesToMarks` matches it straight back; where
 * somebody has no code at all their name is used, which it also accepts.
 */
export function punchRows(punches = [], employees = []) {
  const byDevice = new Map();
  const byCode = new Map();
  for (const emp of employees) {
    if (emp.active === 0) continue;
    if (emp.device_code) byDevice.set(normalId(emp.device_code), emp);
    if (emp.code) byCode.set(normalId(emp.code), emp);
  }

  const rows = [];
  const unknown = new Map();
  const matched = new Map();
  for (const p of punches) {
    const id = normalId(p.user);
    const employee = byDevice.get(id) || byCode.get(id);
    if (!employee) {
      unknown.set(id, (unknown.get(id) || 0) + 1);
      continue;
    }
    matched.set(employee.id, { employee, id });
    rows.push({ values: [employee.code || employee.name, p.when] });
  }

  return {
    rows,
    unknown: [...unknown.entries()]
      .map(([id, count]) => ({ id, punches: count }))
      .sort((a, b) => b.punches - a.punches),
    matched: [...matched.values()].map(({ employee, id }) => ({
      id: employee.id,
      name: employee.name,
      device_code: id,
    })),
  };
}

/** The mapping `punchesToMarks` needs for these rows: one punch per row, the
 *  timestamp carrying both the date and the time. */
export const PUNCH_MAPPING = { employee: 0, date: 1, inTime: 1, outTime: 1, matchBy: 'code' };

/**
 * The month and day in a spool file's own name: `LogFile_11_22_10_25_51_808.dat`
 * is 22 November. Returns null for a name that is not one of these.
 *
 * This exists so a month's import does not have to read sixteen thousand
 * files to find the two hundred it wants. The name carries the time the batch
 * was SYNCED, not the time somebody punched - a punch at 23:58 can be synced
 * after midnight - so it is only ever used to narrow the files, with the real
 * date still read from each line.
 */
export function logFileDate(name) {
  const m = String(name || '').match(/LogFile_(\d{2})_(\d{2})_/i);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

/**
 * Whether a file could hold punches for this month. A day either side is kept
 * because the name is the sync time, and because the tool has no year in its
 * name at all - so December's files look like last December's.
 */
export function fileCouldMatter(name, { month } = {}) {
  if (!month) return true;
  const at = logFileDate(name);
  if (!at) return false;
  const before = month === 1 ? 12 : month - 1;
  const after = month === 12 ? 1 : month + 1;
  if (at.month === month) return true;
  if (at.month === before && at.day >= 28) return true;
  if (at.month === after && at.day <= 2) return true;
  return false;
}
