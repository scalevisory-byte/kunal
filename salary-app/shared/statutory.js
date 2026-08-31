/**
 * The statutory registers: PF, ESI, professional tax, and the wage register.
 *
 * Everything here is derived from the month that has already been calculated
 * plus the identifiers on each employee's record - nothing is entered twice.
 *
 * A warning worth keeping in mind: the EPFO and ESIC upload formats change from
 * time to time, and the exact columns differ by portal version. What these
 * produce are the standard fields, correctly worked out, in a spreadsheet you
 * can check. Compare a file against the portal's own template before uploading
 * it, rather than trusting it blind.
 */

const round0 = (n) => Math.round(Number(n) || 0);

export const PF_DEFAULTS = {
  // The wage ceiling PF is worked out on, and the split between the pension
  // fund and the provident fund.
  wageCeiling: 15000,
  employeeRate: 12,
  employerRate: 12,
  pensionRate: 8.33,
};

export const ESI_DEFAULTS = {
  // ESI applies below this monthly wage; above it, the person is out of scope.
  wageLimit: 21000,
  employeeRate: 0.75,
  employerRate: 3.25,
};

/**
 * PF for the month, one row per employee who has any.
 *
 * Somebody counts as covered if they carry a UAN or had PF deducted. Wages are
 * capped at the ceiling; the employee's own contribution is whatever was
 * actually deducted, so a fixed 1,800 stays 1,800 rather than being recomputed.
 */
export function pfRegister(rows, settings = {}) {
  const { wageCeiling, employerRate, pensionRate } = { ...PF_DEFAULTS, ...settings };

  return rows
    .filter((row) => row.pf > 0 || row.uan)
    .map((row) => {
      const gross = round0(row.gross_salary);
      const pfWages = Math.min(gross, wageCeiling);
      const employee = round0(row.pf);
      const employer = round0((pfWages * employerRate) / 100);
      const pension = round0((pfWages * pensionRate) / 100);
      return {
        uan: row.uan || '',
        name: row.employee_name,
        company: row.company_name,
        gross_wages: gross,
        epf_wages: pfWages,
        eps_wages: pfWages,
        edli_wages: pfWages,
        employee_share: employee,
        employer_share: Math.max(0, employer - pension),
        pension_share: pension,
        // Days not worked and not paid for - what the EPFO calls NCP days.
        ncp_days: row.absent_days,
        missing: [!row.uan && 'UAN'].filter(Boolean),
      };
    });
}

/**
 * ESI for the month. Only people under the wage limit are in it, which is why
 * somebody can drop out of the register after a rise.
 */
export function esiRegister(rows, settings = {}) {
  const { wageLimit, employeeRate, employerRate } = { ...ESI_DEFAULTS, ...settings };

  return rows
    .filter((row) => row.esi > 0 || (row.esic_no && row.gross_salary <= wageLimit))
    .map((row) => {
      const wages = round0(row.gross_salary);
      const employee = row.esi > 0 ? round0(row.esi) : round0((wages * employeeRate) / 100);
      return {
        ip_number: row.esic_no || '',
        name: row.employee_name,
        company: row.company_name,
        days_paid: row.present_days,
        wages,
        employee_share: employee,
        employer_share: round0((wages * employerRate) / 100),
        over_limit: wages > wageLimit,
        missing: [!row.esic_no && 'ESIC number'].filter(Boolean),
      };
    });
}

/** Professional tax, which is a flat amount per person over the slab. */
export function ptRegister(rows) {
  const paying = rows.filter((row) => row.pt > 0);
  const byCompany = new Map();
  for (const row of paying) {
    const entry = byCompany.get(row.company_name) || { company: row.company_name, count: 0, amount: 0 };
    entry.count++;
    entry.amount += row.pt;
    byCompany.set(row.company_name, entry);
  }
  return {
    rows: paying.map((row) => ({
      name: row.employee_name,
      company: row.company_name,
      gross: round0(row.gross_salary),
      pt: row.pt,
    })),
    byCompany: [...byCompany.values()].sort((a, b) => a.company.localeCompare(b.company)),
    total: paying.reduce((sum, row) => sum + row.pt, 0),
    exempt: rows.length - paying.length,
  };
}

/**
 * The wage register - the muster roll a labour inspector asks for. Every
 * employee, what they were due, what came off, and what they were paid.
 */
export function wageRegister(rows) {
  return rows.map((row, index) => ({
    sr: index + 1,
    name: row.employee_name,
    company: row.company_name,
    designation: row.designation || '',
    code: row.employee_code || '',
    working_days: row.working_days,
    present_days: row.present_days,
    absent_days: row.absent_days,
    salary: round0(row.salary),
    // A wage register reads as "earned, less deductions", so the manual
    // deduction is added back into what was earned and then listed with the
    // others. Elsewhere in the app the gross is already net of it - here the
    // two forms have to agree, and net = gross - deductions either way.
    gross: round0(row.gross_salary) + round0(row.deduction),
    pt: row.pt,
    esi: round0(row.esi),
    pf: round0(row.pf),
    loan: round0(row.loan_deduction),
    other_deduction: round0(row.deduction),
    deductions:
      row.pt + round0(row.esi) + round0(row.pf) + round0(row.loan_deduction) + round0(row.deduction),
    net: round0(row.net_salary),
    sunday: round0(row.sunday_salary),
    payable: round0(row.final_payable),
    mode: row.payment_mode || '',
  }));
}

/** All four, plus what is missing before any of them can be filed. */
export function statutoryReport(payroll, settings = {}) {
  const rows = payroll.rows;
  const pf = pfRegister(rows, settings.pf);
  const esi = esiRegister(rows, settings.esi);
  const pt = ptRegister(rows);

  return {
    period: payroll.period,
    pf: {
      rows: pf,
      total_employee: pf.reduce((s, r) => s + r.employee_share, 0),
      total_employer: pf.reduce((s, r) => s + r.employer_share + r.pension_share, 0),
      missing: pf.filter((r) => r.missing.length).length,
    },
    esi: {
      rows: esi,
      total_employee: esi.reduce((s, r) => s + r.employee_share, 0),
      total_employer: esi.reduce((s, r) => s + r.employer_share, 0),
      missing: esi.filter((r) => r.missing.length).length,
      overLimit: esi.filter((r) => r.over_limit).length,
    },
    pt,
    wages: wageRegister(rows),
  };
}

/** Turns any of the registers into a CSV. */
export function toCsv(columns, rows) {
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(([label]) => label).join(',')];
  for (const row of rows) lines.push(columns.map(([, key]) => escape(row[key])).join(','));
  return `﻿${lines.join('\n')}\n`;
}

export const CSV_COLUMNS = {
  pf: [
    ['UAN', 'uan'], ['Member Name', 'name'], ['Gross Wages', 'gross_wages'],
    ['EPF Wages', 'epf_wages'], ['EPS Wages', 'eps_wages'], ['EDLI Wages', 'edli_wages'],
    ['EPF Contribution (employee)', 'employee_share'],
    ['EPS Contribution', 'pension_share'],
    ['EPF Contribution (employer)', 'employer_share'],
    ['NCP Days', 'ncp_days'], ['Company', 'company'],
  ],
  esi: [
    ['IP Number', 'ip_number'], ['IP Name', 'name'], ['No of Days Paid', 'days_paid'],
    ['Total Monthly Wages', 'wages'], ['Employee Contribution', 'employee_share'],
    ['Employer Contribution', 'employer_share'], ['Company', 'company'],
  ],
  pt: [['Employee', 'name'], ['Company', 'company'], ['Gross', 'gross'], ['PT', 'pt']],
  wages: [
    ['Sr', 'sr'], ['Employee', 'name'], ['Code', 'code'], ['Company', 'company'],
    ['Designation', 'designation'], ['Working Days', 'working_days'],
    ['Present', 'present_days'], ['Absent', 'absent_days'], ['Salary', 'salary'],
    ['Gross', 'gross'], ['PT', 'pt'], ['ESI', 'esi'], ['PF', 'pf'], ['Loan', 'loan'],
    ['Other Deduction', 'other_deduction'], ['Total Deductions', 'deductions'], ['Net', 'net'], ['Sunday', 'sunday'],
    ['Net Payable', 'payable'], ['Paid By', 'mode'],
  ],
};
