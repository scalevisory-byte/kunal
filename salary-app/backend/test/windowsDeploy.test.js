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

test('the private Node is on PATH, not just the exe we launch', () => {
  /*
   * This one failed on the real server, on the first real run.
   *
   * The script downloads a private Node 22 because better-sqlite3 ships a
   * prebuilt binary for 22 and for nothing newer, and it correctly ran npm
   * with that node. But npm does NOT reuse the node it was started with for
   * its children - it looks `node` up on PATH. So Node 22 installed the
   * packages and "C:\Program Files\nodejs\node.exe", Node 24, was handed
   * node-gyp to BUILD them:
   *
   *   gyp ERR! find Python - Could not find any Python installation to use
   *   gyp ERR! command "C:\\Program Files\\nodejs\\node.exe" ... "rebuild"
   *   gyp ERR! node -v v24.19.0
   *
   * ...which is the exact failure the whole Node block exists to avoid.
   * Choosing the right node.exe was not enough on its own.
   */
  const s = read('setup.ps1');
  assert.match(s, /\$env:PATH = \(Split-Path -Parent \$nodeExe\) \+ ';' \+ \$env:PATH/);
  // ...and it is set BEFORE the first npm call, or it has done nothing.
  assert.ok(
    s.indexOf('$env:PATH =') < s.indexOf('Npm $frontend'),
    'PATH is set after the first npm install'
  );
});

test('a half-built node_modules from a failed run is cleared, not reused', () => {
  /*
   * better-sqlite3 is the one package here that compiles, so it is the one
   * left unbuilt when an install dies. npm will not rebuild it on a second
   * run - the folder is there, so as far as npm is concerned it is
   * installed - and the rerun fails exactly as before, for a reason that has
   * already been fixed. That reads as "the fix did not work".
   */
  const s = read('setup.ps1');
  assert.match(s, /better-sqlite3/);
  assert.match(s, /-not \(Test-Path \(Join-Path \$sqlite 'build'\)\)/);
  assert.match(s, /Remove-Item \$mods -Recurse -Force/);
});

test('the offline bundle is built by a script, not by remembering', () => {
  /*
   * Dinesh: "github pe kuch nahi chahiye, Arrohan aur TAJ wala jaisa." So the
   * server gets a folder it runs from, and reaches out for nothing at all.
   *
   * Three steps in building it are easy to forget and silently fatal, which
   * is why it is a script and not a list in a document:
   *
   *   1. better-sqlite3 is NATIVE. `npm install` on the Linux machine this is
   *      built on produces a Linux .node, which on Windows does not load at
   *      all. The Windows prebuilt binary has to be swapped in by hand.
   *   2. The ABI has to match the Node that will RUN it - Node 22 is ABI 127.
   *      Ship Node 24 and the very same binary will not load.
   *   3. node.exe is bundled so the server's own Node is never touched. The
   *      first install attempt on TSRV failed for exactly that reason.
   */
  const sh = fs.readFileSync(path.join(kit, '../make-bundle.sh'), 'utf8');

  assert.match(sh, /NODE_VER="v22\./);
  assert.match(sh, /NODE_ABI="127"/);
  // The swap, and a check that what landed really is a Windows binary - a
  // Linux .node copied into the zip would only be found on the server.
  assert.match(sh, /better-sqlite3-v\$\{SQLITE_VER\}-node-v\$\{NODE_ABI\}-win32-x64/);
  assert.match(sh, /grep -q "MS Windows"/);
  // ...and the same check on node.exe itself.
  assert.ok((sh.match(/grep -q "MS Windows"/g) || []).length >= 2);
  // It stops on any failure rather than zipping something half-made.
  assert.match(sh, /set -euo pipefail/);

  /*
   * The scripts that go in the zip live in the repo, not in a scratch folder
   * somewhere - otherwise the next bundle is built from whatever is lying
   * around.
   */
  const local = path.join(kit, '../windows-local');
  for (const f of ['INSTALL.ps1', 'START.ps1', 'STOP.ps1', 'PADHO.txt']) {
    assert.ok(fs.existsSync(path.join(local, f)), `${f} is not in the repo`);
  }

  const install = fs.readFileSync(path.join(local, 'INSTALL.ps1'), 'utf8');
  // Plain ASCII and no BOM, same as the other kit - PowerShell 5.1 reads a
  // BOM-less UTF-8 file as ANSI.
  assert.deepEqual([...install].filter((c) => c.charCodeAt(0) > 127), []);
  /*
   * Task Scheduler, not NSSM: it is part of Windows, so there is nothing to
   * download - which is the whole point - and nssm.cc is not reachable from
   * here anyway.
   */
  assert.match(install, /Register-ScheduledTask/);
  /*
   * Checked on USE, not on the word: the comment above that code explains
   * why NSSM is not here, and a bare /nssm/i failed on its own explanation.
   */
  const code = install.replace(/^\s*#.*$/gm, '');
  assert.ok(!/nssm/i.test(code), 'it is back to needing NSSM');
  // The settings file is written once and never overwritten: it holds the
  // office password and the key that signs every personal link.
  assert.match(install, /if \(Test-Path \$envFile\)/);
  assert.match(install, /UTF8Encoding\(\$false\)/);
  // And it says whether the thing actually came up, rather than just
  // reporting that it registered a task.
  assert.match(install, /healthz/);
});

test('the bundle script copies the freshly built dashboard into backend/public', () => {
  const sh = fs.readFileSync(path.join(kit, '../make-bundle.sh'), 'utf8');

  /*
   * The bundle that went to TSRV carried a dashboard EIGHT DAYS older than
   * the source, and the only symptom was Dinesh saying "i think this is old
   * version".
   *
   * `vite build` writes frontend/dist. Copying that into backend/public -
   * which is what the server actually serves - is a separate step, and the
   * script did not do it. It only tested that backend/public/index.html
   * existed, which it did, left over from an earlier build. So the test
   * passed, the zip was made, and the old look shipped.
   *
   * Three things pinned here, because any one of them missing brings it back:
   */
  const code = sh.replace(/^\s*#.*$/gm, '');

  // 1. public is wiped first, so a renamed asset from the old build (the
  //    filenames are content-hashed) cannot linger beside the new one.
  assert.match(code, /rm -rf "\$HERE\/backend\/public"/);
  // 2. dist is actually copied in.
  assert.match(code, /cp -r "\$HERE\/frontend\/dist\/\." "\$HERE\/backend\/public\//);
  // 3. and the copy is proved NEWER than the newest source file, so a build
  //    that silently did not run stops the bundle instead of shipping.
  assert.match(code, /-newer "\$HERE\/backend\/public\/index\.html"/);
  assert.match(code, /the build did not take/);

  // The old test-for-existence must NOT be what gates it any more.
  const gate = code.slice(0, code.indexOf('Staging the app'));
  assert.ok(
    gate.includes('frontend/dist/index.html'),
    'the build is still gated on a file that an old build leaves behind',
  );
});

test('the updater survives its own errors and finds the real install', () => {
  const ps = fs.readFileSync(path.join(kit, '../windows-local/UPDATE.ps1'), 'utf8');

  // Same rule as the rest of the kit: PowerShell 5.1 reads a BOM-less UTF-8
  // file as ANSI, so one accented character can break parsing.
  assert.deepEqual([...ps].filter((c) => c.charCodeAt(0) > 127), []);
  assert.deepEqual(psProblems(ps, 'UPDATE.ps1'), []);

  /*
   * 1. The window must not vanish on an error.
   *
   * The first version ended with Read-Host, which looks like it keeps the
   * window open - but $ErrorActionPreference='Stop' plus a `throw` ends the
   * script before that line is ever reached, Windows closes the window, and
   * the one sentence explaining the problem is on screen for milliseconds.
   * Dinesh's report was "powershell open hoke band ho jaati hai turant".
   *
   * So the Read-Host has to be in a `finally`, where a throw cannot skip it.
   */
  const fin = ps.indexOf('} finally {');
  assert.ok(fin > 0, 'there is no finally block');
  assert.ok(
    ps.indexOf('Read-Host') > fin,
    'Read-Host is not inside the finally, so an error still closes the window',
  );
  assert.match(ps, /catch \{\s*\r?\n\s*\$failed = \$_/, 'errors are not caught and shown');

  /*
   * 2. It must find the install by ASKING WINDOWS, not by assuming it sits
   * beside the script.
   *
   * The update zip was extracted one folder too high, into E:\BNFHR instead
   * of E:\BNFHR\BNFHRMS - and E:\BNFHR holds an `app` folder left over from
   * an earlier failed attempt. A script that trusts its own location would
   * have updated that dead copy and reported success.
   */
  assert.match(ps, /Get-ScheduledTask -TaskName \$TaskName/);
  assert.match(ps, /\$task\.Actions/);
  // Derived from the entry point the task actually runs.
  assert.match(ps, /Split-Path -Parent \(Split-Path -Parent \$entry\)/);

  // 3. A replace, not a merge: the screens' filenames are content-hashed so
  //    a merge leaves both builds sitting there, and a stale .js left behind
  //    in src would do worse.
  assert.match(ps, /Move-Item \$to \$backup/);
  assert.match(ps, /New-Item -ItemType Directory -Path \$to -Force/);
  // ...and ALL of it comes back if any part fails, rather than leaving the
  // office with new screens on an old server.
  assert.match(ps, /foreach \(\$m in \$moved\)/);
  assert.match(ps, /Move-Item \$m\.Backup \$m\.To/);

  // 4. Each part proves itself before anything is moved, so half an
  //    extraction cannot wipe a working folder and put nothing back.
  assert.match(ps, /Proof = 'index\.html'/);
  assert.match(ps, /Proof = 'index\.js'/);
  assert.match(ps, /Proof = 'calc\.js'/);
  assert.match(ps, /is not \$\(\$part\.What\)/);

  // 5. It says what it is about to change before it changes it, because
  //    "which copy did that just update" has to be answerable.
  assert.match(ps, /Write-Host "Updating:\s+\$root"/);
});

test('going live looks before it touches the tunnel that serves ZynTask', () => {
  const ps = fs.readFileSync(path.join(kit, '../windows-local/GO-LIVE.ps1'), 'utf8');
  assert.deepEqual([...ps].filter((c) => c.charCodeAt(0) > 127), []);
  assert.deepEqual(psProblems(ps, 'GO-LIVE.ps1'), []);

  /*
   * The one real risk here: TSRV's cloudflared is what serves
   * tasks.scalevisory.in. A clumsy edit takes ZynTask off the internet.
   *
   * So the script reports everything it found FIRST, asks for the word GO,
   * and never removes or rewrites a rule that is already there.
   */
  assert.match(ps, /WHAT IS ON THIS MACHINE/);
  assert.match(ps, /WHAT WOULD CHANGE/);
  assert.match(ps, /Read-Host 'Type GO to make these changes/);
  assert.match(ps, /if \(\$go -ne 'GO'\)/);
  assert.match(ps, /Nothing was changed\./);

  // A dated backup before the file is touched at all.
  assert.match(ps, /\$backup = "\$configPath\.before-/);
  assert.match(ps, /Copy-Item \$configPath \$backup/);

  /*
   * The new rule goes in BEFORE the catch-all, because cloudflared takes
   * the first rule that matches and a catch-all above it would swallow the
   * hostname. Simulated against a real two-rule config: tasks keeps its
   * rule, the catch-all stays last, a second run is a no-op, and a config
   * with no catch-all is REFUSED rather than guessed at.
   */
  assert.match(ps, /\^\\s\*-\\s\*service:\\s/);
  assert.match(ps, /Could not find the catch-all rule/);
  assert.match(ps, /is already in the config - leaving it alone/);

  /*
   * The folder on TSRV is E:\cloudfare - no "l" - so a list of correctly
   * spelt guesses walked straight past it. Both spellings are tried, and
   * then the disks are searched for a config.yml that actually contains an
   * ingress block, rather than reporting "not found" on a machine that
   * plainly has one.
   */
  assert.match(ps, /cloudfare\\config\.yml/);
  assert.match(ps, /-match 'ingress:'/);

  // A dashboard-run tunnel keeps its routes in Cloudflare, so the script
  // says what to click instead of pretending it can edit them here.
  assert.match(ps, /--token/);
  assert.match(ps, /Public Hostname/);

  /*
   * Without this the sign-in cookie is dropped over https and it reads to
   * everybody as "the login is broken".
   */
  assert.match(ps, /SECURE_COOKIES=true/);

  /*
   * And it deliberately does NOT remove APP_PASSWORD. That shared key is
   * the only way in until a real admin login is proved to work, and a
   * script that removes it on the same run as the hostname could lock the
   * office out of an app that is now on the internet.
   */
  assert.match(ps, /NOT done by this script: removing APP_PASSWORD/);
  assert.ok(!/Remove.*APP_PASSWORD=|-notmatch 'APP_PASSWORD'/.test(ps), 'it strips the shared password itself');
});

test('the HRMS tunnel is its own, and touches nobody else', () => {
  const ps = fs.readFileSync(path.join(kit, '../windows-local/TUNNEL.ps1'), 'utf8');
  assert.deepEqual([...ps].filter((c) => c.charCodeAt(0) > 127), []);
  assert.deepEqual(psProblems(ps, 'TUNNEL.ps1'), []);

  /*
   * Dinesh: "alag se banavo / kisi ke sath nahi jodna". He was right to
   * push: the only reason the SENA tunnel had been proposed is that it was
   * the first one the inspector found, which is an accident, not a reason.
   * That server runs three other cloudflared processes - Cloudflared for
   * senacantonfair.com, ArrohanTunnel for erp.arrohanliving.in, and a
   * token-run one in E:\TAJ - and sharing one means a restart for either
   * side blips the other for ever.
   *
   * So: nothing existing may be stopped, started, restarted or opened.
   */
  // Comments explain what it leaves alone, and one Write-Host says so on
  // screen; neither is an action. Strip both before looking for one.
  const code = ps
    .replace(/^\s*#.*$/gm, '')
    .replace(/Write-Host[^\n]*/g, '');
  assert.ok(!/Restart-Service/.test(code), 'it restarts a service');
  assert.ok(!/config\.yml/.test(code), 'it reads or writes a config file');
  for (const other of ['Cloudflared', 'ArrohanTunnel', 'ArrohanERP']) {
    assert.ok(
      !new RegExp(`(Stop|Start|Restart)-Service[^\\n]*${other}`).test(code),
      `it touches the ${other} service`,
    );
  }

  /*
   * A SCHEDULED TASK, not `cloudflared service install` - that command
   * names its service "cloudflared", which already exists on this machine
   * and would collide. A task is also how the HRMS itself runs there.
   */
  assert.match(ps, /Register-ScheduledTask -TaskName \$TaskName/);
  assert.ok(!/service install/.test(code), 'it uses cloudflared service install');
  assert.match(ps, /TaskName = 'BNFHRMS-Tunnel'/);

  /*
   * Its own copy of the exe. Borrowing E:\cloudfare's or E:\TAJ's would
   * mean the HRMS stops the day somebody moves or replaces theirs.
   */
  assert.match(ps, /Join-Path \$mine 'cloudflared\.exe'/);
  assert.match(ps, /Copy-Item \$source \$exe/);

  // The token is checked for shape and never printed whole.
  assert.match(ps, /notlike 'eyJ\*'/);
  assert.match(ps, /\$Token\.Substring\(0, 12\)/);
  assert.ok(!/Write-Host[^\n]*\$Token"/.test(ps), 'it prints the whole token');

  // And it says out loud what it is leaving alone, before it does anything.
  assert.match(ps, /Leaving these exactly as they are/);
});

test('the eSSL inspector only looks, and never prints a password', () => {
  const ps = fs.readFileSync(path.join(kit, '../windows-local/ESSL-CHECK.ps1'), 'utf8');
  assert.deepEqual(psProblems(ps, 'ESSL-CHECK.ps1'), []);

  // PowerShell 5.1 reads a BOM-less UTF-8 file as ANSI, so a curly quote or
  // an arrow turns into mojibake in the middle of a command.
  assert.ok(!/[^\x09\x0a\x0d\x20-\x7e]/.test(ps), 'it is not plain ASCII');

  // `throw` under $ErrorActionPreference='Stop' ends the script, so a
  // Read-Host outside a finally closes the window before anybody reads it.
  assert.match(ps, /finally \{[\s\S]*Read-Host/);

  // It runs on a server that also carries ZynTask, Arrohan, TAJ and the
  // eSSL software itself. It is allowed to read and nothing else - the
  // whole point is that it is safe to run before anything is decided.
  const code = ps.replace(/^\s*#.*$/gm, '').replace(/<#[\s\S]*?#>/g, '');
  for (const verb of [
    'Set-Content', 'Out-File', 'Remove-Item', 'New-Item', 'Copy-Item', 'Move-Item',
    'Stop-Service', 'Start-Service', 'Restart-Service', 'Stop-Process',
    'Register-ScheduledTask', 'Set-ItemProperty', 'New-ItemProperty',
  ]) {
    assert.ok(!new RegExp(verb).test(code), `it calls ${verb}`);
  }
  assert.ok(!/>\s*['"]?[A-Za-z]:\\/.test(code), 'it redirects output into a file');

  // The output gets photographed and sent over WhatsApp. A connection
  // string carries the database password in it.
  assert.match(ps, /function Hide-Secrets/);
  for (const key of ['password', 'pwd', 'user id', 'uid']) assert.ok(ps.includes(`'${key}'`), `${key} is not masked`);
  assert.match(ps, /Hide-Secrets \$l\.Trim\(\)/);

  // The folder is FOUND, not assumed. A list of correctly spelt guesses
  // walked straight past E:\cloudfare once already.
  assert.match(ps, /Get-ChildItem -LiteralPath \$r -Directory -Depth/);
  assert.match(ps, /etimetrack\|essl/);
  assert.ok(!/C:\\Program Files\\eTimeTrackLite/.test(ps), 'it hardcodes an install path');

  // The question this exists to answer first: is the punch software on the
  // same machine as the HRMS? If it is, there is no network hop to arrange.
  assert.match(ps, /COMPUTERNAME/);
  assert.match(ps, /DESKTOP-6OKJT47/);
  assert.match(ps, /BNFHRMS/);
});
