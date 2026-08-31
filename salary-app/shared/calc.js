/**
 * Salary calculation engine.
 *
 * This is a direct translation of the "April" tab of Salary_Sheet_2627.xlsx,
 * column by column, so a row produced here can be checked against the sheet:
 *
 *   AH Working Days      always 26, as in the sheet
 *   AI Sunday            sundays worked, paid extra at the day rate
 *   AJ Absent Days       =COUNTIF(D:AG,"A") + COUNTIF(D:AG,"HF")*0.5 + COUNTIF(D:AG,"AD")*2
 *   AK Present Days      =AH-AJ
 *   AL Salary            monthly salary (CTC as entered on the master)
 *   AM Sunday Salary     =AI*AP
 *   AN Absent Salary     =AP*AJ
 *   AO Gross Salary      =AL-AN
 *   AP Salary / Day      =AL/26
 *   AQ Salary / Hour     =AL/26/9
 *   AR Salary / Minutes  =AQ/60
 *   AS OT/LT In Minutes  short/extra minutes marked on the days, or entered
 *                        (negative = late / short hours, positive = overtime)
 *   AT OT/LT Salary      =AR*AS
 *   AU Deduction/Additions  entered by hand, as an addition and a deduction
 *   AV Gross Salary      =ROUND(AO+AT+AU,0)
 *   AW PT                =IF(AV>12000,200,0) - on the month's gross
 *   AX ESI               entered
 *   AY PF                entered
 *   AZ Net Salary        =AV-AW-AX-AY, less any loan instalment
 *   BD Sunday Salary     = AM, but paid on the Sunday register alone
 *   BE Final             =AZ. The sheet had =AZ+BD; Dinesh asked for Sunday duty
 *                        to be settled apart, so it no longer lands here.
 *
 * Anywhere the sheet has a hand-typed number over a formula (absent days,
 * OT amount, sunday salary), this module takes an override instead.
 */

/**
 * Attendance marks. P, A, HF, AD, PH, SP, HP, WH and S come from the legend in
 * columns BI/BJ of the sheet. The leave marks were added on top, because the
 * sheet has no way to say "leave" - only plain absence: CL, SL and PL are the
 * three paid kinds, each counted against its own yearly balance, and UL is
 * leave with no balance left to take it from, so it costs a day.
 *
 *   absent - days of salary this mark costs (the sheet's COUNTIF weights)
 *   sunday - days paid extra at the day rate
 *   paid   - the day is worked or paid for; shown to explain the mark
 *
 * Order here is the order the pickers and the legend show them in.
 */
export const ATTENDANCE_CODES = {
  P: { label: 'Present', absent: 0, sunday: 0, paid: true },
  A: { label: 'Absent', absent: 1, sunday: 0, paid: false },
  HF: { label: 'Half Day', absent: 0.5, sunday: 0, paid: true },
  CL: { label: 'Casual Leave', absent: 0, sunday: 0, paid: true },
  SL: { label: 'Sick Leave', absent: 0, sunday: 0, paid: true },
  PL: { label: 'Privilege Leave', absent: 0, sunday: 0, paid: true },
  UL: { label: 'Unpaid Leave', absent: 1, sunday: 0, paid: false },
  PH: { label: 'Paid Holiday', absent: 0, sunday: 0, paid: true },
  SP: { label: 'Sunday Present', absent: 0, sunday: 1, paid: true },
  HP: { label: 'Holiday Present', absent: 0, sunday: 1, paid: true },
  WH: { label: 'Work From Home', absent: 0, sunday: 0, paid: true },
  S: { label: 'Sunday (off)', absent: 0, sunday: 0, paid: true },
  AD: { label: 'Absent (2 days)', absent: 2, sunday: 0, paid: false },
};

/**
 * Every month is paid on 26 working days, whatever the calendar says. This is
 * the /26 in the sheet's AP and AQ formulas and it is deliberately a constant,
 * not a setting: a 30-day month and a 31-day month both divide by 26, so the
 * day rate for a given salary never moves from one month to the next.
 */
export const STANDARD_WORKING_DAYS = 26;

export const DEFAULTS = {
  workingDays: STANDARD_WORKING_DAYS,
  hoursPerDay: 9, // the /9 in AQ
  ptThreshold: 12000, // the 12000 in AW
  ptAmount: 200, // the 200 in AW
};

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const isSet = (v) => v !== null && v !== undefined && v !== '';

/**
 * A day in the attendance map is either the mark on its own (`'A'`) or the mark
 * with minutes attached (`{ code: 'P', minutes: -30 }`). Both shapes are read,
 * so an import that only knows codes still works.
 */
const codeOf = (entry) =>
  String((entry && typeof entry === 'object' ? entry.code : entry) || '').trim().toUpperCase();

const minutesOf = (entry) => (entry && typeof entry === 'object' ? num(entry.minutes) : 0);

/** Round to 2dp for display; money that lands in a payslip uses round0. */
export const round2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;
export const round0 = (n) => Math.round(num(n));

/**
 * Absent days from a day -> code map, exactly as the sheet's COUNTIF does.
 * Codes that are not in the legend are ignored rather than guessed at.
 */
export function absentDaysFromAttendance(attendance = {}) {
  let days = 0;
  for (const entry of Object.values(attendance)) {
    const mark = ATTENDANCE_CODES[codeOf(entry)];
    if (mark) days += mark.absent;
  }
  return round2(days);
}

/** Sundays/holidays actually worked (column AI), from the SP and HP marks. */
export function sundaysFromAttendance(attendance = {}) {
  let days = 0;
  for (const entry of Object.values(attendance)) {
    const mark = ATTENDANCE_CODES[codeOf(entry)];
    if (mark) days += mark.sunday;
  }
  return round2(days);
}

/**
 * Which days were worked as a Sunday or a holiday, in order. The Sunday
 * register lists them; the salary sheet only needs how many there were.
 */
export function sundayDaysFromAttendance(attendance = {}) {
  return Object.entries(attendance)
    .filter(([, entry]) => ATTENDANCE_CODES[codeOf(entry)]?.sunday)
    .map(([day]) => Number(day))
    .sort((a, b) => a - b);
}

/**
 * How many days carry each mark, e.g. { P: 22, PL: 2, A: 1 }. Used for the
 * leave counts on the payslip and in the export - it never feeds the salary,
 * which is driven by the absent/sunday weights above.
 */
/** The paid leave kinds, each with its own yearly quota. */
export const LEAVE_TYPES = [
  { code: 'CL', label: 'Casual', quotaField: 'cl_quota' },
  { code: 'SL', label: 'Sick', quotaField: 'sl_quota' },
  { code: 'PL', label: 'Privilege', quotaField: 'pl_quota' },
];

export function countMarks(attendance = {}) {
  const counts = {};
  for (const entry of Object.values(attendance)) {
    const code = codeOf(entry);
    if (!ATTENDANCE_CODES[code]) continue;
    counts[code] = (counts[code] || 0) + 1;
  }
  return counts;
}

/**
 * Short hours and overtime added up across the month, in minutes.
 * Negative is time not worked and is deducted; positive is overtime.
 * A day needs no mark to carry minutes - someone can be Present and 30 short.
 */
export function minutesFromAttendance(attendance = {}) {
  let minutes = 0;
  for (const entry of Object.values(attendance)) minutes += minutesOf(entry);
  return round2(minutes);
}

/**
 * @param {object} row      payroll row (salary, overrides, deductions)
 * @param {object} period   { hours_per_day, pt_threshold, pt_amount }
 * @param {object} attendance day number -> code
 * @returns every sheet column, computed.
 */
export function calculateRow(row = {}, period = {}, attendance = {}) {
  // Fixed at 26 on purpose - see STANDARD_WORKING_DAYS. Nothing a period or a
  // caller carries can change the divisor behind the day rate.
  const workingDays = STANDARD_WORKING_DAYS;
  const hoursPerDay = num(period.hours_per_day, DEFAULTS.hoursPerDay) || DEFAULTS.hoursPerDay;
  const ptThreshold = num(period.pt_threshold, DEFAULTS.ptThreshold);
  const ptAmount = num(period.pt_amount, DEFAULTS.ptAmount);

  const salary = num(row.salary);

  // AJ / AI: the sheet lets either the COUNTIF or a typed number win.
  const absentDays = isSet(row.absent_days_override)
    ? num(row.absent_days_override)
    : absentDaysFromAttendance(attendance);
  const sundaysWorked = isSet(row.sundays_override)
    ? num(row.sundays_override)
    : sundaysFromAttendance(attendance);

  const presentDays = round2(workingDays - absentDays); // AK
  const perDay = salary / workingDays; // AP
  const perHour = perDay / hoursPerDay; // AQ
  const perMinute = perHour / 60; // AR

  const absentSalary = perDay * absentDays; // AN
  const grossAfterAbsent = salary - absentSalary; // AO

  // AS: the month's short/extra minutes. Marking days adds these up; a number
  // typed on the salary sheet overrides the total, the way the sheet has it.
  const minutesFromDays = minutesFromAttendance(attendance);
  const otMinutes = isSet(row.ot_minutes_override) ? num(row.ot_minutes_override) : minutesFromDays;
  const otSalary = isSet(row.ot_amount_override) // AT
    ? num(row.ot_amount_override)
    : perMinute * otMinutes;

  // AU: anything else, entered by hand. Two boxes rather than one signed number,
  // because a month can carry both - an incentive and a breakage, say - and
  // because a forgotten minus sign is an expensive mistake.
  // `adjustment` is the old single signed field, kept so nothing that still
  // writes it breaks; the migration folds existing values into the two.
  const addition = num(row.addition);
  const deduction = num(row.deduction);
  const adjustment = num(row.adjustment) + addition - deduction;
  const grossSalary = round0(grossAfterAbsent + otSalary + adjustment); // AV

  // AW: professional tax goes on what the month actually pays - the gross, after
  // absences, overtime and adjustments - not on the salary on the master. So a
  // month that a person was largely absent for can fall under the slab.
  // Sunday pay is deliberately NOT counted towards the line; it is settled on
  // its own register, and adding it would move exactly two people in the April
  // sheet.
  const pt = grossSalary > ptThreshold ? ptAmount : 0;
  const esi = num(row.esi); // AX
  const pf = num(row.pf); // AY
  // This month's instalment against a loan or advance, posted on the ledger.
  const loan = num(row.loan_deduction);
  const netSalary = round0(grossSalary - pt - esi - pf - loan); // AZ

  const sundaySalary = isSet(row.sunday_salary_override) // AM / BD
    ? num(row.sunday_salary_override)
    : sundaysWorked * perDay;

  return {
    working_days: workingDays,
    sundays_worked: round2(sundaysWorked),
    absent_days: round2(absentDays),
    present_days: presentDays,
    salary: round2(salary),
    per_day: round2(perDay),
    per_hour: round2(perHour),
    per_minute: round2(perMinute),
    absent_salary: round2(absentSalary),
    gross_after_absent: round2(grossAfterAbsent),
    ot_minutes: round2(otMinutes),
    ot_minutes_from_days: minutesFromDays,
    ot_salary: round2(otSalary),
    addition: round2(addition),
    deduction: round2(deduction),
    adjustment: round2(adjustment),
    gross_salary: grossSalary,
    pt,
    esi: round2(esi),
    pf: round2(pf),
    loan_deduction: round2(loan),
    net_salary: netSalary,
    sunday_salary: round0(sundaySalary),
    // Sunday pay is settled on its own register, so it is deliberately NOT
    // added here - the month's salary and the Sunday duty are paid apart,
    // each with its own status. The source sheet's BE added the two together;
    // Dinesh asked for them separate.
    final_payable: netSalary,
  };
}

/** Company / sheet level totals for the summary strip and the export footer. */
export function totalRows(rows = []) {
  const keys = [
    'salary',
    'absent_salary',
    'ot_salary',
    'addition',
    'deduction',
    'adjustment',
    'gross_salary',
    'pt',
    'esi',
    'pf',
    'loan_deduction',
    'net_salary',
    'sunday_salary',
    'final_payable',
  ];
  const totals = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const row of rows) for (const k of keys) totals[k] += num(row[k]);
  for (const k of keys) totals[k] = round2(totals[k]);
  totals.count = rows.length;
  return totals;
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
