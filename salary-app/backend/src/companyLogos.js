import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from './config.js';
import { getCompany, setCompanyLogo } from './db.js';

/*
 * The company's logo, for the papers that go outside the building.
 *
 * Dinesh: *"offer letter me company ka logo bhi aana chahiye"* - a letter
 * handed to somebody joining is the company's letterhead, and an offer with
 * no mark on it reads as a printout.
 *
 * ONE LOGO PER COMPANY, and the companies here are separate businesses:
 * BOOKNFLY's offer must not go out under SCALE VISORY's mark. So it hangs off
 * companies.logo_path and the letter looks it up from the opening's own
 * company, never from a single app-wide picture.
 *
 * The same shape as every other upload in this app: the file lives on disk,
 * the database holds only a generated name, and the name somebody uploaded is
 * discarded because it is user input and this is a path.
 *
 * TWO DELIBERATE REFUSALS.
 *
 *   **No SVG.** An SVG can carry script, and this picture is inlined into a
 *   letter that is emailed, forwarded and opened on somebody's phone. A logo
 *   is not worth that.
 *
 *   **Small.** The letter is one self-contained file with nothing loading
 *   from the internet, so the logo travels inside it as base64 - which is a
 *   third bigger again. A 4 MB photograph of a signboard would make a letter
 *   nobody can send. The cap is stated on the screen rather than discovered.
 */

const ALLOWED = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

/** 512 KB. A wordmark is a few kilobytes; this is already generous. */
export const MAX_LOGO_BYTES = 512 * 1024;

const logoDir = path.join(config.dataDir, 'company-logos');
fs.mkdirSync(logoDir, { recursive: true });

const safeExt = (file) => {
  const byType = ALLOWED.get(file.mimetype);
  if (byType) return byType;
  const ext = path.extname(file.originalname || '').toLowerCase();
  return [...ALLOWED.values()].includes(ext) ? ext : '';
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, logoDir),
    filename: (req, file, cb) =>
      cb(null, `logo-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}${safeExt(file)}`),
  }),
  limits: { fileSize: MAX_LOGO_BYTES, files: 1 },
  fileFilter: (req, file, cb) =>
    safeExt(file)
      ? cb(null, true)
      : cb(new Error('A logo must be a PNG, JPG, WEBP or GIF. SVG is not accepted, because it can carry script into a letter.')),
}).single('logo');

export function uploadLogo(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    const kb = Math.round(MAX_LOGO_BYTES / 1024);
    res.status(400).json({
      error:
        err.code === 'LIMIT_FILE_SIZE'
          ? `That logo is too big. The limit is ${kb} KB, because the letter carries the picture inside it.`
          : err.message,
    });
  });
}

/** Where a company's logo is on disk, or null. Never sent to a browser. */
export function logoFile(companyId) {
  const company = getCompany(companyId);
  if (!company?.logo_path) return null;
  const file = path.join(logoDir, path.basename(company.logo_path));
  return fs.existsSync(file) ? file : null;
}

/**
 * Store an uploaded logo against a company, replacing whatever was there.
 *
 * The old file goes with it. A company has one logo and no history of logos -
 * unlike an employee's photograph, where a replacement is a new document row
 * because what somebody looked like when they joined is a record.
 */
export function saveLogo(companyId, file) {
  if (!file) throw new Error('no file');
  const old = logoFile(companyId);
  setCompanyLogo(companyId, file.filename);
  if (old) fs.rmSync(old, { force: true });
  return { has_logo: true };
}

export function removeLogo(companyId) {
  const old = logoFile(companyId);
  setCompanyLogo(companyId, null);
  if (old) fs.rmSync(old, { force: true });
  return { has_logo: false };
}

const TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);

/**
 * The logo as a `data:` URI, for a document that must carry its own pictures.
 *
 * The offer letter loads NOTHING from the internet - no stylesheet, no font,
 * no image - because it is opened on a phone with no signal as often as not,
 * and because a letter that phones home tells us when a candidate shows it to
 * somebody else. The logo has to travel inside the file or not at all.
 *
 * Returns null, never a broken src, when there is no logo.
 */
export function logoDataUri(companyId) {
  const file = logoFile(companyId);
  if (!file) return null;
  const type = TYPES.get(path.extname(file).toLowerCase()) || 'image/png';
  return `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
}
