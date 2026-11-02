import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from './config.js';
import { log } from './logger.js';

/*
 * Photographs of the kit.
 *
 * The same shape as the employee documents next door, and for the same
 * reasons: the file never goes into the database or into a page, the uploaded
 * filename is discarded because it is user input and this is a path, and it is
 * read back through a signed link that expires. A browser cannot put a bearer
 * token on an <img src>, which is the whole reason these links are signed.
 *
 * Images only. A photograph of a laptop is a photograph; allowing a PDF here
 * would mean the register showing a broken picture where a serial number
 * should be.
 *
 * Why photographs at all: the condition something was in when it went out, and
 * the condition it came back in, are the whole of most arguments about an
 * asset. A line saying "scratched" settles nothing.
 */

const ALLOWED = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/heic', '.heic'],
]);

const photoDir = path.join(config.dataDir, 'asset-photos');
fs.mkdirSync(photoDir, { recursive: true });

const linkSecret =
  config.linkSecret ||
  (() => {
    log.warn('LINK_SECRET is not set - photo links stop working when the process restarts.');
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
    destination: (req, file, cb) => cb(null, photoDir),
    filename: (req, file, cb) =>
      cb(null, `ast-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}${safeExt(file)}`),
  }),
  // A photo straight off a phone is several megabytes, so these get their own
  // ceiling rather than the document one.
  limits: { fileSize: config.maxPhotoBytes, files: 1 },
  fileFilter: (req, file, cb) =>
    safeExt(file) ? cb(null, true) : cb(new Error('Only JPG, PNG, WEBP or HEIC photographs are accepted')),
}).single('photo');

export function uploadAssetPhoto(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    const mb = Math.round(config.maxPhotoBytes / (1024 * 1024));
    res.status(400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? `That photo is too large (max ${mb} MB)` : err.message,
    });
  });
}

const sign = (payload) => crypto.createHmac('sha256', linkSecret).update(payload).digest('base64url');

/**
 * A link good for a while, bound to this photo and nothing else.
 *
 * Longer than a document's: a register of twenty photographs is looked at for
 * minutes at a time, and a thumbnail that dies mid-scroll is worse than
 * useless. It is still a photograph of a laptop, not an Aadhaar card.
 */
export function photoLink(photo, { minutes = 60 } = {}) {
  if (!photo?.file_path) return null;
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, minutes) * 60;
  return {
    url: `/files/asset-photo/${photo.id}?exp=${exp}&sig=${sign(`${photo.id}:${photo.file_path}:${exp}`)}`,
    expires_at: new Date(exp * 1000).toISOString(),
  };
}

export function photoLinkValid(photo, exp, sig) {
  if (!photo?.file_path || !exp || !sig) return false;
  const expiry = Number(exp);
  if (!Number.isFinite(expiry) || expiry * 1000 < Date.now()) return false;
  const a = Buffer.from(String(sig));
  const b = Buffer.from(sign(`${photo.id}:${photo.file_path}:${expiry}`));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function photoFile(photo) {
  if (!photo?.file_path) return null;
  // basename, so the column can never walk out of the folder.
  const file = path.join(photoDir, path.basename(photo.file_path));
  return fs.existsSync(file) ? file : null;
}

export function deletePhotoFile(photo) {
  const file = photoFile(photo);
  if (!file) return false;
  try {
    fs.unlinkSync(file);
    return true;
  } catch (err) {
    log.warn(`Could not delete ${file}: ${err.message}`);
    return false;
  }
}

export { photoDir };
