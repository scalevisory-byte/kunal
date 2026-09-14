/*
 * Encryption at rest — the key, and what it does and does not cover.
 *
 * OFF unless DB_ENCRYPTION_KEY is set. That is deliberate and is the most
 * important decision in this file. Encryption turns "anyone who gets the disk
 * reads everything" into "anyone who loses the key loses everything", and for
 * this app, which has no backups yet, the second failure is the likelier one.
 * So it is opt-in, the switch is a single environment variable, and turning it
 * on leaves the plaintext database on disk until a person says otherwise.
 *
 * What it covers:
 *   - the SQLite database (messages, tasks, notes, the law updates) — every
 *     page, through SQLCipher, so LIKE, GLOB and the rest go on working
 *     because decryption happens underneath SQL rather than beside it;
 *   - files attached to tasks, with AES-256-GCM.
 *
 * What it does NOT cover, and cannot:
 *   - the WhatsApp session (a Chromium profile). Chromium owns those files and
 *     writes them continuously while the app runs; there is no point at which
 *     this process could hold them encrypted. Anyone who takes that directory
 *     can link the account, and that is true with or without a key set. The
 *     status route says so rather than letting a green tick imply otherwise.
 */
import crypto from 'node:crypto';

/*
 * The key is read from the environment on each use, not captured at import.
 *
 * A module that snapshots configuration the moment it is first loaded is a
 * module whose behaviour depends on import order — and here that is the
 * difference between writing ciphertext and writing plaintext. Reading it
 * where it is used costs nothing measurable and cannot be got wrong.
 */
const rawKey = () => (process.env.DB_ENCRYPTION_KEY || '').trim();

/*
 * A short key is worse than none: it carries the confidence of encryption and
 * the strength of a padlock on a paper bag, and it would be found by the same
 * person who was going to read the disk anyway. Refusing is louder than
 * quietly accepting it — the app stops and says so.
 */
export const MIN_KEY_LENGTH = 16;

export function keyProblem() {
  const raw = rawKey();
  if (!raw) return null;                       // not set: encryption is simply off
  if (raw.length < MIN_KEY_LENGTH) {
    return `DB_ENCRYPTION_KEY is ${raw.length} characters; it must be at least ${MIN_KEY_LENGTH}. `
      + 'A short key gives the appearance of encryption without the substance. '
      + 'Generate one with:  openssl rand -base64 32';
  }
  return null;
}

/** Is the data on disk meant to be encrypted at all? */
export const encryptionOn = () => Boolean(rawKey()) && !keyProblem();

/**
 * A short, non-secret name for the key in use.
 *
 * The dashboard needs to be able to say "the key has changed" and "this is the
 * key that database was written with" without ever showing or storing the key.
 * A hash prefix does both. It is only ever written INSIDE the encrypted
 * database, never beside it — a fingerprint sitting in the clear would let
 * somebody test guesses at the key offline.
 */
export const keyFingerprint = () => (encryptionOn()
  ? crypto.createHash('sha256').update(rawKey()).digest('hex').slice(0, 12)
  : null);

/**
 * The passphrase, escaped for `PRAGMA key`.
 *
 * SQLCipher takes it as a SQL string literal, so a key containing an
 * apostrophe would otherwise end the literal early and set a different key
 * than the one given — which would work, consistently, until the day the
 * quoting changed and the database could not be opened.
 */
export const pragmaKeyLiteral = () => `'${rawKey().replace(/'/g, "''")}'`;

/**
 * A separate key for files, derived from the same secret.
 *
 * Deriving rather than reusing means the bytes protecting an attachment are
 * not the bytes handed to SQLCipher, so a weakness found in one use cannot be
 * carried straight to the other. scrypt is deliberate and slow; it runs once.
 */
let fileKeyCache = null;   // { key, derived } - memoised against the key it came from
export function fileKey() {
  if (!encryptionOn()) return null;
  const raw = rawKey();
  if (fileKeyCache?.key !== raw) {
    fileKeyCache = { key: raw, derived: crypto.scryptSync(raw, 'wa-tasks/attachments/v1', 32) };
  }
  return fileKeyCache.derived;
}

/*
 * File format: MAGIC | iv(12) | tag(16) | ciphertext
 *
 * The magic marker is what lets an encrypted store hold files written before
 * encryption was turned on. Without it, every old attachment would have to be
 * rewritten in one pass at boot — on the volume whose filling up once stopped
 * the service starting. A file is read according to what it actually is.
 */
const MAGIC = Buffer.from('WATENC01');
const IV_LEN = 12;
const TAG_LEN = 16;

export const looksEncrypted = (buf) =>
  Buffer.isBuffer(buf) && buf.length >= MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);

export function encryptBuffer(plain) {
  const key = fileKey();
  if (!key) return plain;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

export function decryptBuffer(stored) {
  // Written before the key existed: still readable, exactly as it is.
  if (!looksEncrypted(stored)) return stored;
  const key = fileKey();
  if (!key) {
    throw new Error(
      'This file is encrypted and DB_ENCRYPTION_KEY is not set, so it cannot be read.',
    );
  }
  const iv = stored.subarray(MAGIC.length, MAGIC.length + IV_LEN);
  const tag = stored.subarray(MAGIC.length + IV_LEN, MAGIC.length + IV_LEN + TAG_LEN);
  const body = stored.subarray(MAGIC.length + IV_LEN + TAG_LEN);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  // GCM verifies as it finishes: a file altered on disk throws rather than
  // returning plausible rubbish.
  return Buffer.concat([d.update(body), d.final()]);
}
