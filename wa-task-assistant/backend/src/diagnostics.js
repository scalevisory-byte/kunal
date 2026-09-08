import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { recordBoot, getMeta } from './db.js';
import { sessionOnDisk } from './session-store.js';

export const startedAt = new Date().toISOString();

/*
 * Which build is running.
 *
 * Half a dozen times now, something has been reported as still broken when it
 * was fixed and simply had not deployed yet — and from a screenshot there is no
 * way to tell those two apart. The commit is the answer: it comes from the
 * hosting provider's own environment (Railway sets these), so it cannot drift
 * from what is actually running the way a hand-written version number can.
 */
export const build = {
  commit: (process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || '').slice(0, 7) || null,
  message: process.env.RAILWAY_GIT_COMMIT_MESSAGE || null,
  branch: process.env.RAILWAY_GIT_BRANCH || null,
  // When this process started, which for a container is when it was deployed.
  deployedAt: startedAt,
};

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
 * How much room is left where the data lives.
 *
 * This is the one number that has actually taken the service down. The volume
 * filled, SQLite could not write, and the process died before it ever bound a
 * port - and nothing in the app said so, because nothing in the app was
 * looking. A WhatsApp sync writes hundreds of megabytes here in an hour, so
 * the number moves fast enough to be worth watching rather than assuming.
 *
 * `statfs` is the real filesystem answer, so on Railway it reports the volume
 * and locally it reports the disk. Available is what this process may actually
 * use, which on most filesystems is less than free - reserved blocks are not
 * ours to spend.
 */
function storageSpace(dir) {
  try {
    const fsStat = fs.statfsSync(dir);
    const total = fsStat.blocks * fsStat.bsize;
    const available = fsStat.bavail * fsStat.bsize;
    if (!total) return null;
    return {
      totalBytes: total,
      availableBytes: available,
      usedPct: Math.round(((total - available) / total) * 100),
      /*
       * Low enough to act on. 250 MB is roughly one WhatsApp sync's appetite,
       * so below that it is urgent whatever the disk's size. The percentage
       * only counts when the absolute room is small too - a development
       * machine with 29 GB free on a 270 GB disk is 89% used and in no danger,
       * and crying wolf there teaches you to ignore the real one.
       */
      low: available < 250 * 1024 * 1024
        || (available / total < 0.12 && available < 2 * 1024 * 1024 * 1024),
    };
  } catch {
    // Not Linux, an older Node, or a path that does not exist yet.
    return null;
  }
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
    build,
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
    storage: storageSpace(config.dataDir),
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
  if (d.storage) {
    const mb = (n) => `${Math.round(n / 1024 / 1024)} MB`;
    const line = `Space where the data lives: ${mb(d.storage.availableBytes)} free of ${mb(d.storage.totalBytes)} (${d.storage.usedPct}% used)`;
    // Said loudly when it matters, because a full volume is what stopped this
    // service booting once already.
    if (d.storage.low) log.warn(`${line} - running low. A WhatsApp sync writes hundreds of MB here.`);
    else log.info(line);
  }
  log.info(
    d.sessionOnDisk
      ? `Saved WhatsApp login found on disk (${d.sessionFiles} files, ${Math.round(d.sessionBytes / 1024)} kB) - no QR should be needed.`
      : 'No WhatsApp session on disk: a QR scan is required.'
  );
  return d;
}
