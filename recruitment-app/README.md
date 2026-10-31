# Recruitment app

A placement agency's working system: a vacancy goes out, candidates apply from a
link, the recruiter runs them through a pipeline, and a placement books a fee.

Built for ZYNTA Placement Services. Node + Express + SQLite on the back, React
on the front, plain CSS, no framework — the same stack and the same conventions
as `../salary-app`, so there is one set of habits to learn and not two.

It is **separate from the ZYNTA CRM**, which keeps running alongside. This
starts empty and shares no database with it.

## The flow it implements

1. **A vacancy** — created as a draft, published on purpose. Publishing is what
   makes the apply link live.
2. **Distribute** — open a vacancy and its *Share* tab gives the apply link and a
   WhatsApp-ready advert. The client company's name is never in it.
3. **Candidates apply** at `/apply/REQ-003`. Name and mobile only; everything
   else is optional, because an application that is too much work is one that
   does not arrive.
4. **The CV** goes on disk, never into the database and never into a page. The
   recruiter reads it through a link that expires.
5. **The test** — Dinesh's own test system in an iframe, with a token so a score
   can post back. Set `TEST_EMBED_URL`; blank means the step is simply not offered.
6. **The pipeline** — New → Under Review → Shortlisted → Interview → Offer Sent →
   Selected → Joined, plus Rejected. Drag a card and the message to send appears
   in the corner.
7. **Placement and fee** — recorded when somebody actually starts.

## Two rules the code enforces

**Nothing moves on its own.** The match score orders a queue and the test score
is one more thing to weigh. Neither shortlists anybody and neither rejects
anybody; every move in the pipeline is a person choosing it. There is no
auto-advance and no auto-reject anywhere in this codebase.

**The candidate pays nothing.** The fee is what the hiring company owes on a
placement. Nothing on the public side takes a payment or asks for one.

## Running it

```bash
cd backend && npm install && cp .env.example .env   # set APP_PASSWORD at least
npm start                                           # http://localhost:3003

cd ../frontend && npm install && npm run dev        # http://localhost:5175
```

`npm test` in `backend/` runs the suite (42 tests: the match engine, the stage
machine, the message wording, and the API end to end including the wall between
the recruiter's side and the candidate's).

To serve the dashboard from the API, as the container does:

```bash
cd frontend && npm run build && cp -r dist ../backend/public
```

## Deploying

`backend/Dockerfile` + `railway.json`. On Railway: root directory
`recruitment-app`, a volume mounted at `/data`, and `DATA_DIR=/data` so the
SQLite file **and the CVs** survive a restart. The container builds the
dashboard and serves it from the API on one port.

**Not yet deployed** — no Docker daemon was available to build the image. The
production path was exercised without Docker: `npm ci --omit=dev`, the built
dashboard served out of `backend/public`, auth on, data surviving a restart on
the same `DATA_DIR`.

## Variables

| Variable | Why |
| --- | --- |
| `APP_PASSWORD` | The recruiter side's one shared secret. **Unset means open** — and this app has a public URL by design, so set it. |
| `LINK_SECRET` | Signs CV links and apply-upload tokens. Unset means a new one each boot, so outstanding links break on restart. |
| `PUBLIC_URL` | Where the apply page is reachable. Without it there is no link to share. |
| `DATA_DIR` | SQLite file and `resumes/`. Point at the mounted volume. |
| `TEST_EMBED_URL` | Dinesh's own test system. Blank = no test step. |
| `TEST_PASS_PERCENT` | The pass mark a score is labelled against. Default 50. |
| `AGENCY_WHATSAPP` | For "send today's list to myself". |
| `BRAND_NAME` | What the candidate sees above the job. |
| `FEE_PERCENT` / `FEE_BASIS` / `GST_PERCENT` | `annual` charges the percentage on annual CTC; `monthly` charges it on a twelfth, so 100% monthly is the one-month fee. |
| `REPLACEMENT_DAYS` | The replacement window, dated from joining. Default 90. |
| `MAX_RESUME_MB` / `RESUME_LINK_MINUTES` | Upload limit and how long a CV link lives. |

## Where things are

```
shared/      stages.js  the pipeline, ageing, match bands
             match.js   the scoring engine and the parsers behind it
             messages.js  every word that goes out, and the public shape of a vacancy
             csv.js     the exports
backend/src  db.js      seven tables and everything that reads or writes them
             resumes.js CVs on disk, signed links, upload filtering
             tokens.js  short-lived signed tokens for the public side
             routes/    public.js is the only unauthenticated router
frontend/src components/  the dashboard, plus Apply.jsx and Jobs.jsx (the public pages)
```

`shared/` is dependency-free and imported by both sides, so the browser scores a
candidate and words a message with the exact code the server uses.

## Two surfaces, one wall

Unauthenticated: `/api/public/*` (read a *published* advert, apply, attach a CV,
post a test result) and `/files/resume/:id` (one CV, with a signature that
expires). Everything else needs the bearer token.

The public side cannot list candidates, cannot read one, cannot see a stage or a
match score, and never receives a client company's name — a candidate is told
where they stand by a person, not by a page.

## Matching

Weights: skills 34, experience 24, location 18, salary 14, education 10. The
parsers read what people actually type — `1-3 yrs`, `3.6 LPA`, `fresher`,
`₹10-18k/month`, `Bhayli, Vadodara`. A factor the vacancy does not ask for
cannot be failed, and a factor the candidate has not stated scores half rather
than zero, because "not said" is not "no".

Editing a vacancy's skills, experience or salary re-scores everyone already on
it: the old numbers were measured against the old requirement.

## Notifications

There is no WhatsApp API in here, by design. A placement agency auto-messaging
strangers is how a number gets blocked, and these messages want a human eye
anyway. Every message comes back as text plus a `wa.me` link that opens WhatsApp
on the agency's own number, and a person presses send.

## Still to settle with Dinesh

- The test system's embed URL, and what it posts back.
- The agency WhatsApp number for the reminder digest.
- The real fee model: percentage, basis, GST, and the replacement window.
- Where this will be hosted, so `PUBLIC_URL` can be set and the apply links work.
