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
| AW | PT | `200` when the gross is above `12,000` |
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

The April tab imports as 75 employees, and **72 of 74** rows with a salary reproduce
the sheet's gross, net and final payable exactly. The two that differ are rows where
someone typed a net salary **over** the formula in the sheet itself:

- **Hiral Tandel** — sheet `AZ17` = 17,462; the formula gives 17,454.
- **Priti Kadam** — sheet `AZ58` = 13,681; the formula gives 13,800. Her ESI cell also
  reads `=IF(AW58>12000, 200, 0)`, which tests PT instead of the gross — a copy-paste
  slip in the sheet. This app does not reproduce that.

Both are worth a look before the next payroll run.

---

## Two ways to run it

**As a single HTML file** — no server, no install, no deploy. Build it once:

```bash
cd frontend && npm install && npm run build:standalone
```

That writes `frontend/dist-standalone/Salary-Sheet.html` (~1 MB). Open it by
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

### First run

1. **Employees** → add a company, then employees with their monthly salary.
   Or skip ahead and import the existing sheet.
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
