# Putting the HRMS online, on your own server

This is for **TSRV** — the office Windows Server that already runs ZynTask.
Nothing here costs anything: the machine is yours, the tunnel is already
installed, and `scalevisory.in` is already on Cloudflare.

**Why a server at all:** an employee cannot apply for leave in an HTML file
on your laptop. There is nothing to sign in to, and anybody holding that
file holds the whole payroll. A login per person needs an address.

---

## 1. Install it (about ten minutes)

On TSRV: **Start → type `powershell` → right-click Windows PowerShell →
Run as administrator.** Then paste this one line and press Enter:

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $f = "$env:TEMP\hrms-install.ps1"; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/scalevisory-byte/kunal/claude/salary-calculation-software-ujbufn/salary-app/deploy/windows/install-all.ps1' -OutFile $f; Unblock-File $f; & $f
```

That is the whole install. Watch it in that window.

**Why a pasted line rather than downloading the file and double-clicking it.**
Three things go wrong that way on Server 2019, and all three look like the
app is broken rather than like Windows being careful:

- its PowerShell offers **TLS 1.0 first**, which github.com refuses — so
  the download fails with a connection error that says nothing useful. The
  line above sets TLS 1.2 before it fetches anything;
- a file downloaded in a browser is **marked as from the internet**, and
  PowerShell then either refuses it or asks a question about an untrusted
  publisher. `Unblock-File` clears that mark;
- double-clicking makes the script **ask for Administrator and open a
  second window**, so if anything fails you watch it vanish. Starting from
  an Administrator window means it runs in front of you.

If you would rather do it by hand, the file is at the URL above and
right-click → **Run with PowerShell** does work — it asks for
Administrator itself — but expect the two prompts.

It installs Git and Node only if the machine has none, fetches NSSM, clones
the code into `C:\bnf-hrms`, builds the dashboard, installs the server
packages, writes the settings, and registers a Windows service called
**BNFHRMS** that starts with the machine.

Everything it does is written to `C:\bnf-hrms-install.log`.

When it finishes it prints the **office password**. Write it down — that is
the password for the whole app. It is also in
`C:\bnf-hrms\salary-app\backend\.env`, which you can edit by hand; the
installer never overwrites that file.

Check it on the server itself: **http://localhost:3002**

### Two things it does deliberately

- **It does not touch the server's Node.** ZynTask runs on it. `better-sqlite3`
  only ships a ready-made binary for Node 22, and on anything else npm falls
  through to a compiler this server does not have — that cost a whole
  install the first time ZynTask went on. So if TSRV's Node is not 22, the
  HRMS keeps a private copy in its own folder and uses that.
- **Port 3002**, so it cannot collide with ZynTask on 3001.

---

## 2. Give it an address

TSRV already runs a Cloudflare Tunnel (the **WATASK** tunnel, installed as
the `Cloudflared` service, which is how `tasks.scalevisory.in` works). Add a
second hostname to that **same** tunnel — do not install another one.

In the Cloudflare dashboard → **Zero Trust → Networks → Tunnels → WATASK →
Published application routes → Add**:

| Field | Value |
|---|---|
| Subdomain | `hrms` |
| Domain | `scalevisory.in` |
| Service type | `HTTP` |
| URL | `localhost:3002` |

Saving it creates the `hrms` DNS record automatically. Within a minute
**https://hrms.scalevisory.in** is live, with https, and **no port is open
on your office router** — the tunnel dials out, nothing dials in.

Then open `C:\bnf-hrms\salary-app\backend\.env` and check:

```
PUBLIC_URL=https://hrms.scalevisory.in
SECURE_COOKIES=true
```

and restart the service (below). `SECURE_COOKIES` matters: behind https the
sign-in cookie should be marked Secure, and on plain http a Secure cookie is
silently dropped — which reads to everybody as "the login is broken".

---

## 3. Make your own login, then retire the shared password

The password the installer printed is a **shared key, not a person**. It is
full admin, it has no name on it, and the trail records whatever it does as
*"the API key"* rather than as you. It is there to get you in the first
time.

So, once:

1. Sign in at **https://hrms.scalevisory.in** with that password.
2. The sign-in screen offers to **make the first admin** — do it. Pick your
   own username and a password only you know.
3. Open `C:\bnf-hrms\salary-app\backend\.env`, **delete the
   `APP_PASSWORD=` line** (or comment it out with a `#`), and restart:

```powershell
Stop-Service BNFHRMS
Start-Service BNFHRMS
```

That is it. Checked on a real server: with the line gone the old shared
password gets **401**, a request with no credentials gets **401**, your own
login still signs in and works, and every action now carries **your name**
instead of "the API key".

It still starts after you remove it, because named logins now exist — the
app refuses to run with *nothing* guarding it, not with no shared password.

> Keep `APP_PASSWORD` only if you later want something on a schedule to call
> the API without a person. Nothing does today.

### The four kinds of login

| Role | Can | Cannot |
|---|---|---|
| **Admin** | everything | — |
| **HR** | employees, attendance, leave, payroll, assets — **salaries included** | make logins, change a month's settings, close a month |
| **Viewer** | look at everything | change anything |
| **Staff** | their own payslips, attendance and leave | see anybody else at all |

The line between Admin and HR is **not what they can see** — HR can see
salaries, that was your decision. It is what they can change about the
installation itself. HR runs payroll; Admin decides the rules payroll runs
on.

Driven against a real server, as codes: Admin read 200 / write 201 / make a
login 201 / close a month 201. HR 200 / 201 / **403** / **403**. Viewer 200
/ **403** / **403** / **403**. And it is enforced on the server, not by
hiding buttons — a Viewer who knows the URL still cannot write.

**Admin → Logins** is where you add HR and Viewer logins for the office.

---

## 4. Give the staff their logins

Sign in as yourself, then:

**Admin → Staff logins → tick the people → Make logins.**

You get a username and a password for each, like
`nidhi.shah` / `copper-river-130`. Three real words, because they get read
out loud across a counter.

**The password is shown once and only there.** It is stored as a hash, so
there is nowhere else it could ever come from. Print the list or copy it
before you leave that screen. If one is lost, reset it from the same page.

The first time somebody signs in they **must** change it — a password you
read out is temporary, and the app enforces that rather than trusting it.

### What a staff login can and cannot do

Signed in as themselves they see **their own** record: salary and how it was
worked out, attendance, payslips to download, leave balance, loans.

They **cannot** see anybody else. Driven against a real server: a staff
login asking for `/api/employees` or `/api/periods` gets **403**. They have
no ability to read the office side at all, only `/api/me`.

---

## 5. How an employee applies for leave

They sign in → **My page → Leave → Apply**.

- They pick real dates inside the month, and casual / sick / privilege.
- A fortnight off is **one** application and **one** decision, not fourteen.
- A few hours off is **Short leave**, in minutes, and the app refuses a whole
  day or more there and tells them to apply for leave instead.

**Nothing is written onto the attendance grid while it is pending.** A
request is a request; only an approval writes attendance. That is the rule
the whole module hangs on.

You approve it at **Reports → Attendance → "Attendance corrections and
approvals"** — under Reports, not under the Attendance tab. It asks you to
confirm, because approving is the one thing on that page that changes what
somebody is paid.

On approval every day in the span is written in one go — a half-approved
fortnight cannot exist — with the reason they typed carried onto each day
and the day marked as allowed.

Proven end to end on a real server: Nidhi applies for 18–20 November as
casual leave → pending, **0 marks on the grid** → approved → days 18, 19 and
20 all read `CL`, reason *"Sister's wedding"* on each, allowed ✓, and her
balance reads **CL taken: 3**.

---

## 6. Running it day to day

In an Administrator PowerShell:

```powershell
Stop-Service  BNFHRMS
Start-Service BNFHRMS
Get-Service   BNFHRMS
```

Use these rather than `nssm.exe`, which lives in the kit folder and is not
on the PATH.

- **Logs:** `C:\bnf-hrms\salary-app\logs\` (`hrms.log`, `hrms.err.log`,
  rotated at 10 MB).
- **Your data:** `C:\bnf-hrms\salary-app\data\` — `salary.db` plus the
  documents, asset photos and CVs. **This folder is the business.** Copy it
  somewhere off TSRV on a schedule.
- The app also takes its own nightly SQLite copy into `data\backups\`, kept
  for 14 days. That survives a bad update or a wrong delete. It does **not**
  survive losing the machine, which is why the sentence above exists.

### Updating

```
C:\bnf-hrms\salary-app\deploy\windows\update.ps1
```

Right-click → Run with PowerShell. It stops the service first (Windows locks
a running app's files and npm otherwise fails halfway), pulls, rebuilds, and
starts it again in a `finally` — so a failed build never leaves the office
without an HRMS. Your data is not touched.

---

## What has and has not been tested

**Tested here, against a real server:** a clean checkout, `npm install
--omit=dev`, the dashboard built and served by the server itself, the API
returning 401 without a password, a staff login created and signed in,
403 on the office routes, a three-day leave applied → pending → approved →
written to the grid, the balance following, and the data intact across a
restart.

**Not tested here:** the PowerShell itself. There is no Windows and no
PowerShell on the machine these were written on, so they have been read,
structure-checked and reasoned about, but never run. Since then a review
found and fixed two real faults in them — one that would have put a
doubled backslash in the settings file, and one that would have **deleted
`C:\bnf-hrms` and the payroll inside it** if the folder existed without a
`.git` in it, which is exactly what a clone that failed halfway leaves
behind. It now stops and says so instead. That is the kind of thing a
reading finds and a run would have found the hard way, so read the log as
it goes. They follow the same shape as the ZynTask kit
that did install on TSRV, and the traps that one hit the first time — TLS
1.2, the Node version, the BOM on `.env`, stopping the service before
replacing its files, NSSM not being on the PATH — are all handled here. Run
`install-all.ps1` with the log open, and if a step fails, send me
`C:\bnf-hrms-install.log` and I will fix it.
