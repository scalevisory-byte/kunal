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
    keywords: ['mark', 'code', 'absent', 'present', 'half day', 'HF', 'CL', 'SL', 'PL', 'UL', 'AD', 'WH', 'SP', 'HP', 'hajri', 'chutti', 'legend'],
    lines: [
      '**P** present · **A** absent, costs a day · **HF** half day, costs half · **AD** absent, costs two days.',
      '**CL / SL / PL** casual, sick and privilege leave — paid in full and counted against the quota.',
      '**UL** unpaid leave — costs a day like A, but counted separately so absences are not inflated.',
      '**WH** work from home — paid in full, and it is a day worked.',
      '**S** the weekly off · **SP** worked on the off day · **PH** paid holiday · **HP** worked the holiday.',
      'SP and HP are paid through the Sunday register, not the salary sheet.',
    ],
    note: 'Click a day and pick the mark by NAME — each option says what it costs. Typing the code still works.',
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
    keywords: ['time', 'in out', 'lunch', 'clock', 'working hours', 'samay', 'ghante', 'timing'],
    lines: [
      'The **Time** tab takes four times a day: in, lunch out, lunch in, out. Type them however you like — `9:30`, `930`, `9.30`, `6pm`, `18:30` all read.',
      'out − in − lunch is compared with the day’s expected hours, and the difference becomes that day’s short hours or overtime.',
      '**Usual timings** sets the office day once; the tab shows what it adds up to so a wrong default cannot quietly dock everybody.',
      'Whether the lunch break comes off the day is a setting — see Settings.',
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
      'Click a row on the salary sheet to see that person’s payslip, and print it or save it as PDF.',
      '**Send payslips** on the toolbar writes one small HTML file per person, which you can forward on WhatsApp. It opens on any phone with no login, no app and no network, and prints to PDF.',
      'A free line typed once rides onto every slip.',
    ],
    note: 'ONE FILE HOLDS ONE PERSON. Never forward the whole single-file app to an employee — that one carries every salary in the company.',
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
    ],
    note: 'There is no self-service password reset. If somebody forgets theirs, an admin resets it here and hands over a new one-time password.',
  },
  {
    id: 'roles',
    title: 'Who can do what',
    tab: 'admin',
    keywords: ['role', 'admin', 'hr', 'viewer', 'permission', 'access', 'rights'],
    lines: [
      '**Admin** — everything, including logins, a month’s settings and closing a month.',
      '**HR** — employees, attendance, leave, payroll and assets, salaries included. Cannot change settings or logins.',
      '**Viewer** — can look at everything and change nothing.',
      '**Staff** — their own record only, through their own page. They cannot read any office screen at all.',
    ],
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
    id: 'assets',
    title: 'The asset register',
    tab: 'assets',
    keywords: [
      'asset', 'laptop', 'handover', 'stock take', 'maintenance', 'amc', 'barcode', 'saman',
      'import', 'excel', 'list', 'imei', 'serial', 'bulk', 'upload', 'suchi',
      'group', 'category', 'computer', 'furniture', 'mobile', 'shreni', 'prakar',
      'code', 'prefix', 'number', 'barcode', 'sticker', 'department', 'number banana',
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
      '**Who holds what → ledger** is one person’s whole history: what they still have, what came back and when, days held, and what it cost. It opens from their employee record and from the exit page too.',
      '**Take it back** on that ledger returns everything in one go when somebody leaves: tick what came back, set the date and the condition once. What you untick stays out, and **nothing is written off or deducted** — not returned is not the same as lost.',
      'An asset standing against somebody with **no handover slip** is said so, and counted — it is a slip to get signed, not a missing asset.',
      '**Full register** is the whole thing as a document: every asset under its company (or group), each block adding up, one figure at the foot. Print it or take the CSV with the subtotals in it.',
      '**Groups** — Computer, Furniture, Mobile, Electrical, Network, Security, Office equipment, Vehicle, Tools. The buttons above the register narrow it to one, each carrying its own count, and the Group is a column in the CSV.',
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
      '**People → Leaving.** Record how they went — resigned, terminated, absconded, retired, contract ended — with the date they told you, the notice days and the last working day.',
      '**Notice works both ways.** Somebody who resigns and does not serve it owes it; somebody put out without notice is owed it. Which way round follows the exit type.',
      '**The clearance checklist** sits above the money, in two halves. The top half is **worked out** — assets still with them, a loan still owed, a penalty still being recovered, a claim unpaid, a staff login still live — and has no buttons: it clears when the thing itself is settled. The bottom half is **signed**: IT, Accounts, Store/Admin, the reporting manager and HR, each with a name and a date.',
      '**Nothing on the checklist blocks the payment.** It says what is open; you decide. A system that refuses gets worked around with a cash payment nobody records.',
      '**Leave encashment is PL only** by default — casual and sick leave lapse at the end of the year, and paying them out hands over days nobody had a claim to.',
      '**Gratuity** is reported with its rule and the length of service even when it is not due, rather than silently left off the page.',
      '**Take their assets back** from “See their whole asset ledger” — everything ticked, one date, one condition. Untick whatever is not coming back.',
      'Settling marks the full and final paid; after that the dates stop moving.',
    ],
    note: 'An unreturned asset is NAMED AND VALUED, NEVER DEDUCTED — and the same goes for a loan: it is shown under “to recover” and taken off only if you decide to. Something docked and then found in a drawer cannot be undone once the payment has gone.',
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
      'Each login has a **role** — Admin, HR, Viewer or Staff — which says what KIND of thing they may do: look, change, or change the installation itself.',
      'Beside it, **May use** says WHERE. Tick the parts of the app that login covers — Salary sheet, Attendance & time, Leave, Loans, Employees, Assets, Hiring, People, Reports.',
      '**Nothing ticked means everything**, which is what every login already was, so this changes nobody until you narrow one. Unticking the last box puts it back to everything rather than locking somebody out.',
      'A login **without Salary sheet sees no pay figure anywhere** — not on the sheet, not on a payslip, not on the employee master, not in an export. It can still mark attendance on the same month.',
      'Admin is not on the list: it follows the role. Locking somebody out of their own Logins screen with a tick is how an installation ends up with nobody who can fix it.',
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
