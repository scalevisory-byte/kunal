import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { buildWorkbook } from '../../../shared/workbook.js';
import { importSheet, listSheetNames } from '../importer.js';
import { buildPayroll } from '../payroll.js';
import { readPunchFile, punchesToMarks } from '../../../shared/punches.js';
import { listEmployees, setAttendance } from '../db.js';
import { getPeriod } from '../db.js';

export const reportsRouter = Router();

// Sheets are read in memory and thrown away; nothing is written to disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const slug = (s) => String(s).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

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
    ['OT/LT Minutes', 'ot_minutes'], ['OT/LT Salary', 'ot_salary'], ['Adjustment', 'adjustment'],
    ['Gross Salary', 'gross_salary'], ['PT', 'pt'], ['ESI', 'esi'], ['PF', 'pf'],
    ['Loan', 'loan_deduction'],
    ['Net Salary', 'net_salary'], ['Sunday Salary', 'sunday_salary'], ['Final Payable', 'final_payable'],
    ['Mode', 'payment_mode'], ['Status', 'status'],
  ];
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(([label]) => label).join(',')];
  for (const row of payroll.rows) lines.push(columns.map(([, key]) => escape(row[key])).join(','));

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
