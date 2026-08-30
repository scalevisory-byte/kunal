# WA Task Assistant

Reads Dinesh's **personal** WhatsApp, extracts actionable tasks with Claude, stores them in
SQLite, shows them on an installable dashboard, and sends reminder digests back on WhatsApp
twice a day.

```
WhatsApp (linked device, whatsapp-web.js)
        │  incoming messages
        ▼
  buffer (~15s of quiet)  ──►  Claude  ──►  tasks
        │                                     │
        ▼                                     ▼
   messages table ────────────  SQLite  ── tasks table
                                            │
              ┌─────────────────────────────┼───────────────────────┐
              ▼                             ▼                       ▼
     REST API / dashboard (PWA)     node-cron 8:30 & 18:00     web push
                                    → WhatsApp digest
```

## Layout

```
backend/          Node + Express + whatsapp-web.js + better-sqlite3 + node-cron
  src/config.js       env parsing, paths
  src/db.js           schema + all queries
  src/extractor.js    Claude call (structured output → task rows)
  src/whatsapp.js     WhatsApp client, message buffer, batch flush
  src/reminders.js    cron jobs + digest text
  src/push.js         web push fan-out
  src/server.js       Express app, static dashboard
  src/routes/         /api/tasks, /api status + push + manual triggers
  Dockerfile          used by Railway (bundles Chromium)
frontend/         React + Vite dashboard, installable as a PWA
```

## Running locally

```bash
# backend
cd backend
cp .env.example .env        # set ANTHROPIC_API_KEY at minimum
npm install
npm run dev                 # QR code prints in the terminal on first run

# frontend (second terminal)
cd frontend
npm install
npm run dev                 # http://localhost:5173, proxies /api to :3001
```

First run prints a QR code. On the phone: **WhatsApp → Settings → Linked devices → Link a
device**, scan it. The session is saved under `DATA_DIR/wa-session`, so this is a one-time step
as long as that directory survives. The QR is also served at `GET /api/status` and rendered on
the dashboard, which is how you re-link after a deploy without shell access.

## Two capture modes

`EXTRACTION_MODE` decides how tasks get in. Switch it any time; nothing else changes —
the dashboard, reminders and WhatsApp digest work identically either way.

| | `ai` (default) | `manual` |
|---|---|---|
| Who decides what's a task | Claude | You |
| Effort from you | none, it's ambient | forward or tag the message |
| Cost | ~₹275/month at 100 msgs/day | **zero** |
| Anthropic API key | required | **not needed** |
| Other people's messages | sent to the API, stored in `messages` | **never read, never stored** |
| Misses things | occasionally | only if you forget to forward |
| Invents things | occasionally | never |

### `manual` — no AI at all

Two ways to capture, both under your control:

1. **Forward or type into your own "message yourself" chat.** Anything landing there
   becomes a task.
2. **Start a message with the trigger** (`TASK_TRIGGER`, default `#task`) in *any* chat.
   `#task Book Ahmedabad flight tomorrow` creates the task without leaving the conversation.

`quickparse.js` then reads the text you wrote — plain pattern matching, no model:

- **Dates** — `today`/`aaj`, `tomorrow`/`kal`, `parso`, `next week`, `in 3 days`, `Friday`,
  `12/09` (day first), `2026-09-15`, `12th`. The date phrase is stripped from the title,
  including Hindi word order (`kal tak` as well as `by Friday`).
- **Priority** — a leading or trailing `!`, or the words urgent / asap / turant / jaldi.
- **Long forwards** — first line becomes the title, the rest becomes the note.

This works precisely *because you wrote the message*. The same pattern matching aimed at
other people's incoming messages scores about 33% recall on held-out text — it misses two
real tasks out of three. That is why `ai` mode exists and why there is no "keyword mode"
for reading other people's chats.

In manual mode the `messages` table stays empty. Nothing anyone sends you is stored.

### `ai` — ambient

## How extraction works

Every incoming message is written to `messages` immediately. A single debounce timer resets on
each message; after `BATCH_QUIET_SECONDS` (default 15) of quiet, everything buffered goes to
Claude in one request. Batching means a burst of twenty messages costs one API call, not twenty.

Claude gets today's date in `TIMEZONE`, the numbered messages with sender/chat context, and a
system prompt that describes the businesses and says explicitly that returning zero tasks is a
normal outcome. The response is constrained with structured outputs (`output_config.format` +
a Zod schema), so there is no JSON parsing to go wrong. Due dates are re-validated server-side
in `dates.js` — anything that is not a real `YYYY-MM-DD` becomes `null` rather than a bad date.

If the API call fails the messages stay `processed = 0`, so nothing is silently lost, but they
are not retried in a loop.

## Reminders

`node-cron` runs at 08:30 and 18:00 in `TIMEZONE`. Each run takes every open task that is due,
overdue, or has no date at all, sends one grouped WhatsApp digest to `REMINDER_TO` (or the
linked account's own chat), and fires a web push to every subscribed browser.

**Reminders repeat until the task is done.** There is no "already reminded" filter — a task
leaves the digest by being marked done, and by nothing else. Each send increments
`reminder_count`, so a task that keeps being ignored starts showing `asked 4x` in the digest
and `reminded 4×` on its dashboard card. Completing a task drops it immediately; re-opening one
resets the count so it starts over rather than resuming a stale tally.

The count is only incremented if the digest actually reached a channel — if WhatsApp was
disconnected and nobody had push enabled, the counter does not inflate with digests nobody saw.

A digest looks like this:

```
*Your open tasks* — 2026-08-30

🔴 Send GST invoice to Rakesh _(overdue by 6 days)_
   Rakesh · Rakesh Patel — asked 4x
🔴 Pay the Surat vendor advance _(overdue since yesterday)_
   Arrohan Living
🟡 Book Ahmedabad flight for Tuesday _(due today)_
   Meera · Book N Fly Ops

*No date set*
🟡 Share ZYNTA candidate shortlist
   Nilesh

4 still open. They keep showing up here until you mark them done.
```

`POST /api/reminders/run` runs the same code path on demand.

## API

All `/api/*` routes require `Authorization: Bearer <DASHBOARD_PASSWORD>` when that variable is
set. `/healthz` is always open.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/tasks?status=open\|done\|all` | List tasks + counts |
| POST | `/api/tasks` | Create a task manually |
| GET | `/api/tasks/:id` | One task |
| PATCH | `/api/tasks/:id` | Update title / description / contact / due_date / priority / status |
| DELETE | `/api/tasks/:id` | Delete |
| GET | `/api/status` | WhatsApp state, QR code, counts, effective config |
| GET | `/api/messages?limit=` | Recent raw messages (debugging) |
| POST | `/api/extract/flush` | Process the buffer now instead of waiting |
| POST | `/api/reminders/run` | Run the reminder digest now |
| GET | `/api/push/public-key` | VAPID public key |
| POST | `/api/push/subscribe` | Register a browser for push |
| POST | `/api/push/unsubscribe` | Drop a subscription |

## Deploying to Railway

The service must run 24/7 and keep its session file. WhatsApp multi-device means the linked
session keeps receiving messages even when the phone is offline.

1. **New project → Deploy from GitHub repo**, pick this repo.
2. In the service's **Settings → Root Directory**, set `wa-task-assistant`. The Dockerfile at
   `backend/Dockerfile` builds the frontend and installs Chromium for `whatsapp-web.js`.
3. **Add a volume** mounted at `/data`. This is the part that matters: it holds
   `tasks.db` and `wa-session/`. Without it every redeploy loses the tasks and forces a
   re-scan of the QR code.
4. Set variables:

   | Variable | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your key |
   | `DATA_DIR` | `/data` |
   | `DASHBOARD_PASSWORD` | a long random string — **set this, the deploy is public** |
   | `REMINDER_TO` | `919909993565`-style number, or leave empty for the self-chat |
   | `TIMEZONE` | `Asia/Kolkata` |
   | `CORS_ORIGIN` | your Railway URL (the dashboard is served from the same origin) |
   | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | from `npx web-push generate-vapid-keys` |
   | `VAPID_SUBJECT` | `mailto:you@example.com` |
   | `PUPPETEER_EXECUTABLE_PATH` | `/usr/bin/chromium` (already set in the image) |

5. Deploy, open the URL, unlock with the password, and scan the QR shown on the dashboard.
6. Confirm the pipeline: send yourself a WhatsApp message like *"please send the GST invoice to
   Rakesh by tomorrow"*, wait ~20s, and it should appear as a task. Then hit
   `POST /api/reminders/run` to confirm the digest arrives.

Keep `numReplicas` at 1. Two instances would mean two WhatsApp sessions fighting over one
account and duplicate reminders.

## PWA / mobile

The dashboard is installable: `public/manifest.webmanifest` plus `public/sw.js` (app-shell cache
+ push handler). On the phone, open the Railway URL and use **Add to Home Screen**; it then runs
standalone. Tap **Enable notifications** once to register for push — reminder digests then arrive
as phone notifications as well as WhatsApp messages.

Push requires HTTPS (Railway provides it) and, on iOS, that the app has been added to the Home
Screen first — Safari does not allow push from a normal browser tab.

## Notes and constraints

- `whatsapp-web.js` is unofficial — it drives a real WhatsApp Web session through Chromium.
  Usage here stays passive: read incoming messages, send occasional reminders to Dinesh's own
  number. No mass sending, no scraping of other people's data.
- The `9909993565` WhatsApp Business number is a separate thing and is not touched by this.
- **Chat filtering is not implemented.** Every incoming chat is scanned, personal and family
  chats included. See the open question at the end of `CLAUDE.md` before adding an allow-list.
- `DASHBOARD_PASSWORD` is a single shared secret, which is right for one user. It is not a
  multi-user auth system, and messages/tasks are stored unencrypted in SQLite.
