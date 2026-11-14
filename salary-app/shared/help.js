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
    keywords: ['employee', 'record', 'add', 'master', 'profile', 'karmchari', 'staff', 'joining'],
    lines: [
      'Click a name to open the record: employment, personal, statutory numbers (PAN, Aadhaar, UAN, ESIC), bank details, salary breakup and a change history.',
      'A jump row at the top goes straight to Documents & KYC, Bank, Statutory, Salary breakup or History.',
      'Every change to a tracked field (salary, designation, department, manager, bank account…) is kept with its date.',
      '**Still to finish** lists anybody whose record is incomplete, newest joiner first, each step saying what breaks without it.',
    ],
    note: 'It is a checklist, not a gate. Nothing blocks a save or a payslip — only a joining date and a salary are genuinely required.',
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
    keywords: ['asset', 'laptop', 'handover', 'stock take', 'maintenance', 'amc', 'barcode', 'saman'],
    lines: [
      'Every asset gets a code like `BPL-LAP-014`, a printable barcode label, purchase details, warranty and an AMC.',
      'Issuing and returning are logged — who held it, from when, and what was handed over with it.',
      'A **stock take** records what was found, what was not, and what has not been looked at yet.',
      'Maintenance records every service and what it cost; the register names anything that has cost more to keep than to buy.',
    ],
    note: '"Not checked" is NOT "missing". The stock take always shows three figures, never two — counting the third as the second invents losses and gets somebody asked to pay for a laptop that is in a drawer. And an unreturned asset at exit is named and valued, never deducted.',
  },
  {
    id: 'hiring',
    title: 'Hiring — openings, candidates and taking somebody on',
    tab: 'hiring',
    keywords: ['hiring', 'vacancy', 'candidate', 'interview', 'recruit', 'apply', 'job', 'cv'],
    lines: [
      'Openings belong to one of your own companies. A published opening has a link candidates can apply on, with name and mobile only.',
      'Candidates are scored against what the opening asks for, which orders the queue.',
      'Dragging a card through the pipeline produces the WhatsApp message to send.',
      '**Hire** turns the person who joined into an employee on that company, so they land on the salary sheet without being typed twice.',
    ],
    note: 'Nothing moves on its own — no auto-advance, no auto-reject. The match score orders a list and a test result is one more thing to weigh. Hiring needs the server: an apply link cannot live in a file on a laptop.',
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
