import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { log } from './logger.js';
import { requireAuth } from './auth.js';
import { companiesRouter } from './routes/companies.js';
import { leaveRouter } from './routes/leave.js';
import { employeesRouter } from './routes/employees.js';
import { periodsRouter } from './routes/periods.js';
import { reportsRouter } from './routes/reports.js';
import { ATTENDANCE_CODES, STANDARD_WORKING_DAYS } from '../../shared/calc.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, '../public');

export function createServer() {
  const app = express();

  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '2mb' }));

  // Unauthenticated: lets a load balancer or Railway health check reach the app.
  app.get('/healthz', (req, res) => res.json({ ok: true }));

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
  app.use('/api/periods', requireAuth, periodsRouter);
  app.use('/api', requireAuth, reportsRouter);

  // Serve the built dashboard when it has been copied into backend/public.
  if (config.serveFrontend && fs.existsSync(path.join(frontendDir, 'index.html'))) {
    app.use(express.static(frontendDir));
    app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));
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
