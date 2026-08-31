# Salary calculation software

A payroll app built to match the **April tab of `Salary_Sheet_2627.xlsx`** — the same
columns, the same formulas, the same attendance codes — so the numbers it produces can
be checked against the sheet it replaces.

It keeps the employee master, a month-by-month attendance grid, and the full salary
calculation, and it exports back out to Excel in the same layout.

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
| AU | Deduction / Additions | Anything else, signed |
| AV | Gross Salary | `ROUND(AO + AT + AU)` |
| AW | PT | `200` when the month's gross is above `12,000` |
| AX AY | ESI / PF | Entered per employee |
| AZ | Net Salary | Gross − PT − ESI − PF |
| BD | Sunday Salary | Sundays worked × day rate, paid on top |
| BE | Final Payable | Net + Sunday salary |

### Attendance marks

Clicking any day in the grid opens a menu of the marks **by name**, each showing what it
does to the salary — no need to remember the codes. Typing the code still works.

| Mark | Means | Effect on salary |
|---|---|---|
| `P` | Present | — |
| `A` | Absent | −1 day |
| `HF` | Half Day | −0.5 days |
| `PL` | **Paid Leave** | — |
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

That last one is how a festival holiday gets marked. Eid is a paid holiday for some of the
staff and an ordinary working day for the rest, so "everyone" is the wrong tool: click the
date, choose the mark, then choose who it applies to — everyone shown, a group, or names
ticked off a list. It says on the button how many people it is about to change.

Because it usually runs *after* everybody has been marked Present, it replaces marks
already on that day by default, and tells you how many that is before you press it.

**Group** on the employee master is what makes this quick the second time. Put anything in
it — a festival group, a shift, a site — and everyone carrying that label becomes a
one-press shortcut in the day marker.

Filling it in for a whole workforce takes about a minute. Under **Employees**, tick the
box at the top of the list to select everyone on screen, type the group, press
**Apply**. Then search for the handful who differ, select those, and give them theirs.
Setting all 74 one way and then flipping five of them is two passes:

```
tick all → "Hindu" → Apply          70 done
search "Abdulhak" → tick → "Muslim" → Apply
search "Sameer"   → tick → "Muslim" → Apply     …and so on
```

The search box matches the group too, so `Muslim` afterwards lists exactly that set.

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
BI/BJ of the sheet. **`PL` and `UL` are new** — the sheet has no way to say "leave", only
plain absence. Paid leave costs nothing; unpaid leave deducts a day exactly as `A` does,
but is counted separately, so the payslip and the export show leave and absence apart.
Which one a day is remains your call, per day.

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
- **One number per employee per month.** The sheet spreads a person across a monthly
  tab, a "Sunday" tab and a "Cash" tab; here Sunday pay is a column on the same row.
- **Leave is a mark of its own.** See the table above — the sheet only had "absent".

### Checked against the real sheet

The April tab imports as 74 employees, and **72 of 74** reproduce the sheet's gross, net
and final payable exactly. The two that differ are rows where someone typed a net salary
**over** the formula in the sheet itself:

- **Hiral Tandel** — sheet `AZ17` = 17,462; the formula gives 17,454.
- **Priti Kadam** — sheet `AZ58` = 13,681; the formula gives 13,800. Her ESI cell also
  reads `=IF(AW58>12000, 200, 0)`, which tests PT instead of the gross — a copy-paste
  slip in the sheet. This app does not reproduce that.

Both are worth a look before the next payroll run.

### The Sunday register

Sunday and holiday pay is settled **apart from the month's salary**, the way the workbook's
"May Sunday" and "June sunday" tabs do it. The **Sunday** tab lists everyone who worked one:
which dates, at what day rate, for how much, with its own **Paid by** and **Status** so the
cash can be handed out and ticked off without touching the salary sheet.

Somebody appears there the moment a day is marked **SP** or **HP** on the attendance grid.
The amount is days × day rate; type over it to round it off, empty the box to go back.
It downloads on its own from **Reports → Sunday register**, and rides along as its own
sheet inside the Excel export.

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
5. **Salary sheet** → the calculated month. Type into OT, deductions, ESI or PF and
   the row and the totals move immediately. Boxes outlined in orange are typed over a
   formula — empty them to hand the column back.
6. **Reports** → download the Excel or CSV, or the payment list of everyone still
   unpaid. Click a name on the salary sheet for a printable payslip.
7. **Lock** the month once it is paid, so nothing can be edited by accident.

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
