/*
 * FOUR REPORTS, FOUR REGISTERS — not one register four times.
 *
 * Found by auditing the Reports tab. Reports lists PF register, ESI
 * register, Professional tax register and Wage register as four separate
 * entries, and every one of them rendered `<Statutory period={period} />`,
 * whose own tab state starts at `pf`. So all four opened on Provident Fund.
 *
 * WHY THAT IS NOT MERELY UNTIDY. The PF register deliberately carries only
 * the people PF is deducted for. On the audited month that is seven names
 * out of twenty — so somebody opening the **wage register** was shown a
 * third of the staff with nothing saying the rest were missing, and a wage
 * register that understates the wages actually paid is the one thing it
 * exists not to do. The panel's own Download follows the tab as well, so
 * pressing it there handed over the PF CSV.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { statutoryReport } from '../../shared/statutory.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const noComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const reports = noComments(read('frontend/src/components/Reports.jsx'));
const panel = read('frontend/src/components/Statutory.jsx');

/** Which register each catalogue entry must open on. */
const OPENS_ON = {
  'pf-register': 'pf',
  'esi-register': 'esi',
  'pt-register': 'pt',
  'wage-register': 'wages',
};

test('EACH REPORT OPENS ON ITS OWN REGISTER', () => {
  for (const [id, key] of Object.entries(OPENS_ON)) {
    const line = new RegExp(`'${id}': \\(\\) => <Statutory period=\\{period\\} show="${key}" />`);
    assert.match(reports, line, `${id} does not open on ${key}`);
  }
});

test('and no two of them open on the same one', () => {
  const keys = Object.values(OPENS_ON);
  assert.equal(new Set(keys).size, keys.length);
});

test('every tab the panel offers is reachable from the tree, and no other', () => {
  /*
   * Built from the panel's own TABS, so adding a fifth register without a
   * report to open it — or pointing a report at a tab that does not exist —
   * fails here rather than silently landing somebody on Provident Fund.
   */
  const tabs = [...panel.matchAll(/\['(\w+)', '[^']+'\]/g)].map((m) => m[1]);
  assert.deepEqual(tabs, ['pf', 'esi', 'pt', 'wages'], 'the TABS list moved');
  assert.deepEqual(new Set(Object.values(OPENS_ON)), new Set(tabs));
});

test('THE PANEL FOLLOWS A CHANGE OF REPORT, not just the first render', () => {
  /*
   * React keeps this component mounted when the report id changes - the
   * element type is the same - so initial state alone would leave it on
   * whichever register was opened last.
   */
  const live = noComments(panel);
  assert.match(live, /export default function Statutory\(\{ period, show = 'pf' \}\)/);
  assert.match(live, /useEffect\(\(\) => \{\s*setWhich\(KNOWN\.has\(show\) \? show : 'pf'\);\s*\}, \[show\]\)/);
});

test('an unknown register falls back rather than rendering nothing', () => {
  const live = noComments(panel);
  const uses = live.match(/KNOWN\.has\(show\) \? show : 'pf'/g) || [];
  assert.equal(uses.length, 2, 'the guard is not on both the initial state and the effect');
});

test('the download follows the tab on screen', () => {
  /* Which is right once the tab is right - and was the second half of the
     bug while it was not. */
  assert.match(panel, /statutory\/\$\{which\}\.csv/);
});

/* ================================================================= *
 * why it mattered
 * ================================================================= */

const money = (n) => ({ salary: n, gross_salary: n, net_salary: n });

test('THE WAGE REGISTER CARRIES EVERYBODY; THE PF REGISTER DOES NOT', () => {
  const rows = [
    { employee_id: 1, employee_name: 'Covered', company_name: 'BNF', pf: 1800, uan: '1', ...money(22250) },
    { employee_id: 2, employee_name: 'No PF', company_name: 'BNF', pf: 0, uan: '', ...money(15000) },
    { employee_id: 3, employee_name: 'Also no PF', company_name: 'BNF', pf: 0, uan: '', ...money(12500) },
  ];
  const report = statutoryReport({ period: { year: 2026, month: 11 }, rows });

  assert.equal(report.pf.rows.length, 1, 'the PF register is not narrowed to the covered');
  assert.equal(report.wages.length, 3, 'the wage register has stopped listing everybody');
  /*
   * The gap is the whole reason the mix-up cost something: open the wage
   * register, be shown the PF one, and two of these three people are simply
   * not on the page.
   */
  assert.ok(report.wages.length > report.pf.rows.length);
});

/* ================================================================= *
 * the same shape one category over
 * ================================================================= */

test('THE ACTIVE EMPLOYEE LIST IS NARROWED TO THE ACTIVE', () => {
  /*
   * "Employee master register" and "Active employee list" fetched the same
   * unfiltered `/employees.csv`, so the active list carried leavers - under
   * a name that says it does not. The route has taken `?active=` all along.
   */
  assert.match(reports, /'employee-active': \['\/employees\.csv\?active=1',/);
  assert.match(reports, /'employee-master': \['\/employees\.csv',/);
});

test('and the two files are not both called Employees.csv', () => {
  /* Taking both left the second as "Employees (1).csv" with nothing on the
     name to say which was which. */
  const names = [...reports.matchAll(/'employee-(?:master|active)': \['[^']+', '([^']+)'\]/g)]
    .map((m) => m[1]);
  assert.equal(names.length, 2);
  assert.notEqual(names[0], names[1], `both downloads are called ${names[0]}`);
});
