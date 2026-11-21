import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { photoFile, photoLinkValid } from './assetPhotos.js';
import { docFile, docLinkValid } from './assetDocs.js';
import { getAssetDoc, getAssetPhoto } from './people.js';
import { log } from './logger.js';
import {
  hidePay,
  requireAdminForChanges,
  requireArea,
  requireAuth,
  touchSession,
  requireRead,
  requireWriteForChanges,
} from './auth.js';
import { meRouter } from './routes/me.js';
import { getCandidate, getCandidateDocument } from './hiring.js';
import { getDocument } from './db.js';
import { documentFile, documentLinkValid } from './documents.js';
import { resumeFile, resumeLinkValid } from './resumes.js';
import { hiringRouter } from './routes/hiring.js';
import { publicRouter } from './routes/public.js';
import { onboardSelfRouter, onboardingRouter } from './routes/onboarding.js';
import { attendanceSelfRouter } from './routes/attendanceSelf.js';
import { punchRouter } from './routes/punch.js';
import { companiesRouter } from './routes/companies.js';
import { frontOfficeRouter } from './routes/frontOffice.js';
import { VERSION } from '../../shared/version.js';
import { leaveRouter } from './routes/leave.js';
import { loansRouter } from './routes/loans.js';
import { employeesRouter } from './routes/employees.js';
import { authRouter } from './routes/auth.js';
import { peopleRouter } from './routes/people.js';
import { periodsRouter } from './routes/periods.js';
import { reportsRouter } from './routes/reports.js';
import { ATTENDANCE_CODES, STANDARD_WORKING_DAYS } from '../../shared/calc.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, '../public');

export function createServer() {
  const app = express();

  // Anything in front of this terminates TLS, so req.ip has to come off the
  // forwarded header for the apply form's rate limit to mean anything.
  app.set('trust proxy', true);
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));

  /*
   * Keep the signed-in clock running while somebody is working, and take a
   * dead cookie off the browser. It refuses nothing - an idle session simply
   * stops resolving to an actor, and each route's own requireAuth answers
   * 401 exactly as it did before.
   */
  app.use(touchSession);

  // Unauthenticated: lets a load balancer or Railway health check reach the app.
  /*
   * The version, where it can be read WITHOUT signing in.
   *
   * Three afternoons were spent on a bug that had already been fixed,
   * because there was no way to answer "which build is actually running?"
   * except by signing in and reading the rail. Open /healthz in the browser
   * and it says.
   */
  app.get('/healthz', (req, res) => res.json({ ok: true, version: VERSION }));

  /*
   * The hiring module has the only two unauthenticated surfaces in this app:
   *
   *   /api/public  - a candidate reading a published opening and applying,
   *   /files       - one CV, through a signature that expires.
   *
   * Neither can reach an employee, a salary sheet or an attendance row. The
   * payroll side stays entirely behind the password.
   */
  app.use('/api/public', publicRouter);
  /*
   * An employee's own punch page. No password - a hundred and fifteen people
   * are not going to be given logins - but the token in the link says who they
   * are, and it can do only three things: punch as that person, see their own
   * punches, and raise a request. It cannot read anybody else, cannot see a
   * salary, and cannot approve anything.
   */
  app.use('/api/punch', punchRouter);
  /*
   * SOMEBODY FILLING IN THEIR OWN JOINING FORM, before they are an employee.
   *
   * No password, because there is nobody to be yet: the token in the link
   * says which invitation, and the invitation id is read from the TOKEN
   * rather than the URL, so one link cannot reach another person's form. It
   * can do three things - read its own form, save it, send it in - and
   * nothing it sends can create an employee. Only an approval in the office
   * does that.
   */
  app.use('/api/join', onboardSelfRouter);

  app.get('/files/resume/:id', (req, res) => {
    const candidate = getCandidate(Number(req.params.id));
    if (!candidate) return res.status(404).json({ error: 'not found' });
    if (!resumeLinkValid(candidate, req.query.exp, req.query.sig)) {
      return res.status(403).json({ error: 'This link has expired. Open the candidate again.' });
    }
    const file = resumeFile(candidate);
    if (!file) return res.status(410).json({ error: 'the file is missing from disk' });
    res.download(file, candidate.resume_name || path.basename(file));
  });

  /**
   * An employee document, through the same kind of expiring signature a CV
   * uses. A browser cannot put a bearer token on an <img src> or a download
   * click, which is the whole reason these links are signed instead.
   */
  app.get('/files/document/:id', (req, res) => {
    const doc = getDocument(Number(req.params.id));
    if (!doc) return res.status(404).json({ error: 'not found' });
    if (!documentLinkValid(doc, req.query.exp, req.query.sig)) {
      return res.status(403).json({ error: 'This link has expired. Open the record again.' });
    }
    const file = documentFile(doc);
    if (!file) return res.status(410).json({ error: 'the file is missing from disk' });
    res.download(file, doc.file_name || path.basename(file));
  });

  /**
   * A candidate's own document - Aadhaar, a marksheet, the last payslip.
   *
   * Its own route and its own SCOPE in the signature. Candidate documents and
   * employee documents are separate tables with separate id sequences, so
   * both have a number 5; a signature that named only the number would let a
   * link to one verify against the other.
   */
  app.get('/files/candidate-document/:id', (req, res) => {
    const doc = getCandidateDocument(Number(req.params.id));
    if (!doc) return res.status(404).json({ error: 'not found' });
    if (!documentLinkValid(doc, req.query.exp, req.query.sig, { scope: 'candidate-document' })) {
      return res.status(403).json({ error: 'This link has expired. Open the record again.' });
    }
    const file = documentFile(doc);
    if (!file) return res.status(410).json({ error: 'the file is missing from disk' });
    res.download(file, doc.file_name || path.basename(file));
  });

  /*
   * A photograph of an asset. Same expiring signature as a document, for the
   * same reason: a browser cannot put a bearer token on an <img src>.
   *
   * Sent inline rather than as a download, because this one is looked at on a
   * page rather than saved.
   */
  app.get('/files/asset-photo/:id', (req, res) => {
    const photo = getAssetPhoto(Number(req.params.id));
    if (!photo) return res.status(404).json({ error: 'not found' });
    if (!photoLinkValid(photo, req.query.exp, req.query.sig)) {
      return res.status(403).json({ error: 'This link has expired. Open the asset again.' });
    }
    const file = photoFile(photo);
    if (!file) return res.status(410).json({ error: 'the photo is missing from disk' });
    res.sendFile(file);
  });

  /**
   * An asset's paperwork, behind the same expiring signature.
   *
   * Sent with its ORIGINAL name attached, because this one is saved and
   * forwarded - "invoice.pdf" is useful where "doc-m3x8q1-4f2a.pdf" is not -
   * and inline, so a PDF opens in the tab instead of landing in Downloads.
   */
  app.get('/files/asset-doc/:id', (req, res) => {
    const doc = getAssetDoc(Number(req.params.id));
    if (!doc) return res.status(404).json({ error: 'not found' });
    if (!docLinkValid(doc, req.query.exp, req.query.sig)) {
      return res.status(403).json({ error: 'This link has expired. Open the asset again.' });
    }
    const file = docFile(doc);
    if (!file) return res.status(410).json({ error: 'the file is missing from disk' });
    // The name is user input and this is a header: quotes and newlines out.
    const safe = String(doc.file_name || 'document').replace(/[^\w.\- ]+/g, '_').slice(0, 80);
    res.setHeader('content-disposition', `inline; filename="${safe}"`);
    res.sendFile(file);
  });

  app.get('/api/config', requireAuth, (req, res) =>
    res.json({
      currency: config.currency,
      timezone: config.timezone,
      codes: ATTENDANCE_CODES,
      defaults: {
        working_days: STANDARD_WORKING_DAYS,
        hours_per_day: config.hoursPerDay,
        pt_threshold: config.ptThreshold,
        pt_amount: config.ptAmount,
      },
    })
  );

  /*
   * Signing in. `state`, `setup` and `login` are reachable without a session -
   * they have to be - and the router guards everything else itself.
   */
  app.use('/api/auth', authRouter);

  /*
   * The office side. `requireAuth` says who is asking;
   * `requireWriteForChanges` then refuses anything that is not a plain read
   * unless the role carries `write`. It is one line rather than a tag on every
   * route, so it cannot be forgotten on a route added later - a Viewer who
   * knows the URL still cannot write, which is the only version of this that
   * means anything.
   *
   * Companies carry the branch structure, so changing them is an admin's -
   * though everybody signed in can READ the list, because the company filter
   * and the employee form need it on every screen. Everything else -
   * employees, attendance, leave, payroll figures, assets, the registers,
   * hiring - is HR's work, salaries included.
   */
  /*
   * The staff side. `requireSelf` inside answers about the signed-in person
   * and nobody else; it is the only router a staff login can reach, because
   * that role carries no `read`.
   */
  app.use('/api/me', requireAuth, meRouter);

  /*
   * WHICH PART OF THE APP, as well as what kind of action.
   *
   * `hidePay` goes on EVERY office router rather than the salary ones: a
   * login without the salary area must not see a figure wherever it surfaces,
   * and the employee master carries one as surely as the sheet does. It sits
   * before the routers so it wraps res.json for all of them; /api/me is
   * deliberately outside it, because that is somebody's own payslip.
   *
   * `requireArea` refuses the module outright. The two do different jobs:
   * one says "not this tab at all", the other says "this tab, with the money
   * taken out of it".
   */
  const office = [requireAuth, requireRead, hidePay];

  /*
   * /api/people is THREE jobs sharing one router - the people registers, the
   * asset register and the licence register - so it is gated BY PATH inside
   * routes/people.js, the same way /api/periods is split between the salary
   * sheet and the attendance grid.
   *
   * It used to be gated twice: a mount here for /api/people/assets and
   * requireArea('people') on the router below. Both ran, so a login ticked to
   * Assets and nothing else passed the first and was refused by the second -
   * it had no asset register at all. Two places deciding one thing is how they
   * come to disagree, so there is now one.
   */
  app.use('/api/companies', ...office, requireAdminForChanges, companiesRouter);
  app.use('/api/employees', ...office, requireArea('employees'), requireWriteForChanges, employeesRouter);
  /* Inviting, checking and approving is the staff master's own work, so it
     sits behind the same area as the staff master. */
  app.use('/api/onboarding', ...office, requireArea('employees'), requireWriteForChanges, onboardingRouter);
  app.use('/api/leave', ...office, requireArea('leave'), requireWriteForChanges, leaveRouter);
  app.use('/api/loans', ...office, requireArea('loans'), requireWriteForChanges, loansRouter);
  app.use('/api/people', ...office, requireWriteForChanges, peopleRouter);
  /*
   * The month carries BOTH the salary sheet and the attendance grid, so it
   * cannot be gated as one thing - somebody who marks attendance and never
   * sees pay is exactly the case this exists for. Split by path.
   */
  app.use('/api/periods', ...office, requireWriteForChanges, periodsRouter);
  app.use('/api/hiring', ...office, requireArea('hiring'), requireWriteForChanges, hiringRouter);
  /*
   * The front desk. Its own area, so the person on reception can be given a
   * login that records visitors and courier and nothing else - which is the
   * whole reason areas exist.
   */
  app.use('/api/front-office', ...office, requireArea('frontoffice'), requireWriteForChanges, frontOfficeRouter);
  app.use('/api/attendance', ...office, requireArea('attendance'), requireWriteForChanges, attendanceSelfRouter);
  app.use('/api', ...office, requireWriteForChanges, reportsRouter);

  // Serve the built dashboard when it has been copied into backend/public.
  if (config.serveFrontend && fs.existsSync(path.join(frontendDir, 'index.html'))) {
    /*
     * The hashed files can be kept for ever - their name changes when their
     * contents do - but INDEX.HTML MUST NEVER BE CACHED. It is the one file
     * with a fixed name, and it is what points at the current bundle. A
     * browser or a CDN holding yesterday's copy keeps asking for yesterday's
     * JavaScript, and the whole app silently stays old.
     *
     * That is exactly what happened: the server was updated, /healthz said
     * the new version, and the test page went on behaving like the build
     * from three releases back because the tab was running cached code.
     */
    app.use(
      express.static(frontendDir, {
        setHeaders(res, filePath) {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-store, must-revalidate');
          } else if (/\/assets\//.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );

    /*
     * A missing asset is a 404, not the app.
     *
     * The catch-all below exists so /apply/JOB-003 reaches index.html instead
     * of a 404. But it also swallowed /assets/index-OLD.js, handing back HTML
     * where a browser expected JavaScript - so a stale page failed quietly
     * and strangely instead of failing loudly. An asset that is not there has
     * to say so.
     */
    app.get(/^\/assets\//, (req, res) => res.status(404).end());

    // Not an API call and not a file download: it is the app's own routing, so
    // /apply/JOB-003 has to reach index.html rather than a 404.
    app.get(/^(?!\/(api|files)\/).*/, (req, res) => {
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
      return res.sendFile(path.join(frontendDir, 'index.html'));
    });
    log.info(`Serving dashboard from ${frontendDir}`);
  }

  app.use((req, res) => res.status(404).json({ error: 'not found' }));

  // eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
  app.use((err, req, res, next) => {
    log.error('Unhandled request error:', err?.message || err);
    res.status(500).json({ error: err?.message || 'internal error' });
  });

  return app;
}
