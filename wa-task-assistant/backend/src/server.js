import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { log } from './logger.js';
import { requireAuth, authEnabled } from './auth.js';
import { tasksRouter } from './routes/tasks.js';
import { systemRouter } from './routes/system.js';
import {
  attentionRouter, notificationsRouter, settingsRouter, briefingRouter,
} from './routes/followups.js';
import { historyRouter } from './routes/history.js';
import {
  subtaskRouter, attachmentRouter, templateRouter,
} from './routes/extras.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, '../public');

export function createServer() {
  const app = express();

  // Railway terminates TLS in front of us; without this req.ip is the proxy's
  // address and the auth lockout would count every caller as one client.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // The WhatsApp linking QR is served as a data: URL.
          imgSrc: ["'self'", 'data:'],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          connectSrc: ["'self'"],
          manifestSrc: ["'self'"],
          workerSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      // The dashboard is same-origin only; this keeps the service worker happy.
      crossOriginEmbedderPolicy: false,
      hsts: { maxAge: 15552000, includeSubDomains: true },
    })
  );

  if (config.corsOrigin === true) {
    log.warn(
      'CORS_ORIGIN is not set — every origin is allowed. Set it to your deployed URL ' +
        'before using this on a public address.'
    );
  }

  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));

  // Unauthenticated: lets a load balancer or Railway health check reach the app.
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // Deliberately outside requireAuth: the dashboard has to be able to ask
  // "am I actually protected?" before it holds a token. It reveals only
  // whether a password is set, never what it is - and if the answer is no,
  // an attacker could read every task anyway, so it leaks nothing new.
  app.get('/api/auth-state', (req, res) => res.json({ required: authEnabled }));

  // Checklists, dependencies and attachments hang off a task, so they share
  // its path. Mounted before the task router so /tasks/:id/subtasks is not
  // swallowed by /tasks/:id.
  app.use('/api/tasks', requireAuth, subtaskRouter);
  app.use('/api/tasks', requireAuth, tasksRouter);
  app.use('/api/attachments', requireAuth, attachmentRouter);
  app.use('/api/templates', requireAuth, templateRouter);
  app.use('/api/attention', requireAuth, attentionRouter);
  app.use('/api/history', requireAuth, historyRouter);
  app.use('/api/briefing', requireAuth, briefingRouter);
  app.use('/api/notifications', requireAuth, notificationsRouter);
  app.use('/api/scheduling-settings', requireAuth, settingsRouter);
  app.use('/api', requireAuth, systemRouter);

  // Serve the built dashboard when it has been copied into backend/public.
  if (config.serveFrontend && fs.existsSync(path.join(frontendDir, 'index.html'))) {
    app.use(express.static(frontendDir));
    app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));
    log.info(`Serving dashboard from ${frontendDir}`);
  }

  app.use((req, res) => res.status(404).json({ error: 'not found' }));

  // eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
  app.use((err, req, res, next) => {
    // Client errors keep their status so callers can tell a bad request from an
    // outage; the message stays generic either way so nothing internal leaks.
    const status = Number(err?.status || err?.statusCode) || 500;
    const isClientError = status >= 400 && status < 500;

    if (isClientError) {
      log.warn(`${status} on ${req.method} ${req.originalUrl}: ${err?.message || err}`);
    } else {
      log.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err?.stack || err);
    }

    const message =
      status === 413 ? 'request body too large'
        : status === 400 ? 'malformed request'
          : isClientError ? 'request rejected'
            : 'internal error';

    res.status(status).json({ error: message });
  });

  return app;
}
