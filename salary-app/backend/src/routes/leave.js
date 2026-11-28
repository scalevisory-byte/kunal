import { Router } from 'express';
import { leavePolicy, setLeavePolicy, unpaidLeaveUsed } from '../db.js';
import { yearlyLeave } from '../../../shared/leavePolicy.js';
import { applyAutoDouble, autoDoubleRule, autoDoubledIn, missingOutSetting, setAutoDoubleRule, setMissingOutSetting } from '../db.js';
import { requireAbility } from '../auth.js';
import {
  addLeaveCredit,
  getSetting,
  listBonusPayments,
  payBonus,
  setSetting,
  unpayBonus,
  deleteLeaveCredit,
  getEmployee,
  leaveSummary,
  leaveTaken,
  listEmployees,
  listLeaveCredits,
} from '../db.js';
import { balanceRow, entitlementOf, ledgersFor, TAKES_AWAY } from '../../../shared/leaveLedger.js';
import { leaveCalendar } from '../../../shared/leaveCalendar.js';
import { applicationStatus, leaveByDepartment } from '../../../shared/leaveReports.js';
import { bonusRun, normaliseRule } from '../../../shared/leaveBonus.js';
import { normaliseYearRule, yearBonusKind, yearBonusRun } from '../../../shared/leaveBonusYear.js';
import { bonusPaidAnywhere, yearMarks } from '../db.js';
import { calculateRow } from '../../../shared/calc.js';
import { DEFAULT_RULES, entriesFor, yearEndPlan } from '../../../shared/leaveYearEnd.js';
import { buildPayroll } from '../payroll.js';
import { listHolidays, listPeriods, getPeriod } from '../db.js';
import { listRequests } from '../attendanceSelf.js';
import { ATTENDANCE_CODES } from '../../../shared/calc.js';
import { todayIso } from '../../../shared/today.js';
import { LEAVE_CODES, TYPES, byCode, quotasOf } from '../leaveBalance.js';

export const leaveRouter = Router();

/**
 * THE LEAVE TYPES IN PLAY.
 *
 * Read off `ATTENDANCE_CODES`, which is what the grid marks and the salary
 * sheet pays from - NOT a second list of leave types that could disagree
 * with it. A company that wants Compensatory Off adds a mark there, and it
 * appears here, on the ledger and in the balance register without another
 * line of code.
 */
/* One definition of the leave types and of whose quota is whose, shared with
   the balance shown beside every Approve button - see ../leaveBalance.js. */

/** The leave register for a calendar year. Unchanged: other screens read it. */
leaveRouter.get('/', (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const policy = leavePolicy();
  const used = unpaidLeaveUsed(year);
  const rows = leaveSummary(year).map((row) => {
    const line = used.get(row.employee_id) || { CL: 0, SL: 0 };
    return { ...row, yearly: { ...line, ...yearlyLeave({ limit: policy.yearly_limit, used: line.CL + line.SL }) } };
  });
  res.json({ year, rows, policy });
});

/*
 * The leave policy: casual and sick leave unpaid from a month, and the yearly
 * limit. Reading is anybody with the Leave tab; changing it is a Manager or
 * an Admin, because it moves pay. Switching it on reaches the open months
 * from `from` onwards; switching it off reaches nothing already stored - each
 * month keeps its own `leave_unpaid`, changed one month at a time in Settings.
 */
leaveRouter.get('/policy', (_req, res) => res.json({ policy: leavePolicy() }));

leaveRouter.put('/policy', requireAbility('approve'), (req, res) => {
  const policy = setLeavePolicy(req.body || {}, req.actor?.name || 'office');
  res.json({ policy });
});

/** Which leave types the ledger and the register show. */
leaveRouter.get('/types', (_req, res) => res.json({ types: TYPES }));

/**
 * ONE PERSON'S LEDGER, the way Dinesh asked for it: date, particulars,
 * credit, debit, balance, reference, with opening and closing.
 *
 * Every debit is DERIVED from the attendance marks, so this and the muster
 * roll cannot disagree about a day. Only the credits are stored.
 */
leaveRouter.get('/ledger/:employeeId', (req, res) => {
  const employee = getEmployee(Number(req.params.employeeId));
  if (!employee) return res.status(404).json({ error: 'not found' });
  const year = Number(req.query.year) || new Date().getFullYear();

  const ledgers = ledgersFor({
    types: TYPES,
    credits: listLeaveCredits({ employee_id: employee.id, year }),
    takenByCode: byCode(leaveTaken({ year, employee_id: employee.id, codes: LEAVE_CODES })),
    quotas: quotasOf(employee),
    year,
  });

  res.json({
    employee: {
      id: employee.id,
      name: employee.name,
      code: employee.code || '',
      company_name: employee.company_name || '',
      branch_name: employee.branch_name || '',
      department: employee.department || '',
    },
    year,
    types: TYPES,
    ledgers,
  });
});

/**
 * THE BALANCE REGISTER: every person, every type, side by side.
 *
 * Built from the same `ledgerFor` one person's page uses, so a figure here
 * and the ledger behind it cannot differ - which is the whole reason the
 * balances are not computed twice.
 */
leaveRouter.get('/balances', (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const company_id = Number(req.query.company_id) || undefined;
  const employees = listEmployees({ active: true, company_id });

  const credits = listLeaveCredits({ year });
  const taken = leaveTaken({ year, codes: LEAVE_CODES });
  const creditsFor = new Map();
  for (const c of credits) {
    if (!creditsFor.has(c.employee_id)) creditsFor.set(c.employee_id, []);
    creditsFor.get(c.employee_id).push(c);
  }
  const takenFor = new Map();
  for (const t of taken) {
    if (!takenFor.has(t.employee_id)) takenFor.set(t.employee_id, []);
    takenFor.get(t.employee_id).push(t);
  }

  res.json({
    year,
    types: TYPES,
    rows: employees.map((employee) =>
      balanceRow({
        employee,
        ledgers: ledgersFor({
          types: TYPES,
          credits: creditsFor.get(employee.id) || [],
          takenByCode: byCode(takenFor.get(employee.id) || []),
          quotas: quotasOf(employee),
          year,
        }),
      })
    ),
  });
});

/* ---------------- posting a credit ---------------- */

/**
 * The only way the ledger is written to.
 *
 * Nothing here touches attendance: a credit gives somebody leave to take, it
 * does not mark a day. Marking a day is the grid's job and an approval's,
 * and that is still the only thing that changes what anybody is paid.
 */
/**
 * ONE PERSON'S LEDGER FOR ONE CODE, AS IT STANDS.
 *
 * Used by the two doors that take days AWAY, so they cannot disagree about
 * what somebody has left.
 */
const ledgerOf = (employee, code, year) =>
  ledgersFor({
    types: TYPES.filter((t) => t.code === code),
    credits: listLeaveCredits({ employee_id: employee.id, year }),
    takenByCode: byCode(leaveTaken({ year, employee_id: employee.id, codes: [code] })),
    quotas: quotasOf(employee),
    year,
  })[0] || null;

/**
 * NOTHING MAY BE TAKEN OFF A LEDGER THAT IS NOT THERE.
 *
 * Lapsing or encashing more days than somebody has leaves a negative
 * balance that reads as a debt they owe, and they do not owe it. The guard
 * is on the ROUTES - what a person types - and deliberately NOT inside
 * `addLeaveCredit`, because the year end posts exactly the closing balance
 * and must stay able to.
 */
const refuseOverdraw = ({ employee, code, kind, days, year }) => {
  if (!TAKES_AWAY.has(kind)) return;
  const ledger = ledgerOf(employee, code, year);
  if (!ledger) throw new Error('which kind of leave?');

  /*
   * A LEDGER NOBODY HAS STARTED HAS NOTHING ON IT TO TAKE.
   *
   * Until something is posted, the balance is an ASSUMPTION - the yearly
   * entitlement on their record, less what the grid shows as taken - and
   * posting anything ends it. Encashing 3 of somebody's 7 days left them on
   * MINUS 3, reading as a debt they did not owe. Found by driving it.
   */
  if (!ledger.summary.posted) {
    const entitlement = entitlementOf(ledger);
    throw new Error(
      entitlement > 0
        ? `nothing has been posted on ${employee.name}'s ${code} ledger yet — start it with their ${entitlement}-day entitlement first, or these days would come off a balance that is not there`
        : `nothing has been posted on ${employee.name}'s ${code} ledger, and there is no entitlement on their record — post an opening balance first`
    );
  }

  if (days > ledger.summary.closing) {
    throw new Error(
      `they have ${ledger.summary.closing} day(s) of ${code} left in ${year} — ${days} cannot be taken off`
    );
  }
};

leaveRouter.post('/credits', (req, res) => {
  try {
    const body = req.body || {};
    const employee = getEmployee(Number(body.employee_id));
    if (!employee) return res.status(404).json({ error: 'not found' });
    const code = String(body.code || '').toUpperCase();
    const on_date = String(body.on_date || '').slice(0, 10) || todayIso();
    /* A credit's year IS its date - there is no year column - so the year
       being drawn on is the one the entry is dated into. */
    refuseOverdraw({
      employee,
      code,
      kind: body.kind,
      days: Math.abs(Number(body.days) || 0),
      year: Number(on_date.slice(0, 4)),
    });
    res.status(201).json(
      addLeaveCredit({ ...body, code, on_date }, req.actor?.name || 'office')
    );
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

leaveRouter.get('/credits', (req, res) =>
  res.json({
    credits: listLeaveCredits({
      employee_id: Number(req.query.employee_id) || undefined,
      code: req.query.code || undefined,
      year: Number(req.query.year) || undefined,
    }),
  })
);

leaveRouter.delete('/credits/:id', (req, res) =>
  res.json({ deleted: deleteLeaveCredit(Number(req.params.id), req.actor?.name || 'office') })
);

/* ---------------- the calendar ---------------- */

/**
 * A month of leave: approved from the marks, pending from the queue, the
 * holidays and how many people are off anyway.
 *
 * `sync: false`: reading a month to draw a calendar must not backdate a new
 * hire into it or post a loan instalment. The same trap the trend hit.
 */
leaveRouter.get('/calendar/:periodId', (req, res) => {
  const period = getPeriod(Number(req.params.periodId));
  if (!period) return res.status(404).json({ error: 'not found' });
  const payroll = buildPayroll(period.id, {
    sync: false,
    company_id: Number(req.query.company_id) || undefined,
  });
  if (!payroll) return res.status(404).json({ error: 'nothing in that month' });
  res.json(
    leaveCalendar({
      rows: payroll.rows,
      period: payroll.period,
      requests: listRequests({ period_id: period.id }),
      holidays: listHolidays(period.id),
    })
  );
});

/* ---------------- the end of a leave year ---------------- */

const ledgersOf = (employees, year) => {
  const credits = listLeaveCredits({ year });
  const taken = leaveTaken({ year, codes: LEAVE_CODES });
  const creditsFor = new Map();
  for (const c of credits) {
    if (!creditsFor.has(c.employee_id)) creditsFor.set(c.employee_id, []);
    creditsFor.get(c.employee_id).push(c);
  }
  const takenFor = new Map();
  for (const t of taken) {
    if (!takenFor.has(t.employee_id)) takenFor.set(t.employee_id, []);
    takenFor.get(t.employee_id).push(t);
  }
  return employees.map((employee) => ({
    employee,
    ledgers: ledgersFor({
      types: TYPES,
      credits: creditsFor.get(employee.id) || [],
      takenByCode: byCode(takenFor.get(employee.id) || []),
      quotas: quotasOf(employee),
      year,
    }),
  }));
};

/** The rules the year-end tool starts from. Shown, and changeable per run. */
leaveRouter.get('/year-end/rules', (_req, res) => res.json({ rules: DEFAULT_RULES }));

/**
 * WHAT THE YEAR END WOULD DO, by name, before it does anything.
 *
 * There is no year-end job and nothing happens by itself: a balance that
 * moved overnight because the calendar turned is one nobody can explain to
 * the person it belongs to.
 */
leaveRouter.get('/year-end/:year', (req, res) => {
  const year = Number(req.params.year);
  if (!year) return res.status(400).json({ error: 'which year?' });
  const employees = listEmployees({
    active: true,
    company_id: Number(req.query.company_id) || undefined,
  });
  let rules = {};
  try {
    rules = req.query.rules ? JSON.parse(req.query.rules) : {};
  } catch {
    return res.status(400).json({ error: 'the rules are not readable' });
  }
  res.json(yearEndPlan(ledgersOf(employees, year), { year, rules }));
});

/**
 * And then it does it - the SAME plan, posted.
 *
 * Two entries per carried line, not one: the days are taken out of the old
 * year and put into the new one, so each year's ledger stands on its own.
 * Running it twice would post it twice, so the preview says how many
 * carry-forward entries the next year already holds.
 */
leaveRouter.post('/year-end/:year', (req, res) => {
  const year = Number(req.params.year);
  if (!year) return res.status(400).json({ error: 'which year?' });
  const employees = listEmployees({
    active: true,
    company_id: Number(req.body?.company_id) || undefined,
  });
  const plan = yearEndPlan(ledgersOf(employees, year), { year, rules: req.body?.rules || {} });

  /* ALREADY DONE is refused rather than doubled. A second run would carry
     everybody's days across twice, and nothing on the ledger would say
     which entry was the mistake. */
  const already = listLeaveCredits({ year: year + 1 }).filter(
    (c) => c.kind === 'carry_forward' && String(c.reference || '') === `year end ${year}`
  );
  if (already.length && !req.body?.again) {
    return res.status(409).json({
      error: `the ${year} year end has already been run — ${already.length} entries carried into ${year + 1}`,
      already: already.length,
    });
  }

  const by = req.actor?.name || 'office';
  let posted = 0;
  for (const entry of entriesFor(plan)) {
    addLeaveCredit(entry, by);
    posted += 1;
  }
  res.json({ plan, posted });
});

/* ---------------- encashment ---------------- */

/**
 * LEAVE PAID OUT INSTEAD OF TAKEN.
 *
 * Two halves, deliberately apart, exactly like a penalty and its recovery:
 * the DAYS come off the ledger here, and the MONEY only reaches a payslip
 * through a named month. Neither half happens by itself, and recording the
 * days does not pay anybody.
 */
leaveRouter.post('/encash', (req, res) => {
  try {
    const employee = getEmployee(Number(req.body?.employee_id));
    if (!employee) return res.status(404).json({ error: 'not found' });
    const code = String(req.body?.code || '').toUpperCase();
    const days = Number(req.body?.days);
    if (!(days > 0)) return res.status(400).json({ error: 'how many days?' });

    const year = Number(req.body?.year) || new Date().getFullYear();

    /* THE DAYS MUST COME OFF THE YEAR THAT WAS CHECKED. A credit's year is
       its on_date - there is no year column - so an encashment checked
       against 2027 and dated today would pass the balance check on one year
       and take the days off another. A date outside the year is refused by
       name; no date means today when today is in that year, else the last
       day of the year being settled. */
    const on_date = (() => {
      const given = String(req.body?.on_date || '').slice(0, 10);
      if (given) {
        if (Number(given.slice(0, 4)) !== year) {
          throw new Error(`${given} is not in ${year} - the days would come off another year`);
        }
        return given;
      }
      const today = todayIso();
      return Number(today.slice(0, 4)) === year ? today : `${year}-12-31`;
    })();

    refuseOverdraw({ employee, code, kind: 'encashed', days, year });

    const credit = addLeaveCredit(
      {
        employee_id: employee.id,
        code,
        kind: 'encashed',
        days,
        on_date,
        note: req.body?.note || 'encashed',
        reference: req.body?.reference,
      },
      req.actor?.name || 'office'
    );
    res.status(201).json({
      credit,
      /* Said out loud: the days are off the ledger and NOTHING has been
         paid. Paying it is an addition on a named month, typed on the
         salary sheet, where every other one-off payment is. */
      note: 'The days are off the ledger. Nothing has been paid — add the amount to the month on the salary sheet.',
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ---------------- the leave bonus ---------------- */

const BONUS_KEY = 'leave_bonus_rule';

/**
 * THE RULE LIVES ON THE SERVER, not in a browser.
 *
 * It decides what a bonus pays, so one person's localStorage must not own
 * it - the next person running the month would get a different answer and
 * neither could say which was right.
 */
/*
 * Leave without approval costs double, automatically. Reading it is anybody
 * with the Leave tab; switching it is a Manager or an Admin, because it is a
 * rule that takes money and the people it is applied to are HR's own
 * colleagues.
 */
leaveRouter.get('/auto-double', (req, res) => {
  const periodId = Number(req.query.period_id) || null;
  res.json({
    rule: autoDoubleRule(),
    doubled: periodId ? autoDoubledIn(periodId) : [],
    held: periodId ? applyAutoDouble(periodId).held : [],
  });
});

leaveRouter.put('/auto-double', requireAbility('approve'), (req, res) => {
  const by = req.actor?.name || 'office';
  const rule = setAutoDoubleRule({ on: Boolean(req.body?.on), from: req.body?.from }, by);
  // Settled at once on the month they are looking at, so the screen that
  // switched it on shows what that did rather than a promise.
  const periodId = Number(req.body?.period_id) || null;
  const did = periodId ? applyAutoDouble(periodId) : { doubled: 0, restored: 0, held: [] };
  res.json({ rule, did, doubled: periodId ? autoDoubledIn(periodId) : [] });
});

/*
 * The no-out-punch half day. It is a PAY rule, so it is switched by the same
 * people who can approve a day's marks. Reading it is open to anybody with the
 * attendance screen, because the grid shows the reason on a day.
 */
leaveRouter.get('/missing-out', (_req, res) => res.json({ rule: missingOutSetting() }));

leaveRouter.put('/missing-out', requireAbility('approve'), (req, res) => {
  const rule = setMissingOutSetting({ on: Boolean(req.body?.on) }, req.actor?.name || 'office');
  res.json({ rule });
});

leaveRouter.get('/bonus/rule', (_req, res) =>
  res.json({ rule: normaliseRule(getSetting(BONUS_KEY) || {}) })
);

leaveRouter.put('/bonus/rule', (req, res) => {
  try {
    const rule = normaliseRule(req.body || {});
    setSetting(BONUS_KEY, rule, req.actor?.name || 'office');
    res.json({ rule });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * What the month WOULD pay. Nothing is paid by looking.
 *
 * `sync: false`: reading a month to price a bonus must not backdate a new
 * hire into it or post a loan instalment - the same trap the trend hit.
 */
leaveRouter.get('/bonus/:periodId', (req, res) => {
  const period = getPeriod(Number(req.params.periodId));
  if (!period) return res.status(404).json({ error: 'not found' });
  const payroll = buildPayroll(period.id, {
    sync: false,
    company_id: Number(req.query.company_id) || undefined,
  });
  if (!payroll) return res.status(404).json({ error: 'nothing in that month' });

  const stored = normaliseRule(getSetting(BONUS_KEY) || {});
  /* A rule can be tried on without being saved, so the panel can price a
     change before anybody commits to it. */
  let rule = stored;
  if (req.query.rule) {
    try {
      rule = normaliseRule(JSON.parse(req.query.rule));
    } catch {
      return res.status(400).json({ error: 'the rule is not readable' });
    }
  }

  const already = listBonusPayments(period.id);
  const run = bonusRun(payroll.rows, rule, {
    paid: new Set(already.map((p) => Number(p.employee_id))),
  });
  res.json({
    period: payroll.period,
    locked: !!period.locked,
    saved_rule: stored,
    payments: already,
    ...run,
  });
});

/**
 * PAY IT. The one call that moves money.
 *
 * It pays the LINES IT IS GIVEN, which are the ones the office read on the
 * screen - not a second run of the rule that might have moved under them.
 * Anything already paid this month is skipped and named, so a double click
 * cannot pay a bonus twice.
 */
leaveRouter.post('/bonus/:periodId/pay', (req, res) => {
  try {
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    if (!lines.length) return res.status(400).json({ error: 'nobody to pay' });
    const out = payBonus(Number(req.params.periodId), lines, {
      by: req.actor?.name || 'office',
      note: req.body?.note || 'leave bonus',
    });
    res.json({
      ...out,
      note:
        `${out.paid.length} added to the month's salary sheet as an addition. ` +
        'It shows on the payslip under the remark.',
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

leaveRouter.delete('/bonus/payment/:id', (req, res) => {
  try {
    unpayBonus(Number(req.params.id), req.actor?.name || 'office');
    res.json({ taken_back: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ---------------- the yearly leave bonus (v2.48.0) ---------------- */

/*
 * The employment contract's "Paid Leave Structure": 20 days' pay at the
 * monthly salary / 30, by slabs of leaves taken in the calendar year. The
 * rule is a setting, like the monthly bonus's, so the figures the contract
 * names can change without a release.
 */
const YEAR_BONUS_KEY = 'leave_bonus_year_rule';

leaveRouter.get('/bonus-year/rule', (_req, res) =>
  res.json({ rule: normaliseYearRule(getSetting(YEAR_BONUS_KEY) || {}) })
);

leaveRouter.put('/bonus-year/rule', (req, res) => {
  const rule = normaliseYearRule(req.body || {});
  setSetting(YEAR_BONUS_KEY, rule, req.actor?.name || 'office');
  res.json({ rule });
});

/** Who is in a year's bonus: on the payroll, not a draft, not gone before it began. */
const inYear = (e, year) =>
  !e.is_draft && !e.not_on_payroll && (!e.left_on || String(e.left_on) >= `${year}-01-01`) &&
  (!e.joined_on || String(e.joined_on) <= `${year}-12-31`);

leaveRouter.get('/bonus-year/:year', (req, res) => {
  const year = Number(req.params.year);
  if (!(year > 2000 && year < 2200)) return res.status(400).json({ error: 'which year?' });
  const stored = normaliseYearRule(getSetting(YEAR_BONUS_KEY) || {});
  let rule = stored;
  if (req.query.rule) {
    try {
      rule = normaliseYearRule(JSON.parse(req.query.rule));
    } catch {
      return res.status(400).json({ error: 'the rule is not readable' });
    }
  }
  const companyId = Number(req.query.company_id) || null;
  const people = listEmployees({}).filter((e) => inYear(e, year) && (!companyId || Number(e.company_id) === companyId));
  const { byId, months } = yearMarks(year);
  const payments = bonusPaidAnywhere(yearBonusKind(year));
  const run = yearBonusRun(people, byId, rule, {
    year,
    paid: new Set(payments.map((p) => Number(p.employee_id))),
    months_on_record: months,
  });
  // Where each person's bonus went, for the register's Paid column.
  const paidIn = new Map(payments.map((p) => [Number(p.employee_id), p]));
  for (const line of run.lines) {
    const p = paidIn.get(Number(line.employee_id));
    line.paid_in = p ? p.period_label : null;
    line.paid_amount = p ? p.amount : null;
  }
  res.json({ saved_rule: stored, payments, ...run });
});

/**
 * Pay it into a named month - once a YEAR per person, whichever month it
 * goes into (the per-month guard in payBonus alone would let December and
 * January each pay it).
 */
leaveRouter.post('/bonus-year/:year/pay', (req, res) => {
  try {
    const year = Number(req.params.year);
    const kind = yearBonusKind(year);
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    if (!lines.length) return res.status(400).json({ error: 'nobody to pay' });
    const done = new Map(bonusPaidAnywhere(kind).map((p) => [Number(p.employee_id), p.period_label]));
    const fresh = lines.filter((l) => !done.has(Number(l.employee_id)));
    const already = lines
      .filter((l) => done.has(Number(l.employee_id)))
      .map((l) => ({ employee_id: Number(l.employee_id), why: `already paid in ${done.get(Number(l.employee_id))}` }));
    const out = fresh.length
      ? payBonus(Number(req.body?.period_id), fresh, { by: req.actor?.name || 'office', kind, note: `leave bonus ${year}` })
      : { paid: [], skipped: [] };
    res.json({ ...out, skipped: [...already, ...(out.skipped || [])] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ---------------- the reports ---------------- */

/**
 * LEAVE BY DEPARTMENT, for one month.
 *
 * The catalogue listed this as `planned` with the note "Department is on the
 * master and leave is on the marks. Nothing joins the two." That stopped
 * being true when `listPayrollRows` started carrying `e.department` - the
 * join is already on every row of the month being read.
 */
leaveRouter.get('/by-department/:periodId', (req, res) => {
  const period = getPeriod(Number(req.params.periodId));
  if (!period) return res.status(404).json({ error: 'not found' });
  const payroll = buildPayroll(period.id, {
    sync: false,
    company_id: Number(req.query.company_id) || undefined,
  });
  if (!payroll) return res.status(404).json({ error: 'nothing in that month' });
  const rows = payroll.rows.map((row) => ({
    ...row,
    ...calculateRow(row, payroll.period, row.attendance),
  }));
  res.json({ period: payroll.period, ...leaveByDepartment(rows) });
});

/**
 * LEAVE APPLICATION STATUS, with ageing.
 *
 * Listed as `partial` before, because the only thing behind it was the
 * approvals queue - a place to DECIDE things, which never said how long
 * somebody had been waiting or whose move it was.
 */
leaveRouter.get('/applications', (req, res) => {
  const period_id = Number(req.query.period_id) || undefined;
  let requests = listRequests({ period_id });
  const company_id = Number(req.query.company_id) || undefined;
  if (company_id) requests = requests.filter((r) => Number(r.company_id) === company_id);
  /* Whose move it is: a request is with the MANAGER while it is pending and
     that person has one, and with the OFFICE once it has been recommended -
     or straight away if nobody manages them. Worked out here, from
     `reports_to_id`, so the report cannot disagree with who the app
     actually lets recommend it. */
  const managedIds = new Set(
    requests.filter((r) => r.reports_to_id).map((r) => Number(r.employee_id))
  );
  res.json(applicationStatus(requests, { managedIds }));
});

/** Who is on leave on a given day, right now. */
leaveRouter.get('/on-leave/:periodId', (req, res) => {
  const period = getPeriod(Number(req.params.periodId));
  if (!period) return res.status(404).json({ error: 'not found' });
  const day = Number(req.query.day) || new Date().getDate();
  const payroll = buildPayroll(period.id, { sync: false });
  const people = (payroll?.rows || [])
    .map((row) => {
      const entry = row.attendance?.[day];
      const code = (typeof entry === 'object' ? entry?.code : entry) || '';
      return ['CL', 'SL', 'PL', 'UL'].includes(code)
        ? {
            employee_id: row.employee_id,
            name: row.employee_name,
            code: row.employee_code || '',
            company_name: row.company_name,
            department: row.department || '',
            mark: code,
            reason: (typeof entry === 'object' ? entry.reason : '') || '',
          }
        : null;
    })
    .filter(Boolean);
  res.json({ period: payroll?.period || period, day, people });
});
