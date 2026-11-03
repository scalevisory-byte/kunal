/**
 * Every report the system offers, as data.
 *
 * The Reports screen used to be a card of download buttons with the rest of
 * the reports scattered across six other tabs — attendance reports under
 * Attendance, late coming under Time, assets under Assets, settlement under
 * People. Somebody looking for "the late coming report" had no way to know
 * where it was, or whether it existed.
 *
 * So the listing is a LIST, not markup: one entry per report, carrying its
 * category, which filters it honours, and where it comes from. Two things
 * follow from that which matter more than the tidiness:
 *
 *  - **A report cannot be in the listing and not exist**, or exist and be
 *    missing from the listing. Both were true before.
 *  - **The filter bar can ask each report what it accepts**, so a report that
 *    is not per-employee never shows an employee filter that does nothing.
 *
 * `status` is honest about what is here today: a report still to be built is
 * listed as `planned` and says so, rather than being left out so the screen
 * looks finished.
 *
 * Dependency-free: the server could serve this listing and the dashboard
 * renders it, from one source.
 */

export const CATEGORIES = [
  { key: 'attendance', label: 'Attendance', hint: 'Who was in, when, and for how long' },
  { key: 'payroll', label: 'Payroll', hint: 'What was paid, to whom, and how' },
  { key: 'leave', label: 'Leave', hint: 'Taken, left, and what it cost' },
  { key: 'statutory', label: 'Statutory', hint: 'PF, ESI and Professional Tax' },
  { key: 'employee', label: 'Employees', hint: 'The master, joiners, leavers and papers' },
  { key: 'loans', label: 'Loans and advances', hint: 'Given, recovered and outstanding' },
  { key: 'assets', label: 'Assets', hint: 'Register, handovers, verification and upkeep' },
  { key: 'mis', label: 'Management', hint: 'Cost, attendance and movement, month on month' },
];

/** What a report can be narrowed by. The bar shows only what is listed. */
export const FILTERS = ['month', 'range', 'company', 'branch', 'department', 'employee', 'search'];

/**
 * `status`:
 *   ready    — built and in use
 *   partial  — exists, but not yet as a proper report (no export, or it lives
 *              on another tab and has not been brought across)
 *   planned  — not built. Listed so the gap is visible rather than hidden.
 */
const R = (id, name, category, status, opts = {}) => ({
  id,
  name,
  category,
  status,
  filters: opts.filters || ['month', 'company'],
  // Where it comes from today — a panel on this screen, a file to download,
  // or another tab it has not been moved off yet.
  at: opts.at || null,
  note: opts.note || '',
  phase: opts.phase || (['loans', 'assets', 'mis'].includes(category) ? 2 : 1),
});

export const REPORTS = [
  /* ---- A. Attendance ---- */
  R('attendance-register', 'Monthly attendance register', 'attendance', 'ready',
    { filters: ['month', 'company', 'department', 'employee', 'search'], at: 'panel:attendance' }),
  R('attendance-daily', 'Daily attendance', 'attendance', 'partial',
    { filters: ['month', 'company', 'department', 'search'], at: 'tab:dashboard',
      note: 'The dashboard roll call covers one day. Not yet a report with its own date and export.' }),
  R('late-coming', 'Late coming', 'attendance', 'partial',
    { filters: ['month', 'company', 'department', 'employee'], at: 'tab:time',
      note: 'On the Time tab, per person with days and minutes. No export yet.' }),
  R('early-leaving', 'Early leaving', 'attendance', 'partial',
    { filters: ['month', 'company', 'department', 'employee'], at: 'tab:time',
      note: 'Same panel as late coming.' }),
  R('missing-punch', 'Missing punch', 'attendance', 'planned',
    { filters: ['month', 'company', 'department', 'employee'],
      note: 'The flags exist — never punched out, no out time — but nothing lists them.' }),
  R('working-hours', 'Working hours', 'attendance', 'partial',
    { filters: ['month', 'company', 'department', 'employee'],
      note: 'Hours worked is calculated and rides into the Excel export. No standalone report.' }),
  R('overtime', 'Overtime', 'attendance', 'partial',
    { filters: ['month', 'company', 'department', 'employee'],
      note: 'OT minutes and OT pay are calculated. Export columns only.' }),
  R('sunday-register', 'Sunday working register', 'attendance', 'ready',
    { filters: ['month', 'company'], at: 'file:sunday' }),
  R('holiday-register', 'Holiday working register', 'attendance', 'partial',
    { filters: ['month', 'company'], at: 'tab:attendance',
      note: 'The panel is on the Attendance tab. No CSV yet.' }),
  R('attendance-approvals', 'Attendance corrections and approvals', 'attendance', 'ready',
    { filters: ['month', 'company', 'employee'], at: 'panel:approvals' }),

  /* ---- B. Payroll ---- */
  R('salary-register', 'Monthly salary register', 'payroll', 'ready',
    { filters: ['month', 'company', 'department', 'search'], at: 'file:salary' }),
  R('payslip', 'Salary slip', 'payroll', 'ready',
    { filters: ['month', 'employee'], at: 'tab:sheet',
      note: 'Opened from a name on the salary sheet. Recomputed from the engine, not a stored row.' }),
  R('bank-register', 'Bank payment register', 'payroll', 'partial',
    { filters: ['month', 'company'], at: 'file:bank',
      note: 'The pack has a bank sheet and the payment list covers the unpaid. No register with IFSC and account.' }),
  R('cash-register', 'Cash payment register', 'payroll', 'partial',
    { filters: ['month', 'company'],
      note: 'The pack splits a cash sheet. No standalone register with a signature column.' }),
  R('unpaid-salary', 'Unpaid salary', 'payroll', 'ready',
    { filters: ['month', 'company'], at: 'file:bank' }),
  R('deductions', 'Salary deductions', 'payroll', 'planned',
    { filters: ['month', 'company', 'department', 'employee'],
      note: 'Every deduction is calculated — PF, ESI, PT, loan, one-off, late — but nothing gathers them into one statement.' }),
  R('salary-comparison', 'Month on month comparison', 'payroll', 'partial',
    { filters: ['month', 'company'], at: 'tab:dashboard',
      note: 'Dashboard has a comparison strip and a six-month trend. No per-employee variance, no export.' }),
  R('payroll-by-company', 'Company-wise payroll summary', 'payroll', 'ready',
    { filters: ['month'], at: 'panel:totals' }),
  R('sunday-holiday-pay', 'Sunday and holiday payment', 'payroll', 'partial',
    { filters: ['month', 'company'], at: 'file:sunday',
      note: 'Sunday is covered. Holiday working is settled through the same register but not separated out.' }),
  R('settlement', 'Full and final settlement', 'payroll', 'ready',
    { filters: ['employee'], at: 'tab:people', note: 'People → exits. No export yet.' }),

  /* ---- C. Leave ---- */
  R('leave-month', 'Monthly leave register', 'leave', 'ready',
    { filters: ['month', 'company', 'department', 'employee'], at: 'panel:leave' }),
  R('leave-balance', 'Employee leave balance', 'leave', 'ready',
    { filters: ['company', 'employee'], at: 'file:leave' }),
  R('leave-status', 'Leave application status', 'leave', 'partial',
    { filters: ['month', 'company', 'employee'], at: 'panel:approvals',
      note: 'Leave applications share the approval queue. Not a report with pending ageing.' }),
  R('leave-lop', 'Unpaid leave / LOP', 'leave', 'ready',
    { filters: ['month', 'company', 'department'], at: 'panel:leave' }),
  R('leave-by-department', 'Department-wise leave summary', 'leave', 'planned',
    { filters: ['month', 'company', 'department'],
      note: 'Department is on the master and leave is on the marks. Nothing joins the two.' }),

  /* ---- D. Statutory ---- */
  R('pf-register', 'PF register', 'statutory', 'ready', { at: 'panel:statutory' }),
  R('esi-register', 'ESI register', 'statutory', 'ready', { at: 'panel:statutory' }),
  R('pt-register', 'Professional tax register', 'statutory', 'ready', { at: 'panel:statutory' }),
  R('wage-register', 'Wage register', 'statutory', 'ready', { at: 'panel:statutory' }),
  R('pf-ecr', 'PF ECR export', 'statutory', 'planned',
    { note: 'Needs the portal’s exact layout. These drift, so it must be matched to a file EPFO has accepted — not written from memory.' }),
  R('esi-export', 'ESI contribution export', 'statutory', 'planned',
    { note: 'Same: the ESIC template must be confirmed, not assumed.' }),
  R('pt-statement', 'PT statement', 'statutory', 'partial',
    { note: 'The register exists; a challan-shaped statement per company does not.' }),
  R('challan-summary', 'Statutory challan summary', 'statutory', 'planned',
    { note: 'Nothing tracks what has actually been paid. The dashboard names due dates as a reminder only.' }),

  /* ---- E. Employees ---- */
  R('employee-master', 'Employee master register', 'employee', 'ready',
    { filters: ['company', 'department', 'search'], at: 'file:employees' }),
  R('employee-active', 'Active employee list', 'employee', 'ready',
    { filters: ['company', 'department', 'search'], at: 'file:employees' }),
  R('employee-left', 'Resigned employee list', 'employee', 'partial',
    { filters: ['range', 'company'], note: 'Exits and leaving dates are recorded. No list with dates and reasons.' }),
  R('employee-joined', 'New joining report', 'employee', 'partial',
    { filters: ['range', 'company', 'department'], at: 'tab:dashboard',
      note: 'The dashboard names this month’s joiners. No range, no export.' }),
  R('employee-documents', 'Employee document status', 'employee', 'partial',
    { filters: ['company', 'department', 'employee'], at: 'tab:employees',
      note: 'Each record says what is missing or expired. No register across all staff — which is what an audit asks for.' }),
  R('employee-by-department', 'Department-wise employee list', 'employee', 'partial',
    { filters: ['company', 'department'], at: 'tab:employees',
      note: 'The employee list filters by department. Not exportable as a report.' }),

  /* ---- F. Loans ---- */
  R('loan-register', 'Employee loan register', 'loans', 'partial',
    { filters: ['company', 'employee'], at: 'tab:loans', note: 'Listed on the Loans tab. No export.' }),
  R('advance-register', 'Salary advance register', 'loans', 'partial',
    { filters: ['company', 'employee'],
      note: 'Advances are stored as loans. Nothing tells the two apart, so they cannot be reported separately.' }),
  R('emi-deductions', 'EMI deduction report', 'loans', 'partial',
    { filters: ['month', 'company', 'employee'], note: 'Deducted each month and in the export. No report of what was recovered.' }),
  R('loan-outstanding', 'Outstanding loan report', 'loans', 'partial',
    { filters: ['company', 'employee'], note: 'Outstanding is computed per loan. No ageing, no company totals.' }),
  R('loan-settled', 'Loan settlement report', 'loans', 'planned',
    { filters: ['range', 'company'],
      note: 'Closure is a status on the loan. Nothing reports loans closed over a period.' }),

  /* ---- G. Assets ---- */
  R('asset-register', 'Asset register', 'assets', 'ready', { filters: ['company', 'search'], at: 'tab:assets' }),
  R('asset-allocation', 'Employee-wise asset allocation', 'assets', 'ready',
    { filters: ['company', 'employee'], at: 'tab:assets' }),
  R('asset-handovers', 'Asset handover and return', 'assets', 'ready',
    { filters: ['range', 'company', 'employee'], at: 'tab:assets' }),
  R('asset-verification', 'Asset verification', 'assets', 'partial',
    { filters: ['company'], at: 'tab:assets',
      note: 'Stock take works and keeps “not checked” apart from “not found”. No export of a round.' }),
  R('asset-maintenance', 'Asset maintenance', 'assets', 'ready', { filters: ['range', 'company'], at: 'tab:assets' }),
  R('asset-cost', 'Asset service cost', 'assets', 'ready', { filters: ['company'], at: 'tab:assets' }),
  R('asset-damaged', 'Damaged or missing assets', 'assets', 'partial',
    { filters: ['company'], note: 'Needs a damage or loss reason on the asset, so a missing laptop can be told from a broken one.' }),

  /* ---- H. Management ---- */
  R('cost-employee', 'Monthly employee cost', 'mis', 'partial',
    { filters: ['month', 'company', 'department'],
      note: 'The employer side — PF with EPS, EDLI and admin, and ESI — is calculated, so real CTC is available but never reported.' }),
  R('cost-company', 'Company-wise salary cost', 'mis', 'ready', { filters: ['month'], at: 'panel:totals' }),
  R('cost-department', 'Department-wise salary cost', 'mis', 'planned',
    { filters: ['month', 'company', 'department'],
      note: 'Needs the department joined to the payroll row at report time.' }),
  R('attendance-percent', 'Attendance percentage', 'mis', 'ready',
    { filters: ['month', 'company', 'department'], at: 'panel:attendance' }),
  R('absenteeism', 'Absenteeism summary', 'mis', 'partial',
    { filters: ['month', 'company', 'department'], at: 'panel:attendance', note: 'Days lost is there. No month-on-month view.' }),
  R('late-summary', 'Late coming summary', 'mis', 'partial',
    { filters: ['month', 'company'], at: 'tab:time' }),
  R('movement', 'Joining and exit summary', 'mis', 'partial',
    { filters: ['range', 'company'], at: 'tab:dashboard', note: 'No period summary and no attrition figure.' }),
  R('payroll-comparison', 'Monthly payroll comparison', 'mis', 'partial',
    { filters: ['month', 'company'], at: 'tab:dashboard' }),
  R('statutory-pending', 'Pending statutory payments', 'mis', 'planned',
    { filters: ['month', 'company'], note: 'Depends on challan tracking.' }),
];

export const STATUS = {
  ready: { label: 'Ready', tone: 'have' },
  partial: { label: 'Partly there', tone: 'part' },
  planned: { label: 'Not built yet', tone: 'none' },
};

/** The reports in one category, newest-useful first: ready, then partial. */
export function reportsIn(category, { phase } = {}) {
  const order = { ready: 0, partial: 1, planned: 2 };
  return REPORTS.filter((r) => r.category === category)
    .filter((r) => !phase || r.phase === phase)
    .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
}

export function catalogueTotals(reports = REPORTS) {
  const out = { total: reports.length, ready: 0, partial: 0, planned: 0 };
  for (const r of reports) out[r.status]++;
  return out;
}

/** Does this report accept that filter? The bar asks before it offers one. */
export const accepts = (report, filter) => Boolean(report?.filters?.includes(filter));
