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

// Candidates' CVs. On disk, never in the database and never in a page.
const resumeDir = path.join(dataDir, 'resumes');
fs.mkdirSync(resumeDir, { recursive: true });

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
  // Working days are NOT here: every month is 26, fixed in shared/calc.js.
  hoursPerDay: num(process.env.HOURS_PER_DAY, 9),
  ptThreshold: num(process.env.PT_THRESHOLD, 12000),
  ptAmount: num(process.env.PT_AMOUNT, 200),

  currency: process.env.CURRENCY || 'INR',
  timezone: process.env.TIMEZONE || 'Asia/Kolkata',

  /* ---- hiring (HRMS module 5) ---- */

  // CVs go here; a row keeps only the filename.
  resumeDir,
  maxResumeBytes: num(process.env.MAX_RESUME_MB, 5) * 1024 * 1024,
  resumeLinkMinutes: num(process.env.RESUME_LINK_MINUTES, 10),

  // Signs CV download links and the tokens the public apply page uses.
  // Generated per boot when unset, which breaks outstanding links on restart.
  linkSecret: process.env.LINK_SECRET || '',

  // Where the apply page is reachable, for the links that get shared. Without
  // it the advert still works, it just asks people to reply with a CV.
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),

  // Dinesh's own test system, dropped into an iframe after somebody applies.
  // Blank means the test step is simply not offered.
  testEmbedUrl: process.env.TEST_EMBED_URL || '',
  testPassPercent: num(process.env.TEST_PASS_PERCENT, 50),

  // The office's own number, for the "send today's list to myself" link.
  officeWhatsapp: (process.env.OFFICE_WHATSAPP || '').replace(/\D/g, ''),

  /* ---- punching from a phone (HRMS module 2) ---- */

  // Off until somebody turns it on. A punch link is a door into the building.
  punchEnabled: process.env.PUNCH_ENABLED === 'true',
  punchRequireLocation: process.env.PUNCH_REQUIRE_LOCATION !== 'false',
  // Record-and-flag rather than refuse: see shared/punchClock.js for why.
  punchAllowOutside: process.env.PUNCH_ALLOW_OUTSIDE !== 'false',
  punchFenceMetres: num(process.env.PUNCH_FENCE_METRES, 200),
};
