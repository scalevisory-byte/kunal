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
 *   -- Late/early      the month's late and early minutes past the concession,
 *                      priced at AR. Zero unless the period runs on that policy.
 *   AV Gross Salary      =ROUND(AO+AT+AU,0), less the late/early charge
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

import { monthTotals } from './timesheet.js';

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
import { earnedStructure } from './structure.js';
import { esiFor, isAuto, isNone, pfFor } from './contributions.js';
import { hoursForEmployee, lateEarlyLine, onConcession, onDaysOnly } from './lateEarly.js';
import { monthlyHoursLine, onMonthlyHours } from './monthlyHours.js';

/**
 * WHAT THE OFFICE CALLS EACH MARK.
 *
 * Dinesh's attendance brief lists the codes in his own words - WO, H, LWP,
 * HD, OD - and then says *"Do not introduce duplicate or conflicting leave
 * categories."* Two of those are this app's marks under another name, and
 * adding a second LWP beside UL is exactly the duplicate he is warning
 * against. So the CODE never changes (it is in every saved month, every
 * export and every import) and the alias is shown beside it, so the legend
 * reads in the words the office uses.
 */
export const CODE_ALIASES = {
  S: 'WO',     // Weekly Off - and it is no longer only Sundays
  PH: 'H',     // Holiday
  UL: 'LWP',   // Leave Without Pay
  HF: 'HD',    // Half Day
};

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
  /*
   * OUT ON THE COMPANY'S BUSINESS. A bank run, a client's office, a day at
   * a supplier - at work, just not at this desk. The office had no mark for
   * it, so it went down as P (which hides it) or as leave (which docks it).
   *
   * It is paid exactly like a present day, so NO EXISTING MONTH CAN MOVE:
   * nothing carries this code yet, and it changes none of the twelve above.
   * Deliberately NOT the same as Work From Home - both are paid in full,
   * but a day at a client's office is not a day at home, and the GPS fence
   * treats them differently.
   */
  OD: { label: 'Official Duty', absent: 0, sunday: 0, paid: true },
  S: { label: 'Weekly off', absent: 0, sunday: 0, paid: true },
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
export const codeOf = (entry) =>
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
 * PAID LEAVE TAKEN — casual, sick and privilege leave together.
 *
 * Found by auditing the attendance tab. The salary sheet's **PL** column
 * rendered `PL + CL + SL`, with a tooltip saying so; the attendance grid's
 * column, same label and same month, rendered `counts.PL` alone. One person
 * with a casual leave day and a privilege leave day read **2** on one screen
 * and **1** on the other.
 *
 * The grid's own comment promised they could not disagree, because both read
 * the same `countMarks` — and they did. What differed was the SUM, written
 * out twice. So it is written once here and both screens call it.
 *
 * It mattered more than a label: the grid has no CL or SL column of its own,
 * so a casual leave day was counted in NOTHING. P is days present, Absent is
 * days of salary lost, WO is the weekly off, LWP is unpaid — a CL day is none
 * of those, so fifteen days marked showed as fourteen days accounted for, and
 * nothing on the row said where the fifteenth went.
 *
 * Paid leave costs nobody anything, which is exactly why it has to be
 * visible: it is the figure the leave register is read for.
 */
export const paidLeaveDays = (counts = {}) =>
  (counts.PL || 0) + (counts.CL || 0) + (counts.SL || 0);

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
  /*
   * HOW LONG THIS PERSON'S DAY IS, not the office's.
   *
   * The month's `hours_per_day` is the office day and stays the fallback.
   * Somebody with a shift of their own - a six-hour part-timer, a ten-hour
   * shift - is judged and PAID against their own, because the two halves have
   * to agree: an hour missing from a six-hour day is worth a sixth of that
   * day, and charging it at a ninth while expecting six hours is incoherent.
   *
   * `hoursForEmployee` returns the month's figure for everybody on the office
   * day, and for anybody whose shift is merely at another time of day but the
   * same length - which is most of them. Only a different LENGTH moves a
   * figure. See its own note.
   */
  const hoursPerDay = hoursForEmployee(row, { period }) || DEFAULTS.hoursPerDay;
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
  /*
   * Late and early minutes, pooled for the month against the concession - only
   * when the period is set to that policy. On the default policy the line is
   * still worked out (so the app can say what switching would cost) but it is
   * worth nothing, and not one rupee in this function moves.
   */
  const concessionMode = onConcession(period);
  const lateEarly = lateEarlyLine(attendance, {
    employee: row,
    rules: period,
    per_minute: perMinute,
  });
  /*
   * The late/early charge is settled below, once the month's own account of
   * hours is known - because on `monthly_late` the two must not be added.
   */
  /*
   * Under the concession policy the hours-shortfall is NOT charged as well -
   * a person half an hour late is already half an hour short, and taking both
   * would charge the same half hour twice. Overtime still pays. A number typed
   * over the column wins either way, as it does everywhere else.
   */
  /*
   * THE MONTH AS ONE ACCOUNT OF HOURS - Dinesh's rule, when the period is set
   * to it. Nine hours times the days actually owed; a day short cancels a day
   * long; only the total is charged. Worked out on EVERY policy so the panel
   * can price a switch before it is made, and worth nothing unless the period
   * is on it - exactly as the concession line beside it.
   */
  /*
   * DAYS ONLY. Dinesh: *"Salary count sirf absent present half day se hi
   * ho"*. Neither the day-by-day shortfall, nor the month's total, nor the
   * lateness is charged - the pay comes off the day count, exactly as it did
   * before any clock times existed. Both lines above are still worked out,
   * so the sheet can SHOW the month's hours and the office can decide; and a
   * figure typed into the sheet's OT/LT box still wins, which is the manual
   * column he asked for.
   */
  const daysOnlyMode = onDaysOnly(period);
  const monthlyMode = onMonthlyHours(period);
  const monthlyHours = monthlyHoursLine(attendance, {
    employee: row,
    period,
    per_minute: perMinute,
  });

  /*
   * ONE OF THREE, NEVER TWO.
   *
   * A typed figure wins over all of them, as it does everywhere else.
   * Otherwise: on `monthly` the month's own total is what is charged and the
   * daily minutes are not; on `concession` the shortfall is dropped and only
   * overtime pays, because the lateness is charged instead; on `hours` - the
   * default, and what every existing month runs on - each day stands as it
   * always has.
   */
  const chargedMinutes = isSet(row.ot_minutes_override)
    ? num(row.ot_minutes_override)
    : daysOnlyMode
      ? 0
      : monthlyMode
        ? monthlyHours.minutes
        : concessionMode
          ? Math.max(0, minutesFromDays)
          : minutesFromDays;
  const otMinutes = chargedMinutes;
  const otSalary = isSet(row.ot_amount_override) // AT
    ? num(row.ot_amount_override)
    : perMinute * otMinutes;

  /*
   * ============================================================
   * RUNNING BOTH RULES WITHOUT CHARGING A MINUTE TWICE
   * ============================================================
   *
   * Dinesh: *"late early concession bhi on kar do"*, having just turned the
   * monthly target on. They answer different questions - the total asks
   * whether the hours went in, the concession asks whether somebody turned
   * up on time - so somebody half an hour late who stays half an hour later
   * has passed the first and failed the second, and charging them for it is
   * not a double charge.
   *
   * What the two DO share is the person who is late and never makes it up:
   * those minutes sit in the monthly shortfall AND in the late pool. Adding
   * the two would take them twice, which is the one thing every hours rule
   * in this app refuses to do.
   *
   * So on `monthly_late` the month is charged the GREATER of the two, never
   * the sum. By construction that can never take a minute twice, and it is
   * never less than either rule would have charged on its own. Written as
   * "the shortfall, plus only the lateness that goes beyond it", which is
   * the same arithmetic and reads as what it is.
   */
  const monthlyCharge = monthlyMode && otMinutes < 0 ? Math.abs(otSalary) : 0;
  const lateCharge = concessionMode ? lateEarly.amount : 0;
  const lateSalary = round2(
    monthlyMode && concessionMode ? Math.max(0, lateCharge - monthlyCharge) : lateCharge
  );

  // AU: anything else, entered by hand. Two boxes rather than one signed number,
  // because a month can carry both - an incentive and a breakage, say - and
  // because a forgotten minus sign is an expensive mistake.
  // `adjustment` is the old single signed field, kept so nothing that still
  // writes it breaks; the migration folds existing values into the two.
  const addition = num(row.addition);
  const deduction = num(row.deduction);
  /*
   * `adjustment` is the OLD single signed field, kept so nothing that still
   * writes it breaks. The combined figure is deliberately NOT returned under
   * the same name it is read from.
   *
   * It used to be, and that made this function unsafe to run on its own
   * output: `adjustment` came back already carrying `addition - deduction`,
   * so a second pass added them again. Five screens recompute a row the API
   * has already computed - the sheet, the payslip, the dashboard, the Sunday
   * and leave registers - which is deliberate, so a typed figure moves the
   * totals without waiting for a round trip. With a 1,200 claim paid onto a
   * row, the sheet showed 2,400. The Payslip had been patched for the same
   * thing once before, one screen at a time; this fixes the cause.
   */
  const legacyAdjustment = num(row.adjustment);
  const adjustment = legacyAdjustment + addition - deduction;
  const grossSalary = round0(grossAfterAbsent + otSalary + adjustment - lateSalary); // AV

  // AW: professional tax goes on what the month actually pays - the gross, after
  // absences, overtime and adjustments - not on the salary on the master. So a
  // month that a person was largely absent for can fall under the slab.
  // Sunday pay is deliberately NOT counted towards the line; it is settled on
  // its own register, and adding it would move exactly two people in the April
  // sheet.
  const pt = grossSalary > ptThreshold ? ptAmount : 0;

  /*
   * The salary broken into Basic, HRA and the rest, as this month earned it.
   * Derived from `grossAfterAbsent`, so a breakup never moves a gross.
   * Null until somebody sets one.
   */
  const earned = earnedStructure(row, { salary, gross_after_absent: grossAfterAbsent });

  /*
   * ESI and PF. Both default to the amount typed on the employee - which is
   * what this app has always deducted - and only work themselves out when
   * somebody has chosen `auto` for that person. PF is then charged on the
   * earned Basic, which is what the law charges it on, and ESI on the month's
   * gross if it is under the wage limit.
   *
   * The figures are always computed, even on `fixed`, so the app can say what
   * the rule would give without applying it.
   */
  const workedOut = {
    pf: pfFor({ wages_basic: earned ? earned.basic : null, fallback: grossAfterAbsent }),
    esi: esiFor({ gross: grossSalary }),
  };
  /*
   * Three modes, and only one of them is the default.
   *   fixed - deduct the number typed against this person (what it always did)
   *   auto  - work it out from the rule
   *   none  - the scheme does not apply to them: deduct nothing, report nothing
   * `none` has to be chosen per person; a row that has never been touched is
   * `fixed`, so this cannot move anybody's pay by itself.
   */
  const esi = isNone(row.esi_mode) ? 0 : isAuto(row.esi_mode) ? workedOut.esi.employee : num(row.esi); // AX
  const pf = isNone(row.pf_mode) ? 0 : isAuto(row.pf_mode) ? workedOut.pf.employee : num(row.pf); // AY
  // This month's instalment against a loan or advance, posted on the ledger.
  const loan = num(row.loan_deduction);
  /*
   * This month's instalment against a fine, a loss or damage - posted on the
   * penalty ledger exactly as a loan instalment is.
   *
   * It is its OWN column and deliberately not folded into `deduction`, which
   * is the box somebody types a one-off into. Two things writing one number
   * is how a hand-typed figure gets overwritten by a job, and how the same
   * money gets taken twice when the job runs again.
   */
  const penalty = num(row.penalty_deduction);
  const netSalary = round0(grossSalary - pt - esi - pf - loan - penalty); // AZ

  const sundaySalary = isSet(row.sunday_salary_override) // AM / BD
    ? num(row.sunday_salary_override)
    : sundaysWorked * perDay;

  return {
    working_days: workingDays,
    sundays_worked: round2(sundaysWorked),
    // What the rules give, whether or not they are being applied. The employer
    // side is here because a CTC is the only way to see what a hire costs.
    pf_mode: isNone(row.pf_mode) ? 'none' : isAuto(row.pf_mode) ? 'auto' : 'fixed',
    esi_mode: isNone(row.esi_mode) ? 'none' : isAuto(row.esi_mode) ? 'auto' : 'fixed',
    pf_wages: workedOut.pf.wages,
    pf_on: workedOut.pf.on,
    pf_computed: workedOut.pf.employee,
    pf_employer: workedOut.pf.employer,
    pf_employer_cost: workedOut.pf.employer_cost,
    pf_pension: workedOut.pf.pension,
    esi_wages: workedOut.esi.wages,
    esi_eligible: workedOut.esi.eligible,
    esi_computed: workedOut.esi.employee,
    esi_employer: workedOut.esi.eligible ? workedOut.esi.employer : 0,
    earned_basic: earned ? earned.basic : null,
    earned_hra: earned ? earned.hra : null,
    earned_conveyance: earned ? earned.conveyance : null,
    earned_medical: earned ? earned.medical : null,
    earned_special: earned ? earned.special : null,
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
    // The late/early line. Always reported, only charged on the concession
    // policy - `late_salary` is 0 on the default one, by design.
    late_policy: monthlyMode && concessionMode
      ? 'monthly_late'
      : monthlyMode
        ? 'monthly'
        : concessionMode
          ? 'concession'
          : 'hours',
    /* The month's hours account, so the sheet and the panel can show what is
       owed against what was worked without working it out a second time. */
    monthly_hours_expected: monthlyHours.expected,
    monthly_hours_worked: monthlyHours.worked + monthlyHours.typed,
    monthly_hours_days: monthlyHours.days,
    monthly_hours_diff: monthlyHours.diff,
    monthly_hours_chargeable: monthlyHours.chargeable,
    monthly_hours_amount: monthlyHours.amount,
    monthly_hours_judged: monthlyHours.judged,
    late_minutes: lateEarly.late_minutes,
    early_minutes: lateEarly.early_minutes,
    late_total_minutes: lateEarly.total_minutes,
    late_days: lateEarly.late_days,
    early_days: lateEarly.early_days,
    late_concession_minutes: lateEarly.allowed,
    late_concession_left: lateEarly.left,
    late_chargeable_minutes: lateEarly.chargeable,
    late_computed: lateEarly.amount,
    late_salary: round2(lateSalary),
    shift_in: lateEarly.shift_in,
    shift_out: lateEarly.shift_out,
    addition: round2(addition),
    deduction: round2(deduction),
    // Handed back exactly as it came in, so running this on its own output
    // gives the same answer. The combined figure is `adjustment_total`.
    adjustment: round2(legacyAdjustment),
    adjustment_total: round2(adjustment),
    gross_salary: grossSalary,
    pt,
    esi: round2(esi),
    pf: round2(pf),
    loan_deduction: round2(loan),
    penalty_deduction: round2(penalty),
    net_salary: netSalary,
    // Clock hours typed on the Time tab, or read off the punch machine. They
    // do not price the month on their own - the day's short hours already went
    // into ot_minutes above - but the total is what a wage-hour question is
    // actually asking, so it travels with the row into the export.
    worked_minutes: round0(
      monthTotals(Object.values(attendance || {}), {
        hoursPerDay,
        // The month's own answer on whether the break comes off the day.
        deductLunch: !period.lunch_paid,
      }).worked,
    ),
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
    'late_salary',
    'addition',
    'deduction',
    // The combined figure, which is what this line has always meant.
    'adjustment_total',
    'gross_salary',
    'pt',
    'esi',
    'pf',
    'loan_deduction',
    'penalty_deduction',
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
