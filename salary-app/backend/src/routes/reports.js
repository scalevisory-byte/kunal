import { Router } from 'express';
import { KYC_KINDS, documentRegister, kindLabel } from '../../../shared/documents.js';
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
  isLegacyXls,
  sheetsFromSheetJS,
} from '../../../shared/monthlyStatus.js';
import { asEsslPull, esslSheets, esslSummary } from '../../../shared/esslDb.js';
import {
  PUNCH_MAPPING,
  coverage,
  punchRows,
  readLogFiles,
} from '../../../shared/bizcompassLogs.js';
import { lastAutoRun, autoMinutes, readSpool, runImport, spoolDir, spoolStatus } from '../bizcompass.js';
import { attendanceFeedHealth } from '../feedStatus.js';
import {
  checkDevice,
  createDevice,
  deleteDevice,
  importStored,
  lastDevicePull,
  listDevices,
  pullAll,
  pullDevice,
  pullMinutes,
  storeSummary,
  punchEventsForMonth,
  punchesByDay,
  unknownIds,
  updateDevice,
} from '../devices.js';
import { matchPunchIds } from '../../../shared/punchIdMatch.js';
import { PUNCH_TOTAL_COLUMNS, punchTotals } from '../../../shared/punchTotals.js';
import { PUNCH_LOG_COLUMNS, PUNCH_LOG_LIMIT, punchLog } from '../../../shared/punchLog.js';
import * as XLSX from 'xlsx';
import { CSV_COLUMNS, statutoryReport, toCsv } from '../../../shared/statutory.js';
import { leaveSummary, listAttendance, listDocuments, listEmployees, listHolidays, listPeriods, setAttendance, updateEmployee } from '../db.js';
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
/**
 * THE DOCUMENT REGISTER an audit asks for: every person, every KYC document,
 * on one page.
 *
 * Built from the same `documentStatus` each employee's record shows, so a
 * row here and the record behind it cannot disagree. It carries no file and
 * no path - only what is on file, what is missing, what has expired and
 * what nobody has checked yet.
 */
/** The same register as a file, for the audit that asked for it. */
reportsRouter.get('/documents/register.csv', (req, res) => {
  const employees = listEmployees({
    active: req.query.include_left === 'true' ? undefined : true,
    company_id: Number(req.query.company_id) || undefined,
  });
  const byEmployee = new Map();
  for (const employee of employees) byEmployee.set(employee.id, listDocuments(employee.id));
  const { rows } = documentRegister(employees, (id) => byEmployee.get(id) || []);

  const columns = [
    ['Code', (r) => r.code],
    ['Name', (r) => r.name],
    ['Company', (r) => r.company_name],
    ['Department', (r) => r.department],
    ...KYC_KINDS.map((kind) => [kindLabel(kind), (r) => r.kinds[kind].label]),
    ['On file', (r) => r.count],
    ['Not checked', (r) => r.unchecked],
    ['Rejected', (r) => r.rejected],
    ['Expired', (r) => r.expired],
    ['Still missing', (r) => r.missing.join('; ')],
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="Employee-documents.csv"');
  res.send(toCsv(columns, rows));
});

reportsRouter.get('/documents/register', (req, res) => {
  const employees = listEmployees({
    active: req.query.include_left === 'true' ? undefined : true,
    company_id: Number(req.query.company_id) || undefined,
  });
  const byEmployee = new Map();
  for (const employee of employees) byEmployee.set(employee.id, listDocuments(employee.id));
  res.json(documentRegister(employees, (id) => byEmployee.get(id) || []));
});

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

/**
 * The old .xls these machines and some offices still produce.
 *
 * ExcelJS cannot open one, and it fails with something about a zip file -
 * which reads as "my file is broken" rather than "this importer wants the
 * other format". The pickers deliberately no longer HIDE a .xls either:
 * Dinesh picked a perfectly good report, the file dialog showed him an empty
 * folder, and the honest conclusion was "it cannot show Excel". A filter that
 * hides the file is worse than a sentence that explains it.
 */
const SAVE_AS = 'Open it in Excel and use File - Save As - Excel Workbook (.xlsx).';
const legacyXls = (buffer, hint) =>
  isLegacyXls(buffer)
    ? { error: 'That is the old .xls format, which this importer cannot open. ' + hint }
    : null;

/* ---------------- punches from the attendance machine ---------------- */

/** Step one: what does this file look like? Nothing is saved. */
reportsRouter.post('/punches/read', upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
  const old = legacyXls(
    req.file.buffer,
    'If it is the attendance machine\'s month-wide report, use "Monthly status from the attendance machine" above - that one reads .xls. ' +
      'If it really is a punch log, ' +
      SAVE_AS.charAt(0).toLowerCase() + SAVE_AS.slice(1),
  );
  if (old) return res.status(400).json(old);
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
      // The same rule a day typed on the Time tab follows: lunch comes off
      // the hours unless the month pays for it. Two answers about one day is
      // how the Time tab and the sheet come to disagree.
      deductLunch: !payroll.period.lunch_paid,
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
    /*
     * Two ways in, one door.
     *
     * The .xls is what somebody exports by hand from eTimeTrackLite. The JSON
     * is what ESSL-PULL.ps1 writes straight off its Access database, so the
     * fortnightly export stops being a job. They are different files and the
     * same material, so they become sheets and then share every rule below -
     * the dry run, the no-data days, the mark map, the matching. A second
     * path here would be a second set of answers about whose day was which.
     */
    const pull = asEsslPull(req.file.buffer);
    const sheets = pull
      ? esslSheets(pull)
      : readMonthlyStatus(sheetsFromSheetJS(XLSX, req.file.buffer));
    if (pull && !sheets.length) {
      return res.status(400).json({ error: 'that pull holds no attendance rows' });
    }
    if (!pull && sheets.every((s) => s.error)) {
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
      pull: pull ? esslSummary(pull) : null,
      period: { month: payroll.period.month, year: payroll.period.year },
      dryRun,
      written: dryRun ? 0 : result.entries.length,
    });
  } catch (err) {
    next(err);
  }
});

/* ---------------- giving everybody their reader number ---------------- */

/**
 * The spool carries no names, so until every person has the number their
 * reader knows them by, nobody's punches reach anybody. The machine's own
 * Basic Work Duration report carries BOTH - its "Emp. Code" is that number,
 * with the name beside it - so the mapping already exists on paper.
 *
 * It is read with the SAME reader the attendance import uses, so there is no
 * second idea of what that file is.
 *
 * THIS ONLY PROPOSES. The two lists are typed by different people and do not
 * agree ("AJEET UPADHYAY" against "AJEETKUMAR UPDHYAY"), and a wrong number
 * puts one person's attendance on another person's payslip.
 */
reportsRouter.post('/employees/punch-ids/match', upload.single('file'), (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
  try {
    const sheets = readMonthlyStatus(sheetsFromSheetJS(XLSX, req.file.buffer));
    const people = [];
    for (const sheet of sheets) {
      if (sheet.error) continue;
      for (const person of sheet.people || []) {
        if (person.code && person.name) {
          people.push({ code: person.code, name: person.name, company: sheet.company || '' });
        }
      }
    }
    if (!people.length) {
      return res.status(400).json({
        error: 'no employee codes and names were found in that file',
        sheetErrors: sheets.map((s) => ({ sheet: s.name, error: s.error })).filter((s) => s.error),
      });
    }
    res.json(matchPunchIds({ people, employees: listEmployees() }));
  } catch (err) {
    next(err);
  }
});

/**
 * Applying exactly what was ticked, and nothing it was not told.
 *
 * Each pair is checked again on the way in: the number must not already be on
 * somebody else, because the screen may have been open while the list moved.
 */
reportsRouter.post('/employees/punch-ids', (req, res, next) => {
  const pairs = Array.isArray(req.body?.pairs) ? req.body.pairs : [];
  if (!pairs.length) return res.status(400).json({ error: 'nothing was ticked' });
  try {
    const employees = listEmployees();
    const byId = new Map(employees.map((e) => [e.id, e]));
    const held = new Map();
    for (const e of employees) {
      if (e.device_code) held.set(String(e.device_code).trim(), e);
    }

    const done = [];
    const refused = [];
    for (const pair of pairs) {
      const id = Number(pair.employee_id);
      const code = String(pair.device_code ?? pair.code ?? '').trim();
      const employee = byId.get(id);
      if (!employee || !code) {
        refused.push({ employee_id: id, code, why: 'not a person and a number' });
        continue;
      }
      const owner = held.get(code);
      if (owner && owner.id !== id) {
        refused.push({ employee_id: id, code, why: `${code} is already on ${owner.name}` });
        continue;
      }
      updateEmployee(id, { device_code: code });
      held.set(code, employee);
      done.push({ employee_id: id, name: employee.name, device_code: code });
    }
    res.json({ done, refused, written: done.length });
  } catch (err) {
    next(err);
  }
});

/* ---------------- the Bizcompass punch spool ---------------- */

/**
 * The other connector in this office, and the better one.
 *
 * Bizcompass's Sync Tool pulls the punches off the readers every ten minutes
 * and spools them as small tab-separated files on THIS machine before
 * uploading them to its own cloud. Reading those files needs no Access, no
 * 32-bit driver and no lock on anybody's database, and it is current to the
 * last ten minutes.
 *
 * Two steps as always: look, then write. And the look matters more here than
 * usual, because the file carries a reader's user number and no name at all -
 * a number nobody carries has to be named, never guessed at.
 */
/*
 * Every employee's total punches, to look at. Dinesh: *"sare employee ka
 * total punches dekhne ho alag se ek uska report bhi banana / o sirf dekhne
 * k liye hoga"*.
 *
 * IT WRITES NOTHING. It is a count of the raw events the readers recorded,
 * not a second opinion about attendance - what a punch BECOMES is worked out
 * by punchesToMarks and lives on the grid, which is what the sheet is paid
 * from. The two cannot disagree because they are not asked the same thing.
 *
 * Both feeds are counted and NAMED separately, because "the spool is running
 * and our own reader is not" is the answer somebody needs, and one combined
 * figure hides it.
 */
/*
 * EVERY punch of a month, from BOTH feeds, gathered once.
 *
 * The totals report and the punch log must never disagree about what punches
 * exist - they are the same events counted and listed. So the gathering is
 * one function rather than copied into each route, which is how two answers
 * to one question come to exist.
 */
function monthOf(text) {
  const now = new Date();
  const m = String(text || '').trim().match(/^(\d{4})-(\d{2})$/);
  return { year: m ? Number(m[1]) : now.getFullYear(), month: m ? Number(m[2]) : now.getMonth() + 1 };
}

function gatherPunches({ year, month }) {
  const punches = punchEventsForMonth({ month, year });

  /* The spool is files on disk, not rows, so it is read here rather than
     queried. A folder that is not configured is not an error - it is an
     office that uses the other feed. */
  let spool = { read: 0, files: 0, error: '', already: 0 };
  const dir = spoolDir();
  if (dir) {
    try {
      /*
       * `month` is a NUMBER here. Passing { year, month } made
       * fileCouldMatter compare a number to an object, so it answered false
       * for every file and the spool was never read at all - on a server with
       * sixteen thousand files in the folder, the report said none were
       * found. It had been doing that since the totals report shipped.
       */
      const { files } = readSpool(dir, { month });
      const got = readLogFiles(files);
      spool = { read: got.punches.length, files: files.length, error: '', already: 0 };
      /*
       * A PUNCH ALREADY IN OUR STORE MUST NOT BE COUNTED AGAIN.
       *
       * Since the app began filing the spool's punches, an imported month
       * holds them as rows AND still has the files they came from sitting in
       * the folder. Reading both would list every punch twice, under two
       * different names for the same door opening. The key is the one the
       * store's own unique index uses - the number, the second, and the
       * reader's guid - so it de-duplicates exactly what was filed and
       * nothing more.
       */
      const held = new Set(punches.map((p) => `${p.code}|${p.at}|${p.raw_source || ''}`));
      for (const punch of got.punches) {
        // 'dd-mm-yyyy HH:MM:SS' -> the sortable stamp these reports read.
        const d = String(punch.when || '').match(/^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}:\d{2}:\d{2})/);
        if (!d) continue;
        const at = `${d[3]}-${d[2]}-${d[1]} ${d[4]}`;
        if (held.has(`${punch.user}|${at}|bizcompass:${punch.device || ''}`)) {
          spool.already += 1;
          continue;
        }
        punches.push({ code: punch.user, at, source: 'Bizcompass spool' });
      }
    } catch (err) {
      spool = { read: 0, files: 0, error: err.message, already: 0 };
    }
  }

  punches.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return { punches, spool };
}

reportsRouter.get('/punch-totals', (req, res, next) => {
  try {
    const { year, month } = monthOf(req.query.month);
    const { punches, spool } = gatherPunches({ year, month });
    res.json({
      month: `${year}-${String(month).padStart(2, '0')}`,
      spool,
      ...punchTotals(punches, listEmployees()),
    });
  } catch (err) {
    next(err);
  }
});

/*
 * THE PUNCH LOG - every punch, one line each. Dinesh: *"sare logs kaha dikhte
 * he?"*, and the honest answer was that this one did not exist: the counts
 * were on Punch totals, a day's punches showed under an out time on a
 * statement, and the record itself could not be opened anywhere.
 *
 * It READS. It is the raw record and NOT attendance - what a punch becomes is
 * worked out by punchesToMarks and lives on the grid, which is what the sheet
 * is paid from.
 */
reportsRouter.get('/punch-log', (req, res, next) => {
  try {
    const { year, month } = monthOf(req.query.month);
    const { punches, spool } = gatherPunches({ year, month });
    const day = Number(req.query.day) || 0;
    const employeeId = Number(req.query.employee_id) || 0;
    res.json({
      month: `${year}-${String(month).padStart(2, '0')}`,
      spool,
      columns: PUNCH_LOG_COLUMNS,
      limit: PUNCH_LOG_LIMIT,
      ...punchLog(punches, listEmployees(), { day, employeeId }),
    });
  } catch (err) {
    next(err);
  }
});

/*
 * One person's punches for a month, day by day — the WHOLE day, not just the
 * first and the last.
 *
 * Dinesh: *"EMPLOYEE LOGIN ME UNKA PURE DIN KA INOUT DIKHA HE?"*, then
 * *"DONO KO DIKHE"*. The readers are door locks, so a day carries six or
 * eight openings and the app showed two of them. Everything in between is the
 * answer to "I left at 6:30, that 5:45 one was tea".
 *
 * It reads. It changes nothing, and it is NOT a second opinion about the
 * hours: in and out are still the earliest and the latest, which is what the
 * sheet is paid from.
 */
reportsRouter.get('/employees/:id/punches', (req, res, next) => {
  try {
    const employee = listEmployees({ all: true }).find((e) => e.id === Number(req.params.id));
    if (!employee) return res.status(404).json({ error: 'not found' });
    const period = listPeriods().find((p) => p.id === Number(req.query.period_id));
    if (!period) return res.status(404).json({ error: 'month not found' });
    res.json(punchesByDay(employee, { year: period.year, month: period.month }));
  } catch (err) {
    next(err);
  }
});

reportsRouter.get('/bizcompass/status', (req, res) => {
  res.json({ ...spoolStatus(), autoMinutes: autoMinutes(), lastRun: lastAutoRun() });
});

/* `upload.none()` because the screen sends a form and nothing else parses one
   here: without it `dry_run` never arrives and a look would write. */
reportsRouter.post('/periods/:id/bizcompass', upload.none(), (req, res, next) => {
  try {
    const dryRun = req.body.dry_run === 'true' || req.body.dry_run === true;
    const got = runImport(Number(req.params.id), { dryRun });
    if (got.error) return res.status(got.status).json({ error: got.error });
    res.json(got.body);
  } catch (err) {
    next(err);
  }
});

/* ---------------- our own readers ---------------- */

/*
 * These sit beside the Bizcompass routes on purpose: both end in the same
 * `applyPunches`, and a reader's punches must not be judged differently
 * depending on which tool carried them here.
 *
 * A PULL IS SAFE AND AN IMPORT IS NOT, which is why they are separate routes.
 * Pulling only copies punches into a store of our own - it touches no
 * attendance, no money, and never erases the reader. Turning them into
 * attendance is the second call, with the usual dry run first.
 */
/*
 * Is the attendance still arriving?
 *
 * The salary is counted off marks that come off punches that come off a
 * machine in a corridor, and every link of that is silent when it breaks.
 * This says so. It reads and judges; it collects nothing.
 */
reportsRouter.get('/attendance-feed', (req, res, next) => {
  try {
    res.json(attendanceFeedHealth());
  } catch (err) { next(err); }
});

reportsRouter.get('/devices', (req, res) => {
  res.json({
    devices: listDevices(),
    store: storeSummary(),
    unknownIds: unknownIds(),
    pullMinutes: pullMinutes(),
    lastRun: lastDevicePull(),
  });
});

reportsRouter.post('/devices', (req, res, next) => {
  try {
    const got = createDevice(req.body || {});
    if (got.error) return res.status(got.status).json({ error: got.error });
    res.status(201).json(got.device);
  } catch (err) { next(err); }
});

reportsRouter.patch('/devices/:id', (req, res, next) => {
  try {
    const got = updateDevice(Number(req.params.id), req.body || {});
    if (got.error) return res.status(got.status).json({ error: got.error });
    res.json(got.device);
  } catch (err) { next(err); }
});

reportsRouter.delete('/devices/:id', (req, res, next) => {
  try {
    const got = deleteDevice(Number(req.params.id));
    if (got.error) return res.status(got.status).json({ error: got.error });
    res.json(got);
  } catch (err) { next(err); }
});

/* Asks the reader who it is and nothing else - it does not download the log. */
reportsRouter.post('/devices/:id/test', async (req, res, next) => {
  try {
    const got = await checkDevice({ id: Number(req.params.id) });
    if (got.error) return res.status(got.status).json({ error: got.error });
    res.json(got.body);
  } catch (err) { next(err); }
});

reportsRouter.post('/devices/:id/pull', async (req, res, next) => {
  try {
    const got = await pullDevice(Number(req.params.id));
    if (got.error) return res.status(got.status).json({ error: got.error });
    res.json(got.body);
  } catch (err) { next(err); }
});

reportsRouter.post('/devices/pull', async (req, res, next) => {
  try {
    res.json(await pullAll());
  } catch (err) { next(err); }
});

/* The punches we have already collected, into one month's attendance. */
reportsRouter.post('/periods/:id/device-punches', upload.none(), (req, res, next) => {
  try {
    const dryRun = req.body.dry_run === 'true' || req.body.dry_run === true;
    const got = importStored(Number(req.params.id), { dryRun });
    if (got.error) return res.status(got.status).json({ error: got.error });
    res.json(got.body);
  } catch (err) { next(err); }
});

reportsRouter.post('/import/sheets', upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
  const old = legacyXls(req.file.buffer, SAVE_AS);
  if (old) return res.status(400).json(old);
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
