/**
 * The help inside the app.
 *
 * Dinesh: *"ek software k andar hi help ka option bana do jisme search karne
 * pe kisi bhi topic ki guidance mil jaye"*.
 *
 * Three rules this is written under:
 *
 *   **It says where the thing IS.** Half of what has been reported as missing
 *   in this app was never missing — it was below a fold or behind a link that
 *   did not look like one. So every topic names its tab, and the panel can
 *   open it.
 *
 *   **It names the trap.** The valuable half of knowing this app is knowing
 *   what it will NOT do: a pending request pays nobody, a stock take's "not
 *   checked" is not "missing", the machine's blank day is not an absence.
 *   Those are the `note` lines, and they are the reason this is hand-written
 *   rather than generated from the code.
 *
 *   **It is data, so it works offline.** No network, no server — the single
 *   file carries the same help the hosted one does. Topics that genuinely
 *   need the server say so in their own words.
 *
 * Keywords carry the Hinglish somebody would actually type (`chutti`,
 * `pagar`, `hajri`), because searching "chutti" and getting nothing is the
 * fastest way to decide a help screen is useless.
 */

/* eslint-disable max-len */

export const HELP = [
  {
    id: 'start-month',
    title: 'Starting a new month',
    tab: 'sheet',
    keywords: ['month', 'period', 'new month', 'open', 'mahina', 'naya mahina', 'start'],
    lines: [
      'Use **New month** on the line above the tabs. Everybody on the staff list gets a row in that month, with their current salary.',
      'Working days are fixed at 26 for every month. Hours a day and the PT slab are set per month, so changing them in November never rewrites October.',
      'Closing a month locks it: nothing can be written into it afterwards, including an approval.',
    ],
    note: 'Somebody added after a month is opened is picked up next time you open that month — their joining date decides whether they are paid for it.',
  },
  {
    id: 'attendance-marks',
    staff: true,
    title: 'Attendance marks and what each one costs',
    tab: 'attendance',
    keywords: ['mark', 'code', 'absent', 'present', 'half day', 'HF', 'HD', 'CL', 'SL', 'PL', 'UL', 'LWP', 'AD', 'WH', 'SP', 'HP', 'OD', 'WO', 'official duty', 'hajri', 'chutti', 'legend'],
    lines: [
      '**P** present · **A** absent, costs a day · **HF** half day (**HD**), costs half · **AD** absent, costs two days.',
      '**CL / SL / PL** casual, sick and privilege leave — paid in full and counted against the quota.',
      '**UL** unpaid leave (**LWP**) — costs a day like A, but counted separately so absences are not inflated.',
      '**WH** work from home — paid in full, and it is a day worked.',
      '**OD** official duty — a bank run, a client’s office, a day at a supplier. **Paid exactly like a present day.** Nobody is called late for it, nobody is asked about their uniform, and a punch from there is not flagged.',
      '**S** the weekly off (**WO**) · **SP** worked on the off day · **PH** paid holiday (**H**) · **HP** worked the holiday.',
      'SP and HP are paid through the Sunday register, not the salary sheet.',
    ],
    note: 'Click a day and pick the mark by NAME — each option says what it costs. Typing the code still works.\n\nWO, H, LWP and HD are the office’s names for S, PH, UL and HF — the SAME marks, not extra ones. Two names for one thing is how two things come to disagree.',
  },
  {
    id: 'my-record-fill',
    staff: true,
    title: 'Filling in your own record, and sending in your papers',
    tab: 'me',
    keywords: [
      'profile', 'my profile', 'my record', 'details', 'fill', 'form', 'joining form',
      'aadhaar', 'pan', 'uan', 'esic', 'bank', 'ifsc', 'document', 'documents', 'upload',
      'kagaz', 'kagzat', 'bharo', 'bharna', 'apni detail', 'khud bharo', 'photo',
    ],
    lines: [
      '**My profile** asks the same things the office\u2019s joining form asks: about you, where you live, who to call in an emergency, your government numbers, and where your salary goes. Each box saves as you leave it.',
      'The line at the top says how far through you are and **what the office still needs** \u2014 the same list they are chasing, so the two cannot disagree.',
      '**Documents** \u2192 send in your own Aadhaar, PAN, photograph or cancelled cheque. You can download your own back, and remove one nobody has looked at yet.',
      'A document reads **Not checked** until somebody in the office opens it. That is not a refusal \u2014 it means nobody has looked yet.',
      'An offer letter and an appointment letter are not on the list: the office issues those.',
    ],
    note:
      'A GOVERNMENT NUMBER CAN BE FILLED IN BUT NOT CHANGED. PAN, Aadhaar, UAN, PF member ID and ESIC: if yours is blank you can put it in, and the box asks you to check it first. Once it is on your record only the office can correct it, with the card in front of them \u2014 a wrong one is found months later by a return that will not file.\n\nNothing on this form can change your salary, your joining date or your leave. Those are the office\u2019s, and a figure sent on this form is refused rather than quietly dropped.',
  },
  {
    id: 'my-portal',
    staff: true,
    title: 'Your own portal — what is on each page',
    tab: 'dash',
    keywords: ['portal', 'dashboard', 'my page', 'employee', 'self service', 'mera', 'khud ka'],
    lines: [
      '**Dashboard** — today at a glance: whether you are marked, your hours, leave left, last month’s pay, and what is coming up.',
      '**My attendance** — every day of the month with your in and out times, and the months before it.',
      '**My leave** — what you have left, and the form to apply. **A leave application pays nobody until the office approves it.**',
      '**My salary** — your payslip, and under it *how it was worked out*, line by line.',
      '**My profile** — your bank details, phone and address. Changing a bank account is recorded with the date.',
      '**Holidays** — the company holidays that apply to **you**. A festival kept by some staff and not others shows only for the people it covers, so your list may be shorter than somebody else’s.',
      '**Documents** — what the office holds on file for you, and what is still wanted.',
    ],
    note: 'YOU SEE ONLY YOUR OWN. The portal asks the server for "mine", and the server works out who that is from your login — not from anything the page sends. There is no way to ask it for somebody else.',
  },
  {
    id: 'my-dashboard-empty',
    staff: true,
    title: 'Why my dashboard says “not marked yet”',
    tab: 'dash',
    keywords: ['not marked', 'empty', 'blank', 'no hours', 'khali', 'kuch nahi'],
    lines: [
      '**“Not marked yet” is not an absence.** It means nobody has filled in today yet, which before lunch is the commonest state there is.',
      '**Hours showing a dash** means no clock times are on the day. If you punched in but not out, it says *still in* — the hours are not known until the day is finished.',
      '**An empty month** means the office has not marked the grid or imported the machine’s file yet.',
      'Nothing on this page guesses. Where there is no answer it says so, rather than showing a nought that would read as “you did nothing”.',
    ],
    note: 'If a figure looks wrong, it is the MARK that is wrong, and it is wrong on the office’s grid too. Raise it under Help & support — that puts it on the record with a date.',
  },
  {
    id: 'my-record',
    staff: true,
    title: 'My record — appreciations, warnings and penalties',
    tab: 'record',
    keywords: [
      'record', 'appreciation', 'achievement', 'warning', 'penalty', 'fine', 'damage',
      'tareef', 'shabashi', 'warning', 'jurmana', 'penalty', 'katauti',
    ],
    lines: [
      '**Appreciations first**, then warnings, then anything being recovered from your salary. All three are the office’s record of you — this page is your copy of it.',
      '**A warning can be acknowledged.** Pressing *I have seen this* records that you read it, with the date. It is **not agreement**, and it changes nothing about your pay — it only stops the record saying you never saw it. It cannot be undone.',
      '**A penalty appears once you have been told about it, or once money has come out of it.** Something still being looked into is not here, because it may never be charged.',
      '**Where the money went**: each penalty lists the months it was taken from and how much. The same amount is on the payslip for that month, with the same note beside it.',
      '**Nothing here can be changed from this page.** If a penalty or a warning is wrong, raise it with the office — under Help & support, so it is on the record with a date.',
    ],
    note: 'The office’s own working notes about you are NOT here. Only what was issued to you — a warning, an appreciation, a penalty you were told about — is yours to read.',
  },
  {
    id: 'my-hours',
    staff: true,
    title: 'My hours \u2014 in, out and what the day came to',
    tab: 'attendance',
    keywords: ['hours', 'time', 'in out', 'clock', 'ghante', 'samay', 'kitne ghante', 'overtime', 'short'],
    lines: [
      '**Every day shows your in time, your out time and the hours they come to**, with the overtime or the shortfall underneath. The month\u2019s total is at the top.',
      '**A dash is “not known”, never nought.** A day with no clock times is a day nobody recorded the times for \u2014 it does not mean you worked nothing.',
      '**“No out time”** means the day was started and never finished. Nothing is guessed: the hours stay unknown until somebody says when you left.',
      '**The hours come off the same record your salary does.** If a day looks wrong, the day itself is wrong, and the office corrects it on the grid \u2014 not here.',
    ],
    note: 'Short hours and overtime are counted against the full day set for the month, which is stated under the table. A half day, leave or a holiday is never judged short.',
  },
  {
    id: 'roll-call',
    title: 'The morning roll call \u2014 who is absent, late, or out of uniform',
    tab: 'dashboard',
    keywords: ['roll call', 'absent list', 'late coming', 'uniform', 'morning', 'hajri', 'gair hajar', 'list'],
    lines: [
      '**One table, narrowed by the chips.** Press **Absent** and it is the absent list; press **Late coming** and it is the late list, worst first, with how many times this month.',
      '**A chip with 0 still presses** \u2014 it answers the question out loud: “nobody was absent on this day”.',
      '**Each row carries every reason that applies to that person**, so one line can say somebody was late AND short of hours. Two separate strips of names never could.',
      '**Why** and **Allowed?** are typed straight into the row and saved **on the day itself**, so they show on the grid, on the absent/present report and on that person\u2019s own record. Neither moves a rupee.',
      '**At work** is a chip too, with everybody\u2019s times and hours \u2014 not a separate list of bare names.',
    ],
    note: 'OUT OF UNIFORM 0 IS NOT “EVERYBODY IN UNIFORM”. Nobody is out of uniform until somebody walks the floor and says so; the uniform check under the table says how many were looked at.',
  },
  {
    id: 'attendance-grid',
    title: 'Reading the attendance grid',
    tab: 'attendance',
    keywords: ['grid', 'column', 'scroll', 'today', 'code', 'branch', 'department', 'filter', 'summary', 'hours', 'statement', 'hajri', 'per employee'],
    lines: [
      'The **name and the employee code stay put** while you scroll sideways, and the **date row stays put** while you scroll down — so the column you are clicking is always the day you think it is.',
      '**Today’s column is outlined**, and only when today is in the month you have open.',
      'Search matches the name, the code or the company. **Branch** and **Department** narrow the list further; they appear only when there is more than one.',
      'The columns at the right are that person’s month: **P** (including work from home and official duty), **Absent**, **WO**, **PL**, **LWP**, **HD**, **Sun**, **Hours** and **Minutes**.',
      '**Hours** is what was actually clocked in and out. **Minutes** is the difference from the day expected — short time as a minus, overtime as a plus — and that is the column the salary sheet pays from.',
      '**Click a name** for that person’s whole month: every day, the mark, in / lunch / out, hours, OT, the reason and whether it was approved. Export CSV and Print are on it.',
    ],
    note: 'That page is READ-ONLY on purpose. Attendance is marked on the grid; a day that can be changed from two screens is a day that gets changed from the wrong one.',
  },
  {
    id: 'mark-fast',
    title: 'Marking a whole month quickly',
    tab: 'attendance',
    keywords: ['mark everyone present', 'fill blanks', 'date range', 'bulk', 'fast', 'sab', 'ek saath', 'holiday'],
    lines: [
      '**Mark everyone Present** fills every blank day for everybody on screen, Sundays as S. It never overwrites a mark that is already there.',
      '**Fill blanks…** in a row does the same for one person.',
      '**A date range…** marks one person across many days — a fortnight off. It REPLACES what is there and skips Sundays.',
      'Clicking a **date header** marks one day for a chosen set of people: everyone, a company, or ticked names. Built for a festival that is paid for some staff and a working day for others.',
    ],
    note: 'The day marker and the festival panel both REPLACE that day’s marks, so run them AFTER "Mark everyone Present", not before.',
  },
  {
    id: 'short-hours',
    title: 'Short hours and overtime, by the minute',
    tab: 'attendance',
    keywords: ['short hours', 'overtime', 'OT', 'LT', 'minutes', 'late', 'kam ghante', 'extra'],
    lines: [
      'The day menu has presets (15/30/45/60/90/120 minutes) and a free box, and shows what one minute is worth for that person.',
      'Minutes are paid or deducted at salary ÷ 26 ÷ hours a day ÷ 60.',
      'They add up into the month’s OT/LT column, which is the column the sheet has always paid from.',
    ],
    note: 'A day already marked HF is paid at half, so its short hours are not deducted a second time.',
  },
  {
    id: 'time-tab',
    title: 'Typing in, lunch and out times',
    tab: 'time',
    keywords: ['time', 'in out', 'lunch', 'clock', 'working hours', 'samay', 'ghante', 'timing', 'late', 'early', 'overtime', 'short hours', 'usual timings'],
    lines: [
      'The **Time** tab takes four times a day: in, lunch out, lunch in, out. Type them however you like — `9:30`, `930`, `9.30`, `6pm`, `18:30` all read.',
      'out − in − lunch is compared with the day’s expected hours, and the difference becomes that day’s short hours or overtime.',
      '**The usual day** is the strip under the filter bar: start, finish, lunch, and what they add up to. If that sum goes **red** the timings are short of the day the month is paid on, and every day filled that way is docked the difference — a wrong default cannot quietly dock everybody any more.',
      '**Fill the usual timings** writes them onto the days that have nothing on them. It never overwrites a day somebody has already typed.',
      '**Somebody on a different shift gets THEIR hours, not the office’s.** Set them on the employee record — Employees, open the name, *Shift starts* and *Shift ends*. The strip says how many people on screen have their own before you press Fill. A night shift is filled with no lunch break, because the office’s break falls outside it.',
      '**One day, everybody** or **One person, whole month** — the pill at the top left. Day mode has the day stepper and a search; month mode has a person picker.',
      '**Import from Excel** is on the same bar: your own sheet of hours, previewed before anything is written.',
      'Whether the lunch break comes off the day is the tick beside them.',
      'A day with an in time and no out time is **shaded and flagged “no out”** — it used to look exactly like an empty day.',
    ],
    note: 'A shift crossing midnight is handled. Somebody on a night shift should have their own shift times on their record, or they read as hours late every day.',
  },
  {
    id: 'time-import',
    title: 'Importing in and out times from Excel',
    tab: 'time',
    keywords: [
      'import', 'excel', 'time', 'timing', 'timings', 'in out', 'hours', 'sheet', 'upload',
      'ghante', 'samay', 'punch', 'xlsx',
    ],
    lines: [
      '**Time → Import from Excel** takes your own sheet: one row per person per day, with **In** and **Out** columns — and **Lunch out / Lunch in** as well if you keep them.',
      'Point at which column is which, press **See what it would do**, and only then write it. Nothing is saved until you say so.',
      'It is the **same importer** Reports uses for the attendance machine, not a second one — so a day read off a file and a day typed by hand are judged by exactly the same rule.',
      'Names are matched on the staff list (or on the code, if your sheet carries one). Anybody it cannot match is **named, never invented**.',
      'Lunch is written **only when your sheet has those columns**, so a file without them cannot wipe a lunch somebody typed.',
    ],
    note: 'The hours are judged against the month’s own working day, so an eight-hour month breaks at four, not at four and a half. And a day under the half-day line is marked HF and its missing hours are NOT also deducted — it is already paid at half.',
  },
  {
    id: 'monthly-hours',
    title: 'The month\u2019s hours \u2014 9 \u00d7 26 = 234, settled once a month',
    tab: 'time',
    keywords: [
      'monthly hours', '234', '9 hours', 'nine hours', 'total hours', 'hours target',
      'short hours', 'overtime', 'ghante', 'mahina', 'monthly', 'kam hours', 'rule',
    ],
    lines: [
      '**Time \u2192 The month\u2019s hours.** Nine hours a day for the days each person was due \u2014 26 days is **234 hours**. A day short and a day long cancel; only what is missing from the **total** comes off the pay.',
      '**Every month opened from now starts on this rule.** A month already run keeps the rule it was run on, so no payslip already paid can move \u2014 switch the open month with **Charge this month on it** on the same panel, which says what it costs before it acts.',
      '**The total is not a flat 234.** Somebody absent two days owes 24 \u00d7 9 \u2014 those two days already came off as absences. Leave, a holiday, a weekly off and a half day add nothing to the total either.',
      '**A day nobody clocked counts on neither side.** No in time means not known, so it adds no hours to what is owed and none to what was worked.',
      '**A shorter or longer shift owes its own hours.** Somebody on 10:00\u201316:00 owes 6 \u00d7 26, not 234.',
      '**On this rule the clock times are the record.** A short-hours figure typed onto a day that already has an in and an out does not override those times. To forgive a whole month, type over the OT/LT box on the salary sheet \u2014 that beats every rule.',
    ],
    note:
      'THE THREE RULES ARE ALTERNATIVES, NEVER TWO AT ONCE \u2014 each day on its own, the late/early concession, or the month\u2019s total. Somebody an hour short on Tuesday is ALREADY an hour short in the month\u2019s total; charging both would take the same hour twice.\n\nWhat the monthly rule changes against the old one: each day used to forgive up to a quarter of an hour, which over 26 days is six and a half hours a month given away. Ten minutes short every day used to cost nothing; on this rule it is 4h 20m off the total.',
  },
  {
    id: 'shifts',
    title: 'Different shifts \u2014 and how long each person\u2019s day is',
    tab: 'employees',
    keywords: [
      'shift', 'shifts', 'night shift', 'part time', 'timing', 'shift timing',
      'alag timing', 'raat', 'duty hours', 'shift in', 'shift out',
    ],
    lines: [
      '**Shift starts / Shift ends** are columns on the Employees table, and on each person\u2019s record. Blank means the office\u2019s usual day, set on the Time tab.',
      'Their shift decides **when** they are late or early, **what \u201cFill the usual timings\u201d writes** on their days, and **how long their day is** \u2014 so short hours and overtime are judged against their own hours, not the office\u2019s nine.',
      'Their hourly rate follows it too: an hour missing from a six-hour day is worth a sixth of that day.',
      'A night shift that crosses midnight is read correctly \u2014 22:00 to 06:00 is eight hours.',
    ],
    note:
      'A SHIFT AT ANOTHER TIME OF DAY BUT THE SAME LENGTH CHANGES NO FIGURE. 14:00\u201323:00 is still nine hours. Only a different LENGTH moves money.\n\nA shift under two hours or over sixteen is treated as a typo: the month\u2019s hours are used instead and the Time tab says so. 09:00\u201309:30 taken literally would make a half-hour day the standard and pay eight and a half hours of overtime every single day.',
  },
  {
    id: 'late-early',
    title: 'Late in, early out, and the 300-minute concession',
    tab: 'time',
    keywords: ['late', 'early', 'concession', 'grace', 'late coming', '300', 'der', 'jaldi'],
    lines: [
      'Every minute late in and left early is counted and pooled for the month. On the **concession** policy the first 300 minutes are free and the rest is charged at the minute rate.',
      'It is set per month, so a rule changed in November never rewrites October. The panel prices the switch before you make it.',
      'A day nobody clocked is "not known", never "on time". A half day, leave, a holiday or an absence is never judged late.',
    ],
    note: 'It is OFF by default and deliberately so: the app already deducts short hours, and somebody half an hour late is already half an hour short there. The two are alternatives — turning the concession on stops the hours shortfall being charged, so the same minutes are never charged twice.',
  },
  {
    id: 'apply-leave',
    staff: true,
    title: 'Applying for leave (from a staff login)',
    tab: 'leave',
    keywords: ['apply leave', 'leave application', 'employee login', 'chutti', 'raja', 'apply', 'request'],
    lines: [
      'The employee signs in and opens **Leave**. They pick the kind (casual, sick, privilege, unpaid, a few hours off, or work from home), the dates, and say why.',
      'A week off is ONE application and one decision, not seven.',
      'They can see what they asked for and its status on the same page, and take it back until the office approves it.',
      'Somebody with no login can use their punch link instead — the same form.',
    ],
    note: 'An application changes nothing by itself. Nobody’s pay moves until it is approved.',
  },
  {
    id: 'approve-leave',
    title: 'Approving leave (the office)',
    tab: 'reports',
    keywords: ['approve', 'approval', 'reject', 'queue', 'pending', 'hr', 'confirm', 'manzoori'],
    lines: [
      '**Reports → Attendance corrections and approvals.** Every application, correction and work-from-home request is in one list.',
      'The dashboard says how many are waiting and who, and clicking that line opens this queue.',
      'Approving writes every day the request covers in one go, with the reason, marked approved.',
      'Rejecting writes nothing beyond the decision.',
    ],
    note: 'Nothing is decided twice, and nothing can be written into a month that has been closed.',
  },
  {
    id: 'manager-approval',
    staff: true,
    title: 'A manager approving their own team',
    tab: 'leave',
    keywords: ['manager', 'reporting manager', 'team', 'two step', 'recommend', 'confirm', 'boss'],
    lines: [
      'Anyone with people reporting to them gets a **My team** tab in their own login: what their team has asked for, and Approve / Reject.',
      'A manager’s approval is a **recommendation**. It goes to the office, and the office confirms it — only then does it reach attendance.',
      'A manager’s **reject ends it** there. A refusal costs nothing and does not need confirming twice.',
      'A manager sees only DIRECT reports — names, designation and department. Never salaries, never anybody else.',
      'Set who reports to whom on the employee record, or for a whole department at once under Employees.',
    ],
    note: 'Somebody with no manager is not stuck: the office can approve their request outright. And nobody can approve their own time off.',
  },
  {
    id: 'work-from-home',
    staff: true,
    title: 'Working from home',
    tab: 'leave',
    keywords: ['work from home', 'wfh', 'remote', 'WH', 'ghar se kaam'],
    lines: [
      'Staff apply for it the same way as leave — the kind is **Work from home**.',
      'It is paid in full and uses no leave quota: a day worked from home is a day worked.',
      'A week at home is one application and one decision.',
      'If they punch from a phone that day, being away from the office is expected — it is not flagged, and the strict fence does not refuse it.',
    ],
    note: 'An absence is not remote work. The fence still applies on any other mark.',
  },
  {
    id: 'short-leave',
    staff: true,
    title: 'A few hours off',
    tab: 'leave',
    keywords: ['short leave', 'hours off', '2 hrs', 'half', 'kuch ghante', 'permission'],
    lines: [
      'Staff can ask for 30 minutes to 5 hours instead of a whole day. The day stays Present; only the hours move.',
      'A whole day or more is refused and says so — that is a leave application.',
    ],
    note: 'It never charges the same hours twice: where the day already carries clock times, the shortfall there stands and the approval just records why. The minutes are only written on a day nothing else is accounting for.',
  },
  {
    id: 'leave-balance',
    staff: true,
    title: 'Leave balances and quotas',
    tab: 'leave',
    keywords: ['quota', 'balance', 'CL', 'SL', 'PL', 'left', 'bachi', 'kitni chutti'],
    lines: [
      'Each employee has a yearly quota for casual, sick and privilege leave, set on their record.',
      'What has been taken is counted from the marks across the year’s months, so it cannot drift from the sheet.',
      'A negative balance is flagged rather than blocked.',
      'Unpaid leave has no quota — it was taken anyway, and it was docked.',
    ],
  },
  {
    id: 'loan-settlement',
    title: 'Which loans are finished, and what is still owed',
    tab: 'reports',
    keywords: ['loan', 'advance', 'settled', 'closed', 'karz', 'udhaar', 'baaki', 'EMI'],
    lines: [
      'Reports → **Loan settlement report**: what is still being recovered, and what finished this year.',
      'Months left is worked out at the agreed instalment.',
      'A loan on hold is counted apart — the debt stands, but nothing is coming back until it is resumed.',
    ],
    note: 'Closure is worked out from the repayments, never stored. A loan is finished when what has been repaid reaches what was advanced — so a month set to zero, which the office is allowed to do, cannot leave a stale “closed” date behind. With no instalment set, months left reads as a dash: not known is not next month.',
  },
  {
    id: 'contact-list',
    title: 'Staff contact list — mobile, email, department, role',
    tab: 'reports',
    keywords: ['contact', 'mobile', 'phone', 'email', 'number', 'list', 'sampark', 'naam number'],
    lines: [
      'Reports → **Staff contact list**: name, code, company, department, role, mobile and email.',
      'Search finds a name, a department, a role or a number. Print or download as CSV.',
      'Change a number on the person’s own record and it changes here — there is one copy.',
    ],
    note: 'IT CARRIES NO SALARY, NO PAN AND NO BANK DETAILS, on purpose: a contact list gets printed and left on a desk. The employee export is the one with everything on it. Somebody with no number is listed with the gap showing rather than left out — they are the ones worth chasing.',
  },
  {
    id: 'missing-punch',
    title: 'Days the clock cannot account for',
    tab: 'reports',
    keywords: ['missing punch', 'no out time', 'punch', 'hajri time', 'in out missing'],
    lines: [
      'Reports → **Missing punch**: days somebody was at work and the times do not add up.',
      'Four kinds, counted apart — in with no out, out with no in, half a lunch, and nothing at all.',
      'The people with the most are named at the top.',
    ],
    note: 'NOTHING HERE IS A DEDUCTION. Every one of these days is already paid, whatever the sheet made of it — it is a list of things to go and ask about. And a day NOBODY clocked is not the same as a day HALF clocked: the first may be a job where nobody punches, the second is a record that is wrong.',
  },
  {
    id: 'deductions-report',
    title: 'What came out of people’s pay this month',
    tab: 'reports',
    keywords: ['deductions', 'kata', 'kitna kata', 'pf esi pt loan', 'statement', 'katauti'],
    lines: [
      'Reports → **Salary deductions**: every head — PF, ESI, PT, loan, penalty, the Deduct box, late — down the staff.',
      'It says how many people each head touched, not only the money.',
      'Heads that took nothing this month are left out, and named under the table.',
      'Reports → **Department-wise salary cost** is the other half: what each department costs, per head and as a share.',
    ],
    note: 'EARNED is before anything came out. The sheet’s Gross is already after the Deduct box and the late charge, so those are added back here — otherwise they would be counted twice and the statement would not balance. Absence is never a deduction: a day not worked was never earned. Cost to company is the gross plus the employer’s own PF and ESI, and Sunday pay is in neither figure — it is paid from its own register.',
  },
  {
    id: 'leave-bonus',
    title: 'The leave bonus — for a month nobody took off',
    tab: 'leave',
    keywords: ['bonus', 'incentive', 'attendance bonus', 'chutti nahi li', 'inaam', 'full attendance'],
    lines: [
      'Leave → **Bonus**. Two shapes: all or nothing, or the amount less a cut for each day off.',
      'Tick which marks cost it — paid leave counts by default, because it is still a day away.',
      'The rule is saved on the server, so everybody in the office runs the same one.',
      'Unused leave is a different thing: pay that from **Balances → Encash days**.',
    ],
    note: 'NOTHING MARKED IS NOT A CLEAN MONTH. Somebody with no marks at all is never eligible — without that, one unfilled grid pays the whole staff. And working it out pays nobody: the money goes on only through the button that names the month, as an addition with a note. The same month cannot be paid twice.',
  },
  {
    id: 'leave-cancel',
    staff: true,
    title: 'Cancelling a leave that was already approved',
    tab: 'reports',
    keywords: ['cancel', 'call off', 'approved leave', 'rad karna', 'chutti cancel', 'undo leave'],
    lines: [
      'Reports → **Attendance corrections and approvals** → **Cancel it** on the approved row.',
      'It asks why, and the reason stays on the record.',
      'An employee can **ask** from their own login (My leave → Ask to cancel) — that changes nothing until the office cancels it.',
      'A locked month refuses: that leave has already been paid.',
      'Something still waiting has written nothing — withdraw it instead.',
    ],
    note: 'IT CLEARS THOSE DAYS; IT DOES NOT MARK THEM PRESENT. They may have come in, been absent or taken something else, and either guess moves money — so mark what really happened afterwards. The request itself is never deleted: it keeps its dates, who approved it and who called it off.',
  },
  {
    id: 'leave-calendar',
    title: 'The leave calendar — who is off this month',
    tab: 'leave',
    keywords: ['calendar', 'who is off', 'month', 'kaun chutti pe', 'planner', 'off days'],
    lines: [
      'Leave → **Calendar** shows the month as a calendar: who is off on each day, how many, and the holidays.',
      'Click a day to see the names and what kind of leave each one is on.',
      'The busiest day is named at the top — the one to look at before granting another.',
    ],
    note: 'Leave already APPROVED and an application still WAITING are drawn apart, and counted apart. A pending day is not a day off yet — nobody is covered for it and nothing has been marked on the grid.',
  },
  {
    id: 'leave-year-end',
    title: 'Carry forward and lapsed leave at the end of the year',
    tab: 'leave',
    keywords: ['carry forward', 'lapse', 'year end', 'expire', 'saal ke ant', 'agle saal'],
    lines: [
      'Leave → **Year end**. What is left either carries into next year, up to a cap, or lapses.',
      'CL and SL lapse, PL carries up to 30 days — change any of it before pressing anything.',
      '**Show me what it would do** first; nothing is written until you press the button after it.',
      'Running it twice is refused, so nobody is carried across twice.',
      'Somebody who has taken more than they had is named and left alone — that one is a decision, not a sum.',
    ],
    note: 'It writes TWO entries per carried line: the days leave the old year and arrive in the new one, so each year adds up on its own. And on a ledger nobody has posted to, it writes the entitlement down FIRST — otherwise closing the year would read as a debt the person does not owe.',
  },
  {
    id: 'leave-encash',
    title: 'Encashing leave — paid out instead of taken',
    tab: 'leave',
    keywords: ['encash', 'encashment', 'paid out', 'chutti ka paisa', 'leave cash'],
    lines: [
      'Open somebody from Leave → **Balances**, pick the kind of leave, and use **Encash days**.',
      'More days than they have is refused, and so is a ledger nobody has started — post the entitlement first with the button the panel offers.',
    ],
    note: 'IT PAYS NOBODY. The days come off the ledger here; the money reaches a payslip only as an addition typed on that month’s salary sheet, with a note — the same split as a penalty and its recovery.',
  },
  {
    id: 'leave-applications-report',
    title: 'Who is waiting for a leave decision',
    tab: 'reports',
    keywords: ['pending leave', 'waiting', 'ageing', 'approval', 'kiska pending', 'application status'],
    lines: [
      'Reports → **Leave application status**: every application, whose move it is, and how long it has been theirs.',
      'A pending one is with the **manager** where somebody has one; once they have backed it, it is with the **office**.',
      'Reports → **Department-wise leave summary** is the other half: days per department, with everybody counted in the headcount.',
    ],
    note: 'Ageing runs from the LAST thing that happened to it, not from the day it was raised. A request a manager backed yesterday has been with the office for one day, however long it sat before that — reporting the whole wait sends somebody chasing the wrong person.',
  },
  {
    id: 'sunday-register',
    title: 'Sunday and holiday working',
    // Not its own tab: it is a fold on Attendance, which is exactly the kind
    // of "where is it" this help exists to answer.
    tab: 'attendance',
    keywords: ['sunday', 'SP', 'HP', 'holiday working', 'register', 'ravivar', 'extra day'],
    lines: [
      'It is the **Sunday working** fold at the bottom of the **Attendance** tab — not a tab of its own, because it is looked at once a month.',
      'Mark the day **SP** (worked the off day) or **HP** (worked the holiday) and the person appears there with their day rate and what they are owed.',
      'It is paid and ticked off separately from the month’s salary, with its own status.',
      'It exports as its own sheet in the workbook and as its own CSV.',
    ],
    note: 'Sunday pay is settled entirely apart: it is NOT added into the salary sheet’s net, and PT is not charged on it. The statutory wage register is the one exception — it adds it in, because a muster roll that left out wages actually paid would understate them.',
  },
  {
    id: 'festivals',
    title: 'Festivals and paid holidays',
    tab: 'attendance',
    keywords: ['festival', 'holiday', 'diwali', 'eid', 'religion', 'tyohar', 'PH'],
    lines: [
      'The **Festivals** panel at the top of Attendance takes a name and a date, and applies a mark to that day.',
      'Typing the name ticks the religions it belongs to — Diwali for the Hindu staff, Eid for the Muslim staff, everyone else works. No religions ticked means the whole office.',
      'The ticks stay editable: it is a starting point, not a rule.',
      'Applying again is safe — it catches up anybody who joined since.',
    ],
    note: 'Dates are deliberately NOT guessed. Lunar festivals move a fortnight between years and a wrong date costs a day’s pay, so only genuinely fixed ones (Republic Day, 15 August, Christmas, Makar Sankranti…) carry a date.',
  },
  {
    id: 'weekly-off',
    title: 'Weekly off, including alternate Saturdays',
    tab: 'leave',
    keywords: ['weekly off', 'saturday', 'sunday off', 'alternate', 'chutti ka din'],
    lines: [
      'Set the off days for a company, or for one person who is different.',
      'Alternate Saturdays are supported, because that is how much of Gujarat works and it cannot be said as "every Saturday".',
    ],
    note: 'It cannot move money. S still means the off day and SP still means it was worked — only which squares the grid treats as off days changes, so bulk marking hits the right ones.',
  },
  {
    id: 'sandwich',
    title: 'Sandwich leave',
    tab: 'leave',
    keywords: ['sandwich', 'between', 'off day', 'absent', 'beech'],
    lines: [
      'Finds an off day caught between two absences, prices it, and marks it on a click.',
      'A run of off days goes together or not at all. A day actually worked is never docked. A day at the very edge of the month is named and left alone, because the other side is in another month.',
    ],
    note: 'It is a tool, not a setting — nothing is stored and nothing happens until you press the button, because it is the harshest rule in the app. It writes UL, not A, so absences are not inflated by days the rule docked.',
  },
  {
    id: 'salary-sheet',
    title: 'How a month is worked out',
    tab: 'sheet',
    keywords: ['salary', 'gross', 'net', 'calculation', 'how', 'pagar', 'hisab', 'payable'],
    lines: [
      'Per-day rate = monthly salary ÷ 26. Days counted = 26 − what the absences cost.',
      'Gross after absence = per-day × days counted, then OT/short hours, then any Add and Deduct.',
      'PT is charged on **the month’s gross**, not the master salary — so somebody whose absences pull them under the slab pays none.',
      'Net = gross − PF − ESI − PT − loan instalment.',
      'Any figure can be typed over; it then shows with a ✎ and the audit trail records it by name and column.',
    ],
    note: 'Sunday pay is not in the net. The sheet ends at Net payable.',
  },
  {
    id: 'payroll-review',
    title: 'Payroll exceptions, approval and locking the month',
    tab: 'sheet',
    keywords: [
      'exception', 'exceptions', 'alert', 'verify', 'check', 'approve', 'approval',
      'lock', 'locked', 'reopen', 'workflow', 'stage', 'payment tracking', 'utr',
      'galti', 'check karna', 'approve karna', 'lock karna',
    ],
    lines: [
      'The strip above the sheet shows where the month has got to: attendance, salary preparation, verification, approval, locked. **The first three tick themselves** — they are facts about the month. **Approval and locking never happen by themselves.**',
      '**Things to check** lists what to look at before paying, at three levels. **Critical** is money that is wrong or missing — no salary, nothing payable, a net below nought, a day rate of nought, more absences than the month has. **Warning** is worth a look and does not block — attendance unfinished, PF with no UAN, a bank transfer with no IFSC, deductions over half the gross, the same name twice, paid with no reference. **Informational** is a status, such as a row on hold or a month waiting for approval.',
      'It shows the **five most important first**; “View all” has the rest, the chips filter by level and by Open / Resolved / Ignored, and the whole panel folds away. Clicking a name opens that person’s salary details.',
      'Each flag can be marked **Resolved** or **Ignored** with a reason. **Only a Critical flag stands in the way of approval.**',
      '**Approve the payroll** records who and when. If a Critical flag is still open the button becomes **Approve anyway, with a reason** — the reason is required, it names who was open at the time, and it goes on the audit trail as an override. **Approval history** shows every approval, override, reopening and lock in order.',
      '**Lock the month** needs that approval first and stops every figure moving. **Reopen** asks for a reason and keeps it.',
      '**Payment tracking** is its own tab: status, the date the money went and the UTR or cheque number. Marking somebody paid fills in today’s date — change it to the day it actually went.',
      '**Monthly summary** is its own tab: the month’s totals and six breakdowns, each printable.',
    ],
    note: 'AN EXCEPTION IS A QUESTION, NOT A CORRECTION. Nothing on that list changes a salary — it names the person, the figure and what to check. A net of nought is right for somebody who joined on the 30th, and “ignored, because…” is a proper answer that stays on the record.\n\nAND A DAY NOBODY WAS DUE AT WORK IS NOT A MISSING MARK. “Attendance looks unfinished” counts only the days that person was actually expected: not Sundays or their own weekly off, not the month’s holidays, not days before they joined — and never a day that has not happened yet.',
  },
  {
    id: 'add-deduct',
    title: 'One-off additions and deductions',
    tab: 'sheet',
    keywords: ['add', 'deduct', 'incentive', 'bonus', 'fine', 'reimbursement', 'extra', 'katna'],
    lines: [
      'Two separate boxes on the salary sheet, not one signed number — a month can carry both, and a forgotten minus sign is expensive.',
      'A remark beside them prints on the payslip.',
      'PT is charged on the gross they produce.',
    ],
  },
  {
    id: 'salary-structure',
    title: 'Salary breakup — Basic, HRA and the rest',
    tab: 'employees',
    keywords: ['basic', 'hra', 'structure', 'breakup', 'conveyance', 'medical', 'allowance'],
    lines: [
      'Set Basic, HRA, conveyance and medical on an employee. Special allowance is whatever is left, so the parts can never drift from the total.',
      '**Split their salary** does a whole group at once, each person split from their own salary. HRA defaults to 40% of basic — Vadodara and Surat are not metros for the exemption.',
      'The earned lines are pro-rated on the month and shown on the payslip.',
    ],
    note: 'The breakup never changes what anybody is paid. Gross, net, PT and every deduction are untouched by it — it only gives the payslip lines and lets PF be worked out on Basic.',
  },
  {
    id: 'pf-esi-pt',
    title: 'PF, ESI and professional tax',
    tab: 'employees',
    keywords: ['pf', 'esi', 'esic', 'pt', 'professional tax', 'contribution', 'epf', 'statutory'],
    lines: [
      '**PF** 12% of earned Basic, wages capped at ₹15,000. **ESI** 0.75% of gross while it is ≤ ₹21,000, shares rounded up as ESIC does. **PT** Gujarat slabs — nil to ₹12,000, then ₹200.',
      'The employer side is worked out too (PF 12% split with EPS at 8.33%, plus EDLI and admin; ESI 3.25%), so a real CTC is visible.',
      'Each person is on **fixed** or **auto**. Fixed deducts the number typed on their record, exactly as before.',
    ],
    note: 'Nothing switches itself on. Everyone starts on fixed, and the panel says what switching would cost before you switch it — unlike the salary split, this one really does move take-home.',
  },
  {
    id: 'loans',
    title: 'Loans and advances',
    tab: 'loans',
    keywords: ['loan', 'advance', 'instalment', 'emi', 'karz', 'udhar', 'repayment'],
    lines: [
      'Record a loan with its instalment. Opening a month posts one repayment row per running loan, capped at what is still outstanding.',
      'That row is editable, so a month can be skipped without losing the debt.',
      'The instalment is deducted alongside PF and ESI.',
    ],
  },
  {
    id: 'penalties',
    title: 'Penalties, fines and recovering damage',
    tab: 'people',
    keywords: ['penalty', 'fine', 'damage', 'loss', 'breakage', 'recover', 'jurmana'],
    lines: [
      'Record what happened, what it is for, and over how many months to take it. A note is **required** — that is the whole point of the module, since the Deduct box could already deduct, it just could not say what for.',
      'Recording one deducts nothing. Recovery is a separate step naming the month it comes out of.',
      'The note rides onto the payslip.',
    ],
    note: 'The Payment of Wages Act limits are REPORTED, not enforced: the preview names the 50%-of-wages cap and still lets you proceed. Refusing would only push the figure into the Deduct box, where nothing checks anything at all.',
  },
  {
    id: 'payslips',
    staff: true,
    title: 'Payslips — printing and sending them',
    tab: 'sheet',
    keywords: ['payslip', 'salary slip', 'print', 'pdf', 'send', 'whatsapp', 'parchi'],
    lines: [
      '**Click a name on the salary sheet** for that person’s full statement: the calculation line by line, the month’s attendance day by day, every addition and deduction with where it came from, and their payment history. The payslip prints from inside it.',
      '**Send payslips** on the toolbar writes one small HTML file per person, which you can forward on WhatsApp. It opens on any phone with no login, no app and no network, and prints to PDF.',
      'A free line typed once rides onto every slip.',
    ],
    note: 'ONE FILE HOLDS ONE PERSON. Never forward the whole single-file app to an employee — that one carries every salary in the company.',
  },
  {
    id: 'leave-ledger',
    title: 'The leave ledger \u2014 one person, every day accounted for',
    tab: 'leave',
    keywords: ['ledger', 'leave ledger', 'balance', 'opening balance', 'carry forward', 'khata', 'chutti ka hisab', 'bakaya'],
    lines: [
      '**Leave \u2192 Balances, then click a name.** Date, particulars, credit, debit, running balance and a reference \u2014 the same shape as a ledger in Tally. Print it or take the CSV.',
      '**Every debit is a mark on the attendance grid.** Nothing about days taken is stored here; it is counted off the marks each time, so the ledger and the grid can never disagree.',
      '**Credits are what you post**: an opening balance, a monthly credit, leave carried forward, a correction (which must say why), an encashment, a lapse.',
      '**Until you post something**, the ledger shows the yearly entitlement on the person\u2019s record less what the grid says was taken \u2014 exactly the balance this app has always shown \u2014 and it says so on the page.',
      '**Posting an entry ends that assumption.** Use **Start the ledger with their entitlement** first, or the entitlement simply stops counting and the balance drops.',
      '**A credit moves no money and marks no day.** Marking a day is the grid\u2019s job, and an approval\u2019s.',
    ],
    note: 'A NEGATIVE BALANCE IS NOT AN ERROR — it is leave taken beyond the entitlement, and somebody has to decide about it. The app shows it rather than rounding it up to nought.',
  },
  {
    id: 'document-check',
    title: 'Checking documents, and the register',
    tab: 'reports',
    keywords: ['document', 'kyc', 'verify', 'check', 'pan card', 'aadhaar', 'register', 'dastavej', 'jaanch'],
    lines: [
      '**On a person\u2019s record**, each document has three buttons: **ok** (checked), **no** (rejected \u2014 it asks what is wrong, and the reason shows on the record), and **—** meaning nobody has looked.',
      '**Not checked is not rejected.** A document nobody has looked at is its own state and is counted apart.',
      '**Reports \u2192 Employee document status** is every person against every KYC paper on one page: on file, checked, rejected, expired or missing. Chips narrow it to whose file is short. Print or download it for an audit.',
      '**A new joiner can send their papers in with their joining form**, and they come across to the record when you approve it \u2014 **unchecked**, because approving the form is not the same as having read the Aadhaar.',
    ],
    note: 'Every decision on a document is on the audit trail with the name of whoever made it. Deleting one deletes the file as well, and that cannot be undone.',
  },
  {
    id: 'print-reports',
    title: 'Printing a report',
    tab: 'reports',
    keywords: ['print', 'printing', 'paper', 'pdf', 'chapna', 'print nikalna', 'report print'],
    lines: [
      '**Open a report and press Print**, beside Download. It lays the same file out as a document \u2014 the report\u2019s name, the month, the filters that were on, the table, and a total under every column that is figures.',
      '**Download is still there** and still the thing to send the bank or open in Excel. Print is the copy the office signs and files.',
      '**A column of codes is never added up** \u2014 an employee code, a UAN, a PIN code and a phone number are all digits and none of them means anything added together.',
      '**The absent/present report and the muster print what is on screen**: the view you chose and the search you typed, not the whole staff.',
      'To save it as a PDF, choose **Save as PDF** as the printer.',
    ],
    note: 'A report with no month on it is a page somebody has to ask about, so the month and the filters are always printed under the title.',
  },
  {
    id: 'noticeboard',
    title: 'The noticeboard \u2014 notices, celebrations and holidays',
    tab: 'people',
    keywords: ['notice', 'noticeboard', 'announcement', 'celebration', 'holiday notice', 'suchna', 'ghoshna'],
    lines: [
      '**People \u2192 Noticeboard.** Put up a notice, a celebration or a holiday; choose whether it is for one company or everybody; say when it goes up and when it comes down; pin the important one to the top.',
      '**NOTHING IS SENT.** It is a board, not a message. Staff see it when they next sign in to their own portal \u2014 no message, no email, nobody notified.',
      '**Leave the dates empty** for “up now” and “until somebody takes it down”, which is how a board works.',
      '**A notice with a future start date is not on the board yet** \u2014 write next month\u2019s picnic today and it appears on the day, not before.',
      '**Take down** removes it for good; there is no undo.',
    ],
    note: 'It needs the server. The staff read it from their own login, and there is nothing to sign in to in a file on a laptop.',
  },
  {
    id: 'my-notices',
    staff: true,
    title: 'Notices, and the jobs you can refer somebody for',
    tab: 'notices',
    keywords: ['notice', 'announcement', 'holiday', 'celebration', 'job', 'opening', 'refer', 'vacancy', 'naukri', 'suchna'],
    lines: [
      '**Notices** are what the office has put on the board \u2014 office news, a celebration, a holiday. Anything pinned sits at the top.',
      '**We are hiring** lists what the company is recruiting for right now. **Copy the message** gives you the advert, ready to send to somebody who would fit.',
      'A referral from somebody who already works here is worth more than an advert, which is why this is on your page at all.',
    ],
    note: 'You see the advert, not the office’s own notes about the job. Nothing you do here tells anybody you referred somebody — if you want credit for it, say so to HR.',
  },
  {
    id: 'onboarding',
    title: 'Inviting somebody to fill in their own joining form',
    tab: 'employees',
    keywords: ['invite', 'onboarding', 'joining form', 'new joiner', 'link', 'bulana', 'form bharna', 'approve'],
    lines: [
      '**Employees \u2192 “Let them fill it in”**, the button beside Add employee. Type the company, the job and the joining date, and you get a **link**. Hand it over on WhatsApp or on paper \u2014 **nothing is sent by the app**.',
      '**They fill in the rest from their phone** and it saves as they type, so they can come back to the same link.',
      '**They cannot change what you set**, and they are never asked their salary \u2014 you type that when you approve.',
      '**Approve is the only thing that creates an employee.** Until then nothing is on the payroll, the attendance grid or any register.',
      '**Send back for correction** needs remarks saying what to fix; they see those remarks on their form and can send it in again.',
      '**One mobile number, one person** \u2014 an invitation is refused if that number is already on the staff list or on another open invitation.',
    ],
    note: 'ANYBODY WHO HAS THE LINK CAN OPEN THE FORM. It carries a signed token and expires on the date you set, and it can be withdrawn — but it is not a password. Send it to the person and nobody else.\n\nThis is for somebody who has NOT joined yet. Anybody already on the staff list fills the same form in from their own login — My profile and Documents on their portal — and what they type lands straight on their record, so there is nothing to approve.',
  },
  {
    id: 'add-employee',
    title: 'Adding somebody \u2014 the joining form',
    tab: 'employees',
    keywords: ['add employee', 'joining', 'new joiner', 'form', 'naya aadmi', 'bharti', 'code', 'duplicate', 'draft'],
    lines: [
      '**Employees \u2192 Add employee** opens eight sections: basic details, the job, address, statutory numbers, pay and bank, emergency contact, documents and access.',
      '**Only a name and a company are needed to save.** The joining date and the salary are starred because a finished record has them \u2014 but the save goes through without, and the **joining checklist** on their record chases the rest.',
      '**The code fills itself in** from the company\u2019s series. Type your own and it is left alone \u2014 the punch machine already knows those codes.',
      '**If somebody similar is already on the list it says so, and why** \u2014 the same mobile, the same PAN, the same name and date of birth. Add them anyway if they are a different person; the only thing actually refused is an exact employee code.',
      '**Save draft** when the details are not to hand. A draft is on **no payroll month** until you open it and press *Finish*.',
      '**Documents go on the record, not on the form** \u2014 a file has to hang on somebody, so their record opens the moment you save, with the upload boxes waiting.',
    ],
    note: 'PAN, AADHAAR AND THE BANK ACCOUNT ARE HIDDEN on the record until you press “show”, and showing one is recorded with your name. It keeps them off a shared screen; it is not encryption.',
  },
  {
    id: 'employees',
    title: 'The employee record',
    tab: 'employees',
    keywords: [
      'employee', 'record', 'add', 'master', 'profile', 'karmchari', 'staff', 'joining',
      'delete', 'remove', 'left', 'resign', 'inactive', 'active', 'hatana', 'nikalna', 'chhod',
    ],
    lines: [
      'Click a name to open the record: employment, personal, statutory numbers (PAN, Aadhaar, UAN, ESIC), bank details, salary breakup and a change history.',
      'A jump row at the top goes straight to Documents & KYC, Bank, Statutory, Salary breakup or History.',
      'Every change to a tracked field (salary, designation, department, manager, bank account…) is kept with its date.',
      '**Still to finish** lists anybody whose record is incomplete, newest joiner first, each step saying what breaks without it.',
      '**Somebody has left? Untick Active — do not delete them.** Their past months stay intact, and they come off the attendance grid of any open month by themselves the next time it is opened.',
      'They DO stay on a month that owes them something — left on the 10th means ten days to pay — and the grid writes **· left** beside the name so it reads as money still to pay. A closed month never changes.',
      '**Delete** is for a row that should never have existed. It counts first and says what would go; if nothing is recorded against them it says so. Anybody paid in a **closed** month is refused — mark them Left instead.',
    ],
    note: 'It is a checklist, not a gate. Nothing blocks a save or a payslip — only a joining date and a salary are genuinely required. Deleting is the one act that cannot be undone, and it takes their documents off the disk with them.',
  },
  {
    id: 'photo-documents',
    title: 'Employee photo and documents',
    tab: 'employees',
    keywords: ['photo', 'document', 'kyc', 'aadhaar', 'pan', 'upload', 'foto', 'dastavej'],
    lines: [
      'Upload a photograph from the top of the employee record — it then shows on the record and on their own page.',
      'Documents upload on the same record, with kinds; four of them count as KYC and the record says what is still missing.',
      'Anything with an expiry date is flagged once it has passed.',
    ],
    note: 'Uploading files needs the server. The single-file build shows initials instead of a face and says so, rather than offering a picker that could never work.',
  },
  {
    id: 'leavers',
    title: 'Somebody leaving — taking them off the list',
    tab: 'employees',
    keywords: [
      'left', 'leaving', 'leaver', 'exit', 'resign', 'resignation', 'terminate',
      'remove employee', 'delete employee', 'inactive', 'off the list',
      'chhod diya', 'nikal gaya', 'job chhodi', 'hata do',
    ],
    lines: [
      '**`exit` on their row**, at the right-hand end of the Employees list. That is the resignation, the notice, the clearance checklist and the full and final, opened on that one person.',
      'Or type their **last working day** straight into the Left column. **A date that has already passed takes them off the list by itself.**',
      'A date **still to come** leaves them working — somebody serving notice is still here, still on the sheet and still paid. Opening the next month catches up with them once the day has passed.',
      'Once they are off, they stop appearing wherever you pick somebody: a loan, a warning, a penalty, an asset handover, a licence seat, a task, a ticket.',
      '**Nothing about them is deleted.** Their record, their warnings, the loan still outstanding and the asset they never returned are all still there — the full and final under People → Leaving is worked out from exactly those.',
      'Put somebody back on with the **Active** tick, which still works on its own.',
      '**Delete is not an exit.** Deleting takes every month they were ever paid in with them; an exit keeps all of it and simply stops the next month opening with them on it.',
      'To find somebody who has gone, tick **Show people who have left** above the list — or open **Past employees** below it, which is the register of everybody who has gone, with how they went and whether their full and final was settled.',
      '**Somebody whose exit is on the record cannot be deleted.** Their months, attendance, documents, loans, assets and records stay exactly as they were.',
    ],
    note: 'THEY KEEP THE MONTH THEY LEFT IN. Somebody who left on the 10th stays on that month’s salary sheet whether or not anything is marked against them, because an unmarked month pays a full month and taking the row away would stop them being paid for the days they worked. Only somebody already gone before the month began is left off it.',
  },
  {
    id: 'tidy-names',
    title: 'Names in capitals — tidying the letters',
    tab: 'employees',
    keywords: [
      'name', 'names', 'capital', 'capitals', 'caps', 'uppercase', 'lowercase', 'letters',
      'spelling', 'tidy', 'case', 'naam', 'akshar', 'chote bade',
    ],
    lines: [
      'ANSHIKA GUPTA sitting next to Mahek Gotawala happens when eighty-five names are typed by different people over two years.',
      '**Employees → Tidy names** shows what it would change — every name, before and after — and renames nobody until you press the button.',
      'Initials stay capitals (A. K. Sharma), a hyphen and an apostrophe are joins inside one name (Jean-Paul, D’Souza), and two spaces become one.',
      'Only the staff list changes. Payslips, attendance and every report read the name from there, so they follow — nothing already paid moves.',
    ],
    note: 'A name somebody has ALREADY mixed — McDonald, D’Souza, DiMaggio — is left exactly as it is. There is no telling a deliberate capital from an accidental one, and “fixing” those is how a register ends up with names their owners do not recognise. This only takes the shouting out.',
  },
  {
    id: 'bulk-employees',
    title: 'Updating the staff list in Excel',
    tab: 'employees',
    keywords: ['bulk', 'excel', 'import', 'export', 'staff list', 'update', 'xls', 'xlsx'],
    lines: [
      'Download the staff sheet, edit it in Excel, and bring it back. It comes down filled in, not blank.',
      'People are matched on employee code first, then company + name.',
      'A dry run first: it says what would change, what would be added, and whose salary moves, before anything is written.',
    ],
    note: 'A blank cell changes nothing — it is "not this time", never "clear this field". That is why you can send a sheet back with only the columns you care about filled.',
  },
  {
    id: 'bulk-attendance',
    title: 'The month’s attendance in Excel',
    tab: 'attendance',
    keywords: ['attendance excel', 'import', 'export', 'grid', 'sheet', 'bulk marks'],
    lines: [
      'Download the month as a grid — names down, days across, with the weekday on each column and Sundays shaded.',
      'A "Marks" sheet in the same file lists every code and what it costs.',
      'Bring it back and it says what it would change before writing.',
    ],
    note: 'A blank day is left alone rather than cleared, and it is not counted as an unknown mark.',
  },
  {
    id: 'biometric',
    title: 'Importing from the attendance machine',
    tab: 'reports',
    keywords: ['essl', 'biometric', 'punch', 'machine', 'import', 'etimetracklite', 'monthly status', 'thumb'],
    lines: [
      '**Reports → Tools** reads the eSSL exports: the Monthly Status report and the Basic Work Duration report, including the older `.xls` files.',
      'Clock times come across onto the Time tab, so the hours become money the same way typed hours do.',
      'A dry run first, which says what it would cost in short hours and overtime before anything is written.',
    ],
    note: 'A day the machine has no record of looks exactly like a day everybody was absent. Those days are NAMED and left alone rather than written through — in one real file that would have booked 912 absences nobody earned. The machine’s own total is ignored: the app works the day out itself, so there is never a second figure nobody can account for.',
  },
  {
    id: 'punch-phone',
    staff: true,
    title: 'Punching from a phone',
    tab: 'reports',
    keywords: ['punch', 'phone', 'gps', 'location', 'mobile attendance', 'fence', 'link'],
    lines: [
      'Each employee gets a personal link. Opening it lets them punch in and out and see their own punches — nothing else, and nobody else.',
      'The first punch of the day becomes in, the last becomes out — the same columns the sheet pays from.',
      'Office locations and the allowed distance are set in the same panel.',
      'It is off until it is switched on.',
    ],
    note: 'A punch from outside the fence is RECORDED and flagged, never refused. Refusing leaves somebody genuinely at a client’s office with no attendance at all, and it gets retyped from memory that evening with no record. A link can be forwarded and a phone handed over — the fence narrows it and the log makes it visible, and that is the honest limit.',
  },
  {
    id: 'staff-logins',
    title: 'Giving employees a login',
    tab: 'admin',
    keywords: ['login', 'password', 'staff login', 'user', 'account', 'sign in', 'reset'],
    lines: [
      '**Admin → Logins** makes a login for one person or for a whole list at once.',
      'The first password is three sayable words, because it gets read out. It is shown ONCE, on the screen that makes it.',
      'They are asked to choose their own password the moment they sign in; the handed-over one stops working.',
      'With a login they can see their own pay, attendance and payslip, apply for leave, and fix their own bank details and phone.',
      '**On their own page the pay is not in a headline font** — it reads at the size of every other figure, and there is a **hide** beside it for a counter or a shared screen. What they hide is remembered on that device only.',
      '**“Earned up to today”** sits under the net on the month that is still running: what the days so far add up to at their day rate. It says on the page that it is **before** PF, ESI, professional tax and anything else that comes off at month end, and that it is not a promise of what will be paid.',
    ],
    note: 'EARNED SO FAR IS NOT TAKE-HOME, and the page says so where an employee reads it. It counts days the way the month does — a day nobody has marked counts as worked — and it stops at today: approved leave next week is neither earned nor lost yet. There is no self-service password reset. If somebody forgets theirs, an admin resets it here and hands over a new one-time password.',
  },
  {
    id: 'roles',
    title: 'Who can do what',
    tab: 'admin',
    keywords: ['role', 'admin', 'hr', 'viewer', 'permission', 'access', 'rights', 'manager', 'operator', 'accounts'],
    lines: [
      '**Admin** — everything, including logins, a month’s settings and closing a month.',
      '**Manager** — everything HR does, plus **approving**: a month’s payroll, locking it, an offer. No logins and no settings.',
      '**HR** — employees, attendance, leave, payroll and assets, salaries included. Cannot approve a month, change settings or make logins.',
      '**Accounts** — the same as HR, started off with Salary sheet and Reports ticked.',
      '**Operator** — fills things in and cannot take anything away. No delete, no archive, no clearing — and none of the quiet ones either: writing off an asset, waiving a penalty, cancelling a licence, settling a full and final, renumbering the register.',
      '**Viewer** — can look and change nothing.',
      '**Staff** — their own record only, through their own page. They cannot read any office screen at all.',
      'Beside each login, **May use** says which tabs it reaches. Empty means everything — not nothing.',
    ],
  },
  {
    id: 'wrong-passwords',
    title: 'Too many wrong passwords',
    tab: 'admin',
    keywords: ['password', 'wrong password', 'locked', 'lockout', 'blocked', 'throttle', 'brute force', 'galat password', 'band'],
    lines: [
      'The first five wrong passwords cost nothing. After that each one is answered more slowly — fifteen seconds, then thirty, a minute, two, four — up to five minutes.',
      '**Nobody is ever locked out.** The wait runs out on its own, and the right password clears it at once. There is nothing to unlock and nobody to ring.',
      'It is counted **per username**, so one person being guessed at never slows anybody else down.',
      'Admin → Logins names anybody being answered slowly right now. If it is one of your people, they have forgotten theirs — reset it there. If it is a username nobody uses, somebody is guessing.',
    ],
    note: 'A LOCKOUT WOULD BE A WEAPON. An account that closed after a few wrong guesses could be shut by anybody who knew the username — on the day payroll had to go out. So it slows down instead, and always comes back.',
  },
  {
    id: 'auto-signout',
    title: 'Signing out by itself when idle',
    tab: 'admin',
    keywords: ['logout', 'sign out', 'signout', 'idle', 'timeout', 'session', 'auto logout', 'band', 'login open'],
    lines: [
      'A login that does nothing for a while is signed out. The figure is set in **Admin → Logins → Signing out by itself** — five minutes to eight hours, or **never**.',
      'It starts at **one hour**. Clicking anything inside that hour starts the clock again, so somebody working all afternoon is never thrown out mid-sentence.',
      'When it happens, the screen goes back to the sign-in page saying so. Nothing is lost that was already saved; anything half-typed is not.',
      'A shorter figure is worth most at the **front desk** — that is the one machine in the building strangers stand in front of.',
    ],
    note: 'Held on the SERVER, not by a timer in the browser. Closing the laptop lid or leaving the page open does not keep a session alive, and somebody who knows the address cannot carry on with an expired one.',
  },
  {
    id: 'reports',
    title: 'The reports',
    tab: 'reports',
    keywords: ['report', 'register', 'csv', 'export', 'download', 'muster', 'absent present'],
    lines: [
      'Reports are grouped — attendance, payroll, leave, statutory, employees, loans, assets, hiring. Search the list by name.',
      'The **absent/present report** comes two ways: a month summary one line per person, and a day-by-day muster.',
      'The **monthly report pack** is the three sheets that actually go out: bank, cash, and Sunday + festival, in the office’s own layout.',
      'A per-employee report shows one person down the months.',
    ],
    note: 'The reports COUNT; they never recalculate. Every figure came out of the same calculation the payslip did, so a report and a payslip cannot disagree.',
  },
  {
    id: 'statutory',
    title: 'PF, ESI and PT registers for filing',
    tab: 'reports',
    keywords: ['ecr', 'register', 'filing', 'pf register', 'esi register', 'wage register', 'return'],
    lines: [
      'Four registers off the calculated month: PF, ESI, PT per company, and the wage register.',
      'Anybody missing a UAN or an ESIC number is named rather than quietly left out.',
      'The PF register flags a row where the deduction is not 12% of the wages reported — the commonest reason an ECR bounces.',
    ],
    note: 'The EPFO and ESIC upload formats drift. Check a file against the portal’s own template before uploading it rather than trusting the column order here.',
  },
  {
    id: 'printing',
    title: 'Printing — what comes out on paper',
    tab: 'reports',
    keywords: [
      'print', 'printing', 'paper', 'pdf', 'printer', 'landscape', 'portrait',
      'chhapna', 'print karna', 'nikalna', 'hard copy', 'a4', 'page',
    ],
    lines: [
      '**Hiring → Candidates → Print** is the candidate sheet — and the **CV is never printed or exported**, only whether one is on file. **Hiring → Interviews → Print** is the schedule, with whether the candidate’s form has come back and whether the evaluation is in. **Hiring → Vacancies → Print** is every opening with its seats, hires and applications.',
      '**The offer letter prints.** Open the application, and beside the download there is **Print the letter** — sign it and hand it over, or save it as a PDF. It is the same letter the download sends, built from the offer that was approved, and there is no letter at all until an Admin has approved it.',
      'It carries **that company’s logo**, set in Admin → Company logos — inlined into the letter, so it shows on a phone with no signal.',
      '**Hiring → Reports** prints any of its twelve reports, including the new **Offers out** — every offer written, approved, sent or answered, drafts included, with the ones past their valid-till date flagged.',
      '**People → Leaving → Print the exit register** lists everybody who has gone and whether their full and final is settled; **Print the statement** on one person gives the settlement itself — Payable against To be recovered, with an unreturned asset named and valued below the net, never deducted.',
      '**People → Tasks → Print** is the register of work given to staff, with overdue said on the row — a job with no date is not late. **People → Helpdesk → Print** is every ticket, with who it is waiting on: “the office” means nobody here has replied yet.',
      '**People → Appraisals → Print** is the increment register: what each person was on, what is proposed, the rise and whether it has been applied — and the total counts only the applied ones, because an appraisal is a proposal until then.',
      '**Assets → Who holds what → Print the handover register** is the whole log: every issue and return, condition both ways, and whether it was signed for. The list on that screen is who holds something NOW, which is a different question — the page says so.',
      '**People → Penalties → Print** and **People → Claims → Print** are the other two money registers: a penalty with the reason it was charged, recovered and outstanding (money on hold is still owed; only waived money leaves the outstanding), and a claim with who decided it and **which month it was paid through**.',
      '**Loans → Print** is the loan register: given, for what, instalment, repaid, outstanding, what is coming off this month, and the status — with totals. The month column is what is actually being taken, not the standing instalment.',
      'Every slip carries the **company’s logo**, set in Admin → Company logos.',
      '**Salary slips print as slips.** Open anybody’s payslip and press Print, or use **Print N payslips** on the salary sheet for everybody on screen — **one slip to a page**, company at the top, earnings against deductions, net across the foot. Both are the same document, so they can never say different things.',
      '**A Print button builds a report, it does not photograph the screen.** Twenty-one screens have one: **Vacancies**, **Hiring reports**, **Loans**, **Penalties**, **Claims**, **Appraisals**, **Handovers**, **Tasks**, **Helpdesk**, **Leaving** (the register and the settlement), **Candidates**, **Interviews**, **Attendance** (the month as a muster roll — every day across, Sundays shaded, each person’s tallies at the end, the codes printed at the foot), **Leave** (due / taken / left for CL, SL and PL, with unpaid beside it), Assets → Register, Assets → Full register, one person’s asset ledger, Maintenance, Employees, and the Salary sheet. Each comes out as a document — a title saying what it is and what it was narrowed to, the columns, a totals row, and the rule that matters at the foot.',
      '**It prints exactly what is on screen** — your filters, your search and the company picker already applied, and the paper says which. Nothing is recalculated, so the sheet and the page cannot disagree about a rupee.',
      'While a report prints, **the app itself is not on the paper at all**, so nothing open on screen can reach the page.',
      'Ctrl+P on a screen with no Print button still works and leaves out the sidebar, the navy bar, the tabs and the month and company pickers — they are controls, and a control on paper is something somebody cannot press.',
      'The top of the page says what it is instead: the screen, the company it was narrowed to, the month, and the day it was printed. The date and address the browser prints in its own margin come from the browser, not from here.',
      'The **salary sheet** and the **attendance grid** print **landscape** on their own, because they are wider than they are tall. Everything else is portrait.',
      'A table keeps its **header on every page**, a row is never split in half, and each block of a register — one company, one group, one person — stays whole where it fits on a page.',
      '**One person’s asset ledger prints whole** — who they are, what they hold now and every movement with the running balance — whichever tab you were looking at.',
      'There is **no separate PDF maker**: choose “Save as PDF” as the printer. One generator means the paper and the screen cannot drift apart.',
    ],
    note: 'A printed EMPLOYEE LIST carries everybody\u2019s salary: on screen it is behind a login, on paper it is a sheet on a desk. The page says so itself. Printing shows what is ON SCREEN. A filter, a company or a search narrows the paper exactly as it narrows the screen — so check the line at the top of the printed page before handing it to anybody.',
  },
  {
    id: 'daily-report',
    title: 'The daily attendance report for WhatsApp',
    tab: 'dashboard',
    keywords: [
      'daily report', 'whatsapp', 'group', 'message', 'morning', 'office report',
      'attendance report', 'send', 'bhejna', 'roz', 'daily', 'report group me',
      'late coming list', 'absent list', 'uniform', 'incident', 'inspection', 'conduct',
    ],
    lines: [
      '**Dashboard → under the roll call → Write the message.** It writes the report your office already types into the group every morning, from the day on screen: heading, date, **Attendance** with every absent name and the reason in brackets, **Late Coming / Early Going** with how late, **Uniform**, and **Overtime**.',
      'Step the roll call back a day with ‹ › and the message follows it. Set the company filter and it covers that company only, and names it in the heading.',
      '**Office Inspection, Conduct and Incidents are three boxes you type.** They are not recorded anywhere in this app, so nothing is claimed about an inspection nobody logged. The whole message can be edited before it goes.',
      '**Copy the message**, or press **Open WhatsApp** and choose the group yourself.',
      'For an automatic send every morning, `GET /api/people/daily-report?format=text` returns the same message as plain text, and takes `&day=`, `&inspection=`, `&conduct=` and `&incidents=`.',
      'Everybody in it comes off the same marks the salary sheet is paid from — the message and the roll call above it cannot disagree about who was late.',
    ],
    note: 'THE APP ASSEMBLES IT, IT DOES NOT SEND IT. There is no WhatsApp API for a personal number, and the task assistant already holds the one linked session — a second one risks the number. Two other things it will not do: a day nobody has marked says so instead of listing the whole staff as absent, and somebody with no clock time is left out of Late Coming rather than counted as on time.',
  },
  {
    id: 'assets',
    title: 'The asset register',
    tab: 'assets',
    keywords: [
      'asset', 'laptop', 'handover', 'stock take', 'maintenance', 'amc', 'barcode', 'saman',
      'import', 'excel', 'list', 'imei', 'serial', 'bulk', 'upload', 'suchi',
      'group', 'category', 'computer', 'furniture', 'mobile', 'shreni', 'prakar',
      'code', 'prefix', 'number', 'barcode', 'sticker', 'department', 'number banana',
      'transfer', 'hand over', 'staff wise', 'employee wise', 'person', 'kiske paas',
      'dena', 'badalna', 'transfer karna',
    ],
    lines: [
      'Every asset gets a code like `BPL-LAP-014`, a printable barcode label, purchase details, warranty and an AMC.',
      'Issuing and returning are logged — who held it, from when, and what was handed over with it.',
      'A **stock take** records what was found, what was not, and what has not been looked at yet.',
      'Maintenance records every service and what it cost; the register names anything that has cost more to keep than to buy.',
      '**Import from Excel** reads the list you already keep. The columns are matched on what your sheet CALLS them — Asset ID, Item Name, Modal, assignee, Purchased Date, Warenty date, Purchase Invoice, location, Room all work. An empty cell written as **-** is read as empty, not as a value.',
      'It shows you what it would do first and writes nothing until you say so. Anybody named as holding something who is not on the staff list is **reported, never invented** — those assets come in as in the office.',
      '**A 15-digit IMEI in a plain Excel cell is destroyed by Excel**, not by us: it saves 3.52E+14 and the real number is gone from the file. Those rows are named and come in **without** a serial rather than with a wrong one. Format that column as Text before saving to keep them.',
      '**Every new asset is given a code automatically** — `BNF-ASSETS-000001`, one running series per company. It is shown in the Add form as soon as you pick the company, **cannot be typed over**, and a number is never handed out twice, even after an asset is deleted or written off.',
      'The **prefix per company** is set under Lists — Asset code prefixes. Changing it never rewrites a code already issued; those are on stickers and signed slips. It only changes what the next one reads.',
      '**Click a name in Who holds what** to open that person’s ledger — the Tally-style page: who they are, what they hold, a movement ledger with a running balance, their handover papers and the repairs on their kit, under tabs. Step through people with Previous and Next.',
      'On that ledger a **transfer** is only called a transfer where somebody else’s handover of the same asset starts the day this one ends — otherwise a return is just a return. **Maintenance** lines carry a cost and move no quantity.',
      '**Maintenance → Export a report** picks columns the same way, in two shapes: **every service** (one line per repair) or **every asset** (what it has cost to own).',
      '**QR labels** print for the rows you tick, or for everything on screen — so a group button plus the label button is a sheet of stickers for that group.',
      '**Who holds what → ledger** is one person’s whole history: what they still have, what came back and when, days held, and what it cost. It opens from their employee record and from the exit page too.',
      '**Transfer to…** on that ledger hands things straight to somebody else without coming back to the office first. Tick what is going, pick the person, set one date and one condition — **both ledgers read “Transferred” on the same day**, so nothing belongs to nobody in between. Anything no longer with that person, written off, or already theirs is **refused by name**, so two people on two screens cannot move the same laptop twice.',
      '**Full register → By person** is the register staff-wise: a block for each person with their own subtotal, and everything nobody is holding at the foot under “In the office”. It lists **every asset**, so three mobiles are three lines with their serials — and **clicking a name opens that person’s ledger**.',
      '**Take it back** on that ledger returns everything in one go when somebody leaves: tick what came back, set the date and the condition once. What you untick stays out, and **nothing is written off or deducted** — not returned is not the same as lost.',
      'An asset standing against somebody with **no handover slip** is said so, and counted — it is a slip to get signed, not a missing asset.',
      '**Export a report** on the register lets you tick which columns you want — code, kind, serial, who has it, where, bought on, cost, vendor, invoice, warranty, AMC and the rest — and takes **Excel** or CSV. Your ticks are remembered.',
      'It exports **exactly what is on screen**, filters and all, or the whole register if you choose “Everything”. Money goes out as a number, so the column adds up, and the spreadsheet has a frozen header, a filter row and a live SUM at the foot.',
      '**Full register** is the whole thing as a document: every asset under its company (or group), each block adding up, one figure at the foot. Print it or take the CSV with the subtotals in it.',
      '**Groups** — Computer, Furniture, Mobile, Electrical, Network, Security, Office equipment, Vehicle, Tools. The buttons above the register narrow it to one, each carrying its own count, and the Group is a column in the CSV.',
      '**Your own groups: Assets → Lists → Categories.** A Category IS a group, and the Types under it are its kinds — put “Drone” under “Drones” and every drone moves there at once. What you have said wins over the built-in list; kinds you have not mapped keep following it. There is a **+ group** link beside the group buttons on the register.',
      'Taking a Category off the list puts its assets back where they were and **touches no asset** — the group is worked out from the kind every time, never stored beside it, so a corrected kind re-files its asset and no column can disagree with the row it sits in.',
      '**What is running out** sits above the register: a warranty that has **just** lapsed, one running out within 30 days, and the same two for AMCs. Clicking a line shows exactly those assets.',
      'A **blank warranty date is not an expired warranty** — it is counted separately as “nobody has said”. And a laptop out of warranty since 2024 is a count, not a line: it will be out of warranty tomorrow too.',
      '**The register is typed in like a sheet.** Kind, name, serial, department, cost and the warranty date are all cells — change one and it saves, no drawer, no form. Only what you actually changed is sent.',
      '**Company, department and kind** are dropdowns above the register, offering only what the register really holds.',
      '**Generate codes** is on the register itself as well as under Lists, because that is where you can see which rows still wear their spreadsheet’s ID.',
      'A group is **worked out from the kind**, never stored beside it — so correcting one chair’s kind moves it, and the Group column can never disagree with the Kind next to it. A kind nobody has mapped reads as **Other**, which means “nobody has said where this belongs”, not “miscellaneous”.',
    ],
    note: 'Every figure on the register is WHAT IT COST TO BUY, not what it is worth today — there is no depreciation in this app, so it is a register at cost and not a book value. Written-off assets are reported below the total, never inside it. And "Not checked" is NOT "missing". The stock take always shows three figures, never two — counting the third as the second invents losses and gets somebody asked to pay for a laptop that is in a drawer. And an unreturned asset at exit is named and valued, never deducted.',
  },
  {
    id: 'leaving',
    title: 'Somebody leaving — notice, clearance and the full and final',
    tab: 'people',
    keywords: [
      'exit', 'leaving', 'resign', 'resignation', 'notice', 'relieving', 'clearance',
      'full and final', 'fnf', 'settlement', 'gratuity', 'encash', 'encashment', 'last day',
      'terminate', 'absconded', 'retire', 'hisab', 'chhod', 'naukri chhodna', 'istifa',
    ],
    lines: [
      '**People → Leaving**, or `exit` on their row in Employees — the same panel either way. Record how they went — resigned, terminated, absconded, retired, contract ended — with the date they told you, the notice days and the last working day.',
      '**Somebody whose Active tick has already gone can still be recorded.** The picker lists them under “Already off the list”.',
      '**Notice works both ways.** Somebody who resigns and does not serve it owes it; somebody put out without notice is owed it. Which way round follows the exit type.',
      '**The clearance checklist** sits above the money, in two halves. The top half is **worked out** — assets still with them, a loan still owed, a penalty still being recovered, a claim unpaid, a staff login still live — and has no buttons: it clears when the thing itself is settled. The bottom half is **signed**: IT, Accounts, Store/Admin, the reporting manager and HR, each with a name and a date.',
      '**Nothing on the checklist blocks the payment.** It says what is open; you decide. A system that refuses gets worked around with a cash payment nobody records.',
      '**Leave encashment is PL only** by default — casual and sick leave lapse at the end of the year, and paying them out hands over days nobody had a claim to.',
      '**Gratuity** is reported with its rule and the length of service even when it is not due, rather than silently left off the page.',
      '**Take their assets back** from “See their whole asset ledger” — everything ticked, one date, one condition. Untick whatever is not coming back.',
      'Settling marks the full and final paid; after that the dates stop moving.',
      '**The relieving letter and the experience certificate** print from the bottom of the same page, with the company’s logo on them — one page, one file per person, ready to hand over or send on WhatsApp.',
      '**“All dues settled” is printed only when the full and final actually is.** It is read as a receipt by the next employer; the screen says so before you print.',
      'The conduct sentence is a **tick with its wording shown**, not boilerplate, and how they went decides the words — a dismissal does not read “resigned”.',
      'The **five steps** across the top say where somebody has got to and what is holding them up.',
    ],
    note: 'A LAST WORKING DAY STILL TO COME DOES NOT TAKE THEM OFF THE PAYROLL — somebody serving a month’s notice is still here, still on that month’s sheet and still paid; only a date that has passed takes them off. And an unreturned asset is NAMED AND VALUED, NEVER DEDUCTED — and the same goes for a loan: it is shown under “to recover” and taken off only if you decide to. Something docked and then found in a drawer cannot be undone once the payment has gone.',
  },
  {
    id: 'licenses',
    title: 'Software licences — keys, seats and renewals',
    tab: 'license',
    keywords: [
      'licence', 'license', 'software', 'key', 'serial', 'tally', 'windows', 'office',
      'antivirus', 'subscription', 'renewal', 'renew', 'expiry', 'expire', 'seat', 'seats',
      'install', 'domain', 'ssl', 'hosting', 'amc', 'perpetual', 'subscription',
      'chabi', 'sophtware', 'nabikaran', 'meyad', 'khatam',
    ],
    lines: [
      'Everything you are licensed to run: Tally, Windows, Office, the antivirus, eTimeTrackLite, the domain, the SSL certificate — with its key, its seats, what it costs and when it has to be paid again.',
      'The four figures at the top are **how many licences**, **how many renew within 30 days**, **how many have expired**, and **what it all costs in a year**. Each one opens the list behind it.',
      '**The key is shown as its last four characters.** Showing the whole key is a button, it asks what you need it for, and it goes on the audit trail — a key that has been read out cannot be called back. Closing the panel puts it away again.',
      'It is **never in an export and never in a list**, so the register CSV can be emailed safely.',
      '**Seats** — hand one to a person or name the machine it is on. What is in use is counted off that list, so the figure and the names can never disagree. Releasing a seat keeps the history: "who had Office in March" still has an answer.',
      'Leave the seat count **blank** for a site licence, a domain or a subscription nobody counts. That reads as "not counted" everywhere, which is not the same as zero.',
      '**Renewing** records what was paid and for which period, and moves the licence on. The licence row carries where it stands now; the renewals list carries what it has cost you.',
      '**Cancelling keeps the row** and releases nothing — the software is still installed on those machines the morning after you stop paying. Only a licence nothing has happened to can be deleted.',
      'Only the **name** is needed to save one. What is missing is said on the row instead, because a form that will not save until the invoice turns up is a register that stays empty.',
      'An expired or expiring licence also shows on the **Dashboard**, under the things waiting on somebody.',
    ],
    note: 'No renewal date is NOT an expired licence. A perpetual licence bought outright has no date and never will, so it never appears on a reminder list. But a SUBSCRIPTION with no date is not perpetual either — it is the one state nobody can plan for, so it is named on its own line. And eleven installs on a ten-seat licence is RECORDED and flagged, never refused: the install exists whether or not this register admits it.',
  },
  {
    id: 'hiring',
    title: 'Hiring — openings, candidates and taking somebody on',
    tab: 'hiring',
    keywords: [
      'hiring', 'vacancy', 'candidate', 'interview', 'recruit', 'apply', 'job', 'cv',
      'archive', 'archived', 'selected', 'rejected', 'history', 'file', 'documents',
      'purana', 'itihas', 'kagaz',
    ],
    lines: [
      'Openings belong to one of your own companies. A published opening has a link candidates can apply on, with name and mobile only.',
      'Candidates are scored against what the opening asks for, which orders the queue.',
      'Dragging a card through the pipeline produces the WhatsApp message to send.',
      '**Hire** turns the person who joined into an employee on that company, so they land on the salary sheet without being typed twice. It shows the **next free employee code** first — change it or leave it.',
      'Screened somebody **Eligible**? They appear under **“ready for the test”** on the Screening page, with the paper picker and a WhatsApp button right there.',
      'An evaluation goes **Submit → HR → department head → Management → Approve**. The head step is optional and asks who it is going to.',
      'Open a candidate and **Everything, in order** tells their whole story — added, applied, screened, paper drawn, paper sat, each round with its **particulars form and rating** to read on the spot, the offer, and the day they went on the payroll.',
      '**Documents** on that record take anything they handed over — Aadhaar, PAN, a marksheet, the last payslip. Nothing is required: a candidate owes you nothing, and the KYC list starts on their employee record.',
      'The candidate list filters by **where they are** — Selected, Rejected, Shortlisted and the rest — and **Add to payroll** is on the row itself.',
      '**Archive** is a place, not a delete. Somebody put on the payroll goes there by itself, because they work here now; **Restore** brings them back in one press and nothing about them is ever removed. Turning somebody down does NOT archive them — that is how the next opening finds them.',
    ],
    note: 'Nothing moves on its own — no auto-advance, no auto-reject. The match score orders a list and a test result is one more thing to weigh. Hiring needs the server: an apply link cannot live in a file on a laptop.',
  },
  {
    id: 'front-office',
    title: 'Front office — housekeeping, visitors and courier',
    tab: 'frontoffice',
    keywords: [
      'front office', 'reception', 'visitor', 'visitors', 'guest', 'courier', 'parcel',
      'housekeeping', 'cleaning', 'clean', 'inspection', 'daily report', 'front desk',
      'safai', 'mehmaan', 'aagantuk', 'parcel aaya', 'register',
    ],
    lines: [
      '**Front office** is the desk\u2019s own book: the housekeeping walk, who visited, and every courier in or out \u2014 one date at a time, picked at the top of the tab.',
      '**Dashboard** is the day at a glance \u2014 the figures, the areas flagged today with their remarks, and who is still in the building. **Housekeeping** is the walk itself.',
      '**Housekeeping.** Each area is Clean, Not clean or Needs attention, with a remark. **An area you have not looked at stays blank** — it is counted as “not checked”, never as clean.',
      '**Visitors.** Name, company, visitor type, purpose, who they are here to meet (picked from the staff list) and a 10-digit mobile. The **pass number is given by the system** — VIS-2026-0001 — and never typed.',
      'Press **Out now** when they leave; until then they count as still in the building. A check-out can be **corrected or taken back**, and the arrival is never touched. **Print** hands them a pass with the company logo and a QR code that carries the pass number and nothing else.',
      'Quick filters: **All / Currently inside / Checked out**, plus one box that searches the name, the mobile or the pass number, and filters by who was met and visitor type.',
      '**Courier.** Inward or outward, the courier company, the AWB/tracking number, who it is from or to, which employee it is for, the department, what the parcel is, and who received it. An inward parcel gets its own number — CR-IN-2026-0001.',
      '**A parcel for somebody stays “pending handover” until they take it.** Open it and write the handover: who took it, whether they acknowledged it, any remark. **Writing the handover is what marks it delivered** — the status is not a box anybody ticks. Use **Returned** when it went back to the courier.',
      '“Still in the drawer” lists everything pending, whatever date is on screen — a parcel from Tuesday is still undelivered on Friday.',
      '**Daily report** compiles all three into the text for the group. **Send on WhatsApp** opens WhatsApp with it already typed — pick the chat and press send — or **Copy the text** and paste it yourself.',
      '**Monthly summary** rolls the month up six ways — by date, visitor’s company, branch, person met, visitor type and purpose — with the average visit, and Print and Excel on each. Below it, the housekeeping side: days recorded, flags by area, and the text to copy.',
      '**Areas** is the list the walk runs down \u2014 add your own (Meeting Room 1, Meeting Room 2, HR Admin, whatever you actually walk) and take off the ones you do not.',
      '**Click a name to change it.** Renaming keeps that area\u2019s whole history; typing a new name starts a new area with none.',
      '**\u201cOff the list\u201d is not a delete.** Everything taken off is listed under **Off the list** with a **Put it back** button, and every day it was flagged for is still on the record \u2014 so an area that went off in March comes back in June as the SAME area, not a second of it.',
      '**Add the usual areas** appears whenever one of the twelve the app knows is missing altogether, and adds only the missing ones.',
      '**history** on an area opens that one place down the days \u2014 date, verdict, remark and who looked \u2014 with days checked, clean, flagged and **not checked** over the dates you pick. The area name on the **Monthly summary** opens the same thing, so \u201cParking: 4 days\u201d can say WHICH four.',
      'All four papers print as documents: the check, the visitor register, the courier register and the monthly summary. The visitor and courier registers also print for a whole month.',
      'Reception can be given a login that reaches **only** this: Admin → Logins → Front office.',
      'The same day’s figures also sit on the **Dashboard**, under the roll call, and follow the same ‹ › arrows.',
    ],
    note: 'NOTHING IS DELETED HERE. A visitor or a courier entry is ARCHIVED — it leaves the register and stays on the record, with who archived it; “Clear this day” does the same to the whole day. Every registration, check-out, correction, handover and status change is on the audit trail with the old value, the new one and who. NOTHING IS SENT BY ITSELF. “Send on WhatsApp” fills the message in and YOU choose the chat, so a report cannot land in the wrong group. Sending it unattended at a set time needs a WhatsApp number the app is allowed to send from — ask, and it can be set up. A DAY NOBODY WALKED IS NOT A CLEAN DAY. Clean, flagged and not-checked are three separate figures everywhere, so an empty morning can never read as a spotless office. And a visitor with no out time has simply not been signed out — it is not a time anybody left.',
  },
  {
    id: 'company-logo',    id: 'company-logo',
    title: 'The company logo on the offer letter',
    tab: 'admin',
    keywords: [
      'logo', 'letterhead', 'letter head', 'brand', 'offer letter', 'company logo',
      'image', 'picture', 'upload logo', 'logo lagana', 'nishan', 'chitra',
    ],
    lines: [
      '**Admin → Company logos.** One logo per company, because these are separate businesses — an offer from BOOKNFLY must not go out under SCALE VISORY’s mark. The letter picks up the logo of the opening’s own company.',
      'The same logo is on **every payslip**: the slip on screen, the printed stack, and the file you forward on WhatsApp. It comes from that person’s own company, and an employee printing their own slip gets it too.',
      'PNG, JPG, WEBP or GIF, up to 512 KB. A wide wordmark works best; it prints about 54 pixels tall. Replacing one simply replaces it.',
      'The picture travels **inside** the letter, so it still shows on a phone with no signal — and nothing is fetched from this server when a candidate opens it.',
      '**No logo is not a fault.** A company without one has its name printed in type, exactly as the letter always looked. Nothing is blocked for want of a picture.',
      'The offer screen says so where you are standing: if that company has no logo it tells you, rather than letting you find out from the paper.',
    ],
    note: 'SVG IS NOT ACCEPTED. An SVG can carry script, and this letter is emailed, forwarded and opened on somebody else’s phone. Use a PNG.',
  },
  {
    id: 'hiring-test',
    title: 'The written test — questions, papers and the link',
    tab: 'hiring',
    keywords: [
      'test', 'exam', 'question', 'paper', 'aptitude', 'mcq', 'marks', 'score',
      'pariksha', 'sawal', 'prashn', 'question bank', 'starter',
      'result', 'results', 'natija', 'parinam', 'pass', 'fail', 'cheating', 'flag',
    ],
    lines: [
      'Tests → **Ready-made questions** fills an empty bank in one click — general aptitude, computer knowledge, email and internet, English, and ten each for Travel Consultant and Accounts. It also sets up the twenty-question paper: fifteen general, five for the seat, about thirty seconds each, so ten minutes.',
      'Pressing it again adds only what is missing, so a question you have reworded is never put back. Every question is yours to **edit or remove**.',
      'A **paper** says how many questions to draw from each position or topic. Add your own questions under a new position and a paper can draw from it.',
      'The candidate opens the link and sees what the test is — **the clock only starts when they press Start**, so tapping the link to look costs them nothing. A reload keeps their answers.',
      'A test is handed out from the **candidate’s own application** or from the Screening page, not from the bank — that is where somebody is deciding about one person. The link is theirs and opens one attempt.',
      '**One question at a time** is the default: each has its own seconds, and when they run out the next one comes up by itself with no going back. Set it per paper under “How it is put to them”.',
      'It marks itself. Open the candidate and **Written tests** lists every paper they were given: the score, and **Answer sheet** showing each question, what they chose and what was right, broken down by topic.',
      'Not sat yet? The same row has **Send the link** (WhatsApp) and **Copy link**. It sends the SAME link \u2014 never a fresh paper.',
      '**Everybody’s results together** are on Screening & tests under **Test results** — search by name, mobile, job or test, narrow to Qualified / Not qualified / Flagged / Clean, and Export CSV. A paper stays on that list after the person is taken on or turned down.',
      '**Flagged** means the page recorded something: they left the test and for how long, tried to copy or paste, answered half the paper in under two seconds, or ran out of time. **Clean** is said out loud, never left blank.',
    ],
    note: 'Each question has its own seconds and the next comes up by itself — but what is ENFORCED is the whole paper’s clock, which the server times from its own start. A flag catches tab-switching, copy and paste, impossible speed and timeouts — it cannot catch a second phone or another person in the room, so treat it as a reason to ring somebody back, never as proof. Every candidate gets a different draw and a different order of answers, and the right answer never reaches their screen. A score is one more thing to weigh: nothing advances or rejects anybody on its own.',
  },
  {
    id: 'test-results-next',
    title: 'After the test \u2014 who to call for interview, and tidying the list',
    tab: 'hiring',
    keywords: [
      'test result', 'score', 'shortlist', 'interview', 'schedule', 'call for interview',
      'delete', 'remove', 'answer sheet', 'qualified', 'flagged',
      'bulana', 'hatana', 'delete karna', 'interview rakhna', 'result',
    ],
    lines: [
      '**The order of the day is on Screening & tests**: no paper yet \u2192 paper sent \u2192 **Qualified, ready for interview** \u2192 Not qualified \u2192 **Interview booked**. The qualified group is the list of people to ring; once somebody is booked their row says the date instead of offering to book again.',
      '**Screening & tests \u2192 Test results** is every paper anybody has sat. **Click the name** to open them \u2014 their application if they applied to an opening, their record if they are only on the list.',
      '**Schedule interview** on the row opens the same application. The booking itself \u2014 when, round, mode, interviewer, where or the link \u2014 is on that panel, because that is where everything else about the person is.',
      '**The score decides nothing.** It orders a list; you choose. A flagged paper is a reason to ring somebody back, never proof.',
      '**Remove** takes a paper off the list \u2014 a practice run, a test somebody sat twice. It is **not deleted**: it moves to **Removed**, which is a place you can open, and **Put it back** returns it. Who removed it and when is on the record.',
      'To take a whole person off the list, use **Archive** on the Candidates tab \u2014 also a place, also reversible. Nothing about a candidate is ever wiped.',
    ],
    note: 'Nothing on this screen moves anybody a single stage. A score, a flag and a removal are all records; the decision is taken on the application, by a person.',
  },
  {
    id: 'hiring-reports',
    title: 'Who applied \u2014 and the other hiring reports',
    tab: 'hiring',
    keywords: [
      'report', 'applications', 'applied', 'applicants', 'who applied', 'form',
      'apply form', 'new candidates', 'schedule', 'interview schedule', 'funnel',
      'kisne apply kiya', 'arji', 'form bhara', 'report nikalna',
    ],
    lines: [
      '**Hiring \u2192 Reports** opens on **Applications received**: everybody who applied, newest first \u2014 when, their reference, mobile, the opening, how they applied, what they expect and whether a CV is attached.',
      'Somebody who fills the apply form in is on it **at once**, with no step in between.',
      'The other reports read other records: **Interview schedule** reads the interviews, **Offers out** reads the offers, **Selected** reads the selections. A report being empty usually means nothing of THAT kind has happened yet \u2014 each one says so in its own words.',
      '**To book an interview, go to the Pipeline**, open the person and use Schedule interview. They appear on the schedule once it is booked.',
      'Every report narrows by the filters above it, and prints and exports as a document \u2014 not as a photograph of the screen.',
    ],
    note: 'A CV is shown as yes-or-nothing and NEVER as a file name: it is read through a link tied to that one candidate, so a report that prints or is emailed cannot carry a way into somebody else\u2019s CV.',
  },
  {
    id: 'candidate-file',
    title: 'Printing a candidate\u2019s whole file',
    tab: 'hiring',
    keywords: [
      'print', 'pdf', 'file', 'pack', 'resume', 'cv', 'download', 'boss',
      'report', 'nikalna', 'print karna', 'poori detail',
    ],
    lines: [
      'Open a candidate \u2192 **Print the whole file**. One document: the screening, each round\u2019s particulars form, the interviewer\u2019s evaluation, every test answer sheet and the offer.',
      'It opens on any machine and prints to PDF \u2014 nothing is loaded from the internet.',
      'The **CV comes down beside it** as its own file. A CV is a PDF or a Word document and cannot be put inside a printed page.',
      'Anything not done yet is named in the contents \u2014 \u201cevaluation: not written up\u201d \u2014 rather than left out.',
    ],
    note: 'ONE FILE HOLDS ONE PERSON. It is built from one candidate\u2019s records and never from a list, because this is the file most likely to be forwarded. It also ASSEMBLES: every figure in it was worked out once and stored, so the file and the screen cannot disagree.',
  },
  {
    id: 'rights',
    title: 'Who may see and change what',
    tab: 'admin',
    keywords: [
      'rights', 'permission', 'role', 'access', 'login', 'restrict', 'hide salary',
      'adhikar', 'haq', 'rok', 'chhipana', 'tankhwah chhipana',
    ],
    lines: [
      'Each login has a **role**, which says what KIND of thing they may do \u2014 look, change, approve, or change the installation itself.',
      '**Admin** everything, including logins, branches, a month\u2019s settings and deleting a month. **Manager** everything HR does plus **approving** \u2014 a month\u2019s payroll, locking it, an offer \u2014 and nothing administrative. **HR** employees, attendance, leave, payroll and assets, salaries included, but cannot approve. **Accounts** the same as HR, started off with Salary sheet and Reports ticked. **Operator** fills things in and **cannot delete, archive or clear anything**. **Viewer** looks and changes nothing. **Staff** their own record only.',
      '**If somebody only needs to approve, make them a Manager, not an Admin.** That is why Admins multiply.',
      'Beside it, **May use** says WHERE. Tick the parts of the app that login covers — Salary sheet, Attendance & time, Leave, Loans, Employees, Assets, Hiring, People, Reports.',
      '**Nothing ticked means everything**, which is what every login already was, so this changes nobody until you narrow one. Unticking the last box puts it back to everything rather than locking somebody out.',
      'A login **without Salary sheet sees no pay figure anywhere** — not on the sheet, not on a payslip, not on the employee master, not in an export. It can still mark attendance on the same month.',
      '**Tick the modules on the Add-a-login form itself.** The form says in words what the person will be able to see before you press Add it.',
      '**An Admin cannot be narrowed.** An Admin can open this screen and untick their own ticks, so a fence drawn around one is not a fence. For somebody who should see part of the app, make them **HR** or a **Viewer** and tick what they need.',
      '**Nobody can change their own role or ticks** — another Admin has to. Your own name and password are still your own.',
    ],
    note: 'Enforced on the SERVER, not by hiding tabs. A tab that is not ticked cannot be reached by knowing its address either — hiding it is only a courtesy so nobody is shown a door that opens onto an error.',
  },
  {
    id: 'theme',
    title: 'Light or dark',
    tab: 'dashboard',
    keywords: [
      'theme', 'dark', 'light', 'night', 'colour', 'color', 'mode', 'bright',
      'kala', 'safed', 'andhera', 'rang',
    ],
    lines: [
      'The switch is at the bottom of the left rail, under the version: **Auto / Light / Dark**.',
      '**Auto** follows the computer or phone, every time it changes — a phone that goes dark at sunset takes the app with it, with no reload.',
      'Light and Dark overrule the device, so a laptop that is dark all day can still show this app light.',
      'The choice is remembered on that browser only. Each person, and each machine, picks their own.',
    ],
    note: 'In a private window the choice still works for that tab, it simply will not survive a reload — nothing there is allowed to be remembered. The sign-in screen follows the device by itself, because it is the one screen you see before you can reach the switch.',
  },
  {
    id: 'settings',
    title: 'Settings — the month\u2019s rules and the usual day',
    tab: 'admin',
    keywords: ['settings', 'configuration', 'hours per day', 'pt slab', 'lunch', 'lock', 'setup'],
    lines: [
      'The month’s own settings — hours a day, the PT slab and amount, whether the lunch break is deducted, the late/early policy, and locking the month.',
      '**The usual day** sets the office timings once, and shows what they add up to.',
      'Working days are fixed at 26 and shown as fixed text, not a box.',
    ],
    note: 'Month settings are held per month on purpose, so a slab changed now never rewrites a month that has already been paid.',
  },
  {
    id: 'companies',
    title: 'Companies and the filter',
    tab: 'employees',
    keywords: ['company', 'filter', 'branch', 'booknfly', 'scale', 'rename'],
    lines: [
      'The company picker beside the month narrows the whole app — the salary sheet, attendance, employees, the dashboard, everything.',
      'It is remembered between visits.',
      'Companies can be renamed or deleted from their chip under Employees.',
    ],
  },
  {
    id: 'audit',
    title: 'The audit trail',
    tab: 'people',
    keywords: ['audit', 'trail', 'history', 'who changed', 'log', 'record'],
    lines: [
      'Records a figure typed over the sheet, by name and column; an attendance mark that was CORRECTED; an approval or a uniform verdict; closing a month; and switching the late/early rule.',
      'An override handed back reads "(formula)", never 0.',
    ],
    note: 'Filling in a blank day is NOT a change, so "Mark everyone Present" and the punch import stay out of the trail, while an absence turned into sick leave is kept.',
  },
  {
    id: 'backup',
    title: 'Backups, and starting again empty',
    tab: 'reports',
    keywords: ['backup', 'restore', 'erase', 'reset', 'data', 'copy', 'safety'],
    lines: [
      'Take a backup from Reports before anything large — an import, a bulk change, a month close.',
      'Restoring puts a backup back in place of what is there now.',
      '**Start again, empty** clears everything. It asks twice: the backup, then the word ERASE.',
    ],
    note: 'In the single-file build the browser is the ONLY copy of the data. "Start again, empty" empties that browser, not the file — the same file opened in another browser still has whatever was built into it.',
  },
  {
    id: 'two-builds',
    title: 'The two builds — server and single file',
    tab: 'admin',
    keywords: ['standalone', 'offline', 'single file', 'html', 'server', 'build', 'version'],
    lines: [
      'The hosted build runs on a server and is the one with logins, uploads, apply links and punch links.',
      'The single-file build is one HTML file that runs from a laptop with no server and no internet, keeping its data in that browser.',
      'They are built from the same source, so the calculations cannot differ.',
      'The version and the build time are beside the title. Click them for what changed.',
    ],
    note: 'Anything needing a login, a file upload or a link somebody else opens can only work on the server, and the single file says so on each of those screens rather than showing an empty box.',
  },
];

/* ---------------- searching ---------------- */

const words = (text) =>
  String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9₹]+/i)
    .filter(Boolean);

const plain = (topic) =>
  [topic.title, ...(topic.lines || []), topic.note || '']
    .join(' ')
    .replace(/\*\*/g, '')
    .toLowerCase();

/**
 * Topics that answer this, best first.
 *
 * A word in the TITLE beats a keyword beats a mention in the body, because
 * "leave" appears somewhere in half of these and the topic actually called
 * Leave is the one somebody means. Every word of the query has to land
 * somewhere, so "sunday excel" does not return everything about Sundays.
 *
 * An empty query returns everything, in the order written — which is the
 * reading order of the app, so the panel opens as a contents page rather
 * than as an empty box.
 */
export function searchHelp(query, topics = HELP) {
  const terms = words(query);
  if (!terms.length) return topics.map((topic) => ({ topic, score: 0 }));

  const found = [];
  for (const topic of topics) {
    const title = topic.title.toLowerCase();
    const keys = (topic.keywords || []).map((k) => String(k).toLowerCase());
    const body = plain(topic);

    let score = 0;
    let everyTerm = true;
    for (const term of terms) {
      let best = 0;
      if (title.includes(term)) best = title.split(/\s+/).includes(term) ? 100 : 70;
      else if (keys.includes(term)) best = 60;
      else if (keys.some((k) => k.includes(term))) best = 40;
      else if (body.includes(term)) best = 15;
      if (!best) everyTerm = false;
      score += best;
    }
    if (everyTerm && score > 0) found.push({ topic, score });
  }
  return found.sort(
    (a, b) => b.score - a.score || a.topic.title.localeCompare(b.topic.title)
  );
}

export const helpTopic = (id) => HELP.find((t) => t.id === id) || null;
