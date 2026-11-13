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
import { psProblems } from './helpers/psStructure.js';

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

test('the scripts are at least structurally sound', () => {
  /*
   * There is no PowerShell on the machine this is built on, so nothing
   * parses these until they run on the server - where a missing brace is a
   * trip to the office. This is not a parser and a clean result is not a
   * promise that they work; it catches the class of mistake that is
   * otherwise invisible here.
   */
  for (const f of scripts) {
    assert.deepEqual(psProblems(read(f), f), [], `${f} does not hold together`);
  }
});

test('the checker catches real breakage', () => {
  // Otherwise the case above is a green light nobody earned.
  const must = [
    ["if ($true) {\n  Write-Host 'x'\n", /never closed/],
    ['Write-Host "unclosed\nWrite-Host 1\n', /never closed/],
    ["try {\n  Write-Host 'x'\n}\n", /try blocks but only 0/],
    ['$x = (1 + 2]\n', /closes a/],
  ];
  for (const [src, wanted] of must) {
    const found = psProblems(src, 'broken').join(' ');
    assert.match(found, wanted, `missed: ${JSON.stringify(src)}`);
  }
  // ...and does not cry wolf over the awkward but valid things these
  // scripts actually use.
  const fine = [
    "# a comment with a stray } brace\nWrite-Host 'fine'",
    "$s = 'it''s ok'",
    '$t = "a $(1 + (2 * 3)) b"',
    '$q = "a `\"quoted`\" word"',
    "$h = @'\nanything { in here\n'@",
  ];
  for (const src of fine) {
    assert.deepEqual(psProblems(src, 'fine'), [], `false alarm on ${JSON.stringify(src)}`);
  }
});

test('a half-finished install is never deleted', () => {
  /*
   * C:\bnf-hrms holds the clone AND, inside it, salary-app\data - the
   * payroll, the documents, the asset photos, the CVs. The first version
   * ran `Remove-Item $InstallTo -Recurse -Force` whenever the folder had no
   * .git in it, which is exactly the state a clone that failed halfway
   * leaves behind. "Run it again" would have been the thing that lost the
   * payroll, on a page that says running it again is safe.
   */
  const s = read('install-all.ps1');
  assert.ok(
    !/Remove-Item \$InstallTo -Recurse -Force/.test(s),
    'it deletes the install folder again'
  );
  assert.match(s, /already exists and is not a clone/);
  assert.match(s, /Nothing has been changed/);
});

test('a git command that failed is not built on', () => {
  // A native command that fails does not throw on $ErrorActionPreference in
  // Windows PowerShell 5.1, so a fetch that could not reach GitHub went
  // straight on to reset --hard and then to building stale code.
  const s = read('install-all.ps1');
  for (const cmd of ['git fetch', 'git checkout', 'git reset', 'git clone']) {
    const at = s.indexOf(cmd);
    assert.ok(at > 0, `${cmd} is not there any more`);
    assert.match(
      s.slice(at, at + 200),
      /LASTEXITCODE -ne 0/,
      `${cmd} runs without its exit code being checked`
    );
  }
});

test('the guide says to retire the shared password', () => {
  /*
   * The installer generates APP_PASSWORD, and it is full admin with no name
   * on it. Nothing on screen says that, and creating named logins does not
   * switch it off - so left alone it is a permanent nameless admin sitting
   * in a text file on the server. The guide has to be the thing that says
   * so, and has to say what to do about it.
   */
  const md = fs.readFileSync(path.join(kit, 'README.md'), 'utf8');
  assert.match(md, /retire the shared password/i);
  assert.match(md, /APP_PASSWORD=.{0,40}line/is);
  // ...and the file it generates says it too, where somebody editing it
  // will actually be looking.
  assert.match(read('setup.ps1'), /DELETE this line/);
});

test('the guide points at the screen approvals are actually on', () => {
  /*
   * It said "Attendance -> Requests" for two days. Approvals are not on the
   * Attendance tab at all - AttendanceRequests is rendered by Reports.jsx,
   * under Reports -> Attendance -> "Attendance corrections and approvals".
   * Found by driving it rather than by reading, because reading is what
   * wrote it wrong in the first place.
   */
  const md = fs.readFileSync(path.join(kit, 'README.md'), 'utf8');
  assert.match(md, /Attendance corrections and/);
  assert.ok(
    !/\*\*Attendance . Requests\*\*/.test(md),
    'the guide names a screen that does not exist'
  );
  // ...and that really is where the app puts it.
  const reports = fs.readFileSync(
    path.join(kit, '../../frontend/src/components/Reports.jsx'),
    'utf8'
  );
  assert.match(reports, /attendance-approvals/);
  assert.match(reports, /<AttendanceRequests/);
});

test('the guide says what has not been tested', () => {
  // These scripts have never been run. Saying so is the difference between
  // a step that fails and a step that fails and surprises somebody.
  const md = fs.readFileSync(path.join(kit, 'README.md'), 'utf8');
  assert.match(md, /Not tested here/i);
  assert.match(md, /PowerShell/);
});
