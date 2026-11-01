# Salary calculation software

A payroll app built to match the **April tab of `Salary_Sheet_2627.xlsx`** — the same
columns, the same formulas, the same attendance codes — so the numbers it produces can
be checked against the sheet it replaces.

It keeps the employee master, a month-by-month attendance grid, in/lunch/out times with
the hours they come to, and the full salary calculation, and it exports back out to Excel
in the same layout. A **Dashboard** puts the month's headline numbers and anything that
needs attention on one screen.

---

## What it calculates

Every column of the April tab, in order:

| Sheet | Column | How it is worked out |
|---|---|---|
| AH | Working Days | Always 26 — see below |
| AI | Sunday | Sundays/holidays worked — counted from `SP`/`HP` marks, or typed |
| AJ | Absent Days | `A` = 1, `HF` = 0.5, `AD` = 2 — counted from the grid, or typed |
| AK | Present Days | Working days − absent days |
| AL | Salary | Monthly salary |
| AP AQ AR | Per day / hour / minute | `AL / 26`, `÷ hours per day`, `÷ 60` |
| AN | Absent Salary | Day rate × absent days |
| AO | Gross Salary | Salary − absent salary |
| AS AT | OT/LT | Short hours and overtime in minutes × per-minute rate |
| AU | Additions / Deductions | Two boxes — **Add** and **Deduct** — typed by hand, with a remark |
| AV | Gross Salary | `ROUND(AO + AT + AU)` |
| AW | PT | `200` when the month's gross is above `12,000` |
| AX AY | ESI / PF | Entered per employee |
| AZ | Net Payable | Gross − PT − ESI − PF − loan instalment. The last column on the sheet. |
| BD | Sunday Salary | Sundays worked × day rate — **on the Sunday register only**, not here |

### Attendance marks

Clicking any day in the grid opens a menu of the marks **by name**, each showing what it
does to the salary — no need to remember the codes. Typing the code still works.

| Mark | Means | Effect on salary |
|---|---|---|
| `P` | Present | — |
| `A` | Absent | −1 day |
| `HF` | Half Day | −0.5 days |
| `CL` | **Casual Leave** | — |
| `SL` | **Sick Leave** | — |
| `PL` | **Privilege Leave** | — |
| `UL` | **Unpaid Leave** | −1 day |
| `PH` | Paid Holiday | — |
| `SP` | Sunday Present | +1 day's pay |
| `HP` | Holiday Present | +1 day's pay |
| `WH` | Work From Home | — |
| `S` | Sunday (off) | — |
| `AD` | Absent (2 days) | −2 days |

A day left blank counts as worked.

### Marking a lot of days at once

| To do this | Where |
|---|---|
| Everybody, every blank day | **Mark everyone Present** on the toolbar — Sundays as S |
| One company only | Pick it on the **Company** strip first, then the same button |
| One person's whole month | **Fill blanks…** at the right-hand end of their row |
| **One day, for a group of people** | **Click the date** in the header |
| **One person, over a stretch of days** | **A date range…** in the menu at the end of their row |

A date range is how a fortnight off or a long illness gets marked: pick the two dates and
the mark, and it says how many days that is and what it costs before you press it. It
replaces whatever is on those days, and **leaves Sundays alone** — they are an off day
already, and marking one absent would dock a day nobody was due to work. Choosing a Sunday
mark flips that round: the range then covers only the Sundays in it, which is how a run of
worked Sundays goes in.

Clicking the date in the header is how a festival holiday gets marked. Eid is a paid holiday for some of the
staff and an ordinary working day for the rest, so "everyone" is the wrong tool: click the
date, choose the mark, then choose who it applies to — everyone shown, a group, or names
ticked off a list. It says on the button how many people it is about to change.

Because it usually runs *after* everybody has been marked Present, it replaces marks
already on that day by default, and tells you how many that is before you press it.

For festivals there is a better way than marking each one by hand — see below.

### Festivals and religion

A festival is rarely a holiday for the whole office: Eid is paid leave for the Muslim staff
and an ordinary working day for the rest, Diwali the other way round. Two things make that
work.

**1. Religion, on the employee master.** A free-text column with the usual suggestions —
anything typed into it is accepted, and it is only ever used to decide which festivals
somebody gets paid for. Filling it in for a whole workforce takes about a minute: tick the
box at the top of the employee list to select everyone on screen, type the religion, press
**Apply**, then search out the handful who differ and give them theirs.

```
tick all → "Hindu"  → Apply                    70 done
search "Abdulhak" → tick → "Muslim" → Apply
search "Sameer"   → tick → "Muslim" → Apply    …and so on
```

**2. Festivals & holidays**, at the top of the attendance tab. **Type the name and the
religions tick themselves** — Diwali is Hindu, Bakri Eid is Muslim, Christmas is Christian,
Mahavir Jayanti is Jain, Gurpurab is Sikh. Spelling does not matter much: *Deepavali*,
*Bakrid*, *Ramzan Eid*, *Uttarayan* and *Gurpurab* all find the right one. Press **Apply**
and Paid Holiday is written onto that day for exactly those people.

The ticks are a starting point, not a rule — change them, or clear them all for a day that
covers the whole office. Religions nobody on the staff list carries are named rather than
ticked, so a festival never quietly applies to nobody.

> **The date is never guessed.** Almost every festival on the list follows a lunar calendar
> and moves by a fortnight or more between years, and a wrong date here costs somebody a
> day's pay. Only the handful with a genuinely fixed date fill themselves in — Republic Day,
> Independence Day, Gandhi Jayanti, Labour Day, Uttarayan and Christmas — and those are also
> offered as a one-click row when they fall in the open month.

They stay on a list rather than being marked and forgotten, so the month carries a record
of why those days are paid, and **Apply again** catches up anyone who joined since.

Apply a festival *after* **Mark everyone Present**, not before: it writes over whatever is
on that day. A paid holiday costs nothing, so nobody's salary moves.

### Statutory registers

**Reports → Statutory registers** has the four compliance sheets, each on screen and as a
CSV:

- **Provident Fund** — UAN, member name, gross and EPF wages, the employee, pension and
  employer shares, NCP days. Wages are capped at ₹15,000 and the employee's share is
  whatever was actually deducted, so a fixed ₹1,800 stays ₹1,800.
- **ESI** — IP number, days paid, wages, both shares. Only people under the ₹21,000 wage
  limit appear; anyone above it is counted separately so you can check they should still
  be on the return.
- **Professional Tax** — who is over the slab, summed company by company for the challan.
- **Wage register** — the muster roll: every employee, days, gross, each deduction, and
  what was paid. It balances against the salary sheet by construction.

Anyone missing a UAN or an ESIC number is named, because that is what stops a return being
filed. Everything is derived from the calculated month and the employee records — nothing
is entered twice.

> **The EPFO and ESIC upload formats change from time to time.** These produce the standard
> fields, correctly worked out, in a spreadsheet you can read. Check a file against the
> portal's own template before uploading it rather than trusting it blind.

### The monthly report pack

**Reports → Monthly report pack** is the file that goes out each month. Three sheets, in the
layout already in use — not the app's own export:

| Sheet | What is on it |
|---|---|
| `Sep-26` | the salary sheet for everyone paid by bank |
| `Sep-26 CASH` | the same sheet for everyone paid in cash |
| `Sep-26 Sunday + Festival` | Sunday duty and festival days, settled on their own |

Same marks (`P` / `A` / `HF` / `W/O` / `H/O`), same columns, and **live formulas** rather
than typed numbers, so it can still be edited in Excel after it leaves.

Where the app knows more than those five marks, nothing is flattened and no number moves:
paid leave keeps its own `CL`/`SL`/`PL` code and counts as present, because the absent
formula only looks for `A` and `HF`; `AD` keeps its code and the formula is widened to weigh
it as two days. **A Sunday or a festival day that was worked shows as `W/O` or `H/O` on the
main grid** — the pay for it is on the third sheet, so it is never counted twice.

Two columns are added to the block — **OT / LT** and **Addition** — because the app has them
and a month carrying either would otherwise lose the money silently. With both at zero, which
is the ordinary month, every formula is the original one.

> **Gross Salary is the pay for the days worked, before the deduction**, which is where the
> sheet has always had it. The deduction, OT and addition come off in the Net, and PT is
> charged on what is left. Checked against the real September sheets: all **85 rows** across
> the bank and cash tabs reproduce both gross and net exactly.

The third sheet lists **only people owed something** — someone who simply took a festival as
a paid holiday is already paid for it in the monthly salary and is not here. Its festival
columns come from the festivals set on the **Attendance** tab, so set those first.

### Starting with a month already filled in

`make-seed.mjs` normally bakes in only the employee master. Given `--month` it bakes in a
whole month as well — the period, a payroll row each, and every attendance mark off the day
grids — so the file opens on a month already done rather than one waiting to be typed:

```bash
node scripts/make-seed.mjs "Sep-26.xlsx:Sep-26" "Cash.xlsx:Sep-26 CASH" \
  --month 2026-09 \
  --register "Cash.xlsx:SEP Sunday + Festival" \
  --festival "5:Janmashtami" --festival "25:Ganesh Visarjan"
```

`--register` layers the Sunday + Festival sheet on top, because that is the only record of a
Sunday (`SP`) or a festival day (`HP`) that was **worked**. `--festival` names the holidays,
since a sheet carries only their dates.

Where that sheet's **Net Amount** disagrees with days × day rate — a half day worked, an
arrear carried in from the month before — the typed figure wins and is kept as an override
with its remark, so a hand-adjusted row comes across exactly as it was.

> A register `HF` means **half the festival day was worked**. It is deliberately *not*
> written onto the main grid: there `HF` is half a day's **absence**, so it would dock the
> pay instead of adding to it. The half is settled through the amount instead.

The seed reaches **only a browser that has stored nothing**, so it can never overwrite real
work. Once a month has been touched in that browser, the stored copy is the only one.

Checked against the real September sheets, every total reconciles: salary 20,89,000,
deduction 11,150, PT 14,400, PF 3,600, net 19,01,078, and the Sunday register 44 people at
96,651 — each the same figure his own rows add up to.

### Which file am I looking at?

Every download of the standalone file lands as `SalarySheet (2).html`, `(3)` and so on, so
the name says nothing. **The build date is next to the title** at the top left — that is how
to tell an old copy from the newest one.

### The Dashboard

The month on one screen, and the tab the app opens on.

**The roll call comes first, not the money.** The top of the page is one day — today, or
the last day anybody was marked on — and answers who is in:

| | |
|---|---|
| **Present** | and *show all* lists them by name, with the time each came in |
| **Absent** | named, with which kind of absence |
| **On leave** | named, with which kind of leave |
| **Half day** | named |
| **Late in** | named, with the time and how late — measured against the usual start set on the Time tab, with 15 minutes' grace |
| **Early out** | named, with the time they left |
| **On overtime** / **Short hours** | named, with the minutes |
| **Not marked** | who has nothing on them for that day |

`‹` and `›` step through the days. Late and early need a clock time to judge, so a day
nobody clocked says so rather than reporting nobody late. A **half day, a leave, a holiday
or an absence is never counted as late or early** — it was not a full day to begin with.

**Nothing here is guessed.** Every figure is counted off the marks and clock times stored
against each person, so a day nothing has arrived for reads *Not marked*, not *Present*.
Attendance gets in three ways, and the roll call says so on a blank day rather than listing
everybody as unmarked:

| | |
|---|---|
| **Reports → Attendance machine** | the eSSL or ZKTeco export, a whole month at once |
| **Attendance** | the grid, with *Mark everyone Present* for a quick start |
| **Time** | in, lunch and out typed by hand |

- **The money**, below it — staff, gross, deductions, net payable, paid and still to pay,
  with a line comparing this month against the one before: net, gross, headcount and days
  lost, each with the change and the percentage. Days lost is the one where up is bad, and
  it is coloured that way round.
- **Last six months** — net payable per month as bars, with the headcount under each.
  Clicking one opens that month. Past months are read **without** being touched: a month
  looked at here never picks up today's new hires or a loan instalment.
- **Needs attention** — unpaid salaries, unpaid Sunday duty, anyone with no attendance
  marked at all, anyone over their leave entitlement, missing UAN or ESIC numbers, anyone
  on hold. Each line **names the first few people**, and opens where it can be fixed.
- **Attendance / Hours / Sunday duty / Statutory** — day counts, clock hours against
  expected, the Sunday register's total, and PF/ESI/PT/loans for the month.
- **New joinees, birthdays & anniversaries** — its own card, high up: who joined this month,
  whose birthday falls in it (and what they turn), whose work anniversary it is (and how
  many years), and who left, each dated. Anyone whose day falls on the day the roll call is
  showing also appears at the top of it — 🎂 and 🎉 beside the name.
  It runs off **Born** and **Joined** on the employee master, which are columns on the
  Employees table so a whole staff list can be filled in one pass; the card says how many
  people still have neither.
- **Who stands out this month** — the month's totals (days present, days lost, hours
  worked, late arrivals, early finishes) and then the names behind them: most days present,
  most days lost, most and fewest hours worked, most late arrivals, most early finishes,
  most hours short, most overtime.
- **How it goes out** — what is being paid by bank, cash, GPay or cheque, and how much of
  it has actually gone. `Gpay` and `GPAY` count as one route, not two.
- **Filing** — PF, ESI and professional tax with the ordinary Gujarat due dates. A
  reminder, not advice — check them against the portal.
- **By company** — staff, gross, deductions, net, attendance rate, days lost, paid and
  outstanding, per company.

It calculates nothing of its own: the same rows, through the same engine, as the salary
sheet. The company filter narrows it like every other tab.

### The Time tab — in, lunch, out

The attendance grid says whether somebody was here; the **Time** tab says for how long. Each
day carries four clock times — **In**, **Lunch out**, **Lunch in**, **Out** — and the hours
fall out of them:

```
worked = out − in − lunch break
```

Type them however you like: `9:30`, `930`, `9.30`, `9`, `6pm` and `18:30` all land on the
same minute, and the box tidies itself to `HH:MM` when you leave it. A shift that ends
before it started is read as finishing after midnight rather than as a negative day.

Two views, because they answer different questions:

- **One day, everybody** — a date, and every employee's times on it, with each person's
  hours for the month so far beside them.
- **One person, whole month** — one employee down the calendar, with the month's total.

**Fill the usual timings** puts your standard day onto every blank row on screen and leaves
anything already typed alone. The timings are yours to set (**change**) and are remembered
in that browser.

What the hours do to the pay:

| Worked | What happens |
|---|---|
| Within a few minutes of the day's hours | Nothing — the grace is 15 minutes |
| Short of them, past the grace | The shortfall goes into that day's `OT/LT` minutes and is deducted |
| Over them, past the grace | The excess goes in as overtime and is paid |
| Under 4½ hours | Marked `HF` and paid at half — the missing hours are **not** charged again |

The mark is only set to `P` or `HF` when the day has nothing on it, or carries a plain
`P`/`A`/`HF`. A day marked as leave, a holiday or a Sunday keeps its own mark and simply
records what was worked on it.

The times and the marks are stored on the same row, so **marking somebody Present on the
grid never wipes their hours**, and typing hours never disturbs a mark that was set on
purpose. The month's total travels with the row into the Excel export and the CSV as
**Hours Worked**.

### Punches from the attendance machine

**Reports → Attendance machine** brings a biometric export into the grid. eSSL, ZKTeco and
the rest all lay their reports out differently, so nothing is assumed: the file is read
first, the columns are pointed at by hand (with a guess made from the column names), a dry
run says exactly what it would do, and only then is anything written.

| In the file | Becomes |
|---|---|
| No punch that day | `A` |
| Worked under the half-day line | `HF` |
| A normal day | `P` |
| Worked under the day's hours, past the grace | `P` with the shortfall as minutes |
| Worked over | `P` with overtime minutes |

One row per punch works as well as one row per day — the earliest time of a day is taken as
the arrival and the latest as the departure, and both are written to the **Time** tab as
that day's in and out, so an imported day reads exactly like one typed by hand. A lunch
break typed by hand is left alone, since these reports rarely carry one. Names that are not
on the staff list are listed back rather than guessed at; the machine's own code can be
matched on instead, by putting it in each employee's **Code**.

The half-day line and the grace are the same numbers the Time tab uses, so a day read off
the machine and a day typed in are worth exactly the same.

This is a file import, not a live link. A real-time feed needs a server the machine can
reach, which is a different piece of work.

### The absent / present report

**Reports → Absent / present report**, in two shapes, because the phrase means both
depending on the day:

- **Month summary** — one line per person: present, half days, absent, CL/SL/PL, unpaid
  leave, holidays, Sundays off and Sundays worked, days at work, **days lost**, **payable
  days**, days still unmarked, and attendance %.
- **Day by day** — the muster roll, person against day, with the weekday on each column.
  This is the one that gets printed and signed.

Both export to CSV with a BOM, so Excel opens Gujarati names correctly.

Three things it is careful about:

- **Days lost is in days of pay, not a count of marks.** A half day costs 0.5 and an `AD`
  costs 2, so counting marks would understate it.
- **Attendance % is out of the days somebody was expected**, not out of the calendar. A
  Sunday off is not a day anyone failed to attend. A month with nothing marked reads as a
  dash, never as 100%.
- **Payable days is the figure the salary sheet actually charges**, not a second calculation —
  so a number typed over the formula shows here too, marked ✎, and the report and the payslip
  can never quietly disagree.

An unmarked day is paid as a working day, so the report says how many are still unmarked
before anybody files it.

### Salary structure — Basic, HRA and the rest

A salary was one number, which is all the sheet needed. An offer letter, a payslip, a Form 16
and the PF return are all written against a breakup instead: PF is charged on Basic, HRA
carries a tax exemption, and nobody can read "20000" and know either.

**Employees → a name → Salary structure** sets one. Basic, HRA, Conveyance and Medical are
typed; **Special allowance is not** — it is whatever is left of the salary.

#### The rule that makes it safe to add to a payroll already running

> **The breakup never changes what anybody is paid.**

`monthly_salary` stays the master total. Because Special is derived rather than stored, the
parts cannot drift away from it, and a month's gross, net, PT and deductions come out exactly
as they did before any of this existed — setting a breakup only changes how the same money is
*described*. There is a test asserting a month calculates identically with and without one,
and it was checked against the real October data: all 115 rows byte-identical, net ₹14,48,366
before and after.

Components that add up to **more** than the salary are an error, named with the amount over —
never a negative allowance.

#### On a payslip

With a structure set, the slip lists each component **as the month earned it** — already
pro-rated for the days absent, which the table above it states — and they add up to the gross
to the rupee, because Special absorbs the rounding. Without one it reads as it always has:
the month's salary, less the days absent. The Excel export and the monthly CSV gained the
same five columns, blank for anybody with no structure (zero would read as "no HRA").

#### For 114 people at once

Tick everyone and use **Split their salary**: Basic %, HRA as a % of Basic, and flat
conveyance and medical. Each person is split from **their own** salary, so one click cannot
give two people the same Basic. HRA defaults to 40% of Basic, not 50% — Vadodara and Surat
are not metros for that exemption. A small salary gets a trimmed allowance rather than a
negative Special.

#### PF is reported, never changed

The panel says what PF *would* be at 12% of Basic (capped at ₹15,000 of wages) next to what
is actually being deducted, and offers a button to match them. It never does it on its own:
that moves somebody's take-home, and is a decision rather than a calculation.

### PF, ESI and professional tax

PF and ESI used to be numbers typed against each employee, which the app simply deducted.
That was honest while a salary was one figure — there was nothing to work PF out *of*. Now
that a salary has a Basic, there is.

**Employees → a name → PF, ESI and professional tax** shows, per person: what each is charged
on, what the rule gives, what is actually being deducted, and a switch between the two.

| | Rule |
|---|---|
| **PF** | 12% of **Basic**, capped at ₹15,000 of wages. With no breakup set there is no Basic to charge, so it falls back to the gross — which is what this app has always reported. |
| **ESI** | 0.75% of gross while gross is **≤ ₹21,000**; nothing above it. Shares round **up** to the next rupee, which is the ESIC's own rule. |
| **PT** | Gujarat: nil to ₹12,000, ₹200 above. Held as a slab list, so another state is a line of data. A period's own threshold and amount still win, so no month already paid moves. |

#### Nothing switches itself on

Every employee starts on **Fixed amount** — deducting exactly the number already typed, as
before. Only choosing **Work it out**, per person or in bulk, changes a deduction. Working a
figure out is a calculation; changing what lands in somebody's bank account is a decision.

The panel says what switching would cost **before** it is switched: *"would deduct ₹1,215 more
in a full month — they would take home ₹1,215 less"*. The bulk switch confirms first, because
unlike the salary split this one really does move money.

Checked against the real October data: with everybody left on Fixed, all 115 rows are
byte-identical and the month's net is ₹14,48,366 before and after. Switching one person to
Work it out moved the month by exactly their ₹872 and nobody else's figure by a rupee.

#### The employer's side

The panel also gives PF employer (12%, split EPS 8.33% / EPF, plus EDLI and admin at 0.5%
each) and ESI employer at 3.25%, and totals what the person actually costs a month — the only
way to see a real CTC.

#### The PF register

EPF wages on the register are now **Basic** where a breakup exists, which is what the law
charges on; the gross is still reported as gross wages. A deduction that is **not** 12% of the
wages reported is flagged on the row, because that mismatch is the commonest reason an ECR
file bounces at the portal.

### One person's own report

**Employees → report**, next to any name. One person down the months rather than one month
across the staff — which is what gets printed for a loan application, an appraisal, a
resignation, or when somebody asks why last month was short.

- the year's headline: months paid, net paid, average a month, payable days, days lost,
  attendance;
- **leave** against the quota — CL/SL/PL taken and left, plus unpaid leave, which has no
  quota because it was taken anyway and docked;
- **month by month** — present, absent, leave, days lost, payable days, attendance %, gross,
  PF, ESI, PT, loan, net and Sunday pay, with a totals row;
- a year picker, Print, and CSV.

It assembles, it does not recalculate: every figure came out of `calculateRow`, so a month
here and that month's payslip cannot disagree. **Sunday pay sits beside the net and is never
added into it**, the same rule as everywhere else.

Reading a report never touches the months it reads. Every month is loaded with `sync: false`,
so building a year's report cannot backdate today's new hires into closed months or post a
loan instalment into a month already paid — that is the salary sheet's job, not a report's.
There is an API test for it.

### The employee record: manager, documents, history

Three things a record needs that fields alone do not cover.

**Reporting manager.** `reports_to_id` points at another employee, so an org line is a join
rather than a typed name that goes stale the day somebody leaves. Their record also lists who
reports to *them*. A loop is refused — nobody reports to themselves, and nobody reports to
somebody already under them — because an org chart that cannot be walked is worse than none.

**Documents and KYC.** The KYC *numbers* already lived on the record; the paper behind them
did not. PAN card, Aadhaar, photograph, bank proof, offer letter, appointment letter,
qualifications, previous payslip. The file goes on disk under `DATA_DIR/documents`, the row
holds only a generated filename, the uploaded name is discarded (it is user input and this is
a path), and it is read back through a link that expires — the same shape as a candidate CV,
for stronger reasons: an Aadhaar card is the one document somebody can be impersonated with.
The record says which of the four KYC documents are still missing, and flags any that have
passed an expiry date.

**History.** A salary, designation, department, company, manager, PF/ESI mode, joining date or
status change writes itself into `employee_history` — append-only, because the point of a
history is that it cannot be edited into something else. Values are stored readably (a company
and a manager by name, not an id), a patch that sets a field to the value it already had
records nothing, and a free note can be added with no field change at all ("promoted", "moved
to Surat", "warning issued").

All three need the server. The single-file build says so plainly rather than showing an empty
box — a PAN card is a file, and a file cannot live in a browser.

### Onboarding a new joiner

Adding somebody to the payroll needs a name and a salary. Then the month ends, and the PF
return will not file because there is no UAN and the transfer fails because there is no IFSC.

So **Employees → Still to finish** lists everyone on the payroll whose record is not complete,
newest joiner first, and each employee's record opens with a **joining checklist**: who they
are, the job, statutory numbers, where the salary goes, leave entitlement — each saying *what
breaks without it*, because a checklist that does not say why gets ignored.

It is a checklist, not a gate. Nothing blocks a save, a payslip or a payroll run. Only the
joining date and the monthly salary are treated as genuinely required, and somebody whose
payment mode is Cash is never chased for bank details. A number that is the wrong shape is
flagged once something has been typed — blank is "not yet", never "wrong".

This is also where somebody hired on the **Hiring** tab lands: *Add to payroll* carries their
phone, email and date of birth across, and the checklist names the rest.

### Punching from a phone, and attendance approvals

The biometric machine stays the main source. This is for the people it cannot see — somebody
at a client's office, a driver, a site supervisor, or a day the device was down.

#### The employee's side

Each person gets a **personal link** (Employees → their record, or
`GET /api/employees/:id/punch-link`). No password: a hundred and fifteen people are not going
to be given logins, so the signed token in the link *is* the identity. What it can do is
deliberately small — punch as that one person, see their own punches and requests, and raise a
request. It cannot read anybody else, cannot see a salary, and cannot approve anything.

> A link can be forwarded and a phone can be handed over. The geofence narrows that and the
> log makes it visible. **That is the honest limit of punching from a phone** — it is not a
> claim to have stopped buddy punching.

The page is one big button, today's punches, and a way to say "the machine missed me".

#### Where a punch counts

**Reports → Punching and approvals → Where punching counts** holds office locations: a name, a
latitude and longitude ("use where I am" fills them), and a radius. A punch is measured against
the nearest one.

**A punch outside the fence is recorded and flagged, never refused.** Refusing it leaves
somebody genuinely at a client's office with no attendance at all, and somebody retypes it that
evening with no record of what happened. A flag can be looked at; a missing row cannot. It can
be made strict with `PUNCH_ALLOW_OUTSIDE=false`, deliberately.

A GPS fix vaguer than 500 m is treated as **"location not known"** rather than as evidence of
being anywhere — `inside_fence` is `null`, which is not the same as `false`.

Punches roll up into the day's `in_time` and `out_time` — the same columns the Time tab writes
and the salary sheet already pays from — so a phone punch, a biometric import and a typed time
are worth the same money. The first punch is the arrival and the last the departure, exactly as
the biometric import does. Nothing invents a departure: somebody who never punched out has the
day flagged, not guessed at.

Punching is **off** until `PUNCH_ENABLED=true`. A punch link is a door into the building.

#### Missing punches and corrections

An employee raises a **missing punch** (I was here, the machine has no record), a **wrong
mark** (absent when it was leave), or a **regularisation** (both). A reason is required,
because the office has to decide on something.

> **A request never writes attendance. An approval does.**

Nothing is auto-approved however reasonable it looks, a pending request changes nobody's pay,
a rejection writes nothing beyond the decision, and nothing can be decided twice or into a
locked month. Approving writes only the fields the request named — approving "in at 9:30" does
not blank a lunch somebody else typed, the same merge rule `setAttendance` already follows.
There are tests for every one of those sentences.

### The machine's Monthly Status report

**Reports → Monthly status from the attendance machine** takes the other report these
devices produce: not the punch log but a month-wide grid, one sheet per company, one row per
person and one column per day, carrying the machine's own verdict. There is nothing to map —
the shape is read off the file's own header — and it opens the legacy `.xls` these devices
still export, which the punch importer could not (ExcelJS reads only `.xlsx`; this path uses
SheetJS on the server).

| In the report | Becomes | Why it matters |
|---|---|---|
| `P` | `P` | |
| `A` | `A` | |
| `WO` | `S` | the weekly off |
| `WOP` | `SP` | **worked the weekly off** — this is what the Sunday register pays from |
| `H` / `HP` | `PH` / `HP` | holiday, and worked on a holiday |
| `L` | `PL` | paid leave by default; change it before writing if it should be CL/SL/UL |

#### A day with no record is not a day everybody was absent

The report writes `A` for both, and that single ambiguity is worth more than everything else
in this importer. In the October 2026 export every one of **114 people reads `A` from the
23rd to the 31st** — the device stopped syncing on the 22nd. Written through, that is 912
absences nobody earned and eight days off each of their payslips.

So a day on which *nobody at all* is marked present, on leave or on a holiday, **and**
somebody is marked absent, is treated as "the machine has no record" and left alone. Both
halves are needed: a Sunday carrying only `WO` is a fully known day off, not a gap, and still
gets marked. The skipped days are named in the dry run and can be forced in with a tick, but
it has to be asked for.

The dry run also names anybody absent on *every* day the machine does have — usually somebody
never enrolled on the device, or who has left — because docking a month's pay on that basis
is the same mistake in a smaller box. Thirty-four people in the October file.

Matching is on the machine's **Code** first and the name second, and whoever does not match is
listed rather than guessed at. A sheet for a different month than the open one is skipped and
said so. "Only fill days that are still blank" leaves anything typed by hand alone.

The single-file build reads `.xlsx` only and says so: a legacy `.xls` has to be re-saved in
Excel first, or imported on the server version.

### Short hours, by the minute

The same day menu sets that day's **short hours** — presets for 15, 30, 40, 45, 60, 90 and
120 minutes, or type any number. Overtime is the same control with a plus.

Minutes add up across the month into the `OT/LT` column and are paid or deducted at the
per-minute rate — `salary ÷ working days ÷ hours per day ÷ 60` — so an hour short costs
exactly an hour's pay. The menu shows what a minute is worth for that employee before you
commit to it.

Short hours are **not** absent days: someone can be Present and 30 minutes short, and a day
can carry minutes with no mark at all. Typing a total into `OT min` on the salary sheet
overrides the month; clearing the box hands it back to the days.

`P`, `A`, `HF`, `AD`, `PH`, `SP`, `HP`, `WH` and `S` come from the legend in columns
BI/BJ of the sheet. **The leave marks are new** — the sheet has no way to say "leave", only
plain absence. `CL`, `SL` and `PL` are the three paid kinds, each counted against its own
yearly entitlement on the **Leave** tab; `UL` is leave with no balance left behind it, and
costs a day exactly as `A` does. Which one a day is remains your call, per day.

### The leave register

The **Leave** tab shows, for a calendar year: what each person is entitled to, what they
have taken, and what is left. Nothing is entered twice — **taken** is counted straight off
the CL/SL/PL marks across every month of that year, so the register and the grid cannot
disagree. Entitlement can be set on the register itself or on the employee's record.

Anyone who has taken more paid leave than was due shows a negative balance and is counted
in the warning at the top; those days are still being paid, so mark them **Unpaid Leave**
instead if they should not be.

### Leave: applying for it, and getting it approved

An employee asks from **their own punch link** — no password, because a hundred people are
not getting logins. A leave application is the one request that covers a run of days:
`22–25` is **one request and one decision**, not fourteen, and approving writes the mark on
every day it covers in a single transaction, so a half-approved fortnight cannot exist.

The rule is the same one the whole approval queue runs on: **a request never writes
attendance; an approval does.** A pending application has changed nobody's pay, a rejection
writes nothing beyond the decision, and nothing is decided twice.

A last day before the first is refused as a typo rather than silently covering nothing, and
a date range on a kind that cannot span one (a missing punch, say) is refused rather than
quietly dropped.

### The day off need not be Sunday

**Leave → The day off.** The app assumed Sunday everywhere, which is right for most of the
staff and wrong for the rest — a driver off on Thursday, an office on alternate Saturdays
(which is how much of Gujarat works, and cannot be said as "every Saturday" or "no
Saturday"). A company sets the house rule; anybody on different days carries their own.

**It cannot move money.** `S` still means the weekly off and `SP` still means it was worked,
which is what the Sunday register pays from, and the salary engine counts marks and never
asks what day of the week it is. What changes is which squares the grid treats as off days,
so **Mark everyone Present** puts `S` on the right days and a date range skips the right
ones. The column headers still mark Sundays, which is a calendar fact; each cell follows
that person's own policy.

### Sandwich leave

**Leave → Sandwich leave.** A day off caught between two days of absence: away on Saturday
and again on Monday is three days away, and many employers deduct the Sunday in between.

It is **a tool, not a setting**. Nothing is stored and nothing happens on its own — the
panel finds the days, says what each costs, and marks them on a click. That is deliberate:
it is the harshest rule in the app, taking a day's pay for a day nobody was due to work, so
it is a decision each month rather than a switch somebody left on. The marks it writes are
the record.

Four things it gets right:

- **A run of off days goes together or not at all** — a Saturday-and-Sunday weekend, or a
  Sunday against a festival holiday, is one piece of filling.
- **A day actually worked is never docked.** `SP` and `HP` are paid extra; they cannot also
  be deducted.
- **A day off at the very edge of the month is left alone and named.** The day on the other
  side is in another month, which the panel cannot see — so it says so rather than guessing.
- **Only unpaid absence closes the sandwich by default.** Counting CL/SL/PL as absence is
  available and labelled as the harsher reading: docking a Sunday between two days of leave
  somebody had earned is a different decision from docking one between two days of
  unexplained absence.

It writes **UL**, not `A` — the same day's pay, but counted apart, so a month's absences are
not inflated by days the rule docked rather than days somebody failed to turn up.

### Late in, early out, and the 300-minute concession

**Time → Late and early.** Dinesh's own policy: every minute late in and every minute left
early is counted, pooled for the month, the first **300 are free**, and the excess comes off
the pay at the minute rate.

**It is off until somebody turns it on.** A month runs on one of two rules:

| Rule | What it charges |
| --- | --- |
| **Hours only** (the default) | Nothing for lateness as such. A late arrival costs money only if it made the day short of its hours — which is what this app has always done. |
| **Pool late and early minutes** | Late and early minutes pooled for the month, 300 free, the rest charged. The hours-shortfall is then **not** charged as well. |

That second sentence is the point: somebody half an hour late is already half an hour short
on the hours rule, so charging the lateness *as well* would take the same half hour twice.
The two rules are alternatives, never additions.

The panel states what switching would cost **before** it is switched — the figure is real,
not an estimate, because every row carries what the rule would charge whether or not it is
being applied. It is held per month, so a rule turned on in November never rewrites a
payslip already paid in October.

Three more things:

- **A day nobody clocked is not a late day.** No in-time means *not known*, which is not
  *on time* and not *late*.
- **A half day, leave, a holiday or an absence is never judged late.** It was not a full day
  at the office.
- **Somebody on other hours carries their own shift** (on their employee record). A night
  shift judged against the office's 09:30 would read as five hours late every single day.

The daily grace is **zero** by default. A monthly pool of five hours plus a quarter of an
hour forgiven on each of 26 days would give away another six and a half hours nobody decided
on.

The half-day line follows the configured day — half of the month's hours per day — so an
eight-hour month breaks at four, not at four and a half. The Time tab and the biometric
import use the same figure, because a day typed by hand and a day read off the machine have
to be worth the same.

### Where it differs from the spreadsheet, on purpose

- **Every month is 26 working days, fixed.** February and a 31-day month divide by the
  same 26, so the day rate for a salary never moves. It is a constant in the code, not a
  setting: the API ignores a different number if one is sent, and the dashboard shows it
  as a fixed value rather than a box.
- **Hours/day and the PT slab are per month.** The sheet hard-codes `/9` and
  `IF(>12000, 200, 0)` into every formula. Here each month keeps its own, so changing the
  slab never rewrites a month already paid. Hours/day only affects the hourly and
  per-minute rates — the day rate stays `salary / 26`.
- **A typed number over a formula is recorded as an override.** The sheet has both
  (e.g. `AJ` is sometimes a `COUNTIF` and sometimes a hand-typed `7.5`). Overridden
  cells are outlined in the dashboard, and clearing the box hands control back to the
  formula.
- **Sunday duty is its own payment.** The sheet spreads a person across a monthly tab, a
  "Sunday" tab and a "Cash" tab, and then adds Sunday pay back into `BE`. Here the marks
  are on the one attendance grid, but the money stays split: the salary sheet ends at the
  net, and Sunday pay is paid from the Sunday register alone.
- **Leave is a mark of its own.** See the table above — the sheet only had "absent".

### Checked against the real sheet

The April tab imports as 74 employees, and **72 of 74** reproduce the sheet's gross, net
and Sunday pay exactly. The two that differ are rows where someone typed a net salary
**over** the formula in the sheet itself:

- **Hiral Tandel** — sheet `AZ17` = 17,462; the formula gives 17,454.
- **Priti Kadam** — sheet `AZ58` = 13,681; the formula gives 13,800. Her ESI cell also
  reads `=IF(AW58>12000, 200, 0)`, which tests PT instead of the gross — a copy-paste
  slip in the sheet. This app does not reproduce that.

Both are worth a look before the next payroll run.

## The People tab

Everything about somebody that is not pay and not attendance. Nine panels, all of which
**need the server** — a warning on a record, a claim somebody else approves and a trail that
outlives one browser are not things a single file on a laptop can hold, and the single-file
build says so rather than showing empty boxes.

Two rules hold across all of them:

- **Nothing decides itself.** A claim is approved by somebody, an increment is applied by
  somebody, a settlement is marked paid once. A pending row changes nobody's pay, and a row
  that was never approved can never be paid.
- **Money reaches the payroll only through one call that names the month it comes out of.**

### On the record — warnings and appreciations

One list, because they are the same record with opposite signs and a person's file should
read in one order whichever kind it is. A warning carries how formal it was (verbal, written,
final) and **when it was acknowledged**, because a warning the person never saw is not much
of a warning.

### Appraisals and increments

An appraisal is **a proposal until somebody applies it**. Filling the form in changes nobody's
pay; *Apply the increment* is a separate button that writes the new salary onto the master —
which lands in the employee's own change history like any other salary change. It is measured
against what they are on **now**, so an increment can never be worked out off a stale figure.

Applying twice does not give a second rise. An applied increment cannot be edited or deleted
afterwards: somebody was paid on it.

### Assets — laptop, ID card, SIM

An asset with nobody against it reads **in the office**, which is not the same as lost. What
is out and with whom sorts to the top, because that is the one question the register exists to
answer, and the exit settlement reads the same list.

### Expense claims — travel, food, petrol

Three steps, kept apart on purpose. **Raising** records what was spent. **Approving** says it
is a real expense. **Paying** says which month it comes out of, and posts it as an addition on
that person's salary-sheet row — on top of whatever addition is already there, never replacing
it.

A claim cannot be paid without being approved, a decided claim is not decided again, and
paying it twice is refused, so a double click cannot pay a petrol bill twice. A paid claim
stays on the record.

### Tasks

Work given to somebody, with a date it is wanted by. **Not** the same thing as the WhatsApp
task assistant, which reads Dinesh's own messages — this is office work assigned to staff, and
each person sees their own on the link they punch from and ticks it off there.

"Overdue" is worked out on read rather than stored, so a list left open overnight is right in
the morning. A task that was done cannot be deleted — drop it instead — and the trail carries
every turn, so done-then-reopened is a history rather than a rewrite. A task cannot be
*dropped* from the phone at all: dropping work somebody gave you is the office's decision.

### Helpdesk

What staff have asked for or complained about, raised from their own link. Two rules:

- **Answering is not closing.** The office replying moves a ticket to *answered*; whether the
  answer settled it is the employee's call, and them replying puts it back to *open*. A
  helpdesk that closes its own tickets measures nothing.
- **Waiting means waiting on us.** The list leads with the ones where nobody in the office has
  spoken since the employee did.

### Leaving — resignation, notice, full and final

The settlement is **assembled, not stored**. The final month's net is the figure the payslip
prints (read without syncing, so settling somebody cannot backdate a hire into a closed month
or post another loan instalment), the leave balance is counted off the marks, the loan
outstanding comes off the ledger. What this adds is the arithmetic that only happens once:

- **Leave encashment** — privilege leave only by default, because CL and SL lapse at the end
  of the year and paying them out would hand over days nobody had a claim to. The panel shows
  what lapses next to what is paid out, so it is on the page rather than a rule somebody has
  to know.
- **Gratuity** — 15 days' wages per completed year on a 26-day month, on Basic where a breakup
  is set and on the monthly salary where none is, which it states. Reported **with its rule and
  its eligibility even when it is not due**, rather than left off the page. The Act counts a
  part-year over six months as a full year, which reads as a contradiction next to the plain
  service length, so the note says both figures: *"7 years 9 months of service, counted as 8"*.
- **Notice, either way round** — somebody who resigns and leaves early owes the shortfall; an
  employer who terminates without notice owes it instead. Which way is decided by the exit
  type, not by who filled the form in. A retirement or a contract simply ending owes nothing.

**An unreturned laptop is named and valued, never deducted.** Docking it off a final payment
that then turns out to be in a drawer cannot be undone once the money has gone.

Setting a last working day also marks the person inactive, which is what every other tab
reads — but that is not the same as paying them. Once the settlement is marked paid, the dates
behind it stop moving and the record cannot be deleted.

### Reminders

Everything waiting on a decision, a payment or an answer, as text. **It works out what to say;
it does not send**, and the page says why rather than implying plumbing that is not there:

- **WhatsApp** has no legitimate API for a personal number, and the task assistant already
  holds a linked session. A second session on the same number risks the number, so the right
  shape is for *that* app to fetch this text.
- **Email** needs an SMTP account and its password — a decision about credentials, not code.
- **Phone notifications** need push keys and a service worker. The task assistant has those;
  this app does not.

What works today: copy it into WhatsApp, or point anything on a schedule at
`GET /api/people/digest?format=text`, which returns it as plain text (with the dashboard
password in an `Authorization: Bearer` header, like every other call).

A quiet day says *Nothing waiting* rather than padding, and a missing UAN is reported without
counting as a job for today.

### Trail — who changed what, and when

Deliberately plain, and deliberately honest about one thing: **`who` is a name typed on a
form, not somebody the app authenticated.** This build has one shared password and no user
accounts, so a trail that implied otherwise would be worse than no trail.

What it records and what it does not is the useful part:

- **A corrected attendance mark is on it; a blank day being filled in is not.** So "Mark
  everyone Present" and the biometric import stay out of it, while an absence turned into sick
  leave after the fact — exactly what somebody comes looking for — is kept.
- **A figure typed over the salary sheet is on it**, by name and column. Typing the same figure
  again is not a change, and an override handed back to the formula records `(formula)` rather
  than reading as zero.
- **Closing a month and switching the late/early rule are on it**, because both change what
  people are paid.

Every line is readable without a join: a name, not an id.

### Additions and deductions

Some months carry something that is not attendance and not a loan — an incentive, a
breakage, a fine, a reimbursement. The salary sheet has two boxes for it on every row,
**Add** and **Deduct**, and a **Remark** beside them that turns into "What for?" the
moment either is filled.

They are two boxes rather than one signed number on purpose. A month can carry both at
once, and a minus sign forgotten in front of a deduction is an expensive mistake — here
the worst that can happen is money in the wrong column, which is visible.

Both feed the sheet's `AU`, so the gross is `after-absent + OT + addition − deduction`,
and PT is charged on that gross like everything else. The payslip lists them separately,
under the remark if one was typed, and the Excel export and the CSVs each carry their own
**Addition** and **Deduction** columns. The wage register adds the deduction back into
what was earned and then lists it among the deductions, so the register still reads
gross − deductions = net.

### The Sunday register

Sunday and holiday pay is settled **entirely apart from the month's salary**, the way the
workbook's "May Sunday" and "June sunday" tabs do it. The **Sunday** tab lists everyone who
worked one: which dates, at what day rate, for how much, with its own **Paid by** and
**Status** so the cash can be handed out and ticked off without touching the salary sheet.

The amount appears **nowhere on the salary sheet** — not in the gross, not in the PT line,
and not in the net payable. The source sheet's `BE` added it to the net; Dinesh asked for
the two to be paid separately, so the salary sheet ends at **Net payable** and this
register is the only place Sunday duty is paid from. The Excel export and the monthly CSV
carry no Sunday amount either; it rides in the Sunday sheet and `sunday.csv`.

The one place both still appear together is the **statutory wage register**, which lists
Sunday pay as its own column and adds it into the total — a muster roll that left it out
would understate what the person was actually paid for the month.

Somebody appears there the moment a day is marked **SP** or **HP** on the attendance grid.
The amount is days × day rate; type over it to round it off, empty the box to go back.
It downloads on its own from **Reports → Sunday register**, and rides along as its own
sheet inside the Excel export.

### Loans and advances

The **Loans** tab keeps the ledger: who was given what, what comes off each month, and what
is still owed. Opening a month writes one repayment row per running loan, at the
instalment or whatever is left of the loan — whichever is smaller — and that amount is
deducted on the salary sheet, the payslip and the export.

It is automatic but never silent. **This month** on the ledger is the amount actually
coming off, and it can be changed: set it to nothing for somebody who cannot pay this
month, and the loan simply runs a month longer. **On hold** stops future months without
disturbing what has already been taken. The outstanding balance is always the amount less
what has really been repaid — never a projection.

### A note on PT

Professional tax is charged on **what the month actually pays** — the gross, after
absences, overtime and adjustments — not on the salary written on the employee master.
A month somebody was largely absent for can therefore fall under the 12,000 line and
carry no PT, which is how the sheet has always worked.

**Sunday pay is not counted towards that line**, because it is settled on its own register
(above) rather than inside the month's gross. Counting it would move exactly two people in
the April sheet — Mahesh Shinde (10,993 gross + 1,442 Sunday) and Riya Pal (11,915 + 462) —
and lift the month's PT from 10,000 to 10,400.

---

## Signing in, roles and branches

### Logins

The app used to have one shared password and no users: everybody who had it could do
everything, and the audit trail had to admit that *who* was a name typed on a form.

Now there are real logins. On a fresh installation the sign-in screen offers to make the
**first admin**, and that door closes the moment it is used. A wrong username and a wrong
password give the identical answer — anything else tells a stranger which logins exist.

Passwords are scrypt-hashed (`node:crypto`, no new dependency) and the session is a signed
HttpOnly cookie. The session secret lives in the database rather than an environment
variable, so a restart does not sign everybody out of an app nobody configured.

### The three roles

| Role | Can |
| --- | --- |
| **Admin** | Everything, including logins, branches, a month's settings and closing a month. |
| **HR** | Employees, attendance, leave, payroll and assets — **salaries included**. Cannot change settings or logins. |
| **Viewer** | Can look at everything and change nothing. |

Dinesh's decision was that **HR sees salaries**. So the line between Admin and HR is not
what they can *see*, it is what they can change about the installation itself: HR runs
payroll, Admin decides the rules payroll runs on. Concretely, these are admin-only:

- a month's PT slab, hours per day, late/early policy and concession, and shift times
- closing and reopening a month, and deleting one
- adding, renaming or deleting a company or a branch
- logins, roles and the sign-in log

**It is enforced on the server, not by hiding buttons.** A Viewer who knows the address
still cannot write; HR who knows the address still cannot move the PT slab. The Admin tab is
hidden from everybody else as a courtesy, not as the control. A role is read fresh from the
database on every request, so demoting somebody or switching their login off takes effect at
once rather than when their cookie runs out.

Company *reads* are deliberately open to anybody signed in — the company list is needed on
every screen, and locking it would break the filter and the employee form for HR.

The **last active admin** cannot be demoted, switched off or deleted. There would be nobody
left who could make one.

### The dashboard password is now a machine key

`APP_PASSWORD` still works as a Bearer token, which is how anything on a schedule fetches
the reminder digest. It is full access and it leaves no name behind, so the audit trail
records it as **the API key** rather than inventing a person — and the Trail page says so to
anybody reading the app that way. Once you have a login, use the login: your own name goes
on what you change.

### Who signed in

**Admin → Sign-ins** lists every attempt with the time, the username, the address and the
browser — **including the refusals**. The refusals are the point: one wrong password is
somebody's thumb, ten in a minute is somebody trying passwords, and that is only visible
because the failures are kept.

### Branches, beneath a company

Asked for as *"branches under a company"*. The salary already runs across three or four
separate companies (BOOKNFLY PRIVATE LIMITED, BOOKNFLY, BOOKNFLY VENTURE LLP, SCALE), so a
branch is a place *inside* one of them — Vadodara, Surat. Companies are untouched; this is a
second, optional level.

- **Nobody has to be in a branch.** Everybody starts with none, and that is a real answer
  rather than a gap.
- Two companies can each have a Vadodara. One company cannot have two.
- A branch can be **closed** without being deleted.
- **Deleting a branch never takes its people.** They go branchless and stay on their
  company's payroll, because a mistyped name must not be able to remove fourteen employees.
  Deleting a *company* still takes its branches, as it always took its employees.
- A move between branches lands in the employee's own change history.

Set up branches in **Admin → Branches**, then pick one on each employee's record. The branch
rides onto the salary sheet and the staff list can be narrowed to it.

### Backups

There were none on the server at all. Now there is **one complete copy a day**, kept for a
fortnight, in `DATA_DIR/backups`, written with SQLite's own `VACUUM INTO` — a whole,
consistent file even while the app is being used. The first runs a minute after boot, so a
fresh deployment has one before anybody has had time to break anything. A failed backup is
logged and never takes the app down.

`BACKUP_ENABLED=false` turns it off, `BACKUP_HOURS` and `BACKUP_KEEP` change the rhythm and
how many are kept.

**Where this protects you, and where it does not** — because a backup nobody can restore is
theatre:

- **A bad deploy, a dropped table, a wrong delete** — covered. The copies are right there.
- **Losing the volume itself** — *not* covered, because the copies are on it. Download one
  now and again from **Admin → Backups** and keep it somewhere else.

#### Restoring a backup

There is deliberately no button for this: restoring replaces everything, and it should take
a considered minute at a terminal rather than one mis-click.

1. Stop the app.
2. In the data folder, move the current `salary.db` aside — do not delete it yet.
3. Copy the chosen `backups/salary-YYYY-MM-DD.db` to `salary.db`.
4. Remove `salary.db-wal` and `salary.db-shm` if they are there. They belong to the old
   file, and leaving them beside a restored one is how a restore ends up half-applied.
5. Start the app and check one month's totals against a payslip you already have.

#### Taking a backup off the machine

The download button in **Admin → Backups** is the simplest route. For something automatic,
the same file is available to the machine key:

```
curl -H "Authorization: Bearer $APP_PASSWORD" \
     -o salary-backup.db \
     https://your-app/api/auth/backups/salary-2026-11-01.db
```

## Assets

### The code on the label

A database id means nothing written on a laptop: two companies both have a 47 and nobody
can read it back to you over the phone. So every asset gets a code —

```
BPL-LAP-014
 │   │   └── which one, in that series
 │   └────── what it is
 └────────── whose it is
```

The series runs per company and per kind, and it reads the **highest number already used**
rather than counting rows — so **a number is never reused**. An old service bill and a
signed handover slip still refer to 002, and giving 002 to a second laptop makes both
histories wrong.

An office that already has stickers on its laptops can type its own code instead; it is
tidied (uppercased, spaces out) rather than rejected.

### The label

Each asset prints a **Code 128 barcode** as an SVG sized in millimetres, with the code
written underneath. It scans with any phone barcode app and with the cheap USB scanners an
office already has — which is what the stock take uses.

**Why a barcode and not a QR code.** A QR code needs Reed-Solomon error correction over a
finite field: a few hundred lines that are easy to get subtly wrong and that should come
from a library thousands of people have scanned. Code 128 is a lookup table and a weighted
checksum — small enough to read, test and trust. There is a test asserting every one of the
107 patterns is exactly 11 modules wide (13 for the stop) with no duplicates, because a
single mistyped digit would give a barcode that looks perfect and scans as nothing. If a QR
code is specifically wanted, that should be a small library rather than this file growing
one.

### Buying it, and what it cost

`value` used to be one field doing two jobs — "what it cost" and "what it is worth". It is
now **`purchase_cost`** and nothing else, alongside the purchase date, the vendor, the
invoice number, the warranty date and the AMC. A current valuation is a different question,
and nobody has asked for it.

### Handovers, and their history

Issuing to a second person used to overwrite the first, so "asset history" had nothing
behind it. There is now a handover log: every issue and every return, kept.

- Passing something **straight to somebody else** closes the first handover and records that
  that is what happened, rather than losing it.
- Issuing to the person who already has it does nothing.
- The log is never read to work out who has it now — the register holds that. The two answer
  different questions, so they cannot drift.

### One asset's whole life

Click a code: bought → issued → returned → issued → serviced → verified → written off, in
date order, with the amounts. Assembled from the rows that already hold each of those, so
nothing is stored twice and nothing can disagree with the register.

### Who holds what, and a slip to sign

One line per person with what they hold and what it is worth, and a printable slip. The slip
lists only what they **still** have — a returned laptop has no business on a document they
are putting their name to — and carries the undertaking above the signature, because the
point of signing is agreeing to something specific. The serial is on it: that is what
identifies the actual object.

### The stock take

**The distinction the whole feature exists for: "not checked" is not "missing".** Three
figures, never two:

| | |
| --- | --- |
| **Found** | somebody looked at it |
| **Not found** | somebody looked for it and it was not there |
| **Not checked yet** | nobody has looked |

Counting the third as the second is how a stock take invents losses, and how somebody ends
up being asked to pay for a laptop that is in a drawer. So "not found" comes from a verdict
somebody actually recorded, and an asset bought halfway through a round is simply not looked
at yet.

Scan or type a code to tick it off. Checking the same asset again **replaces** the verdict
rather than leaving two that disagree. The missing list says what it is worth and then says
plainly that nothing is deducted from anybody on the strength of it.

### Writing off, not deleting

Anything that has ever been issued cannot be deleted — that would take its handovers and its
service record with it. Writing it off **brings it back first**, so nobody is left holding
something that no longer exists, and it keeps its row and its code while leaving the
register. A written-off code is never handed to the next asset.

## Asset maintenance

### Duplicates are caught when they are typed

The same service entered twice — **same asset, same date, same amount** — is the commonest
way an asset's running cost comes out wrong. Catching it in a report means somebody has
already closed a month on a wrong figure, so the check runs before the save.

It **asks** rather than refuses. Two identical ₹500 repairs on one day do happen, and a
system that will not record the truth gets worked around: the screen shows the service it
resembles and the button becomes *Add it anyway*.

The note is deliberately **not** part of the test — that is where somebody types "battery"
one time and "Battery replacement" the next for the identical bill.

### Total cost of ownership keeps its parts

"This laptop has cost ₹45,500" and "₹42,000 of that was buying it" are different sentences
and both get asked, so purchase and service are added for the total **and** reported
separately, with service as a share of purchase.

- An asset that cost nothing to acquire — a SIM, a gifted desk — gets no percentage rather
  than a divide by zero.
- The register names anything that has **cost more to keep than to buy**. That is usually the
  moment to replace rather than repair again.
- Work done free under warranty still goes on the record at what it actually cost. An asset
  serviced four times for nothing is still an asset serviced four times.

### Nothing is invented

`next_service_on` is whatever the person doing the work said. A date this app worked out
would produce reminders nobody asked for and nobody trusts, so **no date means not
scheduled**, never overdue.

Warranty and AMC are separate contracts with separate dates, and a lapsed AMC is its own
alert — it needs something different doing about it than a service due next week.

### What it reports

Two files, both with a BOM: the **service log** (one line per service, with the asset's kind
and the work's kind kept apart) and **cost of ownership** (one line per asset, purchase and
service and total). Services also ride onto each asset's own timeline.

## Two ways to run it

**As a single HTML file** — no server, no install, no deploy. Build it once:

```bash
cd frontend && npm install

# Optional: bake the staff list in, so the file opens with everybody listed
node scripts/make-seed.mjs ../../Salary_Sheet_2627.xlsx April

npm run build:standalone
```

That writes `frontend/dist-standalone/BOOKNFLY-HRMS.html` (~1 MB).

`make-seed.mjs` reads the employee master out of a salary sheet — companies, names,
salaries, PF/ESI, pay mode — into `seed.json`, which the build inlines. Only the master
is seeded, never a month's attendance, so every month still starts blank. It fills in a
browser that has never stored anything and never touches data already there. Skip the
step and the file starts empty, ready to import a sheet instead. `seed.json` is
git-ignored: it holds real salaries and does not belong in the repository — re-run the
script whenever the staff list changes. Open it by
double-clicking, or put it on a phone or a shared drive. Everything works —
attendance, the salary sheet, payslips, the Excel import and export — with the data
kept in that browser's local storage. It never talks to a network.

The catch is the flip side of the same coin: the data lives in **that browser on that
device**. It is not shared between people, it is not on any server, and clearing browsing
data deletes it. **Reports → Download backup** saves the lot as one JSON file, and
**Restore a backup** puts it back — take one at the end of every payroll run.

**As a server** — one shared database several people can reach, which is what the rest
of this file covers.

## Running the server

Needs Node 20+.

```bash
# API
cd backend
cp .env.example .env
npm install
npm run dev            # http://localhost:3002

# Dashboard, in another terminal
cd frontend
npm install
npm run dev            # http://localhost:5174, proxies /api to the backend
```

Tests — the calculation engine against reference rows from the April sheet, the API
end to end, and an import/export round trip:

```bash
cd backend && npm test
```

Both builds share one calculation engine, one sheet reader and one exporter in
`shared/`, so the single file and the server cannot drift apart. The tests cover
that shared code.

### Companies

A **Company** strip sits under the month picker: press one to show only its people, on the
salary sheet, the attendance grid and the employee list alike, with the totals following
along. Press it again, or **All**, to go back. The company name above each block on the
salary sheet does the same thing, and the choice is remembered between visits.

Under **Employees**, each company also carries a **✎** to rename it and a **✕** to delete
it — deleting takes its employees and their months with it, and says so first.

### First run

The **Dashboard** is where the app opens — see below. Every figure on it opens the tab it
came from.

1. **Employees** → check the staff list. If the file was built with a seed they are
   already there; otherwise add a company and its employees, or import the existing
   sheet from **Reports**.
2. **New month** → pick the month. Working days are always 26.
3. **Reports → Import a salary sheet** → choose the `.xlsx`, pick the tab,
   press **Check first** to see what it found, then **Import**.
4. **Attendance** → **Mark everyone Present** fills every blank day for everybody at
   once (Sundays as S), then mark the exceptions: click a day and pick the mark by name,
   or type its code. **Fill blanks…** on the right does one row at a time. The absent, paid-leave,
   unpaid-leave and Sunday counts update as you go and save on their own.
5. **Time** → in, lunch out, lunch in and out for whoever clocks their hours. Worked
   hours and the day's short time or overtime fall out of them; **Fill the usual timings**
   does a whole screen at once. Skip this tab entirely if nobody is on the clock.
6. **Salary sheet** → the calculated month. Type into OT, **Add**, **Deduct**, ESI or PF and
   the row and the totals move immediately. Boxes outlined in orange are typed over a
   formula — empty them to hand the column back.
7. **Sunday** → anyone who worked a Sunday or holiday, with the amount and its own
   Paid by / Status. This is where Sunday duty is paid; it is not on the salary sheet.
8. **Reports** → download the Excel or CSV, or the payment list of everyone still
   unpaid. Click a name on the salary sheet for a printable payslip.
9. **Lock** the month once it is paid, so nothing can be edited by accident.

---

## Deploying

`backend/Dockerfile` builds the dashboard and serves it from the API in one container.
`railway.json` points at it.

On Railway: set the service **root directory to `salary-app`**, mount a volume at
`/data`, and set:

| Variable | Value |
|---|---|
| `DATA_DIR` | `/data` |
| `APP_PASSWORD` | a password — **without it the dashboard is open to anyone with the URL** |
| `PORT` | Railway sets this |

> The Docker image has not been built or deployed yet — there was no Docker daemon in
> the environment it was written in. Expect to iterate on the first deploy.

---

## Layout

```
salary-app/
  shared/calc.js       the calculation engine - imported by BOTH the API and the
                       dashboard, so the browser recalculates with the same code
  shared/sheet.js      reads an April-shaped sheet   (server and browser)
  shared/workbook.js   writes one back out           (server and browser)
  shared/timesheet.js  clock times, and the hours they come to
  shared/festivals.js  which religion a festival belongs to
  shared/punches.js    a biometric export, turned into marks and times
  shared/statutory.js  the PF, ESI, PT and wage registers
  backend/
    src/db.js          SQLite schema and queries
    src/payroll.js     joins rows + attendance through the engine
    src/importer.js    parses with shared/sheet.js, then writes to the database
    src/routes/        companies, employees, periods, reports
    test/              engine, API, import/export
  frontend/src/
    localStore.js                the standalone build's data layer (localStorage)
    components/SalarySheet.jsx   the calculation sheet
    components/Attendance.jsx    the day grid
    components/TimeSheet.jsx     in / lunch / out and the hours
    components/Dashboard.jsx     the month at a glance
    components/Employees.jsx     the master
    components/Reports.jsx       totals, downloads, import
    components/Payslip.jsx       printable slip
```

## The look

One stylesheet, no framework, and deliberately quiet — this is a sheet somebody reads for
an hour at a time, so the ink goes on the numbers and the names rather than on boxes round
them.

- **The sheets look like sheets.** Every cell is ruled on all four sides, rows are one line
  tall, there is a row number down the left, and the header and totals rows stay put while
  the grid scrolls. An editable cell shows the worked-out figure greyed, exactly as a
  spreadsheet shows a formula's result; typing replaces it and the cell turns amber to say
  so. Clearing it hands the formula back. Nothing is printed under a box — a second line per
  cell doubled every row and made 85 people three screens long.
- **Hairlines, not borders**, everywhere else. Cards are a thin rule and some room.
- **Figures, not tiles.** A row of six bordered boxes is six rectangles competing with the
  numbers inside them; here the columns are separated by a hairline and the number is the
  biggest thing on the row.
- **Tabs underline.** The open tab is marked by a rule under it, not by a filled pill.
- **One accent**, used on the figure that matters, the open tab and the focus ring —
  nowhere else.
- **Tabular numerals** everywhere a column of figures appears, so digits line up.
- Dark mode follows the system setting and is the same design, not a second one.

## Things to know

- Auth is a single shared password, like the task assistant — fine for one person,
  not multi-user. Salaries sit unencrypted in SQLite; keep the volume private.
- Deleting an employee deletes their payroll history. To stop paying someone, untick
  **Active** instead — they drop out of new months and past months stay intact.
- Import matches employees on **company + name**. A renamed person imports as a new
  employee, so rename in the app rather than in the sheet.
- The exporter writes company subtotals as live `SUM()` formulas, so the downloaded
  file still adds up if a number is edited in Excel.
