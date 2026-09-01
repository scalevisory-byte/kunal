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
- **Not yet deployed** — `backend/Dockerfile` and `railway.json` exist but no Docker daemon
  was available to build the image. Root directory `salary-app`, volume at `/data`. The
  production path *was* verified without Docker: `npm ci --omit=dev`, the built dashboard
  served from `backend/public`, auth on, and the SQLite data surviving a restart on the
  same DATA_DIR.

## Alternative architecture considered (not being built, for reference)
Dinesh shared a diagram of a different pattern: Meta WhatsApp Cloud API (official, business-number-only) → Google Gemini for extraction → MongoDB for storage → BullMQ + Redis for reminder job scheduling → Meta API sends reminder back. This is the "message a bot to log a task" model (active input) vs. the current build's "ambient, reads all your chats" model (passive). We are continuing with the passive/personal-WhatsApp approach already built, not this one, unless Dinesh says otherwise.

## Known constraints / things to respect
- `whatsapp-web.js` is an unofficial library (automates a WhatsApp Web session via Puppeteer/Chromium). It's the standard approach for reading a personal account programmatically, but keep usage passive (reading + occasional self-reminders) — no mass-sending or scraping other people's data — to avoid any account risk.
- Single WhatsApp Business number used across all of Dinesh's ventures is `9909993565` — this personal-WhatsApp task assistant is a separate, distinct thing from that number/setup.
- Dashboard auth is one shared secret (`DASHBOARD_PASSWORD`), which suits a single user. It is not multi-user auth, and messages/tasks sit unencrypted in SQLite. Leaving it unset disables auth entirely — only do that locally.

## Immediate next steps (in order)
1. Deploy to Railway: root directory `wa-task-assistant`, volume at `/data`, and the variables listed in the README (`ANTHROPIC_API_KEY`, `DATA_DIR=/data`, `DASHBOARD_PASSWORD`, VAPID keys).
2. Scan the QR on the deployed dashboard to link the device.
3. Confirm the pipeline end to end against real messages: send yourself an actionable message, check the task appears, then `POST /api/reminders/run` and check the digest arrives.
4. Install the dashboard to the home screen and tap "Enable notifications" to confirm push works (iOS requires Add to Home Screen first).
5. Ask Dinesh whether he wants chat filtering (allow-list) before scanning all personal chats indefinitely.
