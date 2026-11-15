/**
 * How an interview goes, in order.
 *
 * Dinesh asked for the process as simple steps, shown in its own tab. The list
 * lives here rather than in the markup so the strip on screen and the Help
 * topic cannot drift from each other - and so a step added to the app has one
 * place to be written down.
 *
 * Each step says WHERE it is done, because "screen the candidate" is useless
 * to somebody who cannot find the button. `where` is the tab; `how` is the
 * click.
 *
 * `note` is the thing about that step that is NOT obvious - mostly what it
 * does not do. Those are the sentences that cost a bug each to learn.
 */
export const HIRING_STEPS = [
  {
    n: 1,
    title: 'Put them on an opening',
    where: 'Candidates',
    how: 'Open their name → “Put forward for an opening”',
    note: 'The same person can be right for one opening and wrong for another, so everything after this hangs off the opening, not the person.',
  },
  {
    n: 2,
    title: 'Screen them',
    where: 'Screening',
    how: 'Eligible, On hold or Not eligible — also on the candidate list',
    note: 'The report beside them is advice, not a gate: you can take somebody who misses every line of it. A hold keeps them exactly where they are.',
  },
  {
    n: 3,
    title: 'Book the interview',
    where: 'Candidates → open the stage',
    how: 'Move → Interview, then fill in the date, round and interviewer',
    note: 'Each round is its own booking, and each keeps its own form and evaluation.',
  },
  {
    n: 4,
    title: 'Send them the form',
    where: 'Interviews',
    how: '“Send form” → send the link on WhatsApp',
    note: 'They fill in their own particulars before they arrive, so you are not typing it with them sitting opposite. They cannot see or change any decision.',
  },
  {
    n: 5,
    title: 'Set them a test, if the job needs one',
    where: 'Candidates → open the stage',
    how: '“Send an in-house test” → choose a paper',
    note: 'Every candidate gets a different set of questions and it marks itself.',
  },
  {
    n: 6,
    title: 'Interview them',
    where: 'Interviews',
    how: '“Read what they sent” to see their details, then “Evaluate”',
    note: 'The evaluation is where ratings, strengths and the recommendation go. The particulars form carries no verdict — it was filled in before you met them.',
  },
  {
    n: 7,
    title: 'HR, the department head and management decide',
    where: 'Interviews → Evaluate',
    how: 'Submit → HR → department head → Management → Approve',
    note: 'The department head is optional — HR can send it straight to management. Submitting an evaluation moves the paperwork, never the candidate. Only an approval moves anybody, and approving is an Admin’s. There are no department-head logins, so their name is typed: the app records who it went to, it does not police who clicks.',
  },
  {
    n: 8,
    title: 'Make the offer',
    where: 'Candidates → open the stage',
    how: 'Offer card → fill it in → an Admin approves → download the letter → “Mark as sent”',
    note: 'There is no letter at all until somebody has approved it, and approving tells the candidate nothing — only marking it sent does.',
  },
  {
    n: 9,
    title: 'Put them on the payroll',
    where: 'Candidates → open the stage',
    how: '“They accepted”, then Add to payroll',
    note: 'They become an employee with the salary that was approved, and land on the salary sheet and the attendance grid without being typed in again.',
  },
];

/** The one-line version, for a strip that has to fit across a screen. */
export const stepTitles = () => HIRING_STEPS.map((s) => `${s.n}. ${s.title}`);
