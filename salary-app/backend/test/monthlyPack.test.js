import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { calculateRow } from '../../shared/calc.js';
import {
  buildMonthlyPack,
  festivalDays,
  gridMark,
  packLabel,
  sundayDays,
} from '../../shared/monthlyPack.js';

const PERIOD = { id: 1, year: 2026, month: 9, label: 'September 2026', hours_per_day: 9,
  pt_threshold: 12000, pt_amount: 200 };

/** A month shaped the way buildPayroll hands it over. */
function month(people, holidays = []) {
  return {
    payroll: {
      period: PERIOD,
      rows: people.map((p) => ({ ...p, ...calculateRow(p, PERIOD, p.attendance || {}) })),
    },
    holidays,
  };
}

const sheetOf = (wb, name) => wb.getWorksheet(name);
const headerOf = (ws) => ws.getRow(1).values.filter(Boolean).map(String);
const columnOf = (ws, head) => {
  const row = ws.getRow(1);
  for (let c = 1; c <= row.cellCount; c++) if (row.getCell(c).value === head) return c;
  throw new Error(`no ${head} column on ${ws.name}`);
};

test('the pack is his three sheets, named his way', async () => {
  assert.equal(packLabel(PERIOD), 'Sep-26');
  const { payroll, holidays } = month([
    { employee_name: 'Bank Person', company_name: 'BOOKNFLY', salary: 24150, payment_mode: 'Bank' },
    { employee_name: 'Cash Person', company_name: 'SCALE', salary: 16600, payment_mode: 'Cash' },
  ]);
  const wb = await buildMonthlyPack(ExcelJS, payroll, { holidays });
  assert.deepEqual(wb.worksheets.map((s) => s.name), [
    'Sep-26',
    'Sep-26 CASH',
    'Sep-26 Sunday + Festival',
  ]);

  // Cash goes on the cash sheet and nowhere else.
  const names = (ws) => ws.getColumn(2).values.filter(Boolean).map(String);
  assert.ok(names(sheetOf(wb, 'Sep-26')).includes('Bank Person'));
  assert.ok(!names(sheetOf(wb, 'Sep-26')).includes('Cash Person'));
  assert.ok(names(sheetOf(wb, 'Sep-26 CASH')).includes('Cash Person'));
});

test('the salary sheet carries his columns, in his order', async () => {
  const { payroll } = month([{ employee_name: 'A', company_name: 'X', salary: 10000 }]);
  const wb = await buildMonthlyPack(ExcelJS, payroll, {});
  const head = headerOf(sheetOf(wb, 'Sep-26'));
  // September has 30 days, so the calc block starts after Company, Name and 30 dates.
  assert.deepEqual(head.slice(32), [
    'Working Days', 'Present Days', 'Absent Days', 'Paid Holiday', 'Net Days', 'Salary',
    'Salary / Day', 'Gross Salary', 'OT / LT', 'Addition', 'Deduction', 'PT', 'ESI', 'PF',
    'Net Salary', 'Payment Mode', 'Status',
  ]);
  assert.equal(head[0], 'Company');
  assert.equal(head[1], 'Name');
  assert.equal(head[2], '1');
  assert.equal(head[31], '30');
});

test("the app's marks come out in his vocabulary", () => {
  assert.equal(gridMark('P'), 'P');
  assert.equal(gridMark('WH'), 'P', 'work from home is a day worked');
  assert.equal(gridMark('A'), 'A');
  assert.equal(gridMark('UL'), 'A', 'unpaid leave costs a day, like absence');
  assert.equal(gridMark('HF'), 'HF');
  assert.equal(gridMark('AD'), 'AD');
  assert.equal(gridMark('S'), 'W/O');
  assert.equal(gridMark('PH'), 'H/O');
  assert.equal(gridMark(''), '');
  // Paid leave keeps its own code: his absent formula only looks for A and HF,
  // so it counts as present without being relabelled "holiday".
  for (const code of ['CL', 'SL', 'PL']) assert.equal(gridMark(code), code);
  // A Sunday or festival that was worked is paid on the third sheet, so the
  // main grid must NOT show it as present or it would be paid twice.
  assert.equal(gridMark('SP', { sunday: true }), 'W/O');
  assert.equal(gridMark('HP'), 'H/O');
  assert.equal(gridMark({ code: 'A', minutes: -30 }), 'A', 'the stored shape works too');
});

test('a day worked on a Sunday is paid once, on the register, never on the grid', async () => {
  // Sunday the 6th worked, and nothing else.
  const attendance = {};
  for (let d = 1; d <= 30; d++) attendance[d] = { code: [6, 13, 20, 27].includes(d) ? 'S' : 'P' };
  attendance[6] = { code: 'SP' };

  const { payroll } = month([
    { employee_name: 'Worked Sunday', company_name: 'X', salary: 26000, payment_mode: 'Bank' },
  ].map((p) => ({ ...p, attendance })));
  const wb = await buildMonthlyPack(ExcelJS, payroll, {});

  const main = sheetOf(wb, 'Sep-26');
  assert.equal(main.getRow(3).getCell(2 + 6).value, 'W/O', 'the grid shows the Sunday as off');

  const reg = sheetOf(wb, 'Sep-26 Sunday + Festival');
  assert.equal(reg.getRow(3).getCell(2).value, 'Worked Sunday', 'and the register has them');
  assert.equal(reg.getRow(3).getCell(3).value, 'P', 'marked worked on the 6th');
  assert.equal(reg.getRow(3).getCell(4).value, 'W/O', 'and off on the 13th');
});

test('the Sunday register has a column per Sunday and per festival day', async () => {
  const holidays = [
    { id: 1, day: 5, name: 'Janmashtami', code: 'PH' },
    { id: 2, day: 25, name: 'Ganesh Visarjan', code: 'PH' },
  ];
  assert.deepEqual(festivalDays(holidays), [5, 25]);
  assert.deepEqual(sundayDays(PERIOD), [6, 13, 20, 27]);

  const attendance = { 25: { code: 'HP' } };
  const { payroll } = month(
    [{ employee_name: 'Worked Ganesh', company_name: 'X', salary: 26000, attendance }],
    holidays
  );
  const wb = await buildMonthlyPack(ExcelJS, payroll, { holidays });
  const ws = sheetOf(wb, 'Sep-26 Sunday + Festival');

  assert.deepEqual(headerOf(ws), [
    'Company Name', 'Employee Name', '6', '13', '20', '27', '5', '25',
    'Total Sunday', 'Festival Paid Leave', 'Salary', 'Salary / Day',
    'Sunday Salary', 'Festival Salary', 'Net Amount', 'Remark',
  ]);
  assert.equal(ws.getRow(2).getCell(3).value, 'Sun', 'the weekday row under each date');
  assert.equal(ws.getRow(2).getCell(7).value, 'Sat', '5 September 2026 is a Saturday');

  const row = ws.getRow(3);
  assert.equal(row.getCell(2).value, 'Worked Ganesh');
  assert.equal(row.getCell(columnOf(ws, '25')).value, 'H/O', 'worked the festival, owed a day');
  assert.equal(row.getCell(columnOf(ws, '5')).value, '', 'did not work the other one');
});

test('somebody owed only an arrear is still on the register', async () => {
  // His own sheet carries one: no Sunday, no festival, "Aug Differ.. = 2363".
  const { payroll } = month([
    { employee_name: 'Arrear Only', company_name: 'X', salary: 17500, sunday_salary_override: 2363 },
  ]);
  const wb = await buildMonthlyPack(ExcelJS, payroll, {});
  const ws = sheetOf(wb, 'Sep-26 Sunday + Festival');
  assert.equal(ws.getRow(3).getCell(2).value, 'Arrear Only');
  assert.equal(ws.getRow(3).getCell(columnOf(ws, 'Sunday Salary')).value, 2363);
});

test('only people owed something are on the register', async () => {
  const holidays = [{ id: 1, day: 25, name: 'Ganesh Visarjan', code: 'PH' }];
  const { payroll } = month(
    [
      { employee_name: 'Owed', company_name: 'X', salary: 26000, attendance: { 6: { code: 'SP' } } },
      { employee_name: 'Nothing Owed', company_name: 'X', salary: 26000, attendance: { 25: { code: 'PH' } } },
    ],
    holidays
  );
  const wb = await buildMonthlyPack(ExcelJS, payroll, { holidays });
  const names = sheetOf(wb, 'Sep-26 Sunday + Festival').getColumn(2).values.filter(Boolean).map(String);
  assert.ok(names.includes('Owed'));
  assert.ok(
    !names.includes('Nothing Owed'),
    'a festival simply taken off costs nothing and is already in the monthly salary'
  );
});

test('the figures are live formulas, so he can still edit in Excel', async () => {
  const { payroll } = month([{ employee_name: 'A', company_name: 'X', salary: 15000 }]);
  const wb = await buildMonthlyPack(ExcelJS, payroll, {});
  const ws = sheetOf(wb, 'Sep-26');
  const row = ws.getRow(3);
  const f = (head) => row.getCell(columnOf(ws, head)).value?.formula || '';

  assert.match(f('Absent Days'), /COUNTIF\(C3:AF3,"A"\)/);
  assert.match(f('Absent Days'), /COUNTIF\(C3:AF3,"AD"\)\*2/, 'a two-day absence is weighed');
  assert.match(f('Paid Holiday'), /COUNTIF\(C3:AF3,"H\/O"\)/);
  assert.match(f('Present Days'), /AG3-AI3/);
  assert.match(f('Salary \/ Day'), /AL3\/AG3/);
  assert.match(f('Gross Salary'), /ROUND\(AK3\*AM3,0\)/);
  // His sheet is IF(gross - deduction > 12000, ...); with OT and Addition at
  // zero, which is the normal month, this is the same test.
  assert.match(f('PT'), /IF\(AN3\+AO3\+AP3-AQ3>12000,200,0\)/, 'PT on what the month pays');
  assert.match(f('Net Salary'), /AN3\+AO3\+AP3-AQ3-AR3-AS3-AT3/);

  const totalRow = ws.getRow(4);
  assert.match(String(totalRow.getCell(2).value), /TOTAL/);
  assert.match(totalRow.getCell(columnOf(ws, 'Salary')).value.formula, /SUM\(AL3:AL3\)/);
});

test('an empty month still produces all three sheets without a broken SUM', async () => {
  const { payroll } = month([]);
  const wb = await buildMonthlyPack(ExcelJS, payroll, {});
  assert.equal(wb.worksheets.length, 3);
  for (const ws of wb.worksheets) {
    const total = ws.getRow(3);
    assert.match(String(total.getCell(2).value), /TOTAL/);
    for (let c = 1; c <= total.cellCount; c++) {
      const v = total.getCell(c).value;
      assert.ok(!v?.formula, 'nothing to sum, so no formula pointing at nothing');
    }
  }
});

test('Gross is the pay for days worked, before the deduction - as his sheet has it', async () => {
  // Checked against his real September sheets: with Gross read this way, all
  // 85 rows across "Sep-26" and "Sep-26 CASH" reproduce his gross AND his net
  // exactly. Putting the deduction inside Gross instead - which is where the
  // app's own calculateRow keeps it - was out by the deduction on every row
  // that had one.
  const attendance = {};
  for (let d = 1; d <= 30; d++) attendance[d] = { code: [6, 13, 20, 27].includes(d) ? 'S' : 'P' };
  attendance[2] = { code: 'A' };

  const { payroll } = month([
    { employee_name: 'Docked', company_name: 'X', salary: 15000, deduction: 2000, attendance },
  ]);
  const wb = await buildMonthlyPack(ExcelJS, payroll, {});
  const ws = sheetOf(wb, 'Sep-26');
  const row = ws.getRow(3);
  const at = (head) => row.getCell(columnOf(ws, head)).value;

  assert.equal(at('Salary'), 15000);
  assert.equal(at('Deduction'), 2000, 'the deduction stands in its own column');
  // 25 of 26 days at 576.92 = 14,423 - the deduction is NOT in here.
  assert.match(at('Gross Salary').formula, /ROUND\(AK3\*AM3,0\)/);
  assert.equal(
    Math.round(payroll.rows[0].gross_after_absent),
    14423,
    'which is what that formula comes to'
  );
  // ...and it comes off in the Net, with PT charged on what is left.
  assert.match(at('Net Salary').formula, /-AQ3/);
  assert.match(at('PT').formula, /-AQ3>12000/);
});

test('a typed Sunday amount beats the formula, which is how an arrear gets on', async () => {
  // His own register carries a row with no Sundays and no festival at all -
  // "Aug Differ.. = 2363" - so the amount has to be able to come from a typed
  // figure rather than from days times the day rate.
  const { payroll } = month([
    {
      employee_name: 'Owed From August',
      company_name: 'X',
      salary: 17500,
      sunday_salary_override: 2363,
      remark: 'Aug difference',
    },
  ]);
  const wb = await buildMonthlyPack(ExcelJS, payroll, {});
  const ws = sheetOf(wb, 'Sep-26 Sunday + Festival');
  const row = ws.getRow(3);
  assert.equal(row.getCell(2).value, 'Owed From August', 'they are on the register at all');
  assert.equal(row.getCell(columnOf(ws, 'Sunday Salary')).value, 2363, 'the typed amount');
  assert.equal(row.getCell(columnOf(ws, 'Remark')).value, 'Aug difference');
});
