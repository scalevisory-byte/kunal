import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { buildWorkbook } from '../../../shared/workbook.js';
import { importSheet, listSheetNames } from '../importer.js';
import { buildPayroll } from '../payroll.js';
import { readPunchFile, punchesToMarks } from '../../../shared/punches.js';
import {
  DEFAULT_MARK_MAP,
  monthlyStatusToMarks,
  readMonthlyStatus,
  sheetsFromSheetJS,
} from '../../../shared/monthlyStatus.js';
import * as XLSX from 'xlsx';
import { CSV_COLUMNS, statutoryReport, toCsv } from '../../../shared/statutory.js';
import { leaveSummary, listAttendance, listEmployees, listHolidays, setAttendance } from '../db.js';
import { buildMonthlyPack, packLabel } from '../../../shared/monthlyPack.js';
import { getPeriod } from '../db.js';

export const reportsRouter = Router();

// Sheets are read in memory and thrown away; nothing is written to disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const slug = (s) => String(s).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * The three sheets Dinesh circulates every month - bank salary, cash salary,
 * and the Sunday + Festival register - in his own layout rather than the app's.
 */
reportsRouter.get('/periods/:id/pack.xlsx', async (req, res, next) => {
  try {
    const payroll = buildPayroll(Number(req.params.id), {
      company_id: Number(req.query.company_id) || undefined,
    });
    if (!payroll) return res.status(404).json({ error: 'period not found' });

    const wb = await buildMonthlyPack(ExcelJS, payroll, {
      holidays: listHolidays(payroll.period.id),
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Salary-Pack-${slug(packLabel(payroll.period))}.xlsx"`
    );
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

reportsRouter.get('/periods/:id/export.xlsx', async (req, res, next) => {
  try {
    const payroll = buildPayroll(Number(req.params.id), {
      company_id: Number(req.query.company_id) || undefined,
    });
    if (!payroll) return res.status(404).json({ error: 'period not found' });

    const wb = await buildWorkbook(ExcelJS, payroll);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Salary-${slug(payroll.period.label)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

reportsRouter.get('/periods/:id/export.csv', (req, res) => {
  const payroll = buildPayroll(Number(req.params.id));
  if (!payroll) return res.status(404).json({ error: 'period not found' });

  const columns = [
    ['Company', 'company_name'], ['Employee', 'employee_name'], ['Working Days', 'working_days'],
    ['Sunday', 'sundays_worked'], ['Absent Days', 'absent_days'], ['Present Days', 'present_days'],
    ['Salary', 'salary'], ['Salary/Day', 'per_day'], ['Absent Salary', 'absent_salary'],
    ['Basic', 'earned_basic'], ['HRA', 'earned_hra'], ['Conveyance', 'earned_conveyance'],
    ['Medical', 'earned_medical'], ['Special Allowance', 'earned_special'],
    ['Hours Worked', 'worked_hours'], ['OT/LT Minutes', 'ot_minutes'], ['OT/LT Salary', 'ot_salary'],
    ['Addition', 'addition'], ['Deduction', 'deduction'],
    ['Late Mins', 'late_minutes'], ['Early Mins', 'early_minutes'],
    ['Late/Early Charged', 'late_salary'],
    ['Gross Salary', 'gross_salary'], ['PT', 'pt'], ['ESI', 'esi'], ['PF', 'pf'],
    ['Loan', 'loan_deduction'],
    ['Net Payable', 'net_salary'],
    ['Mode', 'payment_mode'], ['Status', 'status'],
  ];
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(([label]) => label).join(',')];
  const withHours = payroll.rows.map((row) => ({
    ...row,
    worked_hours: Math.round(((row.worked_minutes || 0) / 60) * 100) / 100,
  }));
  for (const row of withHours) lines.push(columns.map(([, key]) => escape(row[key])).join(','));

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="Salary-${slug(payroll.period.label)}.csv"`);
  res.send(`﻿${lines.join('\n')}\n`);
});

/** Bank transfer list: only what the bank needs, only rows still to be paid. */
reportsRouter.get('/periods/:id/bank.csv', (req, res) => {
  const payroll = buildPayroll(Number(req.params.id));
  if (!payroll) return res.status(404).json({ error: 'period not found' });
  const rows = payroll.rows.filter((r) => r.final_payable > 0 && r.status !== 'paid');
  const lines = ['Company,Employee,Mode,Amount'];
  for (const row of rows) {
    lines.push([row.company_name, row.employee_name, row.payment_mode || '', row.final_payable].join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="Bank-${slug(payroll.period.label)}.csv"`);
  res.send(`﻿${lines.join('\n')}\n`);
});

/** The Sunday register on its own, for handing the cash out against. */
reportsRouter.get('/periods/:id/sunday.csv', (req, res) => {
  const payroll = buildPayroll(Number(req.params.id));
  if (!payroll) return res.status(404).json({ error: 'period not found' });

  const lines = ['Company,Employee,Dates,Days,Day Rate,Amount,Paid By,Status'];
  for (const row of payroll.rows.filter((r) => r.sundays_worked > 0)) {
    lines.push(
      [
        row.company_name,
        row.employee_name,
        `"${(row.sunday_days || []).join(', ')}"`,
        row.sundays_worked,
        row.per_day,
        row.sunday_salary,
        row.sunday_mode || '',
        row.sunday_status || 'pending',
      ].join(',')
    );
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="Sunday-${slug(payroll.period.label)}.csv"`);
  res.send(`\ufeff${lines.join('\n')}\n`);
});

/* ---------------- statutory registers ---------------- */

const statutoryFor = (id) => {
  const payroll = buildPayroll(Number(id));
  return payroll ? statutoryReport(payroll) : null;
};

reportsRouter.get('/periods/:id/statutory', (req, res) => {
  const report = statutoryFor(req.params.id);
  if (!report) return res.status(404).json({ error: 'period not found' });
  res.json(report);
});

reportsRouter.get('/periods/:id/statutory/:which.csv', (req, res) => {
  const report = statutoryFor(req.params.id);
  if (!report) return res.status(404).json({ error: 'period not found' });

  const { which } = req.params;
  const columns = CSV_COLUMNS[which];
  if (!columns) return res.status(404).json({ error: `no such register: ${which}` });

  const rows = which === 'pt' ? report.pt.rows : which === 'wages' ? report.wages : report[which].rows;
  const name = { pf: 'PF', esi: 'ESI', pt: 'PT', wages: 'Wage-Register' }[which];

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${slug(report.period.label)}.csv"`);
  res.send(toCsv(columns, rows));
});

/* ---------------- punches from the attendance machine ---------------- */

/** Step one: what does this file look like? Nothing is saved. */
reportsRouter.post('/punches/read', upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
  try {
    const read = await readPunchFile(ExcelJS, req.file.buffer, {
      sheetName: req.body.sheet || undefined,
      headerRow: req.body.header_row || undefined,
    });
    if (read.error) return res.status(400).json(read);
    res.json({
      sheet: read.sheet,
      sheets: read.sheets,
      headerRow: read.headerRow,
      headers: read.headers,
      sampleRows: read.rows.slice(0, 8).map((r) => r.values),
      rowCount: read.rows.length,
    });
  } catch (err) {
    next(err);
  }
});

/** Step two: work out the marks, and write them unless this is a dry run. */
reportsRouter.post('/periods/:id/punches', upload.single('file'), async (req, res, next) => {
  const payroll = buildPayroll(Number(req.params.id), { sync: false });
  if (!payroll) return res.status(404).json({ error: 'period not found' });
  if (payroll.period.locked) return res.status(409).json({ error: 'period is locked' });
  if (!req.file) return res.status(400).json({ error: 'no file uploaded' });

  const mapping = JSON.parse(req.body.mapping || '{}');
  const rules = JSON.parse(req.body.rules || '{}');
  if (!mapping.employee || !mapping.date) {
    return res.status(400).json({ error: 'say which column holds the employee and which the date' });
  }

  try {
    const read = await readPunchFile(ExcelJS, req.file.buffer, {
      sheetName: req.body.sheet || undefined,
      headerRow: req.body.header_row || undefined,
    });
    if (read.error) return res.status(400).json(read);

    const result = punchesToMarks({
      rows: read.rows,
      mapping,
      rules,
      employees: listEmployees(),
      period: payroll.period,
    });

    const dryRun = req.body.dry_run === 'true' || req.body.dry_run === true;
    if (!dryRun && result.entries.length) setAttendance(payroll.period.id, result.entries);

    res.json({ ...result, dryRun, written: dryRun ? 0 : result.entries.length });
  } catch (err) {
    next(err);
  }
});

/* ---------------- the machine's Monthly Status report ---------------- */

/**
 * A different shape from punches.js: a month-wide grid, one sheet per company,
 * carrying the machine's own verdict for each day. Read with SheetJS because
 * these devices still export the legacy .xls that ExcelJS cannot open.
 *
 * Two steps, same as the punch import: look first, write second.
 */
reportsRouter.post('/periods/:id/monthly-status', upload.single('file'), async (req, res, next) => {
  const payroll = buildPayroll(Number(req.params.id), { sync: false });
  if (!payroll) return res.status(404).json({ error: 'period not found' });
  if (payroll.period.locked) return res.status(409).json({ error: 'period is locked' });
  if (!req.file) return res.status(400).json({ error: 'no file uploaded' });

  try {
    const sheets = readMonthlyStatus(sheetsFromSheetJS(XLSX, req.file.buffer));
    if (sheets.every((s) => s.error)) {
      return res.status(400).json({
        error: 'no day-by-day grid was found in that file',
        sheetErrors: sheets.map((s) => ({ sheet: s.name, error: s.error })),
      });
    }

    // What the grid already holds, so "only fill the blanks" can mean it.
    const existing = {};
    for (const row of listAttendance(payroll.period.id)) {
      if (row.code) existing[`${row.employee_id}:${row.day}`] = row.code;
    }

    const result = monthlyStatusToMarks({
      sheets,
      employees: listEmployees(),
      period: payroll.period,
      markMap: { ...DEFAULT_MARK_MAP, ...JSON.parse(req.body.mark_map || '{}') },
      includeEmptyDays: req.body.include_empty_days === 'true',
      onlyBlank: req.body.only_blank === 'true',
      existing,
    });

    const dryRun = req.body.dry_run === 'true' || req.body.dry_run === true;
    if (!dryRun && result.entries.length) setAttendance(payroll.period.id, result.entries);

    res.json({
      ...result,
      // The whole entry list is a few thousand rows; the dashboard only needs
      // to know what it adds up to.
      entries: undefined,
      months: sheets.filter((s) => !s.error).map((s) => ({ sheet: s.name, month: s.month, year: s.year })),
      period: { month: payroll.period.month, year: payroll.period.year },
      dryRun,
      written: dryRun ? 0 : result.entries.length,
    });
  } catch (err) {
    next(err);
  }
});

reportsRouter.post('/import/sheets', upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
  try {
    res.json({ sheets: await listSheetNames(req.file.buffer) });
  } catch (err) {
    next(err);
  }
});

reportsRouter.post('/import', upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
  const periodId = Number(req.body.period_id) || undefined;
  if (periodId && !getPeriod(periodId)) return res.status(404).json({ error: 'period not found' });
  try {
    const result = await importSheet(req.file.buffer, {
      sheetName: req.body.sheet || undefined,
      periodId,
      headerRow: Number(req.body.header_row) || 2,
      dryRun: req.body.dry_run === 'true' || req.body.dry_run === true,
    });
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/* ---------------- the three files that were missing ---------------- */

const csvEscape = (v) => {
  const text = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** A BOM, so Excel opens it with the rupee signs and the names intact. */
const sendCsv = (res, name, columns, rows) => {
  const lines = [columns.map(([head]) => csvEscape(head)).join(',')];
  for (const row of rows) lines.push(columns.map(([, get]) => csvEscape(get(row))).join(','));
  res.type('text/csv').attachment(name).send(`\ufeff${lines.join('\n')}`);
};

/**
 * The leave register as a file. It was on screen only, which is no use to
 * anybody who has to send it to an auditor.
 *
 * Taken off `leaveSummary`, which counts the CL/SL/PL marks across the year's
 * months - so this cannot disagree with the Leave tab or with the grid.
 */
reportsRouter.get('/leave.csv', (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const rows = leaveSummary(year);
  sendCsv(res, `leave-${year}.csv`, [
    ['Company', (r) => r.company_name || ''],
    ['Employee', (r) => r.name],
    ['Department', (r) => r.department || ''],
    ['CL allowed', (r) => r.quotas.CL],
    ['CL taken', (r) => r.taken.CL],
    ['CL left', (r) => r.quotas.CL - r.taken.CL],
    ['SL allowed', (r) => r.quotas.SL],
    ['SL taken', (r) => r.taken.SL],
    ['SL left', (r) => r.quotas.SL - r.taken.SL],
    ['PL allowed', (r) => r.quotas.PL],
    ['PL taken', (r) => r.taken.PL],
    ['PL left', (r) => r.quotas.PL - r.taken.PL],
    // Unpaid leave has no quota: it was taken anyway and docked, which is the
    // whole point of the mark.
    ['Unpaid leave taken', (r) => r.taken.UL],
    [
      'Over entitlement',
      (r) =>
        ['CL', 'SL', 'PL']
          .filter((code) => r.taken[code] > r.quotas[code])
          .map((code) => `${code} by ${r.taken[code] - r.quotas[code]}`)
          .join('; '),
    ],
  ], rows);
});

/**
 * The staff list as a file. A per-employee report existed; the list itself
 * could not be exported at all.
 *
 * Salaries are on it, because this is behind the password and HR's whole job
 * involves them. The statutory identifiers are on it because the commonest use
 * of this file is finding out who is missing one.
 */
reportsRouter.get('/employees.csv', (req, res) => {
  const rows = listEmployees({
    company_id: Number(req.query.company_id) || undefined,
    active: req.query.active === undefined ? undefined : req.query.active !== 'false',
  });
  sendCsv(res, 'employees.csv', [
    ['Company', (e) => e.company_name || ''],
    ['Branch', (e) => e.branch_name || ''],
    ['Code', (e) => e.code || ''],
    ['Name', (e) => e.name],
    ['Designation', (e) => e.designation || ''],
    ['Department', (e) => e.department || ''],
    ['Joined', (e) => e.joined_on || ''],
    ['Left', (e) => e.left_on || ''],
    ['Status', (e) => (e.active ? 'Working' : 'Left')],
    ['Born', (e) => e.dob || ''],
    ['Sex', (e) => e.gender || ''],
    ['Married', (e) => e.marital_status || ''],
    ["Father's name", (e) => e.father_name || ''],
    ["Mother's name", (e) => e.mother_name || ''],
    ["Spouse's name", (e) => e.spouse_name || ''],
    ['Blood group', (e) => e.blood_group || ''],
    ['Phone', (e) => e.phone || ''],
    ['Second phone', (e) => e.phone_alt || ''],
    ['Email', (e) => e.email || ''],
    ['Emergency contact', (e) => e.emergency_name || ''],
    ['Emergency number', (e) => e.emergency_phone || ''],
    ['Emergency relation', (e) => e.emergency_relation || ''],
    ['Monthly salary', (e) => Math.round(Number(e.monthly_salary) || 0)],
    ['Basic', (e) => Math.round(Number(e.basic) || 0) || ''],
    ['HRA', (e) => Math.round(Number(e.hra) || 0) || ''],
    ['PF deducted', (e) => Math.round(Number(e.pf) || 0)],
    ['PF mode', (e) => e.pf_mode || ''],
    ['ESI deducted', (e) => Math.round(Number(e.esi) || 0)],
    ['ESI mode', (e) => e.esi_mode || ''],
    ['PAN', (e) => e.pan || ''],
    ['Aadhaar', (e) => e.aadhaar || ''],
    ['UAN', (e) => e.uan || ''],
    ['ESIC number', (e) => e.esic_no || ''],
    ['Bank', (e) => e.bank_name || ''],
    ['Account', (e) => e.bank_account || ''],
    ['IFSC', (e) => e.ifsc || ''],
    ['Payment mode', (e) => e.payment_mode || ''],
    ['CL', (e) => e.cl_quota || 0],
    ['SL', (e) => e.sl_quota || 0],
    ['PL', (e) => e.pl_quota || 0],
    ['Shift', (e) => (e.shift_in ? `${e.shift_in}-${e.shift_out || ''}` : '')],
    // Blank means "the company's day off", which is almost everybody.
    ['Own weekly off', (e) => e.weekly_off || ''],
    ['Religion', (e) => e.religion || ''],
  ], rows);
});
