# Running WA Tasks on your own Windows server (no hosting bill)

Your server (TSRV, Windows Server 2019, 32 GB RAM) stays on all the time, so it
can run WA Tasks instead of Railway. Nothing in the app changes: same
dashboard, same address (tasks.scalevisory.in), same tasks.

You need about one hour, the server, your phone, and these logins: GitHub,
Railway, and wherever the scalevisory.in domain is registered.

> These scripts were written for this server but have not yet been run on
> Windows. If a step fails, send a screenshot of the red text.

---

## Part A: install the app (about 30 min)

1. **Install on the server** (all free):
   - **Node.js LTS**, the Windows x64 `.msi` from https://nodejs.org. Use the defaults.
   - **Git for Windows** from https://git-scm.com/download/win. Use the defaults.
   - **Google Chrome**, if it is not already installed.
   - **NSSM** from https://nssm.cc/download. Open the zip and keep `win64\nssm.exe` for step 4.

2. **Download the app.** Open PowerShell **as Administrator** and run:
   ```
   cd C:\
   git clone -b claude/new-session-5plccw https://github.com/scalevisory-byte/kunal.git wa-tasks
   cd C:\wa-tasks\wa-task-assistant
   ```
   If it asks you to sign in to GitHub, sign in with the account that owns the repo.

3. **Build and set up.** Keep Railway → your service → **Variables** open, because you will copy values from there:
   ```
   powershell -ExecutionPolicy Bypass -File deploy\windows\setup.ps1
   ```
   It asks for:
   - the data folder (press Enter for `C:\wa-tasks-data`)
   - `ANTHROPIC_API_KEY` (leave it blank to run without AI, at no cost)
   - `DASHBOARD_PASSWORD`
   - the two `VAPID` keys (leave blank if Railway has none)

4. **Make it a service** so it starts with Windows. Copy `nssm.exe` into `C:\wa-tasks\wa-task-assistant\deploy\windows\`, then run:
   ```
   powershell -ExecutionPolicy Bypass -File deploy\windows\install-service.ps1
   ```
   Open http://localhost:3001 on the server. The dashboard should load (empty for now).

## Part B: bring your data across (10 min)

Do this in one sitting, so no tasks are lost in between.

1. On the **old** app (tasks.scalevisory.in): **Settings → Backups → Download**. This saves a file named like `tasks-2026-10-07.db`.
2. On Railway: open the service → **Settings** → remove the custom domain, or pause the service. From this point the old app stops reading WhatsApp.
3. On the server, stop the new app, put the backup in place, and start it again:
   ```
   nssm stop WATasks
   del C:\wa-tasks-data\tasks.db-wal, C:\wa-tasks-data\tasks.db-shm -ErrorAction SilentlyContinue
   copy C:\Users\<you>\Downloads\tasks-2026-10-07.db C:\wa-tasks-data\tasks.db
   nssm start WATasks
   ```
   Use the real file name. The `del` line removes two leftover files from the
   empty install; if they stayed, they could damage the restored database.
4. Open http://localhost:3001. Your tasks should be back.
5. **Link WhatsApp again:** Settings → WhatsApp connection → **Show a new QR code**. On the phone, open WhatsApp → Linked devices → Link a device, then scan. Then remove the old "WA Tasks" entry (the Railway one) from Linked devices.

## Part C: keep the address tasks.scalevisory.in (20 min)

This uses **Cloudflare Tunnel**, which is free. The server opens no port to the
internet; it connects out to Cloudflare. You do not need to change the firewall
or the router.

1. Make a free account at https://dash.cloudflare.com and **Add a site**: `scalevisory.in`, Free plan.
2. Cloudflare copies your existing DNS records. **Check that every record is
   there**, especially email (MX) and your website, **before** the next step.
3. At your domain registrar (GoDaddy, Hostinger, etc.), change the nameservers
   to the two that Cloudflare shows. This can take a few hours to take effect.
4. In Cloudflare go to **Zero Trust → Networks → Tunnels → Create a tunnel**
   (type: Cloudflared), named `wa-tasks`. Choose **Windows**, download the
   installer on the server, and run the `cloudflared service install …`
   command it gives you in an Administrator PowerShell.
5. Under **Public hostname**, add: subdomain `tasks`, domain `scalevisory.in`,
   service type `HTTP`, URL `localhost:3001`. Save.
6. Open https://tasks.scalevisory.in from your phone. It is now served from your server.

When everything works, delete the Railway project. Nothing is billed after that.

---

## Day-to-day

- **New version from me:** run, as Administrator:
  `powershell -ExecutionPolicy Bypass -File C:\wa-tasks\wa-task-assistant\deploy\windows\update.ps1`
- **Restart:** `nssm restart WATasks`
- **Logs:** `C:\wa-tasks\wa-task-assistant\logs\`
- **Data** (tasks and the WhatsApp login): `C:\wa-tasks-data\`. The app makes a
  nightly copy in `C:\wa-tasks-data\backups\`. Copy that folder somewhere else
  now and then (Google Drive, a USB drive), because if this one server's disk
  fails, everything on it goes with it.
- If the server restarts (Windows updates), the app and the tunnel start again
  by themselves.
