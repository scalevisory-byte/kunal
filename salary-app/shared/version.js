/**
 * What version this is, and what changed in each one.
 *
 * Dinesh: *"version no and history bhi do jisse pata chale ki kya naya aaya
 * he"*. The build stamp beside the title already said WHICH FILE he had — it
 * could never say what was in it, so a feature that had shipped read as
 * missing more than once.
 *
 * Two different questions, so two different answers, and both are shown:
 *
 *   **The version** says which release this is. It is written by hand,
 *   because "is this a small fix or a new module" is a judgement and not
 *   something a build script can work out.
 *
 *   **The build stamp** says which copy of that release you are looking at.
 *   Two people can hold the same version built at different minutes, and when
 *   an update does not seem to have taken, that is the figure that settles it.
 *
 * The entries are written for the office, not for the code: what somebody can
 * now do that they could not before. Anything that moved money says so.
 */

export const VERSION = '1.7.0';

/** Newest first. The first entry is what `VERSION` names. */
export const CHANGELOG = [
  {
    version: '1.7.0',
    date: '15 Nov 2026',
    title: 'Hiring: screening, interview forms, tests and the offer letter',
    items: [
      '**Screening** — a tab of its own. Mark somebody Eligible, On hold or Not eligible, with the reason. A hold keeps them exactly where they are; a rejection has to say why, because that is what the rejection report counts.',
      'Beside each name, how they measure against what the opening asked for — age, experience, expected salary, skills. **It is advice, not a gate**: you can take somebody who misses every line of it.',
      'Somebody who told us nothing shows a dash, never a cross. Nobody asked, so nothing failed.',
      'The screening list is **oldest first**, so a merely good candidate from three weeks ago is not left at the bottom until they take another job.',
      '**A candidate can be put forward for an opening from their own record** — the picker is on their card, where you are already standing.',
      '**The physical interview form**: who they are, qualifications, experience, languages, computer knowledge, ten questions, salary and joining, address and references. No ratings — it records what was said.',
      'A date of birth or an address corrected during an interview is corrected **on their record**, not just on that form. Three rounds cannot produce three addresses.',
      '**The interviewer’s evaluation** is a separate form: ten things rated 1–5 with remarks, practical knowledge, strengths and concerns, a recommendation and what should happen next.',
      'The score counts **what you rated, not all ten** — rating three is 12 out of 15, not 12 out of 50 — and nothing anywhere uses the score to decide.',
      '**A recommendation is not a selection.** Submitting an evaluation sends the paperwork to HR or management and moves the candidate nowhere. Only an approval moves anybody, and approving is an Admin’s.',
      'Every round keeps its own form and its own evaluation. Nothing is overwritten, and the whole history is on the candidate’s record.',
      '**Tests of our own** — a question bank by position, and papers that say how many to draw from each. Every candidate gets a **different selection, in a different order, with the options shuffled**.',
      'The candidate sits it from a link on their phone. Timer, auto-submit when the time runs out, and the score works itself out. **The right answer never reaches their browser.**',
      'A question you leave blank costs you nothing extra — negative marking is there to discourage guessing, not to punish an honest blank.',
      'The ZYNTA test is untouched. An opening uses its own link or draws from the bank.',
      '**The offer letter** — one self-contained file per person, opens on any phone with no login, prints to PDF.',
      '**There is no letter until somebody has approved the offer**, and approving is an Admin’s. An approved offer is locked: changing it means withdrawing it.',
      'Approving tells the candidate nothing — only marking it sent moves them to Offer Sent. A decline is recorded as a decline, so “we turned them down” and “they turned us down” never get counted as the same thing.',
    ],
  },
  {
    version: '1.6.0',
    date: '14 Nov 2026',
    title: 'Logins, leave approvals and working from home',
    items: [
      'A new sign-in screen, with show/hide password and "remember me". Nothing about how signing in works has changed.',
      'Staff can apply to **work from home**. It is paid in full and uses no leave.',
      'A **manager approves their own team** from their own login — and the office then confirms it. Nothing reaches attendance until the office has.',
      'A manager sees only their own team: names and what they asked for, never salaries.',
      'Rejecting ends it there. A refusal costs nothing and does not need confirming twice.',
      'Staff can now take back a request from their own login, until the office approves it.',
      'The dashboard line saying people are waiting now opens the approvals queue, instead of the People tab.',
      'The Approve button no longer sits off the edge of the screen on a laptop.',
      'Searchable **Help** inside the app, and this list.',
    ],
  },
  {
    version: '1.5.0',
    date: '14 Nov 2026',
    title: 'Live on the web, Excel in and out, and the eSSL file',
    items: [
      'The HRMS is reachable at its own address over the internet, on its own tunnel.',
      'Reads the **eSSL "Basic Work Duration"** export, clock times and all. A day the machine has no record of is named, not written through as absence.',
      'Fixed: a day the clock calls a half day but the machine marked present was paid in full. **This was costing real money** — 149 hours in one fortnight.',
      'The **staff list** out to Excel and back, as one file, for bulk updates.',
      'The **month’s attendance** out to Excel and back.',
      'The lunch break can be recorded without being deducted.',
      'Every setting in one place under Settings, including the usual day and what it adds up to.',
      'The build stamp carries the time, not just the date.',
    ],
  },
  {
    version: '1.4.0',
    date: '13 Nov 2026',
    title: 'The dashboard rebuilt, and the asset register finished',
    items: [
      'The dashboard opens on a daily roll call: who is in, who is out, who is late, who is on overtime.',
      'A day-by-day attendance trend, and attendance by department.',
      'The morning register gained code, department, hours, search, sort and a file.',
      'Four "needs attention" lines were being worked out and never shown. They are on the page now.',
      'Two dashboard figures were simply wrong and are corrected.',
      'Assets: a way in for "add an asset", somewhere to type the AMC, and a stock take that fits on screen.',
    ],
  },
  {
    version: '1.3.0',
    date: '1 Nov 2026',
    title: 'A real HRMS: logins, people registers, assets, hiring',
    items: [
      '**Real logins** with three office roles — Admin, HR, Viewer — and a login for every employee.',
      'Staff can see their own pay, attendance and payslip, and apply for leave.',
      '**Punching from a phone**, with a location fence, and corrections that need approving.',
      '**Salary structure** — Basic, HRA, conveyance, medical. It never changes what anybody is paid.',
      'PF, ESI and PT **worked out from the rules** rather than typed. Nothing switches itself on.',
      'Warnings and appreciations, appraisals, expense claims, staff tasks, a helpdesk, exits and full-and-final.',
      'The **asset register**: codes, printable labels, handovers, a stock take, and maintenance.',
      'Late in and early out, with a 300-minute monthly concession that can be priced before it is switched on.',
      'Weekly off (alternate Saturdays included) and sandwich leave.',
      'Hiring moved inside the HRMS — a person who joins becomes an employee without being typed twice.',
      'Reporting manager, employee documents and KYC, and a change history on every record.',
      'A per-employee report: one person down the months.',
      'An absent/present report, and a joining checklist for new staff.',
    ],
  },
  {
    version: '1.2.0',
    date: '7 Oct 2026',
    title: 'The monthly report pack',
    items: [
      'The three sheets that actually go out each month, in the office’s own layout: bank, cash, and Sunday + festival.',
      'Checked against the real September files — every row matches on gross and net.',
      'The grids were made to look like a spreadsheet: gridlines, row numbers, and the cell IS the input.',
    ],
  },
  {
    version: '1.1.0',
    date: '1 Sep 2026',
    title: 'Hours, and the first dashboard',
    items: [
      'The **Time tab**: in, lunch out, lunch in, out — and the hours become money through the same column the sheet already paid from.',
      'A dashboard, with the month’s figures and what needs attention.',
      'New joinees, birthdays and work anniversaries.',
      'Festivals know which religion they belong to, so a festival never silently applies to nobody.',
    ],
  },
  {
    version: '1.0.0',
    date: '31 Aug 2026',
    title: 'The salary sheet, as software',
    items: [
      'The April sheet’s calculation, column by column, so the app and the sheet cannot disagree.',
      'Attendance by name rather than by code, with paid and unpaid leave added.',
      'Short hours by the minute, per day.',
      '26 working days every month, fixed.',
      'Sunday pay in its own register, settled apart from the month.',
      'Festival holidays that are paid for some staff and a working day for others.',
      'Leave balances, loans and advances, and the PF/ESI/PT registers.',
      'Imports the sheet and exports it back; also builds as one file that runs with no server at all.',
    ],
  },
];

/** The entry `VERSION` names, for the line at the top of the panel. */
export const CURRENT = CHANGELOG[0];

/**
 * Everything newer than the version somebody last looked at.
 *
 * Used for the "new" dot. An unknown or missing `seen` means they have never
 * opened the panel, which is NOT the same as having seen everything — so it
 * returns the lot rather than nothing.
 */
export function since(seen) {
  if (!seen) return CHANGELOG;
  const at = CHANGELOG.findIndex((entry) => entry.version === seen);
  return at < 0 ? CHANGELOG : CHANGELOG.slice(0, at);
}

/** Is there anything they have not read? */
export const hasNews = (seen) => since(seen).length > 0;
