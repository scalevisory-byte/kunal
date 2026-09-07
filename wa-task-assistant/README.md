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

### Replying on WhatsApp

Every digest line is numbered, so the reminder can be answered without opening the
dashboard:

```
done 2          close line 2          2 ho gaya      kar diya 3
done 1,3        close several         done all       close everything in that digest
snooze 2        push it a day         snooze 2 3     push it three days
```

Replies only count in the chat the digest was sent to, and the parser deliberately
refuses anything that reads like a sentence — *"invoice ka kaam done karna hai"* stays a
message, not a command. Each digest renumbers, so the numbers always refer to the most
recent one. The app confirms what it changed.

### The daily briefing

One message each morning listing what is due today and what is already late, sent to your
own chat. Off by default; `Settings → Daily briefing` turns it on and sets the hour, and
shows a preview of exactly what would go out plus a **Send now** button to check the wiring.

Sending it **once** is the design. The day itself is the claim: a row in `briefings` keyed
on the local date, so a restart, a retry, a second worker, or pressing Send now all find
the day already taken and send nothing. A failed send is the one case that may be retried,
three times at most — a morning with no briefing beats a morning with two.

While the briefing is on, the 08:30 digest stands down so you do not get both.

```
🌅 *Good morning!*

You have:
⚠️ 1 overdue
📋 1 due today

*⚠️ OVERDUE*
1. 🟡 BNF salary transfer
   ⏰ Due: 5 Sept · 6:00 pm

*📋 TODAY'S TASKS*
2. 🔴 GST return file karna
   ⏰ Due: 12:30 pm

Reply *done 2* to close one, or *show overdue* for the list.
```

You can also ask it things: `aaj ke task dikhao`, `pending kaam batao`, or snooze a named
task by duration — `GST audit snooze 2 hours`.

### The weekly review

Same machinery, once a week: what you finished, how much of it was on time, what is still
open, and which chats the work came from. Sunday 8 PM by default. The claim key is the
Monday that starts the week, so "one per week" is the same guarantee as "one per day"
rather than a second thing to get right.

The breakdown adds up to the total — tasks finished with no deadline are counted as
"without a deadline" rather than quietly disappearing between on time and late.

### Reminders at a specific time

A task can also carry `remind_at` — a single reminder at a stated moment, separate from
the twice-daily digest. `EXACT_REMINDER_CRON` (default every 5 minutes) checks for them.

The time is read from the message: `10 baje`, `5 baje shaam`, `at 5pm`, `5:30 pm`, `17:00`.
A bare `10 baje` means daytime; `1`–`7` with no qualifier is treated as evening, which is
how people actually speak. Editing the time on the dashboard re-arms the reminder.

`POST /api/reminders/run` runs the digest on demand; `POST /api/reminders/exact` fires any
exact-time reminders that are due.

## Inside a task

**Checklists.** Steps within one task, with progress on the row. Ticking every box
deliberately does *not* finish the task: completing one cancels its whole reminder ladder
and writes a completion into the permanent record, which is too much to happen as a side
effect of ticking a box. The panel says so and leaves finishing as the explicit act.

**Dependencies.** "This cannot start until that is finished." A blocked task still keeps
its deadline and its reminders — going quiet on a deadline is how things get forgotten —
but the reminder names what is in the way, and so does the row. Finishing a blocker
reports exactly what it freed: only tasks with nothing else waiting. A cycle is refused
when you try to create it, because nothing inside one could ever be started.

**Files.** Invoices, scans, quotations. Bounded twice — 10 MB per file, 200 MB in total —
with the space left shown rather than discovered when an upload fails. The bytes live on
the volume outside the database; an uploaded filename is display text only, since the file
is stored under a random name of the app's own. Orphans left by a crash between the write
and the insert are cleared at boot.

**Templates.** Work you set up the same way each month — a GST filing, an onboarding.
A template holds the title, the usual priority, when it is normally due and the checklist
that goes with it. Using one builds an ordinary task, so the ladder, the history and the
briefing each see a task and nothing new. Templates live in Settings.

## Work with other people

Two sidebar sections, mirroring each other:

**Task received** — work somebody has asked you for. When a request arrives in a chat, the
task records who sent it, and the page groups by that person, so you can see that four of
today's six came from the same place. It is your work: it behaves like any other task.

**Task allotted** — work you have given out. Writing *"Rahul, GST documents kal 5 baje tak
bhej dena"* in a chat files the task against Rahul.

Which way round it goes is decided by **who sent the message, never by what it says**.
*"kar dena"* reads the same whether you wrote it or received it, so a name Claude puts on a
task is honoured only when the message came from you. A request that arrives from Rahul is
work you owe Rahul, whatever the wording. When it cannot tell, it says so and the task
waits in *"Is this a task?"* — filing work against the wrong person means chasing somebody
who was never asked.

**A delegated task is still yours to chase.** The ladder runs exactly as before, and every
reminder comes **to you** — it just says whose desk it is sitting on. The app never
messages the other person on its own. `Nudge`, on the row, composes a message, shows it to
you in full, lets you edit it, and sends it when you press the button; that button is the
only path in the whole app that writes to anybody but you.

You can also set *Given to* by hand, in the new-task form or in the task drawer. Clearing
the box takes the task back, which is the same thing as never having delegated it.

## One job, one task

The same work can reach the list from two directions at once — you type *"Pay BNF TDS today
last date"* into a chat on the 7th, and the monthly rule for the 7th fires the same day.
Both would be created, and each copy carries its own reminder ladder, so one job gets
chased twice a day by two rows neither of which is more real than the other.

Both creation paths now check first, by the same rule: same words, and deadlines within a
week of each other. A week is not a tolerance — it is the gap between one occurrence of a
recurring job and the next. September's TDS is never mistaken for August's (a month
apart), while a salary run entered on Saturday and mentioned again on Sunday is correctly
one job.

Two things about that check had been wrong:

- **The monthly rules never checked at all.** The month's claim stopped a rule firing
  twice, but said nothing about the same job arriving from a chat.
- **The matcher gave up once two copies existed.** It refused to answer when a title tied
  against two open tasks — right for *"which task does this sentence mean?"*, exactly wrong
  for *"is this a copy?"*, where a tie means it is certainly a copy of one of them. So the
  third mention made a third row, and the list grew without limit. Measured: one copy was
  caught, two were not, and never would be again.

Copies already on the list are shown on the dashboard with the oldest offered as the one
to keep. Nothing merges on its own — a word count is a good enough signal to ask about and
a poor one to act on — and what you put away is archived, not deleted.

## When Claude is not sure

The extractor reports how confident it was, and a task it calls **low** is created but not
chased: no reminder, no follow-up, and absent from the morning briefing. It waits in
**"Is this a task?"** on the dashboard for a yes or no, with the original message shown.

Being reminded about something that was never a task is worse than not being reminded,
because it teaches you to ignore the reminders.

That figure is the model's own report, not a measurement the app made, and it is worded
that way everywhere it appears. Saying "not sure" costs the model nothing here, which is
the point — inventing confidence is what produces wrong reminders.

Rejecting one archives it rather than deleting it: what the extractor got wrong is worth
being able to look back at.

## Blocked chats

In `ai` mode, chats you block are dropped before anything is stored or sent to the API —
the message never reaches the `messages` table. Manage them on the dashboard or through
`/api/blocked-chats`.

Names match loosely, so `Mummy` also catches `Mummy ❤️ Home`. Numbers match on their
ending instead, so the same person matches with or without a country code, and a pattern
shorter than 6 digits is refused rather than silently blocking half your contacts.

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
| POST | `/api/reminders/exact` | Fire due exact-time reminders now |
| GET | `/api/blocked-chats` | Blocked patterns + recently seen chats |
| POST | `/api/blocked-chats` | Block a chat by name or number |
| DELETE | `/api/blocked-chats/:id` | Unblock |
| GET | `/api/history` | Finished and archived work, filterable |
| GET | `/api/history/export` | The same rows as a CSV download |
| GET | `/api/briefing` | Today's briefing: preview, and whether it has gone |
| POST | `/api/briefing/run` | Send the briefing now |
| GET | `/api/briefing/weekly` | The week's review, same shape |
| POST | `/api/briefing/weekly/run` | Send the weekly review now |
| GET | `/api/scheduling-settings` | Reminder, briefing and follow-up settings |
| PATCH | `/api/scheduling-settings` | Change them |
| GET | `/api/auth-state` | **Unauthenticated.** Whether a password is required at all |
| GET/POST | `/api/tasks/:id/subtasks` | A task's checklist |
| PATCH/DELETE | `/api/tasks/:id/subtasks/:subtaskId` | Tick, rename or remove an item |
| GET/POST | `/api/tasks/:id/dependencies` | What a task waits on |
| DELETE | `/api/tasks/:id/dependencies/:blockerId` | Stop waiting on one |
| GET/POST | `/api/tasks/:id/attachments` | Files on a task; POST sends the raw bytes |
| GET/DELETE | `/api/attachments/:id` | Fetch or remove one file |
| GET/POST | `/api/templates` | Templates |
| PATCH/DELETE | `/api/templates/:id` | Edit or remove one |
| POST | `/api/templates/:id/use` | Build a task from it |
| GET | `/api/tasks/pending/confirmation` | Extractions Claude was unsure about |
| POST | `/api/tasks/:id/confirm` | "Yes, that is a task" — it enters the ladder |
| POST | `/api/tasks/:id/reject` | "No" — archived, not deleted |
| GET | `/api/tasks/duplicates/open` | Open tasks that are copies of each other |
| POST | `/api/tasks/duplicates/merge` | Keep one, archive the rest |
| GET | `/api/delegation?status=open\|all` | Work received and work allotted, with who is on each side |
| GET | `/api/delegation/counts` | Just the two open counts, for the sidebar |
| POST | `/api/delegation/tasks/:id/assign` | Give a task to somebody; an empty name takes it back |
| GET | `/api/delegation/tasks/:id/nudge` | The follow-up message that would be sent, and whether it can be |
| POST | `/api/delegation/tasks/:id/nudge` | Send it. The only route in the app that writes to anybody but you |

`/api/auth-state` is deliberately outside the gate: the dashboard has to be able to ask
"am I actually protected?" before it holds a token. It reveals only whether a password is
set, never what it is — and if the answer is no, every task was readable anyway.

## Deploying to Railway

The service must run 24/7 and keep its session file. WhatsApp multi-device means the linked
session keeps receiving messages even when the phone is offline.

1. **New project → Deploy from GitHub repo**, pick this repo.
2. In the service's **Settings → Root Directory**, set `wa-task-assistant`. The Dockerfile at
   The `Dockerfile` there builds the frontend and installs Chromium for `whatsapp-web.js`.
   Railway finds it automatically — no Dockerfile path needs configuring.
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

### If the URL shows "Application failed to respond"

That is Railway's own page, and it means the container is not answering — usually a crash
during startup. The app is built so this should not happen: the HTTP server binds **first**,
from nothing but `PORT`, and the database, WhatsApp client and schedulers load after it
inside a try/catch. A failure now leaves a running server that says what broke, on the URL
you already have open, instead of a crash loop that says nothing.

So if you still see Railway's page rather than the app's own "WA Tasks did not start", the
container never got as far as running `node src/index.js` — check the build logs, not the
deploy logs.

The health check answers `200` while degraded on purpose. A `503` would fail the deploy and
put Railway's blank error page back, which is the outcome the fallback exists to prevent;
the body reports `ok: false` either way.

### What lives on the volume

`tasks.db` and the WhatsApp login — and **not** Chromium's cache. The whole browser profile
used to go to `/data`, and during the first WhatsApp sync that directory was measured
growing by roughly 50 MB a minute with nothing ever pruning it. Given enough uptime it fills
the volume, SQLite stops being able to write, and the app stops booting.

Chromium's disk cache now goes to the container's own filesystem (`BROWSER_CACHE_DIR`,
defaulting under the system temp directory), bounded at 64 MB, and whatever an earlier run
left on the volume is deleted at startup. Only the login — IndexedDB, Local Storage,
Cookies — is kept there, which is all that ever needed to survive a restart.

Keep `numReplicas` at 1. Two instances would mean two WhatsApp sessions fighting over one
account and duplicate reminders.

### Known audit finding

`npm audit --omit=dev` reports a high-severity path traversal in `extract-zip`, reached
through `@puppeteer/browsers` -> `puppeteer` -> `whatsapp-web.js`. There is no fix: 1.34.7
is the latest `whatsapp-web.js` and it still pins the affected puppeteer range.

It is not reachable here. `extract-zip` is imported dynamically inside `unpackArchive()`,
which only runs from `@puppeteer/browsers`' install path — the code that unpacks a browser
archive it just downloaded. The image sets `PUPPETEER_SKIP_DOWNLOAD=true` and points
`PUPPETEER_EXECUTABLE_PATH` at Debian's Chromium, so no archive is ever downloaded or
unpacked. Re-check when `whatsapp-web.js` ships a release on a newer puppeteer.

## PWA / mobile

The dashboard is installable: `public/manifest.webmanifest` plus `public/sw.js` (app-shell cache
+ push handler). On the phone, open the Railway URL and use **Add to Home Screen**; it then runs
standalone. Tap **Enable notifications** once to register for push — reminder digests then arrive
as phone notifications as well as WhatsApp messages.

Push requires HTTPS (Railway provides it) and, on iOS, that the app has been added to the Home
Screen first — Safari does not allow push from a normal browser tab.

## Security

What is in place:

- **Brute-force lockout** — 5 wrong passwords from one address locks it out for 15
  minutes, correct password included. A success clears the counter.
  A request carrying **no** token does not count: that is the dashboard on first load,
  not a guess. Counting them spent three or four attempts before the user typed a
  character, so a single typo locked them out for a quarter of an hour.
- **Security headers** via helmet: a CSP that allows only same-origin assets plus the
  `data:` URL the linking QR needs, `frame-ancestors 'none'`, HSTS, nosniff, no
  `X-Powered-By`.
- **`trust proxy`** so the lockout counts the real caller rather than Railway's balancer.
- **Errors say nothing about the internals.** Client errors keep their status (400, 413)
  with a generic message; anything unexpected is a bare 500 and the detail goes to the log.
- **Failed attempts are logged** with the address, and `/api/status` reports how many
  addresses are locked out or failing.
- **100 kB body cap.**

What is still weak, and worth knowing:

- The WhatsApp session file and the SQLite database sit **unencrypted** on the volume.
- One shared password, no second factor.
- The dashboard token lives in `localStorage`.
- Set `CORS_ORIGIN`; unset means every origin is allowed and the app warns loudly at boot.

Leaving `DASHBOARD_PASSWORD` unset disables the gate entirely — fine locally, never on a
public URL. The app no longer leaves that to be discovered: `/api/auth-state` reports it and
the dashboard shows a standing banner saying anyone with the link can read and change
your tasks.

The account-level controls matter more than any of this: turn on 2FA for Railway, GitHub
and Anthropic, and set a spend cap on the API key.

## Notes and constraints

- `whatsapp-web.js` is unofficial — it drives a real WhatsApp Web session through Chromium.
  Usage here stays passive: read incoming messages, send occasional reminders to Dinesh's own
  number. No mass sending, no scraping of other people's data.
- The `9909993565` WhatsApp Business number is a separate thing and is not touched by this.
- **Chat filtering is not implemented.** Every incoming chat is scanned, personal and family
  chats included. See the open question at the end of `CLAUDE.md` before adding an allow-list.
- `DASHBOARD_PASSWORD` is a single shared secret, which is right for one user. It is not a
  multi-user auth system, and messages/tasks are stored unencrypted in SQLite.
