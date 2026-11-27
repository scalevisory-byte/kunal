import { Router } from 'express';
import {
  addDocument,
  createEmployee,
  deleteDocument,
  deleteEmployee,
  getDocument,
  employeeDeleteProblem,
  employeeDeleteSummary,
  getEmployee,
  listDirectReports,
  listDocuments,
  listEmployeeHistory,
  listEmployees,
  listPeriods,
  newestPhoto,
  recordHistory,
  updateEmployee,
  audit,
  verifyDocument,
} from '../db.js';
import fs from 'node:fs';
import { deleteDocumentFile, documentFile, documentLink, uploadDocument } from '../documents.js';
import { documentStatus } from '../../../shared/documents.js';
import { punchLink } from './punch.js';
import { config } from '../config.js';
import { decideProfileChanges, listProfileChanges, profileChangesWaiting } from '../profileChanges.js';
import { buildPayroll } from '../payroll.js';
import { employeeReport } from '../../../shared/employeeReport.js';
import ExcelJS from 'exceljs';
import multer from 'multer';
import {
  planEmployeeImport,
  readEmployeeSheet,
  writeEmployeeSheet,
} from '../../../shared/employeeSheet.js';
import { listCompanies, upsertCompany } from '../db.js';
import { nextEmployeeCode } from '../../../shared/employeeCode.js';
import { duplicatesOf } from '../../../shared/employeeMaster.js';

export const employeesRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

/* ---------------- the staff master as a spreadsheet ---------------- */

/**
 * The template AND the export, deliberately one file.
 *
 * `?blank=true` leaves the rows out. Everything else hands back the staff as
 * they stand, which is the form worth editing: an office updating eighty-five
 * UANs wants the eighty-five names already down the page.
 */
employeesRouter.get('/sheet', async (req, res, next) => {
  try {
    const blank = req.query.blank === 'true';
    const wb = await writeEmployeeSheet(ExcelJS, {
      employees: blank ? [] : listEmployees(),
      companies: listCompanies(),
    });
    const name = blank ? 'Employees-template.xlsx' : 'Employees.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  } catch (err) {
    next(err);
  }
});

/**
 * The same file coming back. Nothing is written on a dry run, and the plan
 * names every field that would change, by person.
 */
employeesRouter.post('/sheet', upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);

    // The sheet with a Name column in it, whatever it is called - somebody
    // will rename the tab, and the second sheet here is the notes.
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
      const attempt = readEmployeeSheet(rows);
      if (!attempt.error) { read = { ...attempt, sheet: ws.name }; break; }
    }
    if (!read) {
      return res.status(400).json({
        error: 'no sheet in that file has a Name column. Download the template and fill that in.',
      });
    }

    const plan = planEmployeeImport({
      people: read.people,
      employees: listEmployees(),
      companies: listCompanies(),
    });

    const dryRun = req.body.dry_run === 'true' || req.body.dry_run === true;
    let created = 0;
    let updated = 0;
    if (!dryRun) {
      const companyId = new Map(listCompanies().map((c) => [c.name.toLowerCase().trim(), c.id]));
      const idFor = (name) => {
        const key = String(name).toLowerCase().trim();
        if (!companyId.has(key)) companyId.set(key, upsertCompany(name).id);
        return companyId.get(key);
      };
      for (const person of plan.create) {
        const { row, company, ...fields } = person;
        createEmployee({ ...fields, company_id: idFor(company) });
        created += 1;
      }
      for (const change of plan.update) {
        const patch = {};
        for (const c of change.changes) patch[c.field] = c.to;
        updateEmployee(change.id, patch);
        updated += 1;
      }
    }

    res.json({
      ...plan,
      sheet: read.sheet,
      unknownColumns: read.unknown,
      dryRun,
      created,
      updated,
    });
  } catch (err) {
    next(err);
  }
});

employeesRouter.get('/', (req, res) => {
  const active = req.query.active === undefined ? undefined : req.query.active !== 'false';
  res.json({
    employees: listEmployees({
      company_id: Number(req.query.company_id) || undefined,
      branch_id: Number(req.query.branch_id) || undefined,
      active,
    }),
  });
});

/**
 * THE NEXT CODE IN A COMPANY'S SERIES.
 *
 * Dinesh: *"Generate unique Employee Code automatically."* Read, not
 * reserved: the number is only taken when somebody is actually saved, so
 * two people opening the form do not burn two codes between them and leave
 * a hole. If they both save, the second one is refused as a clash and asks
 * again - which is the right way round, because a gap in the series is a
 * question nobody can answer afterwards.
 */
/*
 * What staff typed about themselves, waiting for HR. Declared before /:id so
 * the words are not read as an id. Changing anything here needs `write`, which
 * is HR, Manager and Admin - the mount in server.js refuses the rest.
 */
employeesRouter.get('/profile-changes', (req, res) =>
  res.json({ people: listProfileChanges({ company_id: req.query.company_id }), waiting: profileChangesWaiting() })
);

employeesRouter.post('/profile-changes/decide', (req, res) => {
  try {
    res.json(
      decideProfileChanges(req.body?.ids, {
        approve: Boolean(req.body?.approve),
        note: req.body?.note,
        by: req.actor?.name || 'office',
      })
    );
  } catch (err) {
    res.status(/not found/.test(err.message) ? 404 : 400).json({ error: err.message });
  }
});

employeesRouter.get('/next-code', (req, res) => {
  const companyId = Number(req.query.company_id);
  const company = listCompanies().find((c) => c.id === companyId);
  if (!company) return res.status(400).json({ error: 'which company?' });
  /* The SAME generator hiring already uses when a candidate is turned into
     an employee, so a person taken on through the pipeline and a person
     typed in by hand draw from one series and cannot collide. */
  const codes = listEmployees({}).map((e) => e.code).filter(Boolean);
  res.json({ code: nextEmployeeCode(company.name, codes) });
});

/**
 * IS THIS PERSON ALREADY ON THE LIST?
 *
 * Asked as the form is filled in, before anything is saved. It WARNS rather
 * than refuses: two brothers at one company really do share a surname, and a
 * system that will not have them gets the second one typed as "Amit Shah 2".
 * The one exception is an exact employee code, which is a clash and not a
 * resemblance - the create below refuses that outright.
 */
employeesRouter.post('/check-duplicate', (req, res) => {
  const found = duplicatesOf(req.body || {}, listEmployees({}), {
    exceptId: req.body?.id ?? null,
  });
  res.json({ duplicates: found });
});

employeesRouter.post('/', (req, res) => {
  try {
    const body = req.body || {};

    /*
     * NOTHING EXTRA IS REFUSED HERE.
     *
     * `createEmployee` wants a name and a company and nothing else, and this
     * route must want exactly the same - the staff spreadsheet import, the
     * hiring handover and the bulk add all reach the same table by other
     * doors, and a rule enforced on one of them is a surprise rather than a
     * rule. The form stars the joining date and the salary, `completeness`
     * counts them and the joining checklist chases them.
     *
     * A draft is held to the same low bar on purpose: the point of it is a
     * form started mid-shift and finished on Monday. `syncPayrollRows` keeps
     * a draft off every payroll month until it is saved properly.
     */
    /* A code clash IS refused - unlike a resemblance. Two people with one
       code means the punch import, the bank file and the muster roll each
       pick whichever they find first. */
    const clash = duplicatesOf(body, listEmployees({})).find((d) => d.blocking);
    if (clash) {
      return res.status(409).json({
        error: `${clash.code} is already ${clash.name}'s code`,
        duplicate: clash,
      });
    }

    res.status(201).json(createEmployee(body));
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

/*
 * The photograph, served as a picture.
 *
 * Deliberately NOT a signed expiring link like the other documents. Those are
 * for handing a file to somebody; this one is drawn by an <img> on a page that
 * may sit open all afternoon, and a link that expires in a few minutes turns
 * eighty faces into eighty broken images. It is behind the session instead -
 * this router already requires `read`, which is a narrower door than a
 * signature anybody could forward.
 *
 * Only a photograph is served this way. Nothing here can reach an Aadhaar
 * card: the kind is pinned in the query.
 */
employeesRouter.get('/:id/photo', (req, res) => {
  const doc = newestPhoto(Number(req.params.id));
  const file = doc && documentFile(doc);
  if (!file) return res.status(404).json({ error: 'no photograph on file' });
  // A face does not change under the same document id, and a replacement is a
  // new row with a new id, so this can be cached hard.
  res.setHeader('cache-control', 'private, max-age=86400');
  res.sendFile(file);
});

/**
 * The employee's own punch link, to send them.
 *
 * Asking for it mints a fresh one, which is also how a link is revoked after a
 * phone is lost: issue a new one and the old is no better than a guess... which
 * it is not, so say so rather than implying otherwise. A token stays valid
 * until it expires; a genuinely lost phone means changing LINK_SECRET.
 */
employeesRouter.get('/:id/punch-link', (req, res) => {
  const employee = getEmployee(Number(req.params.id));
  if (!employee) return res.status(404).json({ error: 'not found' });
  if (!employee.active) return res.status(400).json({ error: 'they have left' });

  const path = punchLink(employee);
  const base = config.publicUrl || '';
  res.json({
    employee_id: employee.id,
    name: employee.name,
    path,
    url: base ? `${base}${path}` : null,
    enabled: config.punchEnabled,
    // Said plainly rather than implied: this link IS the identity.
    warning: 'Anybody holding this link can punch as this person. Send it to them only.',
  });
});

/** A note on the record - "promoted", "moved to Surat" - with no field change. */
/**
 * SOMEBODY LOOKED AT A PAN, AN AADHAAR OR A BANK ACCOUNT.
 *
 * The record masks all three on screen - `••••••234F` - and reveals one only
 * when somebody presses "show". This writes that down.
 *
 * Honest about what it is: the figure already travelled to the browser,
 * because the PF return, the ESI return and the staff export all need it and
 * the Employees area is exactly the permission that covers them. This is not
 * encryption and nothing here pretends it is. What the mask does is keep an
 * Aadhaar off a shared screen, out of a screenshot and away from a shoulder,
 * and what this route adds is a name against the moment somebody chose to
 * see one.
 */
employeesRouter.post('/:id/viewed', (req, res) => {
  const employee = getEmployee(Number(req.params.id));
  if (!employee) return res.status(404).json({ error: 'not found' });
  const field = String(req.body?.field || '').trim();
  if (!['pan', 'aadhaar', 'bank_account'].includes(field)) {
    return res.status(400).json({ error: 'not a masked field' });
  }
  audit({
    who: req.actor?.name || 'office',
    action: 'viewed',
    entity: 'employees',
    entity_id: employee.id,
    label: employee.name,
    field,
    note: 'revealed on the employee record',
  });
  res.json({ ok: true });
});

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

/**
 * CHECKED, OR SENT BACK.
 *
 * Three states: verified, rejected (which must say why), and handing the
 * decision back to nobody-has-looked. Null is NOT a refusal - a register
 * that read every unchecked PAN card as rejected would be a page of red on
 * the day it shipped.
 */
employeesRouter.post('/:id/documents/:documentId/verify', (req, res) => {
  try {
    const doc = verifyDocument(Number(req.params.documentId), {
      verified: req.body?.verified === null || req.body?.verified === undefined
        ? null
        : Boolean(req.body.verified),
      note: req.body?.note,
      by: req.actor?.name || 'office',
    });
    if (!doc) return res.status(404).json({ error: 'not found' });
    const { file_path, ...rest } = doc;
    res.json(rest);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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

/* What would go with them - so the screen can say it before it asks. */
employeesRouter.get('/:id/delete-check', (req, res) => {
  const summary = employeeDeleteSummary(Number(req.params.id));
  if (!summary) return res.status(404).json({ error: 'not found' });
  res.json({ ...summary, problem: employeeDeleteProblem(summary.id) });
});

employeesRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const employee = getEmployee(id);
  if (!employee) return res.status(404).json({ error: 'not found' });

  const problem = employeeDeleteProblem(id);
  if (problem) return res.status(409).json({ error: problem });

  /*
   * THE FILES GO WITH THE ROWS.
   *
   * The document rows cascade away; the files do not, because they are not in
   * the database. Left behind, the folder fills with PAN cards, Aadhaar cards
   * and photographs of people the app no longer knows - nothing points at
   * them and nobody can account for them. The same hole the candidate delete
   * had.
   */
  for (const doc of listDocuments(id)) deleteDocumentFile(doc);
  deleteEmployee(id);
  res.status(204).end();
});
