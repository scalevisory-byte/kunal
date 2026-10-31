import { Router } from 'express';
import {
  addDocument,
  createEmployee,
  deleteDocument,
  deleteEmployee,
  getDocument,
  getEmployee,
  listDirectReports,
  listDocuments,
  listEmployeeHistory,
  listEmployees,
  listPeriods,
  recordHistory,
  updateEmployee,
} from '../db.js';
import fs from 'node:fs';
import { deleteDocumentFile, documentLink, uploadDocument } from '../documents.js';
import { documentStatus } from '../../../shared/documents.js';
import { buildPayroll } from '../payroll.js';
import { employeeReport } from '../../../shared/employeeReport.js';

export const employeesRouter = Router();

employeesRouter.get('/', (req, res) => {
  const active = req.query.active === undefined ? undefined : req.query.active !== 'false';
  res.json({ employees: listEmployees({ company_id: Number(req.query.company_id) || undefined, active }) });
});

employeesRouter.post('/', (req, res) => {
  try {
    res.status(201).json(createEmployee(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

employeesRouter.get('/:id', (req, res) => {
  const employee = getEmployee(Number(req.params.id));
  if (!employee) return res.status(404).json({ error: 'not found' });
  res.json(employee);
});

/**
 * One person down the months: attendance, leave and pay, side by side.
 *
 * Every month is read with `sync: false`. Reading a month normally syncs the
 * payroll rows and posts loan instalments, so building a year's report would
 * have backdated today's new hires into closed months and taken instalments
 * out of months already paid. Only the month actually being worked on should
 * ever be synced, and that is the salary sheet's job, not a report's.
 */
employeesRouter.get('/:id/report', (req, res) => {
  const employee = getEmployee(Number(req.params.id));
  if (!employee) return res.status(404).json({ error: 'not found' });

  const year = Number(req.query.year) || undefined;
  const periods = listPeriods()
    .filter((period) => !year || period.year === year)
    .sort((a, b) => a.year - b.year || a.month - b.month);

  const months = periods
    .map((period) => {
      const payroll = buildPayroll(period.id, { sync: false });
      const row = payroll?.rows.find((r) => r.employee_id === employee.id);
      return row ? { period: payroll.period, row } : null;
    })
    .filter(Boolean);

  res.json({
    ...employeeReport({ employee, months }),
    // Which years this person actually has months in, so the picker only
    // offers years there is something to show.
    years: [...new Set(listPeriods().map((p) => p.year))].sort((a, b) => b - a),
    year: year || null,
  });
});

employeesRouter.patch('/:id', (req, res) => {
  try {
    const employee = updateEmployee(Number(req.params.id), req.body || {});
    if (!employee) return res.status(404).json({ error: 'not found' });
    res.json(employee);
  } catch (err) {
    // A reporting loop is the one thing a patch can be refused for.
    res.status(400).json({ error: err.message });
  }
});

/* ---------------- the record behind the record ---------------- */

/** Everything the profile drawer needs beyond the employee row itself. */
employeesRouter.get('/:id/record', (req, res) => {
  const employee = getEmployee(Number(req.params.id));
  if (!employee) return res.status(404).json({ error: 'not found' });
  const documents = listDocuments(employee.id);
  res.json({
    employee,
    documents: documents.map((doc) => ({ ...doc, file_path: undefined, link: documentLink(doc) })),
    document_status: documentStatus(documents),
    history: listEmployeeHistory(employee.id),
    reports: listDirectReports(employee.id),
  });
});

/** A note on the record - "promoted", "moved to Surat" - with no field change. */
employeesRouter.post('/:id/history', (req, res) => {
  const employee = getEmployee(Number(req.params.id));
  if (!employee) return res.status(404).json({ error: 'not found' });
  const note = String(req.body?.note || '').trim();
  if (!note) return res.status(400).json({ error: 'a note needs something in it' });
  recordHistory(employee.id, 'note', null, null, note);
  res.status(201).json({ history: listEmployeeHistory(employee.id) });
});

employeesRouter.post('/:id/documents', uploadDocument, (req, res) => {
  const employee = getEmployee(Number(req.params.id));
  if (!employee) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'not found' });
  }
  if (!req.file) return res.status(400).json({ error: 'no file was uploaded' });

  const doc = addDocument(employee.id, {
    kind: req.body?.kind,
    file_path: req.file.filename,
    file_name: req.file.originalname,
    number: req.body?.number,
    issued_on: req.body?.issued_on,
    expires_on: req.body?.expires_on,
    notes: req.body?.notes,
  });
  res.status(201).json({ document: { ...doc, file_path: undefined, link: documentLink(doc) } });
});

employeesRouter.delete('/:id/documents/:documentId', (req, res) => {
  const doc = getDocument(Number(req.params.documentId));
  if (!doc || doc.employee_id !== Number(req.params.id)) {
    return res.status(404).json({ error: 'not found' });
  }
  deleteDocumentFile(doc);
  deleteDocument(doc.id);
  res.status(204).end();
});

employeesRouter.delete('/:id', (req, res) => {
  if (!deleteEmployee(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});
