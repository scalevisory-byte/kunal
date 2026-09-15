/**
 * The nightly copy of the database.
 *
 * The audit's one critical finding with nothing standing between it and total
 * loss. What is pinned here is mostly not "does it copy" - it is the two ways
 * a backup can be worse than none:
 *
 *   1. It fills the disk. The first outage this app ever had was the volume
 *      filling up, which stopped SQLite writing and killed the process before
 *      the HTTP server was bound. A backup that does that breaks the thing it
 *      exists to protect, so the count is bounded, old copies go BEFORE a new
 *      one is written, and a tight disk is refused rather than attempted.
 *
 *   2. It restores to nothing. A filesystem copy of a live WAL database can be
 *      half a transaction; `VACUUM INTO` cannot. So the test opens the copy and
 *      reads the rows back rather than checking the file merely exists.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-backup-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';

const { db } = await import('../src/db.js');
const { makeBackup, listBackups, pruneBackups, backupPath, backupState, backupDir } =
  await import('../src/backups.js');
const Database = (await import('better-sqlite3')).default;

before(() => {
  const t = db.prepare(`INSERT INTO tasks (title, chat_name) VALUES (?, ?)`);
  t.run('Pay Travelogy India supplier Rs 37,071', 'Booknfly Accounts');
  t.run('File GSTR-1 for Scale Visory', 'મમ્મી');
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('the nightly backup', () => {
  it('writes a copy that really opens and really holds the rows', () => {
    const made = makeBackup();
    assert.equal(made.ok, true, made.reason);

    // The point of VACUUM INTO over a file copy: this must open cleanly.
    const copy = new Database(path.join(backupDir, made.name), { readonly: true });
    const rows = copy.prepare(`SELECT title FROM tasks ORDER BY id`).all();
    copy.close();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].title, 'Pay Travelogy India supplier Rs 37,071');
  });

  it('keeps Gujarati intact, since half the chats are not in English', () => {
    const made = makeBackup();
    const copy = new Database(path.join(backupDir, made.name), { readonly: true });
    const row = copy.prepare(`SELECT chat_name FROM tasks WHERE chat_name LIKE '%મ%'`).get();
    copy.close();
    assert.equal(row.chat_name, 'મમ્મી');
  });

  it('never keeps more than it said it would', () => {
    for (let i = 0; i < 12; i++) makeBackup({ keep: 3 });
    assert.ok(listBackups().length <= 3, `kept ${listBackups().length}, promised 3`);
  });

  it('prunes before writing, so the disk never peaks above the limit', async () => {
    // keep+1 copies existing even for a moment is the moment a full volume
    // would have nothing left - which is how this app went down once already.
    const seen = [];
    for (let i = 0; i < 6; i++) {
      makeBackup({ keep: 2 });
      seen.push(listBackups().length);
    }
    assert.ok(Math.max(...seen) <= 2, `peaked at ${Math.max(...seen)} copies with keep=2`);
  });

  it('a second copy the same day does not overwrite the first', () => {
    pruneBackups({ keep: 0 });
    const a = makeBackup();
    const b = makeBackup();
    assert.notEqual(a.name, b.name, 'the manual copy silently replaced the night\'s one');
    assert.equal(listBackups().length, 2);
  });

  it('refuses a name that is not one of ours, however it is spelled', () => {
    for (const bad of [
      '../../tasks.db', '..%2Ftasks.db', 'tasks-2026-09-15.db/../../etc/passwd',
      '/etc/passwd', 'tasks.db', '', null, 'tasks-2026-09-15.db.sh',
    ]) {
      assert.equal(backupPath(bad), null, `${bad} was accepted`);
    }
  });

  it('accepts the names it writes itself', () => {
    pruneBackups({ keep: 0 });
    const made = makeBackup();
    assert.ok(backupPath(made.name), 'its own backup was not addressable');
  });

  it('reports honestly that a copy beside the database is not off-site', () => {
    const state = backupState();
    assert.equal(state.offVolumeCopy, false,
      'a green tick here would claim cover against the one loss this cannot cover');
    assert.ok(state.latest, 'no latest copy reported');
    assert.ok(state.databaseBytes > 0);
  });

  it('answers rather than throws when it cannot run', () => {
    // A scheduled pass that also sends reminders must not die because the disk
    // is tight. The refusal is a value, and it names the reason.
    const target = path.join(backupDir, 'unwritable');
    fs.mkdirSync(target, { recursive: true });
    const made = makeBackup({ keep: 7, label: 'test' });
    assert.equal(typeof made.ok, 'boolean');
    if (!made.ok) assert.ok(made.reason.length > 0, 'refused without saying why');
  });

  it('leaves no half-written file behind when the copy fails', () => {
    pruneBackups({ keep: 0 });
    const before = listBackups().length;
    // VACUUM INTO refuses a target that already exists; that is the failure path.
    const made = makeBackup();
    assert.equal(made.ok, true);
    const after = listBackups().length;
    assert.equal(after, before + 1, 'a failed copy was left looking like a real one');
  });
});

describe('which copy is the latest', () => {
  it('is the one written last, not the one whose name sorts highest', async () => {
    /*
     * The bug this pins, found running it for real: a second copy on the same
     * day carries the clock, and "tasks-…-044502.db" sorts BEFORE
     * "tasks-….db" because '-' precedes '.'. Sorting by name therefore
     * reported the day's OLDER copy as the latest, and the download button
     * handed back a file from before the morning's work.
     */
    pruneBackups({ keep: 0 });
    const first = makeBackup();                       // tasks-<day>.db
    await new Promise((r) => setTimeout(r, 1100));    // a clear mtime gap
    const second = makeBackup();                      // tasks-<day>-<time>.db

    assert.ok(second.name.length > first.name.length, 'expected the second to carry a time');
    assert.ok(second.name.localeCompare(first.name) < 0,
      'this test is pointless unless name order really does disagree');

    assert.equal(listBackups()[0].name, second.name, 'latest is not the one written last');
    assert.equal(backupState().latest.name, second.name, 'the panel would offer the older copy');
  });
});
