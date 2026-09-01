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

**2. Festivals & holidays**, at the top of the attendance tab. Add the festival with its
date and the religions it covers, press **Apply**, and Paid Holiday is written onto that
day for exactly those people. Leave every religion unticked and it covers everybody — a
shutdown, a strike.

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

## Two ways to run it

**As a single HTML file** — no server, no install, no deploy. Build it once:

```bash
cd frontend && npm install

# Optional: bake the staff list in, so the file opens with everybody listed
node scripts/make-seed.mjs ../../Salary_Sheet_2627.xlsx April

npm run build:standalone
```

That writes `frontend/dist-standalone/Salary-Sheet.html` (~1 MB).

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

The **Dashboard** is where the app opens: what the month costs, what is still to pay, and a
**Needs attention** list — unpaid salaries, unmarked days, missing UAN or ESIC numbers,
anyone over their leave. Every figure on it opens the tab it came from.

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

## Things to know

- Auth is a single shared password, like the task assistant — fine for one person,
  not multi-user. Salaries sit unencrypted in SQLite; keep the volume private.
- Deleting an employee deletes their payroll history. To stop paying someone, untick
  **Active** instead — they drop out of new months and past months stay intact.
- Import matches employees on **company + name**. A renamed person imports as a new
  employee, so rename in the app rather than in the sheet.
- The exporter writes company subtotals as live `SUM()` formulas, so the downloaded
  file still adds up if a number is edited in Excel.
