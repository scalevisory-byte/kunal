import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { config } from './config.js';
import { log } from './logger.js';

/*
 * Backups.
 *
 * There were none. The single-file build could export itself from the browser;
 * the server could not, and on a cloud volume that means one bad restart or one
 * wrong delete and the payroll is gone.
 *
 * `VACUUM INTO` is SQLite's own answer: it writes a complete, consistent copy
 * of the database to a new file while the app keeps running - no locking, no
 * half-written page, no tooling. One file per day, kept for a while, in a
 * folder on the same volume the database lives on.
 *
 * **Said plainly, because a backup nobody can restore is theatre:** a copy on
 * the same disk survives a bad deploy, a dropped table and a wrong delete. It
 * does NOT survive the volume being lost. For that, the file has to leave the
 * machine - see "Taking a backup off the machine" in the README.
 */

const backupDir = path.join(config.dataDir, 'backups');

const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** One complete copy. Returns what was written, or throws. */
export function takeBackup({ label = stamp() } = {}) {
  fs.mkdirSync(backupDir, { recursive: true });
  const file = path.join(backupDir, `salary-${label}.db`);
  // VACUUM INTO refuses to overwrite, so a second run on the same day replaces
  // the first deliberately rather than failing.
  if (fs.existsSync(file)) fs.rmSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const { size } = fs.statSync(file);
  log.info(`Backup written: ${path.basename(file)} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  return { file, name: path.basename(file), size, at: new Date().toISOString() };
}

/** Oldest first out, keeping the most recent `keep`. */
export function pruneBackups(keep = config.backupKeep) {
  if (!fs.existsSync(backupDir)) return [];
  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith('salary-') && f.endsWith('.db'))
    .sort();
  const dropping = files.slice(0, Math.max(0, files.length - Math.max(1, keep)));
  for (const f of dropping) fs.rmSync(path.join(backupDir, f));
  if (dropping.length) log.info(`Removed ${dropping.length} old backup(s), keeping ${keep}.`);
  return dropping;
}

export function listBackups() {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith('salary-') && f.endsWith('.db'))
    .map((f) => {
      const { size, mtime } = fs.statSync(path.join(backupDir, f));
      return { name: f, size, at: mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

export const backupFile = (name) => {
  // The name comes off the wire, so it is checked rather than trusted: this is
  // a path, and `../` in it would read any file on the volume.
  if (!/^salary-[0-9a-zA-Z._-]{1,60}\.db$/.test(String(name || ''))) return null;
  const file = path.join(backupDir, name);
  return fs.existsSync(file) ? file : null;
};

export const backupDirectory = () => backupDir;

/**
 * One a day, and one now.
 *
 * `setInterval` rather than a cron library: this is "about once a day" and does
 * not need a schedule language or another dependency. The first one runs a
 * minute after boot, so a fresh deployment has a backup before anybody has had
 * time to break anything.
 */
export function startBackups() {
  if (!config.backupEnabled) {
    log.warn('Backups are off (BACKUP_ENABLED=false). Nothing is being copied anywhere.');
    return null;
  }

  const run = () => {
    try {
      takeBackup();
      pruneBackups();
    } catch (err) {
      // A failed backup must never take the app down with it.
      log.error(`Backup failed: ${err.message}`);
    }
  };

  const first = setTimeout(run, 60 * 1000);
  first.unref?.();
  const every = setInterval(run, Math.max(1, config.backupHours) * 60 * 60 * 1000);
  every.unref?.();
  log.info(
    `Backups on: every ${config.backupHours}h into ${backupDir}, keeping the newest ${config.backupKeep}.`
  );
  return { first, every };
}
