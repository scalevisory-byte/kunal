import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRow } from '../../shared/calc.js';
import { CSV_COLUMNS, statutoryReport, toCsv } from '../../shared/statutory.js';

/** A month, calculated the way buildPayroll would hand it over. */
function month(people) {
  const period = { id: 1, year: 2026, month: 4, label: 'April 2026', hours_per_day: 9 };
  return {
    period,
    rows: people.map((p) => ({
      ...p,
      employee_name: p.employee_name,
      company_name: p.company_name || 'BNF PVT LTD',
      ...calculateRow(p, period, {}),
    })),
  };
}

test('PF caps the wages at the ceiling and keeps the deduction that was made', () => {
  const report = statutoryReport(
    month([
      { employee_name: 'High Earner', salary: 60000, pf: 1800, uan: '100200300400' },
      { employee_name: 'Low Earner', salary: 12000, pf: 1440, uan: '100200300401' },
      { employee_name: 'No PF', salary: 20000, pf: 0 },
    ])
  );

  assert.equal(report.pf.rows.length, 2, 'only the two with PF');

  const high = report.pf.rows[0];
  assert.equal(high.gross_wages, 60000);
  assert.equal(high.epf_wages, 15000, 'capped at the ceiling');
  assert.equal(high.employee_share, 1800, 'what was actually deducted, not 12% of 60,000');
  assert.equal(high.pension_share, 1250, '8.33% of 15,000');
  assert.equal(high.employer_share, 550, '12% of 15,000 less the pension share');

  const low = report.pf.rows[1];
  assert.equal(low.epf_wages, 12000, 'under the ceiling, so the real wage');
  assert.equal(low.employee_share, 1440);
});

test('PF names anyone without a UAN, because the return cannot go up without one', () => {
  const report = statutoryReport(month([{ employee_name: 'No UAN', salary: 20000, pf: 1800 }]));
  assert.equal(report.pf.missing, 1);
  assert.deepEqual(report.pf.rows[0].missing, ['UAN']);
  assert.equal(report.pf.rows[0].uan, '');
});

test('ESI covers the ones under the wage limit and flags the ones over it', () => {
  const report = statutoryReport(
    month([
      { employee_name: 'Covered', salary: 15000, esi: 113, esic_no: '3100123456' },
      { employee_name: 'Over Limit', salary: 30000, esi: 0, esic_no: '3100123457' },
      { employee_name: 'Not On ESI', salary: 20000, esi: 0 },
    ])
  );

  assert.equal(report.esi.rows.length, 1, 'the one under the limit with a deduction');
  const row = report.esi.rows[0];
  assert.equal(row.wages, 15000);
  assert.equal(row.employee_share, 113, 'the deduction that was actually made');
  assert.equal(row.employer_share, 488, '3.25% of 15,000');
  assert.equal(report.esi.overLimit, 0);
});

test('PT is summed per company, and those under the slab are counted apart', () => {
  const report = statutoryReport(
    month([
      { employee_name: 'A', salary: 20000, company_name: 'BNF' },
      { employee_name: 'B', salary: 30000, company_name: 'BNF' },
      { employee_name: 'C', salary: 25000, company_name: 'SCALE' },
      { employee_name: 'D', salary: 11000, company_name: 'SCALE' },
    ])
  );

  assert.equal(report.pt.total, 600, 'three over the slab at 200 each');
  assert.equal(report.pt.exempt, 1);
  assert.deepEqual(report.pt.byCompany, [
    { company: 'BNF', count: 2, amount: 400 },
    { company: 'SCALE', count: 1, amount: 200 },
  ]);
});

test('the wage register adds the deductions up and balances against the payable', () => {
  const report = statutoryReport(
    month([
      {
        employee_name: 'Someone',
        employee_code: 'BNF001',
        designation: 'Manager',
        salary: 26000,
        absent_days_override: 1,
        pf: 1800,
        esi: 0,
        loan_deduction: 500,
        sundays_override: 1,
      },
    ])
  );

  const row = report.wages[0];
  assert.equal(row.sr, 1);
  assert.equal(row.code, 'BNF001');
  assert.equal(row.gross, 25000, '26,000 less one day');
  assert.equal(row.deductions, 200 + 1800 + 500);
  assert.equal(row.net, row.gross - row.deductions, 'the register balances');
  assert.equal(row.sunday, 1000);
  assert.equal(row.payable, row.net + row.sunday);
});

test('every register turns into a CSV with its own columns', () => {
  const report = statutoryReport(
    month([{ employee_name: 'Someone', salary: 20000, pf: 1800, uan: '100200300400' }])
  );

  const pf = toCsv(CSV_COLUMNS.pf, report.pf.rows);
  assert.match(pf, /UAN,Member Name,Gross Wages/);
  assert.match(pf, /100200300400,Someone/);

  const wages = toCsv(CSV_COLUMNS.wages, report.wages);
  assert.match(wages, /Sr,Employee,Code/);

  // A name with a comma in it must not break the row.
  const tricky = toCsv(CSV_COLUMNS.pt, [{ name: 'Patel, Rakesh', company: 'BNF', gross: 1, pt: 200 }]);
  assert.match(tricky, /"Patel, Rakesh"/);
});
