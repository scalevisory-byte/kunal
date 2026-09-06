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
- **SQLite** (`better-sqlite3`) for storage: `messages` table (raw incoming messages) and `tasks` table. A task carries `status` (**open / in_progress / done**), `priority`, `due_date`, `remind_at`, and `origin` (**ai** when the extractor made it, **manual** when it was typed by hand or parsed by `quickparse`). `origin` was added later and back-filled from `source`, so nothing was lost. Anything not `done` still counts as owed: reminders, the digest and the Open view all read `status != 'done'`.
- **node-cron** job runs twice daily (8:30 AM & 6 PM IST) — sends a WhatsApp digest of every open task that is due, overdue, or undated, back to Dinesh's own number. Reminders **repeat every run until the task is marked done**; each send bumps `reminder_count`, which the digest and dashboard show as "asked 4x" / "reminded 4×".
- REST API (`/api/tasks` — GET/POST/PATCH/DELETE) for the dashboard to read/write tasks.

### Frontend (React)
- Laid out as an **application shell**: a fixed left sidebar (Dashboard, My Day, All Tasks, By Chat, AI Tasks, Calendar, Completed, Settings) beside a main column whose top bar carries search with Ctrl-K, notifications, refresh and the linked WhatsApp account. Then a greeting with a New Task button, four KPI cards with tinted icons, a quick-actions card, and **tasks on the left with a summary rail on the right**. Every sidebar item drives the *same* board state — it is navigation over one list, not a second application. Polls every 30s.
- **Settings is its own section**, holding the connection status, the linking QR, the diagnostics block, the AI self-test and the blocked-chats panel. Those used to sit above the task list on every page load; moving them here is what keeps the dashboard clean, and a banner offers a way back when WhatsApp is not connected.
- Icons are **one inline SVG set** (`components/Icon.jsx`) on a 24px stroke grid — no icon font, no dependency, nothing borrowed from elsewhere.
- Below 1180px the sidebar becomes a drawer behind a menu button; below 1080px the rail folds under the board; below 760px everything is one column with a **fixed bottom navigation bar** (My day · Open · + · All · Summary), which is what makes it read as an app on a phone.
- Above the list sits **Focus today**: the two or three tasks that most need attention, ranked overdue → high priority → due today → in progress, taken from the real list; with nothing qualifying it says so rather than showing an empty frame.
- Tasks are **collapsible sections separated by rules and whitespace**, not cards inside cards — Overdue, Today, Tomorrow, This week, Later, No date — switchable to **one section per chat**. A row is a title, a plain-text due date, and a quiet meta line (chat, AI-or-manual, priority), with everything else behind a **⋮ menu** (Start, Due today, Due tomorrow, Details, Delete) that appears on hover and stays visible on touch. Descriptions that merely restate the title are suppressed, in the UI and in the extraction prompt.
- The **summary rail** carries today's figures, a progress bar, a compact month calendar (dots on days with work; clicking one scopes the board to that date), upcoming counts, the WhatsApp/AI state, and recent activity. **Every figure is derived from the loaded tasks** — no placeholder numbers. Recent activity is built from `created_at` and `completed_at`, the only history the app actually records; an edited due date leaves no trace and so is not claimed. A day with nothing scheduled says so rather than showing 0%.
- The **design system** is deliberately plain, but the ground is not flat: a warm linen tone that deepens down the page, under a faint SVG grain, so the white cards read as sheets laid on a surface. The top bar is a **sticky full-width white band** (search stays reachable while scrolling); the task list is one sheet with hairline-separated sections. 4–8px radii, hairline borders, near-zero shadows, one teal accent held back for state, status colour only as a signal. Self-hosted Archivo + IBM Plex Sans/Mono; verified in light and dark.
- **Task detail** opens as a side sheet (a bottom sheet on a phone): title, notes, status, priority, due date and time, reminder preset, and the facts — created, updated, completed, AI-created vs added by hand, the WhatsApp chat, and an expander for **the one original message** that produced the task (joined by `message_id`; no other chat content can reach the client).
- **Search** across title, notes, chat, contact and the source message; a **filter popover** for status, priority, source and chat; and a **My day** view that ranks overdue → in progress → high priority → due today. All of it is applied client-side over one `?status=all` fetch, so switching views costs nothing.
- The connection/pipeline detail collapses to a single line when everything is healthy, and opens itself when something needs attention (not connected, missing API key, a failed extraction, or messages arriving but not being kept).
- Plain CSS in `src/styles.css`, no UI framework. Self-hosted Archivo + IBM Plex Sans/Mono in `public/fonts/` (186 KB, works offline — the same faces as the demo and deploy artifacts, so all three read as one product). Priority is a coloured spine on the card rather than another chip. All text meets WCAG AA in both themes, verified in a browser.

### Two capture modes (`EXTRACTION_MODE`)
Dinesh asked what the product looks like without Claude, citing cost, third-party dependency, privacy, and possibly reselling it. A keyword-based extractor was measured against held-out Hinglish messages and scored 33% recall (missed two real tasks in three), so it was **not** built. Instead there are two honest modes, switchable by env var:
- **`ai`** (default) — Claude reads all incoming chats. Ambient, best quality, ~₹275/month at 100 msgs/day.
- **`manual`** — no AI, no API key, zero cost. Tasks come only from messages Dinesh writes or forwards to his own "message yourself" chat, or any message prefixed with `TASK_TRIGGER` (default `#task`). `quickparse.js` does deterministic date/priority parsing on his own words. Other people's messages are never read and the `messages` table stays empty, which is the privacy answer.

He asked to see both before choosing, so both ship and the dashboard shows which is active.

### Security hardening
- **Brute-force lockout** — 5 failed attempts from an address locks it out for 15 minutes; a success resets the counter. `trust proxy` is set so Railway's balancer isn't counted as one client.
- **helmet** with a CSP that allows same-origin only plus the `data:` URL the linking QR needs, `frame-ancestors 'none'`, HSTS, nosniff, no `X-Powered-By`.
- **Errors leak nothing** — client errors keep their status (400/413) with a generic message; unexpected errors are a bare 500 with the detail logged server-side.
- Failed attempts logged; `/api/status` reports locked-out addresses. 100 kB body cap. Loud boot warning when `CORS_ORIGIN` is unset.
- **Still weak, deliberately deferred:** session file and SQLite unencrypted at rest, one shared password with no 2FA, token in `localStorage`.

### Reply commands, blocked chats, exact-time reminders
- **In `ai` mode your own messages are read too.** One `message_create` listener covers both directions, so a note you type into any chat ("Do bnf salary by today") becomes a task the same way an incoming request does. Reply commands are checked first so `done 2` stays an instruction. Earlier this mode listened to `message` only, which silently ignored everything Dinesh wrote himself - which is how he actually records tasks.
- **Reply on WhatsApp** — every digest line is numbered. `done 2`, `done 1,3`, `done all`, `2 ho gaya`, `kar diya 3`, `snooze 2`, `snooze 2 3`. Works in both modes; only counts in the digest chat. The parser refuses sentence-shaped text so *"invoice ka kaam done karna hai"* stays a message. `commands.js` + `handleCommand()`.
- **Blocked chats** — `blocked_chats` table, dashboard panel, `/api/blocked-chats`. In `ai` mode a blocked chat is dropped *before* anything is stored or sent to the API. Names match loosely (`Mummy` catches `Mummy ❤️ Home`); numbers match on their ending, and a numeric pattern under 6 digits is refused rather than blocking half the contacts. Dinesh chose the blocklist shape over an allow-list.
- **Exact-time reminders** — `remind_at` on tasks, fired by a separate cron (`EXACT_REMINDER_CRON`, default every 5 min), independent of the twice-daily digest. Times parsed from `10 baje`, `5 baje shaam`, `at 5pm`, `5:30 pm`, `17:00`; a bare 1–7 reads as evening. Both `quickparse.js` and the Claude schema produce it.

### Reminder and follow-up engine
The engine chases **Dinesh about his own tasks**. There is no notion of chasing a customer; an earlier pass built that and it was wrong.
- **`tasks.due_at`** is the deadline (migrated from `remind_at`, which had been holding the clock time parsed out of messages). A date with no time uses `defaultDueTime`, read in `TIMEZONE`.
- **The ladder**: one reminder `defaultReminderOffset` before the deadline, one at it, then follow-ups at `followUpOffsets` (default 30 min / 2 h / 16 h after) while the task is still not done. After `followUpMax` the task is flagged **needs attention** and the app stops asking — the difference between reminding and spamming.
- **Only ever one rung is scheduled ahead.** The next is arranged when the current one fires, so a task that gets finished never has a queue of nagging behind it. A rung that has already elapsed keeps its intended distance from when the previous one actually went out, so a long-overdue task does not get three notifications in a minute.
- **Duplicates are impossible twice over**: a partial unique index on `(task, kind, round)` means asking for the same reminder returns the existing one, and delivery claims a row with a conditional `UPDATE ... WHERE status IN ('scheduled','snoozed')` — exactly one caller can win, so a second tick, a restart mid-send or a retry sends nothing.
- **Completion ends everything.** Marking done cancels every pending row and the engine skips finished tasks in both halves of its pass. Rescheduling clears the schedule, resets the escalation count and rebuilds the ladder from the new deadline.
- **State is derived, not stored**: status stays open / in_progress / done, and due / overdue are a function of the deadline and the clock, so there is no column for a job to keep correct.
- **WhatsApp control**: "BNF salary done" marks it done, "sunshine audit kal karunga" reschedules. `task-matching.js` scores word overlap in both directions and returns nothing when two tasks tie or nothing clears the threshold — acting on the wrong task is worse than not acting. Imperatives ("complete kar dena") are not completion reports. The same matcher stops the extractor creating a second copy of a task that already exists.
- Reminders reach the in-app notification centre and, when enabled, a browser push. WhatsApp is off by default and even then only messages Dinesh's own chat. `backend/tests/lifecycle.test.mjs` (36 cases, `npm test`) covers the ladder, spacing, duplicates, claiming, completion, reschedule, matching, timezone and quiet hours.

### AI spend tracking
- Every extractor call writes a row to **`api_usage`** (day, model, input/output tokens, cache tokens, messages, tasks) using the token counts the API itself reports. `GET /api/usage` groups those by day and prices them from `pricing.js` — a small table of Anthropic's published list rates, `claude-sonnet-4-6` at $3/M in and $15/M out, with the date the table was checked.
- The dashboard's **AI Usage** section shows today, this month, all-time and total tokens, plus a daily breakdown. It states plainly that this is an **estimate** from measured tokens at list prices, and that the real bill is in the Anthropic Console, which the app cannot read. Rupees are shown at the rate in `USD_INR` (default 88) with the rate printed next to the figure, so it is never mistaken for a live conversion.
- Spend before this shipped is not recoverable — nothing was recorded then, and the page counts only from its first run rather than back-filling a guess.

### Added since the original spec
- **Deployment config** — `wa-task-assistant/Dockerfile` (bundles Chromium for `whatsapp-web.js`, builds the frontend) plus `railway.json`. The Dockerfile sits at the build-context root so Railway auto-detects it, and carries **no `VOLUME` instruction** — Railway rejects it outright (`docker VOLUME ... is not supported, use Railway Volumes`) and the build dies in ~2s at "Build image". Attach a Railway volume at `/data` instead. `railway.json` also names no `dockerfilePath`, since that resolves against the repo root rather than the service root directory. Set the Railway service root directory to `wa-task-assistant` and mount a volume at `/data` (`DATA_DIR=/data`) so the SQLite file and WhatsApp session survive restarts. Not yet actually deployed.
- **Dashboard auth** — a single shared secret via `DASHBOARD_PASSWORD`. Every `/api/*` route requires `Authorization: Bearer <it>`; `/healthz` stays open. Unset means no auth, which is fine locally but not on a public URL.
- **PWA layer** — `manifest.webmanifest`, a service worker (app-shell cache + push handler), and web push via VAPID keys. Reminder digests go out on WhatsApp *and* as browser/phone notifications. An **Install** button appears where the browser offers one; iOS gets the Add-to-Home-Screen instruction instead, because it never offers the prompt.
- **QR code over HTTP** — `GET /api/status` returns the linking QR as a data URL and the dashboard renders it, so re-linking after a deploy doesn't need shell access.
- **Connection diagnostics in the dashboard** — `GET /api/status` also returns a `diagnostics` block (uptime, boot count, `DATA_DIR`, whether that path is a real mount, whether a WhatsApp session is on disk), and the status panel renders it whenever the session is not connected. The boot count lives in a `meta` table inside SQLite, so a count that resets to 1 after a restart proves the volume is not persisting — which is the reason a scanned QR would keep coming back. Added because Railway's log view was unreadable in screenshots; the diagnosis now lives in the app itself.

### Not yet done
- **Actually deploying it** — the config exists but nothing is running on Railway yet, and the pipeline has never been exercised against the real WhatsApp Web or the real Anthropic API (no key available in the build environment; extraction is verified against a mock of the Messages API).
- **Chat filtering** — in `ai` mode it still scans ALL incoming chats. Dinesh may want an allow-list of specific chats/groups rather than personal/family chats. Ask before building this — not yet decided. (`manual` mode sidesteps it entirely: nothing incoming is read.)
- **Mobile access** — decided against building a native app that reads WhatsApp on-device (no legitimate API for that; workarounds are accessibility-hack/spyware-adjacent territory, ruled out). The PWA above is the answer instead: the backend runs 24/7 in the cloud (works independently of Dinesh's phone thanks to WhatsApp multi-device — a linked device session doesn't need the phone online), and the dashboard installs to the home screen.

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
5. Chat filtering is **decided and built** — a blocklist, manageable from the dashboard.

## Open decisions / not built
- **Scaling to other users is a dead end and Dinesh has accepted that.** Each user needs their own Chromium (~500 MB idle, measured), so 10 users is ~10 GB RAM, and `whatsapp-web.js` commercially breaches WhatsApp's terms. The ambient behaviour that makes this worth having is exactly what stops it being a product. A Business API version would scale legally but loses personal-chat reading and lands in a crowded market (Any.do, Zuno, WapTask, Higgle all ship the "message a bot" model already).
- **Voice-note capture** — probably the highest-value unbuilt feature for his chats, needs a speech-to-text service chosen for Gujarati/Hindi. Not started.
- **Encryption at rest** for the session file and SQLite — deferred, not refused.
