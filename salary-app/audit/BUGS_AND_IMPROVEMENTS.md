# Bugs and improvements

Every bug below was **reproduced during this audit**, not inferred. The evidence is given so
you can check it yourself. Nothing was fixed — the brief says audit only.

---

## Confirmed bugs

### BUG-1 — A GPS punch records a time and nothing else, so a phone-attended month pays everybody as present

**Severity: high. This one costs money.**

What happens: a punch from the employee's link writes the clock time onto the day and
leaves the mark empty and the minutes at zero.

Reproduced, with punching enabled, one employee on ₹26,000:

```
Stored day 1 = {"code": "", "minutes": 0, "in_time": "03:31", ... }

mark on the day      : ''
ot_minutes on the row: 0
worked_minutes       : 0
absent_days          : 0        <- a blank mark is paid in full
```

Why it matters: only `A`, `HF`, `AD` and `UL` reduce salary. A blank day is paid. So if a
branch attends entirely by phone for a month, every person is paid a full month regardless
of whether they punched at all, and no late, early or short-hours figure reaches the sheet.
It is the opposite failure to the biometric importer's, which was deliberately built to
refuse to write 912 false absences — here nothing is written at all.

Where: `backend/src/attendanceSelf.js`, the `setAttendance` call inside `recordPunch`.
It sends `employee_id`, `day`, `in_time` and sometimes `out_time`. No `code`, no `minutes`.

What it should do: the same as the biometric import — set `P` or `HF` from the hours, and
set the minutes — while keeping the existing rule that a day already marked as leave, a
holiday or a Sunday keeps its own mark.

---

### BUG-2 — Working hours become money only when the Time tab is the thing that wrote them

**Severity: high. Same money, different answer depending on which screen was used.**

The server never turns clock times into minutes. `grep -rn timesToDay backend/src/` returns
nothing: the derivation lives in `frontend/src/components/TimeSheet.jsx` and in
`shared/punches.js` (the file importer), and nowhere else.

Reproduced — 26 days of 09:52 → 18:20 (8 h 28 m against a 9 h day) posted through the
attendance API:

```
worked_minutes reported : 13208      <- the hours are stored and exported
ot_minutes (short)      : 0          <- but nothing is charged
```

Meanwhile the Time tab, given the same day, displays:

```
Time tab would display minutes = -32   code P   worked 508
```

So the Time tab shows a 32-minute shortfall per day and the salary sheet charges nothing for
it. Two screens, one database, two answers.

Where: `backend/src/db.js`, `setAttendance`. It stores whatever it is handed and derives
nothing.

What it should do: derive the mark and the minutes in `setAttendance`, from the same
`timesToDay` the Time tab uses, whenever an entry names clock times and does not name
minutes itself. The browser then stops being the only place the rule lives, and BUG-1 and
BUG-3 are fixed by the same change.

---

### BUG-3 — Approving a missing-punch request records the hours but not the money

**Severity: medium. Follows from BUG-2.**

`entryFor` in `shared/attendanceRequests.js` returns only the fields the request named — by
design, so that approving "in at 9:30" cannot blank a typed lunch. But it never names
`minutes`, so approving a missing punch writes the times and leaves the day worth nothing.

An employee whose punch the machine missed, who asks for it and is approved, is paid
differently from one whose day the office typed on the Time tab. Same hours, different pay,
and nothing on screen says why.

Fixed by BUG-2.

---

### BUG-4 — The app runs with no password at all if the variable is unset, silently

**Severity: high in production, harmless on a laptop.**

```js
// backend/src/auth.js
export function requireAuth(req, res, next) {
  if (!config.appPassword) return next();   // <- no password set, no wall
```

Nothing warns at startup and nothing shows in the UI. On a public URL this exposes every
salary, PAN, Aadhaar, bank account and CV to anyone with the address.

What it should do: refuse to start unless either a password is set or `ALLOW_OPEN=true` is
passed deliberately, and print a loud line in the log when it is open.

---

## Improvements worth making

These are not bugs. Each is a place where the app is correct but awkward, or where a known
limit should be said out loud.

### IMP-1 — The dashboard does not show pending approvals, which is the one thing an HR screen is for

The figures all exist (People → Reminders computes them). They are simply not on the page
the app opens on. A tile per queue — attendance requests, leave applications, expense
claims, unanswered questions — each opening the right tab.

### IMP-2 — The birthdays card is usually empty, and that is a data problem, not a code one

`dob` and `joined_on` are blank for most staff, so the card that was asked for by name shows
nothing. The card already says how many people have neither, which is the honest behaviour.
**Do not build anything for this** — fill in the two columns on the Employees table, which
is where they already are.

### IMP-3 — "Branch" needs a decision before anything is built

There are no branches, only companies. Building branches *under* companies when what you
mean by "branch" is BOOKNFLY vs BOOKNFLY VENTURE would add a level nobody uses. See
DEVELOPMENT_PLAN §2 — this is a 10-minute decision that changes a week of work.

### IMP-4 — Asset `value` is doing two jobs

One number is being read as both "what it cost" and "what it is worth". Total cost of
ownership needs purchase cost kept separate from service cost, and neither is a current
valuation. Name the column `purchase_cost` when purchase details go in.

### IMP-5 — Guard duplicate service entries at the point of entry, not in a report

A service typed twice (same asset, same date, same amount) should be caught when it is
saved, with "this looks like the one entered on 14 August — add it anyway?". Catching it in
a report means somebody has already closed the month on a wrong figure.

### IMP-6 — The audit trail says `who` is a typed name; after real logins it should say the user

The trail is deliberately honest that `who` is a name typed on a form, because there are no
accounts. Once items 4–5 of the pending list are built, `who` should come from the session
and the caveat should come off the page.

### IMP-7 — The single-file build cannot hold any of the admin, asset-maintenance or helpdesk work

Nine People panels and everything in modules 6–9 need the server. The single-file build says
so plainly rather than showing empty boxes, which is right. Worth deciding whether that file
remains a deliverable once this is deployed — maintaining two answers for every feature has
already caused two real bugs (the salary breakup was silently dropped there, on both the read
and the write side).

### IMP-8 — Selfie and device checks should be described as deterrents, not controls

If they are built: a link can be forwarded and a phone handed over. A selfie raises the cost
of doing that and makes it visible afterwards; it does not stop it. The punch page already
says this about the geofence, and the same sentence should cover the selfie — otherwise
somebody will believe buddy punching is solved.

---

## Things deliberately left alone

Found during the audit, verified as intentional, and **not** to be changed:

| Looks wrong | Is actually right |
|---|---|
| `absent_days` ignores blank days | A blank day is paid. That is the sheet's own behaviour and 72/74 rows depend on it |
| The biometric import refuses to mark some absences | A day the machine has no record of looks identical to a day everyone was absent. It would have written 912 false absences in the October file |
| Sunday pay is not in the salary sheet's total | You asked for it settled separately. The wage register is the single deliberate exception |
| The late/early concession is off everywhere | It must be a decision, not a default. The panel prices it first |
| PT is charged on the month's gross, not the master salary | Your correction: *"jo payable aayega uspe"* |
| A `(formula)` entry in the audit trail instead of `0` | An override handed back to the formula is not the same as a zero |
| The payslip adds the deduction back into earnings before listing it | So that earnings − deductions still balances to the rupee |
