/*
 * A copy of the database, taken every night and kept for a week.
 *
 * The audit's one finding with no mitigation at all: everything this app knows
 * - every task, message, lead, and the whole history - is one SQLite file on
 * one Railway volume, and nothing anywhere was copying it. A deleted volume, a
 * corrupted write or a mistyped action in the Railway console destroyed the lot
 * with no way back.
 *
 * Two things shape the design, and both come from failures this app has already
 * had rather than from good practice in the abstract:
 *
 * 1. IT MUST NEVER FILL THE DISK. The first outage was the volume filling up:
 *    SQLite could not write, the process died before the HTTP server was bound,
 *    and Railway gave up after ten restarts. A backup that causes that is worse
 *    than no backup, because it breaks the thing it exists to protect. So old
 *    copies are pruned BEFORE a new one is written, the count is bounded, and a
 *    snapshot that would not leave a comfortable margin free is refused and
 *    reported rather than attempted.
 *
 * 2. A COPY ON THE SAME VOLUME IS NOT A BACKUP AGAINST LOSING THE VOLUME. It
 *    covers the likelier accidents - a bad migration, a wrong delete, a
 *    corrupted page - and nothing else. That is worth having and is not worth
 *    overstating, so the dashboard says exactly that and offers the download
 *    that actually gets the data off the box.
 *
 * `VACUUM INTO` is the right instrument: it asks SQLite for a consistent,
 * compacted copy while the app carries on, so there is no moment where the
 * database is locked or half-written. A filesystem copy of a live WAL database
 * is exactly the thing that produces a backup that restores to nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { config } from './config.js';
import { log } from './logger.js';

export const backupDir = path.join(config.dataDir, 'backups');

/** How many nightly copies to keep. A week covers "I noticed on Monday". */
export const KEEP = Number(process.env.BACKUP_KEEP) || 7;

/*
 * Free space a snapshot must leave behind after it is written.
 *
 * Not a guess at the volume's size - it is read from the filesystem - but a
 * floor under it, so the database always has room to write even when a backup
 * has just been taken.
 */
const MARGIN_BYTES = 200_000_000;   // 200 MB

const NAME = /^tasks-\d{4}-\d{2}-\d{2}(-\d{6})?\.db$/;

const ensureDir = () => fs.mkdirSync(backupDir, { recursive: true });

/** Free bytes on the volume the data lives on, or null where it cannot be read. */
function freeBytes() {
  try {
    const s = fs.statfsSync(config.dataDir);
    return s.bavail * s.bsize;
  } catch {
    return null;   // an older kernel or a stubbed fs: proceed, but say so
  }
}

const sizeOf = (file) => {
  try { return fs.statSync(file).size; } catch { return 0; }
};

/** Every snapshot on disk, newest first. */
export function listBackups() {
  ensureDir();
  /*
   * Newest by WRITE TIME, never by name.
   *
   * Sorting the names looked equivalent and was not: a second copy taken the
   * same day carries the clock too, and "tasks-2026-09-15-044502.db" sorts
   * BEFORE "tasks-2026-09-15.db" because '-' precedes '.'. So the day's older
   * copy was being reported as the latest, and the download button handed back
   * a file from before the morning's work - the one failure this whole feature
   * exists to prevent, wearing a green tick. Found in a live test; a unit test
   * whose files share a timestamp would not have caught it.
   */
  return fs.readdirSync(backupDir)
    .filter((n) => NAME.test(n))
    .map((name) => {
      const full = path.join(backupDir, name);
      const stat = fs.statSync(full);
      return { name, bytes: stat.size, at: stat.mtime.toISOString(), _t: stat.mtimeMs };
    })
    .sort((a, b) => (b._t - a._t) || b.name.localeCompare(a.name))
    .map(({ _t, ...row }) => row);
}

/**
 * Drop the oldest copies beyond `keep`.
 *
 * Runs before a new snapshot is written, not after, so the space the new one
 * needs has already been released. Doing it the other way round means the disk
 * peaks at keep+1 copies, which is the moment it would run out.
 */
export function pruneBackups({ keep = KEEP } = {}) {
  const all = listBackups();
  const doomed = all.slice(keep);
  for (const b of doomed) {
    fs.rmSync(path.join(backupDir, b.name), { force: true });
    log.info(`Backup pruned: ${b.name}`);
  }
  return doomed.length;
}

/** A safe absolute path for one snapshot, or null if the name is not one of ours. */
export function backupPath(name) {
  if (!NAME.test(String(name || ''))) return null;   // no traversal, no surprises
  const full = path.join(backupDir, name);
  return fs.existsSync(full) ? full : null;
}

/**
 * Take a snapshot now.
 *
 * Returns what happened rather than throwing for the ordinary refusals: a
 * scheduled job that cannot run because the disk is tight should report that
 * and leave the app alone, not crash the tick that also sends reminders.
 */
export function makeBackup({ keep = KEEP, label = null } = {}) {
  ensureDir();
  pruneBackups({ keep: Math.max(0, keep - 1) });   // room for the one about to be written

  const day = new Date().toISOString().slice(0, 10);
  // A second snapshot on the same day (a manual one) gets the time too, so it
  // never silently overwrites the night's copy.
  const name = fs.existsSync(path.join(backupDir, `tasks-${day}.db`))
    ? `tasks-${day}-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.db`
    : `tasks-${day}.db`;
  const target = path.join(backupDir, name);

  const dbBytes = sizeOf(config.dbPath);
  const free = freeBytes();
  if (free !== null && free < dbBytes + MARGIN_BYTES) {
    const msg = `not enough free space: ${Math.round(free / 1e6)} MB free, and a copy needs about `
      + `${Math.round(dbBytes / 1e6)} MB plus a ${Math.round(MARGIN_BYTES / 1e6)} MB margin for the `
      + 'database to keep writing';
    log.warn(`Backup skipped — ${msg}`);
    return { ok: false, reason: msg, name: null };
  }

  try {
    // Ask SQLite for the copy. Consistent, compacted, and safe while the app
    // is running - which a filesystem copy of a live WAL database is not.
    db.prepare(`VACUUM INTO ?`).run(target);
  } catch (err) {
    fs.rmSync(target, { force: true });   // never leave a half-written copy that looks real
    const reason = err?.message || String(err);
    log.error(`Backup failed: ${reason}`);
    return { ok: false, reason, name: null };
  }

  const bytes = sizeOf(target);
  log.info(`Backup written: ${name} (${Math.round(bytes / 1e6)} MB)${label ? ` [${label}]` : ''}`);
  return { ok: true, name, bytes, at: new Date().toISOString() };
}

/** What the dashboard needs to say whether this is actually protecting anything. */
export function backupState() {
  const all = listBackups();
  const free = freeBytes();
  return {
    keep: KEEP,
    count: all.length,
    latest: all[0] || null,
    totalBytes: all.reduce((n, b) => n + b.bytes, 0),
    freeBytes: free,
    databaseBytes: sizeOf(config.dbPath),
    backups: all,
    /*
     * Stated, not implied. Every copy here shares the fate of the volume it
     * sits on, so a row of green ticks would be telling the user they are
     * covered against the one loss this cannot cover.
     */
    offVolumeCopy: false,
  };
}
