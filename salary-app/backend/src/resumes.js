import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from './config.js';
import { log } from './logger.js';

/*
 * CVs are the one genuinely sensitive thing this app holds: a stranger's phone
 * number, address and salary in one file. So:
 *
 *   - the file goes on disk under DATA_DIR/resumes, never into the database
 *     and never into a page,
 *   - the row keeps only a filename,
 *   - and it is handed out through a link that expires, so a URL pasted into
 *     a WhatsApp group stops working on its own.
 *
 * The link is signed rather than authenticated because a browser cannot put a
 * bearer token on an <iframe src> or a download click.
 */

const ALLOWED = new Map([
  ['application/pdf', '.pdf'],
  ['application/msword', '.doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
]);

export const ALLOWED_RESUME_TYPES = [...ALLOWED.keys()];

/** The secret that signs download links. Generated per boot when unset. */
const linkSecret =
  config.linkSecret ||
  (() => {
    log.warn('LINK_SECRET is not set - résumé links will stop working when the process restarts.');
    return crypto.randomBytes(32).toString('hex');
  })();

const safeExt = (file) => {
  const byType = ALLOWED.get(file.mimetype);
  if (byType) return byType;
  const ext = path.extname(file.originalname || '').toLowerCase();
  return [...ALLOWED.values()].includes(ext) ? ext : '';
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.resumeDir),
  filename: (req, file, cb) => {
    // Never trust the uploaded name on disk - a candidate's filename is user
    // input and this is a path. The real name is kept in the row instead.
    const stamp = Date.now().toString(36);
    const rand = crypto.randomBytes(4).toString('hex');
    cb(null, `cv-${stamp}-${rand}${safeExt(file)}`);
  },
});

export const uploadResume = multer({
  storage,
  limits: { fileSize: config.maxResumeBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    if (safeExt(file)) return cb(null, true);
    cb(new Error('Only PDF, DOC, DOCX, JPG or PNG files are accepted'));
  },
}).single('resume');

/** Multer reports its own errors; turn them into something a person can read. */
export function uploadResumeSafely(req, res, next) {
  uploadResume(req, res, (err) => {
    if (!err) return next();
    const mb = Math.round(config.maxResumeBytes / (1024 * 1024));
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? `The file is too large (max ${mb} MB)` : err.message;
    res.status(400).json({ error: message });
  });
}

/* ---------------- signed links ---------------- */

const sign = (payload) =>
  crypto.createHmac('sha256', linkSecret).update(payload).digest('base64url');

/**
 * A link good for RESUME_LINK_MINUTES. The candidate id is part of what is
 * signed, so a signature for one person's CV cannot be replayed for another's.
 */
export function resumeLink(candidate, { minutes = config.resumeLinkMinutes } = {}) {
  if (!candidate?.resume_path) return null;
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, minutes) * 60;
  const sig = sign(`${candidate.id}:${candidate.resume_path}:${exp}`);
  return {
    url: `/files/resume/${candidate.id}?exp=${exp}&sig=${sig}`,
    expires_at: new Date(exp * 1000).toISOString(),
    filename: candidate.resume_name || path.basename(candidate.resume_path),
  };
}

/** True only for an unexpired signature over this exact candidate and file. */
export function resumeLinkValid(candidate, exp, sig) {
  if (!candidate?.resume_path || !exp || !sig) return false;
  const expiry = Number(exp);
  if (!Number.isFinite(expiry) || expiry * 1000 < Date.now()) return false;
  const expected = sign(`${candidate.id}:${candidate.resume_path}:${expiry}`);
  const a = Buffer.from(String(sig));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The file on disk, or null when the row points at something that is gone. */
export function resumeFile(candidate) {
  if (!candidate?.resume_path) return null;
  // basename, because the column must never be able to walk out of the folder.
  const file = path.join(config.resumeDir, path.basename(candidate.resume_path));
  return fs.existsSync(file) ? file : null;
}

export function deleteResumeFile(candidate) {
  const file = resumeFile(candidate);
  if (!file) return false;
  try {
    fs.unlinkSync(file);
    return true;
  } catch (err) {
    log.warn(`Could not delete ${file}: ${err.message}`);
    return false;
  }
}
