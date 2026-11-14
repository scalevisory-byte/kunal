import { Router } from 'express';
import { requireSelf } from '../auth.js';
import {
  getEmployee,
  listDocuments,
  listEmployees,
  listLoans,
  listPeriods,
  leaveSummary,
  newestPhoto,
  updateEmployee,
} from '../db.js';
import { buildPayroll } from '../payroll.js';
import { documentFile } from '../documents.js';
import { createRequest, decideRequest, getRequest, listRequests } from '../attendanceSelf.js';
import { listTickets, createTicket, getTicket, replyToTicket, listAssets } from '../people.js';
import { employeeReport } from '../../../shared/employeeReport.js';
import { directReports, forTeam, mayDecideFor } from '../../../shared/team.js';

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

/** Their attendance for a month, as the grid holds it. */
meRouter.get('/attendance/:periodId', (req, res) => {
  const period = listPeriods().find((p) => p.id === Number(req.params.periodId));
  if (!period) return res.status(404).json({ error: 'not found' });
  const payroll = buildPayroll(period.id, { sync: false });
  const row = payroll?.rows.find((r) => r.employee_id === req.employeeId);
  if (!row) return res.status(404).json({ error: `nothing for you in ${period.label}` });
  res.json({
    period: payroll.period,
    attendance: row.attendance || {},
    marks: row.mark_counts || {},
    // calculateRow calls it `present_days`; the reports rename it afterwards.
    // Reading the report's name off the raw row gave undefined.
    payable_days: row.present_days,
    worked_minutes: row.worked_minutes,
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
    waiting: requests.filter((r) => r.status === 'pending').length,
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
        // Their own name, so the trail says who decided rather than "office".
        by: me?.name || 'manager',
        note: req.body?.note,
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

/** What they are holding, so a handover slip is not a surprise. */
meRouter.get('/assets', (req, res) =>
  res.json({ assets: listAssets({ employee_id: req.employeeId, out: true }) })
);

/** Any loan of theirs, and what is left on it. */
meRouter.get('/loans', (req, res) =>
  res.json({ loans: listLoans({ employee_id: req.employeeId, includeClosed: true }) })
);
