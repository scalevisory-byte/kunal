import { may } from '../../../shared/rights.js';
import { approveSundayPay, assertSundayPayable, withdrawSundayApproval } from '../sundayApproval.js';
import { requireArea } from '../auth.js';
import { Router } from 'express';
import { requireAbility, requireApproval } from '../auth.js';
import {
  applyHoliday,
  clearAttendance,
  createHoliday,
  createPeriod,
  deleteHoliday,
  getHoliday,
  deletePeriod,
  findPeriod,
  getPeriod,
  listAudit,
  listPeriods,
  listAttendance,
  listEmployees,
  listHolidays,
  listReligions,
  setAttendance,
  syncPayrollRows,
  updatePayrollRow,
  updatePeriod,
  setPeriodApproval,
  setPeriodLock,
  audit,
} from '../db.js';
import { reviewPeriod, noteException, employeeStatement } from '../payrollReview.js';
import { exceptionSummary } from '../../../shared/payrollExceptions.js';
import { payrollStage } from '../../../shared/payrollStages.js';
/*
 * Approving and locking a month need the APPROVE ability, whatever the mount
 * allows - a Manager or an Admin. Deleting a month stays an Admin's: that is
 * the installation, not a decision about a month.
 */
const requireApprover = requireApproval;
import { buildPayroll, buildPayslip } from '../payroll.js';
import { ATTENDANCE_CODES } from '../../../shared/calc.js';
import { TIME_FIELDS, parseTime } from '../../../shared/timesheet.js';

import ExcelJS from 'exceljs';
import multer from 'multer';
import {
  planAttendanceImport,
  readAttendanceSheet,
  writeAttendanceSheet,
} from '../../../shared/attendanceSheet.js';

export const periodsRouter = Router();

/*
 * THE MONTH IS TWO JOBS SHARING ONE ROUTER.
 *
 * `/periods/:id/payroll` is the salary sheet; `/periods/:id/attendance` is
 * the grid. Somebody who marks attendance and never sees pay is the whole
 * reason areas exist, so gating the router as one thing would defeat it.
 *
 * The month ITSELF - the list, opening one, its settings - is allowed to
 * anybody with either, because neither job can be done without it.
 */
periodsRouter.use((req, res, next) => {
  const path = req.path || '';
  const wants =
    /^\/\d+\/(attendance|holidays)/.test(path) ? 'attendance'
    : /^\/\d+\/(payroll|payslip|rows|sync)/.test(path) ? 'salary'
    : '';
  if (!wants) {
    if (may(req.actor, 'salary') || may(req.actor, 'attendance')) return next();
    return res.status(403).json({
      error: 'This login covers neither the salary sheet nor attendance, so a month is not open to it.',
    });
  }
  return requireArea(wants)(req, res, next);
});

const sheetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

/* ---------------- the month's register as a spreadsheet ---------------- */

/**
 * The grid, as it stands. Template and export in one file, like the staff
 * sheet: an office typing up a paper register wants the names already down
 * the page and the days already numbered across the top.
 *
 * `?blank=true` leaves the marks out but keeps the people - a fresh grid.
 */
periodsRouter.get('/:id/attendance-sheet', async (req, res, next) => {
  const period = getPeriod(Number(req.params.id));
  if (!period) return res.status(404).json({ error: 'period not found' });
  try {
    const blank = req.query.blank === 'true';
    const marksOf = new Map();
    if (!blank) {
      for (const row of listAttendance(period.id)) {
        if (!row.code) continue;
        if (!marksOf.has(row.employee_id)) marksOf.set(row.employee_id, {});
        marksOf.get(row.employee_id)[row.day] = row.code;
      }
    }
    const people = listEmployees().map((e) => ({
      code: e.code || '',
      name: e.name,
      company: e.company_name || '',
      marks: marksOf.get(e.id) || {},
    }));
    const wb = await writeAttendanceSheet(ExcelJS, { period, people });
    const name = `Attendance-${period.label || `${period.year}-${period.month}`}.xlsx`.replace(/\s+/g, '-');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  } catch (err) {
    next(err);
  }
});

/** The same file coming back. Nothing is written on a dry run. */
periodsRouter.post('/:id/attendance-sheet', sheetUpload.single('file'), async (req, res, next) => {
  const period = getPeriod(Number(req.params.id));
  if (!period) return res.status(404).json({ error: 'period not found' });
  if (period.locked) return res.status(409).json({ error: 'period is locked' });
  if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);

    // Whichever sheet holds the grid - the second one here is the legend,
    // and somebody will rename the first.
    let read = null;
    for (const ws of wb.worksheets) {
      const rows = [];
      ws.eachRow({ includeEmpty: true }, (row, index) => {
        const values = [];
        row.eachCell({ includeEmpty: true }, (cell, column) => {
          values[column - 1] = cell.value;
        });
        rows[index - 1] = values;
      });
      const attempt = readAttendanceSheet(rows);
      if (!attempt.error) { read = { ...attempt, sheet: ws.name }; break; }
    }
    if (!read) {
      return res.status(400).json({
        error: 'no grid was found in that file. Download the month first and fill that in.',
      });
    }

    const existing = {};
    for (const row of listAttendance(period.id)) {
      if (row.code) existing[`${row.employee_id}:${row.day}`] = row.code;
    }

    const plan = planAttendanceImport({
      people: read.people,
      employees: listEmployees(),
      period,
      existing,
    });

    const dryRun = req.body.dry_run === 'true' || req.body.dry_run === true;
    if (!dryRun && plan.entries.length) setAttendance(period.id, plan.entries);

    res.json({
      ...plan,
      // A few thousand rows; the screen only needs what they add up to.
      entries: undefined,
      sheet: read.sheet,
      dryRun,
      written: dryRun ? 0 : plan.entries.length,
    });
  } catch (err) {
    next(err);
  }
});

periodsRouter.get('/', (req, res) => res.json({ periods: listPeriods(), codes: ATTENDANCE_CODES }));

periodsRouter.post('/', (req, res) => {
  const { year, month } = req.body || {};
  const existing = findPeriod(Number(year), Number(month));
  if (existing) return res.status(409).json({ error: 'that month already exists', period: existing });
  try {
    const period = createPeriod(req.body || {});
    syncPayrollRows(period.id);
    res.status(201).json(period);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

periodsRouter.get('/:id', (req, res) => {
  const period = getPeriod(Number(req.params.id));
  if (!period) return res.status(404).json({ error: 'not found' });
  res.json(period);
});

/**
 * A month's own settings are the rules payroll runs on - the PT slab, the hours
 * per day, the late/early policy and its concession, the shift, and whether the
 * month is closed. Those are an admin's to change; HR runs the month inside
 * them. The month's label is housekeeping, so it is not on the list.
 */
const ADMIN_PERIOD_FIELDS = [
  'pt_threshold',
  'pt_amount',
  'hours_per_day',
  'late_policy',
  'late_concession_minutes',
  'late_grace_minutes',
  'monthly_hours_grace',
  'shift_in',
  'shift_out',
  'locked',
];

/** Whoever is signed in, for an approval that has to carry a name. */
const actorOf = (req) =>
  (req.actor?.via === 'session' ? req.actor.name : null) || req.body?.by || req.actor?.name || 'office';

const adminOnlyFields = (req, res, next) => {
  const named = ADMIN_PERIOD_FIELDS.filter((f) => f in (req.body || {}));
  if (!named.length || req.actor?.abilities?.includes('admin')) return next();
  return res.status(403).json({
    error: `${named.join(', ')} ${named.length === 1 ? 'is' : 'are'} an admin\u2019s to change`,
    need: 'admin',
    role: req.actor?.role,
  });
};

periodsRouter.patch('/:id', adminOnlyFields, (req, res) => {
  const by = req.actor?.via === 'session' ? req.actor.name : req.body?.by || req.actor?.name || null;
  const period = updatePeriod(Number(req.params.id), { ...(req.body || {}), by });
  if (!period) return res.status(404).json({ error: 'not found' });
  res.json(period);
});

// Deleting a month takes its payroll and its attendance with it.
periodsRouter.delete('/:id', requireAbility('admin'), (req, res) => {
  if (!deletePeriod(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

/** The calculated sheet: every column the April tab has, per employee. */
periodsRouter.get('/:id/payroll', (req, res) => {
  const payroll = buildPayroll(Number(req.params.id), {
    company_id: Number(req.query.company_id) || undefined,
    // Reading a month normally pulls in new staff and posts this month's loan
    // instalments. Anything reading an OLD month just to look at it - the
    // dashboard's trend - must say sync=false, or a new hire lands in a month
    // they were not there for and a loan takes an instalment out of it.
    sync: req.query.sync !== 'false',
  });
  if (!payroll) return res.status(404).json({ error: 'period not found' });
  res.json(payroll);
});

/** Pull in employees added to the master since the month was created. */
periodsRouter.post('/:id/sync', (req, res) => {
  const period = getPeriod(Number(req.params.id));
  if (!period) return res.status(404).json({ error: 'period not found' });
  if (period.locked) return res.status(409).json({ error: 'period is locked' });
  res.json({ added: syncPayrollRows(period.id) });
});

/*
 * Approving Sunday pay, and taking an approval back. `approve` is the ability
 * the Manager and Admin roles carry and HR, Accounts and Operator do not -
 * "with approval of only manager".
 */
periodsRouter.post('/:id/sunday/approve', requireAbility('approve'), (req, res) => {
  try {
    res.json(approveSundayPay(Number(req.params.id), req.body?.row_ids, { by: req.actor?.name || 'manager' }));
  } catch (err) {
    res.status(/not found/.test(err.message) ? 404 : /locked/.test(err.message) ? 409 : 400).json({ error: err.message });
  }
});

periodsRouter.post('/:id/sunday/unapprove', requireAbility('approve'), (req, res) => {
  try {
    res.json(withdrawSundayApproval(Number(req.params.id), req.body?.row_ids, { by: req.actor?.name || 'manager' }));
  } catch (err) {
    res.status(/not found/.test(err.message) ? 404 : /locked/.test(err.message) ? 409 : 400).json({ error: err.message });
  }
});

periodsRouter.patch('/:id/rows/:rowId', (req, res) => {
  const period = getPeriod(Number(req.params.id));
  if (!period) return res.status(404).json({ error: 'period not found' });
  if (period.locked) return res.status(409).json({ error: 'period is locked' });
  // Whose change this was, for the audit trail. The signed-in user wins over
  // anything the body claims.
  const by = req.actor?.via === 'session' ? req.actor.name : req.body?.by || req.actor?.name || null;
  /*
   * Sunday pay cannot be ticked Paid until a manager has approved the figure
   * it carries. Checked here, on the one route that moves the tick.
   */
  if (req.body?.sunday_status === 'paid') {
    try {
      assertSundayPayable(period.id, Number(req.params.rowId));
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
  }
  const row = updatePayrollRow(Number(req.params.rowId), { ...(req.body || {}), by });
  if (!row) return res.status(404).json({ error: 'row not found' });
  res.json(row);
});

periodsRouter.get('/:id/attendance', (req, res) => {
  const payroll = buildPayroll(Number(req.params.id), {
    company_id: Number(req.query.company_id) || undefined,
  });
  if (!payroll) return res.status(404).json({ error: 'period not found' });
  res.json({
    period: payroll.period,
    codes: ATTENDANCE_CODES,
    employees: payroll.rows.map((row) => ({
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      company_name: row.company_name,
      attendance: row.attendance,
      absent_days: row.absent_days,
      sundays_worked: row.sundays_worked,
      present_days: row.present_days,
      ot_minutes_from_days: row.ot_minutes_from_days,
      overrides: row.overrides,
    })),
  });
});

/** Bulk mark save - the grid sends every cell it changed in one go. */
periodsRouter.post('/:id/attendance', (req, res) => {
  const period = getPeriod(Number(req.params.id));
  if (!period) return res.status(404).json({ error: 'period not found' });
  if (period.locked) return res.status(409).json({ error: 'period is locked' });
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  const unknown = entries
    .map((e) => String(e.code || '').trim().toUpperCase())
    .filter((code) => code && !ATTENDANCE_CODES[code]);
  if (unknown.length) {
    return res.status(400).json({ error: `unknown attendance code(s): ${[...new Set(unknown)].join(', ')}` });
  }
  const badMinutes = entries.filter(
    (e) => e.minutes !== undefined && e.minutes !== null && e.minutes !== '' && !Number.isFinite(Number(e.minutes))
  );
  if (badMinutes.length) return res.status(400).json({ error: 'minutes must be a number' });
  // Clock times are stored as typed, so anything unreadable is rejected here
  // rather than sitting in the database as a blank hour.
  for (const entry of entries) {
    for (const field of TIME_FIELDS) {
      const value = entry[field];
      if (value === undefined || value === null || value === '') continue;
      if (parseTime(value) === null) {
        return res.status(400).json({ error: `${field.replace('_', ' ')} is not a time: ${value}` });
      }
    }
  }
  // Every entry carries whoever made the change, so a corrected mark lands on
  // the audit trail under a name the server checked rather than one typed in.
  const by = req.actor?.via === 'session' ? req.actor.name : req.actor?.name || null;
  res.json({ saved: setAttendance(period.id, entries.map((e) => ({ by, ...e }))) });
});

periodsRouter.delete('/:id/attendance', (req, res) => {
  const period = getPeriod(Number(req.params.id));
  if (!period) return res.status(404).json({ error: 'period not found' });
  if (period.locked) return res.status(409).json({ error: 'period is locked' });
  res.json({ cleared: clearAttendance(period.id, Number(req.query.employee_id) || undefined) });
});

/* ---------------- festivals and holidays ---------------- */

periodsRouter.get('/:id/holidays', (req, res) => {
  const period = getPeriod(Number(req.params.id));
  if (!period) return res.status(404).json({ error: 'period not found' });
  res.json({ holidays: listHolidays(period.id), religions: listReligions() });
});

periodsRouter.post('/:id/holidays', (req, res) => {
  const period = getPeriod(Number(req.params.id));
  if (!period) return res.status(404).json({ error: 'period not found' });
  if (period.locked) return res.status(409).json({ error: 'period is locked' });
  const code = String(req.body?.code || 'PH').toUpperCase();
  if (!ATTENDANCE_CODES[code]) return res.status(400).json({ error: `unknown mark: ${code}` });
  try {
    res.status(201).json(createHoliday(period.id, { ...req.body, code }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

periodsRouter.delete('/:id/holidays/:holidayId', (req, res) => {
  const period = getPeriod(Number(req.params.id));
  if (!period) return res.status(404).json({ error: 'period not found' });
  if (period.locked) return res.status(409).json({ error: 'period is locked' });
  if (!deleteHoliday(Number(req.params.holidayId))) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

/** Writes the festival's mark onto that day for everyone it covers. */
periodsRouter.post('/:id/holidays/:holidayId/apply', (req, res) => {
  const period = getPeriod(Number(req.params.id));
  if (!period) return res.status(404).json({ error: 'period not found' });
  if (period.locked) return res.status(409).json({ error: 'period is locked' });
  const holiday = getHoliday(Number(req.params.holidayId));
  if (!holiday || holiday.period_id !== period.id) return res.status(404).json({ error: 'not found' });
  res.json({ marked: applyHoliday(holiday), holiday: getHoliday(holiday.id) });
});

periodsRouter.get('/:id/payslip/:employeeId', (req, res) => {
  const payslip = buildPayslip(Number(req.params.id), Number(req.params.employeeId));
  if (!payslip) return res.status(404).json({ error: 'not found' });
  res.json(payslip);
});

/* ---------------- the month, reviewed ---------------- */

/**
 * The exceptions on a month, and where it has got to.
 *
 * NOTHING HERE WRITES A PAYROLL ROW. The flags are worked out fresh each
 * time - a figure corrected this morning stops being flagged this afternoon
 * - and only the DECISION about a flag is kept.
 */
periodsRouter.get('/:id/review', (req, res) => {
  /*
   * ONE COMPANY FILTER, BOTH HALVES.
   *
   * The flags were narrowed to the company and the workflow strip was not,
   * so with a company picked the sheet showed BNF's rows under a headline
   * counting every company's exceptions and "85 of 115 have attendance
   * marked". Two figures about two different sets of people, side by side.
   */
  const company_id = Number(req.query.company_id) || undefined;
  const review = reviewPeriod(Number(req.params.id), {
    company_id,
    today: req.query.today || undefined,
  });
  if (!review) return res.status(404).json({ error: 'not found' });
  const payroll = buildPayroll(Number(req.params.id), { company_id, sync: false });
  return res.json({
    ...review,
    summary: exceptionSummary(review.exceptions),
    workflow: payrollStage({
      period: review.period,
      rows: payroll?.rows || [],
      exceptions: review.exceptions,
    }),
  });
});

/** Open / resolved / ignored, with a reason and who said so. */
periodsRouter.put('/:id/review', (req, res) => {
  try {
    res.json(
      noteException({
        ...(req.body || {}),
        period_id: Number(req.params.id),
        by: actorOf(req),
      })
    );
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

/** One person's month: the figures, their months, and what was paid. */
periodsRouter.get('/:id/statement/:employeeId', (req, res) => {
  const statement = employeeStatement(Number(req.params.id), Number(req.params.employeeId));
  if (!statement) return res.status(404).json({ error: 'not found' });
  res.json(statement);
});

/**
 * APPROVING AND LOCKING ARE DECISIONS, so they are their own calls rather
 * than a field somebody can set by accident - and both are an admin's.
 *
 * Approving does not lock: the office still has to pay the month and tick
 * the rows off. Locking after that is what stops the figures moving.
 */
periodsRouter.post('/:id/approve', requireApprover, (req, res) => {
  const period = getPeriod(Number(req.params.id));
  if (!period) return res.status(404).json({ error: 'not found' });
  if (period.approved_at) return res.status(409).json({ error: 'this month is already approved' });

  const today = String(req.body?.today || '').slice(0, 10) || undefined;
  const payroll = buildPayroll(period.id, { sync: false });
  const review = reviewPeriod(period.id, { today });
  const stage = payrollStage({ period, rows: payroll?.rows || [], exceptions: review?.exceptions || [] });

  /*
   * A CRITICAL flag has to be dealt with before the month is approved - but
   * "dealt with" can mean ignored with a reason, which is what the review
   * screen is for. This refuses only while something is still OPEN.
   */
  const override = String(req.body?.override_reason || '').trim();
  if (stage.blocking.length && !override) {
    return res.status(409).json({
      error: `${stage.blocking.length} critical exception(s) are still open. Settle or ignore them, or approve anyway with a reason.`,
      blocking: stage.blocking,
      can_override: true,
    });
  }

  /*
   * AN OVERRIDE IS A DECISION SOMEBODY SIGNS FOR.
   *
   * It used to be `anyway: true` with nothing else - no reason asked for, no
   * reason recorded, and no button on the screen. So the one way past the
   * block was an undocumented field, and the trail could not say why a month
   * with a negative net was approved. The reason is now required, it names
   * what was open at the time, and it is on the audit trail.
   */
  if (stage.blocking.length && override.length < 5) {
    return res.status(400).json({ error: 'say why the critical exceptions are being approved over' });
  }

  const by = actorOf(req);
  const note = req.body?.note || null;
  setPeriodApproval(period.id, { approved_by: by, note });
  audit({
    who: by,
    action: 'approved',
    entity: 'periods',
    entity_id: period.id,
    label: period.label,
    to_value: 'approved',
    note,
  });
  if (stage.blocking.length) {
    audit({
      who: by,
      action: 'overrode',
      entity: 'periods',
      entity_id: period.id,
      label: period.label,
      field: 'critical exceptions',
      from_value: `${stage.blocking.length} open`,
      to_value: 'approved anyway',
      /* Named, not just counted: "3 critical" six months later does not say
         which three, and the people are the point. */
      note: `${override} — ${stage.blocking
        .map((b) => `${b.name || 'month'}: ${b.label}`)
        .slice(0, 12)
        .join('; ')}`,
    });
  }
  return res.json(getPeriod(period.id));
});

/**
 * WHAT HAS HAPPENED TO THIS MONTH'S APPROVAL, in order.
 *
 * Read off the audit trail rather than kept in a second table: `periods`
 * holds only the CURRENT approval, and a month approved, taken back and
 * approved again has three entries and one row. Two stores would be two
 * answers to "who approved this".
 */
periodsRouter.get('/:id/approvals', (req, res) => {
  const period = getPeriod(Number(req.params.id));
  if (!period) return res.status(404).json({ error: 'not found' });
  const APPROVAL = new Set(['approved', 'overrode', 'locked']);
  const history = listAudit({ entity: 'periods', entity_id: period.id, limit: 200 }).filter(
    (row) =>
      APPROVAL.has(row.action) ||
      (row.action === 'changed' && ['approved', 'locked'].includes(row.field))
  );
  return res.json({ period, history });
});

/** Taking the approval back, which needs a reason like reopening does. */
periodsRouter.delete('/:id/approve', requireApprover, (req, res) => {
  const period = getPeriod(Number(req.params.id));
  if (!period) return res.status(404).json({ error: 'not found' });
  if (period.locked) return res.status(409).json({ error: 'unlock it first' });
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'say why the approval is being taken back' });

  const by = actorOf(req);
  setPeriodApproval(period.id, { approved_by: null, note: null, reopen_reason: reason });
  audit({
    who: by,
    action: 'changed',
    entity: 'periods',
    entity_id: period.id,
    label: period.label,
    field: 'approved',
    from_value: period.approved_by,
    to_value: null,
    note: reason,
  });
  return res.json(getPeriod(period.id));
});

/** Locked: paid and filed. Reopening needs a reason, and keeps it. */
periodsRouter.post('/:id/lock', requireApprover, (req, res) => {
  const period = getPeriod(Number(req.params.id));
  if (!period) return res.status(404).json({ error: 'not found' });
  const by = actorOf(req);

  if (req.body?.open) {
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'say why the month is being reopened' });
    setPeriodLock(period.id, { locked: 0, by, reason });
    audit({
      who: by, action: 'changed', entity: 'periods', entity_id: period.id, label: period.label,
      field: 'locked', from_value: 'locked', to_value: 'open', note: reason,
    });
    return res.json(getPeriod(period.id));
  }

  if (!period.approved_at) {
    return res.status(409).json({ error: 'the month has to be approved before it is locked' });
  }
  setPeriodLock(period.id, { locked: 1, by });
  audit({
    who: by, action: 'locked', entity: 'periods', entity_id: period.id, label: period.label,
    to_value: 'locked',
  });
  return res.json(getPeriod(period.id));
});
