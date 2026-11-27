import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from './config.js';

/*
 * The bill behind an expense claim - the petrol slip, the hotel invoice.
 *
 * Dinesh, at the claims form: *"yaha pe voucher attach karne ka option do"*.
 * The same shape as the asset paperwork next door: the file sits on disk
 * under DATA_DIR/claim-vouchers, the row holds only a generated name, the
 * uploaded filename is kept for display and NEVER used as a path, and the
 * path never leaves the server (`forOffice` strips it from every response).
 *
 * Read back behind the office's own session rather than a signed link: a
 * voucher is opened from the claims screen, by somebody already signed in,
 * and the route checks the claim exists.
 */

const ALLOWED = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/heic', '.heic'],
]);

export const voucherDir = path.join(config.dataDir, 'claim-vouchers');
fs.mkdirSync(voucherDir, { recursive: true });

const safeExt = (file) => {
  const byType = ALLOWED.get(file.mimetype);
  if (byType) return byType;
  const ext = path.extname(file.originalname || '').toLowerCase();
  return [...ALLOWED.values()].includes(ext) ? ext : '';
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, voucherDir),
    filename: (req, file, cb) =>
      cb(null, `voucher-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}${safeExt(file)}`),
  }),
  limits: { fileSize: config.maxPhotoBytes, files: 1 },
  fileFilter: (req, file, cb) =>
    safeExt(file) ? cb(null, true) : cb(new Error('Only a PDF, JPG, PNG, WEBP or HEIC is accepted')),
}).single('file');

export function uploadVoucher(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    const mb = Math.round(config.maxPhotoBytes / (1024 * 1024));
    res.status(400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? `That file is too large (max ${mb} MB)` : err.message,
    });
  });
}

/** Where a stored voucher lives, or null if the name is not one of ours. */
export function voucherPath(file) {
  const name = path.basename(String(file || ''));
  if (!/^voucher-[a-z0-9]+-[a-f0-9]{8}\.[a-z]+$/.test(name)) return null;
  const full = path.join(voucherDir, name);
  return fs.existsSync(full) ? full : null;
}

export function removeVoucher(file) {
  const full = voucherPath(file);
  if (full) fs.rmSync(full, { force: true });
}
