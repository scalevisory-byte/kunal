import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { recordBoot, getMeta } from './db.js';

export const startedAt = new Date().toISOString();

/** Recursive size of a directory, in bytes. Missing directory counts as zero. */
function dirSize(dir) {
  let bytes = 0;
  let files = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try {
          bytes += fs.statSync(full).size;
          files += 1;
        } catch { /* vanished mid-walk */ }
      }
    }
  };
  walk(dir);
  return { bytes, files };
}

/** True when the data directory sits on its own mount rather than the container filesystem. */
function isMountPoint(dir) {
  try {
    const mounts = fs.readFileSync('/proc/mounts', 'utf8').split('\n').map((l) => l.split(' ')[1]);
    return mounts.includes(dir);
  } catch {
    return null; // not Linux, or /proc unavailable
  }
}

/**
 * Everything needed to answer "why is it asking me to scan again?" without
 * shell access or log files: whether the data directory persists across
 * restarts, whether a WhatsApp session is actually on disk, and how long this
 * process has been up (a number that keeps resetting means it is crash-looping).
 */
export function diagnostics() {
  const session = dirSize(config.waSessionDir);
  let dbBytes = 0;
  try {
    dbBytes = fs.statSync(config.dbPath).size;
  } catch { /* first boot */ }

  const boots = Number(getMeta('boot_count') || 0);
  const firstBootAt = getMeta('first_boot_at');

  return {
    startedAt,
    uptimeSeconds: Math.round(process.uptime()),
    dataDir: config.dataDir,
    dataDirIsMount: isMountPoint(config.dataDir),
    // A data directory inside the app folder is normal in local development;
    // one outside it (Railway's /data) is meant to be a mounted volume.
    dataDirInsideApp: config.dataDir.startsWith(process.cwd() + path.sep),
    boots,
    firstBootAt,
    // The database remembering an earlier start is proof the directory survived one.
    storagePersists: boots > 1 && Boolean(firstBootAt) && firstBootAt < startedAt,
    dbBytes,
    sessionOnDisk: session.files > 0,
    sessionFiles: session.files,
    sessionBytes: session.bytes,
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  };
}

/** Called once at boot: counts this start and says plainly what it found. */
export function reportBoot(log) {
  recordBoot();
  const d = diagnostics();
  log.info(
    `Storage: ${d.dataDir} (mount: ${d.dataDirIsMount === null ? 'unknown' : d.dataDirIsMount}), ` +
      `start #${d.boots}, persists across restarts: ${d.storagePersists ? 'yes' : 'not proven yet'}`
  );
  log.info(
    d.sessionOnDisk
      ? `WhatsApp session found on disk (${d.sessionFiles} files, ${Math.round(d.sessionBytes / 1024)} kB) - no QR should be needed.`
      : 'No WhatsApp session on disk: a QR scan is required.'
  );
  return d;
}
