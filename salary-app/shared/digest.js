/**
 * The day's digest: everything waiting on somebody, as text.
 *
 * Dinesh's list says "Notifications — WhatsApp, email and app reminders". This
 * module is the honest half of that: it works out *what* there is to say. It
 * does not send anything, and deliberately so —
 *
 *   - **WhatsApp** has no legitimate API for a personal number. Dinesh's other
 *     project already holds a linked WhatsApp Web session; the right shape is
 *     for that to fetch this text, not for this app to grow a second session
 *     and put his number at risk.
 *   - **Email** needs an SMTP account and a password, which is a decision about
 *     credentials, not code.
 *   - **App reminders** need push keys and a service worker, which the task
 *     assistant has and this app does not.
 *
 * So what ships is the text and an endpoint that returns it. Pasting it into
 * WhatsApp works today, and a cron that posts it anywhere works today. Claiming
 * to send it would be claiming plumbing that is not there.
 *
 * Dependency-free, like the rest of shared/.
 */

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const names = (list, limit = 4) => {
  const shown = list.slice(0, limit).join(', ');
  const rest = list.length - limit;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
};

/**
 * @param input {
 *   period            the open month
 *   rows              its calculated rows
 *   requests          pending attendance/leave requests
 *   claims            pending expense claims
 *   tickets           helpdesk tickets waiting on the office
 *   tasks             open staff tasks
 *   exits             exits with no settlement yet
 *   assets_out        assets out with people who have left
 *   today             ISO date, for the overdue reckoning
 * }
 * @returns {{ lines: string[], text: string, count: number }}
 *   count is how many things actually need doing - zero means say nothing.
 */
/** A date that many days on, as YYYY-MM-DD. */
function shift(day, days) {
  const at = new Date(`${String(day).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return String(day).slice(0, 10);
  at.setUTCDate(at.getUTCDate() + Number(days || 0));
  return at.toISOString().slice(0, 10);
}

export function digest(input = {}) {
  const {
    period = null,
    rows = [],
    requests = [],
    claims = [],
    tickets = [],
    tasks = [],
    exits = [],
    assets_out: assetsOut = [],
    /*
     * Three dates the office is supposed to remember and nobody does. They
     * arrive as plain lists so this module stays dependency-free and the
     * caller decides where they came from.
     */
    employees = [],
    documents = [],
    appraisals = [],
    /** How far ahead to look. A month, because that is the notice people need. */
    ahead = 30,
    today = new Date().toISOString().slice(0, 10),
  } = input;

  const lines = [];
  const items = [];
  let count = 0;

  /*
   * Each line carries a `kind`, so a caller can take only the part it needs.
   * The dashboard wants the queues waiting on a decision and NOT the payroll
   * lines, which its own "Needs attention" list already says - two cards
   * repeating each other is how a dashboard stops being read.
   */
  /*
   * `go` is the tab that can actually DO something about the line, and
   * `focus` the panel inside it. Without them every line on the dashboard
   * sent people to People - which is right for a claim, a ticket or a job,
   * and wrong for an attendance request, because the approvals queue is in
   * Reports. One line telling the office somebody applied for leave, and it
   * opened the wrong tab.
   */
  const add = (line, n = 1, kind = 'queue', go = 'people', focus = null) => {
    lines.push(line);
    items.push({ kind, text: line.replace(/^•\s*/, ''), go, ...(focus ? { focus } : {}) });
    count += n;
  };

  /* --- waiting on a decision --- */

  // Pending AND recommended: a manager backing one hands it to the office,
  // it does not settle it.
  const pendingRequests = requests.filter((r) => r.status === 'pending' || r.status === 'recommended');
  if (pendingRequests.length) {
    add(
      `• ${plural(pendingRequests.length, 'attendance request')} waiting: ${names(
        pendingRequests.map((r) => r.employee_name)
      )}`,
      1,
      'queue',
      // Leave applications, corrections and work-from-home all land here, and
      // the only screen that can approve one is in Reports.
      'reports',
      'approvals'
    );
  }

  const pendingClaims = claims.filter((c) => c.status === 'pending');
  if (pendingClaims.length) {
    const total = pendingClaims.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
    add(
      `• ${plural(pendingClaims.length, 'expense claim')} to approve, ₹${Math.round(
        total
      ).toLocaleString('en-IN')}: ${names(pendingClaims.map((c) => c.employee_name))}`
    );
  }

  const approved = claims.filter((c) => c.status === 'approved');
  if (approved.length) {
    const total = approved.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
    add(
      `• ${plural(approved.length, 'claim')} approved but not paid, ₹${Math.round(total).toLocaleString(
        'en-IN'
      )}`
    );
  }

  const waiting = tickets.filter((t) => t.waiting);
  if (waiting.length) {
    add(`• ${plural(waiting.length, 'question')} from staff unanswered: ${names(waiting.map((t) => t.employee_name))}`);
  }

  /* --- work --- */

  const overdue = tasks.filter((t) => t.status === 'open' && t.due_on && t.due_on < today);
  if (overdue.length) {
    add(`• ${plural(overdue.length, 'job')} past its date: ${names(overdue.map((t) => t.title))}`);
  }
  const dueToday = tasks.filter((t) => t.status === 'open' && t.due_on === today);
  if (dueToday.length) {
    add(`• ${plural(dueToday.length, 'job')} wanted today: ${names(dueToday.map((t) => t.title))}`);
  }

  /* --- dates nobody remembers --- */

  /*
   * A window, not a day: told the morning probation ends, there is nothing
   * left to decide. `soon` is today plus the notice period.
   */
  const soon = shift(today, ahead);

  const probation = employees.filter(
    (e) => e.active !== 0 && e.probation_until && e.probation_until >= today && e.probation_until <= soon
  );
  if (probation.length) {
    add(
      `• ${plural(probation.length, 'probation')} ending by ${soon}: ${names(probation.map((e) => e.name))}`,
      1,
      'dates'
    );
  }
  // Already past, and still nobody has confirmed them.
  const probationPast = employees.filter(
    (e) => e.active !== 0 && e.probation_until && e.probation_until < today
  );
  if (probationPast.length) {
    add(
      `• ${plural(probationPast.length, 'probation')} finished and not confirmed: ${names(
        probationPast.map((e) => e.name)
      )}`,
      1,
      'dates'
    );
  }

  const expiring = documents.filter((d) => d.expires_on && d.expires_on >= today && d.expires_on <= soon);
  if (expiring.length) {
    add(
      `• ${plural(expiring.length, 'document')} expiring by ${soon}: ${names(
        expiring.map((d) => `${d.employee_name || 'somebody'}'s ${d.kind || 'document'}`)
      )}`,
      1,
      'dates'
    );
  }
  const expired = documents.filter((d) => d.expires_on && d.expires_on < today);
  if (expired.length) {
    add(
      `• ${plural(expired.length, 'document')} already expired: ${names(
        expired.map((d) => `${d.employee_name || 'somebody'}'s ${d.kind || 'document'}`)
      )}`,
      1,
      'dates'
    );
  }

  // Due by the date the LAST review set. An appraisal nobody set a next date
  // on is not overdue - it is simply not scheduled, which is not a failing.
  const reviewsDue = appraisals.filter((a) => a.next_review_on && a.next_review_on <= soon);
  if (reviewsDue.length) {
    add(
      `• ${plural(reviewsDue.length, 'appraisal')} due by ${soon}: ${names(
        reviewsDue.map((a) => a.employee_name)
      )}`,
      1,
      'dates'
    );
  }

  /* --- the month --- */

  if (period && rows.length) {
    const unmarked = rows.filter((row) => !Object.keys(row.attendance || {}).length);
    if (unmarked.length === rows.length) {
      add(`• ${period.label}: nothing marked yet for anybody`, 1, 'payroll');
    } else if (unmarked.length) {
      add(`• ${period.label}: ${plural(unmarked.length, 'person', 'people')} with no attendance at all`, 1, 'payroll');
    }

    const unpaid = rows.filter((row) => String(row.status || '').toLowerCase() !== 'paid');
    if (unpaid.length) {
      const total = unpaid.reduce((sum, row) => sum + (Number(row.net_salary) || 0), 0);
      add(
        `• ${period.label}: ${plural(unpaid.length, 'salary', 'salaries')} unpaid, ₹${Math.round(
          total
        ).toLocaleString('en-IN')}`,
        1,
        'payroll'
      );
    }

    const missing = rows.filter((row) => !row.uan || !row.esic_no);
    if (missing.length) {
      add(`• ${plural(missing.length, 'person', 'people')} still without a UAN or ESIC number`, 0, 'payroll');
    }
  }

  /* --- people leaving --- */

  const unsettled = exits.filter((e) => !e.settled_on);
  if (unsettled.length) {
    add(
      `• ${plural(unsettled.length, 'full and final', 'full and finals')} not settled: ${names(
        unsettled.map((e) => e.employee_name)
      )}`
    );
  }
  if (assetsOut.length) {
    add(
      `• ${plural(assetsOut.length, 'asset')} still out with somebody who has left: ${names(
        assetsOut.map((a) => `${a.label} (${a.employee_name})`)
      )}`
    );
  }

  const heading = count
    ? `${plural(count, 'thing')} need${count === 1 ? 's' : ''} doing`
    : 'Nothing waiting';

  return {
    lines,
    items,
    count,
    // How many of them are queues waiting on a decision, which is what the
    // dashboard tile counts.
    waiting: items.filter((i) => i.kind === 'queue').length,
    heading,
    // Lines only, so a caller can put its own subject on it.
    text: lines.length ? lines.join('\n') : 'Nothing waiting.',
  };
}
