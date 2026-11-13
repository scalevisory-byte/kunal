# Going live — the plan

The app is finished and tested. What has **not** happened is any of it running
on a real server. This is the order to do that in, what each step costs, and
what can go wrong.

Everything here is on **TSRV**, your own office Windows server, which already
runs ZynTask. Nothing new to buy.

---

## Before you start — three decisions

Nothing can be planned around these until you answer them.

**1. Which month does it go live from?**
Recommended: **December 2026**. Finish November on the file you already have,
so the first month on the server is a clean one. Going live mid-month means
typing half a month of attendance twice.

**2. What data does it start with?**
The master (85 people, salaries, companies) imports from your September sheet
in minutes. Attendance does not — that is typed or imported from the biometric
file. So: import the master, start attendance from day 1 of the live month.

**3. Who gets a login first?**
Not 85 people on day one. **Four or five** — you, Vishal, one from accounts,
two staff who will actually use "My page". Two weeks of that tells you what
85 people will ask.

---

## Stage 1 — Install it (about 30 minutes, one evening)

**Who:** you or Vishal, at TSRV.
**Risk:** low. Nothing else on the server is touched.

Full steps are in `deploy/windows/README.md`. In short: open PowerShell **as
administrator** and paste the one line from that file. It installs Git and
Node only if the machine has none, clones the code, builds, writes the
settings, and registers a Windows service called **BNFHRMS** on **port 3002**
(ZynTask is on 3001 and is not touched).

Then check `http://localhost:3002` on the server itself.

**What to watch for.** These PowerShell scripts have never actually been run —
there is no Windows on the machine they were written on. They have been read,
structure-checked, and two real faults were already found and fixed that way,
but a first run may still stop somewhere. Everything it does is written to
`C:\bnf-hrms-install.log`. **If a step fails, send me that log** and I will fix
the script; do not start fixing it by hand.

**Stop here if it does not come up.** Do not go on to Stage 2 until
`http://localhost:3002` shows the sign-in screen.

---

## Stage 2 — Give it an address (10 minutes)

**Who:** you, in the Cloudflare dashboard.
**Risk:** low, and reversible — removing the hostname undoes it.

TSRV already runs the **WATASK** tunnel (that is how `tasks.scalevisory.in`
works). Add a second hostname to that **same** tunnel — do not install another
one. `hrms` → `scalevisory.in` → `HTTP` → `localhost:3002`.

Within a minute **https://hrms.scalevisory.in** is live, with https, and **no
port is opened on the office router** — the tunnel dials out, nothing dials in.

Then set `PUBLIC_URL` and `SECURE_COOKIES=true` in
`C:\bnf-hrms\salary-app\backend\.env` and restart the service. Without
`SECURE_COOKIES` the sign-in cookie is dropped over https and it reads to
everybody as "the login is broken".

---

## Stage 3 — Lock it down (10 minutes, same evening)

**Who:** you.
**Risk:** low. **Do not skip this one.**

The installer prints an office password. It is a **shared key, not a person**:
full admin, no name on it, and the trail records whatever it does as "the API
key" rather than as you.

1. Sign in with it.
2. The sign-in screen offers to make the first admin — do it, with your own
   username and a password only you know.
3. Delete the `APP_PASSWORD=` line from `.env` and restart the service.

After that the old shared password gets 401 and every action carries your name.

---

## Stage 4 — Put the real data in (half a day)

**Who:** you or whoever keeps the sheet.
**Risk:** medium — this is where a wrong number becomes a wrong payslip.

1. **Import the master** from your September sheet (Reports → import). 85
   people across the four companies, with salaries.
2. **Check it against the sheet.** Headcount per company, and total monthly
   salary. If those two match, the import is right.
3. Fill in what the sheet does not carry and payroll needs: **UAN, ESIC, PAN,
   bank account and IFSC**. Employees → "Still to finish" lists exactly who is
   missing what. This is the slow part, and it is the part that stops a PF
   return bouncing later.
4. **Set departments** — the dashboard's department breakdown is empty without
   them, and it is two minutes with the bulk setter.

---

## Stage 5 — Run one month in parallel (one month)

**Who:** whoever does payroll now.
**Risk:** none — that is the point of running it alongside.

Do the live month **both ways**: the sheet as usual, and the app. At month end
compare, per company: **gross, total deductions, net**. They must agree to the
rupee.

If they do not, the difference tells you which it is — a mark typed in one and
not the other, or a figure the app works out differently. Send me the two
numbers and the company and I will find it.

**Do not hand out staff logins during this month.** One system at a time.

---

## Stage 6 — The pilot logins (one evening, then two weeks)

**Who:** you.
**Risk:** low, and reversible — a login can be deleted.

Admin → Staff logins → tick four or five people → Make logins. Each gets a
username and three-word password, **shown once**. Print the list before you
leave that screen.

Tell them two things: the first sign-in makes them change the password, and
leave applications now go through the app, not WhatsApp.

Two weeks of that. Collect what they ask you; most of it will be the same
three questions, and those are worth fixing before eighty-five people ask
them.

---

## Stage 7 — Everybody (one evening)

Same screen, the rest of the staff, printed in company batches. From here the
sheet stops being the source of truth and the app is.

---

## Running it after that

- **Backups.** The app takes its own nightly copy into `data\backups\`, kept
  14 days. That survives a bad update or a wrong delete. It does **not**
  survive losing the machine. **Copy `C:\bnf-hrms\salary-app\data\` somewhere
  off TSRV on a schedule** — that folder is the business.
- **Updates.** Right-click `deploy\windows\update.ps1` → Run with PowerShell.
  It stops the service, pulls, rebuilds and starts it again in a `finally`, so
  a failed build never leaves the office without an HRMS. Your data is not
  touched.
- **Day to day.** `Stop-Service BNFHRMS` / `Start-Service BNFHRMS` /
  `Get-Service BNFHRMS` in an Administrator PowerShell. Logs in
  `salary-app\logs\`.

---

## If it has to be undone

At any stage before Stage 7, going back is: keep using the sheet. Nothing has
been taken away. To remove the app entirely — `Stop-Service BNFHRMS`, remove
the hostname from the tunnel, delete `C:\bnf-hrms`. ZynTask is untouched
throughout: different port, different service, different folder.

---

## What is still open

- **The test system's URL** for the Hiring module (`TEST_EMBED_URL`). Blank
  means the test step simply is not offered, so this does not block anything.
- **The office WhatsApp number** for the daily digest. The text is written and
  the endpoint is there; nothing sends it until a channel is chosen.
- **The 300-minute late/early concession** is off on every month. The panel
  prices it before it is switched on. Decide when you are ready, not during
  the move.

---

## The short version

| Stage | Who | How long | Can it be undone |
|---|---|---|---|
| 1. Install | you / Vishal | 30 min | yes, delete the folder |
| 2. Address | you | 10 min | yes, remove the hostname |
| 3. Lock down | you | 10 min | — do not skip |
| 4. Real data | payroll | half a day | yes |
| 5. Parallel month | payroll | one month | nothing to undo |
| 6. Pilot logins | you | an evening | yes, delete the logins |
| 7. Everybody | you | an evening | this is the commitment |

Stages 1-3 can be one evening. Then it waits for a clean month.
