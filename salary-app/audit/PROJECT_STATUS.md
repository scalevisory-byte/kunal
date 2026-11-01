# BOOKNFLY HRMS — Project status

Audit date: **1 November 2026**
Revised: **1 November 2026**, after Phases 1 and 2 were approved and built. The audit below
is kept as the record of what was found; the two notes marked **Since the audit** say what
has changed.
Audited: `/salary-app` (the HRMS). `/wa-task-assistant` is a separate project and is out of scope.
Method: source inspection, the full test suite (425 tests, all passing), and the running app
driven in a browser on desktop and at phone width. Nothing was changed.

---

## 0. Read this first — the brief and the code disagree

The brief says: *"Check the existing dashboard, attendance, GPS, selfie, asset register,
barcode, handover, verification and service cost modules."*

Four of those **do not exist in any form** — not as a screen, not as a table, not as a
stub:

| Assumed to exist | Reality |
|---|---|
| Selfie capture | No code. `grep -i selfie` → 0 hits. |
| Barcode / QR generation | No code. `grep -i "barcode\|qr"` → 0 hits. |
| Asset verification | No code. |
| Asset maintenance / service cost / AMC / warranty / vendor | No code. `grep -i "maintenance\|amc\|warranty\|vendor"` → 0 hits. |

Also absent, and assumed by the brief:

- **Branch** is not a concept anywhere. `grep -i branch` finds one hit, in a code comment
  about JavaScript branches. What exists is **companies** (BOOKNFLY PRIVATE LIMITED,
  BOOKNFLY, BOOKNFLY VENTURE LLP, SCALE) with a filter across the whole app.
- **User roles and permissions** do not exist. There is one shared password.
- **Device verification** does not exist.

So the honest shape of this project is: **a very complete payroll and attendance system,
a thin asset list, and no asset-maintenance module at all.** Modules 1–5 of the brief are
largely built; modules 6–9 are between a quarter and nothing.

---

## 1. What is already developed, module by module

### 1. Dashboard — **mostly complete**

Opens on a daily roll call. Verified on screen.

| Brief asks for | Status |
|---|---|
| Total employees | ✅ Complete |
| Present / absent employees | ✅ Complete — named lists, not just counts |
| Late arrivals | ✅ Complete — also early out, overtime, half day, not-marked |
| Pending approvals | ❌ **Missing from the dashboard.** The counts exist (People → Reminders) but nothing surfaces them here |
| Upcoming birthdays and work anniversaries | ⚠️ **Partial** — the card exists and works, but it reads `dob` / `joined_on`, which are blank for most staff, so it is usually empty |
| Asset summary | ❌ Missing |
| Maintenance alerts | ❌ Missing (no maintenance module) |

It also carries month-on-month money, a six-month trend, a by-company table, a
"needs attention" list (unpaid salaries, unpaid Sundays, unmarked days, over-quota leave,
missing UAN/ESIC), payment-mode split and filing dates. More than the brief asks for.

### 2. Employee Management — **complete, except branch**

| Brief asks for | Status |
|---|---|
| Employee master | ✅ Complete — 40+ fields, inline edit, bulk edit |
| Department and designation | ✅ Complete |
| Branch allocation | ⚠️ **Company allocation, not branch.** A decision is needed — see DEVELOPMENT_PLAN §2 |
| Joining and exit details | ✅ Complete — joining date, exit record, notice, F&F |
| Contact details | ✅ Complete |
| Employee documents | ✅ Complete — on disk, expiring signed links, KYC completeness, expiry flags |
| Employee status | ✅ Complete — active/left, plus an append-only change history |

Beyond the brief: reporting manager with loop protection, onboarding checklist,
per-employee report across months, salary structure.

### 3. Attendance — **complete on the office side, partial on the phone**

| Brief asks for | Status |
|---|---|
| GPS-based punch-in/out | ⚠️ **Partial, and see BUG-1.** Punches are recorded with distance and fence; they write a clock time but **no mark and no working-hours effect** |
| Selfie capture | ❌ Missing |
| Device verification | ❌ Missing |
| Late arrival and early departure | ✅ Complete — to the minute, with the 300-minute concession |
| Working hours | ✅ Complete on the Time tab and the biometric import; ⚠️ see BUG-2 for other paths |
| Missing punch correction | ✅ Complete — request → approval, nothing auto-approves |
| Attendance register | ✅ Complete — Excel-style grid, bulk tools, date ranges, day marker, festivals |
| Monthly attendance report | ✅ Complete — month summary and day-by-day muster, both to CSV |

Beyond the brief: biometric file import (two formats, including legacy `.xls`), festival
holidays by religion, weekly-off policies, sandwich leave.

### 4. Leave Management — **complete, except a leave file**

| Brief asks for | Status |
|---|---|
| Leave application | ✅ Complete — from the employee's own link, a run of days is one request |
| Leave balance | ✅ Complete — counted off the marks, so it cannot drift |
| Approval and rejection | ✅ Complete |
| Leave history | ✅ Complete — per employee, across the year |
| Leave report | ⚠️ **Partial** — on screen only. No CSV or print |

### 5. Payroll — **complete and the most trustworthy part of the project**

| Brief asks for | Status |
|---|---|
| Salary structure | ✅ Complete — Basic / HRA / conveyance / medical, special derived |
| Attendance-based salary | ✅ Complete |
| Salary deductions | ✅ Complete — PT, PF, ESI, loan, one-off deduction, late/early |
| Overtime | ✅ Complete |
| Monthly payroll | ✅ Complete |
| Payslip generation | ✅ Complete — recomputes rather than reading a stored row |
| Payroll reports | ✅ Complete — Excel, CSV, bank statement, 4 statutory CSVs, his own monthly pack |

**The two policies named in the brief are in place and were re-verified during this audit:**

- **26 working days** — a constant in code, not a setting. The API refuses to store anything
  else and the UI shows it as fixed text.
- **300-minute monthly late/early concession** — implemented, and **switched off on every
  month**. A panel prices the switch before it is made.

### 6. Asset Management — **a quarter built**

| Brief asks for | Status |
|---|---|
| Asset register | ⚠️ **Partial** — kind, name, serial, value, company, who has it |
| Asset ID | ❌ Missing — rows have a database id, not a human asset code |
| Purchase details and cost | ⚠️ **Partial** — one `value` field. No purchase date, vendor, invoice or warranty |
| Branch allocation | ⚠️ Company, not branch |
| Employee handover and return | ✅ Complete — issue, return, condition, dates |
| Barcode / QR generation | ❌ Missing |
| Asset verification | ❌ Missing |
| Asset history | ⚠️ **Partial** — issue/return are on the audit trail, but there is no asset-wise history view |

### 7. Asset Maintenance — **does not exist**

Every line of the brief's module 7 is missing: maintenance records, service date, vendor,
maintenance cost, AMC, warranty, next service date, reminders, asset-wise service history.

**Therefore the three cost checks in the brief's §6 cannot be run:** service cost, total
asset ownership cost, and duplicate service cost entries have nothing to test.

### 8. Basic Reports — **five of seven**

| Brief asks for | Status |
|---|---|
| Employee report | ⚠️ **Partial** — a per-employee report exists; there is no employee-master export |
| Attendance report | ✅ Complete |
| Leave report | ⚠️ Partial — screen only |
| Payroll report | ✅ Complete |
| Asset register (report) | ❌ Missing — list on screen, no file |
| Asset handover report | ❌ Missing |
| Maintenance and service cost report | ❌ Missing |

### 9. Admin — **was the weakest module; now built**

> **Since the audit.** Real logins (scrypt + a signed session cookie), three roles enforced
> on the server, branches beneath a company, a daily `VACUUM INTO` backup with a written
> restore, and a sign-in log that keeps the refusals. The table below is what was found at
> audit time.


| Brief asks for | Status |
|---|---|
| Login | ⚠️ **Partial and unsafe as configured.** One shared password. **Unset means the whole app is open** |
| Basic user roles and permissions | ❌ Missing entirely. Everyone who has the password can do everything |
| Branch management | ❌ Missing (company management exists: rename, delete, filter) |
| System settings | ⚠️ Partial — per-month settings exist; no settings screen |
| Audit history for important changes | ✅ Complete — see below |

The audit trail is genuinely good and worth keeping as-is: it records a *corrected*
attendance mark but not a blank day being filled in, a figure typed over a formula by name
and column, an override handed back to the formula as `(formula)` rather than `0`, month
closing, and late/early rule changes. Every line reads without a join.

---

## 2. What is working — tested and verified

425 automated tests, all passing. Spread:

```
api 51  people 44  calc 31  settlement 25  lateEarly 22  hiring 21  structure 19
contributions 17  punchClock 17  attendanceRequests 17  timesheet 14  sandwich 13
monthlyStatus 13  attendanceReport 11  employeeReport 11  monthlyPack 11
hiringMessages 11  digest 9  statutory 9  match 9  onboarding 8  weeklyOff 8
punches 8  festivals 6  lateEarlyApi 6  sheetLayout 5  importer 5  stages 4
```

**Re-verified live during this audit**, against an independent calculation:

| Check | Reported | Independent | |
|---|---|---|---|
| Working hours, 26 days of 09:52–18:20 | 13,208 min | 13,208 min | ✅ |
| Late minutes | 572 | 26 × 22 = 572 | ✅ |
| Early minutes | 260 | 26 × 10 = 260 | ✅ |
| Chargeable after concession | 532 | 832 − 300 = 532 | ✅ |
| Late charge on the default policy | ₹0 | must be ₹0 | ✅ |
| Late charge on the concession policy | ₹985.19 | 532 × ₹1.8518 = ₹985.19 | ✅ |
| Gross movement on switching | ₹985 | ₹985 | ✅ |
| Short hours double-charged on the concession policy? | No | must be No | ✅ |
| Day rate / hour / minute at ₹26,000 | 1,000 / 111.11 / 1.85 | 26000/26, /9, /60 | ✅ |

**Earlier verification still standing:**

- April sheet: 72 of 74 rows reproduce gross, net and Sunday pay exactly. The two that
  differ are cells where a net was typed over the formula in the spreadsheet itself.
- September files: 85 of 85 rows match gross **and** net; every total reconciles
  (salary 20,89,000 / deduction 11,150 / PT 14,400 / PF 3,600 / net 19,01,078 / Sunday
  register 44 people, 96,651).
- October, 115 rows: the salary breakup and the PF/ESI work moved **zero** rows — net
  ₹14,48,366 before and after.

**Mobile:** verified at 390 × 844. No horizontal page scroll on Dashboard, Salary sheet,
Attendance or People; wide tables scroll inside their own frame. No console errors.

---

## 3. What is incomplete

Ranked by how much it matters.

1. ~~**Admin and security.**~~ **Done** — see the note under module 9.
2. ~~**GPS punching does not affect attendance**~~ **Fixed** — see BUG-1.
3. **Asset maintenance** — absent entirely, including the cost reporting the brief asks for.
   **This is now the largest gap.**
4. **Asset register depth** — no asset code, purchase date, vendor, warranty, QR or
   verification.
5. **Branch** — not modelled.
6. ~~**Backup and recovery on the server**~~ **Done** — a daily `VACUUM INTO`, kept for a
   fortnight, downloadable, with a restore procedure in the README.
7. **Not deployed.** `Dockerfile` and `railway.json` exist but the image has never been
   built (no Docker daemon available). The app has never run anywhere but a laptop.
8. **Selfie and device verification** — absent.
9. **Reports** — no asset register file, no handover file, no leave file, no employee master
   file.
10. **Dashboard** — no pending-approvals tile, no asset summary; the birthdays card is
    usually empty for want of data.

---

## 4. What exists beyond the brief

The brief says to add nothing unnecessary. It does not say to remove anything, and nothing
here needs removing — but none of it needs further work either, and it is all skippable:

- **Hiring** (module 5 of the earlier HRMS list) — vacancies, public apply page, CV upload,
  pipeline, interviews, match scoring, hire-to-payroll handover.
- **His monthly report pack** — his exact September layout, 85/85 verified.
- **Festival holidays by religion**, with ~40 festivals and alias matching.
- **Sandwich leave**, **weekly-off policies**, **appraisals**, **warnings and
  appreciations**, **tasks**, **helpdesk**, **expense claims**, **reminder digest**.
- **The single-file build** — one 1.6 MB HTML file that runs from `file://` with no server.
- **Biometric imports** — two device formats, including legacy `.xls`.

---

## 5. Technical review

| Question | Finding |
|---|---|
| Multiple employees | ✅ Fine. 115 rows verified; SQLite with WAL is comfortable to a few thousand |
| Multiple branches | ✅ **Done since the audit.** Branches beneath a company, as Dinesh chose |
| Secure login | ✅ **Done since the audit.** Real logins, three roles enforced server-side, refuses to start open |
| Reliable data storage | ✅ SQLite + `better-sqlite3`, WAL on, foreign keys on, migrations guarded by `PRAGMA table_info` |
| Mobile usage | ✅ Verified at phone width, no horizontal scroll, no framework |
| Future expansion | ✅ Good. `shared/` is dependency-free and imported by both server and browser, so they cannot drift. 425 tests |
| Backup and recovery | ✅ **Done since the audit.** Daily copy, downloadable, documented restore |

**Recommended technical work — only what is necessary:**

1. Real login: a `users` table, hashed passwords, a session, and two or three roles. No new
   framework; `node:crypto` scrypt and a signed cookie are enough. The purpose-scoped token
   module (`backend/src/tokens.js`) already exists and can be reused.
2. A nightly SQLite backup (`VACUUM INTO`) plus a documented restore. No tooling needed.
3. Refuse to start with `APP_PASSWORD` unset unless an explicit `ALLOW_OPEN=true` is set.
4. Actually deploy it, and confirm the volume survives a restart.

**Explicitly not recommended:** changing the database, adding an ORM, adding a UI framework,
adding a queue or Redis, or splitting into services. None is needed at this size, and each
would cost more to maintain than it returns.

---

## 6. What must not change without approval

Verified in place and left untouched by this audit:

- **26 working days**, fixed.
- **300-minute monthly late/early concession**, and the fact that it is **off** until
  switched on per month.
- **PT on the month's gross**, not the master salary, with Sunday pay outside the line.
- **Sunday pay settled on its own register**, never added into the salary sheet.
- **Only privilege leave is encashed** at exit; CL and SL lapse.
- **Gratuity at 15 days per year on a 26-day month.**
- **Nothing auto-approves anywhere.** A request never writes attendance; an approval does.
