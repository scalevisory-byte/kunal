import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { log } from './logger.js';
import { requireAuth } from './auth.js';
import { getCandidate } from './hiring.js';
import { getDocument } from './db.js';
import { documentFile, documentLinkValid } from './documents.js';
import { resumeFile, resumeLinkValid } from './resumes.js';
import { hiringRouter } from './routes/hiring.js';
import { publicRouter } from './routes/public.js';
import { companiesRouter } from './routes/companies.js';
import { leaveRouter } from './routes/leave.js';
import { loansRouter } from './routes/loans.js';
import { employeesRouter } from './routes/employees.js';
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

  app.use('/api/companies', requireAuth, companiesRouter);
  app.use('/api/employees', requireAuth, employeesRouter);
  app.use('/api/leave', requireAuth, leaveRouter);
  app.use('/api/loans', requireAuth, loansRouter);
  app.use('/api/periods', requireAuth, periodsRouter);
  app.use('/api/hiring', requireAuth, hiringRouter);
  app.use('/api', requireAuth, reportsRouter);

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
