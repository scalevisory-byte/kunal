import { Router } from 'express';
import multer from 'multer';
import { buildWorkbook } from '../excel.js';
import { importSheet, listSheetNames } from '../importer.js';
import { buildPayroll } from '../payroll.js';
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

    const wb = await buildWorkbook(payroll);
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
