import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

dotenv.config();

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const dataDir = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(dataDir, { recursive: true });

export const config = {
  port: num(process.env.PORT, 3001),
  corsOrigin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : true,
  serveFrontend: process.env.SERVE_FRONTEND !== 'false',
  dataDir,
  dbPath: path.join(dataDir, 'tasks.db'),
  waSessionDir: path.join(dataDir, 'wa-session'),

  dashboardPassword: process.env.DASHBOARD_PASSWORD || '',

  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  // Per the project spec. Swap to `claude-opus-5` for harder extraction.
  model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',

  timezone: process.env.TIMEZONE || 'Asia/Kolkata',
  reminderTo: (process.env.REMINDER_TO || '').replace(/[^\d]/g, ''),
  reminderCronMorning: process.env.REMINDER_CRON_MORNING || '30 8 * * *',
  reminderCronEvening: process.env.REMINDER_CRON_EVENING || '0 18 * * *',
  batchQuietMs: num(process.env.BATCH_QUIET_SECONDS, 15) * 1000,
  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,

  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  },
};

export const vapidEnabled = Boolean(config.vapid.publicKey && config.vapid.privateKey);
