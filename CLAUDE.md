# CLAUDE.md — Project Instructions for Claude Code

## Who this is for
Dinesh Parmar, entrepreneur based in Vadodara/Surat, Gujarat. Runs Book N Fly (travel agency), Scale Visory (accounting/tax/legal advisory), ZYNTA Placement Services (recruitment), Arth Advisory (formerly Artha Bad Debt Recovery), and Arrohan Living (furniture/interior). Wants a personal task assistant that reads his WhatsApp and manages tasks/reminders.

## Project goal
Build a personal assistant that:
1. Connects to Dinesh's **personal WhatsApp** (not just a business number)
2. Reads incoming messages automatically
3. Extracts actionable tasks from them using AI (task, due date, priority, source contact)
4. Stores tasks in a simple task manager / dashboard
5. Organizes them (open/done, priority, due date)
6. Sends reminders back on WhatsApp for due/overdue tasks
7. Eventually needs a mobile-friendly way to view/manage tasks (PWA, not a native app — see "Mobile" section below for why)

## Current state — what's already built

Located at `/wa-task-assistant/` (backend + frontend). Rebuilt in-repo from this spec; see `wa-task-assistant/README.md` for the full run/deploy guide.

### Backend (Node.js + Express)
- `whatsapp-web.js` for the WhatsApp connection — QR-code login (like linking a device), NOT the Meta Business Cloud API. This matters: Business API can only see messages sent TO a business number. Dinesh wants his personal chats read, which requires the WhatsApp Web session approach instead.
- Incoming messages get buffered (~15s of quiet) and batch-sent to **Claude (Anthropic API, model `claude-sonnet-4-6`, overridable via `ANTHROPIC_MODEL`)** with a system prompt that extracts `{title, description, contact, chat_name, due_date, priority}` as JSON. Ignore casual/non-actionable messages.
- **SQLite** (`better-sqlite3`) for storage: `messages` table (raw incoming messages) and `tasks` table (extracted/manual tasks with status, due_date, priority).
- **node-cron** job runs twice daily (8:30 AM & 6 PM IST) — sends a WhatsApp digest of every open task that is due, overdue, or undated, back to Dinesh's own number. Reminders **repeat every run until the task is marked done**; each send bumps `reminder_count`, which the digest and dashboard show as "asked 4x" / "reminded 4×".
- REST API (`/api/tasks` — GET/POST/PATCH/DELETE) for the dashboard to read/write tasks.

### Frontend (React)
- Simple dashboard: list of tasks, filter by open/done/all, manual add form, mark done, delete, inline edit of due date/priority. Polls every 30s for new WA-extracted tasks. Plain CSS in `src/styles.css` (mobile-first, dark mode via `prefers-color-scheme`), no UI framework.

### Two capture modes (`EXTRACTION_MODE`)
Dinesh asked what the product looks like without Claude, citing cost, third-party dependency, privacy, and possibly reselling it. A keyword-based extractor was measured against held-out Hinglish messages and scored 33% recall (missed two real tasks in three), so it was **not** built. Instead there are two honest modes, switchable by env var:
- **`ai`** (default) — Claude reads all incoming chats. Ambient, best quality, ~₹275/month at 100 msgs/day.
- **`manual`** — no AI, no API key, zero cost. Tasks come only from messages Dinesh writes or forwards to his own "message yourself" chat, or any message prefixed with `TASK_TRIGGER` (default `#task`). `quickparse.js` does deterministic date/priority parsing on his own words. Other people's messages are never read and the `messages` table stays empty, which is the privacy answer.

He asked to see both before choosing, so both ship and the dashboard shows which is active.

### Added since the original spec
- **Deployment config** — `backend/Dockerfile` (bundles Chromium for `whatsapp-web.js`, builds the frontend) plus `railway.json`. Set the Railway service root directory to `wa-task-assistant` and mount a volume at `/data` (`DATA_DIR=/data`) so the SQLite file and WhatsApp session survive restarts. Not yet actually deployed.
- **Dashboard auth** — a single shared secret via `DASHBOARD_PASSWORD`. Every `/api/*` route requires `Authorization: Bearer <it>`; `/healthz` stays open. Unset means no auth, which is fine locally but not on a public URL.
- **PWA layer** — `manifest.webmanifest`, a service worker (app-shell cache + push handler), and web push via VAPID keys. Reminder digests go out on WhatsApp *and* as browser/phone notifications.
- **QR code over HTTP** — `GET /api/status` returns the linking QR as a data URL and the dashboard renders it, so re-linking after a deploy doesn't need shell access.

### Not yet done
- **Actually deploying it** — the config exists but nothing is running on Railway yet, and the pipeline has never been exercised against the real WhatsApp Web or the real Anthropic API (no key available in the build environment; extraction is verified against a mock of the Messages API).
- **Chat filtering** — in `ai` mode it still scans ALL incoming chats. Dinesh may want an allow-list of specific chats/groups rather than personal/family chats. Ask before building this — not yet decided. (`manual` mode sidesteps it entirely: nothing incoming is read.)
- **Mobile access** — decided against building a native app that reads WhatsApp on-device (no legitimate API for that; workarounds are accessibility-hack/spyware-adjacent territory, ruled out). The PWA above is the answer instead: the backend runs 24/7 in the cloud (works independently of Dinesh's phone thanks to WhatsApp multi-device — a linked device session doesn't need the phone online), and the dashboard installs to the home screen.

## Second project — salary calculation software (`/salary-app/`)

Dinesh shared `Salary_Sheet_2627.xlsx` (April tab) and asked for software built around it.
Node + Express + SQLite backend, React dashboard, same stack and conventions as the task
assistant. See `salary-app/README.md`.

- `shared/calc.js` is the calculation engine, a column-by-column translation of the April
  tab (AH..BE), imported by **both** the API and the dashboard so the browser recalculates
  with the same code the server uses.
- **PT is charged on the month's gross**, as the sheet does (`=IF(AV>12000,200,0)`) — not
  on the master salary. Dinesh first said "if salary is more than 12000", then corrected
  it to "jo payable aayega uspe", i.e. what the month actually pays. Sunday pay is NOT
  counted towards the line (it sits outside the gross); including it would move exactly
  2 people in April — Mahesh Shinde and Riya Pal — and take the month's PT from 10,000 to
  10,400. **This was put to Dinesh; check the answer before assuming.**
- Verified against the real sheet: 72 of 74 salaried rows reproduce gross/net/final exactly.
  The 2 that differ are rows where a net salary was typed **over** the formula in the sheet
  (Hiral Tandel AZ17, Priti Kadam AZ58). Priti Kadam's ESI cell is also `=IF(AW58>12000,...)`,
  testing PT instead of gross — a copy-paste slip in the sheet worth flagging to Dinesh.
- **Working days are fixed at 26 for every month** (`STANDARD_WORKING_DAYS` in
  `shared/calc.js`) — Dinesh asked for this explicitly. It is a constant, not a setting:
  `calculateRow` ignores whatever a period carries, `createPeriod`/`updatePeriod` refuse
  to store anything else, and the dashboard shows it as fixed text. Hours/day and the PT
  slab stay **per month**, so a changed slab never rewrites a month already paid.
- Attendance codes come from the sheet's own legend (BI/BJ): only A/HF/AD reduce salary,
  SP/HP add a day's pay. **PL (Paid Leave) and UL (Unpaid Leave) were added on top** —
  Dinesh asked for a leave option and the sheet only has plain absence. Paid leave costs
  nothing, unpaid leave deducts a day like A but is counted separately on the payslip and
  in the export, so he picks which kind per day rather than us guessing.
- Attendance is marked by clicking a day and picking the mark **by name** (each option
  shows its salary effect, e.g. "Absent −1 day"); typing the code still works, and
  "Fill blanks…" marks a whole row.
- **Short hours are per day, in minutes** — the same day menu has presets (15/30/40/45/60/
  90/120) and a free box, and shows what a minute is worth for that employee. Minutes sum
  into the sheet's AS column and are paid/deducted at salary ÷ working days ÷ hours ÷ 60.
  `payroll_rows.ot_minutes` is nullable and acts as an override over the daily sum, like
  the other override columns; there is a migration that rebuilds the table for older DBs.
- Imports an April-shaped tab (company in A, name in C, marks in D–AG, salary in AL);
  exports back to the same layout with live SUM subtotals. Matches employees on company+name.
- **Two builds from one source.** `npm run build` makes the dashboard the server serves;
  `npm run build:standalone` makes `frontend/dist-standalone/Salary-Sheet.html`, one ~1 MB
  self-contained file that runs from `file://` with no server and keeps its data in
  localStorage (`frontend/src/localStore.js` answers the same API paths). Verified fully
  offline — zero network requests — against the real April sheet, same totals as the
  server. Backup/restore is in Reports, because that browser is the only copy.
- The standalone file ships with the **staff list baked in**: `frontend/scripts/make-seed.mjs
  <sheet.xlsx> [tab]` writes `frontend/seed.json` (git-ignored — real salaries) and
  vite.config.js inlines it as `__SEED__`. Only the master is seeded, never attendance, and
  only into a browser that has stored nothing, so it never overwrites Dinesh's edits. The
  file sent to him carries all 74 employees across BNF PVT LTD/BNF/BNF VENTURE/SCALE.
- `shared/` now also holds `sheet.js` (reads an April-shaped tab) and `workbook.js`
  (writes one), both dependency-free — the caller passes ExcelJS in — so the server and
  the standalone file cannot drift apart. `api.js` lazy-imports localStore so the server
  bundle stays ~190 KB instead of pulling ExcelJS in.
- **Sunday pay has its own register** (`SundayRegister.jsx`, a "Sunday" tab), modelled on the
  workbook's "May Sunday"/"June sunday" tabs: who worked which dates, day rate, amount, with
  its own `sunday_status`/`sunday_mode` columns so it is paid and ticked off separately from
  the month's salary. Exports as its own sheet in the workbook and as `sunday.csv`. This is
  also why Sunday pay stays out of the PT line.
- **Sunday pay is settled entirely apart** — Dinesh confirmed *"Sunday ka amount main register
  me nahi aana chahiye"*. So `final_payable = net_salary` (the source sheet's `BE = AZ + BD`
  no longer holds), the salary sheet ends at **Net payable** with no Sunday ₹ or Payable
  column, and the Excel export and monthly CSV carry no Sunday amount. The register is the
  only place it is paid from. **The statutory wage register is the deliberate exception** —
  it keeps a Sunday column and adds it in, because a muster roll that left out wages
  actually paid would understate them.
- `SundayRegister.jsx` **recomputes with `calculateRow`** — a Sunday count typed on the
  salary sheet is saved as an override and the PATCH echo carries no recalculated figures,
  so the person was missing from the register and would never have been paid.
- `shared/workbook.js` now drives every column position off one `CALC_COLUMNS` list (header,
  value, number format, SUM footer), because the hand-numbered `base + N` offsets had already
  drifted once when Add/Deduct was inserted.
- **Mark everyone Present** on the attendance toolbar fills every blank day for everyone
  on screen (Sundays as S), never overwriting an existing mark.
- **"A date range…"** in each row's menu marks one person across many days (a fortnight off).
  It replaces existing marks and **skips Sundays** — Dinesh chose that: a Sunday is already an
  off day, so marking it absent would dock a day nobody was due to work. Choosing a Sunday
  mark (S/SP) inverts it to cover only the Sundays in the range.
- **Clicking a date header** opens a day marker: one day, a chosen mark, and a chosen set of
  people (everyone / a group / ticked names). Built for **festival holidays, which are paid
  for some staff and a working day for others** — Dinesh raised exactly this. It replaces
  marks already on that day by default (it normally runs after "Mark everyone Present") and
  states the count on the button before it acts.
- **`employees.religion`** (free text, with suggestions) plus a **`holidays` table** per
  period drive the festival system Dinesh asked for: a festival carries the religions it
  covers, and applying it writes its mark (Paid Holiday by default) onto that day for
  exactly those people — Eid for the Muslim staff, Diwali for the Hindu staff, everyone
  else works. No religions on a holiday = the whole office. `Festivals.jsx` is the panel,
  at the top of the Attendance tab; holidays persist as a list with `applied_at`, and
  "Apply again" is idempotent so a new joiner can be caught up.
- Applying **overwrites** that day's marks, so it must run after "Mark everyone Present".
- **`shared/festivals.js` knows which religion a festival belongs to** — Dinesh asked *"konse
  religion ka festival hai kaise pata chalega"*, and until then the answer was "you tell it".
  Typing the name now ticks the religions: ~40 festivals with aliases, so *Deepavali*,
  *Bakrid*, *Ramzan Eid*, *Uttarayan*, *Gurpurab* all resolve. `religionsToTick` narrows to
  religions actually on the staff list and names the rest, so a festival never silently
  applies to nobody. Ticks stay editable — it is a starting point, not a rule.
- **Dates are deliberately NOT guessed.** Lunar festivals move a fortnight or more between
  years and a wrong date costs a day's pay, so only genuinely fixed ones carry `fixed`
  (Republic Day, Independence Day, Gandhi Jayanti, Labour Day, Makar Sankranti, Christmas);
  those also show as a one-click row when they fall in the open month. There is a test
  asserting the lunar ones carry no date.
- The column was briefly called `group_name`; the migration moves any values across.
- Employees can be **ticked and given a religion in bulk** (`onBulkPatch` in App.jsx patches
  them all and reloads once, rather than reloading per employee). Setting 74 people takes
  two passes: select all → "Hindu", then search each exception → "Muslim".
- The uncontrolled `defaultValue` boxes in the employee table are **keyed on their stored
  value**, so a bulk edit that changes data under a row already on screen re-renders the
  box instead of leaving a stale number showing.
- A **company filter** runs across the whole app (state in `App.jsx`, remembered in
  localStorage): the strip under the month picker, the company name above each block on
  the salary sheet, and the chips under Employees all set it, and the salary sheet,
  attendance grid and employee list all honour it. Companies can be renamed and deleted
  from their chip — before this, clicking a company did nothing at all, which is what
  Dinesh reported.
- **HRMS modules** (Dinesh asked for a "full HRMS", order 1-2-3-4, for Book N Fly first):
  1. ✅ **Employee record** — click a name in Employees: employment, personal, statutory
     (PAN/Aadhaar/UAN/PF/ESIC) and bank details, each saving on blur, with shape warnings
     that never block a save. `EmployeeProfile.jsx`.
  2. ✅ **Leave** — CL/SL/PL marks with per-employee yearly quotas (`cl_quota` etc.), taken
     counted from the marks across the year's periods so it cannot drift, negative balances
     flagged. `Leave.jsx`, `leaveSummary()` in db.js.
  3. ✅ **Loans and advances** — `loans` + `loan_repayments`; opening a month posts one
     repayment row per running loan (capped at the outstanding), which is then editable, so
     a month can be skipped without losing the debt. `loan_deduction` is a new input to
     `calculateRow`, deducted with PF/ESI. `Loans.jsx`.
  4. ✅ **Statutory registers** — `shared/statutory.js` derives PF (wages capped at 15,000,
     employee share = what was deducted, EPS at 8.33%), ESI (under the 21,000 limit,
     employer 3.25%), PT summed per company, and the wage register, all from the calculated
     month plus the profile identifiers. Missing UAN/ESIC numbers are named. `Statutory.jsx`
     in Reports; four CSVs. **The EPFO/ESIC upload formats drift — the README says to check
     a file against the portal template rather than trusting it.**
  Self-service and approval workflows are **not possible in the standalone file** and need
  the server; everything above works offline.
- **Absent / present report** (`shared/attendanceReport.js`, Reports) — asked for by name.
  Two shapes: a **month summary** (one line per person — P/HF/A/CL/SL/PL/UL, holidays,
  Sundays off and worked, days at work, days lost, payable days, unmarked days, attendance %)
  and a **day-by-day muster** (person against day, weekday on each column), both exporting to
  CSV with a BOM. It **computes nothing of its own** — it counts the same marks the salary
  sheet is paid from, and `payable_days` is the sheet's own figure (shown with ✎ when typed
  over the formula), so the report and the payslip cannot disagree. Three deliberate choices:
  **days lost is in days of pay** (HF costs 0.5, AD costs 2), **attendance % is out of days
  expected** not the calendar (a Sunday off is not a failure to attend), and a month with
  nothing marked reads as a dash, never 100%. Payroll rows carry the person as
  `employee_name`/`employee_code`, so the report accepts both spellings — it rendered blank
  name and code columns until it did.
- **Salary structure — Basic / HRA** (`shared/structure.js`, `SalaryStructure.jsx`) — Dinesh:
  *"salary structure basic hra banavo"*. `employees` gained `basic`, `hra`, `conveyance`,
  `medical`; **special allowance is deliberately NOT stored** — it is whatever is left of
  `monthly_salary`, so the parts can never drift from the total.
  **The rule the whole design hangs on: the breakup never changes what anybody is paid.**
  `calculateRow` derives the earned components from `gross_after_absent`, which was already
  computed from the single salary figure, and nothing downstream reads them — so gross, net,
  PT and every deduction are untouched. Verified on the real October data: all 115 rows
  byte-identical before and after, net ₹14,48,366 both ways, and there is a calc test
  asserting a month comes out the same with and without a structure.
  Components exceeding the salary are an error naming the amount over, never a negative
  allowance. The earned lines are pro-rated and **special absorbs the rounding**, so a
  payslip's lines always sum to its own gross to the rupee (there is a test over awkward
  salaries × absences). The Excel export and monthly CSV gained the five columns, blank where
  no structure is set — zero would read as "no HRA".
  **Bulk split** in Employees (tick, then "Split their salary"): Basic %, HRA % of basic, flat
  conveyance/medical, each person split from **their own** salary. HRA defaults to 40% of
  basic, not 50% — Vadodara and Surat are not metros for the exemption.
  **PF is reported, never changed:** the panel says what 12% of basic would be against what is
  actually deducted, with a button to match them, because changing it moves take-home and is a
  decision rather than a calculation.
  Two bugs found by running it: `listPayrollRows` did not select the new columns, so the
  payslip showed one line however the structure was set; and the components were scaled by the
  *month's* salary rather than the master they were typed against, which would have made a
  breakup vanish in a month whose salary was edited.
- **PF, ESI and PT computed** (`shared/contributions.js`, `Contributions.jsx`) — Dinesh:
  *"Pf esic pt"*. PF and ESI were numbers typed per employee that the app just deducted;
  with a Basic now available they can be derived. **PF** = 12% of earned Basic capped at
  ₹15,000 wages (falls back to gross when no breakup is set — what the app always reported);
  **ESI** = 0.75% of gross while ≤ ₹21,000, shares rounded **up**, which is the ESIC's own
  rule; **PT** = Gujarat slabs (nil to 12,000, then 200) held as a list so another state is
  data, with a period's own threshold/amount still winning so no paid month moves.
  **Nothing switches itself on.** `employees.pf_mode`/`esi_mode` default to `'fixed'` —
  deduct the typed number, exactly as before — and only `'auto'` applies the rule. The panel
  states what switching would cost before it is switched, and the bulk switch confirms,
  because unlike the salary split this one really moves money. Verified on the real October
  data: everybody on fixed → all 115 rows byte-identical, net ₹14,48,366 both ways; switching
  one person to auto moved the month by exactly their ₹872.
  `calculateRow` also returns the **employer side** (PF 12% split EPS 8.33%, plus EDLI and
  admin at 0.5% each; ESI 3.25%) so a real CTC is visible.
  The **PF register** now reports EPF wages as Basic where a breakup exists, and flags a row
  where the deduction is not 12% of the wages reported — the commonest reason an ECR bounces.
  **One bug worth remembering:** the preview read *"they would take home ₹1,215 more"* when
  switching a ₹0 PF to ₹1,080 — the sign was inverted. A test now pins that a bigger deduction
  cannot increase take-home.
- **One person's own report** (`shared/employeeReport.js`, "report" beside any name in
  Employees) — Dinesh: *"Per employee report / absent present / leaves / salary / monthwise
  report"*. One person **down the months** rather than one month across the staff: headline
  figures, leave against quota (CL/SL/PL taken and left, unpaid leave shown with no quota
  because it was taken anyway and docked), then month by month — present, absent, leave, days
  lost, payable days, attendance %, gross, PF/ESI/PT, loan, net and Sunday pay — with a year
  picker, Print and CSV. It **assembles, it does not recalculate**: every figure came out of
  `calculateRow`. Sunday pay sits beside the net, never added in.
  `GET /employees/:id/report` loads every month with **`sync: false`** — the same trap as the
  dashboard's trend: reading a year would otherwise backdate today's new hires into closed
  months and post loan instalments into months already paid. There is an API test.
  **One real bug it surfaced:** the month row and the footer disagreed on one page (73.7% vs
  80.8% for the same person) because the footer was worked out off `payable_days`, which
  counts an unmarked day as worked. Both now do the single-month sum — days attended over days
  expected — and a test pins that they match.
- **Employee record: manager, documents, history** — Dinesh pasted a "Core HRMS Modules"
  list whose module 1 (Employee Management) named three things the app did not have.
  **Reporting manager**: `employees.reports_to_id` points at another employee, so an org line
  is a join and not a name that goes stale; the record lists direct reports too, and
  `wouldLoop()` refuses self-reference and any cycle, because a chart that cannot be walked is
  worse than none. **Documents/KYC**: `employee_documents` plus `backend/src/documents.js`,
  the same shape as candidate CVs — file on disk under `DATA_DIR/documents`, row holds only a
  generated name, uploaded filename discarded, read back through an expiring signed link; the
  API strips `file_path` from every response and there is a test for it. `shared/documents.js`
  lists the kinds and which four count as KYC, so the record can say what is still missing and
  flag anything past an expiry date. **History**: `employee_history`, append-only, written by
  `updateEmployee` for a tracked field list (salary, designation, department, company, manager,
  PF/ESI mode, joining date, status). Values are stored **readably** — a company and a manager
  by name, not an id — a patch setting a field to the value it already had records nothing,
  and a free note can be added with no field change. All three need the server; the standalone
  build says so rather than showing an empty box.
- **Onboarding a new joiner** (`shared/onboarding.js`, `OnboardingChecklist.jsx`) — "Add to
  payroll" needs only a name and a salary, and then the PF return will not file for want of a
  UAN and the transfer fails for want of an IFSC. **Employees → "Still to finish"** lists
  everyone unfinished, newest joiner first; each employee record opens with a five-step
  checklist (who they are / the job / statutory numbers / bank / leave quota), each step
  saying **what breaks without it**. It is a checklist, **not a gate** — nothing blocks a save
  or a payslip; only joining date and monthly salary count as required, a Cash payment mode
  skips the bank step entirely, and a shape warning only fires once something has been typed
  (blank is "not yet", never "wrong").
- **Punching from a phone, and attendance approvals** (`shared/punchClock.js`,
  `shared/attendanceRequests.js`, `backend/src/attendanceSelf.js`, `PunchPage.jsx`,
  `AttendanceRequests.jsx`) — module 2 of Dinesh's HRMS list named four things the app lacked:
  mobile attendance, GPS punch, web restrictions and correction approval. (Late/early,
  overtime and employee-wise reports already existed.)
  **The employee's side has no password** — 115 people are not getting logins, so a signed
  token in a personal link *is* the identity (`GET /employees/:id/punch-link`, purpose-scoped
  `punch` token, long-lived because somebody bookmarks it). What it can do is deliberately
  small: punch as that one person, see their own punches and requests, raise a request. A test
  asserts the page exposes only id/name/code/company/designation — no salary, no PAN, nobody
  else. The employee id comes from the **token, never the body**, with a test that a punch link
  cannot raise a request in somebody else's name. **Said plainly in the UI and the README: a
  link can be forwarded and a phone handed over; the fence narrows it and the log makes it
  visible, and that is the honest limit — not a claim to have stopped buddy punching.**
  **A punch outside the fence is recorded and flagged, NEVER refused** — refusing leaves
  somebody genuinely at a client's office with no attendance at all, and it gets retyped that
  evening with no record. `PUNCH_ALLOW_OUTSIDE=false` makes it strict, deliberately. A GPS fix
  vaguer than 500 m gives `inside_fence: null` — "not known", which is not `false`. A missing
  point gives `distance_m: null`, never 0, because zero would read as "standing in the office".
  Punches roll up into the day's `in_time`/`out_time` — the same columns the Time tab writes
  and the sheet pays from — first punch in, last punch out, exactly as the biometric import.
  Nothing invents a departure: never-punched-out is a flag, not a guess.
  **A request never writes attendance; an approval does.** Nothing auto-approves, a pending
  request changes nobody's pay, a rejection writes nothing beyond the decision, nothing is
  decided twice or into a locked month, and approving writes only the fields the request named
  (the same merge rule `setAttendance` follows, so approving "in at 9:30" cannot blank a typed
  lunch). Tests for each sentence, plus an end-to-end API test: punch in at the office, punch
  out 4.7 km away, raise a request, approve it, see it on the grid.
  Punching is **off** until `PUNCH_ENABLED=true`. Needs the server; standalone says so.
- **The machine's Monthly Status report** (`shared/monthlyStatus.js`, Reports) — Dinesh sent
  `MonthlyStatus_BasicReport.xls`, the *other* report these devices produce: a month-wide grid,
  one sheet per company (BNF / BNFV / Default / SCALE), 114 people, the machine's own verdict
  per day. No column mapping — the shape is read off the file's own header. It opens the
  **legacy `.xls`** these devices still export, which the punch importer could not: ExcelJS
  reads only `.xlsx`, so the server path uses **SheetJS**. `WOP` → the app's **SP**, which is
  what the Sunday register pays from; reading it as plain presence would quietly stop those
  people being paid.
  **The thing this module exists to get right:** a day the machine has no record of looks
  exactly like a day everybody was absent — the report writes `A` for both. In his October file
  **all 114 people read `A` from the 23rd to the 31st** because the device stopped syncing on
  the 22nd; writing that through is **912 absences nobody earned**, eight days off every
  payslip. So a day where nobody at all is present *and* somebody is absent is treated as "no
  record" and left alone; it is named in the dry run and can be forced in with a tick. Both
  halves of that rule are needed — a Sunday carrying only `WO` is a known day off, not a gap,
  and still gets marked. The dry run also names anyone absent on *every* day the machine does
  have (34 people in his file — almost certainly never enrolled, or left).
  Merged cells bite differently in each reader: ExcelJS repeats a merged value into every cell
  it covers, SheetJS leaves the repeats blank, so "Company:" read as the company name until the
  extractor learned to skip anything that still reads as the label. Standalone reads `.xlsx`
  only and says so.
- **Biometric punches import** from `Reports`: `shared/punches.js` reads any export shape
  (the caller maps the columns; header row is auto-detected), groups rows by person and day
  (earliest punch = in, latest = out), and turns them into P/A/HF plus short-hour minutes.
  Dry run first, then write. Dinesh asked for a **real-time eSSL link**; that needs the
  server plus the device's ADMS/Cloud-Server push (device dials out, no port forwarding) —
  he chose file import for now and will check his device model.
- **Add / Deduct columns** for the occasional one-off Dinesh asked for (incentive, breakage,
  fine, reimbursement). Two boxes, not one signed number — a month can carry both, and a
  forgotten minus sign is expensive. They feed the sheet's AU
  (`adjustment = adjustment + addition - deduction` in `calc.js`), so PT is charged on the
  gross they produce. `payroll_rows` gained `addition`, `deduction` and `adjustment_note`,
  with a migration that splits any existing signed `adjustment` across the two. The payslip
  lists them separately under the remark; the Excel export and CSVs carry their own columns.
  The **wage register adds the deduction back into gross** and then lists it among the
  deductions, so `gross - deductions = net` still balances.
- `Payslip.jsx` **recomputes with `calculateRow`** rather than reading the row the server
  stored — it was showing stale numbers, and it was double-counting the deduction.
- **Time tab** (`TimeSheet.jsx`) — Dinesh asked for "in out lunch in lunch out time dale ne
  k liye time wala tab, total working hours k saath". The four clock times live on the
  **attendance row itself** (`in_time`/`lunch_out`/`lunch_in`/`out_time`, with a migration),
  not a separate table, so a day is one record. `shared/timesheet.js` parses what people
  actually type (`9:30`, `930`, `9.30`, `9`, `6pm`, `18:30`), handles a shift crossing
  midnight, and turns `out − in − lunch` into that day's `OT/LT` minutes — the same column
  the salary sheet already pays from, so hours become money with nothing else touched.
  `TIME_RULES` (4½ h half-day line, 15 min grace) is **shared with `punches.js`**, so a day
  typed by hand and a day read off the biometric machine are judged identically; the punch
  import now also writes `in_time`/`out_time` so imported days show on the tab.
- **`setAttendance` merges times per field.** An entry only touches a time column it names,
  so "Mark everyone Present" (which sends code+minutes) never wipes typed hours, and the
  punch import (which sends in+out) never wipes a typed lunch. Naming one with `''` clears
  it. There is an API test for exactly this.
- The mark is only auto-set to P/HF when the day is blank or carries a plain P/A/HF —
  leave, a holiday or a Sunday keeps its own mark and just records the hours. A day under
  4½ h is HF and its short hours are **not** deducted as well (it is already paid at half).
- `calculateRow` gained **`worked_minutes`**, so the month's clock hours ride into the
  Excel export and the CSV as an **Hours Worked** column.
- **Dashboard tab** (`Dashboard.jsx`), asked for as "dashboard do alag se" — and it is now
  the tab the app opens on. Headline money, a **Needs attention** list (unpaid salaries,
  unpaid Sundays, unmarked days, over-quota leave, missing UAN/ESIC, holds), and cards for
  attendance / hours / Sunday / statutory, plus a by-company table. Every figure calls
  `onGo(tab)` to open where it came from. It computes nothing of its own — same rows, same
  `calculateRow`, same `statutoryReport` — and groups companies from the **visible** rows so
  the company filter narrows it like every other tab.
- **Dashboard, second pass** ("dashboard alag se banavo and then other details"): a
  month-on-month comparison strip, a six-month **trend** of net payable (hand-drawn bars, no
  charting library, clicking one switches month), **People** (joined/left/birthdays/work
  anniversaries off the master), **Worth a look** (most days lost, most hours short, most
  overtime), **How it goes out** (payment-mode split, `Gpay`/`GPAY` folded together), and
  **Filing** (PF/ESI/PT with the usual Gujarat dates, stated as a reminder and captioned as
  one). The alerts now name the first few people behind each count.
- **Dashboard, third pass** — Dinesh: *"pay is not important in front, uski jagah pe how many
  present, who is present, whos absent, whos late, whos doing OT"*, then *"monthly bhi add
  karna"*. So the page now **opens on a daily roll call** and the money card sits below it.
  The roll call is one day (today, else the last marked day, `‹ ›` to step) with Present /
  Absent / On leave / Half day / Late in / Early out / On overtime / Not marked, each list
  **named**; Present is collapsed behind "show all N" because it is usually everyone.
- **Late and early live in `shared/timesheet.js`** (`isLateIn`, `lateByMinutes`,
  `isEarlyOut`) against the usual day from `frontend/src/standardTimes.js` — the Time tab's
  "usual timings", now its own module so both read one store. Same 15-minute grace as the
  short-hours rule. An overnight shift is never an early finish, and **a half day, leave, a
  holiday or an absence is never judged late or early** (`FULL_DAY_MARKS` in Dashboard.jsx)
  — it was not a full day. No clock time means "not known", never "on time".
- **"Who stands out this month"** card: month totals plus most days present / most days lost /
  most and fewest hours worked / most late / most early / most short / most overtime.
- **New joinees / birthdays / anniversaries** got their own card high on the dashboard
  (Dinesh asked for them by name after they were already in the People card but empty). The
  reason they were empty: nothing had `dob` or `joined_on`. So **Born and Joined are now
  columns on the Employees table**, not just the profile drawer, and the card says how many
  people still have neither. Anyone whose day falls on the roll call's day also shows at the
  top of it (🎂 / 🎉 / 👋).
- **A day with nothing on it explains itself.** Dinesh asked *"ye marked ka kya matlab hai,
  ye data to absent present report se ya time in out report se aayega"* — the roll call was
  listing all 74 names as "not marked yet", which reads as a fault rather than as an empty
  month. Now, when **nobody** is marked, the lists are replaced by one line saying nothing is
  guessed plus three buttons — import the punch file (Reports), mark the grid, type times —
  and the month-level alert says the same thing instead of counting blank days. A day with
  only a few gaps still names them.
- **The build date is stamped next to the title** (`__BUILT__` from vite.config.js). Every
  download lands as `SalarySheet (2).html`, `(3)`… so Dinesh had no way to tell which copy he
  had open — he asked "kaha gya, nahi he" about a feature that was simply in a newer file.
- **UI pass** — *"graphics looks UI bhi change karo, make it handsome"* then *"isko minimal
  banavo"*. `styles.css` was reworked, no framework and no new files: hairlines instead of
  borders, cards with no shadow, **stat tiles replaced by hairline-separated figures**, tabs
  marked by an underline rather than a filled pill, table headers as small caps on the
  page's own background, one accent used only where it means something, tabular numerals.
  Every class name was kept, so no component changed.
- `formatDuration` groups thousands and drops the minutes past 1,000 hours — a company's
  month reads `12,857h`, not `12857h 05m`.
- **`GET /periods/:id/payroll` gained `?sync=false`.** Reading a month normally runs
  `syncPayrollRows` + `postRepayments`, so the dashboard fetching five past months for the
  trend would have backdated today's new hires into them and taken loan instalments out of
  closed months. The trend passes `sync=false` for every month but the current one; there is
  an API test.
- **Monthly report pack** (`shared/monthlyPack.js`, Reports → "Monthly report pack") — Dinesh
  sent his two September files and said *"need this report every month"*. Three sheets in HIS
  layout, not the app's: `Sep-26` (bank), `Sep-26 CASH` (split on payment_mode), and
  `Sep-26 Sunday + Festival`. His marks (W/O, H/O), his columns, live formulas.
  **`gridMark` maps the app's 13 marks onto his 5 without moving a number**: leave keeps
  CL/SL/PL and counts as present (his absent formula only sees A and HF); AD keeps its code
  and the formula gains `+COUNTIF(...,"AD")*2`; **SP/HP come out as W/O/H/O** so the Sunday
  register is the only place that work is paid.
- **His "Gross Salary" is BEFORE the deduction** — the app's `gross_salary` is after it. Got
  this wrong first: every row with a deduction was out by exactly that amount. The pack's
  Gross is `ROUND(NetDays*perDay)` = `gross_after_absent`, and OT/Addition/Deduction come off
  in the Net. **Verified against his real September files: 85/85 rows match gross AND net.**
  There is a test pinning it.
- Two columns added to his block, **OT / LT** and **Addition**, because the app has them and
  a month carrying either would lose the money silently. Both zero → his formulas exactly.
- The register lists only people owed something; a festival merely taken off costs nothing
  and is already in the monthly salary. **Open question put to Dinesh**: on his register the
  festival cell says `H/O`, and his own legend reads "paid holiday mili" — but ANCHAL TIWARI
  got that holiday and is not on the register at all, so H/O there can only mean *worked the
  festival day and is owed an extra day*. Implemented as the app's **HP** mark. Confirm.
- `shared/sheet.js` **reads the column positions off the header** (`detectLayout`) instead of
  assuming April's: the pack has the name in B and dates from C, April has C and D. Falls
  back to April's positions when no header is recognised, so the old path is untouched. Two
  real bugs fixed with it: the **first** matching header wins (his cash tab carries the Sunday
  register alongside, so "Salary" appears twice and the right-hand one was winning), and a
  **TOTAL row is skipped** (its SUM carries a cached result, so it imported as somebody
  earning the whole payroll).
- `make-seed.mjs` now takes several `<file>[:tab]` sources and merges them, because the master
  is split across the bank and cash tabs. The current seed is **85 people** from September
  across BOOKNFLY PRIVATE LIMITED / BOOKNFLY / BOOKNFLY VENTURE LLP / SCALE.
- **The standalone now ships with a month filled in**, not just the master — Dinesh: *"DATA
  BHAR K DO"*. `make-seed.mjs --month YYYY-MM [--register <file>[:tab]] [--festival D:Name]`
  seeds the period, a payroll row each, every attendance mark, and the festivals; `localStore`
  `freshStore()` carries periods/payroll_rows/attendance/holidays through. Still **only into a
  browser that has stored nothing**, so it can never overwrite real work.
- **A register `HF` must NOT be written onto the main grid.** On the Sunday + Festival sheet
  it means half the festival day was *worked*; on the grid `HF` is half a day's *absence*. The
  first attempt wrote it through and docked Vaibhav Gupta 553 — which is exactly how the
  seeded totals came out 553 light. Now the grid is left alone and the half is settled through
  `sunday_salary_override`, which also carries his hand-adjusted rows (AJEETKUMAR 635, JAY
  GOSAVI/PRIYANKA/TUSHAR zeroed on hold) and the ANSARI SULEMAN arrear (2363, "Aug Differ..").
- `SundayRegister.jsx` now lists anyone with `sunday_salary > 0` as well as `sundays_worked > 0`
  — an arrear with no Sundays behind it was in the export but invisible on screen.
- `parseSheet` also returns `deduction`, `addition` and `status` (the pack keeps the deduction
  in its own column; April folded it into the signed AU).
- **Reconciled against his real September files, every total:** salary 20,89,000, deduction
  11,150, PT 14,400, PF 3,600, net 19,01,078, Sunday register 44 people / 96,651. Note his own
  typed TOTAL cells are stale (CASH says PT 4,600 and deduction 10,300; the rows add to 4,800
  and 10,350) — the app matches the **rows**, not those cells.
- **The grids were made to look like Excel** — *"MAKE LOOK LIKE EXCEL"*. Full gridlines, a
  row-number column down the left (`.row-no`, serial per company), a grey header band, one
  line per row, and the input IS the cell: no border or background until focus, which draws
  an inset outline like a selected cell. **`EditableCell` takes an `auto` prop** — the
  computed figure, shown as the placeholder — and the `<span class="hint">` under every box
  is gone; row height went 48px → 24px, 12 rows on screen → 25.
  Three things this broke and the fixes: `.sticky-name` got `left: 2.2rem` for the row
  numbers, which made it **overlap the next column on every other table** (the Festivals
  date read "ptember") — now scoped to `table.numbered`; `table.sheet` stretched every
  column to share the width, so the Time tab's six columns were enormous — now `width: auto`
  with the slack in `:last-child`; and `select { width: 100% }` clipped long company names —
  now `width: auto; min-width: 100%` so the column grows to fit.
- **Not yet deployed** — `backend/Dockerfile` and `railway.json` exist but no Docker daemon
  was available to build the image. Root directory `salary-app`, volume at `/data`. The
  production path *was* verified without Docker: `npm ci --omit=dev`, the built dashboard
  served from `backend/public`, auth on, and the SQLite data surviving a restart on the
  same DATA_DIR.

- **Late in, early out, and the 300-minute concession** (`shared/lateEarly.js`,
  `LatePolicy.jsx` on the Time tab) — Dinesh asked for this twice, calling it
  "particularly important": *"300-minute monthly late/early concession"*, *"late arrival —
  automatic late-minute calculation"*, *"early departure — automatic minute calculation"*.
  Every minute late in and left early is counted, pooled for the month, the first 300 free,
  the excess charged at the minute rate.
  **The thing this hangs on: it never charges the same minutes twice.** The app already
  deducts short hours (`out − in − lunch` against expected), and somebody half an hour late
  is already half an hour short there. So the two are **alternatives**: a period runs on
  `late_policy = 'hours'` (the long-standing behaviour, the default) or `'concession'`, where
  the hours-shortfall is no longer charged and only overtime pays. `calculateRow` picks one.
  `late_policy` defaults to `'hours'` on every existing and new month, so the migration
  cannot move a rupee — and the line is **still computed** on the default policy so the panel
  can price a switch before it is made. Held per month, so a rule changed in November never
  rewrites October. A day nobody clocked is "not known", never "on time"; a half day, leave,
  a holiday or an absence is never judged late; `employees.shift_in/shift_out` let a night
  shift be judged against its own hours instead of reading as five hours late every day.
  Daily grace is **0** by default: a monthly pool plus 15 min × 26 days gives away a second
  allowance nobody decided on.
- **The half-day line now follows the configured day** — half of the month's `hours_per_day`,
  not a fixed 4½. His list said "half day: based on configured working hours"; 4.5 was only
  right because the default day is nine. `shared/timesheet.js` and `shared/punches.js` derive
  it from the same figure, so a typed day and a machine-read day stay identical.
- **Weekly off** (`shared/weeklyOff.js`, `WeeklyOff.jsx` under Leave) — `companies.weekly_off`
  and `employees.weekly_off` hold a JSON policy; alternate Saturdays are supported because
  that is how much of Gujarat works and cannot be said as "every Saturday". **It cannot move
  money:** `S` still means the weekly off and `SP` still means it was worked; only which
  squares the grid treats as off days changes, so "Mark everyone Present" and a date range
  hit the right days. The column header still shades Sundays (a calendar fact); each *cell*
  follows that person's policy.
- **Sandwich leave** (`shared/sandwich.js`, `SandwichLeave.jsx`) — a day off caught between
  two absences. **A tool, not a setting:** nothing is stored, the panel finds the days, prices
  them and marks them on a click, because it is the harshest rule in the app. A run of off
  days goes together or not at all; a day actually worked (SP/HP) is never docked; a day at
  the very edge of the month is named and left alone (the other side is in another month);
  only A/UL close the sandwich by default, with CL/SL/PL available as the labelled harsher
  reading. It writes **UL**, not A, so absences are not inflated by days the rule docked.
- **Leave application and approval** reuse the `attendance_requests` queue rather than a
  parallel one — one list, one UI, one rule (*a request never writes attendance; an approval
  does*). A `leave` kind plus a nullable `to_day` makes a fortnight **one request and one
  decision**; approving writes every day in one transaction, so a half-approved fortnight
  cannot exist. Clock times are not repeated across a span. Raised from the employee's punch
  link, where the token is the identity.

## The People tab — `/salary-app/`, `backend/src/people.js` + `shared/settlement.js`

Dinesh's "Advanced HR Features" list, plus the two he named first ("warning and appreciation
records", "appraisal and increment history"). Nine panels under one tab, all needing the
server (the single-file build says so). Two rules hold across every one:
**nothing decides itself**, and **money reaches the payroll only through one call that names
the month it comes out of**.

- `employee_notes` — warnings and appreciations on one list (same record, opposite signs).
  A warning carries its formality and **when it was acknowledged**.
- `appraisals` — a **proposal until applied**. Measured against what they are on now, so an
  increment can't be worked off a stale figure. Applying writes the salary via
  `updateEmployee`, so it lands in `employee_history`; applying twice gives no second rise;
  an applied increment can't be edited or deleted.
- `assets` — nobody against it means **in the office**, not lost. What is out sorts first.
- `expense_claims` — raise / approve / **pay into a named month** as an addition on that row,
  added to whatever is there. Can't pay an unapproved claim, can't decide twice, can't pay
  twice (a double click cannot pay a petrol bill twice).
- `staff_tasks` — office work assigned to staff, **not** the WhatsApp task assistant.
  `overdue` is computed on read. A done task can't be deleted, only dropped; the phone can
  tick off but never drop (dropping work somebody gave you is the office's call).
- `tickets` + `ticket_replies` — **answering is not closing** (the employee decides whether
  the answer settled it, and replying puts it back to open), and **waiting means waiting on
  us**.
- `employee_exits` + `shared/settlement.js` — the F&F **assembles, never recalculates**: the
  final month's net is the payslip's own figure, read with `sync: false`. It adds leave
  encashment (**PL only** by default — CL/SL lapse), gratuity (15 days/year on 26 days, on
  Basic where set, **reported with its rule even when not due**; the Act's part-year rounding
  is stated as "7 years 9 months, counted as 8" because otherwise it reads as a
  contradiction), and notice **either way round** by exit type. **An unreturned asset is
  named and valued, never deducted** — docked and then found in a drawer cannot be undone.
  Settled once, after which the dates stop moving.
- `shared/digest.js` + `GET /api/people/digest` — the honest half of "Notifications". It
  works out *what* to say and **does not send**, stating why: WhatsApp has no legitimate API
  for a personal number and the task assistant already holds a session (a second one risks
  the number), email needs SMTP credentials, push needs keys and a service worker. Copy it,
  or point a cron at `?format=text`. A quiet day says "Nothing waiting".
- `audit_log` (in `db.js`, because the payroll write paths write to it and `db.js` cannot
  import `people.js`) — **a corrected attendance mark is recorded, a blank day being filled
  in is not**, so "Mark everyone Present" and the punch import stay out of it while an
  absence turned into sick leave is kept. A figure typed over the sheet is recorded by name
  and column; the same figure again is not a change; an override handed back reads
  `(formula)`, never 0. Closing a month and switching the late/early rule are on it.
  **`who` is a name typed on a form, not an authenticated identity** — one shared password,
  no accounts, and the UI says so.
- **Bug worth remembering:** the punch link's rate limiter used one counter per link across
  routes with different limits, so 20 punches starved the 5-per-minute ticket route. Each
  route now has its own bucket.
- **Bug worth remembering:** the standalone build never merged the master's
  `basic/hra/pf_mode/esi_mode` into the row it calculated (read side) *and* its
  `EMPLOYEE_FIELDS` omitted them (write side) — so the salary-breakup and PF/ESI panels
  looked as if they worked there and silently did nothing. Both halves fixed.

## Assets and maintenance — `/salary-app/` (Phases 3 and 4 of the audit plan)

The audit found the register was a name, a serial, one number and the current holder, and
that half of "handover" did not exist. `shared/assetCode.js`, `shared/barcode.js`,
`shared/assetReport.js`, `shared/maintenance.js`, plus the tables in `backend/src/people.js`.

- **`BPL-LAP-014`** — company prefix, kind prefix, running number. The series reads the
  **highest number already used**, not a count, so **a number is never reused**: an old
  service bill and a signed handover slip still refer to 002. A typed code is tidied, not
  rejected, for an office that already has stickers on its laptops.
- **Code 128, not QR, and the reason is in `shared/barcode.js`:** a QR code needs
  Reed-Solomon over a finite field — hundreds of lines that are easy to get subtly wrong and
  should come from a library thousands of people have scanned. Code 128 is a table plus a
  weighted checksum. There is a test that all 107 patterns are 11 modules wide (13 for the
  stop) with no duplicates, because one mistyped digit gives a barcode that looks perfect and
  scans as nothing. **If QR is ever wanted, use a small library — do not grow one here.**
- **`value` became `purchase_cost`** (migrated and the old column dropped — a column that
  must never be written again is how two numbers end up disagreeing), alongside purchase
  date, vendor, invoice, warranty, and the AMC as its own contract with its own date.
- **`asset_handovers` is the log**, append-only, written by the same calls that move the
  asset and **never read to work out the current holder** (the register holds that). The two
  answer different questions, so they cannot drift. Passing something straight to somebody
  else closes the first handover rather than losing it.
- **The stock take's whole reason for existing: "not checked" is not "missing".** Three
  figures, never two. "Not found" comes only from a verdict somebody recorded; an asset
  bought mid-round is simply not looked at yet. Counting the third as the second invents
  losses and gets somebody asked to pay for a laptop that is in a drawer. Re-checking
  replaces the verdict rather than leaving two that disagree.
- **Written off, not deleted** — anything ever issued refuses deletion (that would take its
  handovers and services with it). Writing off brings it back first, so nobody is left
  holding something that no longer exists, and it keeps its row and code.
- **The maintenance duplicate check runs before the save and ASKS** (409 carrying the row it
  resembles, button becomes "Add it anyway"), because two identical repairs on one day happen
  and a system that will not record the truth gets worked around. Same asset + same date +
  same amount; **deliberately not the note**, which is where "battery" and "Battery
  replacement" mean the same bill.
- **`next_service_on` is never computed** — only what the person doing the work said. No date
  means not scheduled, never overdue.
- The register names anything that has **cost more to keep than to buy**; free warranty work
  still counts as a service at ₹0.
- **Two bugs worth remembering, both from `SELECT s.*` plus a join:** `a.kind` silently
  replaced the *service's* kind (Repair) with the *asset's* kind (Laptop) so the timeline read
  "Laptop"; and `getService` returned SQLite's 0/1 for `under_warranty` where `listServices`
  returned true/false, so a POST echo and a list disagreed about one row.
- **And a trap hit twice:** a backtick inside an SQL comment that sits inside a JS template
  literal closes the literal. `db.exec(\`… -- see \`foo\` …\`)` is a syntax error. Never put
  backticks in a comment inside a template string.

## A login for every employee — the staff self-service side

Dinesh: *"ADMINSIDE USER BANANKAOPTION BHI DO / IS TJIS POSSIBLE WE GIVE LOGIN TO ALL EMPLOYEE
/ FOR CHECK SLARY AND ATTANECE RECORD AND DOPWNLAOD SALARY SLIP / CHEKC HOW SALARY WAS
CLAUDLALTED / APPLU LEAVE AND OTHER BASIC THINGS"*. `backend/src/routes/me.js`,
`frontend/src/components/MyPage.jsx`, `frontend/src/components/admin/StaffLogins.jsx`,
`frontend/src/components/ChangePassword.jsx`.

- **The fourth role is `employee`, abilities `['self']` — deliberately no `read`.**
  `users.employee_id` ties the login to one person (partial unique index, so one login each);
  `createUser` refuses a staff login without an employee and an office login with one.
- **The critical finding: every office router now carries `requireRead`.** Reads used to be
  open to anybody signed in, so a staff login would have fetched the whole payroll. There is a
  test asserting 403 on eight office URLs.
- **`/api/me` is the only door**, and `requireSelf` takes the employee id off the LOGIN, never
  a URL or a body — so an employee cannot ask for somebody else's payslip however the request
  is written. Every payroll read is `sync: false`: reading a year must not backdate a new hire
  into a closed month or post another loan instalment into one already paid.
- **"How was my salary calculated" is the question the page exists for**, so the row goes back
  whole — per-day rate, days counted, every deduction — and `MyPay` lays it out as a sum you
  follow down the page. The payslip is the **same `Payslip.jsx` the office prints**, not a
  second one; two would drift the first time a line was added.
- **A handed-over password is temporary for real.** `must_change` was being written, shown on
  the admin list, and acted on NOWHERE — so the one-time password read out over a counter kept
  working for ever, while the screen handing it over promised it would not. `ChangePassword`
  now stands in front of the whole app (office and staff alike, since an admin reset sets the
  same flag), the slip password is refused as "the password you already have", and a voluntary
  change still needs the current one.
- First passwords are three sayable words (`temple-jasmine-757`) because they get read out;
  usernames are `amit.shah`, then `amit.shah2`. **Shown once, on the screen that makes them** —
  there is nothing to look one up from afterwards.
- Leave applications join the **existing `attendance_requests` queue**, not a parallel one, so
  the one rule still holds: *a request never writes attendance; an approval does*. The form
  picks real dates bounded to the chosen month and converts to the day number the approval
  writes.
- `bank_account` and `ifsc` were added to `TRACKED_FIELDS`, because employees can now change
  them and a bank account changing the week before payday has to be visible by name and date.
- **Three bugs worth remembering.** (1) `row.payable_days` was undefined on the attendance tab
  — `calculateRow` returns `present_days`; the reports rename it afterwards. It rendered as a
  dash, so the figure looked missing rather than wrong, on the one page whose job is explaining
  the pay. Pinned as a number in a test. (2) `App.jsx` fired the office loads for a staff login
  too, so a staff sign-in opened with 403s and an error banner about periods; the loads are now
  gated on the role. (3) Driving this found the demo server had been serving **stale code**
  because the entry point is `src/index.js`, not `src/server.js` — `node src/server.js` starts a
  second app that dies on EADDRINUSE while the old one keeps answering.
- **Needs the server.** There is nothing in an HTML file on a laptop for an employee to sign in
  to, and anybody holding that file holds the whole payroll. The Admin tab says exactly that.

## The roll call: why they were out, and the late-coming list

Dinesh: *"NEED ABSNET REASON ALSO / APPROVED AND NOTAPPROVED WHAT / NEED LIKE TJHIS LIST FOR
LATE COMING ALS0"*, then *"roll call me absent reason aur late coming list add karo"*.

- **Two new columns on `attendance`: `reason` (text) and `approved` (nullable integer).**
  `approved` is **three-state on purpose** — null is "nobody has decided", which is NOT "not
  approved". A day nobody has looked at must not read as a refusal. Clicking the chosen one
  hands the decision back to null.
- **NEITHER MOVES A RUPEE**, and there is a test asserting gross, net, absent days, present
  days, PT and PF are all unmoved. An allowed absence is still an absence; paid time off is
  CL/SL/PL, which it already was. If this is ever asked to pay, it is a new mark, not a flag.
- Both follow the **same per-field merge rule** as the clock times, so "Mark everyone Present"
  cannot wipe a reason typed that morning and a punch import cannot un-approve an absence.
  Tests for both. A reason or a decision also **keeps the row alive with no mark at all** —
  somebody rings in the day before.
- **`entryFor` in `shared/attendanceRequests.js` now carries the request's reason onto the day
  and sets `approved: true`.** Somebody asking has already said why, and a day written BY an
  approval is approved by definition — the one place in the app where that is not a separate
  judgement. An existing test asserting "only what the request named" was rewritten to state
  the new rule rather than patched.
- **Audit:** a *decision* is recorded always, including the first one, because an approval is a
  decision and "who said this was fine" has to have an answer. A *reason* is recorded only when
  it REPLACES one — the first reason on a blank day is filling a blank, which is the line the
  trail has always drawn.
- **The roll call is still ONE table, narrowed by chips** (Everyone / Absent / Late coming /
  Early out / Half day / On leave / Short hours / Not marked), not eight strips of names again —
  that is what the page used to be and it could not say that one person was late *and* short.
  "Late coming" sorts by how late and adds **how many times this month**, flagged past three.
- The same two boxes are in the **day menu on the Attendance grid**, because that is where
  somebody marking the absence is standing, and a reason that must be typed on another screen
  is a reason nobody types.
- **The uniform check** (*"FOR IN PORPER UNIFORM OR NOT ALSO"*) is a third column,
  `attendance.uniform`, three-state for the same reason: a floor nobody walked must not read as
  a floor full of offenders. It has its own fold on the roll call listing **only people who
  were at work** (`WORKED_MARKS` — present, half day, Sunday or holiday worked), because there
  is no uniform to see on somebody who was not in and an absence must never read as a uniform
  failure. One bulk button fills in **only the not-looked-at**, as "Mark everyone Present" fills
  only blank days — otherwise it would undo the walk. ✗ puts them in the morning's list under
  an **Out of uniform** chip. A verdict is on the audit trail, like a decision.
- **Do not use an uncontrolled `<details>` for a fold whose contents reload.** The uniform fold
  was one and it would not stay open: the payroll reload under it reset the element. It is a
  `useState` toggle now, the same shape as the Present list beside it.
- **The backtick trap bit again**, exactly as warned below: `` `approved` `` inside an SQL
  comment inside a `db.exec(\`…\`)` template literal closes the literal and took every test
  down with "missing ) after argument list". Never put backticks in a comment inside a template
  string.

## The face on the employee record

Dinesh: *"IN EMPLOYE MATSR EMPLOYE EPHOOT ALSO NEED TO UPLOADED / EMPLOUEE DOCUMNTS ALOS NED TO
UPLOADED / BAMNK DETAILD LASO NEED TOI UPADTATED"*, then *"haan kar do photo wala"*.

**Inspected first, and two of the three already existed:** bank details are a section on the
record (and employees can now fix their own), and documents upload with a `photo` kind among
them. What was genuinely missing is that **a photograph was a filename in a list, never a
face** — and that **Bank sits below six other blocks**, which is why it read as absent.

- `frontend/src/components/EmployeePhoto.jsx` — `Avatar` (initials when there is none) and the
  upload slot. Uploading posts a document of kind `photo` through the EXISTING route, so there
  is one store and the KYC count stays right. A replacement is a new row, not an overwrite.
- `GET /api/employees/:id/photo` and `GET /api/me/photo` serve `newestPhoto()` **inline behind
  the session**, deliberately NOT as a signed expiring link like every other document: an
  `<img>` sits on a page all afternoon and a five-minute link turns eighty faces into eighty
  broken images. The **kind is pinned in the query**, so the route can only ever serve a
  photograph — tested with an Aadhaar card that stays a 404 there.
- `listEmployees` carries **`has_photo`** (an EXISTS subquery), never the file: asking the list
  for the pictures would send eighty photographs down the wire to draw eighty thumbnails.
- **A jump row** at the top of the record — Documents & KYC · Bank · Statutory · Salary breakup
  · History — because the fourth time somebody reports a feature as missing when it is merely
  below the fold, the fix is the way in, not the feature.
- **Bug worth remembering:** the documents panel kept saying *"Nothing on file yet · 4 still
  missing"* with the face already on screen above it, because it loads its own record and the
  header upload did not tell it. `EmployeeRecord` now takes a `refresh` prop the profile bumps.
  A stale "still missing" is how somebody uploads the same thing twice.
- Offline: initials everywhere, no upload box that could not work.

## A few hours off — short leave, with the no-double-charge rule

Dinesh: *"what if employee apply leave for 2 hrs 3 hrs 4 hrs / need dection for that type of
leave / erroer where 9 hrs not completed"*.

- A new request kind **`short_leave`** with `needs: 'minutes'` and a `minutes` column on
  `attendance_requests`. The employee picks it on MyPage's Leave tab or the punch link (presets
  30m–5h); the office approves it in the same queue as everything else. *A request never writes
  attendance; an approval does* still holds, with a test that the net is untouched while pending.
- **The rule that matters: it must never charge the same hours twice.** The app already deducts
  the clock shortfall (`out − in − lunch` against the day's hours), so somebody who left three
  hours early is ALREADY three hours short there. So `entryFor` writes the minutes **only when
  the day carries no clock times**; where it does, the hours stand and the approval records the
  reason. `entriesFor(request, { storedOf })` hands it the day, and `decideRequest` writes which
  happened onto the decision note. Tests for both halves. Same trap as the late/early concession.
- **The day stays Present** — no mark, no quota, only hours. A whole day or more is refused and
  names the day's length, because that is a leave application. The floor is 15 minutes.
- **No change to `calculateRow`.** It writes the minutes column the sheet has always paid from,
  so no existing month can move. Verified: 2h on a clean day = exactly 120 × the person's minute
  rate (₹22,502 → ₹22,280 on a ₹26,000 salary).
- *"error where 9 hrs not completed"*: the roll call's Short hours line now reads **"Short 50m of
  9h"** and the footnote states the full day, because "Short 50m" alone never said what the day
  was supposed to be.
- **Bug found on the way:** `updateUser` silently ignores an unknown field and returns 200, so
  `PATCH /auth/users/:id {must_change:false}` looked like it worked and did nothing. Left as is —
  `must_change` is deliberately NOT patchable, because an admin clearing it would re-enable a
  password that was read out loud. The forced screen is the only way off it.

## Starting again, empty — and the two builds

Dinesh: **"GIVE ME REMOVED ALL DATA"** — a clean copy to test with.

- **Reports → "Start again, empty"** calls `eraseEverything()` in `localStore.js`, which resets
  to **`EMPTY`, NOT `freshStore()`** — starting from the seed would put all eighty-five people
  straight back and read as if the erase had failed. No undo, so it asks twice: the backup, then
  the word `ERASE`. Saying no or typing anything else leaves everything untouched (tested).
- **It empties the BROWSER, not the FILE.** The seed is inlined as `__SEED__`, so the seeded
  build still carries every name and salary **in its source** — a different browser opening that
  same copy gets all 85 back. Confirmed by grep: the seeded file contains BHENSWALA, 24150 and
  the rest; the blank build contains none of them.
  **So the seeded file must never be forwarded to an employee or a tester.** Build with
  `seed.json` moved aside for that (`No seed.json - the file will start empty`).
- **`npm run build:standalone` wipes `dist-standalone/` first**, so a blank build made before a
  seeded one is deleted by it. Build blank, copy it somewhere else, then build seeded.
- **One storage key is shared by every `file://` copy in a browser.** I wrote that down and then
  handed him a blank file anyway: he opened it in the Edge that already held the payroll and saw
  all 85 people. The file was blank; the browser was not.
  **Fixed properly:** `BLANK_BUILD=1` gives the blank build its own key (`salary-app-blank-v1`)
  plus a `TEST COPY — starts empty` badge beside the build date. Both files can now sit in one
  browser, each with its own data, neither able to touch the other — driven in one context:
  real → 85 people, blank → empty, back to real → still 85.
  The key is tied to an **explicit flag, not to "seed.json is missing"**: deriving it from the
  seed would mean one rebuild with the seed mislaid silently moved the key and made his real
  work vanish.

## Sending payslips without deploying — `shared/payslipPage.js`

Asked to deploy, Dinesh instead answered: **"ABHI BINA DEPLY K BHEJ SAKU ESA BANAVO"** — he
wants to hand the month out NOW, with nothing on the internet. So deployment is **deferred by
his choice**, not blocked.

- **Send payslips** on the salary sheet's toolbar writes **one self-contained HTML file per
  person**, ~6 KB, which he forwards on WhatsApp. Opens on any phone with no login, no app and
  no network; prints to PDF. Named `Amit-Shah-October-2026.html`.
- **ONE FILE HOLDS ONE PERSON.** The single-file build holds every salary in the company, so
  forwarding *that* to an employee hands them the lot. The slip is built from one calculated
  row and never from the store. Tests: nobody else's name or figure appears, no company total,
  nothing loads from the internet (no src/href/http/img/fetch; the only inline handler is the
  print button), and a `<script>` in a name is escaped.
- It **assembles, never recalculates** — every figure came out of `calculateRow`, so the slip
  and the sheet cannot disagree. Sunday duty is stated beside the net, never added in.
- A free line the office types once rides onto every slip.
- **Test-fixture trap worth remembering:** `calculateRow` reads `row.salary`, not
  `monthly_salary` — a fixture using the master's name computed a net of −1,800 (gross 0, PF
  deducted) and three tests failed against perfectly good code.

**What is still only on the server:** staff logins, apply links and CVs, punch links, and every
file upload (photos, invoice PDFs, documents). The production path is verified end to end here
— fresh `npm ci --omit=dev`, first admin, every new module, restart with auth on, data intact
under one `DATA_DIR` holding `salary.db` + `asset-docs/` `asset-photos/` `documents/`
`resumes/` `backups/`. Railway config (`railway.json`, `backend/Dockerfile`, `.dockerignore`)
is correct and the build survives a missing `frontend/seed.json`. **No Docker daemon here, and
Railway needs either his clicks or an account token — ask before spending effort on it again.**

## Penalties — fines, losses and damage recovered from salary

Dinesh asked *"any penlaty loss ?"*, was told the Deduct column already does it and what it
does not remember, then: *"haan bana do penalty wala / salary me se decut hoga / and uska
reporting bhi / kyu kata he kis chiz ka kata he uska note dalne ka option bhi dena"*.
`shared/penalties.js`, `penalties` + `penalty_recoveries` in `backend/src/people.js`,
`frontend/src/components/people/Penalties.jsx`.

- **Recording one deducts NOTHING.** Recovery is a separate call naming the month, exactly like
  `payClaim` beside it — added to the row's existing `deduction`, never replacing it, and the
  same month cannot be taken from twice.
- **The note is REQUIRED and `validatePenalty` refuses without it.** That is the whole module:
  the Deduct box already deducted fine, it just could not say what for. The note rides onto
  `adjustment_note`, so it prints on the payslip.
- **`penalty_recoveries` is the ledger, the penalty row is the headline** — the same split as
  the asset register and its handovers, so the two cannot drift.
- **The Payment of Wages Act is REPORTED, never enforced.** `wageCheck` names the 50%-of-wages
  cap and the "more than a month" line in a preview shown before the button. It does not
  refuse: refusing would push the figure into the Deduct box, where nothing checks anything.
  There is a test asserting both warnings fire AND that the recovery still goes through.
- Six kinds; damage and loss must name the thing. Instalments over 1–24 months, the last one
  carrying the rounding. Told / accepted are separate nullable dates — blank is "not yet", not
  "refused". **Waived, not deleted**, once money has come out.
- Works offline too (records, not files), mirrored in `localStore.js` with the same rules.
- NOT a change to `calculateRow`: it writes the `deduction` column the sheet has always paid
  from, so no existing month can move.

## Attaching the asset invoice — it was there, nobody could find it

Dinesh: *"invoicec attch karne ka option nahi he"*. It had been working since `assetDocs.js`
was built. The only way in was clicking the asset's **code** in the register, which reads as a
code and not as a way in.

- `listAssets` now carries **`documents` and `photos` counts**, and the register has an
  **Invoice column**: `attach` when there is nothing, `📎 2` when there is, opening the asset's
  page scrolled to its paperwork. Offline both counts are 0, which is the honest answer.
- The drawer **reloads the register on close**, because attaching one changed the count and the
  row still read "attach" straight after an upload.
- In the single file the file picker is **not offered at all** any more — a sentence saying why
  beats a control that errors on every click.
- General lesson, third time now (hiring's "add vacancy", people, assets): **a feature reachable
  only from a link that does not look like one is a feature that does not exist.** Put the way
  in where the person is already looking.

## Hiring — HRMS module 5, inside `/salary-app/`

Dinesh shared `RECRUITMENT-WORKFLOW-SPEC.md` ("sme poora flow hai") and it was first built as
a separate `recruitment-app` for ZYNTA Placement Services. He then said: **"its not for
placement service / its with hrms / own company dashboard."** So it was moved into salary-app
as the fifth HRMS module, hiring for **his own companies**, and the standalone app was deleted
(the engine files were `git mv`'d, so the history is intact).

Three decisions he made before any of it was built, which still hold:
- **"Bilkul alag, khaali se shuru"** — starts empty, shares no database with the ZYNTA CRM,
  which keeps running alongside. (The CRM holds the lead/requirement/fee side and **84
  candidates**; this is the employment side.)
- **"Node + SQLite, salary-app jaisa"** — which it now literally is.
- **"Mera test system embed karo"** — his own test system in an iframe. **The URL WAS supplied
  and is built against**, contrary to an earlier note here: his test is on the ZYNTA site at
  `/skills-test`, reached as `https://test.zyntajobs.in/?embed=1` (the `embed=1` is what puts it
  in iframe mode, not decoration), and `https://crm.zyntajobs.in/test?t=office-admin` names
  WHICH test. Tests assert that appending the candidate's `ref`, `callback_token` and
  `seconds_per_question` never loses `embed=1` or `t=` — drop `t` and every candidate sits the
  default test, scores come back, and nothing says they answered the wrong questions.
  **What is actually missing is that no vacancy on the live server has a test link typed into
  it yet.** The office types it per opening (Hiring → Vacancies → Test link), because an
  accounts seat is not tested like a travel seat; `TEST_EMBED_URL` remains the app-wide
  fallback. Still unknown: whether his system can POST the score back to
  `/api/public/test-result/<callback_token>`.

### What changed when it became an HRMS module
- A vacancy belongs to a **`company_id`** that already exists here, and is refused without one.
  There is no client and no anonymity — BOOKNFLY is named on the advert, because a candidate
  who does not know who is hiring does not turn up. What stays inside is `internal_notes` and
  `reports_to`, with tests asserting neither reaches the advert, the share text or the
  candidate's own message.
- **The placement fee, GST and replacement window are gone entirely.** In their place:
  **`hireApplication`** turns the person who joined into an **employee row** on the opening's
  company, carrying phone/email/dob across, so they land on the salary sheet, the attendance
  grid and the PF/ESI registers without being typed twice. `applications.employee_id` links
  them.
- That handover is **a button, not a side effect of reaching "Joined"**, and it refuses
  without a monthly salary — a wrong number here is a wrong payslip at month end. Hiring the
  same person twice does not make a second employee. There are tests for all of this.
- `shared/hiringMessages.js` (was `messages.js`) names the company in every message. Selection
  says to bring PAN/Aadhaar/bank passbook, because payroll will need them.

### What carried over unchanged
- **`shared/match.js`** — weights skills 34, experience 24, location 18, salary 14, education
  10. Parsers read what people type: `1-3 yrs`, `3.6 LPA`, `fresher`, `₹10-18k/month`,
  `Bhayli, Vadodara`. A factor the vacancy does not ask for **cannot be failed**; one the
  candidate has not stated scores **half, not zero** — "not said" is not "no". Five parser bugs
  were found and fixed by tests: `norm()` stripped the hyphen so `1-3 yrs` gave a minimum of 3;
  same-city-different-area scored 50%; `10-18k` read the low end as ₹10; `3.6 LPA` returned 0
  because `l\b` does not match "lpa"; and `toSkills` did not split on `/` or the word "and",
  so "Tally / Busy and Excel" was one skill nobody had (it now splits on both, with word
  boundaries so Android and "demand planning" survive).
- **Nothing moves on its own.** The match score orders a queue and a test score is one more
  thing to weigh. There is no auto-advance and no auto-reject anywhere, and a test asserts a
  recorded test result leaves the stage alone.
- **The candidate pays nothing, ever.** Nothing public takes or asks for money.
- **Two unauthenticated surfaces, and only two:** `/api/public/*` (read a *published* opening,
  apply, attach a CV, post a test result) and `/files/resume/:id`. **The payroll side has no
  public door at all** — there is a test asserting `/api/employees` and `/api/periods` 401
  without a token. The public router 404s unknown paths rather than falling through to the
  authenticated `/api` catch-all, which answered "unauthorized" and sent people hunting for a
  password that was never the problem.
- **CVs on disk** under `DATA_DIR/resumes`, never in the database or a page or an export. The
  uploaded filename is discarded (user input, and this is a path). Read through a **signed link
  bound to that candidate id** so a signature cannot be replayed for somebody else's CV.
  Deleting a candidate deletes the file.
- **Applying is name + mobile only.** The mobile number is the identity (last 10 digits, unique
  index), so a second application tops up the same person; `upsertCandidate` never overwrites a
  filled field with a blank one. A newer CV is the one exception.
- Short-lived **purpose-scoped tokens** (`backend/src/tokens.js`) for attaching a CV later and
  for the test system posting back. A crude per-IP rate limit on apply and upload.
- Dragging a card produces the WhatsApp message in the corner. **No WhatsApp API, by design** —
  an employer auto-messaging strangers is how a number gets blocked.
- Tabs: Overview / Pipeline (board + list) / Openings / Candidates / Interviews / Follow-ups.
  The candidate sees `/apply/JOB-003` and `/jobs`, told apart by path — no router.
- **Hiring needs the server.** The single-file build says so plainly: an apply link and a CV
  cannot live in a file on a laptop.

### One person is one employee — the hiring audit (v1.75)

Auditing the hiring actions that MOVE people (not the ones that merely decide) found a real
defect on the payroll: **`hireApplication`'s guard was on the APPLICATION**, which catches
pressing the same button twice and nothing else. Somebody who applied for two seats and was
hired into the second after the first had gone through came out as **two employee rows** —
two codes, two salaries, two payslips, two PF records for one person.

- The guard is now on the **candidate** (`alreadyHired`): the second application is joined to
  the employee that already exists, still reaches Joined, still points at them.
- **A salary typed on the hiring screen is deliberately NOT written through** on that path.
  It changes on the employee record, where `employee_history` keeps it with the date — never
  as a side effect of a second application going through.
- **Somebody already on the staff list on the same mobile is named, and it ASKS** (409 carrying
  the row, `confirm: true` to go ahead) — the same shape as the maintenance duplicate check.
  Refusing would block a genuine rehire; going ahead quietly is two payslips. The eighty-five
  people already on the payroll never came through hiring, so only this catches them.
- **A deleted employee is not a record to join to**: deleting an employee leaves
  `applications.employee_id` dangling, so the guard reads the employee rather than the id.
- The scenario only exists if both applications are raised BEFORE the first is hired — hiring
  archives the candidate, so a second application cannot be raised afterwards.

### The last three reports (v1.76)

`shared/missingPunch.js`, `shared/deductionStatement.js`, `shared/salaryByDepartment.js`,
`MissingPunch.jsx`, `PayReports.jsx`. All three compute in the browser off the already-loaded
month, like `LeaveRegister` and `AttendanceReport`, so they work in the single-file build too.

- **Missing punch** — four kinds, and the distinction it exists for: **a day half-clocked and a
  day never clocked are different problems** (a record that is wrong vs. a job where nobody
  punches), so they are counted and named apart. Only a day somebody was AT WORK can be missing
  a punch — there is nothing to clock on leave or an absence, and listing those would bury the
  real ones. **Nothing in it is a deduction**: every day there is already paid.
- **Salary deductions** — every head, with **how many people each one touched**. Heads that took
  nothing are left out of the table and NAMED under it.
- **THE BUG ITS OWN BALANCE CHECK FOUND.** `gross_salary` is already **after** the Deduct box
  and the late charge (`gross = earned + OT + additions - deduction - late`), while PF/ESI/PT/
  loan/penalty come off after it to reach the net. Listing all seven against `gross_salary`
  took two of them twice. `earnedOf()` adds them back — exactly what `statutory.js` already did
  for the wage register — and then `earned - deductions === net` to the rupee.
  **The test that missed it was built on a hand-written fixture whose numbers happened to
  balance.** Rewritten to drive `calculateRow`, which is what the payslip is printed from.
- **Department-wise salary cost** — the third stale "cannot be built" note in a row
  (`listPayrollRows` has carried `e.department` all along). **Net paid and cost to company are
  different questions**, so both are shown; **Sunday pay is in neither**, because it is settled
  on its own register.
- Layout: ten columns ran off a 1280px laptop, so the department moved under the name, empty
  heads are dropped, and the table sits in a `ScrollFrame`.
- That claim was made too early: the **loan settlement report** was buildable too (v1.77,
  below). **Four stale "cannot be built" notes in a row now** — leave by department, salary cost
  by department, and loan closure. A note explaining why something is impossible outlives the
  thing that made it so, so re-read them rather than trusting them.

### Loans closed over a year (v1.77)

`shared/loanSettlement.js`, `LoanSettlement.jsx`, `GET /api/loans/settlement`, `allRepayments()`.

- The stale note was *"Closure is a status on the loan"* — half true. `loans.status` is
  active/held and never says closed, but **closure is already a fact the data holds**: a loan is
  finished when the repayments reach what was advanced, and the month it finished in is the
  month of the repayment that got it there.
- **CLOSURE IS DERIVED, NEVER STORED.** A `closed_on` column would be a second record of the
  same fact and would disagree the first time an instalment was edited — which the office is
  allowed to do, because somebody who cannot pay this month gets it set to zero. There is a test
  for exactly that: a zeroed month leaves the loan open and is not counted as an instalment paid.
- **A held loan is counted apart** — the debt stands, but none of it is coming back this month,
  and an outstanding total that quietly included it reads as money arriving when none is.
- **Months left is null with no instalment set**, never 1 and never 0. **Over-recovery is shown**,
  never clamped: it is money owed back.
- The year narrows what **closed**, never what is still running — a loan being recovered is
  outstanding whatever year it started in.

**Now genuinely all that can be built: the four left are PF ECR and the ESI export (both need a
file the portal has actually accepted — these templates drift and must not be written from
memory), the statutory challan summary and pending statutory payments (nothing records what has
actually been paid to the authorities).**

### Still to settle with Dinesh
The test system's embed URL and what it posts back; the office WhatsApp number for the digest;
and where this is hosted, so `PUBLIC_URL` can be set and the apply links actually work.

## The eSSL Basic Work Duration export — `shared/monthlyStatus.js`

Dinesh sent `BasicWorkDurationReport.xls` off his **eTimeTrackLite 12.0**: *"this is essl
punching report / earlier we are using bizcompass / usme essl se direct punching utha leta tha"*.

- Same machine and codes as the Monthly Status report, **printed the other way round**: a BLOCK
  of four rows per person (Status / InTime / OutTime / Total) instead of one row. The old reader
  returned **zero people from all four sheets without complaining**. `readSheet` now dispatches on
  "Status" in the first column with an "Emp. Code:" row above it — not on the file's name.
  Company, date range, codes and everything downstream are shared, so the two readers cannot
  drift on what WOP means. His file: 114 people across BNF/BNFV/Default/SCALE, 1–14 Nov, 1,596
  marks, every figure checked against the raw cells.
- **The grid reader needs ≥20 day columns; the block reader does not** — his export is a
  half-month (14 days), which is apparently how he exports.
- **Clock times ride onto `in_time`/`out_time`**, the columns the Time tab writes and the sheet
  pays short hours from. The machine's own **Total is deliberately ignored** — the app works the
  day out itself, and a second figure would mean nobody could say which the payslip used.
- **NOTHING INVENTS A DEPARTURE.** 105 days in his file have an in time, no out time, and a Total
  the machine worked to some cut-off of its own (13:12 in, total 9:48, implies 23:00 — nobody
  punched that). The out time is sent as `''`, **not omitted**, because `setAttendance` merges per
  field and omitting it would leave a stale out time paying hours nobody worked.
- **`thinDays()`** — `daysWithoutData` catches the clean case (nobody present at all). The nasty
  case is partial: his 10th and 11th read **22 and 23 present against ~75** every other working
  day. Writing it through books **183 absences nobody earned**. Measured as the share of people at
  work out of those who *could* have been, so a Sunday 99 people have off is not a collapse. The
  days are **NAMED with their figures and NOT skipped** — treating a quiet day as missing would be
  its own guess.
- Also names the **34 people absent on every day the machine has** (the never-enrolled, same as
  October).

### The bug this found: a full day's pay for two hours' work

`timesToDay` zeroes the shortfall under the half-day line — *"already paid at half, charging the
missing hours again would be double"*. **That rests on the day BEING a half day.** The import
names the mark itself (the device's own P), so a 13:21–16:19 day was paid in full with nothing
deducted — neither the machine's answer nor ours. In 14 days: **38 days the clock calls a half
day, 24 of them marked P, 149 hours uncharged.**

- Fixed: when the hours say half day and the mark says full day, **the shortfall is charged**.
  **Only for P** — A/UL/AD already dock a day, leave and holidays expect no hours, and SP/HP are
  paid by the day on the Sunday register, outside the salary this would come out of. Tests for all
  four; the A and SP cases fail if the condition is written too broadly.
- The rule is **`minutesForMark` in `shared/timesheet.js`**, called by `db.js`, `localStore.js`
  **and the import preview**, so the server, the offline file and the figure shown before the
  button cannot give three answers.
- The dry run now **says what it costs first**: 483h 09m short across 267 days, 144h 26m overtime
  across 136 days, with a line noting that somebody on an afternoon shift is judged against the
  month's full day and so reads as short.

### Direct from eSSL (what Bizcompass did) — not built, and what it needs

His screenshot shows eTimeTrackLite 12.0 on **DESKTOP-6OKJT47** with four devices on the LAN
(B&F / USB / out 192.168.1.9 / IN 192.168.1.7), **"Auto Clear After Download" ticked** — so the
devices are wiped after each pull and **the eTimeTrackLite database is the only durable store**.
That is almost certainly what Bizcompass read. eTimeTrackLite supports MS Access, SQL Server and
Oracle; **which one his install uses, and the punch table's name, are not known — do not guess
them, look.** Reading that database on a schedule is the route; repointing the devices at our own
ADMS endpoint would break eTimeTrackLite's own pull and is the wrong trade.
Still needed from him: which database engine it is, where the data file or connection string
is, and a read-only login.

**Answered on 22 Nov, by looking:** the BNF server's Windows computer name is **`SERVER`**,
NOT `DESKTOP-6OKJT47` — so that screenshot was taken on another machine, or it has been
renamed. But the eSSL material IS on the BNF server: `D:\essl`, `E:\Essl`, `E:\Essl\ESSL` and
`E:\Essl\OLD Bakcup\backup ESSL 30-12-2024`, with an eTimeTrackLite shortcut **and a
"Bizcompass Sync" icon** on its desktop — and Bizcompass is the very thing that used to pull
the punches, so its own settings hold the connection string this needs. **No MSSQL or Oracle
service is running on that machine**, and there is no `.bak` or `.mdf` anywhere — so the
engine is settled: **MS ACCESS**.

The live install is **`E:\Essl`** (the desktop shortcut points at `E:\Essl\eTimeTrackLite.exe`)
and the live database is **`E:\Essl\eTimeTrackLite1.mdb`**. Everything else matching is a dated
backup (`eTimeTrackLite_2024_10_19_1.mdb` … `_2026_06_29_1.mdb`, plus `E:\Essl\OLD Bakcup\`).
`D:\essl` holds its own copy and a `.ldb` lock file — an older install or a second copy, worth
telling apart before anything is read on a schedule. `E:\Essl\HR pc database\eTimeTrackLite1
in out device.mdb` is likely the HR PC's own copy, which is probably what DESKTOP-6OKJT47 was.
**No connection string exists to find, and none is needed** — an Access database is a file, so
the path is the whole of it.

**Access's OLEDB provider (`Microsoft.Jet.OLEDB.4.0`) is 32-bit only**, so anything reading it
from that machine runs under `C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe`, not
the 64-bit shell. And it must be opened with **`Mode=Read`** — eTimeTrackLite is live on the
same file, and locking it would stop the punches being collected at all.

**The table is `AttendanceLogs`, not `DeviceLogs`.** It holds one row per person per day with
`AttendanceDate`, `EmployeeId`, `InTime`, `OutTime`, `Duration`, `LateBy`, `EarlyBy`, `Status`,
`StatusCode`, `PunchRecords` and `OverTime` — which is exactly what the Basic Work Duration
report prints, so it feeds the existing importer with no new rules. `DeviceLogs` is empty; the
raw punches are archived into `DeviceLogs_<month>_<year>` tables, and those stop at January
2025.

**`E:\Essl\eTimeTrackLite1.mdb` IS NOT THE LIVE DATABASE.** Its newest `AttendanceLogs` row is
**30/04/2025**, and those rows are empty `A` marks with `1900-01-01` times. So the install on
the BNF server was abandoned around April 2025 and the real one is elsewhere — `D:\essl`, the
`HR pc database` copy, or the HR PC itself (the actual DESKTOP-6OKJT47). **Find the live file
by LastWriteTime, not by opening it**: a live Access database is written to constantly, and a
recent `.ldb` beside it means it is open right now.

**eTimeTrackLite's own parallel-database export is OFF** (`ParallelAttLogExportDetails`,
`IsParallelDatabaseDowload = 0`; the Oracle/XE/1521/Localhost values are an unconfigured
template with no database, table or path set). So that is not how Bizcompass was fed, and
polling remains the route.

**Built in v1.86.0** (`shared/esslDb.js`, `deploy/windows-local/ESSL-PULL.ps1`). The pull is a
PowerShell script on the machine that holds the database; it opens the `.mdb` **`Mode=Read`**
and writes a small JSON file, which the office imports on the **same route as the `.xls`**
(`POST /periods/:id/monthly-status`, branched by `asEsslPull`). `esslSheets` turns the rows
into the shape `readMonthlyStatus` already produces, so `daysWithoutData`, `thinDays` and
`monthlyStatusToMarks` run over it **unchanged** — the October lesson (912 absences nobody
earned) cannot be learnt twice and forgotten once. **Nothing reads Access from Node**: Jet's
provider is 32-bit, Windows-only, and has no business being a payroll dependency, so the
script re-launches itself under `SysWOW64` PowerShell. The JSON works in the **standalone
build too**, which cannot open the legacy `.xls` at all. Traps pinned by tests: Access writes
**1900-01-01 for "no punch"**, which must become a blank out time and never a guess; a time of
exactly **midnight is read as nothing**; a pull crossing the 1st comes out as **two sheets**,
because a sheet whose month is not the period's is dropped whole; `WOP` survives as `WOP` so
the mark map turns it into `SP` and the Sunday register pays it. A deploy test asserts the
script carries no INSERT/UPDATE/DELETE and writes only its own file.

**Jet SQL traps met while inspecting, worth remembering:** `last` is a reserved word, so
`MAX(x) AS last` fails with only *"reserved word or punctuation"* and names nothing — bracket
every identifier. And in Windows PowerShell 5.1, `Get-ChildItem -Depth` together with
`-Include` returns **nothing at all**, silently; use `-Filter`, or `-Recurse` without `-Depth`.

**Answered: eTimeTrackLite runs on the HR PC**, not the server (*"software hr ke pc me he"*).
So `ESSL-PULL.ps1` would run there, and the JSON it writes is uploaded from HR's own browser —
no share and no network plumbing needed. But see below: there is a better source on the server
itself, and the Access route is now the fallback rather than the plan.

## The Bizcompass punch spool — the connector that was already there (v1.87.0)

Dinesh: *"bizcompass ka connector he o kese kam kar raha he o chekc kiya?"* — **no, and the
earlier note was wrong twice over.** `ParallelAttLogExportDetails = 0` was read off the *stale*
April-2025 database, and it was the wrong question anyway: **Bizcompass does not read
eTimeTrackLite's database at all.**

He sent the tool's own folder. What it actually does: every ~10 minutes it pulls the punches
off the readers, writes the batch to a small tab-separated file under `logdata\`, uploads it to
Bizcompass's cloud (`configs/config.xml`: SubDomainName `booknfly`, Organization BOOKNFLY
PRIVATE LIMITED, AuthKey/HashKey — and `LastOrgStatusCheckedOn` was **that same day**, so it is
still running), then moves the file into `logdata\archive\`. A line is five fields:
`37 ⇥ 22-11-2026 15:24:39 ⇥ 255 ⇥ <device guid> ⇥ 0`.

**His folder: 16,263 files, 63,081 punches, 27 Jun → 22 Nov 2026 with no gap, two readers,
~66 people a day, and not one unreadable line.** It is on the **BNF server** — the same machine
the HRMS runs on — so there is no network hop at all.

**Why this beats reading Access**: no 32-bit Jet provider, no Windows-only dependency, **no lock
risk** (separate files; eTimeTrackLite's database is never touched), current to the last ten
minutes, and plain text. `shared/bizcompassLogs.js` + `backend/src/bizcompass.js` +
`BizcompassImport.jsx`, behind `BIZCOMPASS_DIR`.

- **It produces rows for the EXISTING `punchesToMarks`**, so a day off the spool, a day typed on
  the Time tab and a day from an Excel import are judged by one rule.
- **A day the tool was stopped on writes NOTHING.** `punchesToMarks` only emits entries for
  person-days it actually saw, so there is no way for this source to book the 912 absences a
  printed report can — the trap simply does not exist here. Said on the screen and in help.
- **`employees.device_code` ("Punch ID") is its own column, not a reuse of `code`** — Dinesh:
  *"essl ka employee code bhi hrms me dalna hota tha jisse name match kar sake"*. The spool has
  **no names in it at all**. `code` is what the office calls somebody on a payslip; this is what
  a machine in the corridor calls them. Blank falls back to `code`, so an office using one
  number for both types nothing; folding them into one column would mean renumbering a reader
  changed somebody's payslip. A number nobody carries is **named with its punch count** — that
  is somebody whose attendance is not arriving.
- **The folder belongs to another company's product** and is read, never written: a test asserts
  the files are byte-identical after an import. Its archive is also the only copy of punches
  already uploaded. **If Bizcompass is ever uninstalled this feed stops** — then the eSSL pull
  above is the fallback.
- **The filename carries the sync day** (`LogFile_11_22_...`), so a month reads ~2,900 files
  instead of 16,263. It is the SYNC time, not the punch time, so a day either side is kept and
  the real date still comes off every line.
- Direction is `0` and verify is `255` on every line in the whole folder, so there is nothing to
  read: earliest punch in, latest out — the rule every other import already uses.
- A part-written last line is **counted and dropped**, because the tool is writing to that
  folder while we read it.
- **Bug worth remembering:** the route took a form and nothing parsed one, so `dry_run` never
  arrived and a look would have written. `upload.none()` fixes it; the API test catches it.
- **Bug worth remembering:** adding `device_code` to `EMPLOYEE_FIELDS` without a default in
  `createEmployee` took 328 tests down with *"Missing named parameter"* — every field in that
  list must be given a value, even a null one.

### Why nothing matched, and the Punch ID import (v1.88.0)

Pointed at the real folder the panel read **10,614 punches, 2,916 files, 2 readers, 22 days**
— and **0 people matched, 81 numbers nobody carried.** Not a bug: the mapping did not exist.
His employee codes are **`BNF-EMP-0043`**; the reader says **`128`**. They were never going to
meet.

The mapping was already on paper: **eTimeTrackLite's own Basic Work Duration report carries
both** — its `Emp. Code` IS the reader number (1–192 in his file) with the name beside it. So
`shared/punchIdMatch.js` + `PunchIdImport.jsx` read that file with the **same `readMonthlyStatus`
the attendance import uses** (no second idea of what the file is) and propose the pairs.

- **THE TWO LISTS DO NOT AGREE, and that is the whole design.** On his real data: `3` is
  *AJEET UPADHYAY* on the machine and *AJEETKUMAR UPDHYAY* on the payroll; `47` is
  *ALIFIYA CHIKHALIWAL* against *ALIFAYA CHIKHALIWALA*; `65` is *Ajay Patnayk* against
  *AJAY PATNAYAK*. A fuzzy match that wrote itself through would put one person's attendance on
  another person's payslip, found months later by somebody querying their own pay. **So every
  pair is ticked by a person.** Exact arrives ticked; anything less arrives **unticked** with
  the percentage and what differs.
- `nameScore` works on WORDS, not characters, because that is how these differ: a middle name
  on one side, a surname a letter out, the order swapped. Scored over the shorter name's words
  × how close the lengths are, so a shared first name with a different surname lands at 0.50 —
  **below `MAYBE` (0.6), so it is not even proposed**, and the person is listed as "on the
  machine only" with the nearest name named.
- **Two numbers pointing at one person tick NEITHER.** Found on his real data immediately:
  *ALPESH SHUKLA* is enrolled twice (60 and 82), and one of those is somebody else. A number
  already on somebody else is refused **by name**, a different number already on the record is
  never silently replaced, and the apply route re-checks both — the screen may have been open
  while the list moved.
- It names **who is on the machine and not on the staff list** (103 of 114 in the sample) and
  **who is on the staff list with no number** — the second list is the one that matters, because
  those people's attendance simply will not arrive.
- Somebody who left, or a half-finished draft, is never offered a number.

### Reading it on a timer (v1.89.0)

Dinesh: *"daily auto log catch karenga na live?"*, then *"automatic wala bhi bana do"*.
`autoSyncOnce` / `startAutoSync` in `backend/src/bizcompass.js`, behind
**`BIZCOMPASS_AUTO_MINUTES`** (unset = off, floor 5 minutes because the Sync Tool itself only
writes every ten).

The button and the timer now share **one `runImport`**, because two code paths writing
attendance is how two sets of rules come to disagree. What the scheduled run must NOT do is
what the tests are about, since nobody is watching it:

- **It never opens a month.** A month that is not open is a decision somebody has not made;
  a timer has no business making it.
- **It never writes into a locked one.**
- **It never overrules a mark somebody set** (`protectDecided`, below).
- **It never throws** — every pass is wrapped and the failure is recorded as the last run.

`lastAutoRun()` rides on `/bizcompass/status` and the panel prints it with its figures,
including the punch IDs nobody carries: *"automatic" that silently stopped is worse than no
automatic at all.*

**And the Punch ID panel opened folded shut — eighth time for that exact shape.** Until those
numbers are filled in NOBODY'S attendance arrives, which makes it the most important thing on
the Employees page, not a fold. Open by default now.

**And a punch may not overrule a decision** (`protectDecided`). Leave, a holiday, a weekly off
worked, a day at home, a double absence: the clock times still land, the **mark stays**, and
the minutes go with the code because they were worked out as if the day were Present — a leave
day is not short of hours it was never due. Blank/P/A/HF stay settable, because the punch data
really is better evidence for those. Without it, somebody on CL who came in for ten minutes
would have had their leave turned into a present day and taken off the register with it.

`deploy/windows-local/ESSL-CHECK.ps1` answers all of it in one run and **writes nothing** —
there is a test asserting it calls no Set-Content/New-Item/*-Service/Register-ScheduledTask and
redirects nothing to a file, because it gets run on a server also carrying ZynTask, Arrohan, TAJ
and the eSSL software itself. It prints `COMPUTERNAME` first (the one question above), then
**finds** the install rather than guessing a path (the `E:\cloudfare` lesson), reads the
installed-programs registry as a second route that does not depend on a folder name, and reports
the engine from `.mdb`/`.accdb` files, connection strings in `*.config`/`*.ini`/`*.xml`, and any
local MSSQL/Oracle service. **Every password is replaced with `***` before printing** — the
output is screenshotted and sent over WhatsApp, and a connection string carries one. Tested.

## Our own punch collector — not depending on Bizcompass (v1.90.0)

Dinesh, after `booknfly.bizcompass.app` showed **"License Not Found"**: *"aap naya tool banavo /
bizcompass ke bharose mat raho"*. So the app now talks to the attendance readers itself.
`shared/zkProtocol.js`, `backend/src/zk/client.js`, `backend/src/devices.js`,
`backend/src/punchApply.js`, `frontend/src/components/PunchDevices.jsx`.

**THE WARNING THAT MATTERS ON HIS MACHINES, and it is on the panel, not just here:**
eTimeTrackLite has **"Auto Clear After Download" ticked**, so whichever software downloads
first **wipes the reader**. Two collectors with that tick on each get half the punches. It has
to come off before this is relied on.

- **`node-zklib` was rejected**, not overlooked: its own manifest depends on itself
  (`{ 'node-zklib': '^1.0.0' }`) and it was last published in 2022. Not acceptable as a
  dependency for a payroll app talking a binary protocol.
- **THE DESIGN IN TWO HALVES, because they are not equally safe.** A **pull** only ever ADDS
  punches to a store of our own: no attendance, no money, and **it never erases a reader**.
  Turning them into attendance is a second, separate call. That split is why the pull is safe
  to run on a timer — the automatic half cannot be wrong in a way that costs a day's pay.
- **No clear and no delete exists to be called.** There is no CLEAR_ATTLOG, no DELETE_USER and
  no 1004 anywhere in `zkProtocol.js`, and a test asserts it. A second test pins the whole
  command list the client may send (CONNECT/AUTH/DATA_WRRQ/EXIT and the four replies) rather
  than hunting forbidden words — `clearTimeout` contains one, which is how the first attempt
  failed. **It also never disables the reader**: some tools switch it off while they read, and
  a reader left dark by a half-failed pull is a morning of attendance typed from memory.
- **`device_punches` has a unique index on (code, time, device), and that IS the design.**
  Nothing erases a reader, so every pull brings back its entire log — the same punches, again,
  every ten minutes. The index is not an optimisation; it is the reason a pull can be repeated
  as often as we like. Proved end to end: second collect reads 17, adds 0.
- **`backend/src/punchApply.js` is the ONE path from punches to attendance**, now shared by the
  spool import, our own readers and the spreadsheet import. `runImport` was refactored onto it
  rather than copied. Two code paths writing attendance is how two sets of rules come to
  disagree — `protectDecided` and the no-sync period read live there now, once.
- **A date that cannot be right is not filed, and is counted.** Bytes read at a wrong offset
  still produce a date; three firmwares share these record sizes. Anything outside 2015–2100 is
  dropped, and when most of them are odd the reply says *"probably not 40-byte records"* rather
  than returning a short list in silence. `readAttendance` also hands back a 64-byte hex
  **sample**, so a strange reader can be read against its real output instead of guessed at.
- **An empty payload is NOT an error.** A reader with nothing new answers with no bytes, and
  calling that a fault puts a working device on a list of broken ones every quiet evening.
- **The scheduled pull (`DEVICE_PULL_MINUTES`, unset = off) collects even with no month open**,
  and says which month it was waiting for — "nothing happened" on a working reader reads as a
  fault. It reuses `monthForAuto` from `bizcompass.js`, so the guards are one implementation:
  never opens a month, never writes into a locked one, never overrules a mark, never throws.
- **Removing a reader keeps its punches** (`device_id` goes null). They are attendance already
  collected and some may already have been paid.
- **There is no real device here.** The fake loopback reader proves the *conversation* —
  handshake, comm key, both reply shapes, a device that stops mid-sentence, a port with nothing
  on it — but it speaks through the same module, so a byte-layout mistake would cancel out. The
  checksum and framing are pinned independently; the layout must be checked against HIS reader
  using the hex sample. **Said plainly on the screen and here.**
- Driven in a browser against a fake reader: added, tested, collected 17 punches from 3 IDs,
  dry run, wrote 8 marks, grid reads P on 17–20 with 36h 23m. Second collect added 0.
- Bugs worth remembering: `logger.js` exports an OBJECT (`log.info`), not a function —
  `log(...)` was a 500 on every pull; and `monthForAuto` returns `{ period, why }`, not a
  period, which read as *"period not found"* on a month that simply was not open.

### Pointed at his real reader (v1.90.1)

The very first Test against **192.168.1.7:4370 on the BNF server** came back
*"the device wants its communication key and none is set for it"* — which is the best
possible first answer: the server reached the reader, the reader understood our CONNECT
packet and replied `ACK_UNAUTH`. **Real-device confirmation that the framing is right**, which
the fake loopback could never give.

- **A key that was saved never reached the device.** `Reader`'s constructor read `commKey`;
  what every caller holds is the row out of `punch_devices`, whose column is **`comm_key`**. So
  the reader went on asking for a key however many times it was typed — which reads as "you
  typed it wrong", not as a bug here. Both names accepted, with a test.
- **There was no Edit button at all**, so a key could not be set on a reader already added.
  Found by driving the exact sequence he was in.
- **A successful Test now clears `last_error`** — a row still reporting a fault after somebody
  fixed it is the stale "4 still missing" bug again.
- **Placeholder text reads as a filled-in value.** He pressed Save on an untouched form and was
  told the reader needed a name while "IN gate" was apparently sitting in the box. Now `e.g.`,
  required boxes marked, and **the error moved inside the form** — it had been six inches above
  the box it was about, with a paragraph in between.
- **Bizcompass's own folder does NOT hold the device list or the comm key.** Checked:
  `configs/config.xml` carries only cloud credentials (SubDomainName, Organization, AuthKey,
  HashKey) plus `IsOrgSuspended=false`, last checked 22 Nov 16:05. So the Sync Tool **fetches
  its device configuration from the Bizcompass cloud at runtime** — which is another reason not
  to depend on it, and means the key must come from eTimeTrackLite or the device keypad.

### A Sunday that read 100% present (v1.91.0)

Dinesh, off the live dashboard: *"ye aaj sunday sab ka present kese dikha raha he"* — 86 of 86
Present on Sunday 22 Nov, and the trend at 100% **through the 28th**, days that had not happened.

- **Not a display fault: `P` was really stored.** The roll call only lists somebody as Present
  when the mark is P/WH/SP/HP; a blank day goes to *Not marked* and `S` to its own line. And
  `774h 00m` is exactly 86 × 9h, so clock times were written too.
- **The real defect was that a blank-fill ran to the end of the month.** A month then reads
  fully attended, and a genuine absence next Tuesday lands on a day already marked Present,
  where nobody looks again. **On the monthly-hours rule this is not cosmetic** — `HOURS_EXPECTED`
  is blank/P/WH, so a day marked P is a day that owes its nine hours, and a week marked ahead
  quietly raised everybody's target.
- `fillableDays` is now the one bound, derived from the existing `todayDay`; both
  `markEveryonePresent` and the per-row `fillRow` walk it. **A past month still fills whole**
  (`todayDay` is 0 there), because a closed month is written up after the fact. The confirm says
  what it is leaving alone, and a second press says "every day up to today already has a mark
  (8 still to come)" instead of claiming the month is finished. Pinned in `interface.test.js`.
- **What this does NOT explain, and was left alone:** his Sunday came out `P`, where the button
  writes `S`. Driven here, 1/8/15/22 all came out `S`. So on his data either the company's
  weekly-off policy does not carry Sunday (Leave → The day off), or those marks came from
  somewhere else. Not guessed at — put to him to check, since changing marks on a live month is
  his call.
- Worth knowing for the same reason: **S and P both pay a Sunday**, so nothing was overpaid; but
  only `SP` reaches the Sunday register, and under `monthly_late` a P Sunday adds nine hours to
  the target.

## Saying when the attendance stops arriving (v1.92.0)

Dinesh: *"abhi pura kam live log k upar depend he kyu ki usi se staff ki attendance aayegi and
usi attendance k hisab se salary gini jayegi"* — the whole payroll now hangs off
reader → punch → mark → salary, and **every link of that was silent when it broke**.
`shared/feedHealth.js`, `backend/src/feedStatus.js`, `GET /api/attendance-feed`, and the lines
at the TOP of the dashboard's Pending actions.

- **THE RULE IT IS BUILT ON: a feed that was never set up is not a feed that has broken.** One
  is a job nobody has done, the other was working this morning. Reporting both as a fault is how
  an alert gets ignored, and an ignored alert is worse than none because it is believed to be
  watching. No feed configured reads `info`, once, quietly.
- **A weekend of quiet is not a stopped feed** (`QUIET_DAYS_BEFORE_WORRY = 2`). One feed quiet
  while another still runs is a `warn` that says so; the last feed going quiet is `bad` and says
  nothing is reaching the grid.
- **The link that breaks most quietly is a missing Punch ID**, and that is the one his live
  system is on: the feed is perfectly healthy and reaches nobody. `reachable()` is the honest
  test — a blank `device_code` AND a `code` that is not purely numeric, because a reader sends a
  number and `BNF-EMP-0043` will never meet one. Reproduced exactly here: *"Nobody on the staff
  list has a punch ID, so no punch can reach anybody"*, plus the count of IDs belonging to nobody.
- `spoolLastWrite` reads the **newest file's mtime**, not the punches inside it: sixteen thousand
  files, and the question is only whether that tool is still running. Our own readers report the
  **newest punch held**, not when we last asked — a reader answering with nothing new is not
  attendance arriving.
- A clock running ahead of ours is **today, not the future**; an unknown last-seen is **null,
  never 0 days**.
- The dashboard load is **not gated on a tab**: a stopped feed is not a Reports problem, it is
  everybody's, and it belongs on the page the office opens.

### Three things found while he used the Add employee form

- **A REQUIRED STAR WAS PUSHING THE BOX ONTO ITS OWN LINE.** `.form-grid label` is
  `display: flex; flex-direction: column`, so `{f.label}` and the `<span class="ef-star">` were
  TWO flex items and stacked — the input landed 38px below every other box in the row, under the
  next column's label. Measured: labels all at 447, starred inputs at 508 against 470. On screen
  that reads as **the field being missing**, which is exactly what he reported twice in one
  message — *"date of joining me entry ka option nahi he"* and *"mobile num kese add karenge"*.
  Both were there, 38px down. One `<span className="ef-text">` around both, pinned by a test.
- **Punch ID was on no form at all.** It could only be set from the Punch ID import or by editing
  the row — never while adding somebody, which is when the office actually has the number in
  hand. Now first in *System access & attendance*, whose title already promised it.
- The Employee code hint still read *"change it only to match the machine"*, written before
  `device_code` existed. It now says *"what the payslip calls them"*.
- **Date of exit is deliberately NOT on this form.** `employees.left_on` exists, but an exit is a
  process — final settlement, leave encashment, gratuity, assets back — and it lives in
  **People → Exits** (`employee_exits` + `shared/settlement.js`). A date box on the joining form
  would let somebody mark a leaver with no settlement behind it.

### The Punch ID report (v1.93.0)

Dinesh, after filling 58 of them in off the machine's report: *"punch id report kahi dikhta
he?"* — and no. The number was a column on the Employees table and a list inside the import
panel that vanished with the file. There was nowhere to open on an ordinary Tuesday and ask
**whose attendance is not going to arrive**. `shared/punchIdReport.js`, `PunchIdReport.jsx`,
Reports → Punch IDs.

- **THE DISTINCTION IT EXISTS FOR: having a code is not being reachable.** `reachOf` returns
  one of three, never two — `own` (a Punch ID is typed), `fallback` (no Punch ID but the
  employee code IS a number, so the importer's fallback still matches), `none`. Somebody whose
  record says `BNF-EMP-0043` and nothing else looks complete on every screen and no punch will
  ever find them.
- A **typed** Punch ID is taken at its word, numeric or not — it is what the office says the
  machine calls them, and some readers do send a non-numeric id. The **fallback** is stricter,
  because nobody chose it.
- **The unreachable sort first**, because they are the point of the report.
- **Two people on one number is named**, and `normalId` means `060` and `60` are one
  enrolment. Every punch on it lands on whichever of them the importer meets first, so somebody
  is paid for somebody else's attendance — exactly the ALPESH SHUKLA 60/82 case from his own
  data.
- `unknownPunches` is **null when nothing has been collected**, never 0: "no punches have come
  in" and "every number is accounted for" are different answers.
- Computes in the browser off the staff list, like the leave register, so the single-file build
  gets it; only "which numbers belong to nobody" needs the server, and it says so.
- The catalogue test pins counts per category, so `punch-ids` was **declared in `beyondSpec`**
  rather than the count being bumped — the spec is still pinned, and anything past it is named.
- **The invented-class mistake, third time.** `.figs`/`.fig` had no rule in `styles.css`, so
  four figures ran into one sentence — exactly what `.late-figures` did in v1.82. It uses the
  established `.late-figs` (value in `<b>`, what it is in `<em>`), and there is now a test that
  reads every `className` matching `fig` out of those panels and requires a rule to exist.

## Where the HRMS actually runs — corrected

**It is on the BNF server**, the machine reached over AnyDesk, at `E:\BNFHR\BNFHRMS`,
port 3002, as the scheduled task `BNFHRMS`. **TSRV is the PC Dinesh works on**, not the
server. Every deploy document said TSRV until he corrected it: *"ye tsrv pc nahi he o bnf
server he / tsrv jo me kam kar rahahu o he"*. All of `deploy/` has been renamed.

- The Cloudflare account has **four tunnels — BNF, TALLY, WATASK, zynta-crm** — and they do
  not all run on the same machine. The hostname `bnfhrms.scalevisory.in` must go on the
  tunnel whose **connector runs on the BNF server**, because `localhost:3002` means that
  machine's port. By name `BNF` is the likely one; **check the Connectors section rather
  than assume**, which is what the earlier TSRV/WATASK assumption got wrong.
- **Do it in the Cloudflare dashboard, not by editing the config file.** The server is
  crowded (ARROHAN, TAJ, Essl/eTimeTrackLite, ePrompt, Infozeal, cloudfare, BNFHR) and a
  dashboard hostname touches nothing on it. `deploy/windows-local/GO-LIVE.ps1` can edit a
  file-managed config, but it reports everything and waits for the word `GO` first, keeps a
  dated backup, inserts before the catch-all and refuses a config with no catch-all.
- **The tunnel folder on that machine is `E:\cloudfare`** — no `l`. A list of correctly spelt
  guesses walked straight past it.
- `GO-LIVE.ps1` deliberately does **not** remove `APP_PASSWORD`: that shared key is the only
  way in until a real admin login is proved to work from the new address.

## The sign-in screen — `Login.jsx`, premium split screen

Dinesh sent a full brief: navy/gold aviation theme, split screen, Fly Beyond, four feature
highlights, show/hide password, Remember Me, Forgot Password, footer, responsive — and
**"CRITICAL: this is only a UI/UX redesign"**, do not touch auth, validation, roles, session
handling or endpoints. Inspected first; the three auth fetches are byte-for-byte the three
that were always there, and the backend suite went 915 → **920 passing** with nothing changed
under `backend/src`.

- **Its own class names (`.signin-*`), NOT `.login`.** `ChangePassword.jsx` renders
  `login` + `login-card`, and that screen stands between a reset password and the app.
  Restyling `.login` into a split screen would have silently rebuilt a screen nobody was
  looking at. There is a test pinning that the two stay apart.
- **All three modes survive** — first-admin `setup`, `signin`, and the `key` mode that signs
  in with `APP_PASSWORD` as a Bearer token. A test asserts the screen calls exactly
  `/api/auth/state`, `/setup`, `/login` and nothing else, so a future redesign cannot invent
  `/api/auth/forgot` against a backend that has no such door.
- **Remember Me remembers the USERNAME, not the session.** The session is one 14-day signed
  HttpOnly cookie, the same whether a box is ticked or not; there is no short session to
  extend. A tick claiming otherwise would be decoration over a thing that already happens. So
  it fills the username in next time and the line under it says exactly that, plus "your
  password is never stored". A test asserts there is exactly ONE `localStorage.setItem` in
  the file and that `form.password` is nowhere near it; the browser run checks nothing
  matching the password reached storage. Reads and writes are wrapped in try/catch — a
  private window throws on even touching localStorage, and a convenience must not take the
  sign-in screen down.
- **Forgot Password tells the truth.** There is no self-service reset in this app: an admin
  resets in Admin → Logins and `must_change` forces a change on first use. The link opens
  that sentence rather than an email box that goes nowhere. A test asserts no `type="email"`
  and no invented reset call.
- **Empty fields are named here, not sent to the server.** The server answers a wrong name
  and a wrong password with one deliberately vague sentence; that is right for a wrong
  password and useless for an empty box. `readable()` only capitalises and full-stops what
  the server said — one message stays one message, and a test pins that it is raised in one
  place and rendered in one place.
- **Drawn, not photographed.** The aviation background is inline SVG — a gradient, a gold
  curve and an aircraft. A background image off the internet would be a request this app
  makes to somewhere else every time the login screen opens, on a server behind a tunnel.
  No new dependency, nothing external, same as every other graphic here.
- **Measured in a real browser at three widths**, which is how three things were caught: the
  aeroplane sat on top of "FLY BEYOND", the gold curve ran through the feature wording, and
  the Remember Me row wrapped so "Forgot password?" fell onto its own line. Also dark mode,
  which came out near-black beside a navy panel and is now the same family.
- **The checkbox trap, again.** The global `input, select` rule gives every input a border, a
  background and padding, which on a checkbox replaces the native tick with an empty box —
  the same bug as the Settings panel. Explicitly handed back to the browser, measured at
  15px, and pinned by a test that reads the rule.
- `deploy/make-update.sh` now builds the screens-only update zip (`--server` adds
  `backend/src` + `shared`), with the same build → wipe → copy → **prove it is newer**
  sequence as `make-bundle.sh`. It existed only as an ad-hoc command before, which is how a
  bundle once shipped a dashboard eight days older than its source.
- **Not changed and worth knowing:** `GET /api/config` 401s while signed out, so the browser
  console shows one per load. That is pre-existing and not the login screen's doing.

## Working from home — asked for, not just markable

Dinesh: *"रिमोट वर्क अप्लाई कर सकते हैं।"* **Inspected first, and half of it already
existed:** `WH` (Work From Home) has been one of the thirteen attendance marks all along —
`absent: 0, paid: true` — wired through `calc.js`, the absent/present report, late/early, the
timesheet, the monthly pack and the dashboard's present count. What was missing is that
**nobody could ASK for it**: a remote day happened only if somebody in the office remembered
to type it.

- **A new request kind `remote`, and it `needs` NOTHING.** Every other kind asks the employee
  for something only they know; here the mark is always WH, and a picker would be a chance to
  choose the wrong one. `writes: 'WH'` sits on the KIND, and `entryFor` takes the mark from
  there — so a remote request arriving with `code: 'A'` on it, from a stale form or from
  somebody poking at the API, still marks the day WH and **cannot write an absence**. Tested.
- It **spans**, like leave: a week at home is one request and one decision. The old rule still
  holds unchanged — *a request never writes attendance; an approval does* — with an API test
  that the net is untouched while it is pending.
- **The claim the whole thing rests on: a day worked from home is a day worked.** There is a
  calc test over six salaries and a month carrying real absences asserting gross, net, PT, PF,
  ESI, absent days and final payable all come out identical with `WH` and with `P`; and an
  end-to-end API test where two approved remote days leave ₹25,800 at ₹25,800.
- **The GPS fence was the real bug.** On a WH day a punch from home read as `punched away from
  the office` — so every approved remote day would land on the list of things to check, which
  is how a list of things to check stops being read. Worse, with `PUNCH_ALLOW_OUTSIDE=false`
  the punch was **refused**, making an approved remote day unpunchable: the hours would be
  typed from memory a week later, which is the thing punching exists to stop.
  `punchesToDay(punches, { code })` and `punchAllowed(judgement, restrictions, { code })` now
  take the day's mark, and `recordPunch` works the day out BEFORE judging the punch so it can
  look it up. `REMOTE_MARKS` is `{WH}` only — **an absence is not remote work**, and leave is
  not either; tests pin that A and CL are still refused, that the mark does not switch punching
  on, and that it does not excuse a punch with no location.
- **Nobody is asked about the uniform of somebody at home.** `WORKED_MARKS` drives the roll
  call's uniform fold **and is its denominator** ("3 of 40 at work not looked at"), so leaving
  WH in would hold the morning's walk open for ever on a name nobody could ever tick. A first
  attempt added a second set and kept WH in the denominator — exactly that bug — and was
  rewritten rather than patched. WH still counts as a day present, which is a different
  question.
- Raised from **both** staff surfaces: the punch link's form picks it up automatically (it maps
  over `REQUEST_KINDS` and renders by `needs`), and MyPage's Leave tab gained it beside the
  leave codes, with the hint and the footnote following the kind — *"Working from home is paid
  in full and uses no leave"*, not "a leave application".
- **Driven end to end in a real browser** at phone width: staff sign-in, the forced password
  change, Leave tab, apply for the 26th–27th, net unchanged while pending, office approves,
  grid reads WH/WH, net still unchanged.
- An existing test enumerating the allowed `needs` values caught `'none'` on the first run —
  the list is a deliberate contract. It now also asserts that a kind asking for nothing must
  name the mark it writes, or approving it would land a reason on the grid with no mark, which
  reads as a day somebody looked at and left blank.

## Leave: how an employee asks and how the office decides

Dinesh asked what the system actually is. **Inspected rather than described**, and the flow was
already whole — one queue, one rule, no parallel paths. Two things were wrong at the edges, and
both were the same old pattern: the work was done, the way IN was not.

The flow, end to end: the employee applies from their own login (MyPage → Leave) or their punch
link; it lands in `attendance_requests` as `pending`; the office sees it in **Reports →
Attendance corrections and approvals**; approving writes every day in one transaction. *A request
never writes attendance; an approval does* — a pending application moves nobody's pay, and there
is an API test for it. Approving needs the `write` ability (`/api/attendance` is mounted behind
`requireAuth, requireRead, requireWriteForChanges`), so HR and Admin can decide and an `employee`
login — abilities `['self']` — cannot.

- **The one line telling the office somebody applied opened the wrong tab.** The dashboard's
  *Waiting on somebody* card carries "2 attendance requests waiting: Amit Shah, Priya Nair" off
  `shared/digest.js` — but every digest line sent `onGo('people')`, and the approvals queue is
  in Reports. Right for a claim, a ticket or a job; a dead end for a leave application. Lines now
  carry `go` and `focus`, the attendance one points at `reports`/`approvals`, and `Reports.jsx`
  learned that focus (it has to sit after `openId` exists, not beside the `import` effect).
- **And those lines were plain `<li>`s** — the card whose entire job is "somebody is waiting on
  you" could not be clicked at all. They are `pa-row` buttons now, and the card's "open People"
  header button is gone, because most of what it lists is not in People.
- **The Approve button was off the edge of the screen.** Measured at 1280px — an ordinary laptop
  — the queue's last column sat at 1393px, so the one control the whole screen exists for needed
  a sideways scroll to reach. `table.sheet.request-queue td.decide` is pinned right, the way the
  name column is pinned left: 1393px → 1156px, checked at 1280 / 1400 / 1920.
- **Driven end to end in a browser**: two applications raised from staff links (a 3-day CL and a
  work-from-home day), the dashboard line clicked, Reports opens on the queue with both visible,
  Approve pressed, grid reads CL CL CL on 18–20.

## A manager approving their own team — `shared/team.js`, `/api/me/team/*`

Dinesh: *"Leave apply and aproval from employee login ?"* **Applying already worked from the
staff login. Approving did not** — the `employee` role carries abilities `['self']` and no
`read`, so no office router answers it, and the queue is HR-only in Reports. So the missing
half is the person who actually knows whether somebody can be spared deciding it themselves,
instead of forwarding it to the office to type in.

- **`reports_to_id` is the line**, which already existed with `wouldLoop` protection and a bulk
  department-manager setter. **DIRECT reports only** — approving your report's report's leave
  steps over the person whose job it is to know, and on a chart four deep it quietly makes the
  top manager the approver for the whole company. There is a test for exactly that shape.
- **Three routes under `/api/me/team/*`, and the manager id comes off the LOGIN**, never a URL
  or a body — the rule every `/api/me` route already follows. The reports are worked out on the
  server from that id, so nothing a caller sends can widen the set.
- **No new ability.** The staff role still has no `read`; a manager gains their own team's names
  and their own team's requests, nothing else. `TEAM_FIELDS` is the whole of what travels — id,
  name, code, designation, department. An API test asserts Riya's 48,000, `monthly_salary`,
  `pan`, `bank_account` and `ifsc` are **nowhere** in what her manager is sent, and the browser
  run checks no salary is on the page.
- **Nobody approves their own time off**, checked *before* the team list so a corrupt row that
  put somebody in their own team could never be the way in. `directReports` also refuses a
  self-reference outright.
- **It goes through the SAME `decideRequest` the office uses**, so "an approval writes
  attendance", "nothing is decided twice" and "nothing is written into a locked month" hold here
  without being restated — two code paths writing attendance is how two sets of rules come to
  disagree. `decided_by` is the manager's own name, not "office".
- **HR still sees and can decide everything**, manager or no manager; the queue is one list, not
  two. A request nobody acts on simply stays pending — there is no timeout and no auto-escalation.
- The tab appears only for somebody who actually manages people (`GET /api/me` returns
  `manages`, a **count** — a page deciding whether to show a tab has no business being handed
  everybody's name). An empty "My team" on 115 logins is noise on all of them.
- **Driven in a browser at phone width**: Alpesh signs in, gets the tab, sees Amit's 3-day CL and
  Priya's work-from-home and *not* Kiran (who reports to nobody), no salary anywhere on screen,
  approves, and the grid reads CL CL CL on 18–20 with `decided_by` = Alpesh Shah.
### Two steps: the manager backs it, the office confirms it

Dinesh then answered the open question himself: *"manager approve kare phir hr confirm kare, wo
bana do"*. So a manager's approval is now a **recommendation**, and only the office's
confirmation reaches the grid.

- **A fifth status, `recommended`**, between pending and approved. The old rule becomes **"a
  request never writes attendance; the FINAL approval does"** — `decideRequest` returns from the
  manager branch **before any `setAttendance`**, so there is one place attendance is written and
  the manager path does not reach it. The browser run confirms the grid is still blank between
  the two steps.
- **A manager's REJECT ends it.** The asymmetry is deliberate and stated: a refusal costs
  nothing either way, and a no that needs confirming is a no the employee hears twice. It is the
  approval that moves money.
- **HR is never blocked by the middle step** — they can finish a `pending` request outright,
  which is what happens for somebody with no manager at all. Otherwise Kiran's leave would wait
  for a recommendation that could never come. There is a test for exactly that person.
- **A manager recommends once.** Sending it round again is refused (400, not 403 — it IS their
  team's request, it has simply moved on), because overwriting their own recommendation while
  the office was looking at it would leave the trail unable to say what HR was asked to confirm.
- **`recommended_by` / `recommended_at` are their own columns**, not a reuse of
  `decided_by`/`decided_at`: a two-step request has two people and two times on it, and one pair
  could only ever hold the second — the half that answers "who said this was fine" worst. The
  office row reads *"backed by Alpesh Shah"* above *"by Dinesh"*, and the decision note carries
  `recommended by Alpesh Shah`.
- **Three piles on the manager's page, not two** — waiting on you / with the office / decided.
  Lumping the middle one into the first asks them to decide the same thing twice; lumping it
  into the last tells them it is done when it is not. `GET /api/me/team` returns `waiting` and
  `sent_on` separately for the same reason.
- **Everything that assumed `pending` meant "open" was found and fixed**: the office queue's
  count and its Approve/Reject buttons, the dashboard digest line, and `withdrawRequest`.
  `isOpen()` is now the one answer to that question.
- **An employee can take back a request their manager has already backed**, but not one the
  office has approved — by then the day is on the grid. This also closed a real gap: withdraw
  existed only on the punch link, so somebody with a staff *login* had to ring the office to
  un-ask. `DELETE /api/me/requests/:id` now exists, with the id checked against the login.
- The one test asserting the old one-step behaviour **failed on the first run and was rewritten
  to state the new rule**, not patched.

## A version, a history, and help inside the app

Dinesh: *"version no and history bhi do jisse pata chale ki kya naya aaya he"* and *"ek
software k andar hi help ka option bana do jisme search karne pe kisi bhi topic ki guidance
mil jaye"*. `shared/version.js`, `shared/help.js`, `frontend/src/components/Help.jsx`.

- **Two different questions, so both are shown.** `v1.6.0 · 14 Nov 2026, 04:02 pm` in the rail:
  the **version** says which release this is, the **build stamp** says which COPY of it you are
  holding — and that second one is the figure that settles "the update did not take". The
  version is written by hand, because "small fix or new module" is a judgement a build script
  cannot make.
- **The history is written from the real commit log**, in the office's language — what somebody
  can now do that they could not. Seven releases back to 1.0. Anything that moved money says so
  (*"this was costing real money — 149 hours in one fortnight"*).
- A dot on the rail marks anything unread; `since('')` and `since('9.9.9')` return **the lot**,
  because never having looked is not the same as having seen everything — the opposite would
  hide the history from exactly the person it is for. Tested.
- **40 help topics, searchable**, each naming its tab with an "Open it →" that goes there.
  Ranking is title > keyword > body, and **every word of the query has to land**, so "sunday
  excel" narrows instead of widening. An empty box is a contents page, not an empty screen.
- **Keywords carry the Hinglish somebody would actually type** — `chutti`, `pagar`, `hajri`,
  `ghante`, `saman`, `foto`. There is a test for each, because searching "chutti" and getting
  nothing is the fastest way to decide a help screen is useless.
- **Each topic names the trap**, in its own marked block: a pending request pays nobody, "not
  checked" is not "missing", the machine's blank day is not an absence, the concession and the
  short-hours rule are alternatives so the same minutes are never charged twice, ONE FILE HOLDS
  ONE PERSON. A test asserts those specific notes still exist — they are the valuable half, and
  each cost a real bug to learn.
- Both are **overlays, not tabs**: the moment somebody needs help is the moment they are halfway
  through something. Escape closes. Neither reads anything from the server, so the single file
  carries the same help.
- Staff get the same panel **narrowed to the eight topics that apply to them** — their page has
  no salary sheet, no imports and no asset register, and offering those would send somebody
  looking for a tab that is not there.
- **Two real inaccuracies in the help were caught by its own test**, before Dinesh could be:
  a topic pointed at a `sunday` tab that does not exist (the register is a fold on Attendance),
  and two titles were too short to be found by anything but themselves. The test reads the tab
  list out of `App.jsx`, so help cannot drift from the app.
- **The layout trap, third time:** the panel header is a `<header>`, and a global rule stacks
  those into a column — so the close button landed on its own line and the header stood 111px
  tall instead of 62. `flex-direction: row` is explicit and pinned by a test. Same family as the
  checkbox a global `input` rule collapsed to 0px.
- **And a process note:** the first browser run showed the OLD help, because `shared/` was edited
  after the last `npm run build`. The stale build reproduced the exact bug the test had just
  caught — "Open it" landed on no tab at all. Rebuild before driving.

## The candidate list — a row that opens, and a CV that does not leak

Dinesh: *"click karne se candidate ki proper details with attached resume aana chahiye / list ka
view bhi proper banavo"*. **The detail panel already had everything** — CV behind an expiring
signed link, every field editable on blur, applications, test scores. What was wrong was both
ends of getting to it.

- **The whole row opens the candidate now.** The name was a bare `<button>`, which renders as
  plain bold text, so the one way into everything about somebody did not look like a way in.
  **Fifth time for that exact shape** (hiring's "add vacancy", People, assets, the asset
  invoice, this). Pointer cursor, hover, and the name in the brand colour — measured.
- **The CV column was the word "yes".** It is a `download` button now. Clicking it does not also
  open the row (`stopPropagation`).
- **`resume_path` stopped travelling.** `listCandidates` was `SELECT c.*`, so the browser got the
  server's own filename for every CV on the list; the applications join carried it too. Now
  `forOffice()` strips it at every candidate response and the lists send **`has_cv`** instead —
  the same rule employee documents already follow. Two tests assert it is nowhere in either
  payload, and the two older tests that reached through the API for the path were rewritten to
  check the disk, which is where that fact actually lives.
- **The list says something now:** contact (phone + email), experience, place (and where they
  will work if different), expected salary, skills, **where they are** (latest stage, or "on the
  list only"), CV and when they were added.
- **Three attempts at the download, and the first two are worth remembering.** (1) `window.open`
  after an `await` is no longer inside the click, so the browser treats it as a pop-up and
  blocks it **silently** — the button looked dead and said nothing. (2) Opening the tab inside
  the click fixed that, and then it sat on `about:blank`, because the route returns a
  **relative** URL and a relative URL cannot resolve against `about:blank`. (3) `/files/resume/
  :id` is served with `res.download` anyway, so there is nothing to show in a tab — an anchor
  with `download` and an absolute href, no tab at all. Each step was found by driving it.
- A test asserting the old wording failed the moment the label changed, and **matched its own
  explanatory comment** when first written — the same trap as `readable()`. Comments are
  stripped before the negative assertion.

## The employee master, onboarding, the leave ledger and printing (v1.68–v1.71)

Four releases in one night, from briefs Dinesh sent while using the app.

- **The joining form** (`shared/employeeMaster.js`, `EmployeeForm.jsx`) — eight sections behind
  tabs, replacing six boxes. **The shape is DATA, not JSX**: the form, the validation and the
  completeness figure all read one list, because fields in markup cannot answer "what is still
  missing". The employee code is suggested from the company's series and **never reserved** (two
  people with the form open must not burn two numbers); a typed code is left alone, because the
  punch machine knows those. Duplicates are reported as they are typed with the reason in words
  and **warn rather than refuse** — only an exact employee code is refused. **Only a name and a
  company are refused on save**: the staff spreadsheet import, the hiring handover and the bulk
  add all reach `createEmployee`, which wants no more, and a rule on one door of several is a
  surprise. A **draft** is kept off every payroll (`syncPayrollRows` skips `is_draft`).
  New columns: `employment_type`, `hod_id` (the HOD is not always the reporting manager),
  `work_location`, `nationality`, present/permanent address in parts, emergency alt/address.
  **The old free-text `address` is kept and still read** — rewriting 86 typed addresses into
  guessed lines cannot be undone.
  **PAN, Aadhaar and the bank account are masked on the record** with a show button, and showing
  one writes an audit line. Said plainly: the value already travelled, because the PF return and
  the staff export need it. It is not encryption.
  **Mistake worth remembering: `shared/employeeCode.js` already existed** (hiring uses it) and I
  wrote over it. Restored from git; the new route calls that same generator.
- **Onboarding** (`shared/onboardingFlow.js`, `backend/src/onboarding.js`, `JoinPage.jsx`,
  `Onboarding.jsx`) — the office invites, the person fills in their own record from a link, the
  office approves. **An invitation is not an employee**: `approve` is the only call that writes
  to `employees`. `masterFieldsFrom` is a **whitelist** because this is data typed outside the
  office — there is a test sending `monthly_salary: 999999` and `active: 0` in the draft and
  asserting neither lands. The link is a purpose-scoped signed token (`/join/<token>`), the
  invitation id read from the TOKEN not the URL, same as the punch link and with the same stated
  limit. A submitted form cannot change under the office; a correction goes back with required
  remarks. One mobile number is one person. **Nothing is sent** — the link is handed over.
  Document upload during onboarding was added in v1.72 (the papers come across at approval,
  **unchecked**, because approving a form is not the same as having read the Aadhaar card).
- **The leave ledger** (`shared/leaveLedger.js`, `LeaveLedger.jsx`, `/api/leave/ledger/:id`,
  `/api/leave/balances`) — Dinesh called it the most important thing in the leave brief.
  **Debits are DERIVED from the attendance marks, every time, never stored**: the marks are what
  the sheet pays from, and a second record of days taken is how two answers come to exist.
  **Credits are stored** (`leave_credits`): opening, monthly, carried forward, adjustment
  (reason required), encashed, lapsed. **With nothing posted the ledger reads exactly what the
  app always showed** — quota minus taken — and says the figure was not posted by anybody; there
  is an API test that the old register and the ledger agree to the day.
  **The trap: posting ends the assumption that the yearly entitlement applies**, so a 4-day
  opening balance alone drops somebody 6 → 3. Found by driving it; the panel now offers
  "Start the ledger with their 7-day entitlement" first. A negative balance is shown, never
  clamped. The calendar, encashment, carry-forward and the leave reports followed in v1.73.
- **Printing on every report** (`shared/csvTable.js`, `frontend/src/printCsv.js`) — half the
  reports were a Download and nothing else. The file is fetched and laid out through the same
  `printReport` the muster roll uses, with the month, the filters and a total under every column
  that is really figures (a code, a UAN, a PIN and a phone are digits and mean nothing added up).
  **19 reports print; checked one by one in a browser.** `.xlsx` cannot be laid out, so the
  salary register prints from the month's flat CSV. **`printReport` takes totals as an OBJECT
  KEYED BY COLUMN HEAD** — handed an array it prints a row saying "Total" and nothing else;
  caught by rendering to PDF and reading it back.
- **The noticeboard** (`shared/announcements.js`) — People → Noticeboard, read by the staff
  portal's new **Notices & jobs** page and its dashboard card. Nothing is sent. A notice with a
  future start date stays off the board until its day.
- **Openings on the staff portal** — `/api/me/openings` sends `publicVacancy`, the same narrowing
  the advert uses, so internal notes do not travel and an unpublished opening is not sent.
  "Copy the message" hands over the same advert the office posts.
- **The employee portal** also gained **My record** (appreciations, warnings, penalties — the
  rule is *the portal shows what was issued to them*, so the office's own plain jottings stay
  out, and a penalty appears once told or once money has come out) and **hours on My
  attendance** (in/out/worked per day, built by `attendanceStatement`, the same module the
  office's statement uses; "no out time" rather than a guessed departure).

## The rest of leave — calendar, year end, encashment, two reports (v1.73)

`shared/leaveCalendar.js`, `shared/leaveYearEnd.js`, `shared/leaveReports.js`,
`LeaveCalendar.jsx`, `LeaveYearEnd.jsx`, `LeaveReports.jsx`, routes under `/api/leave/*`.

- **The calendar** draws approved leave and a still-waiting application **apart**, and counts
  them apart. A pending day is not a day off yet; showing them alike books out people nobody
  granted anything to. Approved comes off the marks, pending off the request queue.
- **The year end** carries what is left into the new year up to a cap, or lapses it. Preview,
  then post; running it twice is refused. **Two entries per carried line** — out of the old
  year, into the new — so each year stands on its own. Somebody who took more than they had is
  **named and left alone**: that is a decision, not a sum.
  **UNPAID LEAVE IS NOT A BALANCE** (`balance: false` in `DEFAULT_RULES`) and never appears —
  without it the page listed everybody who ever took an unpaid day as owing leave.
- **Encashment** takes the days off the ledger and **pays nobody**; the money reaches a payslip
  only as an addition typed on the month's sheet. Same split as a penalty and its recovery, and
  the screen says so — a screen that took the days and went quiet would read as having paid.
- **THE BUG THIS FOUND, by driving it.** Until something is posted, a ledger's balance is an
  **assumption** — the entitlement on the record less what the grid shows as taken — and the
  **first entry ends it**. Encashing 3 of somebody's 7 days left them on **MINUS 3**, a debt
  they did not owe. The year end had the same hole. Now `entitlementOf()` is written down
  first: automatically inside `entriesFor` at a year end, and before an encashment the panel
  refuses and names the button that does it. `refuseOverdraw` is **one guard on the routes**
  (not inside `addLeaveCredit`, because the year end posts exactly the closing balance and must
  stay able to), so the plain credits form can no longer walk past the check — it used to.
- **An encashment's year is its `on_date`**: there is no year column. Checked against 2027 and
  dated today, the days came off 2026. The date is now forced into the year that was checked.
- **Reports → Department-wise leave summary** — was `planned` on a note ("nothing joins the
  two") that had stopped being true: `listPayrollRows` carries `e.department`. It assembles
  `leaveLine` rows rather than counting marks again, so it cannot disagree with the register,
  and **everybody is in the headcount** — four days across three people and four across forty
  are different months.
- **Reports → Leave application status** says **whose move it is and for how long**: with the
  **manager** while pending where somebody has one, with the **office** once backed or where
  nobody manages them. **Ageing runs from the last thing that happened**, not from the day it
  was raised — a request backed yesterday has been with the office for one day, and reporting
  the whole wait sends somebody chasing the wrong person. A decided one keeps its line and
  stops ageing.
- The catalogue test pinning the spec's counts was **rewritten, not patched**: the spec is
  still pinned per category, with anything beyond it named one by one (`beyondSpec`).
### Cancelling an approved leave (v1.74)

His brief: *"Never permanently delete approved leave transactions."* `canCancel` in
`shared/attendanceRequests.js`, `cancelRequest`/`askToCancel` in `backend/src/attendanceSelf.js`.

- **It CLEARS the days; it does not decide what happened instead.** They may have come in,
  been absent, or taken something else — writing `P` pays for a day nobody said was worked and
  writing `A` docks one. The day goes back to **unmarked**, carrying the reason, and whoever
  cancelled it marks what really happened. The confirmation says so, because anybody pressing
  it will assume otherwise.
- **The row is kept**: dates, who approved it, who called it off and why. Deleting it would
  leave the attendance changed with nothing behind it. A reason is **required**.
- Only an **approved** one (anything still waiting has written nothing — that is a withdrawal);
  never twice; **never into a locked month**, because that leave has been paid.
- Only the fields the approval wrote are cleared, the same per-field merge rule as everywhere.
  `approved` goes back to **null** — an approval that has been undone is not an approval.
- **The employee ASKS, the office decides** (`cancel_requested_at`), the same one rule: a
  request never writes attendance, a decision does. The queue shows *asks to cancel*.

- **Still not built from the leave brief, both on purpose:** a configurable leave **type**
  master — the types come off `ATTENDANCE_CODES`, which is what the grid marks and the sheet
  pays from, and a second list of types is exactly how two answers come to exist; and a
  configurable approval **hierarchy** — it is `reports_to_id`, one step, plus HR, and a chain
  four deep quietly makes the top manager everybody's approver.

## The leave bonus (v1.78) — `shared/leaveBonus.js`, `LeaveBonus.jsx`, Leave → Bonus

Dinesh: *"Leave bonus add karo"*, then, asked which of three readings he meant, *"Leave me ek
alag tab rakho"* — so: its own sub-tab under Leave, for the leave-linked reading (a bonus for
a month somebody took no time off in). Unused-leave money is encashment, which already exists,
and the panel points at it rather than growing a half-duplicate.

- Two shapes: **all or nothing**, and **less a cut per day** (never below zero — nobody is
  billed for taking leave, the bonus simply stops).
- **Which marks cost it is ticked by the office.** A/UL/HF/AD/CL/SL/PL by default, because
  paid leave is still a day away; S, H and WH never cost it. A half day costs half a day and
  AD costs two — **the same way the sheet docks them**, so the bonus forms no second opinion
  about a mark.
- **NOTHING MARKED IS NOT A CLEAN MONTH.** Somebody with no marks at all is never eligible,
  is named apart and has its own count. Without it, one unfilled grid pays the whole staff —
  the same rule the biometric import follows for a day the machine has no record of.
- **Working it out pays nobody.** `payBonus` is the one call that moves money and it names the
  month: the amount is **added** to the row's existing `addition` (never replacing it) with a
  note that prints on the payslip. `bonus_payments` is the ledger with a **unique index on
  (period, employee, kind)** — that is what stops a second click paying twice, and it is
  checked per person so the API cannot be used to go round the screen.
- It pays **the lines it was shown**, not a second run of the rule that could have moved under
  the office while they were reading it.
- **Taking one back removes only that amount**, so another addition on the same row survives.
  A locked month is refused.
- **The rule is on the server** (`settings` table, new), deliberately not localStorage: a rule
  that decides money must not live in one person's browser. Editing on screen only re-prices
  until Save.
- **A test caught a real hole:** unticking every mark left an empty break list, which meant
  nothing disqualified anybody and the whole staff qualified every month. `normaliseRule` now
  falls back to the default list, and the panel refuses to untick the last one.

### The leave register read all zeros (v1.79)

Dinesh sent a screenshot of the live Balances page: *"leave page still not proper"* — 79 people,
every Due, Taken and Left column nil. **Reproduced exactly before touching anything** (79
employees, no quotas, one person with 2 CL marked), which is how four separate things were
found rather than guessed at.

- **Nobody had been given an entitlement**, and the page said nothing about it. 237 zeros read
  as lost data. It now says so in a line, says the days TAKEN *are* right (they come off the
  grid), and puts the fix on the same screen — the roll call's answer for a month nobody marked.
- **Setting 79 people by hand is 237 boxes**, which is exactly why nothing was ever set. One
  button sets CL/SL/PL for everybody on screen, honours the company filter, and **refuses to
  flatten a quota somebody already adjusted** — it says how many have one and offers to fill in
  only the blanks. One reload at the end, not one per person; there is a test reading the loop
  body out on its own to pin that.
- **"Over their entitlement" was measured against nil**, so anybody who took one day was
  flagged. That is not an offence, it is an unset quota, and a register that flags the whole
  staff gets ignored. `over()` now ignores a type with no quota.
- **Measured, not eyeballed:** the table was **906px inside a 1,594px frame** and carried its
  own `max-height: 72vh` scrollbar inside a page that already scrolls — so the totals sat at the
  bottom of a box rather than the end of the list. Both fixed, scoped to this one table
  (`table.sheet` stays `width: auto` globally, or the Time tab's six columns stretch).
- **The width fix overshot on the first try and the browser caught it:** widening the table
  alone handed the whole 688px to Casual leave's Taken column, five times the width of Sick
  leave beside it. Every figure column needs its own width or the slack pools in one.

### Every screen fills the screen, and the filters that did not (v1.80)

Dinesh sent five screenshots of the Leave tabs — *"make all screen proper"* — then two of a
report, *"chekc all report also"*, then *"profile pe clcik larne se kuch nahi aata"* and
*"staff wise email & mobile number ka list bhi chiaye with deopartmmet role"*.

- **THE FILTER BAR WAS NOT FILTERING.** His screenshot: Salary deductions, Company set to
  BOOKNFLY PRIVATE LIMITED, all 86 people still in it — on screen and in the print. **Ten
  panels** took `payroll` whole and never read `filters`; the bar was drawn because the
  catalogue says those reports accept a company and a department. Narrowed **once** in
  `Reports.jsx` (`shown`) and handed to every panel, rather than ten panels each growing their
  own idea of what a filter means. **A test counts `payroll={payroll}` in the panel map and
  requires zero** — it caught two I had missed (`Totals`, twice).
- **Thirteen reports were a narrow table in a wide panel**, swept and measured at 1900px.
  One rule — `.report-body table.sheet { width: 100% }` — scoped to the report body so every
  report present and future gets it and `table.sheet` stays `width: auto` everywhere else.
- **The Leave tabs: two shapes that want opposite things.** A list of people (`table.sheet
  wide`) fills the width; a settings panel (`.card.narrow`) narrows to its content, because
  stretching four rows of tick boxes across a monitor is worse, not better. `.card-grid` puts
  the companies on The day off side by side.
- **Reports → Staff contact list** (`shared/contactList.js`) — **`CONTACT_FIELDS` is the whole
  of what it can ever carry**, with `NEVER_ON_A_CONTACT_LIST` and a test asserting no salary,
  PAN, Aadhaar, bank account or date of birth travels. A contact list gets printed and left on
  a desk; the employee export has forty columns and is a different thing. Somebody with no
  number is **listed with the gap showing** — they are the ones the list exists to chase.
- **The profile in the corner was a `<span>`** — round, in the corner where every app puts an
  account menu, and inert. The same lesson as the asset invoice and the candidate row, the
  other way round: **a thing that reads as a control has to be one.** It is a menu now, and
  gave the office its first voluntary way to change a password (`ChangePassword` had only ever
  appeared when `must_change` forced it).
- The leave register's **"Company" column renders `department || company_name`**, so it was
  wrong on nearly every row. Headed Company / department.

## The employee fills in their own record (v1.81) — `shared/selfRecord.js`

Dinesh, looking at HARISH GUPTA's own portal page with `UAN —` and `ESIC NUMBER —` on it:
*"employee banane k liye jo details chiaye / o khud employee bhar k de / and uske documnet bhi
khud upload karde wesa banavo"*.

**Inspected first, and half of it already existed.** `shared/onboardingFlow.js` + `JoinPage.jsx`
have invited somebody who has NOT joined yet to fill in the joining form and send their papers
since v1.72. What did not exist is the same thing for the eighty-odd people **already on the
payroll**: their portal let them change a bank account, a phone, an email and one address line,
and `/api/me/documents` was **GET only** — they could not upload a single file. That is exactly
why their UAN and ESIC columns are blank. Only the office could ever type one, and the office
has eighty of them to chase.

- **`FILLABLE` is `onboardingFlow.THEIRS_TO_FILL` narrowed to what the master has, laid out by
  `employeeMaster.SECTIONS`.** There is no list of fields in the new module and none in the JSX —
  a joining form and a "complete your record" form asking for different things would be two
  definitions of one person, and the second added would be the one that drifted. A test walks
  every field and asserts it is on both.
- **THE RULE: their own facts are theirs; a statutory number may be FILLED IN but not CHANGED.**
  Nobody in the office knows somebody's father's name or emergency contact better than they do,
  and a bank account already wrote through from the portal. But PAN/Aadhaar/UAN/PF/ESIC are what
  a return is filed with, the office usually took them off the card, and a wrong one is found
  months later by a return that will not file. Supplying a blank one is all gain; overwriting a
  set one is a correction the office should make with the card in front of them.
- **Nothing on the form can move a rupee.** Not one field is an input to `calculateRow`. A patch
  naming `monthly_salary`, `joined_on`, `active`, `company_id` or a leave quota is **refused BY
  NAME**, not dropped — silently dropping is how somebody types a salary, is told "Saved", and
  believes it. There is an API test that a month's gross, net and total are identical before and
  after somebody fills their record in.
- Every change goes through `updateEmployee`, so it lands in `employee_history` with
  *"Filled in by the employee from their own login"*. **`pan`, `aadhaar`, `uan`, `pf_no`,
  `esic_no` and `dob` were added to `TRACKED_FIELDS`** — when a PF return bounces, "who put this
  UAN on the record" has to have an answer.
- **Uploads go into the SAME store the office uses** — one set of papers, one register, one KYC
  count — and land `verified: null`, which is **not checked and NOT rejected**. Somebody still
  has to open the Aadhaar card. **An offer letter and an appointment letter are refused**: those
  are issued BY the office and are the one kind worth forging.
- `GET /me/documents/:id/file` serves their own back, bound to the LOGIN; somebody else's
  document is a **404, not a 403** — this route has no business confirming it exists. They may
  remove one nobody has looked at, never one already checked.
- The rate limiter has **its own bucket per route**, the punch-link lesson: a form saved on blur
  is chatty and would otherwise starve the upload limit.
- **Found by driving it, twice.** (1) The "still needs" line warned about the bank transfer
  whether or not the bank lines were among the missing — it now only says what is true of that
  record. (2) Saved on blur, a mistyped UAN committed the instant the box was left and was then
  the office's to correct; the once-only boxes now **ask, with the value read back**, before they
  commit.
- **`<a className="ghost">` gets no styling** — `.ghost` is `button.ghost` only, so the Download
  link rendered as a stray blue browser link in a row of controls. `a.linkish` added. (And the
  download must stay an anchor: `res.download` has nothing to show in a tab, and `window.open`
  after an `await` is blocked as a pop-up **silently**.)
- **Employees → "Let them fill it in"**, beside Add employee. The invitation has worked since
  v1.72 and was a **collapsed `<details>` fold** under the Add employee card — which is why
  Dinesh asked for it as though it had never been built. **Sixth time for that exact pattern**
  (hiring's "add vacancy", People, assets, the asset invoice, the candidate row, this).
- **Two help topics would have been two answers to one question.** A new office-side topic was
  written and then deleted: `onboarding` already covered the invitation better. It was amended
  instead — the new button name, plus a line saying somebody already on the staff list uses their
  own login. The staff topic `my-record-fill` is new and carries the trap note, pinned by a test.

## How long a day is, and what the month owes (v1.82)

Dinesh: *"employee wise shift wala ho gya ?"* — **inspected rather than answered from memory,
and the honest answer was half.** Then, mid-build: *"26 days fix / monthy;y hour fullsalary k
liye 9*26 hone chiaye / kabhi working hours kam hue kabhi jyada hue to uska working hours
monthly ke hisab me aana hciaye / agar monyth;y 234 hour nhi ho rah he to salry dedct hoga"*.

### Part one: only WHEN a shift started was personal, never HOW LONG it ran

`employees.shift_in/shift_out` were already held per person, already editable in three places,
and already used by `lateEarly.js` for late/early and by `fillTimesFor` for the fill button.
But **short hours and overtime were judged against the month's `hours_per_day` for everybody**.
So a ten-hour shift collected an hour of overtime every day for simply being worked, and a
six-hour part-timer was docked three hours a day for finishing exactly on time.

- **`hoursForEmployee(employee, { period })` in `shared/lateEarly.js`** is the one answer, called
  by `db.js` (the money path), `localStore.js`, `calc.js`, `attendanceStatement.js`,
  `monthlyStatus.js`, `myDashboard.js` and the three screens. One rule, so the sheet, the Time
  tab, the dashboard, the portal and the import preview cannot give five answers.
- **Only a different LENGTH can move a figure.** `hasOwnShift` is asked first and compares
  against the office day rather than "is the column filled in" (it carries a 09:30 default for
  all eighty-six people). 14:00–23:00 is still nine hours and comes out byte-identical.
- **The RATE follows the day too** (`perHour = perDay / hoursPerDay` in `calc.js`). Expecting six
  hours and charging the shortfall at a ninth would be incoherent — both halves or neither.
- **A typo falls back and is NAMED.** Under two hours or over sixteen (`MAX_DAY_MINUTES`, now
  exported from `timesheet.js` so there is one bound): 09:00–09:30 read literally makes a
  half-hour day the standard and pays 8½ hours of overtime every single day.
- **Test trap worth remembering:** `calculateRow` does NOT read clock times — it sums the
  `minutes` already stored on each day, which `setAttendance` worked out on the way in. The first
  draft of the tests asserted against fixtures carrying times and no minutes, so OT was zero
  whatever the shift was and the tests proved nothing. They now model the pipeline, and there is
  an end-to-end API test as well.

### Part two: the month owes a total — `shared/monthlyHours.js`, `MonthlyHours.jsx`

A third `late_policy`, `'monthly'`, beside `hours` (the default) and `concession`.

- **Nine hours times the days each person was DUE.** 26 days is 234 hours; a day short and a day
  long cancel; only what is missing from the total comes off.
- **THE TARGET IS NOT A FLAT 234.** Somebody absent two days owes 24 × 9 — those days have
  already come off as absences, and a flat target would dock them twice for one absence. Only
  `HOURS_EXPECTED` marks (blank, P, WH) count; leave, a holiday, a weekly off and a half day add
  nothing to either side.
- **A day nobody clocked counts on NEITHER side.** Booking nine hours and crediting none would
  deduct a whole day from somebody who was there and did not punch. Minutes typed straight onto
  an unclocked day still stand — somebody put them there on purpose.
- **One of three, never two**, the same trap as the concession: somebody an hour short on Tuesday
  is already an hour short in the month's total. `calculateRow` picks one; a typed figure still
  beats all three.
- **Off until switched on, priced first**, held per month. The line is computed on every policy
  so the panel can say what a switch costs, exactly as the concession line does.
- **What it actually changes**, measured on a real month: the old rule forgives up to 15 minutes
  on EACH day, which over 26 days is 6½ hours a month given away. Ten minutes short every day
  cost nothing before; on this rule it is 4h 20m off the total and ₹481 off the pay. Most of
  what he described — a short day and a long day cancelling — **already happened**, because the
  month is the sum of signed daily minutes. The grace is the real difference, and naming the
  target is the real gain.
- `monthly_hours_grace` defaults to **0**: a monthly pool plus a daily allowance gives away a
  second concession nobody decided on, the same reasoning as `late_grace_minutes`.
- `updatePeriod` forces an unrecognised policy back to `'hours'`, so a stale form cannot land a
  month on a rule nobody chose.
- **Two UI slips the browser caught:** `.late-figures` was a class I invented with no CSS behind
  it, so the panel read “Short of their total1” — it uses the established `.late-figs`
  (value first, then what it is); and putting “monthly hours” in the *Late and early*
  badge made that panel look as though it were about this rule.
- **A test caught a deliberate boolean:** `calc.test.js` sweeps every returned key and requires a
  finite number unless it is in `DESCRIBES`. `monthly_hours_judged` is false when there was
  nothing to judge, which is not “they did no hours” — a number could not say that.

### Turned on, from now (v1.83)

Dinesh, having seen the figure: *"monthly wala on kar do abhi se"*. His live database is on
the BNF server behind the tunnel and cannot be reached from here, and `late_policy` is a
column on `periods` — so "on" had to mean two things, not one.

- **`DEFAULT_POLICY_FOR_NEW_MONTHS` in `shared/lateEarly.js` is now `POLICY.monthly`**, named
  explicitly by `createPeriod` and by `localStore` rather than left to the column default, so
  one constant decides it and the server and the offline build cannot open a month on
  different rules.
- **NOTHING REWRITES A STORED VALUE.** Every month already in the database keeps the rule it
  was run on, including the one open when the update lands. There is an API test that opening
  a new month gives `monthly`, that an existing month is untouched by reading it or its
  payroll, and that switching one month does not switch another. Verified in a browser on two
  months with identical attendance: October (opened on `hours`) nets ₹25,800 and November
  (opened now) nets ₹25,319 for the same person.
- **"Charge this month on it"** sits on the panel itself, priced, because the select that
  switches the rule is on the panel ABOVE and the figure it costs is on this one. The way in
  goes where the person is already looking — seventh time.
- **A real difference found by a failing test, not by guessing.** On the monthly rule a
  `minutes` figure typed over a day that HAS clock times does not win: the month is an account
  of hours and the hours are on the day. That is what makes a day typed on the Time tab, a
  phone punch and an approved missing punch come out identical — none of them gets to name
  the figure — and it is now stated in the module, in help, and pinned by a test. The
  office's way to forgive a month is still the sheet's own OT/LT override, which beats every
  policy.
- **Four tests pinned the old default and were REWRITTEN to state the new rule, not patched.**
  `attendanceWrites` is about the three write routes agreeing per day, so its period is pinned
  to `hours` with the reason written down (its people carry other days from earlier tests in
  the file, which the month-wide account counts and the day-by-day rule did not). `lateEarlyApi`
  asserts the new default and then patches itself back, which is itself the proof that nothing
  switches a month by itself. `auth` and the audit trail now state what a month opens on.

### Both rules at once (v1.84) — `POLICY.monthlyLate`

Dinesh, straight after turning the monthly target on: *"late early concession bhi on kar do"*.
Until then the three were **alternatives** and turning the concession on would have turned the
monthly target off. They do not have to be — but only if the overlap is removed.

- **They answer DIFFERENT questions.** The total asks whether the hours went in; the concession
  asks whether somebody turned up on time. Forty minutes late every day and forty minutes later
  every evening is nine hours done and still late every morning — the monthly rule alone cannot
  see it, which is the whole reason for running both.
- **What they share is the person who is late and never makes it up**: those minutes are in the
  monthly shortfall AND in the late pool. So `calculateRow` charges the **GREATER of the two,
  never the sum** — written as "the shortfall, plus only the lateness beyond it", which is the
  same arithmetic and reads as what it is. By construction a minute cannot be taken twice, and
  it is never less than either rule alone. There is a test for both halves.
- Measured on three shapes of month: on time → nothing; late but hours complete → ₹1,370 (the
  monthly rule alone charges nothing); late AND short → **₹1,926, not ₹3,296**.
- **Two preview bugs, both found by reading the two panels on one screen rather than by
  guessing.** (1) *Late and early* summed `late_computed` (what the rule WOULD take) and read
  "2,741 charged" against payslips taking 1,370 — it sums `late_salary` on this policy now, and
  says how much lateness was absorbed by the shortfall below. (2) The confirm took the greater
  of the two **totals** and said "at most 2,741" for a month that takes 3,296 — the greater has
  to be taken **per person and then added**, because the person the monthly rule bites and the
  person the concession bites are not the same person.
- `DEFAULT_POLICY_FOR_NEW_MONTHS` is now `monthly_late`; existing months still keep whatever
  they were opened on, with the same tests as v1.83. Five tests pinned the previous default and
  were rewritten to state the new one.
- **Worth knowing before the first payday on it:** lateness is judged against 09:30–18:30 unless
  somebody carries their own `shift_in`/`shift_out`, so anybody genuinely on flexible hours needs
  their shift set or an afternoon start reads as hours of lateness. Note the tension with his own
  earlier rule recorded in `standardTimes.js` — *"time sabka flexible, 9 hrs complete hone
  chahiye"* — which the monthly target serves and the concession does not. Both are on because he
  asked for both; the panel names everybody over the concession before it is switched.

### The Settings tab (v1.85) — and the stale box that could have moved money

Dinesh: *"SETTING TAB MEYE SAB ADJUST AR SAKE ESA BANANA"*. **Inspected first** — the panel
existed under Admin and covered most of the month's rules. What it did not cover was the two
releases I had just shipped.

- **A LIVE BUG OF MY OWN MAKING.** The rule select hand-wrote **two** `<option>`s and read
  `value={onConcession ? concession : hours}`. v1.82 and v1.84 took the policies to four, and
  `onConcession` is true for `monthly_late` — so a month on the new rule rendered as
  *"concession"*, and touching that box would have fired `late_policy: 'concession'` and
  **switched the month's hours target off without a word**. A select that enumerates a constant
  goes stale the moment the constant grows.
- **`POLICY_CHOICES` in `shared/lateEarly.js`** is now the one list — key, label and why — and
  both `LatePolicy.jsx` and `Settings.jsx` map over it. A test asserts every `POLICY` value has
  an entry, that both screens read the list, and that **neither writes its own `<option>`**
  (comments stripped first, so an explanation cannot pass for the thing it warns about).
- The month's rules are now complete on the page: `monthly_hours_grace` was missing, each box
  says what it does and what it is now, and one line states **which rules are actually biting
  this month**. The old "two rules are alternatives, never additions" paragraph was wrong after
  v1.84 and now says the real rule.
- **"Set elsewhere — and where"**: leave quotas, the weekly day off, the leave bonus, festivals,
  per-person shift times and PF/ESI mode, asset prefixes — each a button that **opens that
  screen** (`onGo` threaded through `Admin`). One screen owns each figure, because two screens
  editing one figure is how two answers come to exist; what was missing was the way IN.
- **Weekly off and leave quotas were in "what is deliberately not a setting"**, which was simply
  wrong — they ARE settings, they just are not the month's. Moved, and the test that pinned them
  as "explained" was **rewritten to state the new rule**: nothing may appear on both lists.
- **Two help topics shared the id `settings`.** The second shadowed the first — `helpTopic`
  finds one and "Open it" becomes ambiguous. Merged into one, and there is now a test that **no
  two topics share an id or a title**. Second time for this exact drift (the onboarding topic in
  v1.81), which is why it is a test now rather than a note.

### Only the contract's bonus, and the leave bonus register (v2.49.0)

Dinesh: *"Apply only leave bonus formula and nake leave bonus register"*. Asked which reading,
he chose **only the yearly one**: the contract's slabs stay with their first-year and pro-rata
rules (NOT applied to everybody regardless of joining date).

- `LeaveBonus.jsx` IS the yearly screen now; `LeaveBonusYear.jsx` was deleted (one file - a test
  asserts it). The monthly bonus's **screen** is gone; its routes, `bonus_payments` rows and
  `leaveBonusApi.test.js` stay, so anything it paid can still be read and taken back.
- **The register** (`LeaveBonusRegister`, exported): per person joining date, salary, Jan-Dec
  leaves, total, slab, bonus, paid-in month, why. `yearMarks()` gained `by_month` (one more
  GROUP BY on period month) and `yearBonusFor` returns `months` - each the same `daysOff`, so
  the twelve add up to the total. **A month with nothing marked is `null`, a dash** - not 0.
  `paid_in` / `paid_amount` are joined on in the route from `bonusPaidAnywhere`.
- `registerCsv` / `printRegister` (landscape, compact). Reports -> Leave -> **Leave bonus
  register** (`LeaveBonusRegisterReport`, view only, company filter) - declared in the
  catalogue test's `beyondSpec`.
- The interface test requires `className="sheet wide"` in `LeaveBonus.jsx`; the register's
  table carries it, inside `.lby-register` (`table-wrap`, so it scrolls in its own frame).
- The "why" now says where a part year starts AND ends (`to 2026-12-20` for a leaver) - it
  read "97% of the year (from 2026-01-01)" for somebody who simply left in December.

### Write-off and disposal approvals; the contract's yearly leave bonus (v2.48.0)

"start asset approvals for buy, write-off and dispose" - **buy already had one** (Purchase
Requests, v2.39), so this is write-off and dispose. `shared/assetDisposal.js`,
`backend/src/assetDisposals.js`, `asset_disposals` (DDL in people.js beside the asset tables,
because `getAsset`/`listAssets` carry `disposal_pending`/`disposal_number` on every row),
`AssetDisposals.jsx`, `DisposalDialog.jsx`, a tenth asset section `disposals`.

- **A request changes nothing; the approval carries it out** in the same transaction
  (`carryOut`: a write-off is the existing `writeOffAsset`; a disposal returns it from the
  holder, sets `state = 'disposed'` with how/to whom/amount in `state_note`, and writes it off
  too via COALESCE so an earlier write-off date stays). Nobody approves their own
  (`raised_by_user`). Rejection and cancel need a note; cancel is the raiser or an approver.
  One open request per asset (partial unique index).
- **An approver acting is a direct approval** (`direct = 1`, raised and decided by them), not
  a bypass - so the list is every write-off however done, and a one-admin office is not stuck.
- **The old routes still work and go through it**: `POST /assets/:id/write-off` is direct for
  an approver (200, the asset, as before) and a 202 request for anybody else - which kept the
  `moreRoles` "HR reaches the route" test and every older test green. `POST /assets/:id/state`
  with `disposed` is refused (400) pointing at Dispose. Operators: 403 on the old route (the
  TAKES_AWAY gate), allowed to ASK via `/disposal` because asking takes nothing away.
- **`assetStatus` now ranks `disposed` above `written_off`** - an approved disposal is both,
  and "sold for 4,000" is the more specific fact. Both are off the register, so no live count moves.
- Digest line for approvers only (never their own requests), `go: 'assets', focus: 'disposals'`,
  not a staff line. `focus`/`onFocused` now reach `Assets` through `AssetsTab` - they never
  did, so the line first landed on Overview.
- **Bugs found by driving it:** the dialog rendered UNDER the asset page (both z-index 60,
  page later in the DOM) - `.modal-backdrop.wd-over` is 70; `table-wrap unboxed` let the table
  widen the page on a phone (638px at 414) - plain `table-wrap`; a textarea's monospace again.
- Standalone: no logins, so no approvals - the dialog posts to the old direct routes and says so.

**The yearly leave bonus** - Dinesh sent `BOOKNFLY - employment contract.docx` mid-task: *"check
this also / set leave bonus structure and amount also"*. Its "Paid Leave Structure": total leave
20; up to 20 leaves the full 20 days' bonus "as per 30 days"; 21-30 75%; 31-40 50%; 41+ nothing.
Calendar year; first year all leave unpaid; then pro rata. `shared/leaveBonusYear.js`,
`LeaveBonusYear.jsx` (Leave -> Bonus -> Yearly, beside the old monthly bonus), routes
`/leave/bonus-year/*`, `yearMarks()` / `bonusPaidAnywhere()` in db.js.
- bonus = base_days x monthly_salary / divisor x slab% x service share. Leaves counted with the
  monthly bonus's own `daysOff` (HF half, AD two - the contract's "2 days for every 1").
  Bands include their top figure (exactly 20 is full); 20.5 is in the 75% band.
- Pro rata applies to the 20 days, never to the bands. `min_service_months` 12 from `joined_on`.
- **Held, never guessed:** nothing marked all year, no monthly salary, **no joining date** -
  and in the test copy that was everybody, which is very likely true of his live data too.
- Paid with `payBonus(kind = leave_year_YYYY)` into a chosen month; the route first refuses
  anybody already paid that kind in ANY month (payBonus's own guard is per month only).
- The screen warns when fewer than 12 months of the year are in the app - leave in missing
  months is uncounted, which overpays.
- **Contract terms NOT built, reported to Dinesh instead:** leave request notice (1 day -> 2
  working days ahead, 2 -> 3, 3+ -> 7); desertion after 3 days' unapproved absence; notice
  period 45 days (3 months after 2 years) vs the exit default of 30; the Rs 1,35,000 training
  bond, 12-month minimum service and 3 security cheques; working hours 10-7 with 30 min lunch,
  48 h/week vs the app's 9 h x 26 target. The contract itself has a joining date (16/11/2026)
  after its own signing and renewal dates (01/04/2026), a blank Aadhaar, and its annexure calls
  the net 44,800 "Gross".

### Licence papers and the licence import (v2.47.0)

"start licence documents and import / add more option also". `backend/src/licenseDocs.js`,
`shared/licenseImport.js`, `license_documents` in `people.js`, `RecordDocuments` in
`Licenses.jsx`, the import dialog in `Renewals.jsx`.

- **Papers per record**, the `assetDocs.js` shape: on disk under `DATA_DIR/license-docs`,
  generated name only, `file_path` stripped from every response, read back through an expiring
  link at `/files/license-doc/:id`. The HMAC signs `lic:`-prefixed payloads, so an asset-doc
  signature cannot open a licence document or the reverse (tested). Kinds follow the record's
  category (`docKindsFor` in `shared/renewals.js`) - no police verification on a software
  licence. `LICENSE_SELECT` carries a `documents` count for the register's paperclip column.
- **A record with papers attached refuses deletion**, like an asset with handovers. Cancel keeps both.
- **The import: look first, then write**, `.xlsx` via ExcelJS or `.csv` via a small quoted
  parser, columns read off the header (`detectLicenseLayout`). **A key column is read only to
  report it as ignored** - a key never comes back out of this app, and a preview echoing a
  column of keys would undo that. Tested by asserting the key text is nowhere in the plan.
- **Three piles besides "add":** skipped with a reason (no name, expires before bought,
  negative cost, the same as row N / already on the register), and **similar** - same name
  and company, a different end date, not cancelled - which is almost always the same licence
  a term later and so a RENEWAL of the existing record. Held back; added only with
  `include_similar=true`. The twin check reads existing + create + similar, or a row repeated
  in the sheet lands in "similar" instead of being named against its first copy (found by driving it).
- **More options:** Copy as new (prefilled, starting the day the old one ends), bulk Payment
  pending and Set responsible beside Mark paid, Print the register, a blank template download.
- `routes/people.js` needed `db` imported for the import transaction.

### People panels (v2.46.0)

The panel-level items v2.41 left. **Audited first, and most of the data already existed**: claims had a
category (`kind`), tickets had `priority` (since an earlier addColumns) and `assigned_to`, notices had
start/end dates and times, exits had a clearance list. What was missing was on the screens.

- **Helpdesk**: `routeTicket` + `PATCH /people/tickets/:id` (priority must be one of `TASK_PRIORITIES`;
  blank `assigned_to` = nobody; a closed ticket refuses; audited as "routed"). Rows carry a priority
  select and a "With" box (datalist of names already used); open tickets sort high-first then oldest.
- **Claims**: chips grouping by category **case-insensitively** (older rows say "petrol"), with totals.
- **Penalties**: `.pn-track` bar of recovered/amount; waived gets none.
- **Exit clearance**: `N of M dealt with` bar off `clearance.items` / `outstanding`.
- **Noticeboard**: `noticeState()` in `shared/announcements.js` — scheduled / live / ended, with
  `live` defined AS `isLive` so the two cannot drift.
- **Appraisal form**: three groups (`.ap-group`) and a live rise (`.ap-rise`, red when it is a cut).
- "With" is a typed name, not a login — the app's usual honest limit.

### Assets, part two (v2.45.0)

The items v2.39 left for "part two". `AssetHistory.jsx`, `shared/serviceStatus.js`,
`shared/stockTake.js`, `Maintenance.jsx` (`OpenWork`, exported `ServiceForm`), `StockTake.jsx`.

- **The asset page** (`AssetHistory.jsx`) has a header (status pill + holder), quick actions and five
  tabs. **The actions are the register's own handlers** (`pageActions = { issue, back, setState,
  writeOff, label, voucher }` in Assets.jsx), not copies; a test refuses `/issue`, `/return`,
  `/write-off` or `/state` inside the page. `act()` now RETURNS the error (and `true` on success) so
  the page can show a refusal beside the button instead of on the register behind it. The page reads
  its asset from the register's list (`assets.find(...)`) so it is current after every action, with
  `open: history.open` carried across for the Invoice column's "go to documents".
- **`asset_services.status`** (nullable): scheduled / in_progress / waiting_parts / done / cancelled.
  **NULL = completed**, which every older row is, so no figure moved. **`isSpent` is the one rule
  for money**: `ownership`, `spendReport` and the dashboard's `repair_cost` count completed work only;
  open work is `open_services` / `open_repairs` and `GET /maintenance` returns `open`. Completing asks
  for the actual cost and date. **done → anything else is refused** (its cost is already counted).
  `looksDuplicate` ignores cancelled jobs. History shows "Repair — scheduled" with amount 0.
- **Stock take scope**: `roundFigures`, `inScope`, `unplaced`, `scopeChoices` in `shared/stockTake.js`;
  the server's `roundProgress(round, scope)` calls the same `roundFigures`, and `GET /rounds/:round`
  takes `location`, `department`, `company_id`. Matching is case- and space-insensitive; an asset
  with nothing recorded for a narrowed field is in no scope and is counted as `unplaced` and named.
- **Assignments by employee was NOT reworked** — `AssetLedger.jsx` already is the per-person page
  with tabs (overview, current, ledger, handover papers, maintenance).
- **Still not built:** saved custom reports, and a phone QR-scan screen beyond the `/asset/<code>`
  landing that already opens the asset.
- `assetsPart2.test.js` **removes its own temp DATA_DIR** in `test.after` — the pattern every new
  test file should follow, after /tmp reached 30 GB.

### Admin, redesigned (v2.44.0) — and the disk that filled up

The Admin brief. **No server permission logic changed**: a test pins that `Users.jsx` calls only the
seven login routes that already existed.

- `Admin.jsx`: a header naming what the open panel is for, icon tabs. **Panel keys unchanged**
  (`staff` is now labelled "Staff access").
- `Users.jsx` (Logins): six figures that filter (office logins only — staff logins are counted and
  sent to Staff access), search, role and status filters, 15 a page, role badges (`.ad-role.r-<key>`),
  a status badge from **`shared/loginStatus.js`** (switched off outranks everything), and a ⋯
  `RowMenu` **positioned against the window, not the row** — a dropdown inside the scrolling table
  frame is cut off on the bottom rows.
- `LoginDialog` (add/edit) and `ResetDialog`; `PasswordBox` starts SHOWN (it is read out) with Hide.
  The username cannot be edited (there is no server path for it, and it is what they sign in with).
- `RoleMatrix` is drawn from the server's `ROLES` — a test requires a column for every ability any
  office role carries.
- **Not built:** restoring a backup from the screen (it overwrites the whole payroll database and
  the server has no route for it — restore stays a server-side job), and regrouping Settings, which
  was already sectioned.

**THE DISK FILLED UP.** Every test file makes its own temp `DATA_DIR` under `/tmp` and never removes
it; after many full runs that was ~35,000 folders and 30 GB, and the disk had 18 MB left. The
symptom was **Chromium "Page crashed" on every signed-in page, intermittently, with
`ERR_INSUFFICIENT_RESOURCES`** — which looks exactly like a render loop and sent the hunt through
bisecting components, the clock and the API responses before `df` answered it. **Check `df -h /`
first when the browser starts crashing.** Clean-up: delete `/tmp/<name>-XXXXXX` folders (not the
scratchpad). Also: in this container use `http://127.0.0.1`, not `localhost`, in drivers — Chromium
tries IPv6 first and logs "Address family not supported".

### Reports, redesigned (v2.43.0)

The "Reports at Your Fingertips" brief. **Layout only — every report panel, filter bar, Download
and Print is untouched**; `Reports.jsx` replaced the collapsible tree and the empty landing card.

- **`ABOUT` + `aboutOf()` in `shared/reportCatalog.js`** — one line per report for its card; a report
  with a `note` uses that. A test refuses a report with neither and an ABOUT key that is no report.
- Sidebar (`.rp-side`, still `.report-tree` for the sticky frame): All / Recently used / Favourites,
  then the nine categories with counts and icons (`CATEGORY_ICON`). Picking one shows a flat grid;
  "All" with no search shows the catalogue in sections.
- **Favourites and recent are localStorage (`reports.favourites`, `reports.recent`), wrapped** — a
  desk's convenience, not the office's record. Recent is written by an effect on `openId`, so the
  dashboard's focus links (approvals, documents) count as opened too.
- **Search matches a card's line only at a word start** — "late" found "calcu*late*d" and
  "temp*late*" until it did. Name and category still match anywhere.
- **No date range on the landing**, deliberately: the month is the top picker and ranges live in the
  reports that accept one. A range there would filter nothing.
- Traps: `.late-head` is `space-between`, so three children put Download in the middle — `.rp-head`
  lets the title take the slack. And a `flex-basis: 15rem` sidebar becomes a 15rem HEIGHT once the
  shell stacks into a column on a phone.

### Task desk, redesigned (v2.42.0)

The "Booknfly HRMS – Task Desk UI/UX Improvement" brief. **Audited first: the desk already had six
figures, two columns, Needs attention and modal forms** — so this is the dashboard reworked in place
in `TaskDesk.jsx`, plus only the fields the server can genuinely hold.

- **Six `ao-kpi` cards, every one a way in.** Overdue and No update were plain numbers; they now set
  the **Needs attention** pile and scroll to it (`showAttention`, inside `requestAnimationFrame`).
- **`attention(me, tasks)` in `shared/taskDesk.js`** gives four piles — overdue / stale / high / due
  in 2 days (`isDueSoon`, today counts, overdue excluded) — over work somebody gave or was given,
  open only. A task may sit in more than one pile.
- **Approve / Reject / View on each waiting request**, through the SAME `POST /desk/approvals/:id/decide`
  the request page uses, so the server's rules are not restated. Reject asks the reason via prompt.
- **New nullable columns** (`addMissing` in desk.js): `staff_tasks.category/starts_on/checklist` (JSON),
  `desk_approvals.kind/needed_by`. Start after due is refused; `kind` must be in `APPROVAL_KINDS`,
  **which deliberately has no leave** — leave is applied for from Leave, where an approval marks days.
- **Progress exists only where a checklist measures it** (`progressOf` → null without one, never 0%).
  `POST /desk/tasks/:id/checklist {index, done}`: the people who may post on the task, open tasks only,
  writes `Ticked: <step>` on the thread by name and bumps `updated_at` (a tick is word on the task).
  The task page's tick has its own handler so a half-typed reply is not cleared.
- **Not built, said on the forms:** attachments (no store for desk files), reminders that are sent,
  drafts, a visibility picker (visibility is the existing rule, stated in words).
- Trap met: the theme test wants `[data-theme='light']` with **single quotes** and a matching
  `:root[data-theme='dark']` rule beside every dark media block.

### People, redesigned (v2.41.0)

Two People briefs (one with a mock-up of a split list + profile). Inspected first: `PersonFile.jsx`
already WAS the per-person profile with tabs (overview, records, reviews, claims, tasks, helpdesk,
exit, activity), and every section panel worked. So this is layout, not new data.

- `People.jsx`: header with **+ Add employee** (orange — `button.primary.pp-add`, because plain
  `.pp-add` loses to `button.primary`), seven figures (total/joined this month, working, serving
  notice, left, reviews not applied, claims waiting, open tickets — counted from the SAME
  `/people/claims|tickets|appraisals|exits` lists the panels use), one filter bar (search incl.
  email/phone, department, designation, location, status, count, Reset), and a paged **staff
  directory** (`Directory`) that heads Employee Records and appears on any tab once filtered.
- **PANELS keep their keys** (`records`, `appraisals`, …) with the new labels, so digest/reminder
  `focus` links still land. A test pins both.
- **Add employee opens the ONE joining form**: App sets `openEmployee = 'new'` and switches to
  Employees, whose `openFor` effect now treats `'new'` as `setAdding(true)`. People has no form.
- **Bug fixed:** the status filter called `statusOf(e)` with no exit, so "Serving notice" never
  matched anybody. It now passes the person's exit row.
- Records: empty state, kind-coloured left edge (`.pp-kind-*`), one "Put something on the
  record" button (the empty state's duplicate was removed). PersonFile header gained the avatar,
  phone and email.
- Measured: tabs one row at 1440 (icons hidden under 1600px), no sideways scroll at 1280 or 414
  (three directory columns hidden on a phone).
- **Not done from the briefs, deliberately:** a reshaped appraisal form, claim categories, recovery
  progress bars, ticket priority/assignee, notice scheduling and exit-checklist progress — each is
  a change to that panel's own data or form and should be asked for panel by panel.

### Renewal management — the License tab redesigned (v2.40.0)

Dinesh's "License, Rent Agreement, Insurance & Renewal Management" brief. **Audited first:** one
`licenses` table already held all three (v2.35 kinds), with `license_renewals` as the
period-by-period history, seats, cancel-and-keep and a key no read returns.

- `frontend/src/components/people/Renewals.jsx` replaces `Licenses` in App.jsx; `LicencePage`
  is now **exported** from Licenses.jsx and is still the one record page. Seven sections.
- **New nullable columns on `licenses`** (ALTER in people.js): responsible_id, payment_status,
  auto_renew, renewal_stage, proposed_cost/until, proposal_note, approved_by/at, starts_on,
  rent (property_address, security_deposit, lock_in_months, notice_days, escalation_pct),
  insurance (policy_type, insured_item, coverage_amount). Added to `LICENSE_SELECT` (an
  explicit column list — the third time a new column was invisible until it was added there)
  and `LICENSE_FIELDS`. Rent keeps `publisher` = landlord, `cost` = monthly rent; insurance
  keeps `publisher` = insurer, `invoice_no` = policy number (the v2.35 `fieldWords` mapping).
- `shared/renewals.js` — `categoryOf` (from the kind, never stored), `STAGE_STEPS` /
  `stageProblem`, `renewalStatus`, `dueReminders` (the SMALLEST step reached, so one nag per
  record), `costOf` (rent ×12; others via `annualCost`, no cycle = not guessed), `costSummary`,
  `renewalOverview`, `calendarEvents`, `financialYear`.
- Workflow: `moveLicenseStage` + `POST /licenses/:id/stage`; approve needs `approve` (403
  otherwise). "Mark renewed" is the EXISTING `renewLicense`, which now also clears the stage and
  sets payment paid — so the old term is a `license_renewals` row before the new expiry lands.
- Reminders: `settings.renewal_reminders.steps`; `license_reminders` with a UNIQUE (licence,
  step, expires_on) so `GET /licenses/overview` logs each once (`fresh_reminders`); renewing
  changes `expires_on` so reminders start afresh. Shown in-app only — said on screen.
- Fixed paths (`/licenses/overview`, `/reminders`) are registered BEFORE `/licenses/:id`, or
  Express hands "overview" to the id route.
- **Not built:** per-record document upload for licences (no store exists for them yet —
  `assetDocs.js` is the pattern to copy), Excel import, notifications to a named approver.

### Assets redesign, part one (v2.39.0)

Dinesh sent a 20-section "Complete Asset Management Module Redesign" brief with a mock-up.
**Audited first: most of its backend already existed** (QR labels + scan-to-asset, handovers
with acknowledgement, stock take with "not checked ≠ missing", maintenance with the
duplicate check, documents, photos, history, export with a column picker, import). What was
missing was layout, a warranty screen, purchase requests, and register sort/page/columns.

- **Nine sections** (`ASSET_SECTIONS` in Assets.jsx), **keys unchanged** so every old screen is
  the one behind the new name: dashboard→Overview, register→Asset Register, slips→Assignments,
  stock→Stock Audit, maintenance→Maintenance & Repairs, statement→Reports, masters→Settings,
  plus new `warranty` and `purchases`. A test pins all nine.
- **Overview** (`AssetDashboard.jsx` + `overview` in `shared/assetDashboard.js`): nine KPI
  cards off `assetCounts` (Available and "In office" are ONE figure — on this register nobody
  holding it means in the office; printing both would be one number under two names), bars by
  category/company/department/location off the same `live` set, short lists, and
  `pending: { purchases, claims }` from the route. Hand-drawn bars, no chart library.
- **Purchase requests** — `shared/purchaseRequest.js` (rules), `backend/src/assetRequests.js`
  (`asset_requests` + append-only `asset_request_events`), routes under
  `/api/people/assets/requests` (area-gated like every `/assets` path). draft → submitted →
  approved/rejected → ordered → received → completed; cancelled from any open step. Approve
  needs the `approve` ability and **never the requester** (compared on `requested_by_user`);
  reject/cancel need a note; only a draft is edited or deleted. **An approval registers
  nothing** — "Register it" opens the normal Add asset form prefilled (cost per unit), so the
  code series and duplicate-serial check hold. Numbers read off the highest used. Server only.
- **Warranty & AMC** (`shared/warrantyBuckets.js`, `WarrantyAmc.jsx`): every live asset in one
  bucket; "no date" is its own pile, never "covered". Alert steps 90/30/7/day/after are computed
  (`alertStep`) but nothing is SENT — same honest position as the digest.
- **Register**: sorting (`SORTS`), pages 25/50/100, Status pill (`as-<status>`), Brand/model,
  Location and Purchase date columns, hide-able columns (`OPTIONAL_ASSET_COLUMNS`, localStorage),
  secondary actions behind `.menu-more`. Sort/page act on `shown`, so every figure above the list
  is unchanged. Two sticky `.row-no` columns were both at `left: 0` — fixed with nth-child offsets.
- **Not done yet (part two):** the asset detail page's tabs and quick actions, the Assignments
  employee-profile redesign, Stock Audit rounds by location/department, maintenance statuses
  (scheduled/in progress/waiting for parts — the service record has no status column today),
  saved custom reports, and a phone QR-scan screen beyond the existing `/asset/<code>` landing.
- **Test harness trap:** `createServer()` returns the express APP; `app.listen()` returns the
  http.Server. Awaiting listen on the app and calling `.address()` / `.close()` on it hangs the
  file for ever. `await new Promise(r => { const s = createServer().listen(0, '127.0.0.1', () => r(s)); })`.
  Without the await, one run in three got ECONNREFUSED on its first request.

### Only casual and sick leave, both unpaid, 20 a year (v2.38.0)

Dinesh: *"need only 2 leaves / casual leave / sick leave / both are unpaid"*. Asked, he
answered: from **November too**, **PL out of new use**, and *"20 unpaid leave me se kitni le
li he / after 20 leave complete in year they are not eligible to take any leave"*.

- **A RULE OF THE MONTH, `periods.leave_unpaid`, never a change to `ATTENDANCE_CODES`.**
  Changing the code list would re-price every month already paid the next time anybody opened
  it. `markFor(code, period)` / `codesFor(period)` in `shared/calc.js` give CL and SL
  `absent: 1, paid: false` and a "(unpaid)" label on such a month; `absentDaysFromAttendance`
  takes the period, and `calculateRow` and `earnedSoFar` pass it. Column default 0.
- **`settings.leave_policy` = `{ on, from: 'YYYY-MM', yearly_limit }`.** `ensureLeavePolicy`
  (end of db.js, beside `ensureAutoDoubleRule`): a database with months → on from the current
  month, and every **unlocked** month from then switched to 1; an empty database → off, which
  is what keeps every older test fixture paying CL. `createPeriod` opens a month on the rule
  when `leavePolicyCovers`. Settings has a per-month checkbox (confirm first).
- **PL is RETIRED, not deleted**: `codesFor` flags it `retired`, and the grid's `offered()`
  hides a retired mark everywhere except on a day that already carries it. A test refuses any
  `Object.entries(codes).map` in Attendance.jsx. The offline build keeps new months at 0 (no
  settings table there); the Settings checkbox works offline.
- **One yearly balance, CL+SL together** (`shared/leavePolicy.js`, `unpaidLeaveUsed` in
  db.js counting only months with `leave_unpaid = 1` — an October CL was paid leave and is not
  part of the twenty). `leaveLimitFor` in attendanceSelf.js refuses an application past it
  (pending/recommended ones count against what is left) and **re-checks on approval**; PL is
  refused by name. **The office marking the grid is NOT refused** — somebody off sick on day 21
  is still off; the register shows it.
- `LeaveYearly.jsx` replaces the three-quota table while the rule is on; MyPage, the manager's
  team list and the approval queue (`withLeaveContext`, `leave_balance.yearly`) read one figure.
- **Harness slip worth remembering:** a `useMemo` added to App.jsx after its early returns
  threw React #310 (hooks order) on load. `codesFor` is cheap — it is a plain call now.
- Not touched on purpose: encashment, year-end carry-forward and the leave bonus still read
  the old per-type ledger; with CL/SL unpaid there is nothing to encash or carry. Say so if
  Dinesh asks.

### Off the payroll, the no-out catch-up, no more "Fill" (v2.37.0)

Five messages off his live v2.36 screens.

- **`employees.not_on_payroll`** — *"what for front office management and owner account"*:
  both sat on the salary sheet as critical "no salary set". The record stays (logins, desk,
  assets); `syncPayrollRows` skips it and `strandedRows` takes an untouched row off an
  unlocked month **whatever is on the grid** (money typed on the row still keeps it). Tracked
  in `employee_history`. A `flag` field kind on the record, a checkbox on the form, a pill on
  the list. Offline `syncRows` mirrors it (and now skips drafts too, which it never did).
- **Missing punch catch-up** — *"what u done for missing punch"*, AJEETKUMAR's 27th still P.
  The v2.34 rule only acts on new imports and never overwrites a stored mark, so days imported
  before it stay P **by design**. `missingOutCandidates` (`shared/missingOut.js`) offers them:
  finished days, arrival and no departure, P or blank, not already the rule's, not marked by
  hand, no allowed/refused decision. Button on the Attendance toolbar, confirm names them,
  writes `HF` with `rule_half_day` → `missing_out: 1`, so a typed out time still restores P.
  `attendanceByEmployee` now carries `marked_by_hand: 1` for `missing_out === 0`.
- **THE BUG FOUND ON THE WAY:** the grid's `queueSave` spread the stored entry, so a date range
  or day marker replacing a rule-HF with CL sent `missing_out: 1` back — the next import would
  have treated the office's leave as the rule's and overwritten it. `queueSave` now strips
  `missing_out`/`marked_by_hand` and only `rule_half_day` sets the flag.
- **"Fill the usual timings" is gone** — pressed by mistake on a Saturday morning, *"no
  useful"*. `shared/usualFill.js` `usualFillDays` finds what it wrote (times exactly the
  person's usual ones via `fillTimesFor`, **and no punch on record** from `/punches/month`)
  and **Undo the usual timings** clears the times only; the mark stays. Nothing is offered
  until the punch record answers. The time-mismatch sentence now says "a day worked on
  exactly these timings", and three tests that pinned the button were rewritten to state that
  it is gone.
- **A clock beside every time box** — `TimeInput` keeps typed `930` and adds a button that
  calls `showPicker()` on a hidden `type="time"`; shift fields (form + record), the usual-day
  editor and the punch-link correction form are native `type="time"`. **A `\u{...}` escape
  written as JSX TEXT is a syntax error** ("Syntax error F") — it has to be `{'\u{1F552}'}`.
- **Sunday tab**: hours under each tick (`.sun-hrs`), "no times" for an unclocked Sunday.
- **Spouse box**: `spouse_phone`, `spouse_occupation`, `spouse_company` beside the parents'.
- **Asked, not built:** *"need only 2 leaves, casual and sick, both unpaid"* — moves money on
  every CL/SL day, so put to Dinesh first (which months, and what happens to PL).

### Assets: one count for every screen (v2.36.0) — `docs/ASSETS-AUDIT.md`

Dinesh sent a 23-phase "Assets module" brief whose first instruction was *audit before
building*, and whose rules were: do not hardcode a figure, do not edit a historical record to
make numbers match, do not touch payroll/attendance. The availability table is in
`salary-app/docs/ASSETS-AUDIT.md`.

- **THE MISMATCH (363 vs 359 "with staff"):** `registerTotals.out` was `isOut` — anybody
  holding it, whatever its state — while the dashboard counted `assetStatus === 'assigned'`.
  A laptop with somebody AND under maintenance/damaged/missing was "with staff" on one screen
  and not the other. **`assetCounts()` in `shared/assetStatus.js` is now the one count**:
  every asset in exactly one of the seven statuses, `live = assigned + available +
  maintenance + damaged + missing`, `gone = written_off + disposed`, `check` proves the sum.
  `held` (in somebody's name, any live state) is kept as its OWN figure and named as such.
  `registerTotals` reads it; `assetDashboard` returns `counts` and `oddities`.
- **Disposed was "in the office".** `state = 'disposed'` without `written_off_on` passed every
  register filter and the cost total. `onRegister()` is the one test; the register's chips are
  statuses now (`out` = assigned, `office` = available, `gone` = written off OR disposed,
  Damaged/Missing chips when non-empty), and every non-gone view hides off-register rows.
- **`assetOddities()` NAMES, NEVER CHANGES**: held + a stored state; written off/disposed still
  in a name; disposed not written off; a state left on a written-off asset; no purchase cost.
  There is a test that the input is byte-identical after.
- Assets → Dashboard → **How the figures add up**: the lines with count and cost, the check, and
  the oddities behind a toggle. The register's strip ends with the sum in words.
- **Not built, and asked:** approvals for buy / write-off / dispose (proposal in the doc, using
  the `approve` ability); a branch-transfer slip. Depreciation stays out on purpose.
- Two `interface.test.js` assertions pinned the old chip code and were rewritten to state the rule.

### Reminders, a raise celebrated, and the long list (v2.35.0)

Dinesh sent ~20 screenshots in one message. Highlights and the rules they hang on:

- **The office's hourly reminder** (`shared/requestReminder.js`, `RequestReminder.jsx`).
  Reads `/api/people/digest` every five minutes and pops a box for lines marked
  **`staff: true`** — the six things staff wait on the office for (attendance requests,
  their own record, uploads, declared assets, claims, helpdesk questions). A licence or an
  overdue job is the office's own business and does NOT pop. `reminderDue`: nothing waiting →
  never; never put away → now; **a line not in the last signature → now** (a new leave must not
  wait out somebody else's hour); an hour since put away → now. **One fewer is not news** —
  deciding something does not throw the box back up. Put-away time is localStorage (per desk,
  a convenience). It approves nothing; each line opens its screen, and People now honours a
  `focus` (claims / helpdesk).
- **The raise celebration** (`shared/celebration.js`, `Celebration.jsx`, `GET /api/me/celebration`).
  Only an **applied** rise, only a real rise, only within **60 days**, newest first, in
  `CELEBRATION_FIELDS` only — never the reviewer's summary or rating. Shown once per appraisal
  id per device. CSS-only confetti, still under `prefers-reduced-motion`.
- **My tasks card** on the employee dashboard reads the same `GET /desk` the tab draws, and
  changes nothing (a test refuses api.post in it). People → Tasks was removed — the desk holds
  the same `staff_tasks` rows.
- **Helpdesk on the portal** (`my/MyHelpdesk.jsx`) — the `/api/me/tickets` routes had existed
  since staff logins and nothing rendered them.
- **Claim vouchers** (`backend/src/claimVouchers.js`): files on disk under
  `DATA_DIR/claim-vouchers`, `voucher_file` stripped from every response (`has_voucher`).
- **Notices carry a time** (`joinWhen`/`whenLabel` in `shared/announcements.js`); `isLive`
  honours it on the day.
- **Issued by** on warnings/appreciations is a select: the person's reporting manager, then
  anybody somebody reports to, then the rest.
- **Joining form**: religion is `RELIGIONS` from `shared/festivals.js`; **`FORM_REQUIRES`
  (phone, phone_alt, email) is checked by the FORM only** — `createEmployee` still wants only a
  name and a company, because the spreadsheet import, hiring handover and bulk add reach it too.
  Father/mother boxes with their own mobiles (`father_phone`, `mother_phone`), present/permanent
  address groups with *same as present* mirroring, `office_email`/`office_phone` on the record.
- **Assets: description stickers** (`labelSheet(..., { as: 'patti' })`) — code, what it is,
  serial, company, no QR. **AND THE QR SHEET HAD BEEN THROWING since it moved into shared/:**
  its note called `assetLink(req, ...)`, which only exists in the route file. Every "Labels for
  N" press was a 500. Base link is now derived from the caller's `linkFor`. Tested.
- **Rent agreements and insurance policies** are `LICENSE_KINDS` on the License register,
  deliberately not a second register — "runs out on a date and has to be renewed" is exactly
  what it models. `fieldWords(kind)` renames the boxes (Landlord / Rent / Agreement ends;
  Insurer / Premium / Policy number) and hides key/seats/version; the digest gives each kind its
  own line (`renewalNoun`), "insurance policies" not "policys".
- Compaction: Time tab notes behind *how this works* (**the timing-mismatch sentence never
  folds**), the day menu shows ten everyday marks (`EVERYDAY_MARKS`) with the rest one click
  away, warranty/AMC as a table, asset figures computed from the rows shown with captions.
- Answered, not built: **Sunday approval** is the `approve` ability = Manager and Admin roles
  (Admin → Logins). People who work at another site punch from the portal (`PUNCH_ENABLED`) and
  ask for *Working out of office* (OD); the missing-out rule only acts when the machine has an
  arrival.
- Test traps: the toolbar-grouping test measured a fixed 2,000 characters; it now measures to
  the group's own `</span>`.

### No out punch is a half day (v2.34.0) — `shared/missingOut.js`

Dinesh, looking at AJEETKUMAR's 27 Nov (in 10:29, no out): *"agar punch missing he to half
day lag jaye automatic"*, and when told v2.2.0 had deliberately made it P: *"auto lagavio /
agar uske bad manually change karna he to kar denge"*. **This overturns v2.2.0's "not known
is not half a day" by his instruction**, so it is a setting (`settings.missing_out_half_day`,
on when nothing is stored, `PUT /api/leave/missing-out` behind `approve`).

- **Only the punch-machine import applies it** (`punchesToMarks({ missingOutHalfDay })`, set by
  `applyPunches` from the setting). Default `false` in the shared function, so every other
  caller — the offline file, the Excel import, the tests — keeps the old P. Phone punches and
  times typed by hand are not judged by it.
- **Never a day still running**: `dayNotFinished` is checked first, so 10:29 at 11:00 stays P.
  Minutes stay 0 (a half day is paid at half; a shortfall on top would charge twice).
- **`attendance.missing_out` is three-state, and that is what makes "change it by hand" stick.**
  1 = the rule wrote this mark; 0 = a person named a mark; null = an ordinary punch, or a row
  from before the column. The importer always names it (1 or null); any write that names a
  `code` without naming `missing_out` is a person's, and gets 0.
- **The rule may only write over a blank day or a day it wrote itself.** A person's mark, and
  every P already on the grid before this release (flag null), keeps its mark and only the
  times land — `missingOutKept` counts them. So no month already paid can move.
- **A typed departure undoes it** in `writeAttendance`: a stored rule-HF, an `out_time` arriving,
  no `code` named → back to P and the minutes **re-judged from the times** (`restoring` forces
  the judge branch even if minutes were sent, because those were judged as a half day).
- **TWO TRAPS FOUND ON THE WAY.** (1) Protecting a person's mark by stripping `code` and
  `minutes` from the import entry let `writeAttendance`'s auto-mark turn a stored **A into P**
  — `A` is in `AUTO_MARKS`. The kept entry now carries the stored code and minutes back.
  (2) The grid's `setEntry` sends the WHOLE entry, so the server's `missing_out: 1` rode back on
  every edit and a person's pick would have read as the rule's. `setEntry` drops it, and typing
  an out time onto a rule-HF sets P on the client too.
- The day menu says it in amber beside the Out box; `attendanceByEmployee` carries
  `missing_out: 1` only when set. Summary gains `missingOut` only when the rule ran, so a summary
  pinned by an old test is unchanged.

### The Task & Approval Desk (v2.33.0)

Dinesh sent two HTML files — `BookNFly_Task_Desk_Demo.html` and `Index_4_1.html`, the same
Google Apps Script web app with and without a demo shim — and said *"ye bhi add karo"*. It is
the desk his office ran on a Google Sheet: work given to somebody and talked through on one
thread; a spend or a decision sent UP for Approve / Reject / Query. `shared/taskDesk.js`,
`backend/src/desk.js`, `backend/src/routes/desk.js`, `frontend/src/components/desk/TaskDesk.jsx`.

- **IT IS BUILT ONTO `staff_tasks`, NOT BESIDE IT.** People → Tasks already held work given to
  staff, and the punch link, the person file, the digest and the single-file build all read it.
  A second task table would have been two lists by the second fix. So the table gained `stage`
  (pending / progress / waiting — a refinement of `open`; the old open / done / dropped is
  untouched and every old reader gets the answer it always got), `by_key`, `assignee_key`,
  `updated_at`, `done_at`. `employee_id` is still filled in for an employee, so the old doors
  find their tasks exactly as before. There are tests both ways: a task made in the old list is
  on the desk of the person it was for, and a task ticked off through the old route shows on
  the desk's thread (`setTaskStatus` now writes the line).
- **THERE IS NO USER LIST.** His desk had a Users sheet. Here a desk person is somebody the HRMS
  already knows: **`e:12`** an employee, **`u:3`** an office login that is not one. The key comes
  off the LOGIN (`deskMe(req.actor)`), never a URL or a body — there is a test sending `by`,
  `by_key` and `employee_id` of somebody else.
- **The same human can be an office login AND an employee**, which would put them on the desk
  twice — work given to one never seen by the other. `desk_links` ties a login to its employee
  (People & ranks, Admin only); tying **moves** everything the login had onto the employee in
  one transaction, untying does **not** move it back. One person, one office login (UNIQUE).
- **Ranks are his five plus one**: MD 1, CEO 2, GM 3, SM 4, HOD 5, and **Staff 6**, because his
  sheet listed only senior people and here every employee can sign in. `desk_ranks` holds a rank
  somebody SET; no row means it is **worked out** (`defaultLevel`: Admin login → MD, Manager →
  GM, other office logins → SM, anybody with reports → HOD, else Staff) and the screen marks it
  as a guess. So the desk works the day it is installed, not after 86 ranks are typed.
- **Who gives work to whom** (`canAssign`): yourself (a personal reminder), anybody who reports
  to you, and from HOD upward anybody at your rank or below — his rule. **What was added is the
  line his desk never needed: one member of staff cannot hand work to another**, or every one
  of 86 logins could assign to the other 85.
- **Requests go UP** (`approversFor`): anybody above, and your own manager whatever the ranks
  say — manager first. Nobody approves their own; the top has an empty list and the form says so.
- **A personal reminder is nobody else's**: off the office's flat list (`NOT_PERSONAL` in
  `listTasks`), off the Departments tally, and a 404 — not a 403 — to a manager or the MD.
- **Words are required on every update**, even one that only moves the status: "Waiting" with
  nothing said is the update that gets chased. **Putting a task back to Pending, including
  reopening a done one, is for whoever gave it** — the doer does not un-finish their own.
- **An approval is decided once, by the person it was sent to** — not by the MD, who can see
  it. A Query needs its question; the asker answering puts it back to Pending, and that is the
  only status a comment can change.
- **AN APPROVAL PAYS NOBODY.** It is a decision on record; `desk_approvals.amount` is read by
  nothing. There is an API test that an approved ₹45,000 leaves the requester's net unmoved.
  Money still reaches a payslip only through People → Claims into a named month. Said on the
  screen, the form and in help.
- **NOTHING IS SENT.** His desk emailed people and took replies by mail; this app has no channel
  (see `shared/digest.js`). So `waitingOn` — a task not picked up, a request to decide, a
  question on your request; deliberately NOT "everything open" — is the count on the office tab
  (`.desk-count`) and a line at the top of every portal page, re-asked every minute. The forms
  say "nothing is emailed" rather than promising a mail.
- **`/api/desk` is mounted behind `requireAuth` ALONE.** Every other router is the office's
  (needs `read`) or a staff login's own (`/api/me`). The desk is neither: one screen, one door,
  and what somebody sees is decided by who they are on it. Mounting it with the office routers
  would lock every employee out. The office tab has **no area** for the same reason — narrowing
  a login to Front office must not take its desk away.
- **ONE COMPONENT, BOTH SIDES.** `App.jsx` (tab `desk`, "Task desk") and `MyPage.jsx` (tab
  `desk`, "Tasks & approvals") render the same `TaskDesk.jsx`. All its classes are `.desk-*`
  with their own rules — the v2.18.0 lesson, a class that only has a rule under one wrapper.
- `PERSON_FIELDS` is the whole of what the directory carries, with a test that no salary, PAN,
  bank account or phone is on it and that 48000 appears nowhere in a staff login's payload.
- **Signed in with the shared key there is no login to name**: the desk knows them as "Office"
  (`u:0`, MD), says so in a banner, and nobody can give them work. Make a real admin login.
- Proved by putting four rules back: no `canAssign` check, personal tasks on the office list,
  anybody deciding, identity from the body — 1, 1, 1 and 3 of the 24 tests fail.
- **Found by driving it:** an avatar for "You" read **Y** (the initials came off the word, not
  the person); a textarea takes the browser's monospace unless given `font: inherit`; and seven
  views plus two buttons on one row pushed *Request approval* onto a line of its own at 1440px
  — the top bar is two rows now, views above, actions below.
- **Not built, on purpose:** email in or out; drag-and-drop on the Board (a card opens the
  thread, which is where a move needs its words anyway); the daily reminder for personal tasks.
- Needs the server. The single file says so on the tab.

### Leave without approval doubles by itself (v2.32.0)

Dinesh, having been told the double deduction was a button: *"double deduction automatic kar
do"*. `autoDoubleRule` / `applyAutoDouble` / `ensureAutoDoubleRule` in `backend/src/db.js`,
`attendance.doubled_from`, `GET`/`PUT /api/leave/auto-double`, the block at the top of
`UnapprovedLeave.jsx`. **This overturns v2.31's "a TOOL, not a setting" by his instruction** —
the tool stays for the days the rule does not cover.

- **THE RULE.** A plain `A` that is not approved — refused **or simply undecided** — becomes
  `AD`. Undecided has to count, or "automatic" would still need a click per absence; the
  office's way to say no is the Approved tick. **`UL` is doubled only when REFUSED**: an
  undecided UL is leave the office itself recorded, **and it is what the sandwich tool
  writes** — doubling it would turn a docked Sunday into two. `doubleStanding` in
  `shared/unapprovedLeave.js` is the same question in JS; the priced tool now follows it too.
- **ONE PLACE.** `setAttendance` is now a wrapper: `writeAttendance` (the old transaction)
  then `applyAutoDouble(periodId)`. Every door — grid, approval, import, festival, phone
  punch — goes through it, so the rule cannot be walked round. `buildPayroll`'s sync branch
  calls it too, which is the only thing that catches **a day typed ahead that has now
  arrived**. `sync:false` and a locked month write nothing (tested).
- **A SETTING WITH A DATE ON IT** (`settings.double_unapproved = { on, from }`). The rule
  looks only at absences dated on or after `from`; *on* with no date is not on. **Nothing
  before `from` is ever touched** — those stay on the panel's button.
- **HOW IT CAME ON, and the reason for the odd-looking shape:** `ensureAutoDoubleRule` runs
  last in `db.js`. A database that already has a month → on from that day, by "the v2.32.0
  update", because he asked for it on a running payroll and his database cannot be reached
  from here. **An empty database → off.** Flipping the default on for everybody would have
  doubled every `A` in every existing test fixture; deriving it from "is this an install
  being updated" keeps the suite honest and still does what he asked. A second call never
  moves the date.
- **`doubled_from` is what makes "automatic" safe.** It remembers the mark the rule replaced,
  so an approval restores `A` (or `UL`) on the next write — and it is the only thing that
  tells a rule-made AD from one typed by hand, which an approval must NOT undo. Cleared
  whenever the day stops being AD (the office changed the mark; that is their decision).
  Restoring runs **even with the rule switched off**: an approval is the office's statement.
- **WHAT IT WILL NOT DO**, each with a test: a day after today; a day outside the person's
  time on the staff; an inactive person with no leaving date; a locked month; and **somebody
  with no sign of being at work all month** (`AT_WORK_MARKS` or a clock-in) — held and NAMED
  on the panel. That last guard is the 34-never-enrolled people from his own machine file: a
  report writes `A` for all of them, and doubling that doubles a mistake. The day they are
  seen at work, their earlier absences double.
- **Sandwich:** `AD` joined `DEFAULT_TRIGGERS`/`LEAVE_TRIGGERS`, or switching this rule on
  would have quietly switched that finder off.
- **A sentence on the roll call was now false.** *"…saved on the day itself and change
  nobody's pay"* — the Allowed tick now decides one day or two. Rewritten, the help line with
  it, and the interface test that pinned the old wording **rewritten to state the rule**.
- Switching is `requireAbility('approve')` (Manager/Admin); reading is anybody with Leave.
  Each double and each restore is an audit line by *"the double-deduction rule"*.
- `autoDoubledReport` prices what an approval would give back with `calculateRow` both ways —
  the panel itself still imports no `calculateRow` (tested).
- Server only. The single file has no settings table and keeps the button.

**THE DEFECT THE BROWSER RUN FOUND, and it predates this release:** the attendance day menu
is ~1,500px tall on a `position: fixed` backdrop with no scroll of its own, so it was centred
with **both ends cut off**. Measured at 1440×1000: the **Allowed** button sat at 1,074px —
below the screen, unreachable — and it is the one control that undoes a double. `.picker`
now has `max-height: calc(100vh - 2rem); overflow-y: auto` (`.day-marker` already had its
own). Checked at 1440×1000, 1366×700 and 414×800 with a real click. **Playwright's
"element is outside of the viewport" on a visible, enabled button is a real bug, not a
flake** — the first instinct was to click it through `evaluate`, which would have hidden it.

Driven on existing data: restart → *"now costs double automatically, from 2026-11-27"*; an
absence today → `AD`, ₹1,000 more than single; Allowed → `A`, reason kept, ₹1,000 back; off;
on from the 1st → the two earlier absences doubled, the approved one untouched.

### The office's list of twenty (v2.31.0)

Dinesh sent twenty points in one message. Each was **inspected first**; several already
existed and were said so rather than rebuilt (item 13, employee fills own record — v1.81;
document verification — v1.72; Tidy names). What was built, and the rule each hangs on:

- **Leavers off the month** (`shared/onStaff.js` `leaverIn` / `paidAfterLeaving` /
  `leftLabel`, `strandedRows` in `db.js`). *"Exit employee still attendance and salary
  register me dikh raha he"*. The cause: a stranded row was only cleared when it had **no
  attendance at all**, and "Mark everyone Present" gives everybody attendance. Now somebody
  whose `left_on` is **before the month starts** is off it whatever is on the grid — unless
  money is typed on the row. Left **during** the month: stays, tagged `left 12 Nov`, and
  `payrollExceptions` names `paid_after_leaving` (P or blank after the last day, priced) and
  `left_no_date`. **Undated leavers stay and are named** — the app cannot guess a date.
- **Leave: manager first, then the office** (`MANAGER_FIRST_KINDS`, `managerOf` in
  `attendanceSelf.js`, `backend/src/leaveBalance.js`). The office's approve of a `pending`
  leave is **refused by name** while the person's manager *can act* (active, with an active
  login). **Nobody is stuck:** no manager, or a manager with no login → the office decides,
  and the row says which. The office may still **reject** at once (a no costs nothing).
  `MAX_LEAVE_DAYS = 7`. **One ledger sum feeds all three screens** (`withLeaveContext`):
  employee, manager, office each see left / taking / after. "Notification" is **on screen** —
  a `.team-waiting` banner on the manager's portal, a `.who-waiting` count in the office
  header, both re-asked every minute. **Nothing is sent**: there is still no channel.
- **Leave without approval costs double — a TOOL** (`shared/unapprovedLeave.js`, Leave →
  *Without approval*). Three piles: **refused** (`approved === false`) is offered;
  **undecided** (null) is *named and left alone* unless ticked — null is not a refusal;
  **approved** stays single and is counted so the office sees the rule looked. It writes the
  existing **AD** mark and only the mark, so the reason and the decision survive; priced by
  `calculateRow` (net now − net with those days at AD), never multiplied out. Skips days
  after somebody left and days that have not happened. Proof for a sudden leave **is** the
  Approved tick with a reason — no new upload was invented.
- **What an employee fills in waits for HR** (`backend/src/profileChanges.js`,
  `ProfileApprovals.jsx`). *"profile approve karne ka right HR ke paas"*. **This reversed
  v1.81's write-through** — the three API tests that pinned it were REWRITTEN to state the
  new rule. `PATCH /me/profile` now calls `proposeChanges`; the record is untouched.
  One waiting change per field (partial unique index); typing the record's own value back
  withdraws it. `applySelf` is asked against the **RECORD**, so a UAN that is only waiting
  can still be corrected. Their page shows an overlay (`waiting`, `on_record`,
  `turned_down`) so a box showing their value says it is not on the record yet. Approval
  goes through `updateEmployee` with a note naming who typed and who approved. **A
  once-only number already on the record with a different value is HELD, not overwritten.**
  Bank and phone now wait too — deliberate, since a bank account is the one worth checking.
- **Assets: Fixed / Movable** (`shared/assetNature.js`, `assets.nature`). Stored value is
  what somebody SAID and always wins; otherwise the **kind** gives a starting answer marked
  `?`; an unknown kind gets **none** ("not said" is a pile somebody can clear; a wrong guess
  is one nobody looks at again). Every asset is under exactly one of three chips. Bulk set
  writes the **ids it was shown**. It is deliberately one level above `assetGroups` —
  Desktop and Laptop are both "Computer".
- **Employee-wise assets:** the Add form has **Give it to** (createAsset already logged the
  handover), the filter bar has **Anybody's** (holders only), and the Add button becomes
  *Add an asset for X*.
- **Staff declare what they hold** (`asset_claims`, `MyAssets.jsx`, `AssetClaims.jsx`).
  **A declaration never touches the register**; match / add / dismiss does. Matching an
  asset that is out with **somebody else** is refused by name. A serial already on the
  register cannot be *added* — it is that asset. `/api/me/assets` sends `forHolder` fields
  only: no cost, vendor or invoice. **The portal never had an assets page at all** — the
  route existed since the staff login and nothing rendered it.
- **Sunday pay needs a manager's approval** (`backend/src/sundayApproval.js`,
  `sunday_approved_by/at/amount`). `approve` ability = Manager and Admin; HR prepares and
  pays. **An approval is of an AMOUNT** — computed by `buildPayroll(…, {sync:false})`; a
  changed figure makes it stale and the Paid tick is refused naming both figures. The three
  columns are **not in `PAYROLL_FIELDS`**, so the row patch cannot forge one (tested).
  Nothing already paid is touched. Standalone: no logins, so no approval step at all.
- **Appraisals** (`shared/appraisal.js`, `AppraisalSheet.jsx`): `appraisals.kind` dropdown;
  the monthly sheet scores uniform / discipline / time / attendance / target as
  **true / false / null**. `payroll_rows.target_met` is a tick, in no calculation.
  **Found by driving it:** seven hours on a Sunday read as "left early" — `PAID_BY_THE_DAY`
  marks are not judged against weekday hours.
- **Employee master:** four parent-work fields (also fillable by the employee); `hod_id`
  off the form, column kept; a name is tidied on blur.
- **Digest:** three new lines (own-record changes, unchecked documents, declared assets),
  each scoped by `may(req.actor, …)` and each opening the screen that can act.

**Answered, not built:** *which role sets the reporting manager* — none special; any office
login that can edit employees (Admin, Manager, HR; Accounts/Operator if Employees is
ticked). It is in the `roles` help topic.

**Traps met, worth remembering:**
- **A Python-inserted `import` landed INSIDE a multi-line import** (again) — "Unexpected
  reserved word" at load, no file named. Insert before the first line, not after it.
- **Vite does not catch an undefined JSX identifier.** `<ProfileApprovals>` and `STANDALONE`
  were used with no import and the build passed; only the browser would have thrown. Grep
  the import after adding a component by script.
- **`.scroll-x` has no rule** — invented class, ninth time; the portal's My assets ran 52px
  wide on a phone until it used `.table-wrap`.
- **A driver script that imports `backend/src/*.js` opens the DEFAULT `data/salary.db`** and
  migrates it. Drive through HTTP only.
- **Playwright auto-dismisses `window.confirm`**: a manager's Approve "did nothing" until
  the script accepted dialogs.
- Slicing a route out by `index('});\n')` cuts at `json({ … });` — count braces or match the
  whole handler.

### Front desk: the visitor's mobile is optional (v2.30.1)

Dinesh: *"front desk se compausory mobiel num hata do"*. `createVisitor` in
`backend/src/frontOffice.js` refused without a ten-digit number, so a courier boy or a walk-in
who would not give one left the desk stuck at the form — and the way round a required box is a
made-up number, which is worse than a blank.

- **Optional, but never wrong.** Blank is stored as `null` ("not taken"); a number that IS
  typed must still pass `isMobile`, and the refusal says *"correct it, or leave it blank"*.
  The form judges only a number that has been typed and carries no star.
- **The double sign-in check had to change with it**, because it matched on mobile + name.
  With a number it is unchanged. With none there is only the name, and two people can share
  one — so a visit with no mobile clashes only with another that ALSO has none, under the same
  name **from the same company**. That still catches a second press of the button (the
  identical form), while another Ramesh from another courier signs in normally. There is no
  "add anyway" on this screen, so a name-only match would have had no way round it.
- The test titled *"a visitor needs a name, a purpose and a real mobile number"* was
  **rewritten to state the new rule**, not patched.
- **Harness note:** the sign-in button is **Add visitor**; a `/Sign in|Register/` locator
  resolved to *Print the register* and waited thirty seconds on a disabled button.

### Sunday working reaches the Sunday register by itself (v2.30.0)

HR Manager, forwarded by Dinesh off the live Sunday tab: *"ama sunday present show nathi
thatu / count alag thi nathi krtu"*, and the day before, with a crop of Month hrs / OT min /
OT ₹: *"ye salary sheet me se hi remove nai kr skte ?"*.

**Root cause, found by reading the import rather than the register: nothing but a person ever
wrote `SP`.** `punchesToMarks` has no idea what a weekly off is, so a punch on a blank Sunday
was written `P` — or **`HF`, which docks half a day from somebody who came in on their day
off** — and a Sunday already marked `S` kept its `S`, because `protectDecided` lets a punch
set only blank/P/A/HF. The Sunday register lists `SP`/`HP` only. With the readers feeding the
grid, nobody reached it.

- **`shared/sundayDuty.js` holds the one rule**, by Dinesh's own line (*"Sunday ki full day ki
  salary lene k liye minimum 6 hours complete karne he"*): on the person's OWN weekly off
  (`ownWeeklyOff` — their policy, else the company's, else Sunday), six hours done → `SP`;
  under six, or no out time → `S` with the times kept, **minutes always 0**.
  `OFF_DAY_MAY_BECOME = {'', P, A, HF, S}`. **`S` has to be in it** or the rule cannot work on
  a live feed: the first punch of a Sunday arrives with no departure and is written `S`, and
  the evening's pull must be able to lift that to `SP`. `SP`/`HP`/`PH`/leave are never touched.
- **Four write paths ask it, with a test naming each**: `applyPunches` (`settleOffDays`, run
  BEFORE `protectDecided`, whose `stored` lookup answers `''` for exactly the keys it settled),
  `setAttendance`'s auto-mark branch (a phone punch, an approved missing punch),
  `localStore.js`, and the Time tab's `queueSave`. **A mark the caller NAMES is still the
  caller's** — the grid and the Sunday tab's own buttons are decisions.
- The import's dry run says it in one sentence (`offDaySentence`, read by both panels), and
  the summary's present/half-day/short/over counts are corrected for those days — a dry run
  reporting half days it will not write cannot be checked against the grid.
- **The office's "no" is the Amount on the register (type 0)**, not marking the day `S` again:
  with the pull on a timer, the same punches would lift it straight back. Said in help.
- **A fix to the write path never reaches back**, so the Sunday tab offers what is already on
  the grid: `offDaysNotOnRegister` in three piles (six hours done / under / not known),
  priced with `priceOffDays` — **off `calculateRow`, never multiplied out**.
- **THE TRAP THE BROWSER RUN FOUND: times on a day are not proof anybody was there.** The
  seeded month had "Fill the usual timings" pressed on two Sundays — 09:30–18:30 for the whole
  office — and the first version listed every one as "9h, done" and offered them all in one
  press. His own live data very likely has this (v1.91's screenshot: 86 of 86 Present on a
  Sunday, 774h = 86 × 9h). So a line carries `clocked`: with the month's punch record
  (`GET /punches/month`, one request) a day is clocked only if **a punch is on record**;
  without one (the single file) times **exactly equal to the person's usual in and out** are
  a fill. Unclocked lines are listed as *typed* and **never offered in bulk** — "count it" by
  name only. Nothing is offered until the punch record has answered.
- **`fillStandard` on the Time tab now skips a person's own day off** (unless already SP/HP):
  nine hours of usual timings on a Sunday would otherwise put the whole office on the register.
- **The confirmation explained the wrong thing at first.** P→SP moved the month's net by +473
  and the message blamed "days marked half day or absent" — none were. The real reason was the
  month's hours rule: a `P` Sunday is a working day that owes nine hours, a day off owes none.
  `netLine` now says which of the two it is.
- A banner only while there is something to DO; short Sundays already resting as `S` are a
  quiet line, because a warning that never clears stops being read.
- **Found on the way:** `sundayDutyFor` called `readTimes(times)` with no `deductLunch`, so on
  a month whose break is inside the paid day a Sunday of exactly six hours read as short. The
  same miss as the Time tab (v2.0.0) and the dashboard (v2.9.0) — **fourth screen**.
- **`periods.sunday_hours` IS NOT A COLUMN.** `sundayHoursFor` reads it off the period object
  and falls back to 6, and the earlier note here saying it is "held per period" was wrong —
  selecting it in `setAttendance` was a 500 on every attendance write, caught by the first
  API test. If the line ever needs to be configurable, it needs a migration first.
- Two tests encoded the old world and were **rewritten to state the rule**:
  `attendanceWrites` used days 20–22 as "three working days" and the 22nd of November 2026 is
  a Sunday; and "a locked month offers no decision" now exempts the one view-only button.

**The Hours columns can be hidden** (`hideHours` in `SalarySheet.jsx`, a tick beside Compact,
remembered in localStorage inside try/catch). One class on that one table
(`table.sheet.hide-hours .hrs-col`) — the ten cells stay in the DOM so no column moves, and
the Excel, the print and the payslip are untouched. **Hiding a column must not hide money:**
`hoursMoney(calcs)` reads `ot_salary` off every row — it has to, because `hoursDecision` only
counts money where the month's RULE charges, and a figure typed into OT min on a days-only
month is money too — and the line above the sheet names it with the shared `chargedPhrase`.
A month whose rule charges **keeps its bar**, since that bar holds the button to stop.
Driven: 28 columns → 25, net 3,82,646 both ways, still hidden after a reload.

**What HR's first question was really about** (*"ot min ot kyu aarha hai wo salary me + bhi ho
rha hai"*): their November is still on `monthly_late`, so overtime IS paid. Hiding the columns
does not change that; pressing **Only show them, don't charge** on the bar does (v2.27.0).

### People who have left were listed as absent (v2.29.0) — `shared/onStaff.js`

Dinesh, off the live roll call with seventeen names under Absent where HR's own WhatsApp
message listed ten: *"isme left wale bhi aa rahe he absent me"*.

**The cause, found by reading rather than guessing:** `listPayrollRows` has carried
`joined_on`, `left_on` and `active` on every row all along, and **the roll call never read any
of them.** Somebody who leaves mid-month stays on that month's payroll deliberately — they are
owed for the part they worked, so `syncPayrollRows` keeps a touched row — and so was listed as
absent every morning for the rest of the month. The absent count and the attendance % were
wrong with them, and HR had been deleting the names by hand before posting the daily message.

- **`onStaffThatDay(person, { year, month, day })` is the one rule**, read by the roll call,
  the day-by-day trend and `shared/dailyReport.js`. Three rules in order: before `joined_on`
  they are not on the staff yet; **after `left_on` they are gone, and the last working day
  itself is still a working day**; a leaving date in the future (serving notice) changes
  nothing until it passes.
- **Marked as left with NO date** (`active = 0`, no `left_on`) is the awkward case and is very
  likely the one on his live data. *"Gone, date not known"* must not read as absent every day,
  and must not erase the days they demonstrably worked. So they are on the roll up to
  **`lastSeenDay`** — the last day carrying `ON_STAFF_EVIDENCE` (at work in any form, or leave
  that was theirs to take) or a clock-in — and off it after. **It is an inference and says
  so**: `why` reads *"left, no leaving date on record"* and the line under the table asks for
  the date. An absence, the weekly off and a paid holiday are **not** evidence: the absence is
  the thing in question, and S/PH are filled across the whole grid in one press.
- **Only an explicit `active` of 0/false counts.** A row with no `active` field at all is not
  somebody who left — every old fixture is one of those.
- **IT DECIDES WHO IS LISTED, NEVER WHAT ANYBODY IS PAID.** Nothing in it is an input to
  `calculateRow`, and there is a test that `calc.js` does not import it. Whatever is marked on
  a leaver's days still prices their last month exactly as before — **an absence marked after
  the leaving date still comes off, which is how a part month comes out right**, so those marks
  must not be "tidied up".
- **`roll.gone` is kept and SAID**, not dropped: a line under the table names who the day left
  out and why. A list that quietly got shorter reads as people going missing.
- `out.people` is now `rows.length - out.gone.length`. The test that pinned
  `out.people = rows.length` — precisely the bug — was **rewritten to state the rule**: the
  skip happens BEFORE the if/else chain, so buckets + gone still add up by construction.
- **Found on the way:** the daily message's present list was `P/WH/SP/HP`, so somebody on
  **OD** or the new **DD** was in no line of it at all. Both count as present now.
- Driven in a browser: Absent **3 → 1**, the genuine absentee still listed, both leavers named
  in the line under the table, **no net figure moved**, and the daily message carried neither.
- **Harness notes:** `GET /people/daily-report` takes `?day=` as an **ISO date**; `?day=25`
  is a 500 ("Invalid time value"), which is a wart worth a 400 some day. The roll call's chips
  are `.roll-chips .chip` and its table is `table.roll-table`.
- **Not changed, and worth knowing:** month-level figures (days lost on the absent/present
  report, the muster) still count those marks, because they mirror the pay.

### Three kinds of people the office fence does not fit (v2.28.0)

Dinesh: *"Kuch log work from home karte he / Kuch log out of office se kam karte he / Kuch log
24 hours ofc me rehte he / Unki punching kese hogi"*. **Inspected before answering, and the
honest state was one done, one half, one missing.**

- **Work from home: already whole.** `WH`, the `remote` request kind, fence exempt, paid in
  full, no uniform question, never judged late.
- **Out of office: HALF.** The `OD` mark existed, `REMOTE_MARKS` already carried **both** WH
  and OD (the note in this file saying `{WH}` only was stale), and `officialDuty.test.js`
  covered the pay, the fence and the uniform. What was missing is the same half WH had been
  missing: **nobody could ASK.** A field day happened only if the office typed it, so until
  they did, the punch from a client's office sat on the things-to-check list — which is how a
  list of things to check stops being read.
- **24 hours in the office: missing, and not expressible.** `MAX_DAY_MINUTES` is 16 hours, so
  a longer shift is treated as a typo and falls back to the month's day; `shiftLength` returns
  null for `09:00 → 09:00`. The day went down as `P`, which owes nine hours that the clock
  cannot measure on somebody who never leaves.

**Asked which way the 24-hour people should be paid, Dinesh left it open** ("no preference"),
so the safest reading was taken and stated to him: **one full day, hours not read, and NO
automatic overtime.** 24 hours against a nine-hour day is fifteen hours of overtime every
single day — near-double pay nobody decided. Paying more is the Add box or their own OT min
cell, with the figure in front of you. Same family as *an unreturned asset is named, never
deducted*.

- **`official_duty` request kind** — the mirror of `remote`: `needs: 'none'`, `writes: 'OD'`
  on the KIND, `span: true`. So a stale form carrying `code: 'A'` still marks OD and **cannot
  write an absence** (tested end to end through the real punch-link and decide routes), and a
  three-day trip is one request and one decision. **Kept apart from WH on purpose** — both are
  paid in full, but a day at a client's office is not a day at home.
- **`DD` "24-hour duty"**, the fifteenth mark: `absent: 0, paid: true`, so it is worth exactly
  what `P` is worth. Verified over a whole month: gross, net, PT, absent days, present days and
  final payable all identical to a `P` month.
- **`HOURS_NOT_READ` in `shared/timesheet.js` is a SECOND set beside `PAID_BY_THE_DAY`, and
  that is deliberate: the reason differs and the reason is the point.** `PAID_BY_THE_DAY`
  (S/SP/HP/PH) is paid off the Sunday register, so reading the clock as well pays twice. `DD`
  is paid by the monthly salary like a present day; what is wrong there is that the clock
  cannot describe the day at all. Measured on a real 15-hour day: marked `P` it pays **₹1,278**
  of overtime, marked `DD` it pays nothing — and the clock times stay on the record.
- Everything else falls out of **not** adding it: not in `HOURS_EXPECTED` (adds nothing to the
  monthly target either way), not in `FULL_DAY_MARKS` (never late or early), not in
  `WORKED_MARKS` (never chased on Missing punch, where one punch and no departure would fire
  every morning), not in `PUNCH_MAY_SET`/`AUTO_MARKS` (a reader cannot turn a chosen duty back
  into a plain `P`). A test asserts the invariant that **any mark whose clock is not read must
  also not be judged late**, so a sixteenth mark cannot land half-wired.
- **The guard that caught it working:** `gridColumns.test.js` — *"a new one fails here until it
  has a column"* — failed on the first run, exactly as designed, because `DD` was counted in no
  column on the grid.
- **A real drift found on the way:** the **Present** column was summed BY HAND in two places —
  the grid row and the printed muster — so a fifth mark had to be remembered twice. That is
  precisely how v2.24.0's paid-leave figure came to differ between two screens while a comment
  promised it could not. `daysPresent(counts)` in `shared/calc.js` is now the one answer and
  both read it; the old `interface.test.js` assertion pinned the hand-written sum and was
  **rewritten to state the rule** rather than patched.
- Help: `work-from-home` was **amended and widened** to cover both kinds rather than growing a
  second near-duplicate topic (the v1.81 call), findable on `out of office`, `client visit`,
  `bahar se kaam`, `official duty`. `round-the-clock` is genuinely a different question (a mark
  the office types, about pay and the clock) and is its own topic, findable on `24 hours`,
  `guard`, `raat bhar`, `office me rehte`, `night duty`, carrying the no-automatic-overtime
  note.
- **Harness note:** the attendance write route is **`POST /periods/:id/attendance`**, not PUT —
  a PUT returned something non-fatal and wrote nothing, so a first run reported a 15-hour day
  as 0 minutes under BOTH marks and looked like a pass. Check the status, not just the shape.

### The hours bar was netting what it deducts against what it pays (v2.27.0)

Dinesh, off his live v2.26.0 sheet: *"5 lac wala solve nahi hua"* and *"ot wala minus amount
abhi bhi salary me se less ho raaha he"* — both reported for the SECOND time.

**Both buttons were driven on a reproduction of his exact state before anything was theorised**,
because a complaint repeated twice means either the button is not being pressed or it does not
work. **Both work.** "Use the record's figure on it" put 50,000 onto the row (gross recomputed,
bar gone); "Only show them, don't charge" switched the month to `none` and took every `ot_salary`
to 0. So the answer to both complaints is that the buttons were not pressed — and that is by
design, recorded here: *the app cannot tell a mistyped salary from a month meant to pay something
else, so there is no rule and none was written.*

**THE REAL DEFECT THE SECOND COMPLAINT EXPOSED.** `hoursDecision`'s `chargedAmount` summed
`ot_salary` across everybody, so the bar printed **one netted figure** — on his November
*"₹1,251 across 60 people"*. That is ASHOK MISHRA at **+13,237** of overtime paid cancelling
against AJEETKUMAR at **−3,192** of hours charged. **The deduction he was asking about was
invisible on the very line that exists to report it**, and ₹1,251 reads as trivial.

- `chargedDeducted` / `chargedPaid` (with their own people counts) are now reported **apart**,
  `chargedAmount` kept as the net because that is what the sheet's own OT column adds up to. The
  module already held *"SHORT AND OVER ARE TWO DECISIONS, NOT ONE"* for the buttons — the same
  is true of the figure describing them.
- **`chargedPhrase(decision, money)` is one phrase read by the bar AND by the confirmation.**
  Written out twice they would drift, and the one that drifted would be the one somebody presses.
  The formatter is injected so the shared module stays free of a currency.
- **The confirmation now names what pressing it COSTS.** It stops both sides, so anybody on
  overtime loses theirs — with the amount, before the press. And it says what to do next: after
  the switch the same bar offers **Pay the overtime**, so the short hours can stop being deducted
  while the overtime is still paid. **Driven end to end: switch off → nobody deducted → one press
  → +3,343 back and still nobody deducted.** That path already existed and nothing said so.
- **NO FIGURE MOVED.** This is only what the screen says about figures it was already showing;
  the suite went 2394 → **2401 passing**, nothing under `calc.js` touched.
- `inRupees` is a module-level helper in `SalarySheet.jsx` because **`money` in that file is the
  month's own totals, not a formatter** — the first patch passed it as one.
- **A test pinned the confirmation's WORDING and failed on a rewrite that said it better.**
  Rewritten to state the rule (both sides named, with their amounts, from the shared phrase),
  not patched — the v2.12.0 lesson. Proved by putting both halves of the bug back: 2 of 7 fail
  on the wording, 3 of 7 on the module.
- Help: `salary-sheet`'s note now says **if a figure on the sheet looks wrong, the answer is
  usually a bar at the top, and neither bar changes anything until its button is pressed**, with
  `5 lac` and `record se alag` among its keywords; `monthly-hours` gained the two-sides line and
  the keep-the-overtime recipe, findable on `ot minus`, `ot kat raha`, `minus amount`.

### The Employees tab audited, and a flag nobody could clear (v2.26.0)

Dinesh: *"employees tab ka bhi check karo"*, and mid-audit *"employee id nikal do na"* with a
crop of the roll call.

**The list itself is right, and that is now measured.** Every figure on the staff table —
name, company, designation, punch ID, shift in and out, department, religion, born, joined,
left, salary, PF, ESI, payment mode — matched one by one against the record behind it:
**285 cells, no mismatch.** Search narrows to one and clears back to nineteen; the leaver is
off the list and behind *Past employees*; the **name column stays pinned** at `left: 0` with
the last column still reachable when the 1,991px table is scrolled fully right; the Punch ID
panel opens unfolded (v1.89.0 holding); no console error anywhere; no sideways page scroll.

### THE DEFECT: `bank?` on everybody paid in cash

The list flagged anybody with no account number — `!emp.bank_account`, unconditional. The
joining checklist beside it **deliberately skips the bank step for cash**, with its own
comment: *"Cash in hand needs no bank details, and saying otherwise is noise."* So the two
screens said different things about the same person, and **the flag could never be cleared**:
a cash employee would wear it for ever. Reproduced by setting one to Cash — the checklist
reported the bank step `skipped: true, done: true` while the pill stayed on the row.

`paidInCash` and `bankDetailsMissing` are exported from `shared/onboarding.js` and both
screens read them, so they cannot drift again. Somebody paid by transfer with no account is
still flagged, and so is somebody with no payment mode chosen yet — a transfer is still the
assumption until it is not. Driven after the change: the cash row clean, the eighteen on
transfer still marked.

### The employee code under every name

The roll call printed `BNF-EMP-0048` under each name. It is on the cell's **title** instead —
one hover away rather than gone — and the row went **32px → 26px**, which is the v2.22.0
compaction continuing for free.

**The test pins both**, with the first one stated as the rule rather than the fix: a cash
employee is never missing bank details, a transfer with no account is, the checklist and the
list agree on the same record, and the roll call's name cell carries no code line while its
title still does. Proved by putting both bugs back: 2 of 5 fail.

**Harness notes.** `.tab-body` does not exist in this app — an earlier sweep only worked
because it fell back to `document.body`; the employee table is found by its own `NAME`
header. `p.evaluate(fn, null, 1)` is "too many arguments", not a JSON.stringify indent. And a
sensitive-column sweep reported `pan` on the table: **COM-PAN-Y** matched it, which is the
substring trap and not a leak — there is no PAN column there.

### The Reports tab audited — four reports that were all the same one (v2.25.0)

Dinesh: *"reports tab ka bhi check karo"*. Every entry opened in a real browser, every money
figure matched against a separate calculation of the same month.

**69 reports, every one opens, zero console errors.** The `partial` and `planned` ones say so
on their own page rather than rendering an empty table; the ones that are a pointer say which
tab to open; the file-only ones offer their download. The money reports agree with the salary
sheet to the rupee: company summary gross 3,81,067 / net 3,65,117 / PT 2,600 / PF 12,600 /
ESI 750 / Sunday 18,173, and **Salary deductions balances** — earned 3,82,067 − deducted
16,950 = net 3,65,117, with the Deduct box added back exactly as `earnedOf` intends.

### THE DEFECT: four statutory reports, one register

`pf-register`, `esi-register`, `pt-register` and `wage-register` are four entries in the tree
and **every one of them rendered `<Statutory period={period} />`**, whose own tab state starts
at `pf`. So all four opened on Provident Fund. The tabs across the top of the panel do move
between the registers, which is exactly why it read as working.

**Why it was not merely untidy.** The PF register deliberately carries only the people PF is
deducted for — on the audited month, **seven names out of twenty**. So opening the **wage
register** showed seven people with nothing on the page saying thirteen were missing, and a
wage register that understates the wages actually paid is the one thing it exists not to do.
The panel's own Download follows the same tab, so pressing it on that screen handed over the
PF CSV under the wage register's name.

`show` is now passed per report. It is an **effect, not just initial state**: React keeps the
component mounted when the report id changes — the element type is the same — so the state
would survive from the last register opened. Proved by driving PF then Wage: it lands on Wage.
Verified on screen: PF 7 rows, ESI 5, PT 1 line per company, **Wage register 20**.

### And the same shape one category over

**"Active employee list" handed over the leavers.** It fetched the same unfiltered
`/employees.csv` as "Employee master register" — the route has taken `?active=` all along and
nothing was asking it to. Both also saved as `Employees.csv`, so taking both left the second
as `Employees (1).csv` with nothing on the name to tell them apart. Driven: one employee
marked as left, the active list came back **19 rows, no leaver, `Active-employees.csv`**.

**Checked and deliberately left alone**, because the name is honest for each: `bank-register`
and `unpaid-salary` share `bank.csv`, and that file *does* drop a row marked paid (proved by
marking one — 20 → 19), so the unpaid report is right and the bank one is the `partial` with
a note already saying what it lacks; `sunday-register` / `sunday-holiday-pay` are the same
register by design; `attendance-register` / `attendance-percent` are one table whose last
column is the percentage. **Reported rather than changed**, since nobody asked and each
reading is defensible: `leave-month` / `leave-lop` show the whole leave register (the LWP
column is on it, but the report named LOP does not narrow to LOP), and `cost-company` is the
payroll summary with no employer PF/ESI while `cost-department` beside it has both an
employer column and a cost-to-company one.

**The test pins the rule, not the fix.** `backend/test/statutoryPanels.test.js` builds the
expected mapping from the panel's **own `TABS` list**, so a fifth register offered with no
report to open it — or a report pointing at a tab that does not exist — fails there rather
than silently landing somebody on Provident Fund. It also asserts the fallback guard is on
both the initial state and the effect, and, in `shared/statutory.js`, that the wage register
carries everybody while the PF register does not — which is the arithmetic the whole thing
turned on. Proved by putting both bugs back: 1 of 7 and then 2 of 9 fail.

**Harness notes, both mine.** A sweep of `button` elements clicked the nav rail first and
navigated out of Reports, reporting thirteen reports as "vanished" — scope a sweep to the
panel it is about. The tree is `<details>` per category, so only the open category's reports
are in the DOM; setting `.open = true` on each is how all 69 were reached. And a Python
`str.replace` whose target had already been changed by an earlier replace in the same script
**does nothing and says nothing** — `KNOWN` never got inserted and the panel threw
*"KNOWN is not defined"* in the browser, not at build time.

### The attendance tab audited, and the days its own row did not count (v2.24.0)

Dinesh: *"attendance tab ka bhi check karo"*. Same method as the salary sheet — the grid
scraped out of a real browser and every summary column matched against an independent count
off the API's own marks.

**Most of it is right, and that is now measured.** 200 column figures across 20 people, zero
mismatches on P / Absent / WO / LWP / HD / Sun / Hours / Minutes. **Mark everyone Present**
said *"The 6 days after today are left blank — they have not happened yet"* and left every
existing mark alone, writing S on the Sundays (v1.91.0 holding). The **name AND code columns
stay pinned** with `gapToCode: 0` when the 2,214px table is scrolled fully right, and the
last column is reachable. The **Sunday header is opaque** (v1.97.0 holding). The legend fold
is 91px with the key spelled out before the fold (v2.13.0 holding). Clicking a date header
opens the day marker. The Hours / ± minutes / Nothing toggle is right on both a 9h day
(nothing, correctly) and a 10h30m one (+90 / 10h 30m). No console error anywhere, whole tab
1,255px.

### THE DEFECT: three marks were counted in NOTHING

The row's month figures are P, Absent, WO, PL, LWP, HD, Sun. **CL, SL and PH fell through
every one of them.** On real data: fifteen days marked, fourteen accounted for, and nothing
on the row saying where the fifteenth went. P is days present, Absent is days of salary lost,
WO is the weekly off, LWP is unpaid — a casual leave day is none of those. And his festival
panel writes **PH** for exactly the staff a festival covers, so every Diwali and Eid landed on
the grid and showed up in none of its figures.

**And the PL column meant two different things on two screens.** The salary sheet renders
`PL + CL + SL` with a tooltip saying so; the grid rendered `counts.PL`. One person with a
casual leave day and a privilege leave day read **2** on one screen and **1** on the other.
The grid's own comment promised they could not disagree *"because both read the same
`countMarks`"* — and they did. **What differed was the SUM, written out twice.** It is
`paidLeaveDays` in `shared/calc.js` now and both screens call it; a HOL column counts PH.

**The printed muster had a THIRD set of columns**, and it is the one that gets signed. Its
`P` left out **OD**, so somebody away on the company's business was present on screen and
nowhere on the paper; and its single `Leave` column added **UL** in with the paid codes,
hiding the only one of them that costs a day's pay. It is the grid's ten columns now,
rendered to PDF and read back: 42 columns fit A4 landscape at 1,200px with no overflow, day
columns 27px, and the values match the grid row for row.

**No figure moved.** These are counts of marks already on the grid; what a month pays comes
from the marks themselves through `calculateRow`, which is untouched. Verified after the
change: 200 figures, 0 mismatches, and every row now adds up — day columns summing to exactly
the days marked.

**The test is the invariant, not the fix.** `backend/test/gridColumns.test.js` declares which
column counts each mark and asserts **every key of `ATTENDANCE_CODES` has one** — so a
fifteenth mark fails here until somebody decides where it goes — plus that the map names no
code that has been removed, that both screens call the one sum and neither adds the leave
codes up by hand (comments stripped), and that the grid really renders each column in the map.
Proved by putting both bugs back: 3 of 8 fail.

**Two harness notes.** A `.tab-body > *` sweep reported the tab as one block and missed the
Sunday working and Paid holidays folds entirely — they were there, as a print-media render
showed. And `printReport` mounts into **`#print-root` in the same page**, not a popup, so
waiting on `context.on('page')` times out; measure it by hiding the app and showing that div.

### The salary sheet audited, and the date the whole app was writing (v2.23.0)

Dinesh: *"salary sheet tab ka bhi check karo sab theek he ya nahi"*. Audited by
**recomputing independently and comparing**, not by looking: a varied month seeded over
twenty people (seven salary levels, PF/ESI, additions, deductions, 280 marks across
A/HF/CL/PL/UL/SP/AD and clock times), then every rendered cell scraped out of a real browser
and matched against `calculateRow` run separately in Node.

**The arithmetic is sound and that is now measured, not asserted.** 273 cells, zero
mismatches; every row balances `earned − deductions = net` to the rupee; the footer equals
the sum of the rendered rows in all twelve money columns and tracks a typed cell live (a
−300 in OT min moved gross, net and the footer by exactly ₹556 = 300 × the person's own
minute rate). PT is the sheet's own `IF(gross>12000,200,0)` — strictly greater, charged on
the gross after Add/Deduct. Monthly summary and Payment tracking agree with the sheet. The
drift bar and the hours bar both read correctly. At 1280px the 38-column table is 1884px in
a frame that really scrolls, with the name column sticky, so a net is never read without a
name beside it. No console error on any sub-tab.

**Four "findings" were my own harness, and each is worth remembering:**
`calculateRow(row, period, attendance)` takes three **positional** arguments — passing
`{ period, attendance }` as one object silently computed every row at 26 present / 0 absent
and produced 104 false mismatches. The `PL` column is **CL+SL+PL** by design (it says so in
the header's own tooltip). `OT ₹` is an `EditableCell` whose computed figure is the
**placeholder**, so reading `input.value` shows blank on a cell plainly displaying −556. And
the review API's exception carries `name`/`detail`/`amount`, not `employee_name`/`message`.
**Read the shape before reporting a disagreement.**

### THE ONE REAL DEFECT — `shared/today.js`

`new Date().toISOString().slice(0, 10)` is the **UTC** date. IST is 5½ hours ahead, so from
midnight to 05:30 it returns **yesterday** — and that expression was written out in
**seventy-two places** across the server, the dashboard and the offline build, as the
default for every date nobody is shown.

- **The one the audit found:** marking a salary row **paid** stamps `payment_date` silently.
  At 00:30 on 1 December a November salary was stamped **30 November** — the wrong month,
  which is the one a reconciliation reads. The comment beside it said the date "can be typed
  over"; **nobody types over a date they were never shown.**
- The same shape on a penalty's told-on date, a claim's spent-on date, an appraisal, an asset
  handover, a document's verified-on date, an acknowledgement, a leave credit, a new joiner's
  joining date, an invitation's expiry.
- **The app was already showing the LOCAL date**, through `todayLong()` — so the header said
  24 November while everything it wrote said the 23rd. One day, two answers, which is exactly
  what made it invisible.
- **NO FIGURE MOVED.** Nothing in the calculation reads a date like this, and `monthForAuto`
  already took the month off `getMonth()`/`getFullYear()`, so the scheduled punch pull could
  never write into the wrong month — that was checked first, because it was the one that could
  have cost a day's pay.

`todayIso` / `isoOf` / `isoPlusDays` are now the one answer, read by the server, the browser
and the single-file build — the same reasoning as `localStamp` and `shiftTimesFor`. **A hole
in the new helper was caught by its own test:** `new Date(null)` is the epoch, so `isoOf(null)`
returned `1970-01-01` — a missing date reading as a real one, which on a record is worse than
a blank.

**Four UTC sites were deliberately NOT changed, each for its own reason**, and that
discrimination is the point: `digest.js`'s `shift()` and the daily report's `prevIso` are
pure UTC calendar arithmetic on a given y/m/d (`Date.UTC` in, `getUTC*` out — self-consistent);
`attendanceSelf.js` keys `punch_events.day` in UTC **on purpose** since v2.19.0, where the
readers compensate with `localStamp`, and making new rows local would put two conventions in
one column; and for an IST night shift a 01:00 punch landing on the previous day's row is
arguably right. **A date read out of a spreadsheet is also left alone** —
`assetImport.js`, `employeeSheet.js` and `monthlyStatus.js` turn an Excel serial into a Date
at UTC midnight and render it the same way, so reading them as local would move every
imported date back a day. The test names those three and **asserts they still need their
exemption**, so the list cannot go stale silently.

**`backend/test/localDate.test.js` runs under `TZ=Asia/Kolkata` and asserts the zone first** —
in UTC the two answers are the same string, which is also why the whole suite stayed green
through a 72-site change and why that greenness is the proof of safety rather than of
correctness. It sweeps every file under `frontend/src`, `backend/src` and `shared` and refuses
the pattern, building the regex from parts so the sweep cannot match itself. Proved by putting
the bug back: 2 of 9 fail and the failure names the file. Driven end to end in a browser with
the clock faked to 00:30 IST on 1 December — the stored `payment_date` came back **2026-12-01**.

**Two process notes:** inserting an import mechanically into 46 files put it **inside** a
multi-line import in three of them, whose closing `} from` sat past the eightieth line — the
error is *"Unexpected reserved word"* at module load, with no file named. And checking those
files with `node --check` from the wrong directory reported *"SYNTAX FAIL"* on twenty-five
perfectly good files, because the paths did not exist; the honest check was loading each
module.

### The salary the month pays, the hours it charges, a shorter roll call (v2.22.0)

Three messages off his live screens. `shared/salaryDrift.js` is new.

**1. *"5 lac salary showing / 50 dala he"* — the record said 50,000, the sheet paid 5,00,000.**
**Not a ×10 bug:** `payroll_rows.salary` is taken from the record when the row is first made,
and `syncPayrollRows`'s `bumpSalary` only fills it in `WHERE salary = 0`. So a salary mistyped,
then corrected on the record, never reaches a month that already holds the row — by design,
because a month that has been run must not move when somebody edits a master later, and
because the office does sometimes mean a month to pay something else.
**The app cannot tell those two apart, so there is no rule here and none was written.** The
sheet names the difference with both figures and the worst one read back in the confirmation,
and the office presses it. Same answer as the ✎ typed-over cell, the asset that is "not
checked" rather than missing, the punch day that is "not known" rather than absent.

**2. *"ot plus mins net me count ho raha he / o sirf dikhna chahiye / katna he to o manually
add hoga"*.** His November was opened before `POLICY.none` existed, so it runs on
`monthly_late` and the hours really are in the net — which `calc.js` confirms
(`daysOnlyMode ? 0`), and his own screenshot proves, because **OT MIN equals MONTH HRS on
every row**. What was wrong is that the bar offered to *"Deduct the short hours — 38 people,
₹24,307"* on a month where they were **already deducted**. `hoursDecision` now takes the
period, reports `charging` and `chargedAmount` (read off `ot_salary`, the payslip's own
figure), states it, offers **Only show them, don't charge** (`late_policy: 'none'`, naming
BOTH sides), and **hides the two bulk buttons**, which belong to the other rule.

**3. *"isko compct karo"* — the roll call.** Measured at 1420x1100 first: rows **65px**, so ten
people filled the screen and thirty-three took four pages.
**The cause was not the content:** every cell measured 52–65px with nothing inside taller than
22. `table.sheet.roll-table td` is `white-space: normal` so What and Why can hold a sentence —
which also let **"BOOKNFLY PRIVATE LIMITED" wrap onto three lines**, and a table row is as tall
as its tallest cell. Company and Department get `.one-line` with the full text on the title;
the name column went to 13.5rem because at 160px against a name needing 159 ALIFAYA
CHIKHALIWALA wrapped and that row alone stood 48 against 32 (**the v2.5.1 lesson again**).
**65px → 32px**, and `PER_PAGE` 10 → 15 because ten compact rows use a third of the screen.
Checked at 1420 and 390: no sideways scroll, and the only clipped cell is Company, deliberately.

- Two tests pinned old shapes and were **rewritten, not loosened**: `hoursDecision(calcs)` now
  takes the period, and `PER_PAGE = 10`.
- `.drift-bar` was checked for a rule before it was used, not after.

### Quick stats opens its list, and overtime finally has one (v2.21.0)

Dinesh: *"early going bhi check karo"*, then, with a crop of the Quick stats card,
*"ye open karne se hali inki list mile esa karo"*.

**Early going was already right after v2.20.0** and was checked rather than asserted: three
people on one day — HARISH on the office day leaving 17:00, KIRAN on his own 14:00–23:00
leaving 21:00, ALIFAYA on overtime to 20:00. *Early leaving 2* gave exactly the first two,
KIRAN at **2h early against his own finish** (against the office 18:30 he would not have been
early at all, so his presence on that list IS the proof the shift is honoured).

- **Every Quick stats row now opens its list.** They called `onGo('time')` /
  `onGo('attendance')` — which leaves the dashboard for a tab with **no filter on it**, where
  the people behind the figure are not shown at all. A figure with a chevron on it has to lead
  to its names. `openRoll(key)` sets the roll call's existing chip and scrolls it into view,
  **inside a `requestAnimationFrame`** so the scroll measures the page after the chip applied.
  No second idea of what "the late list" is.
- **`roll.overtime` had been counted since this page was built and put on NO list** —
  *"Overtime 3"* with nowhere saying which three, the one figure on the card with nothing
  behind it. It is a `note(..., 'overtime')` at rank 4 and a chip beside Short hours now.
- **The footnote stated one office day for everybody** — *"early before 18:30"* printed under
  a table listing somebody judged against 23:00, which is exactly what made a shift look as if
  it did nothing. `out.ownShift` counts them and the line says so, **only when there are any**.
- Tests pin all three, with the Quick stats one **proved by putting `onGo('time')` back**.
- **Test slice trap:** `dash.indexOf('roll-call')` found `openRoll`'s own `querySelector`
  hundreds of lines ABOVE the card, so the slice was backwards and empty and the assertion
  failed against correct code. The end of a slice is searched from the start of the slice.

## A shift of their own, on the screens as well as the payslip (v2.20.0)

HR, through Dinesh, with the Employees screen showing the shift column filled in: *"shift
time add kiya, phir bhi jo late ka hai wo time proper show nhi kr rha hai"*. **Inspected
rather than answered, and it was true.**

`shiftFor` has existed since v1.82 and the PAYROLL has always used it, so a shift really did
change what somebody was charged. **The screens did not.** `shiftOfMonth(period)` in
`frontend/src/standardTimes.js` knows the month's shift and a localStorage fallback and has
never looked at `employees.shift_in` — so three places judged everybody against the office
day: the **roll call's Late in list and its "Late by"**, the **month-wide late/early counts**,
and **`shared/dailyReport.js`**, the daily WhatsApp message.

- **`shiftTimesFor(employee, standard)` in `shared/lateEarly.js` is the one answer**, called by
  all three. Written as a helper because it was about to be written three times inline, which
  is how the payroll and the screens came to disagree in the first place.
- Measured on a real month: an evening-shift person arriving 14:05 against their own 14:00
  read **Late by 4h 35m** (against 09:30) and now reads **Late by 5m**. Driven in a browser.
- **THE AWKWARD PART, and it is the schema not a choice: `employees.shift_in` CARRIES A
  DEFAULT of 09:30 for everybody.** "Nobody set one" and "somebody set 09:30" are the same
  bytes. So a value equal to the shipped default is read as NOT SET and the office day wins.
  Without that, a month moved to a 10:00 start would be ignored for all eighty-six people
  still carrying the default — the office setting would quietly do nothing, which is the same
  complaint one level up. The cost is the rare person deliberately put on 09:30 while the
  office runs later; they follow the office, which is not expressible in this column anyway.
  **Found by a failing test, not by thinking**: `dailyReportApi`'s `?in=10:30` override stopped
  working on the first attempt, because everybody "had their own shift".
- The two halves are judged apart: office start, own finish is a real arrangement.
- **No figure moved.** These screens LIST who was late; what is CHARGED is the month's
  `late_policy` through `calculateRow`, which already read `shiftFor`. The screens now agree
  with the payslip rather than disagreeing with it — there is a test asserting the daily
  message carries no rupee sign at all.
- **Build trap, again:** the new import went into the `timesheet.js` block rather than
  `lateEarly.js` and the build failed — `| head -4` showed "Build failed" and I copied `dist`
  to `backend/public` anyway. **Read the whole head of the build output, and do not copy on a
  failure.**

## Phone punches in the punch log — three feeds, one record (v2.19.0)

Dinesh, straight after v2.18.0 named it as a known gap: *"punch log me bhi phone punch
dikhao"*. `phonePunchesForMonth` in `attendanceSelf.js`, `localStamp` in `punchClock.js`,
`resolverFor` in `punchTotals.js`.

**The two stores and why they could not simply be concatenated.** `device_punches` holds what
the readers and the Bizcompass spool collected and knows a **reader NUMBER**; `punch_events`
holds what somebody punched from the portal or their link and knows the **PERSON**. Two things
had to be right before one list could hold both:

- **THE TIME.** `recordPunch` stores `at` as an ISO stamp, which is **UTC**, while every
  reader's punch is the local string it printed. The attendance roll-up was always right
  because `minutesOf` reads it through `getHours()`. **Anything reading the stored STRING is
  not** — on his IST server a 09:42 arrival would have printed in the log as **04:12**, which
  reads as a fault in the machine rather than a bug here. `localStamp` converts, and the test
  file **runs under `TZ=Asia/Kolkata` on purpose**: in UTC the two formats are the same text
  and a test written here would have proved nothing. It asserts the zone first, because if the
  runner ignored TZ every other assertion would pass for the wrong reason.
- **WHOSE PUNCH IT IS.** `resolverFor(people)` is the one answer: a punch carrying
  `employee_id` is taken at its word, anything else goes through `matcherFor`. Written once
  because it was about to be written three times (the log, the totals, the in/out register),
  and three copies is how one screen comes to disagree with another about whose morning it was.
  **Forcing a phone punch through a code would hang it on whoever carries that number, and
  lose it entirely for everybody who carries none** — who are exactly the people punching from
  a phone. HARISH, in his own screenshots, is one of them.

- **`gatherPunches` merges them**, so the punch log, Punch totals and the in/out register all
  get them from one place and cannot drift. It also returns `phone`, the count, because a feed
  missing from the "where they came from" line is a feed nobody knows is running.
- **An empty punch ID is NOT a number nobody carries.** `unknownIds` counts reader numbers that
  reach nobody; a phone punch has no number at all, so counting its blank one would report a
  reader sending blanks — a fault that is not happening, on the screen somebody opens to find
  real ones.
- **`punchTotals` tallies the two feeds under different keys and `lineFor` adds them up.** A
  person whose `reach` is `none` now shows their own phone punches instead of a dash: `null`
  means *"no punch can ever find them"*, which stops being true the moment they punch from
  their own login, and a dash there sends the office hunting for a punch ID that would change
  nothing.
- **`punchesByDay` no longer returns early on a missing Punch ID.** That early return hid
  somebody's own punches from them on their own page — the same complaint as v2.1.0's
  *"employee me bhi nahi dikh rahe"*, one level down. `matched_on` keeps its meaning (it is
  about the READERS) and the portal's *"no reader has a number for you"* line now appears only
  when nothing of theirs is arriving at all, so somebody who punches from their phone is not
  told their times were all typed in by hand.

**Three screen bugs the browser run found, all the same family — wording written when there
was one feed:**
- The panel was headed *"every punch the readers recorded"*.
- **The person picker excluded anybody without a Punch ID**, on the sound old reasoning that
  they would always return nothing. Their punches were now on screen and could not be narrowed
  to. It offers everybody.
- The feed sentence read *"all of these came from readers"* and then counted some that had come
  from phones. **Patched twice, then rewritten as a list of feeds**, which is what it is.

A deleted employee's punch is listed as *"no longer on the staff list"* rather than with a
blank name, which reads as a fault.

**Proved by putting the gap back:** removing the merge fails 2 of the 12 new tests; the old
`dayPunches` test pinned `{matched_on:'', days:{}}` as a whole object, which encoded the early
return, and was **rewritten to state the rule** rather than repointed.

### Punch totals, checked on screen (v2.19.1)

Dinesh: *"punch totals me bhi check karo dikh raha he ya nahi"*. It was — HARISH read
**12 punches, 3 days, “Bizcompass spool, Their own login”**, both feeds added on one line —
and looking at it found the same stale wording the log had: *"every punch the readers
recorded"*, *"people the readers saw"*. **Second panel in one release written for one feed**,
so there is now a test that both name all three (comments stripped first).

Driven for the case his live system is actually in — somebody with **no Punch ID at all**
punching from their own login: KIRAN went from a dash to **1 punch, “Their own login”**, and
the *cannot be reached at all* figure fell from 1 to 0. That falls out of the merge rather
than being coded: `counted` is `punches !== null`, and a phone punch gives a number. The
sentence under it no longer claims *"no punch will ever find them"* — only that no READER
can, which is still true and is still the office's job to fix.

## Punching from the staff portal, and today's date (v2.18.0)

Dinesh, looking at HARISH signed into the staff portal: *"punch in wala kaha he"*, then
*"dashboard me current date kahi pe nahi aa rai he / employee login me bhi"*.
`frontend/src/components/PunchNow.jsx`, `POST /api/me/punch`, `todayLong()` in `format.js`.

**Inspected first, and the gap was real:** `/api/me` had no punch route and `MyPage.jsx` had
no punch button. Punching lived ONLY on the personal link (`/punch/<token>` → `PunchPage.jsx`),
which was right while nobody had a login — 115 people were not being given one, so a signed
token in a bookmarked link WAS the identity. Then logins arrived, and somebody who signs in
looks at their own dashboard and finds nowhere to punch. **Fifteenth time for "the feature
exists but not where the person is standing."**

- **`PunchNow.jsx` is the button, shared by BOTH screens**, and that is the point of the
  refactor rather than a tidy-up: the four location messages were a **real bug fixed in one
  of them** in v2.17.1 (plain http gives advice nobody can follow). A second copy is how a fix
  comes to exist in one place and not the other, with both screens LOOKING right. A test
  sweeps the whole frontend for `navigator.geolocation` and requires exactly two files —
  `PunchNow.jsx`, and `AttendanceRequests.jsx`, which is **named with its reason**: the office
  setting an office's own coordinates with "Use where I am" is a form box, not a punch, and
  owes nothing to the rule. The two punching screens must contain none of their own.
- **`post` is injected, because only the DOOR differs.** The link posts to
  `/api/punch/<token>/punch`, where the token says who they are; the portal posts to
  `/api/me/punch`, where the **LOGIN** does. The employee id comes off `requireSelf`, never a
  URL or a body — there is a test sending `employee_id` of somebody else and asserting the
  punch is filed against the caller and that the other person's record does not grow one.
  **Proved by putting the bug back:** letting the body name the employee fails 2 tests.
- It calls the **same `recordPunch`** — the fence, the strict setting, the roll-up onto
  `in_time`/`out_time`. Two paths from a punch to an attendance row is how two sets of rules
  come to disagree, and this one is about pay.
- `source: 'portal'`, so the store can tell the link, the portal and a corridor reader apart.
- **The card renders only once punching is switched on** (`PUNCH_ENABLED`) — a dead button on
  eighty-six dashboards reads as a fault — and it is **FIRST on the page**, above the Today
  and Working hours cards, because it is what somebody opens the portal at half past nine to
  DO; everything below is a report on a day already worked. Pinned by a test on the markup order.
- **`GET /api/me/punch` is a look and files nothing** (tested), and a punch bumps a `tick` so
  the Today and Working hours cards beside it are not left stale.
- **THE CSS TRAP, caught before it shipped:** `.jobs` and `.note` have rules only under
  `.public` — the link page's own wrapper. On the portal there is no such ancestor, so the
  punches would have rendered as a default bulleted list and the caption at full body size.
  The shared component carries its own `.punch-now` rules. It is the invented-class trap with
  the ancestor moved, and the fix is that **a shared component looks the same wherever it is put**.
- **KNOWN GAP, said in the changelog rather than quietly left:** a phone punch (link or portal)
  lands in **`punch_events`**, while Reports → Punch log reads **`device_punches`** plus the
  Bizcompass spool. They are separate stores with different identity models — one knows the
  employee, the other knows a reader number — and joining them properly means teaching
  `punchLog` about rows that name their own person. Forcing a phone punch through a code would
  mis-attribute everybody who has no Punch ID. Not done here; not pretended otherwise.
- **`todayLong()` in `format.js` is ONE helper** used by the office strip (`.today-is` beside
  the month picker) and the portal header, because two screens each writing out a date is how
  two formats come to exist. Measured at 1420 / 390 / 414: on a phone the office one takes its
  own line rather than squeezing the month picker, and nothing scrolls sideways.
- Driven end to end as HARISH on a 414px phone with `PUNCH_ENABLED=true`: punch in at the
  office fence → *"Punched in at 05:33 — at BNF Vadodara"*, button flips to Punch OUT, Working
  hours card updates to *"In 05:33 · Out — · still in"*, nobody else's name anywhere on the page.
- Also cleared on the way: a **duplicate `deductLunch` key** in `Attendance.jsx` that the build
  had been warning about (same value twice, so no figure moved).
- **Test-harness notes:** `POST /api/auth/staff` takes `employee_ids` (an ARRAY) and answers
  `{made, refused}`; `GET /periods/:id/attendance` returns `{employees:[{employee_id, attendance:{day:entry}}]}`,
  not a flat list. And a Playwright assertion against a heading styled `text-transform: uppercase`
  must be case-insensitive — `/Working hours/` found nothing on a card that plainly had it.

## One punch is not a twenty-four hour shift (v1.94.0)

Dinesh sent the Time tab showing **24h 00m worked and +900m overtime** on ABDULHAK BHENSWALA
(10:50/10:50), ASHOK MISHRA, ANURAG VERMA, ASHUTOSH JHA and AXAY DHADUK. Then he explained the
readers: *"punhcingmachine doorlock wala he to din me khi bar in out hote rehta he / punching k
bina door open nahi hota / to first punch for arriving :last punch for day end esa gin sakte
he"* — which is already the rule every importer follows, and which makes a **one-punch day the
odd case rather than the normal one**.

- `readTimes` in `shared/timesheet.js` wrapped `gross <= 0` to a whole day, for a genuine
  overnight shift. **In == out is not an overnight shift**, it is one punch written into both
  columns. `oneTouch` is now excluded from the wrap; a real 22:00→06:00 still wraps.
- `shared/punches.js` writes `out_time: ''` when the latest punch IS the earliest. **It must be
  sent as `''`, not omitted** — `setAttendance` merges per field, so leaving it out would keep a
  stale out time from an earlier import. `shared/punchClock.js` (the phone path) was already
  correct (`last > first ? … : ''`), which is how the right answer was known.
- **No payslip had moved**: `setAttendance` only recomputes minutes `if (anyTime && !('minutes'
  in entry))`, and the importer sends `minutes`. It was a mine, not a loss — a Time-tab edit of
  such a day would have saved the 900 minutes for real.
- **THE SECOND HALF, found while fixing the first: `TimeSheet.jsx` judged a day by the CLOCK
  and not by the MARK.** `timesToDay` knows the hours; only `minutesForMark` knows what the
  day's mark does with them. So a Sunday showed ALIFAYA CHIKHALIWALA **−219m** that the payslip
  took nothing for — and worse, `queueSave` **stored** that figure, writing a deduction onto an
  off day that the biometric import deliberately refuses to write. Both the screen and the save
  now call `minutesForMark`, judged by the mark the day ENDS UP with (after the auto-mark
  decision), so the screen, the save, `db.js`, `localStore.js` and the import preview are one
  answer. Pinned by a test that also forbids `minutes: worked.minutes`.
- **Test-fixture trap worth remembering:** `punchesToMarks` skips anybody without `active`
  (`if (!emp.active) continue`), so a fixture employee written without `active: 1` matches
  nothing and the assertion fails on `undefined`, not on the behaviour under test.

## A Sunday's duty is six hours (v1.95.0) — `shared/sundayDuty.js`

Dinesh: *"sundsy duty minimum six hours ki rehti he"*, then *"6 hours work full day salary
sunday"*. A Sunday is not a short version of a working day — it is its own thing, six hours
long, and six hours on it earns the WHOLE day's Sunday pay.

- **It reports and deducts NOTHING.** `calculateRow` still pays `sundays_worked × perDay`
  exactly as before and nothing in the module is an input to it; there is a test asserting a
  two-hour Sunday and a nine-hour one come out identical on gross, net, PT, `sundays_worked`
  and `sunday_salary`. What it answers is a question the register could not: **which Sundays
  actually carried the six hours.** A two-hour Sunday and a nine-hour one looked identical
  there and were paid identically.
- Named, not docked, for the same reason an **unreturned asset is named and never deducted**:
  somebody whose second punch never registered has done the day, and docking that
  automatically is a mistake nobody can see. The office types over the **Amount**.
- **A Sunday nobody clocked is `null`, never 0 — "not known" is not "nought hours".** Most of
  the staff still have no punch ID, so reading a blank day as zero would condemn almost every
  Sunday in the month. `full` and `short` stay null all the way out, and such a day is never
  on the short list. Same rule as the biometric import's day with no record.
- `sunday_hours` is held **per period** (default 6; a figure outside 0–24 falls back), so a
  rule changed in December never rewrites November.
- The register gained an **Hours** column, `✓!` on a short day with the times in its title, and
  a fold naming every short Sunday with how far under. Driven in a browser on a seeded
  November: ALIFAYA 14h 21m with two `✓!`, ANSARI 6h 39m clear, ASHOK 10h 11m clear with his
  unclocked Sunday correctly absent from the list.
### Answered: a Sunday pays no overtime (v1.96.0)

Asked which of the two readings he meant, Dinesh: *"Overtime me nahi jayega / Sunday ki full
day ki salary lene k liye minimum 6 hours complete karne he wesa he"*.

- **`PAID_BY_THE_DAY` in `shared/timesheet.js` is `{S, SP, HP, PH}`** and `minutesForMark`
  returns 0 on it in BOTH directions. The shortfall was already not charged; now the overtime
  is not paid either, because the Sunday register pays the day. **Leave is NOT in the set and
  neither is OD** — somebody out on the company's business who puts in eleven hours is doing a
  working day somewhere else, and taking their overtime away was never asked for. There is a
  test for each.
- **It is the WRITE path, so nothing already stored moves** and no month already paid can
  change. Found while driving it: on `monthly_late` the stale figures are **worth ₹0 anyway**,
  because `monthlyHours` skips a day that is not in `HOURS_EXPECTED` — it adds nothing to the
  target and nothing to what was worked. The banner says exactly that rather than printing
  "worth ₹0", which reads as a broken sum.
- `sundayOvertimeIn` finds what an open month is still carrying, **prices it with
  `calculateRow` rather than multiplying it out** (the per-minute rate follows the person's own
  shift and the month's rule), and `clearSundayOvertime` builds entries naming **only
  `minutes`**, so the per-field merge rule keeps the mark, the clock times and the reason.
- **`sundayAmountIf(row, period, { shortPays })`** prices a short Sunday at a fraction the
  office picks — half a day or nothing — and writes the ordinary `sunday_salary_override`,
  which is visible on the row and can be typed over. He named the six-hour line and NOT what
  sits below it, so the fraction is a choice on the screen, never an assumption. **A Sunday
  nobody clocked still counts as a full day.**
- The old test asserting *"overtime is still paid on whatever day it was worked"* was
  **rewritten to state the new rule**, not patched.
- One test caught by driving it: `.warn-line` was another invented class with no CSS behind it
  (fourth time) — it uses the established `.banner`.

## Punch totals — how many punches each person has (v1.96.0)

Dinesh: *"sare employee ka total punches dekhne ho alag se ek uska report bhi banana / o sirf
dekhne k liye hoga"*. `shared/punchTotals.js`, `PunchTotals.jsx`, `GET /api/punch-totals`.

- **It counts RAW EVENTS and is never a second opinion about attendance.** What a punch becomes
  — present, half day, the hours — is `punchesToMarks`' job and lives on the grid, which is what
  the sheet is paid from. The two cannot disagree because they are not asked the same question.
  Nothing on the panel writes anything.
- **A dash is not a nought.** `punches: null` means the person has no number the readers can
  match, so nobody ever looked for them; `0` means they were looked for and never seen. Two
  different problems, and only the first is somebody's job to fix — adding them together hides
  it. The unreachable sort first.
- **Both feeds are counted and NAMED apart** (`sources`), because "the Bizcompass spool is
  running and our own reader is not" is the answer somebody needs.
- `normalId` folds `0037` and `37` into one enrolment, as the Punch ID report does. A stamp that
  cannot be read costs that punch its *day*, not the whole count.
- `punchEventsForMonth` in `devices.js` is deliberately **not** `punchesForMonth` reshaped: that
  one hands back the importer's `dd-mm-yyyy` so `punchesToMarks` can read it, and a report
  re-parsing that string would be a second idea of what a date is.
- `PUNCH_TOTAL_COLUMNS` is the whole of what it carries, with a test that no salary, PAN,
  Aadhaar, bank account or date of birth is on it.
- Declared in the catalogue test's `beyondSpec` rather than bumping a count.
- **Needs the server** (rows in our store, files in the Bizcompass folder); the single-file
  build says so.
- Two wording bugs the browser caught: *"no Bizcompass folder is configured, **the rest** from
  our own readers"* with no spool at all, and a bare `—` in the Punch ID column beside a count
  of 3 for somebody matched on a numeric employee code (now `45 (code)`).

## Every punch of the day, to both sides (v1.97.0)

Dinesh: *"EMPLOYEE LOGIN ME UNKA PURE DIN KA INOUT DIKHA HE?"* — **inspected rather than
answered from memory, and the honest answer was half.** The portal has shown Date / Day / Mark /
In / Out / Hours per day since the `attendanceStatement` work, with lunch in a tooltip and a dash
where the times are not known. What it could not show is **every punch of the day**, and neither
could the office: the readers are door locks, a normal day is six or eight openings, and the app
held two. He then said: *"DONO KO DIKHE"*.

- **THE PUNCHES WERE BEING THROWN AWAY.** `runImport` read the Bizcompass spool, turned it into
  marks and discarded it, so there was nothing to show and no way to answer *"I left at 6:30,
  that 5:45 one was tea"*. `saveSpoolPunches` now files them — **only on a real run**, because a
  look must not write, and that rule holds for the punch store as much as for attendance.
- **THE TRAP THAT NEEDED A NEW COLUMN.** Spool rows belong to no reader of ours, so `device_id`
  is NULL — and SQLite treats NULLs in a UNIQUE index as DISTINCT, so `device_punches_once` would
  not have stopped a thing. Read every five minutes, one punch would be filed thousands of times
  and a day would read as the door opening all afternoon. `source` plus a **partial** unique
  index (`WHERE device_id IS NULL`) keys the spool rows; our own readers keep the original index
  untouched. Proved: the same batch three times = 3 added, 0, 0.
- The reader's own guid rides in `source`, so two gates recording the same second stay two
  punches. A reader punch and a spool punch for the same second are **both** kept — the person
  really did go through two doors, and they are the same event only in theory.
- `punchesByDay(employee, {year, month})` matches the way every importer does: the Punch ID, else
  an employee code that IS a number. **Somebody with neither gets an empty map and no id** —
  nobody ever looked for them, which is not the same as them never punching, and guessing would
  put somebody else's comings and goings on their statement.
- Shown in **both** places under the out time, only where the day carries **more than two**
  punches (otherwise it would just repeat In and Out): the office's `AttendanceStatement` (a new
  `GET /api/employees/:id/punches`) and the employee's own `MyPage` (riding on the existing
  `/api/me/attendance/:periodId`, where the employee id comes off the LOGIN).
- **It is not a second opinion about the hours.** In and Out are still earliest and latest, which
  is what the sheet is paid from; this only says what else the machine saw. Said on both screens.
- A test asserts a staff login gets **403** on the office route even for their OWN punches: their
  own record reaches them through `/api/me`, and a door onto everybody's comings and goings is a
  different thing.
- Driven end to end: a real spool folder, dry run (stored nothing), real run (stored 6), run
  again (added 0), then both screens — office statement and the staff portal at phone width —
  reading `09:12 · 11:40 · 11:52 · 13:30 · 14:05 · 18:02` under an 18:02 out time.
- Test-fixture trap: `createDevice` returns `{ device }`, not the row. Passing `device.id` of the
  wrapper filed the reader's punches as NULL-device rows, which the test caught by name.

### The date row glitched while scrolling (v1.97.0)

Dinesh: *"DATE PE SCROLL KAR RAHE HE TO GLITCH AA RAAHE SAHI KARO"*, with a grid reading `P` and
`+35` printed over Sun 1, Sun 8 and Sun 15.

- **A STICKY HEADER CELL MUST BE OPAQUE.** The Sunday and today tints are
  `color-mix(..., transparent)` — 92% and 91% see-through. In the BODY that is right: the tint
  has to sit over the row's own stripe and its hover without replacing them. In the sticky header
  there is nothing behind it but the rows scrolling past, so they showed straight through — and
  **only ever in those two kinds of column**, because every other header cell was already opaque.
  The tints now mix into `var(--line-soft)`, the header's own background, and `th.today.sunday`
  is stated so the two together are one colour rather than a toss-up.
- **Measured, not eyeballed, and the measurement was wrong twice first.** Comparing a fixed band
  while scrolling proved nothing (the dates change) and comparing it during a vertical scroll
  proved nothing either (the page scrolls too, moving the band). The honest test clips **one
  Sunday date cell, re-measured every frame**: 14 of 14 scroll positions changed it before, 0 of
  14 after — and the old rule was injected back to prove the test can see the bug at all.
- Pinned by a test that reads the header-tint rules out of `styles.css` and refuses
  `, transparent)` in any of them.

## The lunch break, found in the punches (v1.98.0) — `shared/lunchGap.js`

Dinesh: *"JO 30 MINUTES GAP HO O LUNCH ME COUNT HO ESA HO SAKTA HE?"*, then *"HAAN BANA DO"*.

**It could not have been built before v1.97**, which is the point: the raw punches were read,
applied and thrown away, so the app held a day's first and last and there was no gap to look at.

- `findLunchGap(times)` takes the day's stamps and returns the longest gap inside the window,
  `{ out, in, minutes }` or null. **Two punches are a day, not a gap** — the time between an
  arrival and a departure is the day itself, and reading it as a break would book the whole day
  as lunch. A repeated stamp is one punch.
- **The window is 20–90 minutes AND the middle of the day** (`startsAfter` 11:00,
  `endsBefore` 16:30). Ten minutes at the door is tea; four hours is somebody who went home and
  came back, and booking that as a break turns one day into two half days.
  **The time-of-day half was found by a failing test**, not by thinking: a day of 09:00 / 10:30 /
  11:00 / 13:00 / 13:40 / 18:00 has a NINETY-minute gap right after the arrival, and
  longest-gap-wins called that lunch. On a lunch-deducted month that costs the person ninety
  minutes. The window is data, so an office that really does eat at ten can be given its own.
- **IT DOES NOT DECIDE WHAT LUNCH COSTS.** Whether the break comes off the paid day is the
  month's existing `lunch_paid`, and `timesToDay` remains the single place that decides it. On
  Dinesh's months the break is INSIDE the paid day, so filling it **cannot move a rupee** —
  there is a test asserting the same day comes out at the same minutes with the lunch found and
  with `findLunch: false`. Where lunch IS deducted it really does come off, and **the dry run
  says how much before the Write button** — the pricing already existed, it just had to be named.
- **A lunch somebody TYPED is never replaced.** `lunch_found` flags a lunch this module worked
  out rather than read off a mapped column; `applyPunches` drops the flag before writing and
  strips the times where the stored day already has a lunch, reporting `lunchKept`. A lunch from
  a mapped column is untouched — that path came from a record somebody kept and behaves as it
  always did.
- Both import panels print the same sentence, because both end in one `applyPunches` and two
  wordings would read as two rules.
- **Test-fixture traps worth remembering, both mine:** a fixture whose first interval happened to
  be a qualifying 90-minute gap (which found the real hole above), and a day of 8h 50m where the
  shortfall went from 10 minutes (inside the 15-minute grace, forgiven) to 45 (charged) — so the
  difference read as 45 for a 35-minute break. The grace was doing its job; the test was reading
  it wrong.
- Driven on a real spool folder end to end: lunch filled at 13:30–14:05 from
  `09:12 · 11:40 · 11:52 · 13:30 · 14:05 · 18:02`; with lunch deducted the day charged 45
  minutes; with it inside the paid day the day charged **0**; a lunch typed by hand survived a
  re-import with `lunchKept: 1`.

## Why in and out still came out the same, and Sunday's own tab (v1.99.0)

Dinesh: *"why in time and outtime same coiing"*, then *"sunay register kaha dikhata he? /
sunday ka lag se atedecne register andsalary calckation bhi chaiye"*.

### The one-punch rule was written three times and the third was missing

**v1.94 fixed `punches.js` and checked `punchClock.js` — and never looked at
`shared/monthlyStatus.js`,** which is the eSSL report import AND the Access pull. That path
wrote `entry.out_time = t.out || ''` with no comparison at all, so it went on putting 10:50
into both columns after the other two were fixed. That is the honest answer to his question.

- **`departureTime(arrival, departure)` in `shared/timesheet.js` is now the one rule**, called
  by all three. It compares the TEXT that gets written, so 10:50:01 and 10:50:59 are one punch.
  It returns `''` and never `undefined`, because `setAttendance` merges per field and a missing
  key keeps a stale out time. A test asserts all three files call it.
- **A day with one punch now says so.** After the 24-hour wrap was removed it went silent — the
  hours read as a dash and two identical times sat there looking like a record. `readTimes`
  returns `one punch only - no out time`, the Time row shows a **one punch** pill, and the day
  lands on Reports → Missing punch.
- **A fix to the write path does not reach back.** Whatever is on a day stays until that day is
  saved again, and clearing eighty of them one `clear` at a time is why nobody would. The Time
  tab offers **Clear N one-punch out times** — it clears the OUT time only, naming it `''`, and
  leaves the arrival, the mark and the stored minutes alone.
- **Bug I introduced and the browser caught:** `onePunchDays` was declared above `lines`, so the
  whole Time tab threw *"Cannot access 'ie' before initialization"* and rendered nothing. A
  `const` in a component body is a temporal dead zone like any other.
- And a layout slip, also measured: the Clear button landed between *Fill the usual timings* and
  its caption, so *"onto the days that have nothing on them"* read as belonging to the Clear
  button. It has its own block now.

### Sunday is its own tab — ninth time for that shape

The register has been a **fold at the bottom of Attendance** since it was built, and Reports
offers `sunday-register` as `at: 'file:sunday'` — **a CSV download, not a screen**. So it
existed twice over and could not be found either way, which is exactly what he reported.

- `['sunday', 'Sunday', 'sunday', 'attendance']` in `TABS`, rendering the same
  `SundayRegister` — not a second one. It already IS both things he asked for: a tick per date
  worked (the attendance register) and day rate × days = amount (the salary calculation), and
  it recomputes with `calculateRow`, so it cannot disagree with the sheet.
- The fold on Attendance **stays**, because that is where somebody marking the grid is standing.
- **The help topic carried a comment saying "Not its own tab… which is exactly the kind of
  'where is it' this help exists to answer"** — and then the person it was written for asked
  where it was. Corrected, with the old wording kept in the comment as the reason.

## An out time that was not one, and the lunch the Time tab was charging for (v2.0.0)

Dinesh, on his live Time tab: *"jab shift khatamnahi hui to out me time kyu aa rah ahe"* and
*"and lunch ka ime bhi dikhavo kitni minute liya o"*.

### The last punch of a day still running is the return from lunch

ABDULHAK BHENSWALA at twenty to three in the afternoon: punches 10:50, 13:37, 14:16. Earliest
is the arrival, latest is 14:16 — **which is him coming back, not leaving**. With the lunch
finder now setting 13:37–14:16, the day read as in 10:50, out 14:16, **worked 2h 47m**: a
finished short day, for somebody sitting at his desk.

- **`departureTime` gained a third argument, the lunch return.** Nobody returns from lunch and
  leaves in the same minute, so that minute is a return and the departure is not known. The
  same knowledge is applied on the READ side in `readTimes`, so a day that arrived before this
  release, or was typed by hand, reads the same way.
- The row says **still in**, the hours are `—` and nothing is charged. The warning is ordered
  BEFORE the plain "no out time", because both are true and only one says why — the "check"
  pill lesson again.
- The break itself stays on the record and is still measured; only the departure goes.

### THE MONEY BUG THAT QUESTION FOUND

**The Time tab never read `period.lunch_paid`.** `timesToDay` and `minutesForMark` both default
to deducting the break, so on a month with "Lunch is inside the day" ticked — which is how this
office runs, and the strip at the top of that very screen said so — a 09:30–18:30 day with a
40-minute lunch read **8h 20m and −40m** instead of **9h 00m and nothing**.

**And it SAVED that.** `queueSave` sends `minutes`, and `setAttendance` leaves a caller's own
minutes alone (`if (anyTime && !('minutes' in entry))`), so the screen's wrong figure beat the
server's correct one. `calc.js`, `db.js` and `localStore.js` all read the setting already; this
one screen did not, and it is the one people type into.

- Fixed in all six places on that screen plus the two other totals (`Attendance.jsx`,
  `Dashboard.jsx`), and `db.js`'s own `timesToDay` for the auto-mark.
- **A test now refuses any `timesToDay` / `minutesForMark` / `monthTotals` call in
  `TimeSheet.jsx` that does not pass `deductLunch`.** The existing test pinned the call
  WITHOUT it — exactly the bug — and was **rewritten to state the new rule**, not patched.
- **Test-regex trap worth remembering:** the first version of that sweep was
  `/\([^)]*\{[^}]*\}/`, which stops at the first `)` and so cut `hoursOf(row || {})` in half
  and failed on a perfectly correct call. It scans with balanced brackets now. A naive match
  there would have had me "fixing" working code.
- The footnote said "less the lunch break" on every month, contradicting the line at the top of
  the same screen. It follows the setting now.

### How long the break was

`.ts-lunch-len` under the LUNCH IN cell: `40m`, or `40m off` where the month takes it out of the
hours, with the reason on hover. Inside the cell rather than a tenth column, which would have
run the Time tab off a laptop. `readTimes` already returned `lunch` and `lunchDeducted` — the
figures existed and were never shown, so reading one meant subtracting in your head
eighty-six times.

## The punch log, and the punch that was on the record but on no screen (v2.1.0)

Dinesh: *"sare logs kaha dikhte he?"*, then, looking at HARISH's own portal,
*"employee me bhi nahi dikh rahe"*. `shared/punchLog.js`, `PunchLog.jsx`,
`GET /api/punch-log`.

**Inspected first, and there were three different "logs".** The **audit trail** exists
(People, `audit_log`); **Punch totals** says how many punches each person has; a day's
punches show under the out time on a statement. What did not exist is the record itself —
every punch, with its time, its reader and who it matched. There was nowhere to open on an
ordinary Tuesday and settle an argument about a morning.

- **IT IS THE RAW RECORD AND NOT ATTENDANCE.** A punch is one door opening; what the day
  BECOMES is `punchesToMarks`' job and lives on the grid, which is what the sheet is paid
  from. The two cannot disagree because they are not asked the same question. Nothing on
  the panel writes anything, and there is an API test asserting that reading it files no
  punch.
- **A punch nobody carries is LISTED, never dropped** (`employee_id: null`, not a name and
  not an empty id). That is attendance arriving for a person it can never reach, and it is
  usually why somebody opens this.
- **To the SECOND, deliberately** — the one place in the app that is not minutes. Two
  touches of the door forty seconds apart printed as `10:50 · 10:50`, which reads as a fault
  rather than as what happened, and that is exactly the day whose out time is blank.
- **A capped page SAYS how much it left off.** A list silently cut short reads as "that is
  all there was", which on a punch log sends somebody hunting for a feed that is working
  perfectly.
- `matcherFor` was factored out of `punchTotals.js` so the counts and the log cannot
  disagree about whose punch a number is; `gatherPunches` in `reports.js` is likewise one
  function, for the same reason.

### *"employee me bhi nahi dikh rahe"* — the rule v2.0.0 broke

A day's punches appeared only where it carried **more than two**, on the reasoning that two
punches ARE the in and the out and printing them again is noise. **v2.0.0 broke that**: a
one-punch day and a back-from-lunch day both have their out time suppressed, because neither
is a departure. So the punch was on the record, the Out column read a dash, and nothing on
either screen showed it.

- **`showPunches(day, punches)` counts it instead of guessing**: show them whenever In and
  Out do not between them account for every punch. The rule had been written into **two**
  components separately, which is how a rule comes to disagree with itself — one function
  now, with a test refusing a second copy.
- **The portal says when NO reader can reach somebody.** `punchesByDay` returns
  `matched_on: ''` for anybody with no punch ID and a non-numeric code, and `me.js` was
  throwing that away. "Not matched" and "not seen" are different problems and only one is
  the employee's to raise — without the line, an empty list read to them as the machine
  having missed them all month.
- `punchesByDay` now keeps the **seconds** and the screens decide how much to show
  (`punchTimes`): minutes normally, seconds wherever a minute occurs twice in one day.
- Driven in a real browser at phone width on three people: ALIFAYA (two punches in one
  minute, out suppressed) now reads `10:50:00 · 10:50:40` where it showed nothing; HARISH
  reads `09:12 · 13:30 · 14:05 · 18:02`; KIRAN, who has no punch ID, gets the sentence
  saying so.

### Two older defects the "Seen by" column exposed

Both were in the **shipped** Punch totals report, found by reading one column on a running
server rather than by guessing.

- **Every spool punch was labelled "a reader since removed".** `punchEventsForMonth`
  COALESCEd over the device name, and a spool punch has `device_id` NULL because that reader
  is not one of ours. Nothing was removed; that feed is the one still running. It now reports
  the feed from `source`, with the removed-reader case kept for what it actually means.
- **THE SPOOL FILES WERE NEVER READ AT ALL.** `fileCouldMatter(name, { month })` takes a
  month **NUMBER**; the route passed `{ year, month }`, so it compared a number to an object,
  answered false for every file, and read nothing — on a server with sixteen thousand files
  in the folder the report said none were found, and the sentence underneath claimed no
  Bizcompass folder was set.
- Fixing that brought back the other half: since the app began **filing** the spool's
  punches, an imported month holds them as rows AND still has the files they came from. Both
  read would list every door opening twice. They are de-duplicated on the key the store's own
  partial unique index uses — number, second and reader guid — and the panel says how many
  were already filed, because "read 3" beside a count of 1 reads as punches going missing.

## A day still running is not half a day (v2.2.0)

Flagged at the end of v2.1.0 as worth knowing; Dinesh: *"HF wala bhi theek kar do"*. It was
worse than "worth knowing" — it was **half a day's pay per occurrence**.

**The defect in one sentence: the mark was derived from a departure the same function then
refused to write.** `punchesToMarks` computed `worked = seen.out - seen.in - lunch` and
marked HF below the half-day line, and only a few lines LATER did `departureTime` decide
that `seen.out` was really the return from lunch and blank the column. So HARISH's
09:35 / 13:37 / 14:16 came out **HF at twenty past two**, sitting at his desk — 4h 02m off
a departure the code itself did not believe in. Measured: ₹500 off a ₹26,000 salary, for
that one day.

- **The departure is decided FIRST now, and the mark follows it.** One `departureTime` call,
  its result used both for the mark and for the column, so they cannot contradict each other.
  The old one-punch branch (`seen.out === null || seen.out === seen.in`) became `!outText`,
  which covers one punch, a repeated minute AND a last punch that is the lunch return — the
  three cases that function already knew about.
- **An arrival with no departure is PRESENT**, minutes 0, and lands on Missing punch. *Not
  known is not half a day.* A day that really did finish short is untouched, with a test
  that fails if the guard is written too broadly.
- **Only `punches.js` had it.** `punchClock.js` (the phone) writes times and lets
  `timesToDay` decide, and that already returns `code: ''` when the hours are unknown;
  `monthlyStatus.js` takes the machine's own verdict. Checked rather than assumed.
- **Nothing in the suite covered it** — 2211 tests passed with the bug in place, which is
  how it shipped. The new tests were proved by putting the old rule back: 2 of them fail.
- `summary.noDeparture` rides into the import's dry run, so those days are named **before**
  the Write button.

### A fix to the write path never reaches back

Whatever is already on the grid stays until that day is saved again — the same lesson as
v1.99.0's one-punch out times. **Time → "Mark N half days present"**, beside the one-punch
clear.

- **It sweeps the WHOLE MONTH, not the view.** That tab shows one day across everybody or
  one person down the month, and the spoilt days are scattered through both; hunting them
  one date at a time is why nobody would. (The older one-punch clear is still view-scoped;
  left alone deliberately, since widening a shipped button's reach without being asked is
  its own surprise.)
- **It writes only `code: 'P'`**, so the per-field merge keeps the arrival, the lunch and
  the stored minutes. There is a test refusing any `in_time`/`out_time`/`minutes` in that map.
- **It asks, and says it PAYS A FULL DAY**, because that is what pressing it does. Driven in
  a browser on two stale days across two people: both corrected, RIYA's genuine HF (a real
  12:00 out time) untouched, and all three unclocked days still on Missing punch.

## The sum behind a day, and nobody charged for a day still running (v2.3.0)

Three messages off one screen: *"yaha click karne se uske time log bhi open ho esa ho sakta
he, jisse −50 minute ka hisab mil sake"*, *"yaha pe bhi sare log dekhne ka option do"*, and
*"out time abhi bhi aa raha he"*.

### A day that cannot have finished yet has no departure — `dayNotFinished`

**The third money bug in three releases, and the same family as the other two.** v2.0.0
caught a last punch that is the return from lunch; v2.2.0 stopped a mark resting on a
departure the code refused to write. What was still happening: somebody with only **two**
punches was handed a departure and **charged a shortfall while they were at their desk**.
ANURAG VERMA read 10:49 → 15:37 and **−252 minutes** at 16:14, with two hours of his day
left. (That figure is in his screenshot, and the test reproduces it to the minute.)

- The rule is the one sentence always true: **you cannot have finished your day before your
  day's length has gone by.** Until then the departure is not known, nothing is charged and
  nothing is paid.
- **It only ever looks at TODAY**, so no stored day can move; there is a test for a past day
  being judged identically whatever time the import runs. `LATEST_FINISH` (22:00) stops an
  afternoon shift whose arrival + hours lands past midnight from never resolving.
- The Time tab says **still in** instead of "no out". The read side cannot know — the column
  is simply empty — but that screen has the day, the month and their shift, so it can.
- `summary.stillIn` rides into the dry run.

### And the importer was judging everybody against the office day

Found while testing the above: `punchesToMarks` used `period.hours_per_day` for the half-day
line and the full day. **v1.82 made the shift length personal and `hoursForEmployee` the one
answer to it — and this file was missed**, so a six-hour part-timer finishing exactly on time
was docked three hours a day on the import path. `hasOwnShift` compares against the office day
rather than asking whether the column is filled in, so everybody on the usual shift comes out
byte for byte as before (there is a test asserting exactly that). The month-wide
`fullDayMinutes`/`halfDayMinutes` constants were **deleted**, not left sitting unused — a dead
constant beside a live one is how two answers come to exist.

### Clicking a day says where its minutes came from

`DayPicker` gained a clock block: the four times, the sum **in words** (*"8h 05m worked
against 9h 00m expected, after taking the 40-minute lunch out = −55 minutes by the clock"*),
and every punch that day.

- **It ASSEMBLES** — `readTimes` and `minutesForMark`, the same two functions the Time tab,
  the server and the payslip use, so it cannot become a second opinion about the day.
- **A figure typed over the clock says so**: *"this day carries −50, not the −30 the clock
  comes to"*. Without that line the sum reads as not adding up, which is worse than no sum.
- **It sits ABOVE the fourteen mark buttons.** Put below them it measured at 922px in a card
  1442 tall — the "feature nobody can find" mistake for the tenth time. A test pins the order.
- `.picker-clock` / `.picker-times` got real CSS. **Fifth time** for the invented-class trap,
  so it was checked before writing rather than after.

### The Time tab shows every punch too

Under the out time, by the same `showPunches` / `punchTimes` the statement and the portal use.
**One person down the month is ONE request, so it loads itself; one day across eighty people
would be eighty, so there it is a `log` button per row.** A row whose person has no punch ID
says so rather than showing an empty list.

## Every in and out, for the whole month (v2.4.0) — `shared/inOutRegister.js`

Dinesh: *"need all logs / all in out"*. `InOutRegister.jsx`, `GET /api/punches/month`,
Reports → **Working hours — every in and out**.

**Inspected first.** The Time tab shows one DAY across everybody or one PERSON down the
month, never both. The punch log lists raw door openings, which is a different question. The
statement is one person. So the plain register — who came in and who went home, whole month,
one page — did not exist.

- **The catalogue carried `working-hours` as `partial`, noted "No standalone report"**, and
  that had been stale for a long time: every figure already existed and nobody had built the
  screen. **Sixth stale "cannot be built" note**, exactly as this file keeps warning — a note
  explaining why something is impossible outlives the thing that made it so. Flipped to
  `ready` with the panel behind it, so no `beyondSpec` entry was needed.
- **IT ASSEMBLES.** The hours come from `readTimes` and what a day COSTS comes from the
  `minutes` stored on it — the column the sheet has always been paid from. `from_clock` exists
  only so the register can say when the two differ; it never replaces the stored figure.
- **A figure typed over the clock is marked `typed`**, with the clock's own figure on hover.
  Without that the register reads as a sum that does not add up, which is worse than no sum.
- **A day nobody clocked is `null`, never 0** — nought hours would read as somebody who turned
  up and did nothing. Blank days are counted and left out, with a tick to list them.
- **`GET /api/punches/month` returns the whole month keyed by employee then day, in ONE
  request.** Asking the per-person route eighty times is eighty requests nobody wanted. It
  carries only the id and the times — a test asserts no salary and not even an employee code.
- The register itself computes in the browser off the loaded month, so the single-file build
  gets it; only the punch column needs the server and it says so.

**Three bugs of my own, all found by driving it:**

- **`payroll` is the month OBJECT `{ period, rows }`, not an array.** Every sibling panel takes
  it that way and reads `.rows` itself. Taking it as a list threw *"t is not iterable"* inside
  the `useMemo`, on render. Pinned by a test.
- **One `rows` for two different things** — the payroll's rows and the CSV's rows — and the
  build failed with *"The symbol rows has already been declared"*. **And `npx vite build
  --logLevel error | tail -3` HID IT**: the browser went on serving the previous bundle and the
  same error reproduced three times before I checked the asset hash had not changed. Check the
  hash, or read the head of the build output, not the tail.
- **The layout, measured at 1280px.** `.report-body table.sheet { width: 100% }` squeezed it
  into the panel, which clipped the OT column off the right edge **with no way to scroll to
  it**, and squashed a day's punches into a column so narrow they stacked five lines tall.
  `table.sheet.inout` is `width: auto; min-width: 100%` so the frame scrolls, and the punches
  moved under the out time (where the Time tab, the statement and the portal already put them)
  with `white-space: nowrap` scoped to this table. After: 810px table in a 660px frame that
  really scrolls, last cell reachable, row height 40px at every width.

## HR's two questions off the grid (v2.5.0)

Dinesh forwarded a WhatsApp thread with **HR Booknfly**. Two asks, and the first one's
*reasoning* is wrong while the request itself is right.

### "iske place pe total hours hi rakho na" — hours under each mark

HR: *"sir iske place pe total hours hi rakho na ismai jiska minus hai uska kam ho raha hai
salary jiska + hai uska salry jyada ho raha hai"* — put total hours where the ± minutes are,
because a minus cuts that person's salary and a plus raises it.

**CHECKED IN `calc.js` RATHER THAN ASSUMED, and the premise does not hold on his months.**
`chargedMinutes` on `monthly`/`monthly_late` is `monthlyHours.minutes` — *"on `monthly` the
month's own total is what is charged and the daily minutes are not"*. His months open on
`monthly_late`, so a `−119` on the grid is **not** deducting from that person individually; it
is one input to the month's hours, and only the month's shortfall against the target is
charged. A day short and a day long still cancel.

So the reasoning is wrong and **the request is right anyway**: the hours are what the month is
actually judged on, and a column of ±119s reads as a column of deductions.

- `under` state (hours / ± minutes / nothing), remembered in localStorage, with the strip
  saying **"neither changes the pay"** in words — because that worry is the whole reason it
  was asked for, and a quieter display could easily read as the deduction having stopped.
- Hours come from `readTimes` with the month's own `lunch_paid`, so no second opinion.
- **A day with minutes typed on it and no clock times still shows them** in hours mode. A real
  deduction must not be hidden by a new way of looking.
- `.mark-minutes.hours` is deliberately **not** red or green: it is a fact about the day, not
  a verdict. The ± keeps its colours, because that one really is a plus or a minus.

### "punch krna bhul jye aur add krna ho toh?" — and "na nhi hai"

She asked where to add a forgotten punch; told there must be an option somewhere, she replied
*"na nhi hai"*. **It existed on the Time tab all along** — a different tab from the one
somebody is standing on when they spot a missing punch. **Eleventh time for that shape.**

- The day menu's clock block (added v2.3.0 as read-only) is now **four editable boxes**, using
  the **same `TimeInput` the Time tab uses** — now exported rather than copied, so `930`,
  `9.30` and `6pm` are read identically on both screens. The sum underneath updates as you
  type.
- **THE TRAP, and it is the v2.0.0 one again:** `queueSave` sends `minutes` on every entry and
  `setAttendance` leaves a caller's own minutes alone, so typing an out time while carrying the
  old figure saves new hours beside a stale deduction. `setEntry` now re-works the minutes with
  `minutesForMark` whenever the patch names a time field. Driven in a browser: a day with in
  09:30, no out and 0 minutes, typed `1730` → stored `−60`, not left at 0.

### The name column, and a full stop that was not in anybody's name (v2.5.1)

Dinesh, off the very screenshot sent to him: *"naam wala column wala fix kar do"*.

- **It read as a typo in an employee's name.** `AJEETKUMAR UPDHYAY.` and `ALIFAYA
  CHIKHALIWALA.` — the dot was the `td`'s own `text-overflow: ellipsis` being drawn
  **past its right border**, over the Code cell beside it. Measured first: the link itself
  did not overflow (`-3px`), so widening the link was not the fix; the ellipsis belonged to
  the wrong element.
- **Both halves were needed.** The column went 10rem → 13rem (his names run to twenty
  characters and 10rem held exactly twenty with no slack), AND the ellipsis moved onto
  `.name-link` (`display: inline-block; max-width: 100%; overflow: hidden`), because
  widening alone only moves the problem to the next longer name. Proved with a 37-character
  name forced onto a row: cut off cleanly inside the cell at both widths.
- **ONE FIGURE DRIVES BOTH.** `table.attendance { --name-col }` is the width of the name
  column and the `left` the Code column freezes at. They were two hand-written `10rem`s —
  the same drift `CALC_COLUMNS` was introduced to stop in the Excel export — and changing
  one alone leaves a gap or an overlap. The phone breakpoint sets the one variable to 9rem
  and the Code column follows it for free. Measured `gapToCode: 0` at 1460px and 700px.
- Nothing else moved: no figure, no mark, no pay. One day fewer fits on screen, which the
  grid scrolls past as it always did.
- Tests pin the variable, that neither rule may go back to a literal `rem`, and the four
  properties on the link; **proved by putting the old CSS back — both fail.**

## Pay from the days alone, and the hours as a column (v2.6.0) — `POLICY.none`

Dinesh, having had the whole calculation explained to him: *"Salary count sirf absent presnet
half day se hi ho / Monthly hour wala manual coloum do / Count karna he ki nahi uske liye"*.

- **A fifth policy, `none`, and it is now `DEFAULT_POLICY_FOR_NEW_MONTHS`.** The pay comes
  from the day count — P, A, HF and the leave marks — and `calculateRow` charges
  `0` for hours. `onDaysOnly` is asked FIRST, beside `onConcession` and `onMonthlyHours`,
  so each policy is recognised in one place. There was no "off" before: `hours` (the old
  default) still charged every day's shortfall, so "don't charge for hours" was unreachable.
- **TURNING THE HOURS OFF STOPS THE OVERTIME TOO**, and that is the sentence somebody will
  be surprised by. It is the day count or nothing. Said in help, in the changelog and in the
  switch confirmation, which names both sides — what stops being deducted AND what
  stops being paid, read off `ot_salary`/`late_salary`, the figures the payslip prints,
  never recomputed from a rule.
- **The month's hours are still computed on every policy** — they always were, so the
  panels could price a switch — and now a **read-only `Month hrs` column** on the salary
  sheet shows `monthly_hours_diff` beside the box. `judged: false` renders a dash: *not
  known* is not *they did no hours*. It is deliberately NOT an `EditableCell` (a test
  asserts it), because the figure comes off the clock and typing over it would be a second
  answer to one question.
- **The manual column is `ot_minutes_override`, which already existed and already beat every
  policy.** What changed is that nothing else charges for hours now, so that box is the only
  thing that does. Driven: eight people at 26,000, everybody's gross 26,000 (ALIFAYA 25,000
  for one absence) with month hours running −13 to −166; typed −300 on one row
  → −556, net 25,244, and clearing it hands back.
- **NOTHING REWRITES A STORED VALUE.** Every month already open keeps the rule it was run
  on; only months opened from now start on `none`. Same as v1.83/v1.84, with the same tests.
- **`normalisePolicy` in `shared/lateEarly.js` is now the one validator.** `db.js` and
  `localStore.js` each kept their own `['concession','monthly','monthly_late']` — a list
  typed twice, which would have gone stale the moment a fifth policy was added, exactly as
  the hand-written `<option>`s did in v1.85. An unknown value still falls back to `hours`,
  **deliberately not to the current default**: a month must only ever arrive on today's rule
  by being opened today.
- **Nine tests had pinned the old default and were REWRITTEN to state the new rule**, not
  patched; three of them now set a charging policy explicitly, and that they have to is
  itself the proof that nothing switches a month by itself.
- **THE FIXTURE TRAP, AGAIN, AND IT NEARLY SHIPPED A USELESS TEST FILE.** `calculateRow`
  does not read clock times for the day-by-day rule — it sums the `minutes` already
  stored on each day. A first draft of `daysOnly.test.js` built days with times and no
  `minutes`, so with the `none` branch DELETED only **1 of 13** tests failed. The fixture now
  calls `minutesForMark`, which is what `setAttendance` does on the way in, and **4 of 13**
  fail with the old code. Same trap as v1.82; always prove a test by putting the bug back.

### The hours figure comes by itself (v2.7.0) — `shared/hoursDecision.js`

Dinesh, straight after v2.6.0: *"Amount to apne aap aayega na minus hours ka / o deduct karna
he ya nahi uska decision lena he khali"*. v2.6.0 left him TYPING the figure into OT min, 86
times — that is data entry, not a decision.

- **`hoursDecision(calcs)` turns the figure `calculateRow` already returns into a yes or a
  no.** It never calculates, so it cannot become a second opinion. Bar above the sheet:
  *Deduct the short hours — 8 people, ₹1,443*; one press fills the OT min box on
  every one of those rows.
- **Short and over are TWO buttons.** Deducting somebody's missing hours and paying somebody
  else's overtime are different questions; one button for both answers the second without
  being asked, which is how an overtime bill nobody approved appears.
- **It writes `ot_minutes_override`, NEVER the month's rule.** A rule applies to everybody
  from then on; this is a judgement taken person by person with the figure in front of you,
  into a box that is visible, changeable and clearable. A test asserts the patch carries that
  one key and no `late_policy`.
- **A row that already carries a typed figure is left alone and COUNTED**, and the confirm
  says how many — the *Mark everyone Present* rule. **Somebody who clocked nothing is
  never included**: `judged: false` is "not known", and writing 0 there would read as a
  decision somebody took.
- **Clicking one person's Month hrs figure puts it in their box** — the exception case,
  and the cell is a button because a figure that reads as a decision has to BE one. The
  v2.6.0 test asserting it was read-only was **rewritten to state the new rule**: still never
  an `EditableCell` (nobody types a DIFFERENT figure over the clock's), but it is a way in.
- **THE REAL BUG THIS SURFACED: the footer and the rows disagreed.** `totalRows(filtered)`
  summed the fields STORED on each row while every `Row` recalculated itself, so between a
  change and the server's reply the total was stale. One typed cell made that a blink;
  pressing this button changes 86 rows at once and it became a **visibly wrong total on a
  payroll screen** — measured at 2,07,000 against rows adding to 2,05,557. One `calcs`
  memo now feeds the footer, the decision bar and the printed register; `totalRows` itself is
  untouched because eight other callers sum stored rows on purpose. Verified every key
  `totalRows` wants is returned by `calculateRow` before switching.
- Driven end to end: bar reads 8 people ₹1,443 → click one person's figure → bar
  drops to 7 / ₹1,287 and gains *Clear 1 typed figure* → press Deduct → all eight
  filled, footer ‑1,443 → Clear → everybody back to 25,800.

### The quarter of an hour that was hiding every minute (v2.8.0)

Dinesh, off his live Time tab where the whole + / − column read a dash: *"kuch logo me +-
minutes kyu nahi aa rahi he"*, then *"dikhavo"*.

- **Nothing was wrong.** `TIME_RULES.graceMinutes` has been 15 since the Time tab was built,
  and every day on his screen was inside it: **+7, −11, +8, +13, −8, −15, −10**
  — recomputed here from his own clock times before answering, not guessed at. The rows
  reading `9h 00m` were genuinely 0 (the "Fill the usual timings" days).
- **THE HALF THAT MADE IT CONFUSING, and it is now a test:** the grace only ever touched that
  column. `monthlyHoursLine` reads the clock times themselves, so **Month hrs has always
  counted every minute** — his three days came to 0, 0, 0 on the grid and **+9** in the
  month, which is the figure the "Deduct the short hours" decision is taken on.
- **`day_grace_minutes` is now a period column**, read through `dayGrace(period)`.
  **The column default is 15 and `DEFAULT_DAY_GRACE_FOR_NEW_MONTHS` is 0, deliberately two
  different figures**: the first is what every month already run was paid on, so the migration
  cannot move a rupee; the second is what a month opened from now starts on.
- **A changed rule does not reach back**, the v1.99.0/v2.2.0 lesson again. **Time → "Count
  every minute"** patches the month to 0 and re-works the stored days in one press, sweeping
  the WHOLE month rather than the view. It names the days, the people and the net minutes, and
  **says what it costs per policy** — nothing on `none`, nothing on `monthly`/`monthly_late`
  (that rule already counted them), real money only on `hours`.
- **THE BUG IT FOUND, and it is the third of its kind:** `setAttendance` reads the month with a
  **named column list**, and the new figure was not on it — so the server went on forgiving
  fifteen minutes while the month said 0. Same trap as `listPayrollRows` missing the salary
  breakup. Caught by the end-to-end test, which fails with the column removed.
- Threaded through every screen that stores or shows the figure (`db.js`, `localStore.js`,
  `TimeSheet.jsx`, `Attendance.jsx`, `Settings.jsx`, `inOutRegister.js`, `monthlyStatus.js`),
  with a test naming each — the v2.0.0 `deductLunch` lesson, where one screen out of five
  was missed and it was the one people type into. `attendanceStatement.js` and
  `myDashboard.js` read only `worked`, so they are deliberately untouched.
- An omitted `graceMinutes` still behaves exactly as before, so the punch importer's own
  defaults and every fixture are unmoved.
- Two tests pinned the old call shapes and were **rewritten to state the new rule**: the
  Time tab's usual-day assertion (which broke on nothing but a line wrap, so it now asserts
  the RULE rather than the spelling), and `attendanceWrites`, whose period is now pinned to
  the old grace as well as to `hours`, for the reason already written there.
- Driven on a month seeded like his: 84 days across 7 people, −192 minutes, confirm read
  *"Nothing anybody is paid changes"*, and the grid then read +7m / −11m / +8m / +13m /
  −8m / −15m / −10m with the 9h 00m row still a dash.

### "Punching error" — what each one means (v2.17.1)

Dinesh: *"Punching error"*, with no more words. **Reproduced every refusal the phone punch
can give rather than guessing**, on a real punch link in a real browser:

| What is wrong | What the employee sees |
|---|---|
| `PUNCH_ENABLED` not `true` | *Punching from a phone is switched off. Ask the office to turn it on.* — and the **Punch IN button is greyed out**, so nothing is even sent |
| Location blocked in the browser | *Location is blocked for this page. Allow it in the browser and tap again.* |
| Page open over plain **http** | *This page is open over plain http, and a browser will only give a location over https…* |
| GPS slow | *Finding your location took too long. Step outside or near a window…* |
| Outside the fence with `PUNCH_ALLOW_OUTSIDE=false` | *You are 4.7 km from the office.* |
| More than 20 taps a minute | *Too many taps. Wait a minute.* |
| Link reissued or expired | *This link is not valid any more. Ask the office for a new one.* |

**The commonest one is the first, and it is one environment variable**: `PUNCH_ENABLED=true`
on the server, then restart. Verified: with it off the button is dead; with it on, SUHANI's
link punched in at 02:25.

**THE ONE THAT WAS A REAL FAULT.** `where()` resolved `null` for every failure alike, so the
server's single sentence came back for all of them — *"Allow location access and try again"*.
That is **advice nobody can follow over plain http**: the browser does not offer the location
API on an insecure origin at all, so there is nothing to allow and the punch can never
succeed. Somebody would tap it all morning. Only the phone knows which of the four it was, so
the phone now says, and the server still decides whether to refuse. **Proved from a real LAN
address (`http://192.0.2.2:4387`), not reasoned about.**

- Also worth knowing: **`PUBLIC_URL` unset makes `url` null** on the punch-link response, so
  the office gets a path and not something it can send on WhatsApp. Behind the tunnel it
  should be `https://bnfhrms.scalevisory.in`.
- **No office location set is not an error.** `judgePunch` returns `inside_fence: null` with
  the note *"no office locations set"*, and with the default `PUNCH_ALLOW_OUTSIDE` the punch
  is recorded and flagged — which is the v1.x rule: refusing leaves somebody genuinely at a
  client's office with no attendance at all.

### The staff portal's calendar (v2.17.0)

Dinesh: *"employe login me bhi calander wala oprtion do"*, straight after the office side
got one. `MyCalendar` in `MyPage.jsx`, behind a **List / Calendar** toggle on *Day by day*.

- **No route change and no new figure.** `/api/me/attendance/:id` already returns
  `statement.days` (mark, in, out, `worked_minutes`, `ot_minutes`, weekday, weekly off,
  holiday, `time_warning`) and `punches` keyed by day. The calendar is a second **view** of
  the array the list is already drawn from — which the server built from the row the payslip
  is printed from — so the list, the calendar and the payslip cannot give three answers.
  There is a test asserting the portal file contains no `timesToDay` or `minutesForMark` of
  its own.
- **It reuses `shared/monthGrid.js` and the office calendar's classes** (`.lc-grid`,
  `.tc-*`), so the calendar an employee sees and the one the office sees read alike rather
  than being two ideas of what a calendar looks like.
- **The day's detail is ABOVE the grid** — the measured lesson from v2.11.0, where putting
  it below landed the answer under the fold.
- A day nobody clocked is a blank square and a dash, never nought hours.
- **The choice is remembered**, wrapped in try/catch: a private window throws on even
  touching `localStorage`.
- **Driven on a 414px phone**, which is what a staff login is actually used on: signed in as
  a real staff user, grid 346px wide with no sideways scroll, tapped the 2nd and got
  *10:14 in · 19:03 out · 8h 49m worked · −11m short* with all twelve punches listed.
- **The footnote follows the view.** It said *"Under the out time is every punch of that
  day"* — true of the list, and a note about a screen you are not on when the calendar is
  showing, which has no out column. It now says *"Tap a date"* there.
- On a phone the media query hides the per-square times and punch count; the day's detail
  carries them, which is the whole reason it exists.

### The dashboard opens on the roll call again (v2.16.0)

Dinesh: *"dashboard tab me bhi space kam karo"*.

**Measured at 1420x1200:** six KPI tiles **265px** in two rows of three, the charts row
**381px** (its height set by Quick stats — six rows at 49px each), and the **roll call, the
thing this page was deliberately made to open on, began at 807px — below the fold.** After:
**134 / 295**, roll call at **588px**.

- The tiles are six abreast from 1200px up instead of three, with smaller icon, value and
  caption. Every tile and every figure stays.
- `.qs-row` padding and icon cut: Quick stats was 294px of list for six numbers, **and it
  set the height of the whole row beside it**, so the charts row shrank with it.
- The roll call's own twelve figures are tighter, scoped to `.roll-call` only — `.stat-row`
  is used on a dozen other screens and shrinking it everywhere is a change nobody asked for.
  The label keeps its two-line reserve, which is what stops *Out of uniform* dropping one
  figure below the other eleven.

**TWO BUGS OF MY OWN, BOTH FOUND BY MEASURING RATHER THAN LOOKING:**

- The first attempt made the tile a flex **row**. `.dash .kpi-head` carries `width: 100%`,
  so as a row item it took the whole tile and pushed the value and caption out — *"ATTENDANCE
  NOT MARKED 9"* printed straight across the tile beside it. Visible in the screenshot, and
  the reason the tile stays a column.
- Then `.kpi-body` ran **70px past its tile**: the base `.kpi` is `align-items: flex-start`,
  which on a COLUMN flex container sizes every child to its own content, so
  `text-overflow: ellipsis` on the caption never came into play because nothing was ever too
  narrow. **The tiles never overlapped each other, so the page looked fine** — only a
  per-child check against its own tile found it. `align-items: stretch` is the fix, plus
  letting the caption wrap: an ellipsis at 185px would have eaten the figure it carries.
- The new breakpoint is **bounded at the bottom** (`min-width: 861px`), because it sits later
  in the file than the phone rules and would otherwise override the ones measured at 390px.
  Re-checked at 1420 / 1100 / 860 / 520 / 390: no overlap, no child outside its tile, no
  sideways page scroll, and the phone still gets one tile a row.

### The salary sheet's own chrome, measured (v2.15.0)

Dinesh: *"salary sheet tab me bhi space kam karo"*.

**Measured at 1420x1200 before touching anything:** six KPI cards **107px**, the five-stage
workflow card **137px**, *Things to check* **117px while folded**, the sub-tabs 35, the
toolbar 36, the hours-decide bar 58 — and `table.sheet` did not start until **667px**.
After: **61 / 52 / 73**, and the table at **489px**.

- **The six figures are a strip, not six boxes.** The `.kpi` cards keep their icons and every
  figure; what goes is the border and padding round each one, and the value sits inline with
  its label. A figure that needs attention is **coloured** (`.kpi.flag b`) rather than boxed,
  because the border had nowhere to sit.
- **The workflow folds to one line, and the DOTS STAY.** Where the month has got to is the
  one thing that must survive the fold, so only the four finished stages lose their caption;
  the current one keeps its label and its reason inline (*"Management approval — waiting for
  approval"*). **`.wf-actions` is never hidden** — the Approve button folding away would be
  the worst possible version of this. Tests assert both, and fail when either is hidden.
- ***Things to check* was printing the pills twice**: `18 warning` `1 info` on the summary
  row and then *"19 open — 0 critical, 18 warning, 1 informational"* underneath it. The
  sentence is gone and the total moved into the heading — **Things to check (19)** — so the
  one figure the pills did not give is kept.
- Opening the workflow gives back exactly the 137px card it was; measured.
- The whole change is CSS plus a fold flag on two components — no figure is computed
  differently, and the full suite is unmoved at 2311.

### Logging a punch that never arrived (v2.14.0)

Dinesh: *"kisi ka punch missing he to manually kaise log hoga"*.

**Inspected first, and three ways already existed** — the four clock boxes in the day menu
on the Attendance grid, the Time tab, and the employee raising a correction from their own
login for the office to approve. The help topic `fix-a-punch` already answered the question
in words. **What did not exist is a way in from the report that finds them.**

`Reports → Missing punch` named the person and the day and then left you to remember both,
change tab, find them in a list of eighty-five and count down to the date. **Fourteenth time
for that shape.**

- The name is a `name-link` button: `onGo('time', { employee_id, day })` → `App` keeps a
  `timeAt`, hands it to `TimeSheet` as `openAt`, and the tab calls **`openPerson`** — the
  same two pieces of state the toggle and the select already set, not a third way of saying
  who is on screen. `onOpened` clears it, so an ordinary visit to the tab does not jump.
- **It opens their MONTH, not the day view**, because the day in question is one row of it
  and the rest of the month is the context for judging the time — including that day's own
  punches under the out box.
- **THE REPORT STILL WRITES NOTHING,** and there is a test for it: no `onSave`, no
  `minutesForMark`. One screen owns typing a clock time, because a second one would be a
  second answer to how a day's minutes are worked out — which is exactly the v2.0.0 bug that
  saved a wrong deduction beside new hours.
- Driven end to end: cleared SUHANI's out time on the 5th → the report listed *"Punched in,
  never out · 10:14"* → clicked the name → Time tab, month view, her month, header
  `DAY / SUHANI KAPADNIS` → typed `19:03` → the row read **8h 49m / −11m** and the server
  stored `minutes = -11`, not a stale 0.
- **The help was amended, not duplicated.** A new line was written on the `time-tab` topic
  and then deleted: `fix-a-punch` already owns this question and owned it better. The same
  call as v1.81's onboarding topic. Its stale half-sentence about the report was trimmed at
  the same time, and `manually` / `haath se` / `punch nahi hua` now reach it.

### The Attendance tab's legend, folded (v2.13.0)

Dinesh: *"attendance tab me bhi same karo"*.

**Inspected and measured first, and the problem was NOT where the Time tab's was.** The
Attendance grid already starts at 271px; nothing above it needed cutting. What was eating
the screen sat **below** it: the `What each mark does to the salary` card at **454px —
bigger than the grid above it (323px)** — so reaching **Sunday working** (1077px) and
**Paid holidays** (1139px) meant scrolling past half a screen of explanation every time.

- It is a `<details className="card fold">`, the exact markup the three other blocks on that
  page already use, so it reads as part of the page rather than as a new idea. **454px → 91px**,
  and the whole tab now fits on one 1200px screen.
- **THE KEY DOES NOT GO INTO THE FOLD.** The summary line spells every mark out in words —
  *P present · A absent · HF half day · CL casual leave · …* — and it is **built from the same
  `codes` object the list inside is built from**, so a mark added later cannot appear in one
  and not the other. A test pins that derivation and that the key sits before the fold.
- What opening adds is the exact salary effect per mark and the five paragraphs on marking a
  whole day, a date range, Mark everyone Present and short hours — read a few times, not daily.

### The Time tab's chrome, measured (v2.12.0)

Dinesh, with a crop of everything above the table: *"ye part bahut space kha raha he"*.

**Measured at 1420x1200 before touching anything:** `Late and early` 156px, `The month's
hours` 146px, the toolbar 54, the usual-day strip 55, the note under it 38 — and
**`table.timesheet` did not start until 681px of a 1,200px window.** More than half the
screen was preamble. After: **414px.**

- **The two rule panels are one line each when closed**, and the rule that governs it is
  *no figure may go into the fold*. `98h 00m · 7 over the concession · 6,600 would be
  charged` and `5 short · 3 over · 2,311 would be deducted` are all still on the closed row,
  with **Charge this month on it** beside them — only the explaining sentence (`late-why`)
  and the person-by-person `<details>` fold away, and the panel's own button brings both
  back. 156/146px → **52px each**. There is a test that the figures are never given
  `display: none`; it fails when they are.
- **`display: contents` on `.late-head`** is what lets the title block and the button become
  items of the card itself, so the figures sit between them on one row. Everything else
  (`<p>`, `<details>`, the rule editor) takes `flex: 1 0 100%` and wraps under it.
- **The note under the usual-day strip now says something or says nothing.** On an agreeable
  month it only repeated the strip directly above it — which already shows `= 9h 00m` in
  green and whether lunch comes off — so it is not rendered at all. **What it must never
  stop saying is the disagreeing case**: timings short of the paid day, which was the
  ~1.66 lakh-a-month bug, still prints in red before anybody presses Fill.
- The test pinning `className={usual.minutes < 0 ? 'warn-text' : undefined}` was
  **rewritten to state the new rule, not patched**: inside the branch that now draws the
  sentence the answer is always `warn-text`, so what is asserted is that the paragraph
  appears only when there is something to say and the mismatch is marked when it does.
- **A JSX comment between two text lines swallows the whitespace**, which is why that note
  read *"is ignored.A day under"*. An explicit `{' '}` is the fix — worth remembering,
  because it looks like a typo in the prose and is not.
- **A `{/* ... */}` comment cannot sit beside the returned element.** Putting the
  explanation above `<section>` inside `return (` made two children of one return and the
  build failed with *Expected ")" but found "className"*. It is a plain `/* */` above the
  `return` now.
- Phone width (420px): the figures take their own line rather than squeezing the button
  off, measured at 137px per card with nothing clipped.

### The calendar — `shared/monthGrid.js`, `TimeCalendar.jsx` (v2.11.0)

Dinesh: *"calcndr bana do usme sari date k dikh ajyenge ya or koi accha option ho to"*,
after *"sare log aane chiaye jitni bar andar gya jitni bar bahar se aaya"*. He was told the
punches were already on five screens and that a 30-square grid cannot hold twelve door
openings legibly; he asked for it anyway, so it is built — and the trade-off is designed
around rather than argued with.

- **A square carries the day's ANSWER** — mark, `in → out`, hours worked, ± minutes, and how
  many punches there were. **Clicking it opens every punch of that day.** Nothing is hidden;
  it is one click away instead of all at once. That is the honest resolution of the thing the
  table does better.
- **IT ASSEMBLES.** `judge` and `entryOf` are handed in from the Time tab — the same pair the
  table and the save path use — so the calendar, the grid and the payslip cannot give three
  answers about a day. A test strips the comments and **forbids `timesToDay` or
  `minutesForMark` inside the component**; it fails when either is put back.
- **A day nobody clocked is a blank square, never nought hours.** `timesToDay` already
  returns `worked: null` for it, so the rule came for free and is stated rather than
  reimplemented.
- **`shared/monthGrid.js` is the layout, and BOTH calendars read it.** The leave calendar had
  worked the weeks out inline since it was built; a second copy is how two calendars come to
  disagree about which square the 1st sits in, so `LeaveCalendar.jsx` was **refactored onto
  it** rather than left alone. A test asserts neither file slices its own weeks.
- **A square with no date is blank, NOT the neighbouring month's date.** On a payroll
  calendar, 29 and 30 October sitting in November read as days of this month. Tested.
- **THE FOLD, MEASURED NOT GUESSED.** The day's detail was first put under the grid — and
  clicking the 2nd landed the answer at **1,286px in a 1,200px window**, under the fold:
  the one thing the click was for. It is above the grid now, measured at 739px, with a test
  pinning the order in the markup. Same mistake and same fix as the attendance day picker's
  clock block.
- **A Sunday has to look like one.** `.lc-cell.off` is `--line-soft`, which measured at
  rgb(251,251,250) against a white cell — a four-step difference nobody sees. It uses the
  attendance grid's own Sunday tint, so the two screens agree about which squares are off.
- It reuses `.lc-grid` / `.lc-cell` / `.lc-date` and the `code-XX` mark tints on purpose:
  two calendars that look different, or a second colour scheme for the same thirteen marks,
  is a worse answer than one that reads the same wherever you meet it. There is a test that
  **every `tc-` class has a rule in `styles.css`** — the invented-class trap, which this file
  has recorded five times.
- **The table stays and is still the only place to type.** The calendar shows; the table
  edits. *Open this day on the table* is on the day's panel.
- Measured at 1420 (grid 1156px, five weeks, 113px squares) and at 420 (squares 55×80, the
  times hidden by the media query, no horizontal scroll of its own).

### Two messages a day, because the hours do not exist yet (v2.10.0)

Dinesh: *"daily report me / daily attendance / late coming / uniform / issue conduct /
inspection — short hours & ot ka report aaj ki date ka dusre din jayega / same day kaise
jayega / uske liye kya solution he"*.

**The honest answer is that it cannot be computed sooner.** Short hours and overtime are
`out − in − lunch`; there is no out time until the person has gone home, and no source has it
earlier — not the readers, not the spool, not the Access database. So the solution is not
arithmetic, it is **when the message goes**: attendance in the morning, the hours after the
last shift, both of them today's. `REPORT_SHAPES` in `shared/dailyReport.js`.

- **`morning`** — attendance, late coming, uniform and the three typed lines. **The hours
  headings are left out altogether**, which is the whole point: at ten in the morning every
  day is still inside its grace, so *"Nobody was short of hours today"* is arithmetically
  true and reads to the group as a clean day's work nobody has done yet. One line says where
  the hours are instead. There is a test asserting that sentence can never appear in this
  shape, and it fails if the shape is ignored.
- **`end_of_day`** — everything, today's. **It is the default**, so a cron or a saved link
  naming no shape gets byte-for-byte the message this report always sent; there is a test
  comparing the two.
- **`with_yesterday`** — one message a day, yesterday's figures under **yesterday's own
  date** (`Short hours — 12 November 2026`), so nothing in it reads as today's.
- **On the 1st, yesterday is in the previous month.** `attendance` is keyed by day of month,
  so day 0 is not yesterday, it is nothing — and reading it would print a confident "nobody
  was short" for a day this payroll has never seen. The route works the date out and hands
  the module `null`; the module names it. Tested on both sides.
- **The shape is suggested by the clock** (`suggestShape`): the morning one until the usual
  day ends, the end-of-day one after it, and a day already gone always gets the whole
  message. It **suggests and says so** — "it is 17:55 and the usual day ends at 18:30" — with
  a link back to the suggestion when it has been overruled. A rule nobody can see is worse
  than one they disagree with.
- **`as_of` stamps the hour** under the date. Omitted, the text is exactly what it was, which
  is how every existing test stayed green.
- `GET /api/people/daily-report` takes `&shape=` and `&as_of=`, so **one scheduled fetch at
  ten and one after the last shift post both messages** with nobody opening the app. That is
  the actual answer to *"same day kaise jayega"* for an automatic send.
- **Said on the panel: the end-of-day message is only as fresh as the last punch import.** An
  out punch the app has not read yet leaves that person's hours unknown — and `open` names
  them rather than counting them as fine, which is the v2.9.0 rule doing its job at the one
  hour it matters most.
- `peopleFor(rows, day)` and `hoursOf(people)` were factored out because this shape reads
  **two** days out of one payroll, and two copies of that mapping is how the hours and the
  attendance would come to disagree about what a mark is.
- **The regex trap, again:** the first API assertion was `!/^Short hours/m`, which matches the
  explanatory line *"Short hours and overtime are not in this message…"* and failed against
  perfectly correct text. Anchor both ends when asserting a heading is absent.
- `.report-shapes` got a real rule before it was used (eighth time for that trap), and
  `.report-fields .hint` hands the hint back to the left — the global `.hint` is
  `text-align: right` because it was written for a figure under a sheet cell, and under a
  form box it reads as a stray ragged-left paragraph. Scoped, as
  `table.timesheet .sticky-name .hint` already is, rather than changing it under every screen.

### Short hours in the daily WhatsApp message (v2.9.0)

Dinesh: *"daily whatup report bana kam time walo ka"*. **Inspected first, and the daily
WhatsApp report already existed** — `shared/dailyReport.js` + `DailyReport.jsx`, built from
his own group's message, with Attendance / Late Coming – Early Going / Uniform / Office
Inspection / Conduct / **Overtime** / Incidents, Copy and an Open WhatsApp link. What was
missing is the mirror of the Overtime section that was already there.

- **`short` is `people.filter(p => p.minutes < 0)`, worst first**, printed with how far short
  and the times behind it — the first thing somebody in the group asks.
- **IT READS THE DAY'S OWN `minutes` AND NEVER RE-READS THE CLOCK.** That is the column the
  salary sheet is paid from, so the message, the roll call and the payslip cannot give three
  answers; a figure the office typed OVER the clock is the one that goes out, because that is
  the one charged. It also follows the month's new `day_grace_minutes` **without knowing the
  grace exists** — a forgiven day carries 0 and is simply not short.
- **Somebody who clocked in and never out is NAMED under the list, never counted as fine.**
  They have no hours to be short of; leaving them out silently makes the list read as the
  whole truth, and those are exactly the names the group asks about.
- A day off can never appear: `minutesForMark` has already zeroed S/SP/HP/PH/CL/SL/PL/A/HF by
  the time the message is built, and there is a test sweeping all nine.
- The folded blurb and the summary line both NAME the new section — twelfth time for that
  shape; a section missing from the sentence that lists them is a section nobody knows is there.
- **THE BUG FOUND WHILE LOOKING:** `Dashboard.jsx` called `readTimes(times)` twice with no
  `deductLunch`, so on a month with the break inside the paid day the roll call reported every
  nine-hour day as 8h 20m, and the day's total hours with it. **The last two places still
  reading the default, three releases after v2.0.0 fixed the Time tab** — the same miss,
  found by reading the call sites before building on them.
- Driven in a browser on a seeded month, after pressing v2.8.0's *Count every minute* on it:
  the message listed VIMAL PATIL 1h 00m, YASNA 15m, SUHANI 11m, Zahid 10m, VISHAL 8m, with the
  three on overtime below — the two releases working together.
- Tests proved by deleting the `short` list: 3 of them fail.

### A name on the Time tab opens that person's month (v2.9.1)

Dinesh: *"yaha pe name pe click kare to pure month ka in out report dikhe wese karo"*.

- **The view already existed** — *One person, whole month* is the pill at the top of the Time
  tab, and it draws every in and out for the month. Reaching it meant scrolling back up and
  finding the name in a select of eighty-five. **THIRTEENTH time for that shape.**
- `openPerson(id)` sets the **same two pieces of state** the toggle and the select already set
  (`setPersonId` + `setView('month')`), rather than growing a third way of saying who is on
  screen. The name is a `<button className="link">` — the established generic, not a new class.
- **Only in the day view.** In the month view that column is a DATE, and a date that opened
  somebody's month would be nonsense; `onOpenPerson` is null there and the label stays plain.
  Pinned by a test, along with the handler and the button.
- Driven: day view → click SUHANI KAPADNIS → month view, 30 rows, header reads *Day*, the
  person picker shows her name, every day reads 10:14 → 19:03, 8h 49m, −11m.

### The date in the header, so a scroll cannot lose it (v2.9.2)

Dinesh: *"date bhi header me daal do"* — straight after he had compared two different days
and asked how one person could have two out times. His crop showed the Time tab with no date
anywhere in it, because the date picker is above the table and had scrolled off the top.

- The sticky header's name cell now carries the day under its own label: **EMPLOYEE / THU 5
  NOVEMBER** in *one day, everybody*, and **DAY / SUHANI KAPADNIS** in *one person, whole
  month*. One cell, two questions — *what are these rows?* and *which day (or whose month) is
  this?* — and the second one is the one a screenshot loses.
- **It is in the STICKY header**, which is the whole point: the figure has to survive the
  scroll that hid the picker. Measured in a browser — header row 46px, `position: sticky`,
  still readable with the table scrolled to the bottom.
- It reuses `weekday()` from `format.js` and the `hint` span the header already used for the
  month view's name, so nothing new was invented to hold it.

### He compared two different days (answered, no change)

*"abdul last out 19:58 / attendnce me 17:14 / how?"*, with two screenshots. They are two
different days, and **his own screenshots prove it**: the lunch windows differ (13:37–14:16
against 11:06–12:10), which one day cannot have. The Attendance menu's own header said
**Sat 21 November**; the Time tab in *One day, everybody* opens on today, the 23rd, and its
date picker had scrolled off the top of his crop. Both figures check out — the 21st is
09:04→17:14 = 8h 10m = −50 (the grid shows `P −50`), the 23rd is 10:50→19:58 = 9h 08m = +8,
forgiven by that month's 15-minute grace, so a dash. **Recomputed before answering rather
than assumed.** Offered to put the date into the Time tab's table header so it survives a
scroll; not built unasked.

## Open questions put to Dinesh and still unanswered
1. **PT on Sunday pay** — the sheet charges PT on the month's gross, which excludes Sunday
   pay. Including it would move exactly two people in April (Mahesh Shinde, Riya Pal) and
   take April's PT from 10,000 to 10,400. Not assumed either way.
2. **`H/O` on his Sunday + Festival register** — implemented as the app's **HP** (worked the
   festival, owed an extra day), because ANCHAL TIWARI had the holiday and is not on the
   register at all. Confirm.
3. **The biometric file's 34 always-absent people** — absent on every day the October machine
   file has a record for. Almost certainly never enrolled, or already left. Named in the dry
   run rather than written through.
4. **Answered in v1.84: both are on.** New months open on `monthly_late` — the monthly hours
   target and the 300-minute concession together, charged as the greater of the two. What is
   still worth settling is the tension with *"time sabka flexible, 9 hrs complete hone chahiye"*:
   with the concession on, arriving late costs money even when the nine hours are completed.
   Anybody genuinely on flexible hours should carry their own shift times, or the office day
   decides when they are late.
5. **Whether paid leave should close a sandwich.** Default is absence only (A/UL); CL/SL/PL
   is available as the harsher reading.
6. **Whether to pull eSSL punches directly** from the eTimeTrackLite database rather than
   importing a file — needs the database engine, whether TSRV can reach DESKTOP-6OKJT47, and a
   read-only login. The file import works today either way.
7. **Which channel the reminder digest should go out on**, and its credentials — the text is
   ready and the endpoint is there; nothing sends it yet.

## Alternative architecture considered (not being built, for reference)
Dinesh shared a diagram of a different pattern: Meta WhatsApp Cloud API (official, business-number-only) → Google Gemini for extraction → MongoDB for storage → BullMQ + Redis for reminder job scheduling → Meta API sends reminder back. This is the "message a bot to log a task" model (active input) vs. the current build's "ambient, reads all your chats" model (passive). We are continuing with the passive/personal-WhatsApp approach already built, not this one, unless Dinesh says otherwise.

## Known constraints / things to respect
- `whatsapp-web.js` is an unofficial library (automates a WhatsApp Web session via Puppeteer/Chromium). It's the standard approach for reading a personal account programmatically, but keep usage passive (reading + occasional self-reminders) — no mass-sending or scraping other people's data — to avoid any account risk.
- Single WhatsApp Business number used across all of Dinesh's ventures is `9909993565` — this personal-WhatsApp task assistant is a separate, distinct thing from that number/setup.
- Dashboard auth is one shared secret (`DASHBOARD_PASSWORD`), which suits a single user. It is not multi-user auth, and messages/tasks sit unencrypted in SQLite. Leaving it unset disables auth entirely — only do that locally.
- The recruitment app is the one project here with a **deliberately public URL**, so `APP_PASSWORD` unset is not merely sloppy there — it exposes every candidate's phone number, salary and CV to anyone who finds the address. Its CVs are strangers' personal data: keep them on disk behind expiring signed links, keep them out of exports, and never commit a database or a `resumes/` folder.
- Do not commit Dinesh's real data in any of these projects: `salary-app/frontend/seed.json` is git-ignored because it carries real salaries, and the same goes for any candidate or payroll database.

## Immediate next steps (in order)
1. Deploy to Railway: root directory `wa-task-assistant`, volume at `/data`, and the variables listed in the README (`ANTHROPIC_API_KEY`, `DATA_DIR=/data`, `DASHBOARD_PASSWORD`, VAPID keys).
2. Scan the QR on the deployed dashboard to link the device.
3. Confirm the pipeline end to end against real messages: send yourself an actionable message, check the task appears, then `POST /api/reminders/run` and check the digest arrives.
4. Install the dashboard to the home screen and tap "Enable notifications" to confirm push works (iOS requires Add to Home Screen first).
5. Ask Dinesh whether he wants chat filtering (allow-list) before scanning all personal chats indefinitely.
