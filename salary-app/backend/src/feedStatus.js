/**
 * What the attendance feeds know about themselves, gathered in one place.
 *
 * Nothing here collects, writes or decides — it reads what the two feeds have
 * already recorded and hands it to `feedHealth`, which works out whether
 * anything is wrong. Keeping the judgement in `shared/` means the offline
 * build and the server cannot come to different conclusions about whether
 * attendance is arriving.
 */
import fs from 'node:fs';
import path from 'node:path';

import { feedHealth } from '../../shared/feedHealth.js';
import { db, listEmployees } from './db.js';
import { autoMinutes, lastAutoRun, spoolDir } from './bizcompass.js';
import { lastDevicePull, listDevices, pullMinutes } from './devices.js';

/**
 * When the Bizcompass Sync Tool last wrote a batch.
 *
 * The newest file's modification time, NOT the punches inside it: the folder
 * holds sixteen thousand files and the question here is only "is that tool
 * still running", which the newest write answers exactly. The archive counts
 * too, because a file is moved there seconds after it is uploaded.
 */
export function spoolLastWrite(dir) {
  let newest = 0;
  const look = (folder) => {
    let entries;
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        // One level down - `logdata\archive` and nothing deeper.
        if (folder === dir) look(full);
        continue;
      }
      if (!entry.name.toLowerCase().endsWith('.dat')) continue;
      try {
        const t = fs.statSync(full).mtimeMs;
        if (t > newest) newest = t;
      } catch { /* it was moved while we looked; that is the tool working */ }
    }
  };
  look(dir);
  return newest ? new Date(newest).toISOString().slice(0, 19).replace('T', ' ') : null;
}

/**
 * Who the readers cannot reach.
 *
 * `punchRows` matches on `device_code` first and falls back to `code`, so an
 * office that numbers people the same way the machine does needs nothing
 * typed. The trap is that the FALLBACK CANNOT WORK FOR A CODE A READER COULD
 * NEVER SEND: these machines send a number, and a staff list of
 * `BNF-EMP-0043` will never meet one. Somebody in that state looks perfectly
 * normal on every screen while their attendance simply never arrives.
 */
const reachable = (emp) => {
  const device = String(emp.device_code || '').trim();
  if (device) return true;
  const code = String(emp.code || '').trim();
  return /^\d+$/.test(code);
};

export function attendanceFeedHealth(now = new Date()) {
  const sources = [];

  const dir = spoolDir();
  sources.push({
    key: 'bizcompass',
    name: 'Bizcompass spool',
    configured: !!dir,
    lastAt: dir ? spoolLastWrite(dir) : null,
    lastError: lastAutoRun()?.error || '',
    auto: autoMinutes() > 0,
  });

  const devices = listDevices().filter((d) => d.active);
  const lastPunch = db
    .prepare('SELECT MAX(punched_at) AS at FROM device_punches')
    .get()?.at || null;
  sources.push({
    key: 'devices',
    name: devices.length === 1 ? devices[0].name : 'Our own readers',
    configured: devices.length > 0,
    // The newest punch we hold, not when we last asked: a reader answering
    // with nothing new is not the same as attendance arriving.
    lastAt: lastPunch,
    lastError: devices.map((d) => d.last_error).filter(Boolean)[0] || lastDevicePull()?.error || '',
    auto: pullMinutes() > 0,
  });

  const employees = listEmployees().filter((e) => e.active !== 0 && !e.is_draft);
  const unknown = db
    .prepare(`
      SELECT COUNT(*) AS n FROM (SELECT DISTINCT device_code FROM device_punches) p
       WHERE NOT EXISTS (
         SELECT 1 FROM employees e
          WHERE e.active <> 0
            AND (
              (e.device_code IS NOT NULL AND TRIM(e.device_code) <> '' AND CAST(TRIM(e.device_code) AS INTEGER) = CAST(p.device_code AS INTEGER))
              OR ((e.device_code IS NULL OR TRIM(e.device_code) = '') AND CAST(TRIM(e.code) AS INTEGER) = CAST(p.device_code AS INTEGER) AND TRIM(e.code) GLOB '[0-9]*')
            )
       )
    `)
    .get()?.n || 0;

  return {
    ...feedHealth({
      sources,
      people: {
        total: employees.length,
        withoutId: employees.filter((e) => !reachable(e)).length,
        unknownIds: unknown,
      },
      now,
    }),
    checkedAt: now.toISOString(),
  };
}
