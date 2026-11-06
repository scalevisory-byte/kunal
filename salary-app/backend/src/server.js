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
import { requireAdminForChanges, requireAuth, requireRead, requireWriteForChanges } from './auth.js';
import { meRouter } from './routes/me.js';
import { getCandidate } from './hiring.js';
import { getDocument } from './db.js';
import { documentFile, documentLinkValid } from './documents.js';
import { resumeFile, resumeLinkValid } from './resumes.js';
import { hiringRouter } from './routes/hiring.js';
import { publicRouter } from './routes/public.js';
import { attendanceSelfRouter } from './routes/attendanceSelf.js';
import { punchRouter } from './routes/punch.js';
import { companiesRouter } from './routes/companies.js';
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

  // Unauthenticated: lets a load balancer or Railway health check reach the app.
  app.get('/healthz', (req, res) => res.json({ ok: true }));

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

  app.use('/api/companies', requireAuth, requireRead, requireAdminForChanges, companiesRouter);
  app.use('/api/employees', requireAuth, requireRead, requireWriteForChanges, employeesRouter);
  app.use('/api/leave', requireAuth, requireRead, requireWriteForChanges, leaveRouter);
  app.use('/api/loans', requireAuth, requireRead, requireWriteForChanges, loansRouter);
  app.use('/api/people', requireAuth, requireRead, requireWriteForChanges, peopleRouter);
  app.use('/api/periods', requireAuth, requireRead, requireWriteForChanges, periodsRouter);
  app.use('/api/hiring', requireAuth, requireRead, requireWriteForChanges, hiringRouter);
  app.use('/api/attendance', requireAuth, requireRead, requireWriteForChanges, attendanceSelfRouter);
  app.use('/api', requireAuth, requireRead, requireWriteForChanges, reportsRouter);

  // Serve the built dashboard when it has been copied into backend/public.
  if (config.serveFrontend && fs.existsSync(path.join(frontendDir, 'index.html'))) {
    app.use(express.static(frontendDir));
    // Not an API call and not a file download: it is the app's own routing, so
    // /apply/JOB-003 has to reach index.html rather than a 404.
    app.get(/^(?!\/(api|files)\/).*/, (req, res) =>
      res.sendFile(path.join(frontendDir, 'index.html'))
    );
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
