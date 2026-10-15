# Running WA Tasks on your own Windows server (no hosting bill)

Your server (TSRV, Windows Server 2019, 32 GB RAM) stays on all the time, so it
can run WA Tasks instead of Railway. Nothing in the app changes: same
dashboard, same address (tasks.scalevisory.in), same tasks.

You need about one hour, the server, your phone, and these logins: GitHub,
Railway, and wherever the scalevisory.in domain is registered.

> These scripts were written for this server but have not yet been run on
> Windows. If a step fails, send a screenshot of the red text.

---

## Part A: install the app (about 20 min)

**The one-click way.** On the server:

1. Open this page in a browser and sign in to GitHub if asked:
   https://github.com/scalevisory-byte/kunal/blob/claude/new-session-5plccw/wa-task-assistant/deploy/windows/install-all.ps1
   Press **Download raw file** (the download arrow at the top right of the code).
2. In Downloads, right-click `install-all.ps1` → **Run with PowerShell**. Say **Yes** when Windows asks for Administrator.
3. It installs Node.js, Git, Chrome and NSSM by itself, downloads the app into `C:\wa-tasks`, builds it and makes it a Windows service. Keep Railway → your service → **Variables** open, because it asks for:
   - the data folder (press Enter for `C:\wa-tasks-data`)
   - `ANTHROPIC_API_KEY` (leave it blank to run without AI, at no cost)
   - `DASHBOARD_PASSWORD`
   - the two `VAPID` keys (leave blank if Railway has none)
   - the Cloudflare tunnel token (leave blank for now; Part C gives you one, then run the file again)
4. At the end it opens http://localhost:3001. The dashboard should load (empty for now).

Everything it prints is saved to `C:\wa-tasks-install.log`. Running it again is safe: what is already installed or set is left alone.

<details><summary>The same steps by hand</summary>

1. Install Node.js 22 (x64 `.msi` from https://nodejs.org), Git for Windows, Google Chrome, and get `win64\nssm.exe` from https://nssm.cc/download.
2. In PowerShell **as Administrator**:
   ```
   git clone -b claude/new-session-5plccw https://github.com/scalevisory-byte/kunal.git C:\wa-tasks
   cd C:\wa-tasks\wa-task-assistant
   powershell -ExecutionPolicy Bypass -File deploy\windows\setup.ps1
   ```
3. Copy `nssm.exe` into `deploy\windows\`, then:
   ```
   powershell -ExecutionPolicy Bypass -File deploy\windows\install-service.ps1
   ```
</details>

## Part B: bring your data across (10 min)

Do this in one sitting, so no tasks are lost in between.

1. On the **old** app (tasks.scalevisory.in): **Settings → Backups → Download**. This saves a file named like `tasks-2026-10-07.db`.
2. On Railway: open the service → **Settings** → remove the custom domain, or pause the service. From this point the old app stops reading WhatsApp.
3. On the server, stop the new app, put the backup in place, and start it again:
   ```
   Stop-Service WATasks
   del C:\wa-tasks-data\tasks.db-wal, C:\wa-tasks-data\tasks.db-shm -ErrorAction SilentlyContinue
   copy C:\Users\<you>\Downloads\tasks-2026-10-07.db C:\wa-tasks-data\tasks.db
   Start-Service WATasks
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
   (type: Cloudflared), named `wa-tasks`. Choose **Windows** and copy the
   `cloudflared service install …` command it shows. Run `install-all.ps1`
   again and paste that command (or just the long token in it) when it asks
   for the tunnel token. It installs cloudflared and the tunnel for you.
5. Under **Public hostname**, add: subdomain `tasks`, domain `scalevisory.in`,
   service type `HTTP`, URL `localhost:3001`. Save.
6. Open https://tasks.scalevisory.in from your phone. It is now served from your server.

When everything works, delete the Railway project. Nothing is billed after that.

---

## Day-to-day

- **New version from me:** run, as Administrator:
  `powershell -ExecutionPolicy Bypass -File C:\wa-tasks\wa-task-assistant\deploy\windows\update.ps1`
- **Restart:** `Restart-Service WATasks`
- **Logs:** `C:\wa-tasks\wa-task-assistant\logs\`
- **Data** (tasks and the WhatsApp login): `C:\wa-tasks-data\`. The app makes a
  nightly copy in `C:\wa-tasks-data\backups\`. Copy that folder somewhere else
  now and then (Google Drive, a USB drive), because if this one server's disk
  fails, everything on it goes with it.
- If the server restarts (Windows updates), the app and the tunnel start again
  by themselves.
