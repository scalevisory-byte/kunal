import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { log } from './logger.js';
import { requireAuth } from './auth.js';
import { getCandidate } from './db.js';
import { resumeFile, resumeLinkValid } from './resumes.js';
import { applicationsRouter } from './routes/applications.js';
import { candidatesRouter } from './routes/candidates.js';
import { followupsRouter } from './routes/followups.js';
import { interviewsRouter } from './routes/interviews.js';
import { placementsRouter } from './routes/placements.js';
import { publicRouter } from './routes/public.js';
import { reportsRouter } from './routes/reports.js';
import { vacanciesRouter } from './routes/vacancies.js';
import { MATCH_BANDS, STAGES, REJECTED } from '../../shared/stages.js';
import { WEIGHTS } from '../../shared/match.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, '../public');

export function createServer() {
  const app = express();

  // Railway and anything else in front of this terminates TLS, so req.ip has
  // to come off the forwarded header for the rate limit to mean anything.
  app.set('trust proxy', true);
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // Open: a health check has nobody to authenticate as.
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  /*
   * Two unauthenticated surfaces, and only two:
   *
   *   /api/public  - a candidate reading a published advert and applying,
   *   /files       - one CV, through a signed link that expires.
   *
   * Everything else is the recruiter's, behind the shared password.
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

  app.get('/api/config', requireAuth, (req, res) =>
    res.json({
      brand: config.brandName,
      currency: config.currency,
      timezone: config.timezone,
      stages: STAGES,
      rejected: REJECTED,
      bands: MATCH_BANDS,
      weights: WEIGHTS,
      public_url: config.publicUrl || null,
      test_configured: !!config.testEmbedUrl,
      test_pass_percent: config.testPassPercent,
      whatsapp: config.agencyWhatsapp || null,
      fee: {
        percent: config.feePercent,
        basis: config.feeBasis,
        gst_percent: config.gstPercent,
        replacement_days: config.replacementDays,
      },
      auth_required: !!config.appPassword,
    })
  );

  app.use('/api/vacancies', requireAuth, vacanciesRouter);
  app.use('/api/candidates', requireAuth, candidatesRouter);
  app.use('/api/applications', requireAuth, applicationsRouter);
  app.use('/api/interviews', requireAuth, interviewsRouter);
  app.use('/api/followups', requireAuth, followupsRouter);
  app.use('/api/placements', requireAuth, placementsRouter);
  app.use('/api/reports', requireAuth, reportsRouter);

  // Serve the built dashboard once it has been copied into backend/public.
  if (config.serveFrontend && fs.existsSync(path.join(frontendDir, 'index.html'))) {
    app.use(express.static(frontendDir));
    // Everything that is not an API call or a file download is the app's own
    // routing - /apply/REQ-003 has to reach index.html, not a 404.
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
