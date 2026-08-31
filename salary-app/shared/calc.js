/**
 * Salary calculation engine.
 *
 * This is a direct translation of the "April" tab of Salary_Sheet_2627.xlsx,
 * column by column, so a row produced here can be checked against the sheet:
 *
 *   AH Working Days      period.working_days (26 in the sheet)
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
 *   AU Deduction/Additions  entered (signed)
 *   AV Gross Salary      =ROUND(AO+AT+AU,0)
 *   AW PT                =IF(AV>12000,200,0)
 *   AX ESI               entered
 *   AY PF                entered
 *   AZ Net Salary        =AV-AW-AX-AY
 *   BD Sunday Salary     = AM (paid separately from the net salary)
 *   BE Final             =AZ+BD
 *
 * Anywhere the sheet has a hand-typed number over a formula (absent days,
 * OT amount, sunday salary), this module takes an override instead.
 */

/**
 * Attendance marks. P, A, HF, AD, PH, SP, HP, WH and S come from the legend in
 * columns BI/BJ of the sheet; PL and UL were added because the sheet has no way
 * to say "leave" - it only has plain absence.
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
  PL: { label: 'Paid Leave', absent: 0, sunday: 0, paid: true },
  UL: { label: 'Unpaid Leave', absent: 1, sunday: 0, paid: false },
  PH: { label: 'Paid Holiday', absent: 0, sunday: 0, paid: true },
  SP: { label: 'Sunday Present', absent: 0, sunday: 1, paid: true },
  HP: { label: 'Holiday Present', absent: 0, sunday: 1, paid: true },
  WH: { label: 'Work From Home', absent: 0, sunday: 0, paid: true },
  S: { label: 'Sunday (off)', absent: 0, sunday: 0, paid: true },
  AD: { label: 'Absent (2 days)', absent: 2, sunday: 0, paid: false },
};

export const DEFAULTS = {
  workingDays: 26, // the /26 in AP, AQ
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
 * How many days carry each mark, e.g. { P: 22, PL: 2, A: 1 }. Used for the
 * leave counts on the payslip and in the export - it never feeds the salary,
 * which is driven by the absent/sunday weights above.
 */
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
 * @param {object} period   { working_days, hours_per_day, pt_threshold, pt_amount }
 * @param {object} attendance day number -> code
 * @returns every sheet column, computed.
 */
export function calculateRow(row = {}, period = {}, attendance = {}) {
  const workingDays = num(period.working_days, DEFAULTS.workingDays) || DEFAULTS.workingDays;
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
  const otMinutes = isSet(row.ot_minutes) ? num(row.ot_minutes) : minutesFromDays;
  const otSalary = isSet(row.ot_amount_override) // AT
    ? num(row.ot_amount_override)
    : perMinute * otMinutes;

  const adjustment = num(row.adjustment); // AU
  const grossSalary = round0(grossAfterAbsent + otSalary + adjustment); // AV

  const pt = grossSalary > ptThreshold ? ptAmount : 0; // AW
  const esi = num(row.esi); // AX
  const pf = num(row.pf); // AY
  const netSalary = round0(grossSalary - pt - esi - pf); // AZ

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
    adjustment: round2(adjustment),
    gross_salary: grossSalary,
    pt,
    esi: round2(esi),
    pf: round2(pf),
    net_salary: netSalary,
    sunday_salary: round0(sundaySalary),
    final_payable: round0(netSalary + round0(sundaySalary)),
  };
}

/** Company / sheet level totals for the summary strip and the export footer. */
export function totalRows(rows = []) {
  const keys = [
    'salary',
    'absent_salary',
    'ot_salary',
    'adjustment',
    'gross_salary',
    'pt',
    'esi',
    'pf',
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
