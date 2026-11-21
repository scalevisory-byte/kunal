/**
 * THE FIVE STAGES A MONTH GOES THROUGH.
 *
 * Dinesh's brief: a workflow strip above the sheet, *"Show the actual current
 * stage and status"* and *"Do not mark payroll as approved or locked
 * automatically."*
 *
 * So the first three stages are READ OFF THE MONTH — they are observations,
 * not switches: is the attendance in, do the rows exist, are there open
 * exceptions. The last two are DECISIONS, and only a person makes those:
 * approval carries a name and a time, and locking carries its own.
 *
 * The difference matters. A month whose attendance is complete is not a
 * month anybody has approved, and an app that slid from one to the other
 * would be approving payroll on the office's behalf.
 *
 * Dependency-free.
 */

export const STAGES = [
  ['attendance', 'Attendance finalisation', 'Attendance and leave verification'],
  ['prepared', 'Salary preparation', 'Figures calculated from the sheet'],
  ['verified', 'Payroll verification', 'Exceptions and deductions checked'],
  ['approved', 'Management approval', 'Reviewed and approved'],
  ['locked', 'Payroll locked', 'Payslips issued, no more editing'],
];

export const stageLabel = (key) => STAGES.find(([k]) => k === key)?.[1] || key;

/**
 * Where the month has got to, and what each stage is waiting for.
 *
 * `done` means the stage is behind us; `at` is the one being worked on. The
 * `why` on a stage that is not done says what is missing, so the strip is
 * something to act on rather than decoration.
 */
export function payrollStage({ period = {}, rows = [], exceptions = [] } = {}) {
  const marked = rows.filter((r) => Object.values(r.attendance || {})
    .some((e) => String((typeof e === 'object' ? e?.code : e) || '').trim())).length;

  /* Only a CRITICAL flag stands in the way. A warning is there to be looked
     at and an informational line is a status, not a problem. */
  const openBad = exceptions.filter((e) => (e.state || 'open') === 'open' && e.severity === 'critical');
  const openAll = exceptions.filter((e) => (e.state || 'open') === 'open');

  const attendanceDone = rows.length > 0 && marked === rows.length;
  const preparedDone = rows.length > 0;
  const verifiedDone = rows.length > 0 && openBad.length === 0;
  const approvedDone = !!period.approved_at;
  const lockedDone = !!period.locked;

  const state = [
    {
      key: 'attendance',
      done: attendanceDone,
      why: rows.length
        ? `${marked} of ${rows.length} have attendance marked`
        : 'nobody is on this month yet',
      /* The two halves of the strip's first stage, so the dashboard can show
         attendance completion apart from salary preparation rather than
         having to read it out of a sentence. */
      marked,
      of: rows.length,
    },
    {
      key: 'prepared',
      done: preparedDone,
      why: rows.length ? `${rows.length} salaries calculated` : 'no rows yet',
    },
    {
      key: 'verified',
      done: verifiedDone,
      /*
       * A tick beside "4 exceptions open" reads as a contradiction, so the
       * line says which it is: only a SERIOUS flag stands in the way, and
       * the rest are there to be looked at rather than cleared.
       */
      why: openBad.length
        ? `${openBad.length} critical of ${openAll.length} open`
        : openAll.length
          ? `${openAll.length} to look at, none critical`
          : 'nothing flagged',
    },
    {
      key: 'approved',
      done: approvedDone,
      why: approvedDone ? `approved by ${period.approved_by || 'somebody'}` : 'waiting for approval',
    },
    {
      key: 'locked',
      done: lockedDone,
      why: lockedDone ? `locked by ${period.locked_by || 'somebody'}` : 'not locked',
    },
  ];

  /* The stage being worked on is the first one that is not done. */
  const at = state.findIndex((s) => !s.done);
  return {
    stages: state.map((s, i) => ({
      ...s,
      label: STAGES[i][1],
      hint: STAGES[i][2],
      current: i === (at === -1 ? state.length - 1 : at),
      step: i + 1,
    })),
    at: at === -1 ? 'locked' : state[at].key,
    /* What stands between the month and being approved. Serious flags only:
       a month can be approved over a note, and the office knows things this
       file does not. */
    blocking: openBad,
  };
}
