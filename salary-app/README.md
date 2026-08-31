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
| AH | Working Days | Set per month (26 in the sheet) |
| AI | Sunday | Sundays/holidays worked — counted from `SP`/`HP` marks, or typed |
| AJ | Absent Days | `A` = 1, `HF` = 0.5, `AD` = 2 — counted from the grid, or typed |
| AK | Present Days | Working days − absent days |
| AL | Salary | Monthly salary |
| AP AQ AR | Per day / hour / minute | `AL / 26`, `÷ 9`, `÷ 60` |
| AN | Absent Salary | Day rate × absent days |
| AO | Gross Salary | Salary − absent salary |
| AS AT | OT/LT | Minutes × per-minute rate; a negative number is late/short hours |
| AU | Deduction / Additions | Anything else, signed |
| AV | Gross Salary | `ROUND(AO + AT + AU)` |
| AW | PT | `200` when the gross is above `12,000` |
| AX AY | ESI / PF | Entered per employee |
| AZ | Net Salary | Gross − PT − ESI − PF |
| BD | Sunday Salary | Sundays worked × day rate, paid on top |
| BE | Final Payable | Net + Sunday salary |

**Attendance marks** (the legend from columns BI/BJ of the sheet):

`P` present · `A` absent · `HF` half day · `AD` absent 2 days · `PH` paid holiday ·
`SP` Sunday present · `HP` holiday present · `WH` work from home · `S` Sunday off

Only `A`, `HF` and `AD` reduce the salary. `SP` and `HP` add a day's pay. A blank day
counts as worked.

### Where it differs from the spreadsheet, on purpose

- **Working days, hours/day and the PT slab are per month.** The sheet hard-codes
  `/26`, `/9` and `IF(>12000, 200, 0)` into every formula. Here each month stores its
  own values, so a 27-day month does not mean editing 75 rows, and changing the slab
  never rewrites a month already paid.
- **A typed number over a formula is recorded as an override.** The sheet has both
  (e.g. `AJ` is sometimes a `COUNTIF` and sometimes a hand-typed `7.5`). Overridden
  cells are outlined in the dashboard, and clearing the box hands control back to the
  formula.
- **One number per employee per month.** The sheet spreads a person across a monthly
  tab, a "Sunday" tab and a "Cash" tab; here Sunday pay is a column on the same row.

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

## Running it

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

### First run

1. **Employees** → add a company, then employees with their monthly salary.
   Or skip ahead and import the existing sheet.
2. **New month** → pick the month; working days default to 26.
3. **Reports → Import a salary sheet** → choose the `.xlsx`, pick the tab,
   press **Check first** to see what it found, then **Import**.
4. **Attendance** → mark the days. Pick a mark from the palette and click cells, or
   type into them. Counts update as you go and save on their own.
5. **Salary sheet** → the calculated month. Type into OT, deductions, ESI or PF and
   the row and the totals move immediately.
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
  backend/
    src/db.js          SQLite schema and queries
    src/payroll.js     joins rows + attendance through the engine
    src/excel.js       export in the April layout
    src/importer.js    read an April-shaped sheet back in
    src/routes/        companies, employees, periods, reports
    test/              engine, API, import/export
  frontend/src/
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
