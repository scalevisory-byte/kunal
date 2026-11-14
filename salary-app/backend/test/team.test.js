import test from 'node:test';
import assert from 'node:assert/strict';
import { TEAM_FIELDS, directReports, forTeam, isManager, mayDecideFor } from '../../shared/team.js';

const STAFF = [
  { id: 1, name: 'Dinesh Parmar', reports_to_id: null, monthly_salary: 200000, pan: 'ABCDE1234F' },
  { id: 2, name: 'Alpesh Shah', reports_to_id: 1, designation: 'Accounts head', department: 'Accounts', monthly_salary: 60000, pan: 'AAAAA1111A' },
  { id: 3, name: 'Amit Shah', reports_to_id: 2, designation: 'Accountant', department: 'Accounts', monthly_salary: 26000, bank_account: '123456' },
  { id: 4, name: 'Priya Nair', reports_to_id: 2, department: 'Accounts', monthly_salary: 24000 },
  { id: 5, name: 'Rahul Jain', reports_to_id: 3, monthly_salary: 18000 },
  { id: 6, name: 'Nobody Ltd', reports_to_id: null, monthly_salary: 15000 },
];

test('a manager has their DIRECT reports, and nobody else', () => {
  assert.deepEqual(directReports(STAFF, 2).map((p) => p.name), ['Amit Shah', 'Priya Nair']);

  /*
   * Rahul reports to Amit, who reports to Alpesh. Alpesh must NOT get him:
   * approving your report's report's leave steps over the person whose job it
   * is to know, and on a chart four deep it quietly makes the top manager the
   * approver for the whole company.
   */
  assert.ok(!directReports(STAFF, 2).some((p) => p.name === 'Rahul Jain'));

  assert.deepEqual(directReports(STAFF, 1).map((p) => p.name), ['Alpesh Shah']);
  assert.deepEqual(directReports(STAFF, 6), []);
  assert.equal(isManager(STAFF, 2), true);
  assert.equal(isManager(STAFF, 6), false);

  // No id at all is not "everybody".
  assert.deepEqual(directReports(STAFF, null), []);
  assert.deepEqual(directReports(STAFF, 0), []);
  assert.deepEqual(directReports(STAFF, undefined), []);
});

test('somebody is never their own report, whatever the row says', () => {
  // `wouldLoop` refuses to store this, but a row written before it existed
  // must not turn into the right to approve yourself.
  const bent = [{ id: 9, name: 'Loop', reports_to_id: 9 }];
  assert.deepEqual(directReports(bent, 9), []);
  assert.equal(isManager(bent, 9), false);
});

test('a manager sees a name and a job, never a salary', () => {
  const amit = forTeam(STAFF[2]);
  assert.deepEqual(Object.keys(amit).sort(), [...TEAM_FIELDS].sort());
  for (const secret of ['monthly_salary', 'pan', 'bank_account', 'reports_to_id']) {
    assert.ok(!(secret in amit), `${secret} reached a manager`);
  }
  assert.equal(amit.name, 'Amit Shah');
  assert.equal(amit.designation, 'Accountant');
  // A field they simply do not have reads as null, not undefined - the page
  // renders it either way, but the shape is the same for everybody.
  assert.equal(forTeam(STAFF[3]).designation, null);
});

test('a manager may decide only for their own team', () => {
  const reports = new Set(directReports(STAFF, 2).map((p) => p.id));
  const ask = (employee_id) => ({ id: 11, employee_id, kind: 'leave' });

  assert.equal(mayDecideFor(ask(3), { managerId: 2, reportIds: reports }).ok, true);
  assert.equal(mayDecideFor(ask(4), { managerId: 2, reportIds: reports }).ok, true);

  // Somebody else's report.
  const other = mayDecideFor(ask(5), { managerId: 2, reportIds: reports });
  assert.equal(other.ok, false);
  assert.match(other.reason, /do not report to you/);

  // Their own manager.
  assert.equal(mayDecideFor(ask(1), { managerId: 2, reportIds: reports }).ok, false);

  // Nobody at all.
  assert.equal(mayDecideFor(ask(3), { managerId: null, reportIds: reports }).ok, false);
  assert.equal(mayDecideFor(null, { managerId: 2, reportIds: reports }).ok, false);
});

test('nobody approves their own time off', () => {
  /*
   * Checked BEFORE the team list, so a corrupt row that somehow put somebody
   * in their own team could never become the way in.
   */
  const own = mayDecideFor({ employee_id: 2 }, { managerId: 2, reportIds: new Set([2, 3, 4]) });
  assert.equal(own.ok, false);
  assert.match(own.reason, /your own request/);
});

test('reportIds may arrive as a list or a set, and strings are numbers', () => {
  const ask = { employee_id: 3 };
  assert.equal(mayDecideFor(ask, { managerId: 2, reportIds: [3, 4] }).ok, true);
  assert.equal(mayDecideFor(ask, { managerId: '2', reportIds: ['3', '4'] }).ok, true);
  assert.equal(mayDecideFor({ employee_id: '3' }, { managerId: 2, reportIds: new Set([3]) }).ok, true);
});
