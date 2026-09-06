import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { recordBoot, getMeta } from './db.js';
import { sessionOnDisk } from './session-store.js';

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
 * Container memory, from the cgroup the process actually runs in. Chromium is
 * the memory-hungry part here: if the container ceiling is close to what is in
 * use, the browser gets killed mid-login and the QR comes back on its own.
 */
function containerMemory() {
  const read = (file) => {
    try {
      return fs.readFileSync(file, 'utf8').trim();
    } catch {
      return null;
    }
  };
  const toMb = (v) => (v && /^\d+$/.test(v) ? Math.round(Number(v) / 1024 / 1024) : null);

  const limit = toMb(read('/sys/fs/cgroup/memory.max')) ?? toMb(read('/sys/fs/cgroup/memory/memory.limit_in_bytes'));
  const used = toMb(read('/sys/fs/cgroup/memory.current')) ?? toMb(read('/sys/fs/cgroup/memory/memory.usage_in_bytes'));
  // An unbounded cgroup reports a number close to all of host RAM; not a real cap.
  return { limitMb: limit && limit < 1024 * 1024 ? limit : null, usedMb: used };
}

/**
 * Everything needed to answer "why is it asking me to scan again?" without
 * shell access or log files: whether the data directory persists across
 * restarts, whether a WhatsApp session is actually on disk, and how long this
 * process has been up (a number that keeps resetting means it is crash-looping).
 */
export function diagnostics() {
  const profile = dirSize(config.waSessionDir);
  const session = sessionOnDisk();
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
    // The browser profile appears as soon as Chromium starts; only the login
    // credentials inside it mean a scan was accepted and saved.
    browserProfileBytes: profile.bytes,
    sessionOnDisk: session.loggedIn,
    sessionFiles: session.files,
    sessionBytes: session.bytes,
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    container: containerMemory(),
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
      ? `Saved WhatsApp login found on disk (${d.sessionFiles} files, ${Math.round(d.sessionBytes / 1024)} kB) - no QR should be needed.`
      : 'No WhatsApp session on disk: a QR scan is required.'
  );
  return d;
}
