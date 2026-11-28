/**
 * v2.41.0, the People redesign: renamed sections, same keys; the add button
 * opens the one joining form; the status filter sees an open exit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../../frontend/src/${p}`, import.meta.url), 'utf8');
const people = read('components/people/People.jsx');

test('the sections are renamed, and every old key still opens its panel', () => {
  for (const [key, label] of [
    ['records', 'Employee Records'], ['appraisals', 'Performance Reviews'], ['claims', 'Claims & Expenses'],
    ['penalties', 'Disciplinary'], ['helpdesk', 'Helpdesk'], ['noticeboard', 'Noticeboard'],
    ['leaving', 'Exit Management'], ['reminders', 'Reminders'], ['trail', 'Activity Log'],
  ]) {
    assert.ok(people.includes(`['${key}', '${label}'`), `${label} is missing`);
    assert.match(people, new RegExp(`panel === '${key}'`), `${key} no longer renders its panel`);
  }
});

test('Add employee opens the SAME joining form on Employees, never a second one', () => {
  const app = read('App.jsx');
  assert.match(app, /onAddEmployee=\{\(\) => \{\s*setOpenEmployee\('new'\)/);
  const employees = read('components/Employees.jsx');
  assert.match(employees, /if \(openFor === 'new'\) setAdding\(true\)/);
  assert.ok(!/EmployeeForm/.test(people), 'People must not grow its own joining form');
});

test('the status a person is filtered by includes an open exit', () => {
  assert.match(people, /statusOf\(e, exits\.get\(e\.id\)\)/);
});
