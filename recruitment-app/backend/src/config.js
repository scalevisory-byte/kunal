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

const resumeDir = path.join(dataDir, 'resumes');
fs.mkdirSync(resumeDir, { recursive: true });

export const config = {
  port: num(process.env.PORT, 3003),
  corsOrigin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : true,
  serveFrontend: process.env.SERVE_FRONTEND !== 'false',
  dataDir,
  dbPath: path.join(dataDir, 'recruitment.db'),

  // CVs live on disk, never in the database and never in the page. The row
  // keeps the path; the file is handed out through a short-lived signed link.
  resumeDir,
  maxResumeBytes: num(process.env.MAX_RESUME_MB, 5) * 1024 * 1024,
  resumeLinkMinutes: num(process.env.RESUME_LINK_MINUTES, 10),

  // One shared secret for the recruiter side, the same pattern the other apps
  // here use. Unset means open, which is fine locally and not fine on a public
  // URL - and this app HAS a public URL by design, so set it.
  appPassword: process.env.APP_PASSWORD || '',
  // Signs résumé download links. Generated per boot when unset, which is fine
  // until the process restarts and outstanding links stop working.
  linkSecret: process.env.LINK_SECRET || '',

  // Where the apply form lives, for the links and posters the recruiter shares.
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),

  // Your own test system, dropped into an iframe on the candidate's page.
  // Blank means the test step is simply not offered.
  testEmbedUrl: process.env.TEST_EMBED_URL || '',
  testPassPercent: num(process.env.TEST_PASS_PERCENT, 50),

  // WhatsApp is the channel everything goes out on.
  agencyWhatsapp: (process.env.AGENCY_WHATSAPP || '').replace(/\D/g, ''),
  brandName: process.env.BRAND_NAME || 'ZYNTA Placement Services',

  // The commercials. Candidates are never charged - this is what the hiring
  // company pays on a successful placement.
  feePercent: num(process.env.FEE_PERCENT, 8.33),
  feeBasis: process.env.FEE_BASIS || 'annual', // 'annual' CTC or 'monthly' salary
  gstPercent: num(process.env.GST_PERCENT, 18),
  replacementDays: num(process.env.REPLACEMENT_DAYS, 90),

  currency: process.env.CURRENCY || 'INR',
  timezone: process.env.TIMEZONE || 'Asia/Kolkata',
};
