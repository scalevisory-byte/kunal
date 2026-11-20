/**
 * THE FRONT DESK: housekeeping checks, visitors, and courier in and out.
 *
 * Dinesh sent a single-file tool he had built — Dashboard, Housekeeping,
 * Visitors, Courier, Daily Report, Monthly Summary, Settings — and said
 * *"need this all feature in this"*. So it lives here now, with the rest of
 * the office, instead of in one browser's localStorage on one machine.
 *
 * THE ONE THING CHANGED ON THE WAY IN, and it is the point of this file:
 *
 *   **A DAY NOBODY WALKED IS NOT A CLEAN DAY.** His version starts every
 *   area at "Clean" and counts only the others, so a day on which the
 *   receptionist never opened the app reports a spotless office — the same
 *   trap as the stock take ("not checked" is not "missing") and the
 *   biometric file (a day the machine missed is not 114 absences). Here a
 *   status is blank until somebody records one, and every count is THREE
 *   figures: clean, flagged, and not looked at.
 *
 * Everything else is his: the three verdicts, the fields he logs, and the
 * shape of the report he sends to the boss group.
 *
 * Dependency-free, so the server, the browser and the printed page cannot
 * come to disagree about what the day said.
 */

/* ---------------- housekeeping ---------------- */

/** His three verdicts, in his words. `ok` is the only one that is not a flag. */
export const HK_STATUSES = [
  ['Clean', 'Clean', true],
  ['Not Clean', 'Not clean', false],
  ['Needs Attention', 'Needs attention', false],
];

export const HK_KEYS = HK_STATUSES.map(([key]) => key);
export const isFlag = (status) => HK_KEYS.includes(status) && status !== 'Clean';
export const hkLabel = (status) => HK_STATUSES.find(([k]) => k === status)?.[1] || '';

/** The twelve he had in his own tool, offered as a starting list. */
export const USUAL_AREAS = [
  'Reception', 'Sales Area', 'Accounts', 'Meeting Room', 'Cabins', 'Washroom',
  'Pantry', 'Parking', 'Staircase', 'Store Room', 'Server Room', 'Office Entrance',
];

/* ---------------- courier ---------------- */

export const DIRECTIONS = ['Inward', 'Outward'];
export const isDirection = (value) => DIRECTIONS.includes(value);

/* ---------------- what a day adds up to ---------------- */

const n = (v) => Number(v) || 0;

/**
 * The day's figures, from what is actually recorded.
 *
 * `not_checked` is its own number and is NEVER folded into `clean`. A morning
 * nobody walked and a morning everything was spotless are different facts,
 * and only one of them is worth telling the boss.
 */
export function dayStats({ areas = [], inspections = [], visitors = [], courier = [] } = {}) {
  const byArea = new Map(inspections.map((i) => [Number(i.area_id), i]));
  const live = areas.filter((a) => a.active !== 0 && a.active !== false);

  const flagged = [];
  let clean = 0;
  for (const area of live) {
    const status = byArea.get(Number(area.id))?.status || '';
    if (!status) continue;
    if (isFlag(status)) flagged.push({ area, status, remark: byArea.get(Number(area.id))?.remark || '' });
    else clean += 1;
  }

  const inward = courier.filter((c) => c.direction === 'Inward');
  const outward = courier.filter((c) => c.direction === 'Outward');

  return {
    areas: live.length,
    clean,
    flagged,
    flags: flagged.length,
    /* Never a fault on its own - an area added this morning has not been walked yet. */
    not_checked: live.length - clean - flagged.length,
    visitors: visitors.length,
    /* Out time is recorded, not guessed: no out time means still inside. */
    still_in: visitors.filter((v) => !v.out_time).length,
    courier: courier.length,
    courier_in: inward.length,
    courier_out: outward.length,
  };
}

/* ---------------- the report he sends ---------------- */

const pretty = (iso) => {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return String(iso || '');
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
};

/**
 * The daily report, in his own layout, ready to paste into the boss group.
 *
 * Plain text with WhatsApp's asterisks, exactly as he wrote it. It states
 * what was NOT checked rather than leaving it to read as clean, and it says
 * who is still in the building, because that is the one line on a visitor
 * register anybody reads twice.
 */
export function dailyReportText({
  day, company = 'BOOKNFLY', areas = [], inspections = [], visitors = [], courier = [],
} = {}) {
  const stats = dayStats({ areas, inspections, visitors, courier });
  const lines = [];

  lines.push(`*${String(company).toUpperCase()} FRONT OFFICE REPORT*`);
  lines.push(`Date: ${pretty(day)}`);
  lines.push('');

  lines.push('*Housekeeping*');
  if (stats.flagged.length) {
    for (const f of stats.flagged) {
      lines.push(`- ${f.area.name} — ${hkLabel(f.status)}${f.remark ? ` (${f.remark})` : ''}`);
    }
  } else if (stats.clean) {
    lines.push(`All ${stats.clean} area(s) checked are clean`);
  } else {
    lines.push('Nothing checked yet');
  }
  if (stats.not_checked) lines.push(`(${stats.not_checked} area(s) not checked)`);

  lines.push('');
  lines.push('*Visitors*');
  lines.push(`Count: ${stats.visitors}${stats.still_in ? ` · ${stats.still_in} still in` : ''}`);
  for (const v of visitors) {
    const who = [v.name, v.company ? `(${v.company})` : ''].filter(Boolean).join(' ');
    lines.push(`- ${who} — ${v.purpose || '—'}${v.out_time ? '' : ' [in]'}`);
  }

  lines.push('');
  lines.push('*Courier*');
  lines.push(`In: ${stats.courier_in} | Out: ${stats.courier_out}`);
  for (const c of courier) {
    const bits = [`[${c.direction}]`, c.company || '—'];
    if (c.party) bits.push(`— ${c.party}`);
    /* `ref_no`, which is what the register stores - written as `ref` first,
       and the tracking number quietly never appeared on the report. */
    if (c.ref_no) bits.push(`(Ref: ${c.ref_no})`);
    lines.push(`- ${bits.join(' ')}`);
  }

  lines.push('');
  lines.push('Submitted by: _____________');
  return lines.join('\n');
}

/* ---------------- the month ---------------- */

/**
 * The month rolled up — his summary, plus the figure his could not have.
 *
 * `days_recorded` counts the days somebody actually recorded SOMETHING. A
 * month with eight days recorded and a low flag count is not a clean month;
 * it is a month nobody walked, and the text says which.
 */
export function monthSummary({
  month, areas = [], inspections = [], visitors = [], courier = [],
} = {}) {
  const inMonth = (row) => String(row.day || '').startsWith(month);
  const insp = inspections.filter(inMonth);
  const vis = visitors.filter(inMonth);
  const cou = courier.filter(inMonth);

  const days = new Set([...insp, ...vis, ...cou].map((r) => r.day));

  const byArea = new Map();
  for (const row of insp) {
    if (!isFlag(row.status)) continue;
    const key = Number(row.area_id);
    byArea.set(key, (byArea.get(key) || 0) + 1);
  }
  const names = new Map(areas.map((a) => [Number(a.id), a.name]));
  const flagsByArea = [...byArea.entries()]
    .map(([id, count]) => ({ area_id: id, name: names.get(id) || '—', days: count }))
    .sort((a, b) => b.days - a.days || String(a.name).localeCompare(String(b.name)));

  return {
    month,
    days_recorded: days.size,
    days: [...days].sort(),
    checks: insp.length,
    flags: insp.filter((r) => isFlag(r.status)).length,
    flags_by_area: flagsByArea,
    visitors: vis.length,
    courier_in: cou.filter((c) => c.direction === 'Inward').length,
    courier_out: cou.filter((c) => c.direction === 'Outward').length,
    courier: cou.length,
  };
}

/** "2026-11" as "November 2026", for a heading somebody reads. */
export const monthName = (month) => {
  const [y, m] = String(month || '').split('-').map(Number);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  return y && m ? `${MONTHS[m - 1]} ${y}` : String(month || '');
};

/** The monthly summary as the text he pastes into the group. */
export function monthSummaryText(summary = {}, { company = 'BOOKNFLY' } = {}) {
  const lines = [];
  lines.push(`*${String(company).toUpperCase()} FRONT OFFICE MONTHLY SUMMARY*`);
  lines.push(monthName(summary.month));
  lines.push('');
  lines.push(`Days recorded: ${n(summary.days_recorded)}`);
  lines.push('');
  lines.push('*Cleaning flags by area*');
  if (summary.flags_by_area?.length) {
    for (const row of summary.flags_by_area) lines.push(`${row.name}: ${row.days} day(s)`);
  } else {
    lines.push('None');
  }
  lines.push('');
  lines.push(`Visitors this month: ${n(summary.visitors)}`);
  lines.push(`Courier — In: ${n(summary.courier_in)}, Out: ${n(summary.courier_out)}`);
  return lines.join('\n');
}
