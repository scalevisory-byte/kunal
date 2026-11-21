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

/* ---------------- one area, day by day ---------------- */

/** Whole days from one date to another, inclusive. Null when either is missing. */
function daysInRange(from, to) {
  const a = Date.parse(String(from || '').slice(0, 10));
  const b = Date.parse(String(to || '').slice(0, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 86400000) + 1;
}

/**
 * ONE AREA, DOWN THE DAYS.
 *
 * Dinesh: *"area wise history"*. The monthly summary answers "which places
 * are flagged most", which is the right question for a month and the wrong
 * one for an argument about the parking: it says four days and cannot say
 * WHICH four, what was wrong, or who looked.
 *
 * TWO THINGS IT WILL NOT DO:
 *
 *   **It does not invent a verdict for a day nobody walked.** A day with no
 *   row is not clean - it is a day nobody looked, and it is counted as that
 *   and named as that. "Not checked" is its own figure here exactly as it is
 *   everywhere else in this module.
 *
 *   **It counts nothing it cannot see.** Over a range with no dates, the
 *   not-checked figure is `null` - "not known" - rather than nought, which
 *   would read as "every day was walked".
 */
export function areaHistory({ area = null, inspections = [], from = '', to = '' } = {}) {
  const id = Number(area?.id);
  const rows = inspections
    .filter((r) => Number(r.area_id) === id)
    .filter((r) => (!from || String(r.day) >= from) && (!to || String(r.day) <= to))
    .map((r) => ({ ...r, flagged: isFlag(r.status) }))
    .sort((a, b) => String(b.day).localeCompare(String(a.day)));

  const flagged = rows.filter((r) => r.flagged).length;
  const span = daysInRange(from, to);

  return {
    area,
    rows,
    checked: rows.length,
    clean: rows.length - flagged,
    flagged,
    days_in_range: span,
    not_checked: span === null ? null : Math.max(0, span - rows.length),
    /* The last word on it, whenever that was - the figure somebody actually
       wants when they ask "is the parking sorted now". */
    latest: rows[0] || null,
  };
}

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


/* ---------------- visitors: the kinds, the pass, the clock ---------------- */

/**
 * WHO IS AT THE DESK. Dinesh's list, in his order.
 *
 * A type is for counting, not for deciding anything - nothing in this module
 * treats a vendor differently from a client. It is on the register so the
 * month can say what the office's traffic actually is.
 */
export const VISITOR_TYPES = [
  'Business Visitor', 'Client', 'Vendor', 'Candidate',
  'Personal Visitor', 'Government Official', 'Other',
];

/** A mobile number as the register wants it: ten digits, no decoration. */
export function cleanMobile(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  /* +91 and a leading 0 are how people actually type it, so they are taken
     off rather than refused - but anything else is left alone, because
     silently trimming an eleven-digit number would store the wrong one. */
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

export const isMobile = (value) => /^[6-9]\d{9}$/.test(cleanMobile(value));

/**
 * What a visitor pass number looks like: VIS-2026-0001.
 *
 * The year is in it because the series restarts each year, and four digits
 * because an office that takes ten thousand visitors in a year has a bigger
 * problem than its numbering.
 */
export const passNumber = (year, seq) => `VIS-${year}-${String(seq).padStart(4, '0')}`;
export const inwardNumber = (year, seq) => `CR-IN-${year}-${String(seq).padStart(4, '0')}`;

/** Inside, or gone home. Read off the out time rather than stored beside it. */
export const visitorStatus = (visitor = {}) => (visitor.out_time || visitor.out_at ? 'Checked out' : 'Inside');
export const isInside = (visitor = {}) => visitorStatus(visitor) === 'Inside';

const stamp = (day, time, at) => {
  if (at) return Date.parse(at);
  if (!day || !time) return NaN;
  return Date.parse(`${day}T${String(time).padStart(5, '0')}:00`);
};

/**
 * How long they were in the building, in minutes - or null.
 *
 * NULL, NEVER ZERO. "Still inside" and "in and out within the minute" are
 * different facts, and a nought in a duration column would be read as the
 * second one.
 */
export function visitMinutes(visitor = {}) {
  const inAt = stamp(visitor.day, visitor.in_time, visitor.in_at);
  const outAt = stamp(visitor.day, visitor.out_time, visitor.out_at);
  if (!Number.isFinite(inAt) || !Number.isFinite(outAt)) return null;
  const minutes = Math.round((outAt - inAt) / 60000);
  /* A visit that reads as negative is a time typed wrong, not a visit that
     ended before it began: say nothing rather than something absurd. */
  return minutes < 0 ? null : minutes;
}

/** "1h 25m", or "—" when there is nothing to say. */
export function duration(minutes) {
  if (minutes === null || minutes === undefined) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/* ---------------- courier: where a parcel has got to ---------------- */

/**
 * The four states Dinesh listed, and what each one means here.
 *
 * `Pending handover` is the one the register exists for: it arrived, it is
 * in the drawer, and the person it is for has not taken it yet.
 */
export const COURIER_STATUSES = ['Received', 'Pending handover', 'Delivered', 'Returned', 'Sent'];
export const isPending = (row = {}) => row.direction === 'Inward' && row.status === 'Pending handover';

/* ---------------- what the day and the month add up to ---------------- */

/**
 * The four figures on the daily report, and the one that is not obvious.
 *
 * `pending_checkout` is NOT a second name for "currently inside". Somebody
 * who walked in ten minutes ago is inside; somebody signed in yesterday and
 * never signed out is a row nobody closed. The first is the state of the
 * office, the second is a job for the desk - counting them together is how
 * the second one never gets done.
 */
export function visitorKpis(rows = [], { today } = {}) {
  const inside = rows.filter((v) => isInside(v));
  return {
    total: rows.length,
    inside: inside.length,
    checked_out: rows.length - inside.length,
    pending_checkout: today ? inside.filter((v) => v.day < today).length : 0,
  };
}

/** The average visit, in minutes, over the visits that have actually ended. */
export function averageMinutes(rows = []) {
  const done = rows.map((v) => visitMinutes(v)).filter((m) => m !== null && m !== undefined);
  if (!done.length) return null;
  return Math.round(done.reduce((t, m) => t + m, 0) / done.length);
}

/**
 * One breakdown of the month, by whatever is asked for.
 *
 * Six reports out of one function, because they are one question asked six
 * ways - and because a sixth copy of "group, count, average" is a sixth
 * chance for one of them to count differently from the others.
 *
 * A row with nothing in that column is NOT dropped: it is grouped under its
 * own heading. Visitors whose purpose nobody typed are a fact about the
 * register, and a report that quietly left them out would not add up to the
 * total above it.
 */
export const VISITOR_BREAKDOWNS = [
  ['day', 'Date', (v) => v.day],
  ['company', 'Visitor’s company', (v) => v.company],
  ['branch', 'Branch', (v) => v.branch_name],
  ['employee', 'Person met', (v) => v.meeting],
  ['visitor_type', 'Visitor type', (v) => v.visitor_type],
  ['purpose', 'Purpose', (v) => v.purpose],
];

export function breakdown(rows = [], key = 'day') {
  const entry = VISITOR_BREAKDOWNS.find(([k]) => k === key) || VISITOR_BREAKDOWNS[0];
  const get = entry[2];
  const groups = new Map();
  for (const row of rows) {
    const name = String(get(row) || '').trim() || '(not recorded)';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }
  const out = [...groups.entries()].map(([name, list]) => ({
    name,
    employee_id: key === 'employee' ? list.find((r) => r.meet_employee_id)?.meet_employee_id || null : null,
    visitors: list.length,
    inside: list.filter((v) => isInside(v)).length,
    checked_out: list.filter((v) => !isInside(v)).length,
    average_minutes: averageMinutes(list),
  }));
  /* By date it reads as a diary, so it stays in date order. Everything else
     reads as a league table, so the busiest is at the top. */
  return key === 'day'
    ? out.sort((a, b) => String(a.name).localeCompare(String(b.name)))
    : out.sort((a, b) => b.visitors - a.visitors || String(a.name).localeCompare(String(b.name)));
}

/** The courier register's own figures. */
export function courierKpis(rows = []) {
  const inward = rows.filter((c) => c.direction === 'Inward');
  return {
    total: rows.length,
    inward: inward.length,
    outward: rows.length - inward.length,
    pending: inward.filter((c) => c.status === 'Pending handover').length,
    delivered: inward.filter((c) => c.status === 'Delivered').length,
    returned: rows.filter((c) => c.status === 'Returned').length,
  };
}
