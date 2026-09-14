/**
 * Encryption at rest.
 *
 * The feature's real risk is not that the cipher is weak; it is that turning it
 * on is a one-way door taken against the only copy of everything, on a machine
 * with no backups. So most of what is pinned here is about NOT losing data:
 * that the conversion is verified before it is trusted, that a failure leaves
 * the original untouched, that a wrong key refuses rather than wipes, and that
 * the plaintext copy stays until a person removes it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';

const KEY = 'test-key-that-is-long-enough-000';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wa-enc-'));

/*
 * The key is read where it is used, so setting it here is enough - no module
 * cache to defeat. That is exactly the property being relied on, and an
 * earlier version of this file could not be made to pass without it.
 */
const mod = await import('../src/db-open.js');
const enc = await import('../src/encryption.js');

function loadWith(key) {
  if (key === undefined) delete process.env.DB_ENCRYPTION_KEY;
  else process.env.DB_ENCRYPTION_KEY = key;
  return { ...mod, enc };
}

/** A database like the one in production: real rows, in a WAL. */
function seedPlaintext(dbPath, rows = 3) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT, notes TEXT)');
  db.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, body TEXT)');
  const t = db.prepare('INSERT INTO tasks (title, notes) VALUES (?,?)');
  for (let i = 0; i < rows; i++) t.run(`Pay Travelogy supplier ${i}`, 'મમ્મી ne bola');
  db.prepare('INSERT INTO messages (body) VALUES (?)').run('kal tak invoice bhej dena');
  db.close();
  return dbPath;
}

const greppable = (file, word) => fs.readFileSync(file, 'latin1').includes(word);

describe('encryption at rest', () => {
  it('is off unless a key is set, and then nothing changes at all', async () => {
    const dir = tmp();
    const p = seedPlaintext(path.join(dir, 'tasks.db'));
    const { openDatabase, inspectFile } = loadWith(undefined);
    const db = openDatabase(p);
    assert.equal(db.prepare('SELECT count(*) c FROM tasks').get().c, 3);
    db.close();
    assert.equal(inspectFile(p), 'plaintext');
  });

  it('a plaintext database is readable with grep — which is the thing being fixed', () => {
    const dir = tmp();
    const p = seedPlaintext(path.join(dir, 'tasks.db'));
    assert.ok(greppable(p, 'Travelogy'), 'the premise of the feature');
  });

  it('converts an existing database, and every row survives', async () => {
    const dir = tmp();
    const p = seedPlaintext(path.join(dir, 'tasks.db'), 5);
    const { openDatabase } = loadWith(KEY);
    const db = openDatabase(p);
    assert.equal(db.prepare('SELECT count(*) c FROM tasks').get().c, 5);
    assert.equal(db.prepare('SELECT count(*) c FROM messages').get().c, 1);
    assert.equal(db.prepare('SELECT notes FROM tasks LIMIT 1').get().notes, 'મમ્મી ne bola');
    db.close();
    assert.ok(!greppable(p, 'Travelogy'), 'the converted file still shows its contents');
  });

  it('keeps the plaintext original, because a lost key is otherwise final', async () => {
    const dir = tmp();
    const p = seedPlaintext(path.join(dir, 'tasks.db'));
    const { openDatabase, plaintextBackups } = loadWith(KEY);
    openDatabase(p).close();
    const kept = plaintextBackups(p);
    assert.equal(kept.length, 1, 'the way back should still be on disk');
    assert.ok(greppable(kept[0].path, 'Travelogy'), 'and should be the readable original');
  });

  it('search still works through the cipher — LIKE, GLOB and Gujarati alike', async () => {
    const dir = tmp();
    const p = seedPlaintext(path.join(dir, 'tasks.db'));
    const { openDatabase } = loadWith(KEY);
    const db = openDatabase(p);
    assert.equal(db.prepare("SELECT count(*) c FROM tasks WHERE title LIKE '%Travelogy%'").get().c, 3);
    assert.equal(db.prepare("SELECT count(*) c FROM tasks WHERE notes NOT GLOB '*[^0-9 +:-]*'").get().c, 0);
    db.close();
  });

  it('refuses a wrong key rather than touching the data', async () => {
    const dir = tmp();
    const p = seedPlaintext(path.join(dir, 'tasks.db'));
    (loadWith(KEY)).openDatabase(p).close();
    const before = fs.readFileSync(p);

    const { openDatabase } = loadWith('a-different-key-entirely-0000000');
    assert.throws(() => openDatabase(p), /could not be opened with this DB_ENCRYPTION_KEY/);
    assert.deepEqual(fs.readFileSync(p), before, 'the file must be byte-for-byte unchanged');
  });

  it('refuses an encrypted database when the key has gone missing', async () => {
    const dir = tmp();
    const p = seedPlaintext(path.join(dir, 'tasks.db'));
    (loadWith(KEY)).openDatabase(p).close();
    const before = fs.readFileSync(p);

    const { openDatabase } = loadWith(undefined);
    assert.throws(() => openDatabase(p), /encrypted but DB_ENCRYPTION_KEY is not set/);
    assert.deepEqual(fs.readFileSync(p), before);
  });

  it('refuses a key too short to be worth having', async () => {
    const dir = tmp();
    const p = seedPlaintext(path.join(dir, 'tasks.db'));
    const { openDatabase } = loadWith('secret');
    assert.throws(() => openDatabase(p), /at least 16/);
    assert.ok(greppable(p, 'Travelogy'), 'and leaves the database exactly as it was');
  });

  it('converting twice is not a thing that happens', async () => {
    const dir = tmp();
    const p = seedPlaintext(path.join(dir, 'tasks.db'));
    const { openDatabase, plaintextBackups } = loadWith(KEY);
    openDatabase(p).close();
    openDatabase(p).close();
    openDatabase(p).close();
    assert.equal(plaintextBackups(p).length, 1, 'a second conversion would back up ciphertext');
  });

  it('picks up rows still sitting in the write-ahead log', async () => {
    // A copy taken without folding the log back in is a database from some
    // minutes ago, and the swap would throw the rest away.
    const dir = tmp();
    const p = path.join(dir, 'tasks.db');
    const db = new Database(p);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT)');
    const ins = db.prepare('INSERT INTO tasks (title) VALUES (?)');
    for (let i = 0; i < 400; i++) ins.run(`task ${i}`);
    db.close();

    const { openDatabase } = loadWith(KEY);
    const opened = openDatabase(p);
    assert.equal(opened.prepare('SELECT count(*) c FROM tasks').get().c, 400);
    opened.close();
  });

  it('reports what is true on disk, not what was intended', async () => {
    const dir = tmp();
    const p = seedPlaintext(path.join(dir, 'tasks.db'));
    const { openDatabase, encryptionState } = loadWith(KEY);
    assert.equal(encryptionState(p).database, 'plaintext');
    openDatabase(p).close();
    const after = encryptionState(p);
    assert.equal(after.database, 'encrypted');
    assert.equal(after.enabled, true);
    assert.equal(after.plaintextBackups.length, 1);
    // The one thing encryption here cannot cover, said plainly.
    assert.equal(after.whatsappSessionEncrypted, false);
  });

  it('never writes the key, or anything derived from it, beside the data', async () => {
    const dir = tmp();
    const p = seedPlaintext(path.join(dir, 'tasks.db'));
    const { openDatabase, enc } = loadWith(KEY);
    openDatabase(p).close();
    for (const name of fs.readdirSync(dir)) {
      const body = fs.readFileSync(path.join(dir, name), 'latin1');
      assert.ok(!body.includes(KEY), `${name} contains the key itself`);
      assert.ok(!body.includes(enc.keyFingerprint()), `${name} contains the key fingerprint`);
    }
  });
});

describe('attachments', () => {
  it('are unreadable on disk and identical coming back', async () => {
    const { enc } = loadWith(KEY);
    const plain = Buffer.from('INVOICE Rs 37,071 — Travelogy India');
    const stored = enc.encryptBuffer(plain);
    assert.ok(!stored.toString('latin1').includes('Travelogy'));
    assert.deepEqual(enc.decryptBuffer(stored), plain);
  });

  it('still read files written before the key existed', async () => {
    const { enc } = loadWith(KEY);
    const old = Buffer.from('a file from before encryption');
    assert.deepEqual(enc.decryptBuffer(old), old);
  });

  it('refuse a file altered on disk rather than returning rubbish', async () => {
    const { enc } = loadWith(KEY);
    const stored = enc.encryptBuffer(Buffer.from('bank details'));
    stored[stored.length - 1] ^= 0xff;
    assert.throws(() => enc.decryptBuffer(stored));
  });

  it('are left alone when no key is set', async () => {
    const { enc } = loadWith(undefined);
    const plain = Buffer.from('no key, no change');
    assert.deepEqual(enc.encryptBuffer(plain), plain);
  });
});
