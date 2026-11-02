import test from 'node:test';
import assert from 'node:assert/strict';
import { orgChart, wouldLoop } from '../../shared/orgChart.js';

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
