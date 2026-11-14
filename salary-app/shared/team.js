/**
 * A manager's own team, and what they may decide about it.
 *
 * The office side already had approvals: HR opens Reports and works the queue.
 * This is the other half Dinesh asked for - the person who actually knows
 * whether Amit can be spared on Thursday deciding it from their own staff
 * login, instead of forwarding it to HR to type in.
 *
 * Every rule here is about WHOSE request it is. Whether a request can be
 * decided AT ALL - already decided, month locked - stays in `canDecide` in
 * attendanceRequests.js, and both are checked. Two places answering the same
 * question is how they come to disagree.
 *
 * The thing this file exists to keep true: **a manager gains no reading
 * rights.** The staff role carries no `read`, and nothing here adds one. A
 * manager sees the people who report to them by name and the requests those
 * people raised - not their salaries, not their payslips, and nobody else at
 * all. `TEAM_FIELDS` below is the whole of what travels.
 */

/**
 * What a manager may know about somebody who reports to them.
 *
 * Deliberately short. A manager approving leave needs to know who is asking
 * and what they do - not what they are paid, which bank they use, or what
 * their PAN is. There is a test asserting nothing else reaches the page.
 */
export const TEAM_FIELDS = ['id', 'name', 'code', 'designation', 'department'];

export const forTeam = (employee) =>
  employee &&
  TEAM_FIELDS.reduce((out, field) => {
    out[field] = employee[field] ?? null;
    return out;
  }, {});

/**
 * The people who report to this person, and only them.
 *
 * DIRECT reports, deliberately - not everybody underneath them in the chart.
 * Approving your report's report's leave steps over the person whose job it
 * is to know, and on a chart four deep it quietly makes the top manager the
 * approver for the whole company.
 *
 * Somebody is never their own report, whatever the data says: `wouldLoop`
 * refuses to store that, but a row written before it existed must not turn
 * into the right to approve yourself.
 */
export function directReports(employees = [], managerId) {
  const id = Number(managerId);
  if (!id) return [];
  return employees.filter(
    (e) => Number(e.reports_to_id) === id && Number(e.id) !== id
  );
}

/** Whether this person manages anybody at all - what shows the team tab. */
export const isManager = (employees = [], managerId) =>
  directReports(employees, managerId).length > 0;

/**
 * May this manager decide this request?
 *
 * `reportIds` is the set of their direct reports, worked out on the server
 * from the manager id on the LOGIN - never from anything the caller sent.
 */
export function mayDecideFor(request, { managerId, reportIds } = {}) {
  const manager = Number(managerId);
  const subject = Number(request?.employee_id);
  if (!request) return { ok: false, reason: 'no such request' };
  if (!manager) return { ok: false, reason: 'not a manager' };

  /*
   * Nobody approves their own time off, even if the chart somehow points at
   * itself. This is checked before the team list, so a corrupt row that put
   * somebody in their own team could never be the way in.
   */
  if (subject === manager) return { ok: false, reason: 'you cannot decide your own request' };

  const ids = reportIds instanceof Set ? reportIds : new Set((reportIds || []).map(Number));
  if (!ids.has(subject)) return { ok: false, reason: 'they do not report to you' };
  return { ok: true, reason: '' };
}
