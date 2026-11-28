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
  { key: 'hiring', label: 'Hiring', hint: 'Openings, candidates and where each one has reached' },
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
  R('missing-punch', 'Missing punch', 'attendance', 'ready',
    { filters: ['month', 'company', 'department', 'employee'], at: 'panel:missing-punch' }),
  R('punch-ids', 'Punch IDs', 'attendance', 'ready',
    { filters: [], at: 'panel:punch-ids',
      note: 'Who the readers can reach. Not a month - it reads the staff list as it is today.' }),
  R('punch-totals', 'Punch totals', 'attendance', 'ready',
    { filters: ['month'], at: 'panel:punch-totals',
      note: 'How many punches each person actually has. Counts raw events, never attendance.' }),
  R('punch-log', 'Punch log', 'attendance', 'ready',
    { filters: ['month'], at: 'panel:punch-log',
      note: 'Every punch, one line each. The readers\u2019 own record - never attendance.' }),
  /* Was `partial`, noted "No standalone report" — and that had been stale for
     a long time: every figure already existed and nobody had built the
     screen. Dinesh asked for it as *"need all logs / all in out"*. */
  R('working-hours', 'Working hours \u2014 every in and out', 'attendance', 'ready',
    { filters: ['month', 'company', 'department', 'employee'], at: 'panel:working-hours',
      note: 'Every person, every day: in, lunch, out, hours, and every punch behind them.' }),
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
  R('deductions', 'Salary deductions', 'payroll', 'ready',
    { filters: ['month', 'company', 'department'], at: 'panel:deductions' }),
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
    { filters: ['company', 'department'], at: 'panel:leave-balance' }),
  R('leave-status', 'Leave application status', 'leave', 'ready',
    { filters: ['month', 'company', 'employee'], at: 'panel:leave-status' }),
  R('leave-lop', 'Unpaid leave / LOP', 'leave', 'ready',
    { filters: ['month', 'company', 'department'], at: 'panel:leave' }),
  R('leave-by-department', 'Department-wise leave summary', 'leave', 'ready',
    { filters: ['month', 'company', 'department'], at: 'panel:leave-by-department' }),
  R('leave-ledger', 'Employee leave ledger', 'leave', 'ready',
    { filters: ['employee'], at: 'tab:leave',
      note: 'Leave → a name opens their ledger: opening, credits, every day taken, closing.' }),
  R('leave-bonus-register', 'Leave bonus register', 'leave', 'ready',
    { filters: ['company'], at: 'tab:leave',
      note: 'The contract\u2019s yearly bonus: each person\u2019s leaves month by month, their slab, the bonus and where it was paid. Paid from Leave \u2192 Bonus.' }),
  R('leave-year-end', 'Carry forward and lapsed leave', 'leave', 'ready',
    { filters: ['company'], at: 'tab:leave',
      note: 'Leave → Year end. Preview first; posting writes two entries per carried line.' }),

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
  /* "auto appraisal list for proper in uniform whole month, discipline, time,
     attendance, target" - the month's own records against five criteria. It
     raises no appraisal and rates nobody; it is what to read before one. */
  R('appraisal-sheet', 'Monthly appraisal sheet', 'employee', 'ready',
    { filters: ['month', 'company', 'department'], at: 'panel:appraisal-sheet' }),
  R('employee-contacts', 'Staff contact list', 'employee', 'ready',
    { filters: ['company', 'department', 'search'], at: 'panel:employee-contacts' }),
  R('employee-master', 'Employee master register', 'employee', 'ready',
    { filters: ['company', 'department', 'search'], at: 'file:employees' }),
  R('employee-active', 'Active employee list', 'employee', 'ready',
    { filters: ['company', 'department', 'search'], at: 'file:employees' }),
  R('employee-left', 'Resigned employee list', 'employee', 'partial',
    { filters: ['range', 'company'], note: 'Exits and leaving dates are recorded. No list with dates and reasons.' }),
  R('employee-joined', 'New joining report', 'employee', 'partial',
    { filters: ['range', 'company', 'department'], at: 'tab:dashboard',
      note: 'The dashboard names this month’s joiners. No range, no export.' }),
  R('employee-documents', 'Employee document status', 'employee', 'ready',
    { filters: ['company', 'department'], at: 'panel:documents',
      note: 'Every person against every KYC document: on file, checked, rejected, expired or missing.' }),
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
  R('loan-settled', 'Loan settlement report', 'loans', 'ready',
    { filters: ['month', 'company'], at: 'panel:loan-settled' }),

  /* ---- G. Assets ---- */
  R('asset-register', 'Asset register', 'assets', 'ready', { filters: ['company', 'search'], at: 'file:asset-register' }),
  R('asset-allocation', 'Employee-wise asset allocation', 'assets', 'ready',
    { filters: ['company', 'employee'], at: 'file:asset-register',
      note: 'The register carries who holds what; the Assets tab shows it as a board.' }),
  R('asset-handovers', 'Asset handover and return', 'assets', 'ready',
    { filters: ['range', 'company', 'employee'], at: 'file:asset-handovers' }),
  R('asset-verification', 'Asset verification', 'assets', 'partial',
    { filters: ['company'], at: 'tab:assets',
      note: 'Stock take works and keeps “not checked” apart from “not found”. No export of a round.' }),
  R('asset-maintenance', 'Asset maintenance', 'assets', 'ready', { filters: ['range', 'company'], at: 'file:asset-services' }),
  R('asset-cost', 'Asset service cost', 'assets', 'ready', { filters: ['company'], at: 'file:asset-cost' }),
  R('asset-damaged', 'Damaged or missing assets', 'assets', 'partial',
    { filters: ['company'], note: 'Needs a damage or loss reason on the asset, so a missing laptop can be told from a broken one.' }),

  /* ---- Hiring. Not in the specification, but the module exists and its
     reports were reachable only from inside the Hiring tab. ---- */
  R('hiring-pipeline', 'Pipeline — every application', 'hiring', 'ready',
    { filters: ['company', 'search'], at: 'file:pipeline', phase: 2 }),
  R('hiring-candidates', 'Candidate list', 'hiring', 'ready',
    { filters: ['company', 'search'], at: 'file:candidates', phase: 2,
      note: 'Says whether a CV is on file, never what is in it.' }),
  R('hiring-openings', 'Openings and how they are filling', 'hiring', 'partial',
    { filters: ['company'], at: 'tab:hiring', phase: 2,
      note: 'On the Hiring tab — seats, applied, joined. No export yet.' }),

  /* ---- H. Management ---- */
  R('cost-employee', 'Monthly employee cost', 'mis', 'partial',
    { filters: ['month', 'company', 'department'],
      note: 'The employer side — PF with EPS, EDLI and admin, and ESI — is calculated, so real CTC is available but never reported.' }),
  R('cost-company', 'Company-wise salary cost', 'mis', 'ready', { filters: ['month'], at: 'panel:totals' }),
  R('cost-department', 'Department-wise salary cost', 'mis', 'ready',
    { filters: ['month', 'company', 'department'], at: 'panel:cost-department' }),
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


/**
 * One line on each report's card, saying what it answers. A report with a
 * `note` already has one; these are the rest. A card whose only text is its
 * category's hint reads as seventy copies of one card.
 */
export const ABOUT = {
  'attendance-register': 'Every person against every day of the month, with present, absent, leave and hours.',
  'missing-punch': 'Days somebody was at work but the clock has only an arrival, only a departure, or nothing.',
  'sunday-register': 'Who worked which Sunday, the day rate and the amount — paid apart from the salary.',
  'attendance-approvals': 'Corrections, leave and remote-work requests waiting for a decision, and what was decided.',
  'salary-register': 'The month’s salary sheet as a register: earned, every deduction and the net, per person.',
  'unpaid-salary': 'Whose salary for the month is not marked paid yet, and how much.',
  deductions: 'Every deduction head — PF, ESI, PT, loans, penalties, the Deduct box — and how many people each touched.',
  'payroll-by-company': 'Gross, deductions, net and Sunday pay for the month, one line per company.',
  'leave-month': 'Leave taken this month by each person, by type.',
  'leave-balance': 'What each person is entitled to, has taken and has left this year.',
  'leave-status': 'Every leave application, whose move it is now, and for how long.',
  'leave-lop': 'Unpaid leave and loss of pay for the month, per person.',
  'leave-by-department': 'Leave taken this month, added up by department, against the headcount.',
  'pf-register': 'EPF wages, employee and employer shares and EPS, for everybody PF is deducted for.',
  'esi-register': 'ESI wages and both shares, for everybody under the ESI limit.',
  'pt-register': 'Professional tax deducted, added up per company.',
  'wage-register': 'The statutory wage register: everybody paid this month, every earning and deduction.',
  'appraisal-sheet': 'The month’s scores per person — uniform, discipline, time, attendance and target.',
  'employee-contacts': 'Name, department, role, mobile and email — nothing private, so it can be printed.',
  'employee-master': 'Everybody ever on the staff list, with their record’s main fields.',
  'employee-active': 'Everybody on the staff list today, leavers left out.',
  'loan-settled': 'Loans recovered in full during the year, and those still running.',
  'asset-register': 'Every asset with its code, holder, status, cost and warranty.',
  'asset-handovers': 'Every time an asset changed hands or came back, in date order.',
  'asset-maintenance': 'Every service and repair, its cost and the next one due.',
  'asset-cost': 'What each asset has cost to buy and to keep — and which cost more to keep.',
  'hiring-pipeline': 'Every application and the stage it has reached.',
  'cost-company': 'Net paid and cost to the company, one line per company.',
  'cost-department': 'Net paid and cost to the company, one line per department.',
  'attendance-percent': 'Days attended against days expected, per person, for the month.',
  'late-summary': 'Who came late this month, how often and by how much in all.',
  'payroll-comparison': 'This month’s payroll against the months before it.',
};

/** What a report's card says: its own line, else its note, else its category's hint. */
export const aboutOf = (report) =>
  ABOUT[report?.id] || report?.note || CATEGORIES.find((c) => c.key === report?.category)?.hint || '';

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
