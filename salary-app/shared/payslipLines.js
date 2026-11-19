/**
 * WHAT A SALARY SLIP SAYS — in one place, so two slips cannot disagree.
 *
 * Dinesh: *"salary slip aur payslip ka bhi print report do"*. There are now
 * two places a slip is laid out as earnings against deductions — the one on
 * screen, and the printed batch of them off the salary sheet — and a third
 * (the self-contained file forwarded on WhatsApp) with its own shape.
 *
 * Two of those are the same document, so they are built from one function.
 * The first version of the printed one was written from the screen's JSX by
 * hand and had already dropped the penalty line.
 *
 * THE RULE THE WHOLE THING RESTS ON: **it assembles, it never recalculates.**
 * Every figure comes out of `calculateRow`. A slip that worked anything out
 * for itself would be a second opinion about somebody's pay.
 *
 * And the one piece of arithmetic that is not a figure from the row: a
 * manual deduction and the late/early charge are INSIDE the gross everywhere
 * else in the app, so they are added back into what was earned and then
 * listed among the deductions. Shown both ways at once, and still balancing
 * to the rupee — earned, less deductions, is the net.
 */

const n = (v) => Number(v) || 0;

/**
 * @param row   the payroll row (for the remark and the mark counts)
 * @param calc  what `calculateRow` returned for it
 */
export function payslipLines(row = {}, calc = {}) {
  const earned = n(calc.gross_salary) + n(calc.deduction) + n(calc.late_salary);

  /*
   * With a salary structure set, the slip lists Basic, HRA and the rest as
   * this month EARNED them — already pro-rated for the days absent — and
   * they add up to the gross exactly. Without one it reads as it always
   * has: the month's salary, less the days absent.
   */
  const broken = calc.earned_basic !== null && calc.earned_basic !== undefined;
  const structure = broken
    ? [
        ['Basic', calc.earned_basic],
        ['HRA', calc.earned_hra],
        ['Conveyance', calc.earned_conveyance],
        ['Medical', calc.earned_medical],
        ['Special allowance', calc.earned_special],
      ]
    : [
        ['Salary for the month', calc.salary],
        ['Less: absent days', -n(calc.absent_salary)],
      ];

  const earnings = [
    ...structure,
    ['Overtime / short hours', calc.ot_salary],
    [row.remark ? `Added: ${row.remark}` : 'Other additions', calc.addition],
  ].filter(([, amount]) => n(amount) !== 0);

  const deductions = [
    ['Professional tax', calc.pt],
    ['ESI', calc.esi],
    ['PF', calc.pf],
    ['Loan / advance', calc.loan_deduction],
    ['Penalty', calc.penalty_deduction],
    [
      `Late / early (${calc.late_chargeable_minutes} min past ${calc.late_concession_minutes} free)`,
      calc.late_salary,
    ],
    [row.remark ? `Deducted: ${row.remark}` : 'Other deductions', calc.deduction],
  ].filter(([, amount]) => n(amount) !== 0);

  return {
    broken,
    earned,
    earnings,
    deductions,
    totalDeductions: deductions.reduce((sum, [, amount]) => sum + n(amount), 0),
    net: n(calc.net_salary),
    /*
     * Sunday duty is settled on its own register, so it is stated for the
     * record and NEVER added into the month's payable. `final_payable` is
     * the net for exactly this reason.
     */
    sunday: n(calc.sunday_salary),
  };
}

/** The facts above the two columns: days, rate, leave. */
export function payslipFacts(row = {}, calc = {}) {
  return [
    ['Working days', calc.working_days],
    ['Present days', calc.present_days],
    ['Absent days', calc.absent_days],
    ['Sundays worked', calc.sundays_worked],
    ['Rate per day', calc.per_day],
    ['Paid leave', row.mark_counts?.PL || 0],
    ['Unpaid leave', row.mark_counts?.UL || 0],
  ];
}
