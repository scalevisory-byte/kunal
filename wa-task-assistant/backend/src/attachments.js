import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';
import { log } from './logger.js';
import { safeDisplayName } from './safe-name.js';

/**
 * Files kept beside a task - the invoice, the scan, the quotation.
 *
 * The bytes go on the data volume, which is the same volume whose filling up
 * once stopped the service from starting. So this is bounded twice: no single
 * file over MAX_FILE, nothing at all once the store passes MAX_TOTAL, and the
 * remaining space is reported rather than left to be discovered.
 */

// Decimal megabytes, because that is how the limits are written in the UI -
// binary ones display as "10.5 MB per file", which reads like a bug.
const MAX_FILE = 10_000_000;    // 10 MB
const MAX_TOTAL = 200_000_000;  // 200 MB across every task

export const attachmentDir = path.join(config.dataDir, 'attachments');
fs.mkdirSync(attachmentDir, { recursive: true });

/** What a browser may be told to render inline. Everything else downloads. */
const INLINE = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain',
]);

const EXTENSION = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'application/pdf': '.pdf', 'text/plain': '.txt', 'text/csv': '.csv',
};

export const usedBytes = () =>
  db.prepare(`SELECT COALESCE(SUM(bytes), 0) AS n FROM attachments`).get().n;

export function storageState() {
  const used = usedBytes();
  return {
    used,
    total: MAX_TOTAL,
    remaining: Math.max(0, MAX_TOTAL - used),
    maxFile: MAX_FILE,
    files: db.prepare(`SELECT COUNT(*) AS n FROM attachments`).get().n,
  };
}

export const attachmentsFor = (taskId) =>
  db.prepare(`SELECT id, task_id, filename, mime, bytes, created_at FROM attachments
              WHERE task_id = ? ORDER BY id`).all(taskId);

/** Counts for many tasks at once, so a list costs one query. */
export function attachmentCounts(taskIds) {
  const out = new Map();
  if (!taskIds.length) return out;
  const marks = taskIds.map(() => '?').join(',');
  for (const row of db
    .prepare(`SELECT task_id, COUNT(*) AS n FROM attachments WHERE task_id IN (${marks}) GROUP BY task_id`)
    .all(...taskIds)) {
    out.set(row.task_id, row.n);
  }
  return out;
}

export function addAttachment(taskId, { filename, mime, buffer }) {
  if (!buffer?.length) throw new Error('the file was empty');
  if (buffer.length > MAX_FILE) {
    throw new Error(`files are limited to ${Math.round(MAX_FILE / 1e6)} MB`);
  }
  const used = usedBytes();
  if (used + buffer.length > MAX_TOTAL) {
    throw new Error(
      `attachment storage is full (${Math.round(used / 1e6)} MB of ${Math.round(MAX_TOTAL / 1e6)} MB). ` +
        'Delete an attachment to make room.'
    );
  }

  const type = String(mime || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const display = safeDisplayName(filename);
  const ext = EXTENSION[type] || path.extname(display).slice(0, 10) || '';
  const stored = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;

  fs.writeFileSync(path.join(attachmentDir, stored), buffer);
  try {
    const info = db
      .prepare(
        `INSERT INTO attachments (task_id, filename, mime, bytes, stored_name)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(taskId, display, type, buffer.length, stored);
    return db
      .prepare(`SELECT id, task_id, filename, mime, bytes, created_at FROM attachments WHERE id = ?`)
      .get(info.lastInsertRowid);
  } catch (err) {
    // Never leave bytes on the volume that no row points at.
    fs.rmSync(path.join(attachmentDir, stored), { force: true });
    throw err;
  }
}

export function readAttachment(id) {
  const row = db.prepare(`SELECT * FROM attachments WHERE id = ?`).get(id);
  if (!row) return null;
  const full = path.join(attachmentDir, row.stored_name);
  if (!fs.existsSync(full)) return { ...row, missing: true };
  return { ...row, buffer: fs.readFileSync(full), inline: INLINE.has(row.mime) };
}

export function deleteAttachment(id) {
  const row = db.prepare(`SELECT * FROM attachments WHERE id = ?`).get(id);
  if (!row) return false;
  db.prepare(`DELETE FROM attachments WHERE id = ?`).run(id);
  fs.rmSync(path.join(attachmentDir, row.stored_name), { force: true });
  return true;
}

/**
 * Files on disk that no row points at - left by a crash between the write and
 * the insert. Cleared at boot so the volume cannot leak space over time.
 */
export function pruneOrphanFiles() {
  let names;
  try {
    names = fs.readdirSync(attachmentDir);
  } catch {
    return 0;
  }
  const known = new Set(db.prepare(`SELECT stored_name FROM attachments`).all().map((r) => r.stored_name));
  let removed = 0;
  for (const name of names) {
    if (known.has(name)) continue;
    try {
      fs.rmSync(path.join(attachmentDir, name), { force: true });
      removed += 1;
    } catch { /* in use, or already gone */ }
  }
  if (removed) log.info(`Removed ${removed} orphaned attachment file(s).`);
  return removed;
}
