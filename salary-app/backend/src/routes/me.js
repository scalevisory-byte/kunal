import { Router } from 'express';
import { requireSelf } from '../auth.js';
import { logoDataUri } from '../companyLogos.js';
import fs from 'node:fs';
import {
  addDocument,
  deleteDocument,
  getDocument,
  getEmployee,
  listDocuments,
  listEmployees,
  listHolidays,
  listLoans,
  listPeriods,
  leaveSummary,
  newestPhoto,
  updateEmployee,
} from '../db.js';
import { buildPayroll } from '../payroll.js';
import { deleteDocumentFile, documentFile, uploadDocument } from '../documents.js';
import {
  createRequest,
  decideRequest,
  getRequest,
  listRequests,
  askToCancel,
  withdrawRequest,
} from '../attendanceSelf.js';
import {
  listTickets,
  createTicket,
  getTicket,
  replyToTicket,
  listAssets,
  listAnnouncements,
  listNotes,
  getNote,
  updateNote,
  listPenalties,
  listRecoveries,
} from '../people.js';
import { employeeReport } from '../../../shared/employeeReport.js';
import { attendanceStatement } from '../../../shared/attendanceStatement.js';
import { directReports, forTeam, mayDecideFor } from '../../../shared/team.js';
import { forEmployee as announcementsFor } from '../../../shared/announcements.js';
import { listVacancies } from '../hiring.js';
import { applyUrl, publicVacancy, vacancyBroadcast } from '../../../shared/hiringMessages.js';
import { config } from '../config.js';
import {
  recordSummary,
  visibleNotes,
  visiblePenalties,
} from '../../../shared/myRecord.js';
import {
  FILLABLE_NAMES,
  OFFICE_SET,
  applySelf,
  mayUpload,
  selfForm,
  selfProgress,
} from '../../../shared/selfRecord.js';

/**
 * The staff side: one person, their own records, and nothing else.
 *
 * Every route here reads `req.employeeId`, which `requireSelf` takes from the
 * LOGIN - never from the URL or the body. That is the whole of the design: an
 * employee cannot ask for somebody else's payslip however the request is
 * written, because the request never gets to say whose payslip it wants.
 *
 * The staff role carries no `read`, so none of the office routers answer it at
 * all. This router is the only door.
 *
 * What it deliberately does NOT do: show anybody else, show what the company
 * spends, or let an employee change a figure. The two things they can change
 * are their own bank details and their own phone - the two the office chases
 * them for anyway - and both land on the normal change history.
 */
export const meRouter = Router();

meRouter.use(requireSelf);

/** Only what this person may see about themselves. Never the whole row. */
const mine = (employee) =>
  employee && {
    id: employee.id,
    name: employee.name,
    code: employee.code,
    company_name: employee.company_name,
    branch_name: employee.branch_name,
    designation: employee.designation,
    department: employee.department,
    joined_on: employee.joined_on,
    probation_until: employee.probation_until,
    monthly_salary: employee.monthly_salary,
    payment_mode: employee.payment_mode,
    phone: employee.phone,
    email: employee.email,
    address: employee.address,
    // The identifiers they are asked for, so they can check them.
    pan: employee.pan,
    uan: employee.uan,
    esic_no: employee.esic_no,
    bank_name: employee.bank_name,
    bank_account: employee.bank_account,
    ifsc: employee.ifsc,
    cl_quota: employee.cl_quota,
    sl_quota: employee.sl_quota,
    pl_quota: employee.pl_quota,
    shift_in: employee.shift_in,
    shift_out: employee.shift_out,
  };

meRouter.get('/', (req, res) => {
  const employee = getEmployee(req.employeeId);
  if (!employee) return res.status(404).json({ error: 'not found' });
  /*
   * `manages` is how the page knows whether to offer a team tab at all. It is
   * a COUNT and not the list: a page that only has to decide whether to show
   * a tab has no business being handed everybody's name.
   */
  res.json({
    employee: mine(employee),
    manages: directReports(listEmployees({ active: true }), req.employeeId).length,
  });
});

/**
 * Their months, newest first.
 *
 * `sync: false` throughout, for the reason the dashboard's trend and the
 * employee report already do it: reading a year must not backdate a new hire
 * into a closed month or post another loan instalment into one already paid.
 * A person looking at their own payslip must certainly not move anything.
 */
meRouter.get('/months', (req, res) => {
  const months = [];
  for (const period of listPeriods()) {
    const payroll = buildPayroll(period.id, { sync: false });
    const row = payroll?.rows.find((r) => r.employee_id === req.employeeId);
    if (!row) continue;
    months.push({
      period_id: period.id,
      label: period.label,
      year: period.year,
      month: period.month,
      locked: Boolean(period.locked),
      // Only what it paid THEM.
      net_salary: row.net_salary,
      gross_salary: row.gross_salary,
      status: row.status,
      paid: String(row.status || '').toLowerCase() === 'paid',
    });
  }
  res.json({ months });
});

/**
 * One month in full: every line, and how each was worked out.
 *
 * "How was my salary calculated" is the question this exists for, so the row
 * goes back whole - the per-day rate, the days counted, the overtime minutes,
 * every deduction - rather than a net figure somebody has to take on trust.
 * It is the SAME row the payslip is printed from, read with sync:false.
 */
meRouter.get('/months/:periodId', (req, res) => {
  const period = listPeriods().find((p) => p.id === Number(req.params.periodId));
  if (!period) return res.status(404).json({ error: 'not found' });
  const payroll = buildPayroll(period.id, { sync: false });
  const row = payroll?.rows.find((r) => r.employee_id === req.employeeId);
  if (!row) return res.status(404).json({ error: `nothing for you in ${period.label}` });

  // The company totals ride on `payroll`; only this row goes back.
  res.json({ period: payroll.period, row });
});

/**
 * Their attendance for a month, as the grid holds it - AND DAY BY DAY WITH
 * THE CLOCK TIMES ON IT.
 *
 * Dinesh: *"employee ko time bhi dikhe roj kitne hhour kaam kiya o bhi
 * banvo"*. The page was a strip of day numbers and marks: it could say P and
 * could not say that P was 09:28 to 18:41 and came to 8h 43m.
 *
 * `statement` is built by `attendanceStatement` - THE SAME MODULE the office's
 * own statement and its printout are built from. The figures are assembled,
 * never recalculated here: a second opinion about somebody's hours is one
 * opinion too many.
 */
meRouter.get('/attendance/:periodId', (req, res) => {
  const period = listPeriods().find((p) => p.id === Number(req.params.periodId));
  if (!period) return res.status(404).json({ error: 'not found' });
  const payroll = buildPayroll(period.id, { sync: false });
  const row = payroll?.rows.find((r) => r.employee_id === req.employeeId);
  if (!row) return res.status(404).json({ error: `nothing for you in ${period.label}` });

  /*
   * Their religion rides onto the row so a festival that covers them is named
   * on the day. Without it every religion-specific holiday is skipped, and a
   * day off reads as an unexplained blank.
   */
  const employee = getEmployee(req.employeeId);
  const statement = attendanceStatement(
    { ...row, religion: employee?.religion },
    payroll.period,
    { holidays: listHolidays(period.id) }
  );

  res.json({
    period: payroll.period,
    attendance: row.attendance || {},
    marks: row.mark_counts || {},
    // calculateRow calls it `present_days`; the reports rename it afterwards.
    // Reading the report's name off the raw row gave undefined.
    payable_days: row.present_days,
    worked_minutes: row.worked_minutes,
    /* Only the days and the summary: the statement's `employee` block is
       their own name back again, which the page already has. */
    statement: { days: statement.days, summary: statement.summary },
  });
});

/** Leave taken against what they are entitled to, this year. */
meRouter.get('/leave', (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const found = leaveSummary(year).find((l) => l.employee_id === req.employeeId);
  const employee = getEmployee(req.employeeId);
  res.json({
    year,
    quotas: found?.quotas || {
      CL: employee?.cl_quota || 0,
      SL: employee?.sl_quota || 0,
      PL: employee?.pl_quota || 0,
    },
    taken: found?.taken || { CL: 0, SL: 0, PL: 0, UL: 0 },
  });
});

/** A whole year of their own figures - the same report the office can print. */
meRouter.get('/report', (req, res) => {
  const employee = getEmployee(req.employeeId);
  if (!employee) return res.status(404).json({ error: 'not found' });
  const year = Number(req.query.year) || null;
  const months = [];
  for (const period of listPeriods()) {
    if (year && period.year !== year) continue;
    const payroll = buildPayroll(period.id, { sync: false });
    const row = payroll?.rows.find((r) => r.employee_id === employee.id);
    if (row) months.push({ period: payroll.period, row });
  }
  res.json(employeeReport({ employee, months, year }));
});

/* ---------------- the things they can raise ---------------- */

meRouter.get('/requests', (req, res) =>
  res.json({ requests: listRequests({ employee_id: req.employeeId }) })
);

/**
 * Applying for leave, or asking for an attendance correction.
 *
 * The employee id comes from the LOGIN, never the body - the same rule the
 * punch link follows, and for the same reason: otherwise one person can raise
 * a request in somebody else's name.
 *
 * A request writes nothing on the grid. An approval does.
 */
meRouter.post('/requests', (req, res) => {
  try {
    res.status(201).json(
      createRequest({
        ...req.body,
        // From the LOGIN, never the body.
        employee_id: req.employeeId,
      })
    );
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Taking one back.
 *
 * The punch link could already do this and the staff login could not, so
 * somebody with a login could ask for a day off and then had to ring the
 * office to un-ask. `withdrawRequest` checks the id against the LOGIN's
 * employee, so this cannot cancel anybody else's.
 *
 * It works while the request is still open - including after a manager has
 * backed it, because the office has not acted on it yet. Once it is approved
 * the day is on the grid and taking it back is the office's call - which is
 * what the cancellation below is for.
 */
meRouter.delete('/requests/:id', (req, res) => {
  try {
    const request = withdrawRequest(Number(req.params.id), req.employeeId);
    if (!request) return res.status(404).json({ error: 'not found' });
    res.json(request);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * ASKING FOR AN APPROVED LEAVE TO BE CALLED OFF.
 *
 * Plans change after an approval too, and until now the only route was a
 * phone call. This does NOT cancel anything: the same rule as everywhere
 * else here - a request never writes attendance, a decision does. It marks
 * the row as waiting to be called off, and the office presses the button.
 *
 * The employee id comes off the LOGIN, so nobody can ask for somebody
 * else's leave to be dropped.
 */
meRouter.post('/requests/:id/cancel', (req, res) => {
  try {
    const request = askToCancel(Number(req.params.id), req.employeeId, req.body?.reason);
    if (!request) return res.status(404).json({ error: 'not found' });
    res.json({
      request,
      note: 'The office has been told. Nothing changes on the grid until they cancel it.',
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ---------------- a manager's own team ---------------- */

/*
 * The other half of approvals.
 *
 * HR works the whole queue in Reports. This is the person who actually knows
 * whether Amit can be spared on Thursday deciding it from their own login,
 * rather than forwarding it to the office to type in.
 *
 * The manager is `req.employeeId`, off the LOGIN. Their reports are worked
 * out here from that id, so nothing the caller sends can widen the set - the
 * same rule every other route in this file follows.
 *
 * It adds no ability: the staff role still carries no `read`, so none of the
 * office routers answer a manager either. All they gain is their own team's
 * names and their own team's requests.
 */
const myReports = (req) => directReports(listEmployees({ active: true }), req.employeeId);

meRouter.get('/team', (req, res) => {
  const reports = myReports(req);
  const ids = new Set(reports.map((r) => Number(r.id)));
  const requests = listRequests({}).filter((r) => ids.has(Number(r.employee_id)));
  res.json({
    // Name, code, what they do. Not what they are paid.
    team: reports.map(forTeam),
    // Only what is still theirs to answer. One they have already backed is
    // with the office now, and counting it would read as work undone.
    waiting: requests.filter((r) => r.status === 'pending').length,
    sent_on: requests.filter((r) => r.status === 'recommended').length,
  });
});

/** Their team's requests, pending first — the same list HR sees, narrowed. */
meRouter.get('/team/requests', (req, res) => {
  const ids = new Set(myReports(req).map((r) => Number(r.id)));
  const requests = listRequests({}).filter((r) => ids.has(Number(r.employee_id)));
  res.json({ requests });
});

/**
 * Approve or reject one of their own team's requests.
 *
 * It goes through the SAME `decideRequest` the office uses - so "an approval
 * writes attendance", "nothing is decided twice" and "nothing is written into
 * a locked month" all hold here without being restated. Two code paths
 * writing attendance is how two sets of rules come to disagree.
 */
meRouter.post('/team/requests/:id/decide', (req, res) => {
  try {
    const request = getRequest(Number(req.params.id));
    const ids = new Set(myReports(req).map((r) => Number(r.id)));
    const may = mayDecideFor(request, { managerId: req.employeeId, reportIds: ids });
    if (!may.ok) return res.status(403).json({ error: may.reason });

    const me = getEmployee(req.employeeId);
    res.json(
      decideRequest(request.id, {
        approve: Boolean(req.body?.approve),
        // Their own name, so the trail says who backed it rather than "office".
        by: me?.name || 'manager',
        note: req.body?.note,
        /*
         * A manager RECOMMENDS. Approving here moves the request to
         * `recommended` and writes nothing on the grid; the office confirms
         * it, and that call is the one that reaches attendance. Rejecting
         * ends it, because a refusal costs nothing and needs no second
         * opinion.
         */
        asManager: true,
      })
    );
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

meRouter.get('/tickets', (req, res) =>
  res.json({ tickets: listTickets({ employee_id: req.employeeId }) })
);

meRouter.get('/tickets/:id', (req, res) => {
  const ticket = getTicket(Number(req.params.id));
  // Theirs, or nothing. Checked here and not in the query, so a ticket that
  // is not theirs reads as missing rather than as refused - which is also
  // what it is, from where they are standing.
  if (!ticket || ticket.employee_id !== req.employeeId) {
    return res.status(404).json({ error: 'not found' });
  }
  res.json(ticket);
});

meRouter.post('/tickets', (req, res) => {
  try {
    res.status(201).json(createTicket(req.employeeId, { ...req.body, by: 'employee' }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

meRouter.post('/tickets/:id/reply', (req, res) => {
  const ticket = getTicket(Number(req.params.id));
  if (!ticket || ticket.employee_id !== req.employeeId) {
    return res.status(404).json({ error: 'not found' });
  }
  try {
    res.json(
      replyToTicket(ticket.id, {
        side: 'employee',
        author: getEmployee(req.employeeId)?.name,
        body: req.body?.body,
      })
    );
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ---------------- what they can change about themselves ---------------- */

/**
 * Bank details and a phone number: the two the office chases them for.
 *
 * Deliberately a short list. A salary, a joining date or a PF number is not
 * theirs to edit, and `updateEmployee` writes every change to the same
 * employee history the office reads - so a bank account changing the week
 * before payday is visible, by name and date.
 */
const THEIRS_TO_CHANGE = ['bank_name', 'bank_account', 'ifsc', 'phone', 'phone_alt', 'email', 'address'];

meRouter.patch('/', (req, res) => {
  const patch = {};
  for (const key of THEIRS_TO_CHANGE) if (key in (req.body || {})) patch[key] = req.body[key];
  if (!Object.keys(patch).length) {
    return res.status(400).json({
      error: `you can change ${THEIRS_TO_CHANGE.join(', ')} — anything else is the office’s to change`,
    });
  }
  try {
    const employee = updateEmployee(req.employeeId, {
      ...patch,
      by: getEmployee(req.employeeId)?.name,
      history_note: 'Changed by the employee from their own login',
    });
    res.json({ employee: mine(employee) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/*
 * THEIR OWN COMPANY'S LOGO, so the payslip they print carries the letterhead
 * the office's copy does.
 *
 * The same shape the office asks for at /companies/logos, narrowed to the one
 * company they work for - a staff login has no `read` and must not be handed
 * a list of the other companies. The slip is built in the browser, so the
 * picture has to travel; the employee id comes off the LOGIN, as every route
 * here does.
 */
meRouter.get('/logos', (req, res) => {
  const employee = getEmployee(req.employeeId);
  const logo = employee && logoDataUri(employee.company_id);
  res.json({
    logos: logo ? [{ id: employee.company_id, name: employee.company_name, logo }] : [],
  });
});

/*
 * Their own photograph, for their own page. Same shape as the office route and
 * the same reason it is not a signed link: an <img> on a page left open.
 */
meRouter.get('/photo', (req, res) => {
  const doc = newestPhoto(req.employeeId);
  const file = doc && documentFile(doc);
  if (!file) return res.status(404).json({ error: 'no photograph on file' });
  res.setHeader('cache-control', 'private, max-age=86400');
  res.sendFile(file);
});

/** Their own documents, and what is still wanted. */
meRouter.get('/documents', (req, res) =>
  res.json({
    // The path never leaves the server; the office route strips it too.
    documents: listDocuments(req.employeeId).map(({ file_path, ...rest }) => rest),
  })
);

/* ============================================================= *
 * FILLING IN THEIR OWN RECORD
 *
 * Dinesh: the details it takes to make an employee should be typed by the
 * employee, and their papers uploaded by them. The joining form already
 * worked that way for somebody who had not joined yet
 * (`shared/onboardingFlow.js` and the /join link); this is the same thing
 * for the eighty-odd people already on the payroll, whose UAN and ESIC
 * columns are blank because only the office could ever fill them.
 *
 * `shared/selfRecord.js` holds the rule and the field list. The employee id
 * comes off the LOGIN here as everywhere else in this router, so none of
 * this can be pointed at somebody else however the request is written.
 * ============================================================= */

/**
 * A crude per-login rate limit, with ITS OWN BUCKET.
 *
 * The punch link learned this the hard way: one counter shared across routes
 * with different limits meant the busy route starved the strict one. A form
 * saved on blur is chatty; an upload is not.
 */
const selfHits = new Map();
const selfLimit = (max, bucket) => (req, res, next) => {
  const key = `${req.employeeId}:${bucket}:${Math.floor(Date.now() / 60000)}`;
  const n = (selfHits.get(key) || 0) + 1;
  selfHits.set(key, n);
  if (selfHits.size > 5000) selfHits.clear();
  if (n > max) return res.status(429).json({ error: 'Too many at once. Wait a minute.' });
  next();
};

/** Only the fields this page is about — theirs, and the office's to read. */
const profileOf = (employee) => {
  const out = {};
  for (const field of FILLABLE_NAMES) out[field] = employee[field] ?? '';
  for (const [field] of OFFICE_SET) out[field] = employee[field] ?? '';
  out.id = employee.id;
  return out;
};

meRouter.get('/profile', (req, res) => {
  const employee = getEmployee(req.employeeId);
  if (!employee) return res.status(404).json({ error: 'not found' });
  res.json({
    employee: profileOf(employee),
    /* The form's shape travels, so the page renders a list rather than
       carrying its own copy of what an employee is. */
    sections: selfForm(),
    office_set: OFFICE_SET,
    progress: selfProgress(employee),
  });
});

/**
 * What they typed about themselves.
 *
 * `applySelf` decides what may land: their own facts write through, a
 * statutory number may be FILLED IN but not changed, and anything else is
 * refused BY NAME. Refusing by name rather than dropping it quietly is the
 * point — a form that answers "Saved" to a salary it threw away is worse
 * than one that refuses.
 *
 * Every change goes through `updateEmployee`, so it lands in
 * `employee_history` with who and when, exactly as a bank account already
 * did. Nothing here reaches `calculateRow`: not one field on the list is an
 * input to it, so no month can move.
 */
meRouter.patch('/profile', selfLimit(60, 'profile'), (req, res) => {
  const employee = getEmployee(req.employeeId);
  if (!employee) return res.status(404).json({ error: 'not found' });

  const { patch, refused } = applySelf(employee, req.body || {});
  if (!Object.keys(patch).length) {
    return res.status(400).json({
      error: refused[0]?.why || 'there was nothing on that form that is yours to change',
      refused,
    });
  }
  try {
    const updated = updateEmployee(req.employeeId, {
      ...patch,
      by: employee.name,
      history_note: 'Filled in by the employee from their own login',
    });
    res.json({
      employee: profileOf(updated),
      progress: selfProgress(updated),
      refused,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * THEIR OWN PAPERS, SENT IN BY THEM.
 *
 * Into the SAME store the office uploads to — one set of documents, one
 * register, one KYC count. What arrives is UNCHECKED: `verified` stays null,
 * which is a third state and not "rejected". Somebody in the office still
 * has to look at the Aadhaar card, and that was always true of a document
 * the office typed in itself.
 *
 * An offer letter and an appointment letter are refused: those are issued BY
 * the office, and a file somebody put on their own record claiming to be one
 * is the one kind of document that would be worth forging.
 */
meRouter.post('/documents', selfLimit(10, 'documents'), uploadDocument, (req, res) => {
  const kind = String(req.body?.kind || 'other');
  const drop = () => {
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* nothing to clean up */
      }
    }
  };
  if (!req.file) return res.status(400).json({ error: 'no file was uploaded' });
  if (!mayUpload(kind)) {
    drop();
    return res.status(400).json({ error: `${kind} is issued by the office — it is not yours to upload` });
  }
  const doc = addDocument(req.employeeId, {
    kind,
    file_path: req.file.filename,
    file_name: req.file.originalname,
    number: req.body?.number,
    expires_on: req.body?.expires_on,
    notes: 'Uploaded by the employee from their own login',
  });
  const { file_path, ...rest } = doc;
  res.status(201).json({ document: rest });
});

/**
 * Reading back one of their own.
 *
 * Deliberately not a signed link like the office's: this is served straight,
 * behind the session, to the one person it belongs to. The id is checked
 * against the LOGIN — a document that is not theirs is a 404 here, not a
 * refusal, because this route has no business confirming it exists.
 */
meRouter.get('/documents/:id/file', (req, res) => {
  const doc = getDocument(Number(req.params.id));
  if (!doc || doc.employee_id !== req.employeeId) return res.status(404).json({ error: 'not found' });
  const file = documentFile(doc);
  if (!file) return res.status(404).json({ error: 'the file is missing' });
  res.setHeader('cache-control', 'private, max-age=60');
  res.download(file, doc.file_name || 'document');
});

/** They may take back one THEY sent in — not one the office filed. */
meRouter.delete('/documents/:id', (req, res) => {
  const doc = getDocument(Number(req.params.id));
  if (!doc || doc.employee_id !== req.employeeId) return res.status(404).json({ error: 'not found' });
  if (doc.verified === 1 || doc.verified === 0) {
    return res.status(400).json({ error: 'the office has already checked this one — ask them to change it' });
  }
  deleteDocumentFile(doc);
  deleteDocument(doc.id);
  res.status(204).end();
});

/** What they are holding, so a handover slip is not a surprise. */
meRouter.get('/assets', (req, res) =>
  res.json({ assets: listAssets({ employee_id: req.employeeId, out: true }) })
);

/**
 * THE COMPANY'S HOLIDAYS, as they apply to THIS person.
 *
 * Holidays carry the religions they cover - Diwali for the Hindu staff, Eid
 * for the Muslim staff, everybody else at work - so a list that showed all of
 * them would tell somebody they have days off they do not have. Only the ones
 * covering them come back, and a holiday with no religions is the whole
 * office.
 *
 * Read-only, and only the months that exist. Nothing here can write.
 */
meRouter.get('/holidays', (req, res) => {
  const employee = getEmployee(req.employeeId);
  if (!employee) return res.status(404).json({ error: 'not found' });
  const mine = String(employee.religion || '').trim().toLowerCase();
  const out = [];
  for (const period of listPeriods()) {
    for (const holiday of listHolidays(period.id)) {
      const covers = holiday.religions || [];
      if (covers.length && !covers.some((r) => String(r).trim().toLowerCase() === mine)) continue;
      out.push({
        period_id: period.id,
        period: period.label,
        year: period.year,
        month: period.month,
        day: holiday.day,
        /* An ISO date so the page can sort and say "in 9 days" without
           re-deriving the month from a label. */
        date: `${period.year}-${String(period.month).padStart(2, '0')}-${String(holiday.day).padStart(2, '0')}`,
        name: holiday.name,
        code: holiday.code,
        /* Whether the office has actually marked it on the grid yet. A
           holiday that is only planned is not a day off until it is applied,
           and saying otherwise is how somebody does not turn up. */
        applied: !!holiday.applied_at,
        /* Who it is for, in words - so "Diwali, for the Hindu staff" reads
           as a fact rather than as something aimed at them personally. */
        religions: covers,
      });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  res.json({ holidays: out });
});

/* ---------------- what is on their record ---------------- */

/**
 * APPRECIATIONS, WARNINGS AND PENALTIES - their own copy.
 *
 * Dinesh: *"emp[loyee me unke achvemnet and penlatlites bhi dikhe esa karo"*.
 * The office has kept both lists since the People tab was built; neither had
 * ever been shown to the person they are about.
 *
 * `shared/myRecord.js` holds the rule about what is theirs to see - a warning
 * and an appreciation yes, the office's own plain jotting no, a penalty once
 * it has been told or once money has come out of it - so the route, the page
 * and the tests cannot each have their own idea of it.
 *
 * The employee id comes off the LOGIN, as everything in this file does, and
 * both lists travel through a whitelist rather than a strip.
 */
meRouter.get('/record', (req, res) => {
  const notes = visibleNotes(listNotes(req.employeeId));
  const penalties = visiblePenalties(
    listPenalties({ employee_id: req.employeeId }),
    listRecoveries
  );
  res.json({ notes, penalties, summary: recordSummary({ notes, penalties }) });
});

/**
 * "I have seen this warning."
 *
 * `acknowledged_on` was a date the office typed in on the person's behalf.
 * This is the person saying it themselves, which is the only way the column
 * means anything.
 *
 * Three deliberate limits:
 *
 *   ONLY A WARNING. An appreciation needs no acknowledging, and a plain note
 *       is not shown here at all.
 *   ONLY ONCE, AND NEVER BACK. Asking again returns the row unchanged rather
 *       than moving the date; there is no un-acknowledge, because letting
 *       somebody take it back would let them deny having seen it.
 *   NOT FOR A PENALTY. The penalty column means *accepted*, and accepting a
 *       deduction is a conversation, not a tap on a phone - one column cannot
 *       tell "I have seen this" from "I agree to this money coming out". So
 *       the portal shows whether it was accepted and offers no button.
 */
meRouter.post('/notes/:id/acknowledge', (req, res) => {
  const note = getNote(Number(req.params.id));
  // Theirs, or nothing - and "nothing" reads as missing, which is also what
  // it is from where they are standing.
  if (!note || note.employee_id !== req.employeeId) {
    return res.status(404).json({ error: 'not found' });
  }
  if (note.kind !== 'warning') {
    return res.status(400).json({ error: 'only a warning is acknowledged' });
  }
  if (note.acknowledged_on) return res.json({ note });
  const me = getEmployee(req.employeeId);
  const updated = updateNote(note.id, {
    acknowledged_on: new Date().toISOString().slice(0, 10),
    by: me?.name || 'employee',
  });
  res.json({ note: updated });
});

/**
 * THE NOTICEBOARD, as it applies to this person.
 *
 * Dinesh: *"any announcmnet like celbration holiday o bhi"*. Only what is
 * live today and only what covers their company - BOOKNFLY's picnic is not
 * SCALE's - and a notice written in advance stays off the board until the
 * day it starts, because somebody turning up to a party a week early is
 * exactly what a start date is for.
 */
meRouter.get('/announcements', (req, res) => {
  const employee = getEmployee(req.employeeId);
  if (!employee) return res.status(404).json({ error: 'not found' });
  res.json({
    announcements: announcementsFor(listAnnouncements({}), {
      companyId: employee.company_id,
      today: new Date().toISOString().slice(0, 10),
    }),
  });
});

/**
 * WHAT WE ARE HIRING FOR, so somebody can refer a friend.
 *
 * Dinesh: *"employee login me current opeing me bhi dikhavo taki o kisi ko
 * refre kar sake"*. The openings already exist and already have a public
 * apply link; what was missing is that the people most likely to know a good
 * candidate - the staff - could not see them.
 *
 * ONLY WHAT IS ALREADY PUBLIC. `publicVacancy` is the same narrowing the
 * advert and the apply page use, so the internal notes and who the job
 * reports to do not travel. A staff login has no `read`, and this does not
 * widen it: an employee sees the advert, not the vacancy record.
 */
meRouter.get('/openings', (req, res) => {
  const open = listVacancies({ status: 'Published' });
  const baseUrl = config.publicUrl || '';
  res.json({
    openings: open.map((v) => ({
      ...publicVacancy(v),
      /* The link to pass on, and the message to pass on with it. Built on
         the server so the portal does not need the hiring module. */
      apply_url: baseUrl ? applyUrl(baseUrl, v) : '',
      share: vacancyBroadcast(v, { baseUrl }),
    })),
    /* Said out loud when there is no public address set: the advert is
       useless without a link, and an empty Apply button is worse than a
       sentence explaining why. */
    can_share: Boolean(baseUrl),
  });
});

/** Any loan of theirs, and what is left on it. */
meRouter.get('/loans', (req, res) =>
  res.json({ loans: listLoans({ employee_id: req.employeeId, includeClosed: true }) })
);
