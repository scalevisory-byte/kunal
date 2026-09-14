/*
 * Opening the database, and turning an existing plaintext one into an
 * encrypted one without ever being the reason data went missing.
 *
 * The migration is the whole risk of this feature. It runs once, against the
 * only copy of everything the app knows, on a machine with no backups. So it
 * never writes to the original file: it works on a copy, proves the copy holds
 * exactly what the original held, and only then swaps them — and even then the
 * original is moved aside rather than deleted. Deleting it is a separate,
 * deliberate act by a person, because that is the step that makes a lost key
 * final.
 */
import fs from 'node:fs';
import Database from 'better-sqlite3-multiple-ciphers';
import { encryptionOn, keyProblem, pragmaKeyLiteral, keyFingerprint } from './encryption.js';
import { log } from './logger.js';

const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');

/** What is actually in that file: nothing, a readable database, or ciphertext. */
export function inspectFile(dbPath) {
  if (!fs.existsSync(dbPath)) return 'absent';
  if (fs.statSync(dbPath).size === 0) return 'absent';
  const head = Buffer.alloc(SQLITE_MAGIC.length);
  const fd = fs.openSync(dbPath, 'r');
  try { fs.readSync(fd, head, 0, head.length, 0); } finally { fs.closeSync(fd); }
  return head.equals(SQLITE_MAGIC) ? 'plaintext' : 'encrypted';
}

/** Every table and its row count — the thing a migration must not change. */
function census(db) {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map((r) => r.name);
  const counts = {};
  for (const t of tables) {
    counts[t] = db.prepare(`SELECT count(*) AS c FROM "${t}"`).get().c;
  }
  return counts;
}

function describeDifference(before, after) {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const bad = names.filter((n) => before[n] !== after[n]);
  return bad.map((n) => `${n}: ${before[n] ?? 'missing'} -> ${after[n] ?? 'missing'}`).join(', ');
}

const backupName = (dbPath) =>
  `${dbPath}.plaintext-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}`;

/**
 * Plaintext on disk, a key in the environment: encrypt it.
 *
 * Returns the path the untouched plaintext original was moved to.
 */
function migrateToEncrypted(dbPath) {
  const working = `${dbPath}.encrypting`;
  // A previous attempt that died midway leaves this behind. It is a scratch
  // copy and never the original, so removing it loses nothing.
  for (const f of [working, `${working}-wal`, `${working}-shm`]) fs.rmSync(f, { force: true });

  log.warn('Encryption: database is not encrypted and a key is set. Converting it now.');

  /*
   * Fold the write-ahead log back into the file first.
   *
   * Copying a database whose -wal still holds committed pages copies a version
   * of it from some minutes ago, and the rest is then thrown away by the swap
   * below. TRUNCATE empties the log rather than merely checkpointing it, so
   * what gets copied is demonstrably everything.
   */
  const source = new Database(dbPath);
  source.pragma('journal_mode = WAL');
  source.pragma('wal_checkpoint(TRUNCATE)');
  const before = census(source);
  source.close();

  fs.copyFileSync(dbPath, working);

  const copy = new Database(working);
  copy.pragma(`rekey = ${pragmaKeyLiteral()}`);
  copy.close();

  // Prove it before trusting it. If this cannot open or does not match, the
  // original is still sitting there untouched and the app stops rather than
  // carrying on over a database it has not verified.
  let after;
  try {
    const check = new Database(working);
    check.pragma(`key = ${pragmaKeyLiteral()}`);
    after = census(check);
    check.close();
  } catch (err) {
    for (const f of [working, `${working}-wal`, `${working}-shm`]) fs.rmSync(f, { force: true });
    throw new Error(
      `Encryption: the converted database could not be re-opened (${err.message}). `
      + 'Nothing was changed - the original is exactly as it was. The app has not started.',
    );
  }

  const difference = describeDifference(before, after);
  if (difference) {
    for (const f of [working, `${working}-wal`, `${working}-shm`]) fs.rmSync(f, { force: true });
    throw new Error(
      `Encryption: the converted database does not match the original (${difference}). `
      + 'Nothing was changed - the original is exactly as it was. The app has not started.',
    );
  }

  const backup = backupName(dbPath);
  fs.renameSync(dbPath, backup);
  fs.renameSync(working, dbPath);
  // The old log files belong to the file just moved aside; left here SQLite
  // would try to apply them to the new one.
  for (const f of [`${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(f, { force: true });

  const rows = Object.values(before).reduce((a, b) => a + b, 0);
  log.warn(`Encryption: done. ${rows} rows across ${Object.keys(before).length} tables, verified.`);
  log.warn(`Encryption: the plaintext copy is still on disk at ${backup}`);
  log.warn('Encryption: it is your only way back if the key is lost. Delete it from '
    + 'Settings once you have saved DB_ENCRYPTION_KEY somewhere safe.');
  return backup;
}

/** Any plaintext copies a past migration left behind, newest first. */
export function plaintextBackups(dbPath) {
  const dir = dbPath.slice(0, dbPath.lastIndexOf('/')) || '.';
  const prefix = `${dbPath.slice(dbPath.lastIndexOf('/') + 1)}.plaintext-backup-`;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => n.startsWith(prefix))
    .map((n) => {
      const full = `${dir}/${n}`;
      return { name: n, path: full, bytes: fs.statSync(full).size };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

/**
 * The state the app is actually in, for the status route.
 * Computed from the file rather than from the setting, so it reports what is
 * true rather than what was intended.
 */
export function encryptionState(dbPath) {
  return {
    enabled: encryptionOn(),
    database: inspectFile(dbPath),           // absent | plaintext | encrypted
    keyFingerprint: keyFingerprint(),
    // Chromium's, not ours - see the note in encryption.js.
    whatsappSessionEncrypted: false,
    plaintextBackups: plaintextBackups(dbPath).map(({ name, bytes }) => ({ name, bytes })),
  };
}

export function openDatabase(dbPath) {
  const problem = keyProblem();
  if (problem) throw new Error(problem);

  const state = inspectFile(dbPath);

  if (!encryptionOn()) {
    if (state === 'encrypted') {
      throw new Error(
        'The database on disk is encrypted but DB_ENCRYPTION_KEY is not set, so it cannot be '
        + 'opened. Nothing has been changed or deleted. Set the same key the data was encrypted '
        + 'with and start again.',
      );
    }
    return new Database(dbPath);
  }

  if (state === 'plaintext') migrateToEncrypted(dbPath);

  const db = new Database(dbPath);
  db.pragma(`key = ${pragmaKeyLiteral()}`);
  try {
    // Touching the schema is what actually proves the key: opening a file
    // never reads a page, so a wrong key fails here rather than later, in the
    // middle of something.
    db.prepare('SELECT count(*) FROM sqlite_master').get();
  } catch {
    db.close();
    throw new Error(
      'The database could not be opened with this DB_ENCRYPTION_KEY. Nothing has been changed '
      + 'or deleted. This almost always means the key differs from the one the data was '
      + 'encrypted with - check for a missing character or added whitespace.',
    );
  }
  return db;
}
