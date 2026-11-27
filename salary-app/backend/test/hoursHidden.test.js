/**
 * The salary sheet's Hours columns, put away.
 *
 * HR, with a crop of Month hrs / OT min / OT Rs: "ye salary sheet me se hi
 * remove nai kr skte ?". They can be hidden. What may never happen is that
 * hiding a column hides MONEY - so whatever the hours are worth in the net is
 * still said, and nothing about the calculation changes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculateRow } from '../../shared/calc.js';
import { chargedPhrase, hoursMoney } from '../../shared/hoursDecision.js';

const read = (file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
const bare = (src) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('what the hours are worth is read off the payslip’s own figure, the two sides apart', () => {
  const money = hoursMoney([
    { calc: { ot_salary: -300 } },
    { calc: { ot_salary: -110 } },
    { calc: { ot_salary: 458 } },
    { calc: { ot_salary: 0 } },
    { calc: {} },
  ]);
  assert.deepEqual(money, { chargedDeducted: 410, chargedDeductedPeople: 2, chargedPaid: 458, chargedPaidPeople: 1, any: true });
  // The same phrase the bar uses, so one fact is never worded two ways.
  assert.equal(chargedPhrase(money, (n) => `Rs ${n}`), 'Rs 410 deducted from 2 people and Rs 458 paid to 1 person');
  assert.equal(hoursMoney([{ calc: { ot_salary: 0 } }]).any, false);
  assert.equal(hoursMoney([]).any, false);
});

test('a figure typed on a days-only month is money too, and is seen', () => {
  // `hoursDecision` only counts money where the month's RULE charges. A typed
  // OT min on a month paid from the days alone is still in the net.
  const period = { year: 2026, month: 11, hours_per_day: 9, late_policy: 'none', pt_threshold: 12000, pt_amount: 200 };
  const row = { salary: 26000, ot_minutes_override: -300 };
  const calc = calculateRow(row, period, {});
  assert.ok(calc.ot_salary < 0, 'the typed figure really is charged');
  const money = hoursMoney([{ row, calc }]);
  assert.equal(money.any, true);
  assert.equal(money.chargedDeducted, -calc.ot_salary);
});

test('the columns are hidden by a class on this one table, and every cell of the group carries it', () => {
  const sheet = bare(read('../../frontend/src/components/SalarySheet.jsx'));
  assert.match(sheet, /sheet numbered\$\{hideHours \? ' hide-hours' : ''\}/);
  // Band, three heads, three body cells, three foot cells: ten in all. One
  // missed and a row is a column out from its header.
  assert.equal((sheet.match(/hrs-col/g) || []).length, 10);
  const css = read('../../frontend/src/styles.css');
  assert.match(css, /table\.sheet\.hide-hours \.hrs-col \{ display: none; \}/);
  assert.ok(!/\.hrs-col \{ display: none/.test(css.replace(/table\.sheet\.hide-hours \.hrs-col \{ display: none; \}/, '')),
    'never hidden anywhere else');
});

test('hiding a column never hides money, and never hides the way to stop a rule that charges', () => {
  const sheet = bare(read('../../frontend/src/components/SalarySheet.jsx'));
  assert.match(sheet, /hoursMoney\(calcs\)/);
  const hidden = sheet.slice(sheet.indexOf('hours-hidden'), sheet.indexOf("The month&rsquo;s hours"));
  assert.match(hidden, /chargedPhrase\(hoursInNet, inRupees\)/, 'the money is named with the shared phrase');
  assert.match(hidden, /still in the net below/);
  assert.match(hidden, /chooseHours\(false\)/, 'the way back is on the line');
  // A month whose rule charges keeps its bar: it holds the stop button.
  assert.match(sheet, /decision\.anything && \(!hideHours \|\| decision\.charging\)/);
});

test('it is this browser’s choice, and a private window cannot take the sheet down', () => {
  const sheet = read('../../frontend/src/components/SalarySheet.jsx');
  const at = sheet.indexOf("localStorage.getItem('salary-sheet-hide-hours')");
  assert.ok(at > 0);
  assert.match(sheet.slice(at - 80, at), /try \{/);
  const set = sheet.indexOf("localStorage.setItem('salary-sheet-hide-hours'");
  assert.match(sheet.slice(set - 60, set), /try \{/);
  // Nothing about the hours is sent anywhere by the toggle.
  const choose = sheet.slice(sheet.indexOf('const chooseHours'), sheet.indexOf('const chooseHours') + 400);
  assert.ok(!/onPatch|api\./.test(choose), 'the toggle writes to no row and no month');
});
