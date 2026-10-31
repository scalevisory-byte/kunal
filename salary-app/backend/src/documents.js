import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from './config.js';
import { log } from './logger.js';

/*
 * Employee documents on disk - PAN cards, Aadhaar, offer letters, photographs.
 *
 * The same shape as the candidate CVs next door, and for the same reasons: the
 * file never goes into the database or into a page, the uploaded filename is
 * discarded because it is user input and this is a path, and it is read back
 * through a signed link that expires.
 *
 * These are more sensitive than a CV, not less - an Aadhaar card is the one
 * document somebody can be impersonated with.
 */

const ALLOWED = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['application/msword', '.doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
]);

const documentDir = path.join(config.dataDir, 'documents');
fs.mkdirSync(documentDir, { recursive: true });

const linkSecret =
  config.linkSecret ||
  (() => {
    log.warn('LINK_SECRET is not set - document links stop working when the process restarts.');
    return crypto.randomBytes(32).toString('hex');
  })();

const safeExt = (file) => {
  const byType = ALLOWED.get(file.mimetype);
  if (byType) return byType;
  const ext = path.extname(file.originalname || '').toLowerCase();
  return [...ALLOWED.values()].includes(ext) ? ext : '';
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, documentDir),
    filename: (req, file, cb) =>
      cb(null, `doc-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}${safeExt(file)}`),
  }),
  limits: { fileSize: config.maxResumeBytes, files: 1 },
  fileFilter: (req, file, cb) =>
    safeExt(file) ? cb(null, true) : cb(new Error('Only PDF, JPG, PNG, DOC or DOCX files are accepted')),
}).single('document');

export function uploadDocument(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    const mb = Math.round(config.maxResumeBytes / (1024 * 1024));
    res.status(400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? `The file is too large (max ${mb} MB)` : err.message,
    });
  });
}

const sign = (payload) => crypto.createHmac('sha256', linkSecret).update(payload).digest('base64url');

/** A link good for a few minutes, bound to this document and nothing else. */
export function documentLink(doc, { minutes = config.resumeLinkMinutes } = {}) {
  if (!doc?.file_path) return null;
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, minutes) * 60;
  return {
    url: `/files/document/${doc.id}?exp=${exp}&sig=${sign(`${doc.id}:${doc.file_path}:${exp}`)}`,
    expires_at: new Date(exp * 1000).toISOString(),
    filename: doc.file_name || path.basename(doc.file_path),
  };
}

export function documentLinkValid(doc, exp, sig) {
  if (!doc?.file_path || !exp || !sig) return false;
  const expiry = Number(exp);
  if (!Number.isFinite(expiry) || expiry * 1000 < Date.now()) return false;
  const a = Buffer.from(String(sig));
  const b = Buffer.from(sign(`${doc.id}:${doc.file_path}:${expiry}`));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function documentFile(doc) {
  if (!doc?.file_path) return null;
  // basename, so the column can never walk out of the folder.
  const file = path.join(documentDir, path.basename(doc.file_path));
  return fs.existsSync(file) ? file : null;
}

export function deleteDocumentFile(doc) {
  const file = documentFile(doc);
  if (!file) return false;
  try {
    fs.unlinkSync(file);
    return true;
  } catch (err) {
    log.warn(`Could not delete ${file}: ${err.message}`);
    return false;
  }
}

export { documentDir };
