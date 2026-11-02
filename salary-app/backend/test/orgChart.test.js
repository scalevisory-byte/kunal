import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bulkManagerPlan,
  departmentGroups,
  departmentManagerPlan,
  orgChart,
  wouldLoop,
} from '../../shared/orgChart.js';

/*
 * The reporting line.
 *
 * A chart's whole job is to be trusted at a glance, so what these pin is the
 * three ways one lies: by hanging, by quietly dropping somebody, and by
 * burying the real hierarchy under everybody nobody has placed yet.
 */

const TEAM = [
  { id: 1, name: 'VAIBHAV GUPTA', designation: 'Director' },
  { id: 2, name: 'ALPESH SHUKLA', reports_to_id: 1 },
  { id: 3, name: 'ARQAM SAIYED', reports_to_id: 1 },
  { id: 4, name: 'ABDULHAK BHENSWALA', reports_to_id: 2 },
  { id: 5, name: 'HARSHAL BADLAWALA', reports_to_id: 3 },
  { id: 6, name: 'ANCHAL TIWARI', reports_to_id: 5 },
  { id: 7, name: 'AAA UNPLACED' },
];

const shape = (chart) => chart.rows.map((r) => '  '.repeat(r.depth) + r.name);

test('it draws the line, and counts what is under somebody as well as beside them', () => {
  const chart = orgChart(TEAM);
  assert.deepEqual(shape(chart), [
    'VAIBHAV GUPTA',
    '  ALPESH SHUKLA',
    '    ABDULHAK BHENSWALA',
    '  ARQAM SAIYED',
    '    HARSHAL BADLAWALA',
    '      ANCHAL TIWARI',
    'AAA UNPLACED',
  ]);

  const top = chart.rows[0];
  // Two people answer to him; five are under him. Both get asked.
  assert.equal(top.reports, 2);
  assert.equal(top.below, 5);
  assert.equal(chart.deepest, 3);
  assert.equal(chart.managers, 4);
});

test('the real line leads, however the names sort', () => {
  // AAA UNPLACED sorts first by name and has nobody under him. Sorted by name
  // alone he led the chart and buried the hierarchy - accurate and useless.
  assert.equal(orgChart(TEAM).rows[0].name, 'VAIBHAV GUPTA');
  assert.equal(orgChart(TEAM).rows.at(-1).name, 'AAA UNPLACED');
});

test('a circle does not hang the page, and says who is in it', () => {
  // The record screen refuses to make one of these; a row edited straight in
  // the database could still carry one.
  const loop = [
    { id: 1, name: 'A', reports_to_id: 2 },
    { id: 2, name: 'B', reports_to_id: 1 },
    { id: 3, name: 'FINE' },
  ];
  const chart = orgChart(loop);
  assert.deepEqual(shape(chart), ['FINE'], 'the rest of the chart still draws');
  assert.deepEqual(chart.orphans.map((p) => p.name).sort(), ['A', 'B']);
});

test('somebody whose manager is not on the list is named, never dropped', () => {
  // Their manager left, or a company filter is hiding the line above them.
  // A chart that silently loses them looks complete when it is not.
  const chart = orgChart([
    { id: 1, name: 'ON THE LIST' },
    { id: 2, name: 'MANAGER ELSEWHERE', reports_to_id: 99 },
  ]);
  assert.deepEqual(shape(chart).sort(), ['MANAGER ELSEWHERE', 'ON THE LIST']);
  assert.equal(chart.orphans.length, 0, 'they are drawn as their own top, not lost');
});

test('nobody placed yet is not a hierarchy, and the count says so', () => {
  const chart = orgChart([{ id: 1, name: 'A' }, { id: 2, name: 'B' }]);
  assert.equal(chart.managers, 0);
  assert.equal(chart.unassigned, 2);
  assert.equal(chart.roots, 2);
});

test('a manager cannot be put under their own report', () => {
  assert.equal(wouldLoop(TEAM, 1, 6), true, 'the director under somebody three levels down');
  assert.equal(wouldLoop(TEAM, 1, 1), true, 'or under himself');
  assert.equal(wouldLoop(TEAM, 7, 1), false, 'but an unplaced person under the director is fine');
  assert.equal(wouldLoop(TEAM, 1, null), false, 'and taking a manager away is always allowed');
});

/*
 * Setting one manager over everybody ticked.
 *
 * The danger here is not arithmetic, it is a silent skip: tick seventy-four
 * people, choose a manager, and the two or three who cannot take one must be
 * named. Otherwise the chart looks finished and is not.
 */

const names = (list) => list.map((p) => p.name);

test('it sets the people it can and names every one it will not', () => {
  // Everybody under the director, with the director himself ticked too.
  const plan = bulkManagerPlan(TEAM, [1, 2, 3, 4, 7], 1);
  assert.deepEqual(names(plan.setting), ['ABDULHAK BHENSWALA', 'AAA UNPLACED']);
  assert.deepEqual(names(plan.self), ['VAIBHAV GUPTA'], 'the manager cannot report to himself');
  assert.deepEqual(names(plan.already), ['ALPESH SHUKLA', 'ARQAM SAIYED'], 'already there');
  assert.deepEqual(names(plan.replacing), ['ABDULHAK BHENSWALA'], 'had a different manager');
  assert.equal(plan.manager.name, 'VAIBHAV GUPTA');
});

test('somebody the manager already reports to is refused, however far up the line', () => {
  // ANCHAL (6) is three levels under the director. Making the director report
  // to ANCHAL would close the circle.
  const plan = bulkManagerPlan(TEAM, [1, 3, 7], 6);
  assert.deepEqual(names(plan.circular), ['VAIBHAV GUPTA', 'ARQAM SAIYED']);
  assert.deepEqual(names(plan.setting), ['AAA UNPLACED']);
});

test('taking the manager away can never loop, and only touches people who had one', () => {
  const plan = bulkManagerPlan(TEAM, [1, 2, 6, 7], null);
  assert.equal(plan.clearing, true);
  assert.deepEqual(names(plan.setting), ['ALPESH SHUKLA', 'ANCHAL TIWARI']);
  assert.deepEqual(names(plan.already), ['VAIBHAV GUPTA', 'AAA UNPLACED'], 'had none to take');
  assert.deepEqual(plan.circular, []);
  assert.deepEqual(plan.self, []);
});

test('the plan it reports is the plan it would run - nothing is left over', () => {
  const ids = [1, 2, 3, 4, 5, 6, 7];
  const plan = bulkManagerPlan(TEAM, ids, 2);
  const accounted =
    plan.setting.length + plan.already.length + plan.self.length + plan.circular.length;
  assert.equal(accounted, ids.length, 'every ticked person is in exactly one bucket');
  // And what it says it will set, the server will accept.
  for (const person of plan.setting) {
    assert.equal(wouldLoop(TEAM, person.id, 2), false, person.name);
  }
});

test('a manager who is not on the list is said so, not set', () => {
  const plan = bulkManagerPlan(TEAM, [1, 7], 999);
  assert.equal(plan.missing, true);
  assert.deepEqual(plan.setting, [], 'nothing is set against somebody who is not there');
});

test('the same person ticked twice is counted once', () => {
  const plan = bulkManagerPlan(TEAM, [7, 7, 7], 1);
  assert.equal(plan.setting.length, 1);
});

/*
 * A manager per department.
 *
 * The thing to pin is that a department is planned by the same rules as a
 * ticked list - the head keeps their own manager, a loop is still refused -
 * and that a department nobody chose for is left completely alone.
 */

const STAFF = [
  { id: 1, name: 'VAIBHAV GUPTA', department: '' },
  { id: 2, name: 'ALPESH SHUKLA', department: 'Accounts', reports_to_id: 1 },
  { id: 3, name: 'ASHOK MISHRA', department: 'Accounts' },
  { id: 4, name: 'ABDULHAK BHENSWALA', department: 'Accounts', reports_to_id: 3 },
  { id: 5, name: 'ARQAM SAIYED', department: 'Operations', reports_to_id: 1 },
  { id: 6, name: 'AXAY DHADUK', department: 'Operations' },
  { id: 7, name: 'NOBODY SAID', department: '' },
];

test('departments group with the unset ones kept last, never hidden', () => {
  const groups = departmentGroups(STAFF);
  assert.deepEqual(
    groups.map((g) => [g.name || '(none)', g.count]),
    [['Accounts', 3], ['Operations', 2], ['(none)', 2]]
  );
  // Somebody already managing inside the department is offered as its head.
  assert.deepEqual(groups[0].inside.map((p) => p.name), ['ASHOK MISHRA']);
});

test('one manager per department, each department judged on its own', () => {
  const plan = departmentManagerPlan(STAFF, { Accounts: 2, Operations: 5 });
  assert.equal(plan.departments, 2);

  const accounts = plan.rows.find((r) => r.department === 'Accounts');
  assert.deepEqual(names(accounts.plan.setting), ['ASHOK MISHRA', 'ABDULHAK BHENSWALA']);
  assert.deepEqual(names(accounts.plan.self), ['ALPESH SHUKLA'], 'the head keeps VAIBHAV');
  assert.deepEqual(names(accounts.plan.replacing), ['ABDULHAK BHENSWALA']);

  const ops = plan.rows.find((r) => r.department === 'Operations');
  assert.deepEqual(names(ops.plan.setting), ['AXAY DHADUK']);

  assert.equal(plan.setting, 3);
  assert.equal(plan.leaving, 2, 'the two heads themselves');
});

test('a department nobody chose for is not touched - blank is not "no manager"', () => {
  const plan = departmentManagerPlan(STAFF, { Accounts: 2, Operations: '', '': null });
  assert.deepEqual(plan.rows.map((r) => r.department), ['Accounts']);
  assert.equal(plan.setting, 2);
});

test('setting a department under somebody who reports into it is refused by name', () => {
  // ABDULHAK (4) is under ASHOK (3), who is in Accounts. Making all of
  // Accounts report to ABDULHAK would close a circle on ASHOK.
  const plan = departmentManagerPlan(STAFF, { Accounts: 4 });
  const accounts = plan.rows[0];
  assert.deepEqual(names(accounts.plan.circular), ['ASHOK MISHRA']);
  assert.deepEqual(names(accounts.plan.self), ['ABDULHAK BHENSWALA']);
  assert.deepEqual(names(accounts.plan.setting), ['ALPESH SHUKLA']);
});

test('the people with no department are a group like any other, same rules', () => {
  const plan = departmentManagerPlan(STAFF, { '': 5 });
  const none = plan.rows[0];
  assert.equal(none.department, '');
  assert.deepEqual(names(none.plan.setting), ['NOBODY SAID']);
  // ARQAM already reports to VAIBHAV, so the director is left where he is -
  // the loop check does not care that this group has no name.
  assert.deepEqual(names(none.plan.circular), ['VAIBHAV GUPTA']);
});
