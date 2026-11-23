/**
 * Our own punch collector — the readers, and a copy of the punches we keep.
 *
 * Why this exists: the punches used to reach us through the Bizcompass Sync
 * Tool, which pulls the readers every ten minutes, writes a batch file and
 * uploads it to its own cloud. That is somebody else's product with somebody
 * else's licence, and when the licence lapsed the feed was one setting away
 * from stopping. So we read the readers ourselves.
 *
 * THE DESIGN IN TWO SENTENCES. A pull only ever ADDS PUNCHES to a store of
 * our own; it never touches attendance, never touches money, and never erases
 * the reader. Turning punches into attendance is a second, separate step that
 * goes through the same `applyPunches` every other source goes through.
 *
 * That split is the whole of why this is safe to run on a timer: the thing
 * that happens automatically cannot be wrong in a way that costs anybody a
 * day's pay, and the store it fills can be read again at any time, for any
 * month, as often as needed.
 *
 * AND THE ONE WARNING THAT MATTERS ON HIS MACHINES. eTimeTrackLite has
 * "Auto Clear After Download" ticked, which means whoever downloads FIRST
 * wipes the reader. Two tools collecting with that tick on will each get
 * half the punches. It has to come off before this is relied on — said on
 * the panel, not just here.
 */
import { db, listEmployees } from './db.js';
import { applyPunches, periodFor } from './punchApply.js';
import { monthForAuto } from './bizcompass.js';
import { log } from './logger.js';
import { pullAttendance, testDevice } from './zk/client.js';
import { DEFAULT_PORT } from '../../shared/zkProtocol.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS punch_devices (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    -- What the office calls it: "IN gate", "Factory door".
    name          TEXT NOT NULL,
    host          TEXT NOT NULL,
    port          INTEGER NOT NULL DEFAULT 4370,
    -- The reader's communication key. 0 means it was never set, which is the
    -- factory state and how most of these are left.
    comm_key      INTEGER NOT NULL DEFAULT 0,
    -- For the office's own reference only. A reader does not know which
    -- company somebody is on, and nothing here decides that from the device.
    company_id    INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    active        INTEGER NOT NULL DEFAULT 1,
    note          TEXT,
    -- The last pull, so a reader that has quietly stopped answering shows as
    -- what it is. "Automatic" that silently stopped is worse than no
    -- automatic at all.
    last_try_at   TEXT,
    last_ok_at    TEXT,
    last_error    TEXT,
    last_read     INTEGER,
    last_added    INTEGER,
    record_size   INTEGER,
    -- 64 bytes of the raw reply, in hex. Kept because the record layout
    -- varies by firmware: if a reader comes back with punches that make no
    -- sense, this is what tells us what it actually sent.
    sample        TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS device_punches (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id     INTEGER REFERENCES punch_devices(id) ON DELETE SET NULL,
    -- What the MACHINE calls the person, not what the office calls them.
    -- Text, because 0037 and 37 are different enrolments in some offices.
    device_code   TEXT NOT NULL,
    -- 'YYYY-MM-DD HH:MM:SS', sortable, which is why it is stored this way and
    -- turned into the importer's shape on the way out.
    punched_at    TEXT NOT NULL,
    state         INTEGER,
    verify        INTEGER,
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  /*
   * The index that makes the whole design work.
   *
   * We never erase a reader, so EVERY pull brings back the entire log it
   * still holds - the same punches, again, every ten minutes. Without this
   * one punch would be filed hundreds of times. It is not an optimisation;
   * it is the reason a pull can be repeated as often as we like.
   */
  CREATE UNIQUE INDEX IF NOT EXISTS device_punches_once
    ON device_punches(device_code, punched_at, device_id);

  CREATE INDEX IF NOT EXISTS device_punches_month
    ON device_punches(punched_at);
`);

/*
 * Where a punch came from, and THE TRAP THAT MAKES THIS COLUMN NECESSARY.
 *
 * The Bizcompass spool belongs to no reader of ours, so its rows carry
 * device_id NULL - and in SQLite a UNIQUE index treats NULLs as DISTINCT.
 * device_punches_once above would therefore not stop a thing: the same punch
 * would be filed again every five minutes, for ever, and the day's punch list
 * would read as somebody opening the door two hundred times.
 *
 * So spool rows get their own PARTIAL unique index, on the source instead of
 * the device. Our own readers keep the original index untouched, so nothing
 * about them changes.
 */
{
  const have = new Set(db.prepare('PRAGMA table_info(device_punches)').all().map((c) => c.name));
  if (!have.has('source')) {
    db.exec("ALTER TABLE device_punches ADD COLUMN source TEXT NOT NULL DEFAULT ''");
    log.info('Migrated device_punches: added source.');
  }
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS device_punches_source_once
    ON device_punches(device_code, punched_at, source)
    WHERE device_id IS NULL;
`);

const DEVICE_FIELDS = ['name', 'host', 'port', 'comm_key', 'company_id', 'active', 'note'];

const clean = (input = {}) => ({
  name: String(input.name || '').trim(),
  host: String(input.host || '').trim(),
  port: Number(input.port) > 0 ? Math.round(Number(input.port)) : DEFAULT_PORT,
  comm_key: Number(input.comm_key) > 0 ? Math.round(Number(input.comm_key)) : 0,
  company_id: input.company_id ? Number(input.company_id) : null,
  active: input.active === 0 || input.active === false ? 0 : 1,
  note: input.note ? String(input.note).trim() : null,
});

/** What is wrong with it, in words, or ''. */
export function deviceProblem(input = {}) {
  const row = clean(input);
  if (!row.name) return 'the reader needs a name, so the office can tell them apart';
  if (!row.host) return 'the reader needs its address on the network';
  if (!/^[a-zA-Z0-9.:_-]+$/.test(row.host)) return `"${row.host}" is not an address`;
  if (row.port < 1 || row.port > 65535) return `${row.port} is not a port`;
  return '';
}

export const listDevices = () =>
  db.prepare(`
    SELECT d.*, c.name AS company_name,
           (SELECT COUNT(*) FROM device_punches p WHERE p.device_id = d.id) AS punches
      FROM punch_devices d
      LEFT JOIN companies c ON c.id = d.company_id
     ORDER BY d.active DESC, d.name
  `).all();

export const getDevice = (id) =>
  db.prepare('SELECT * FROM punch_devices WHERE id = ?').get(Number(id));

export function createDevice(input = {}) {
  const problem = deviceProblem(input);
  if (problem) return { error: problem, status: 400 };
  const row = clean(input);
  const info = db.prepare(`
    INSERT INTO punch_devices (name, host, port, comm_key, company_id, active, note)
    VALUES (@name, @host, @port, @comm_key, @company_id, @active, @note)
  `).run(row);
  return { device: getDevice(info.lastInsertRowid) };
}

export function updateDevice(id, patch = {}) {
  const existing = getDevice(id);
  if (!existing) return { error: 'reader not found', status: 404 };
  const merged = { ...existing, ...patch };
  const problem = deviceProblem(merged);
  if (problem) return { error: problem, status: 400 };
  const row = clean(merged);
  const sets = DEVICE_FIELDS.map((f) => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE punch_devices SET ${sets} WHERE id = @id`).run({ ...row, id: Number(id) });
  return { device: getDevice(id) };
}

/**
 * Removing a reader keeps its punches. They are attendance that has already
 * been collected and may already have been paid; the row simply stops saying
 * which box they came through.
 */
export function deleteDevice(id) {
  const existing = getDevice(id);
  if (!existing) return { error: 'reader not found', status: 404 };
  db.prepare('UPDATE device_punches SET device_id = NULL WHERE device_id = ?').run(Number(id));
  db.prepare('DELETE FROM punch_devices WHERE id = ?').run(Number(id));
  return { ok: true };
}

/* ---------------- the store ---------------- */

const insertPunch = () => db.prepare(`
  INSERT OR IGNORE INTO device_punches (device_id, device_code, punched_at, state, verify, source)
  VALUES (?, ?, ?, ?, ?, ?)
`);

/**
 * File what a pull read. Returns how many were seen and how many were new —
 * and on a reader nobody has cleared, "new" being 0 is the normal answer,
 * not a fault.
 */
export function savePunches(deviceId, punches = []) {
  const stmt = insertPunch();
  let added = 0;
  db.transaction(() => {
    for (const p of punches) {
      if (!p.user || !p.at) continue;
      const info = stmt.run(
        deviceId ?? null,
        String(p.user),
        p.at,
        p.state ?? null,
        p.verify ?? null,
        deviceId ? `device:${deviceId}` : ''
      );
      added += info.changes;
    }
  })();
  return { seen: punches.length, added };
}

/** Punches for one month, in the shape every punch importer already reads. */
export function punchesForMonth({ month, year }) {
  const m = String(Number(month)).padStart(2, '0');
  const rows = db.prepare(`
    SELECT device_code, punched_at
      FROM device_punches
     WHERE punched_at LIKE ?
     ORDER BY punched_at
  `).all(`${Number(year)}-${m}-%`);
  return rows.map((r) => ({
    user: r.device_code,
    // 'YYYY-MM-DD HH:MM:SS' back to the 'dd-mm-yyyy HH:MM:SS' the importer reads.
    when: `${r.punched_at.slice(8, 10)}-${r.punched_at.slice(5, 7)}-${r.punched_at.slice(0, 4)} ${r.punched_at.slice(11)}`,
  }));
}

export function storeSummary() {
  const totals = db.prepare(`
    SELECT COUNT(*) AS punches,
           COUNT(DISTINCT device_code) AS ids,
           MIN(punched_at) AS first_at,
           MAX(punched_at) AS last_at
      FROM device_punches
  `).get();
  const months = db.prepare(`
    SELECT substr(punched_at, 1, 7) AS month, COUNT(*) AS punches
      FROM device_punches
     GROUP BY month
     ORDER BY month DESC
     LIMIT 24
  `).all();
  return { ...totals, months };
}

/* ---------------- pulling ---------------- */

const noteTry = (id, fields) => {
  db.prepare(`
    UPDATE punch_devices
       SET last_try_at = datetime('now'),
           last_ok_at = COALESCE(@last_ok_at, last_ok_at),
           last_error = @last_error,
           last_read = @last_read,
           last_added = @last_added,
           record_size = COALESCE(@record_size, record_size),
           sample = COALESCE(@sample, sample)
     WHERE id = @id
  `).run({
    id: Number(id),
    last_ok_at: null,
    last_error: null,
    last_read: null,
    last_added: null,
    record_size: null,
    sample: null,
    ...fields,
  });
};

/**
 * One reader. Reads it, files what came back, and records how it went — on
 * the device row, so a reader that stopped answering last Tuesday says so.
 *
 * It does not throw. A reader being unplugged is an ordinary Tuesday and the
 * panel has to be able to report each one in turn.
 */
export async function pullDevice(id) {
  const device = getDevice(id);
  if (!device) return { error: 'reader not found', status: 404 };

  const got = await pullAttendance(device);
  if (!got.ok) {
    noteTry(device.id, { last_error: got.error, last_read: got.punches.length, last_added: 0,
      record_size: got.record_size || null, sample: got.sample || null });
    return {
      status: 200,
      body: { device: getDevice(device.id), ok: false, error: got.error, read: 0, added: 0, ms: got.ms },
    };
  }

  const saved = savePunches(device.id, got.punches);
  noteTry(device.id, {
    last_ok_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    last_error: null,
    last_read: saved.seen,
    last_added: saved.added,
    record_size: got.record_size || null,
    sample: got.sample || null,
  });
  log.info(`punch reader ${device.name}: read ${saved.seen}, ${saved.added} new`);
  return {
    status: 200,
    body: {
      device: getDevice(device.id),
      ok: true,
      error: '',
      read: saved.seen,
      added: saved.added,
      record_size: got.record_size,
      sample: got.sample,
      ms: got.ms,
    },
  };
}

/** Every active reader, one after another. */
export async function pullAll() {
  const results = [];
  for (const device of listDevices()) {
    if (!device.active) continue;
    const out = await pullDevice(device.id);
    results.push(out.body || { device, ok: false, error: out.error });
  }
  return {
    devices: results,
    read: results.reduce((n, r) => n + (r.read || 0), 0),
    added: results.reduce((n, r) => n + (r.added || 0), 0),
    failed: results.filter((r) => !r.ok).map((r) => ({ name: r.device?.name, error: r.error })),
  };
}

export async function checkDevice(input) {
  const device = input?.id ? getDevice(input.id) : input;
  if (!device) return { error: 'reader not found', status: 404 };
  const got = await testDevice(device);
  /*
   * A successful test CLEARS the last error, and a failed one replaces it.
   * Otherwise the row goes on showing "the device wants its communication
   * key" after somebody has just supplied the key and been told the reader
   * answered - the same stale "still missing" that had people uploading a
   * document twice.
   */
  if (device.id) {
    noteTry(device.id, got.ok
      ? { last_ok_at: new Date().toISOString().slice(0, 19).replace('T', ' '), last_error: null,
          last_read: device.last_read, last_added: device.last_added }
      : { last_error: got.error, last_read: device.last_read, last_added: device.last_added });
  }
  return { status: 200, body: got };
}

/**
 * Turn the stored punches into attendance for one month.
 *
 * Separate from the pull on purpose: this is the step that moves money, and
 * it goes through the same `applyPunches` the spool import and the
 * spreadsheet import go through, so one punch cannot be judged two ways.
 */
export function importStored(periodId, { dryRun = true } = {}) {
  const found = periodFor(periodId);
  if (found.error) return found;
  const { period } = found;

  const punches = punchesForMonth({ month: period.month, year: period.year });
  if (!punches.length) {
    return { error: 'nothing has been collected from the readers for that month yet', status: 400 };
  }
  const applied = applyPunches(period, punches, { dryRun });
  return { status: 200, body: { ...applied, collected: punches.length, source: 'our own readers' } };
}

/** Who the readers know that the staff list does not. Named, with counts. */
export function unknownIds() {
  const employees = listEmployees();
  const known = new Set();
  for (const emp of employees) {
    if (emp.active === 0) continue;
    for (const value of [emp.device_code, emp.code]) {
      if (value) known.add(/^\d+$/.test(String(value)) ? String(Number(value)) : String(value).toLowerCase());
    }
  }
  const rows = db.prepare(`
    SELECT device_code, COUNT(*) AS punches, MAX(punched_at) AS last_at
      FROM device_punches GROUP BY device_code ORDER BY punches DESC
  `).all();
  return rows.filter((r) => {
    const id = /^\d+$/.test(r.device_code) ? String(Number(r.device_code)) : r.device_code.toLowerCase();
    return !known.has(id);
  });
}

/* ---------------- on a timer ---------------- */

/**
 * OFF unless `DEVICE_PULL_MINUTES` says otherwise. The floor is one minute
 * rather than the spool's five: pulling a reader costs it nothing and the
 * punches are only being copied, not acted on.
 */
export const pullMinutes = () => {
  const asked = Number(process.env.DEVICE_PULL_MINUTES || 0);
  if (!Number.isFinite(asked) || asked <= 0) return 0;
  return Math.max(1, Math.round(asked));
};

let lastRun = null;
let timer = null;

export const lastDevicePull = () => lastRun;

/**
 * What the scheduled run must NOT do, because nobody is watching it:
 *
 *  - it never opens a month. A month that is not open is a decision somebody
 *    has not made, and a timer has no business making it;
 *  - it never writes into a locked one;
 *  - it never overrules a mark somebody set (`applyPunches` sees to that);
 *  - it never throws.
 *
 * Collecting the punches happens whether or not a month is open. That half
 * cannot be wrong in a way that costs anybody a day's pay, and it means a
 * month opened next week still has every punch from this one.
 */
export async function autoPullOnce(now = new Date()) {
  const at = now.toISOString();
  try {
    const pulled = await pullAll();
    if (!pulled.devices.length) {
      lastRun = { at, read: 0, added: 0, note: 'no readers are set up yet' };
      return lastRun;
    }

    const { period, why } = monthForAuto(now);
    if (!period) {
      /*
       * The punches are already safely filed, so this is not a failure. It is
       * worth saying which month it was waiting for, because "nothing
       * happened" on a reader that is working perfectly reads as a fault.
       */
      lastRun = { at, ...pulled, note: `punches collected; ${why}` };
      return lastRun;
    }

    const applied = importStored(period.id, { dryRun: false });
    lastRun = {
      at,
      ...pulled,
      period: `${period.month}/${period.year}`,
      written: applied.body?.written ?? 0,
      keptMarks: applied.body?.keptMarks ?? 0,
      unknownIds: applied.body?.unknownIds ?? [],
      note: applied.error || '',
    };
    return lastRun;
  } catch (err) {
    // A failed pull must never take the server down with it.
    lastRun = { at, read: 0, added: 0, error: err.message };
    log.warn(`punch readers: automatic pull failed - ${err.message}`);
    return lastRun;
  }
}

export function startDevicePulls() {
  const minutes = pullMinutes();
  if (!minutes || timer) return 0;
  log.info(`punch readers: pulling every ${minutes} minute${minutes === 1 ? "" : "s"}`);
  timer = setInterval(() => { autoPullOnce().catch(() => null); }, minutes * 60 * 1000);
  timer.unref?.();
  return minutes;
}

export function stopDevicePulls() {
  if (timer) { clearInterval(timer); timer = null; }
}

/**
 * Every punch we hold for a month, in the shape `punchTotals` counts.
 *
 * Deliberately NOT `punchesForMonth` reshaped by the caller: that one hands
 * back the importer's `dd-mm-yyyy` so `punchesToMarks` can read it, and a
 * report that re-parsed that string would be a second idea of what a date is.
 * This gives back the stored, sortable stamp.
 */
export function punchEventsForMonth({ month, year }) {
  const m = String(Number(month)).padStart(2, '0');
  /*
   * The source has to say which FEED a punch came from, and the three cases
   * are different facts:
   *
   *   - one of our own readers, by name;
   *   - the Bizcompass spool, which belongs to no reader of ours and so
   *     carries device_id NULL and its reader's guid in `source`;
   *   - a reader that has been removed since - the punches are kept, because
   *     some of them have already been paid.
   *
   * Reading the first case's COALESCE over the second reported every spool
   * punch as "a reader since removed", which is simply untrue: nothing was
   * removed and that feed is the one still running.
   */
  return db.prepare(`
    SELECT p.device_code AS code, p.punched_at AS at,
           p.source AS raw_source,
           CASE
             WHEN d.name IS NOT NULL THEN d.name
             WHEN p.source LIKE 'bizcompass:%' THEN 'Bizcompass spool'
             ELSE 'a reader since removed'
           END AS source
      FROM device_punches p
      LEFT JOIN punch_devices d ON d.id = p.device_id
     WHERE p.punched_at LIKE ?
     ORDER BY p.punched_at
  `).all(`${Number(year)}-${m}-%`);
}

/**
 * File the raw punches the Bizcompass spool carried.
 *
 * Until now the spool was read, turned into marks, and THROWN AWAY — so the
 * app held a day's first and last punch and nothing in between. On readers
 * that are door locks, everything in between is the answer to "I left at
 * 6:30, that 5:45 one was tea", and there was no answer at all.
 *
 * These rows belong to no reader of ours (`device_id` NULL), so they are kept
 * apart by `source` and the partial unique index above — see the note there
 * for why a NULL device_id cannot be part of the key.
 *
 * It stores and nothing else: no marks, no attendance, no money. The punches
 * were already read and applied by the time this is called.
 */
export function saveSpoolPunches(punches = []) {
  const stmt = insertPunch();
  let added = 0;
  db.transaction(() => {
    for (const p of punches) {
      if (!p.user || !p.when) continue;
      // 'dd-mm-yyyy HH:MM:SS' -> the sortable stamp this table is keyed on.
      const m = String(p.when).match(/^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}:\d{2}:\d{2})/);
      if (!m) continue;
      const at = `${m[3]}-${m[2]}-${m[1]} ${m[4]}`;
      // The reader's own id rides in `source`, so two gates recording the same
      // second stay two punches and the key separates them.
      const source = p.device ? `bizcompass:${String(p.device).slice(0, 40)}` : 'bizcompass';
      added += stmt.run(null, String(p.user), at, null, p.verify ?? null, source).changes;
    }
  })();
  return { seen: punches.length, added };
}

/**
 * Every punch held for one person in one month, day by day.
 *
 * The person is matched the way every importer matches them: their Punch ID
 * when they have one, else an employee code that IS a number. Somebody with
 * neither gets an empty map — nobody ever looked for them, which is not the
 * same as them never punching.
 */
export function punchesByDay(employee, { year, month }) {
  const own = String(employee?.device_code || '').trim();
  const code = String(employee?.code || '').trim();
  const id = own || (/^\d+$/.test(code) ? code : '');
  if (!id) return { matched_on: '', days: {} };

  // 0037 and 37 are one enrolment, so the lookup strips leading zeros on both
  // sides rather than comparing the text.
  const bare = id.replace(/^0+(?=\d)/, '');
  const m = String(Number(month)).padStart(2, '0');
  const rows = db.prepare(`
    SELECT p.punched_at AS at, p.source AS source,
           COALESCE(d.name, '') AS device_name
      FROM device_punches p
      LEFT JOIN punch_devices d ON d.id = p.device_id
     WHERE p.punched_at LIKE ?
       AND (p.device_code = ? OR LTRIM(p.device_code, '0') = ?)
     ORDER BY p.punched_at
  `).all(`${Number(year)}-${m}-%`, id, bare);

  const days = {};
  for (const r of rows) {
    const day = Number(r.at.slice(8, 10));
    if (!Number.isFinite(day)) continue;
    (days[day] ||= []).push({
      // The seconds are kept. A day with two punches in the same minute reads
      // as the same time twice unless they can be told apart, and that is the
      // day most in need of explaining - it is why the out time is blank.
      at: r.at.slice(11, 19),
      where: r.device_name || (r.source.startsWith('bizcompass') ? 'reader' : ''),
    });
  }
  return { matched_on: own ? 'punch_id' : 'code', id, days };
}
