/**
 * The Windows kit that puts the HRMS on TSRV.
 *
 * There is no Windows and no PowerShell on the machine these were written
 * on, so they cannot be RUN here. What can be checked is the handful of
 * things that cost a whole install the first time ZynTask went onto that
 * same server — every one of these is a real failure somebody sat through,
 * not a style rule.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const kit = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../deploy/windows');
const scripts = fs.readdirSync(kit).filter((f) => f.endsWith('.ps1'));
const read = (f) => fs.readFileSync(path.join(kit, f), 'utf8');
const raw = (f) => fs.readFileSync(path.join(kit, f));

test('the kit is all four scripts and the guide', () => {
  assert.deepEqual(
    scripts.sort(),
    ['install-all.ps1', 'install-service.ps1', 'setup.ps1', 'update.ps1']
  );
  assert.ok(fs.existsSync(path.join(kit, 'README.md')));
});

test('plain ASCII, and no byte-order mark', () => {
  /*
   * Windows PowerShell 5.1 reads a BOM-less UTF-8 file as ANSI, so one
   * curly quote or dash pasted in from anywhere arrives as mojibake and can
   * stop the script parsing at all. And a BOM at the top of a .ps1 is its
   * own trouble. Neither is visible when you look at the file.
   */
  for (const f of scripts) {
    const bytes = raw(f);
    assert.notEqual(
      [bytes[0], bytes[1], bytes[2]].join(','),
      '239,187,191',
      `${f} starts with a BOM`
    );
    const bad = [...read(f)].map((c, i) => [c, i]).filter(([c]) => c.charCodeAt(0) > 127);
    assert.deepEqual(bad.map(([c]) => c), [], `${f} has non-ASCII characters`);
  }
});

test('TLS 1.2 is forced wherever something is downloaded', () => {
  // Server 2019's PowerShell offers TLS 1.0 first and github.com and
  // nodejs.org both refuse it, so every download fails with a connection
  // error that says nothing about why.
  for (const f of scripts) {
    const s = read(f);
    // Only what actually reaches the internet. install-service.ps1 calls
    // Invoke-WebRequest too, but at http://localhost/healthz to say whether
    // the service answers - no TLS involved, so requiring the line there
    // would be a line that does nothing.
    if (!/https:\/\/|git (clone|fetch)/.test(s)) continue;
    assert.match(s, /SecurityProtocolType\]::Tls12/, `${f} reaches the internet without forcing TLS 1.2`);
  }
});

test('the settings file is written without a BOM, and only once', () => {
  const s = read('setup.ps1');
  // PowerShell's own -Encoding UTF8 writes a BOM, which glues onto the
  // first variable's NAME - so the app reads no PORT, no password, nothing.
  assert.match(s, /UTF8Encoding\(\$false\)/);
  assert.ok(
    !/Out-File[^\n]*-Encoding\s+UTF8(?!\d)/.test(s),
    'Out-File -Encoding UTF8 writes a BOM'
  );
  // It holds the office password and the key that signs personal links.
  // Rewriting either signs everybody out and voids every link sent.
  assert.match(s, /if \(Test-Path \$envFile\)/);
});

test('Node 22 is pinned for this app, without touching the machine', () => {
  const s = read('setup.ps1');
  // better-sqlite3 11.x ships a prebuilt binary for Node 22 only; on
  // anything else npm falls through to node-gyp, which wants Visual Studio.
  assert.match(s, /wantMajor = 22/);
  // ...and ZynTask runs on the server's own Node, so a private copy beside
  // the app is the answer rather than changing what is installed.
  assert.match(s, /\.node/);
});

test('a running service is stopped before its files are replaced', () => {
  // Windows locks a running app's files and npm then fails halfway, which
  // leaves the office with a half-installed HRMS.
  for (const f of ['install-all.ps1', 'install-service.ps1', 'update.ps1']) {
    assert.match(read(f), /Stop-Service/, `${f} replaces files without stopping first`);
  }
  // And update.ps1 starts it again whatever happened, so a failed build is
  // never also an outage.
  assert.match(read('update.ps1'), /\} finally \{[\s\S]*Start-Service/);
});

test('it does not collide with ZynTask on the same machine', () => {
  // ZynTask is on 3001 and its service is WATasks.
  assert.match(read('setup.ps1'), /PORT=3002/);
  assert.match(read('install-service.ps1'), /\$service = 'BNFHRMS'/);
  for (const f of scripts) {
    assert.ok(!/WATasks|3001/.test(read(f)), `${f} names ZynTask's service or port`);
  }
});

test('the guide says what has not been tested', () => {
  // These scripts have never been run. Saying so is the difference between
  // a step that fails and a step that fails and surprises somebody.
  const md = fs.readFileSync(path.join(kit, 'README.md'), 'utf8');
  assert.match(md, /Not tested here/i);
  assert.match(md, /PowerShell/);
});
