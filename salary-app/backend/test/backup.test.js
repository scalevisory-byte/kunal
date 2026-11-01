/**
 * Backups. There were none on the server at all - the single-file build could
 * export itself from a browser, and a cloud volume could lose the payroll to
 * one bad restart.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-backup-'));
process.env.DATA_DIR = dataDir;
process.env.APP_PASSWORD = 'the-key';
process.env.SERVE_FRONTEND = 'false';
// Off, so the timers do not fire during the test; the functions are called
// directly instead.
process.env.BACKUP_ENABLED = 'false';

const { createServer } = await import('../src/server.js');
const { takeBackup, pruneBackups, listBackups, backupFile } = await import('../src/backup.js');
const Database = (await import('better-sqlite3')).default;

const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const key = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      authorization: 'Bearer the-key',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, raw: text };
};

test('a backup is a complete, readable copy of the database', async () => {
  // Something worth losing.
  const company = await key('POST', '/api/companies', { name: 'BOOKNFLY' });
  await key('POST', '/api/employees', {
    company_id: company.body.id,
    name: 'Vaibhav Gupta',
    monthly_salary: 26000,
  });

  const made = takeBackup({ label: 'test-one' });
  assert.ok(fs.existsSync(made.file));
  assert.ok(made.size > 0);

  // Open the copy on its own and read the row back out of it.
  const copy = new Database(made.file, { readonly: true });
  const found = copy.prepare(`SELECT name, monthly_salary FROM employees`).all();
  copy.close();
  assert.deepEqual(found, [{ name: 'Vaibhav Gupta', monthly_salary: 26000 }]);
});

test('taking one twice on the same day replaces it rather than failing', () => {
  const first = takeBackup({ label: 'test-one' });
  assert.ok(first.size > 0, 'VACUUM INTO refuses to overwrite, so the file is removed first');
  assert.equal(listBackups().filter((b) => b.name === 'salary-test-one.db').length, 1);
});

test('pruning keeps the newest and removes the rest', () => {
  for (const label of ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']) {
    takeBackup({ label });
  }
  const before = listBackups().map((b) => b.name);
  assert.ok(before.length >= 5);

  pruneBackups(2);
  const after = listBackups().map((b) => b.name);
  assert.equal(after.length, 2);
  assert.ok(after.includes('salary-test-one.db'), 'the newest by name is kept');
  assert.ok(after.includes('salary-2026-01-04.db'));
  assert.equal(after.includes('salary-2026-01-01.db'), false);
});

test('pruning never leaves nothing, however small the number asked for', () => {
  pruneBackups(0);
  assert.equal(listBackups().length, 1, 'one is always kept');
});

test('a backup filename off the wire is checked, not trusted', () => {
  // This is a path. `../` in it would read any file on the volume.
  assert.equal(backupFile('../../../etc/passwd'), null);
  assert.equal(backupFile('salary-../../etc/passwd.db'), null);
  assert.equal(backupFile('not-a-backup.db'), null);
  assert.equal(backupFile(''), null);
  assert.equal(backupFile(undefined), null);
  const real = listBackups()[0].name;
  assert.ok(backupFile(real), 'and a real one still works');
});

test('an admin can take one now and download it, so a copy can leave the machine', async () => {
  const made = await key('POST', '/api/auth/backups');
  assert.equal(made.status, 201);
  assert.ok(made.body.backup.size > 0);

  const list = await key('GET', '/api/auth/backups');
  assert.equal(list.status, 200);
  assert.ok(list.body.backups.length >= 1);
  assert.ok(list.body.folder.endsWith('backups'));

  const res = await fetch(`${base}/api/auth/backups/${made.body.backup.name}`, {
    headers: { authorization: 'Bearer the-key' },
  });
  assert.equal(res.status, 200);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.ok(bytes.length > 0);
  // A SQLite file says what it is in its first 16 bytes.
  assert.equal(bytes.subarray(0, 15).toString(), 'SQLite format 3');
});

test('a made-up filename is a 404, not a file', async () => {
  const res = await key('GET', '/api/auth/backups/salary-nope.db');
  assert.equal(res.status, 404);
});
