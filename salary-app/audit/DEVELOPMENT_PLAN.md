# Development plan

Nothing in here has been started. It waits on your approval.

The order is chosen on one rule: **anything that makes the app pay a wrong number comes
before anything that adds a feature.** Two of the four confirmed bugs are in that class.

---

## 1. Before any code — three decisions from you

Each changes what gets built. None takes long to answer.

### Decision A — What does "branch" mean?

Today there are **companies**: BOOKNFLY PRIVATE LIMITED, BOOKNFLY, BOOKNFLY VENTURE LLP,
SCALE. A filter runs across the whole app on them.

| Option | What it means | Work |
|---|---|---|
| **A1 — Companies *are* branches** | Rename the label. Nothing structural changes | Half a day |
| **A2 — Branches sit under a company** | A new `branches` table; employees and assets point at a branch; the filter becomes two levels | 3–4 days, and it touches every tab |

**My recommendation: A1**, unless you have two offices inside one legal entity — a Vadodara
and a Surat office of BOOKNFLY PRIVATE LIMITED that need separate attendance and separate
asset registers. If you do, say so and it is A2.

### Decision B — Who gets a login, and can they see salaries?

Three roles is the simplest thing that works:

| Role | Can |
|---|---|
| **Admin** | Everything, including payroll amounts, settings and the trail |
| **HR** | Employees, attendance, leave, assets, maintenance, reports — **but not salary figures or payroll** |
| **Viewer** | Read-only reports |

Tell me whether HR should see salaries. It changes how the payroll screens are guarded.

### Decision C — Fix BUG-1 and BUG-2 now, or after the asset work?

They are payroll bugs. My recommendation is **now, first, before anything else** — but it
touches `setAttendance`, which every attendance path goes through, so it is the one change
in this plan that carries real risk. It needs your approval specifically because fixing it
**will change what some already-entered months pay** (any month with punched or
request-approved days will start charging short hours that it currently ignores).

**If any month is already closed and paid on the current behaviour, say so** — the fix should
then apply only from a nominated month forward.

---

## 2. Phase 1 — Correctness (3–4 days)

Nothing new. Only making the app pay what the screens already say it pays.

| # | Work | Why first |
|---|---|---|
| 1 | Derive the mark and the minutes inside `setAttendance` from the clock times, using the same `timesToDay` the Time tab uses | Fixes BUG-1, BUG-2 and BUG-3 in one place, and stops the rule living in the browser |
| 2 | Keep the existing merge rules intact — a day marked as leave, a holiday or a Sunday keeps its mark; naming one field must not blank another | These rules have tests; they must still pass |
| 3 | Tests: a punched day, an approved missing punch, and a hand-typed day with identical hours must produce identical pay | The whole point of the phase |
| 4 | Refuse to start with no password unless `ALLOW_OPEN=true` | BUG-4 |
| 5 | Re-run the October 115-row and September 85-row reconciliations and confirm nothing else moved | Non-negotiable before this ships |

**Done when:** the same hours pay the same money whichever screen wrote them, and the two
real-data reconciliations are unchanged except where punched days now charge short hours.

## 3. Phase 2 — Admin and security (4–5 days)

The app cannot go on a public URL before this.

| # | Work |
|---|---|
| 6 | `users` table; scrypt from `node:crypto`; signed session cookie; login and change-password screens |
| 7 | The three roles from Decision B, enforced **on the server** per route — not by hiding buttons |
| 8 | `who` in the audit trail comes from the session; the "a typed name" caveat comes off the page |
| 9 | Login audit: who, when, from where |
| 10 | Nightly `VACUUM INTO` backup on the data volume, with retention and a **written restore procedure that has been tried once** |
| 11 | Branch per Decision A |

No new framework, no new dependency. The purpose-scoped token module already in the project
is reused.

**Done when:** three accounts with three roles behave differently against the API, a backup
has been restored successfully once, and the server refuses to run open by accident.

## 4. Phase 3 — Assets, properly (5–6 days)

| # | Work |
|---|---|
| 12 | Asset code (`BNF-LAP-014`), unique, per-company series |
| 13 | Purchase date, vendor, invoice number, warranty-until; rename `value` to `purchase_cost` |
| 14 | QR as inline SVG from the asset code, plus a printable sheet of labels. No paid service |
| 15 | Asset-wise history view — purchase, every handover, every return, every service, in one timeline |
| 16 | Verification round: tick or scan down a list, record who verified and when, report what was not found |
| 17 | Asset register and handover reports as files; a handover slip per employee to sign |

**Done when:** a laptop can be registered, labelled, issued, verified in a stock-take and
reported on, and its whole life reads on one page.

## 5. Phase 4 — Asset maintenance (4–5 days)

| # | Work |
|---|---|
| 18 | `asset_services`: asset, date, what was done, vendor, cost, next service date |
| 19 | **Duplicate guard at entry** — same asset, same date, same amount asks before saving (IMP-5) |
| 20 | AMC and warranty dates on the asset, flagged at 30 days and when expired |
| 21 | Total cost of ownership per asset: purchase cost + every service cost, kept separate |
| 22 | Reminders: next service due or overdue, on the dashboard and in the existing digest. **No new sending channel** |
| 23 | Maintenance and service cost report |
| 24 | Tests for the three figures the brief asks about, which cannot be tested today |

**Done when:** the three cost checks in your §6 can actually be run.

## 6. Phase 5 — Finishing the brief (2–3 days)

| # | Work |
|---|---|
| 25 | Dashboard: pending-approvals tile, asset summary, maintenance alerts |
| 26 | Leave report as CSV and print |
| 27 | Employee master export |
| 28 | One settings screen for shift times, concession, hours per day and the PT slab |

## 7. Phase 6 — Deploy (1–2 days)

| # | Work |
|---|---|
| 29 | Build the image, deploy, mount the volume at `/data`, set the variables |
| 30 | Confirm the data survives a restart; confirm the backup runs; restore it once |
| 31 | Then, and only then, hand out a URL |

**This should arguably run earlier.** Nothing has ever run outside a laptop, and the first
deployment always finds something. If you would rather be live sooner, do Phases 1–2 and
then Phase 6, and let the asset work land on a running system.

---

## 8. Total

| Phase | Days | Cumulative |
|---|---|---|
| 1 — Correctness | 3–4 | 4 |
| 2 — Admin and security | 4–5 | 9 |
| 3 — Assets | 5–6 | 15 |
| 4 — Maintenance | 4–5 | 20 |
| 5 — Finishing | 2–3 | 23 |
| 6 — Deploy | 1–2 | 25 |

About **five weeks** at this pace, and the first nine days are the ones that matter.

---

## 9. What this plan deliberately does not do

- **No new technology.** Node, Express, SQLite, React, plain CSS. No ORM, no UI framework,
  no queue, no Redis, no second database.
- **No new modules beyond your nine.** Hiring, appraisals, tasks, the helpdesk, sandwich
  leave and the rest already exist and are left exactly as they are — not extended, not
  removed.
- **No automation.** Nothing will auto-approve, auto-mark or auto-pay. The one existing rule
  stands: a request never writes attendance; an approval does.
- **No change to any formula or policy** without you saying so first. 26 days, the 300-minute
  concession, PT on gross, Sunday pay settled apart, PL-only encashment and the gratuity
  formula all stay as they are.
- **No TDS.** No salary here is near the threshold. It goes in when somebody crosses it.
- **No per-employee logins.** 115 accounts is a support burden; the signed personal link
  already covers punching, leave and the helpdesk.

---

## 10. What I would skip entirely

| Skip | Why |
|---|---|
| Selfie capture | Raises the cost of a forwarded link; does not stop it. Build it if you want the deterrent, but do not expect it to solve buddy punching, and do it after Phase 4 |
| Device verification | Same. A new phone is normal, so it can only ever be a flag |
| Real-time eSSL device link | File import works. Needs the device model confirmed and a public URL first |
| Depreciation | Only if the accounts side asks. Purchase and service cost come first |
| Sending the reminder digest automatically | The text and the endpoint exist. Pasting it into WhatsApp works today; wiring a sender needs credentials and the task assistant's existing session is the safe route |
| The single-file build, long-term | Once this is deployed, maintaining two answers for every feature has a cost — it has already caused two real bugs. Worth a decision, not urgent |
