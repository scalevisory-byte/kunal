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
  port: num(process.env.PORT, 3002),
  corsOrigin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : true,
  serveFrontend: process.env.SERVE_FRONTEND !== 'false',
  dataDir,
  dbPath: path.join(dataDir, 'salary.db'),

  // Single shared secret, same pattern as the task assistant. Unset = no auth,
  // which is fine locally and not fine on a public URL.
  appPassword: process.env.APP_PASSWORD || '',

  // Defaults for a newly created month. Every period stores its own copy, so
  // changing these never rewrites a month that has already been paid.
  workingDays: num(process.env.WORKING_DAYS, 26),
  hoursPerDay: num(process.env.HOURS_PER_DAY, 9),
  ptThreshold: num(process.env.PT_THRESHOLD, 12000),
  ptAmount: num(process.env.PT_AMOUNT, 200),

  currency: process.env.CURRENCY || 'INR',
  timezone: process.env.TIMEZONE || 'Asia/Kolkata',
};
