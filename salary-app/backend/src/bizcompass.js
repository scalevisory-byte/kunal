/**
 * Reading the Bizcompass Sync Tool's punch spool off this machine's disk.
 *
 * The HRMS and that tool run on the SAME server, which is what makes this
 * simple: there is no network hop and nothing to transfer. The folder is
 * named by BIZCOMPASS_DIR and is read-only to us in every sense that matters.
 *
 * NOTHING HERE WRITES, RENAMES, MOVES OR DELETES ANYTHING IN THAT FOLDER.
 * It belongs to another company's product, which is actively writing to it
 * while we read; its archive is also the only copy of punches already
 * uploaded. We read, and that is all.
 */
import fs from 'node:fs';
import path from 'node:path';

import { coverage, fileCouldMatter, readLogFiles } from '../../shared/bizcompassLogs.js';
import { listPeriods } from './db.js';
import { applyPunches, periodFor } from './punchApply.js';
/*
 * devices.js imports monthForAuto from here, so this is a cycle - and it is
 * safe because both sides are hoisted `export function` declarations that are
 * only ever called, never read while either module is still evaluating.
 */
import { saveSpoolPunches } from './devices.js';
import { log } from './logger.js';

/** Where the spool is, if the office has said. */
export const spoolDir = () => (process.env.BIZCOMPASS_DIR || '').trim();

/**
 * Every .dat under the folder, newest last.
 *
 * `month` narrows by the file's own name before anything is opened - his
 * folder holds sixteen thousand files and a month wants about two hundred of
 * them. A file that cannot be read is COUNTED, not thrown: the tool may be
 * part-way through writing it.
 */
export function readSpool(dir, { month, limit = 20000 } = {}) {
  const files = [];
  const walk = (at, depth = 0) => {
    if (depth > 4 || files.length >= limit) return;
    let entries;
    try {
      entries = fs.readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= limit) return;
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name.toLowerCase().endsWith('.dat') && fileCouldMatter(entry.name, { month })) {
        files.push(full);
      }
    }
  };
  walk(dir);
  files.sort();

  const out = [];
  let unreadable = 0;
  for (const file of files) {
    try {
      out.push({ name: path.basename(file), text: fs.readFileSync(file, 'utf8') });
    } catch {
      unreadable += 1;
    }
  }
  return { files: out, unreadable, found: files.length };
}

/** What the office needs to know before pointing this at a month. */
export function spoolStatus() {
  const dir = spoolDir();
  if (!dir) return { configured: false, reason: 'BIZCOMPASS_DIR is not set' };
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    return { configured: true, dir, readable: false, reason: 'that folder cannot be opened' };
  }
  if (!stat.isDirectory()) {
    return { configured: true, dir, readable: false, reason: 'that path is not a folder' };
  }
  const { found } = readSpool(dir, { limit: 1 });
  return { configured: true, dir, readable: true, hasFiles: found > 0 };
}


/**
 * One month, read off the spool and (unless it is a look) written.
 *
 * The button and the scheduled run share this, because two code paths writing
 * attendance is how two sets of rules come to disagree.
 */
export function runImport(periodId, { dryRun = true } = {}) {
  const found = periodFor(periodId);
  if (found.error) return found;
  const { period } = found;

  const dir = spoolDir();
  if (!dir) return { error: 'BIZCOMPASS_DIR is not set, so there is no folder to read', status: 400 };

  const { files, unreadable } = readSpool(dir, { month: period.month });
  if (!files.length) {
    return { error: 'no punch files for that month were found in the folder', status: 400 };
  }

  const spool = readLogFiles(files);
  const applied = applyPunches(period, spool.punches, { dryRun });

  /*
   * Keep the raw punches, but ONLY on a real run - a look must not write, and
   * that rule holds for the punch store as much as for attendance.
   *
   * Until this the spool was read, turned into marks and discarded, so the
   * app held a day's first and last punch and nothing in between. On a door
   * lock everything in between is the whole record of the day.
   *
   */
  let stored = null;
  if (!dryRun) stored = saveSpoolPunches(spool.punches);

  return {
    status: 200,
    body: {
      ...applied,
      stored,
      spool: {
        dir,
        files: spool.files,
        unreadable,
        punches: spool.punches.length,
        skippedLines: spool.skipped,
        readers: spool.devices.length,
      },
      coverage: coverage(spool.punches, { month: period.month, year: period.year }),
    },
  };
}

/* ---------------- the scheduled run ---------------- */

/**
 * OFF unless `BIZCOMPASS_AUTO_MINUTES` says otherwise, and the floor is five
 * minutes: the tool itself only writes every ten, so anything faster is work
 * for nothing.
 */
export const autoMinutes = () => {
  const asked = Number(process.env.BIZCOMPASS_AUTO_MINUTES || 0);
  if (!Number.isFinite(asked) || asked <= 0) return 0;
  return Math.max(5, Math.round(asked));
};

let lastRun = null;
let timer = null;

export const lastAutoRun = () => lastRun;

/** The month a scheduled run may touch: the open one for today, and no other.
 *  It never opens a month and never reaches into a locked one — a month that
 *  is not there is a decision somebody has not made yet. */
export function monthForAuto(now = new Date()) {
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const period = listPeriods().find((p) => p.month === month && p.year === year);
  if (!period) return { period: null, why: `${month}/${year} is not open` };
  if (period.locked) return { period: null, why: `${period.label || month + '/' + year} is locked` };
  return { period, why: '' };
}

/** One scheduled pass. Never throws: this runs on a timer with nobody watching. */
export function autoSyncOnce(now = new Date()) {
  const at = new Date().toISOString();
  try {
    if (!spoolDir()) return (lastRun = { at, ok: false, why: 'no folder is set' });
    const { period, why } = monthForAuto(now);
    if (!period) return (lastRun = { at, ok: false, why });

    const got = runImport(period.id, { dryRun: false });
    if (got.error) return (lastRun = { at, ok: false, why: got.error });

    lastRun = {
      at,
      ok: true,
      period: period.label || `${period.month}/${period.year}`,
      written: got.body.written,
      days: got.body.days.length,
      people: got.body.matchedPeople,
      unknownIds: got.body.unknownIds.length,
      keptMarks: got.body.keptMarks,
    };
    log.info(
      `Bizcompass: ${lastRun.written} marks written for ${lastRun.period}` +
        (lastRun.unknownIds ? `, ${lastRun.unknownIds} punch IDs nobody carries` : '')
    );
    return lastRun;
  } catch (err) {
    log.error(`Bizcompass auto-sync failed: ${err.message}`);
    return (lastRun = { at, ok: false, why: err.message });
  }
}

/** Starts the timer, if the office asked for one. Idempotent. */
export function startAutoSync() {
  const minutes = autoMinutes();
  if (!minutes || timer) return null;
  log.info(`Bizcompass: reading the punch spool every ${minutes} minutes.`);
  // Not on the first tick: the server has only just come up and a restart
  // should not write before anybody can see the screen.
  timer = setInterval(() => autoSyncOnce(), minutes * 60 * 1000);
  timer.unref?.();
  return timer;
}

export function stopAutoSync() {
  if (timer) clearInterval(timer);
  timer = null;
}
