import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { log } from './logger.js';

/**
 * Where whatsapp-web.js LocalAuth puts the Chromium profile it logs in with.
 * The default client id gives a single "session" folder under our data path.
 */
export const profileDir = path.join(config.waSessionDir, 'session');

/**
 * Chromium's throwaway caches. These are rebuilt from the network on demand, so
 * losing them costs a slower first load and nothing else. They matter because
 * the profile sits on the Railway volume: during the first WhatsApp sync this
 * directory was measured growing by ~50 MB a minute, and a volume that fills up
 * takes SQLite down with it - which reads as the app simply not starting.
 * The login itself (IndexedDB, Local Storage, Cookies) is never touched here.
 */
const CACHE_DIRS = [
  'Default/Cache',
  'Default/Code Cache',
  'Default/GPUCache',
  'Default/DawnWebGPUCache',
  'Default/DawnGraphiteCache',
  'GrShaderCache',
  'ShaderCache',
  'GraphiteDawnCache',
  'component_crx_cache',
];

/** Chromium's login data for web.whatsapp.com lives here once a scan is accepted. */
const CREDENTIAL_DIR = path.join(profileDir, 'Default', 'IndexedDB', 'https_web.whatsapp.com_0.indexeddb.leveldb');

const exists = (p) => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
};

/**
 * A profile folder appears the moment Chromium launches, so its presence proves
 * nothing. Login credentials are what survive a restart, so look for those.
 */
export function sessionOnDisk() {
  let bytes = 0;
  let files = 0;
  if (exists(CREDENTIAL_DIR)) {
    for (const name of fs.readdirSync(CREDENTIAL_DIR)) {
      try {
        bytes += fs.statSync(path.join(CREDENTIAL_DIR, name)).size;
        files += 1;
      } catch { /* vanished mid-read */ }
    }
  }
  return { profileExists: exists(profileDir), loggedIn: files > 0, files, bytes };
}

/**
 * A container killed mid-run leaves Chromium's singleton locks behind. Chromium
 * then refuses the profile and starts a blank one, which shows up as a QR code
 * even though the login was saved. The locks mean nothing after the process
 * that held them is gone, so clear them before launching.
 */
export function clearStaleBrowserLocks() {
  if (!exists(profileDir)) return [];
  const cleared = [];
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const target = path.join(profileDir, name);
    try {
      if (fs.lstatSync(target)) {
        fs.rmSync(target, { force: true });
        cleared.push(name);
      }
    } catch { /* not there, which is the normal case */ }
  }
  if (cleared.length) log.warn(`Cleared stale Chromium locks from a previous run: ${cleared.join(', ')}`);
  return cleared;
}

/** Bytes under a directory, or 0 if it is missing. */
function dirSize(dir) {
  let bytes = 0;
  let stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else {
        try { bytes += fs.statSync(full).size; } catch { /* vanished mid-read */ }
      }
    }
  }
  return bytes;
}

/**
 * Delete the disposable caches from the profile on the volume. Safe to call at
 * boot: Chromium is not running yet, and nothing here is the login.
 */
export function pruneProfileCaches() {
  if (!exists(profileDir)) return { freed: 0, removed: [] };
  let freed = 0;
  const removed = [];
  for (const rel of CACHE_DIRS) {
    const target = path.join(profileDir, rel);
    if (!exists(target)) continue;
    const bytes = dirSize(target);
    try {
      fs.rmSync(target, { recursive: true, force: true });
      freed += bytes;
      removed.push(rel);
    } catch { /* in use, or already gone */ }
  }
  if (removed.length) {
    log.info(`Freed ${(freed / 1e6).toFixed(1)} MB of Chromium cache from the data volume.`);
  }
  return { freed, removed };
}
