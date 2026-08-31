import { Router } from 'express';
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
  listPeriods,
  listHolidays,
  listReligions,
  setAttendance,
  syncPayrollRows,
  updatePayrollRow,
  updatePeriod,
} from '../db.js';
import { buildPayroll, buildPayslip } from '../payroll.js';
import { ATTENDANCE_CODES } from '../../../shared/calc.js';

export const periodsRouter = Router();

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

periodsRouter.patch('/:id', (req, res) => {
  const period = updatePeriod(Number(req.params.id), req.body || {});
  if (!period) return res.status(404).json({ error: 'not found' });
  res.json(period);
});

periodsRouter.delete('/:id', (req, res) => {
  if (!deletePeriod(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

/** The calculated sheet: every column the April tab has, per employee. */
periodsRouter.get('/:id/payroll', (req, res) => {
  const payroll = buildPayroll(Number(req.params.id), {
    company_id: Number(req.query.company_id) || undefined,
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

periodsRouter.patch('/:id/rows/:rowId', (req, res) => {
  const period = getPeriod(Number(req.params.id));
  if (!period) return res.status(404).json({ error: 'period not found' });
  if (period.locked) return res.status(409).json({ error: 'period is locked' });
  const row = updatePayrollRow(Number(req.params.rowId), req.body || {});
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
  res.json({ saved: setAttendance(period.id, entries) });
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
