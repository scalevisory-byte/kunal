import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { log } from './logger.js';

/**
 * Where whatsapp-web.js LocalAuth puts the Chromium profile it logs in with.
 * The default client id gives a single "session" folder under our data path.
 */
export const profileDir = path.join(config.waSessionDir, 'session');

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
