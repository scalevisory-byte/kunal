/*
 * The Windows server kit (deploy/windows). PowerShell is not available where
 * the suite runs, so these read the scripts and pin the rules that would fail
 * silently on the server.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../../deploy/windows/${f}`, import.meta.url), 'utf8');
const setup = read('setup.ps1');
const service = read('install-service.ps1');
const update = read('update.ps1');
const guide = read('README.md');
const all = read('install-all.ps1');

describe('Windows server kit', () => {
  it('writes .env without a byte-order mark, which would break the first variable', () => {
    assert.match(setup, /New-Object System\.Text\.UTF8Encoding \$false/);
    assert.doesNotMatch(setup, /Set-Content[^\n]*\.env/);
  });

  it('never overwrites an existing .env', () => {
    assert.match(setup, /if \(Test-Path \$envFile\)/);
  });

  it('names Chrome by path, so the service account finds it', () => {
    assert.match(setup, /PUPPETEER_EXECUTABLE_PATH=\$chrome/);
  });

  it('stops the service before reinstalling, and always starts it again', () => {
    const stop = update.indexOf('nssm stop WATasks');
    const rebuild = update.indexOf("'setup.ps1'");
    assert.ok(stop > -1 && rebuild > stop, 'stop comes before setup');
    assert.match(update, /finally \{[\s\S]*nssm start WATasks/);
  });

  it('runs from the backend folder, where .env is read', () => {
    assert.match(service, /AppDirectory \$backend/);
    assert.match(service, /AppExit Default Restart/);
  });

  it('tells him to clear the WAL files before restoring a backup', () => {
    assert.match(guide, /tasks\.db-wal/);
  });
  it('install-all: asks for Administrator itself and keeps a log', () => {
    assert.match(all, /-Verb RunAs/);
    assert.match(all, /Start-Transcript/);
  });

  it('install-all: forces TLS 1.2, which Server 2019 does not offer first', () => {
    assert.match(all, /SecurityProtocolType\]::Tls12/);
  });

  it('install-all: pins the Node major the app is tested on', () => {
    assert.match(all, /\$NodeMajor = 22/);
    assert.match(all, /v\$NodeMajor\.\*/);
  });

  it('install-all: reloads PATH after installing, so node and git are found', () => {
    const node = all.indexOf("node-$v-x64.msi");
    assert.ok(node > -1 && all.indexOf('RefreshPath', node) > node);
  });

  it('install-all: stops a running service before rebuilding, then hands over to the kit', () => {
    const stop = all.indexOf('nssm stop WATasks');
    const setup = all.indexOf("'setup.ps1'");
    const service = all.indexOf("'install-service.ps1'");
    assert.ok(stop > -1 && setup > stop && service > setup);
  });

  it('install-all: clones the branch the app is developed on', () => {
    assert.match(all, /\$Branch = 'claude\/new-session-5plccw'/);
    assert.match(all, /git clone -b \$Branch/);
  });

  it('every script is plain ASCII, because Windows PowerShell 5.1 misreads UTF-8 without a BOM', () => {
    for (const [name, text] of Object.entries({ setup, service, update, all })) {
      assert.doesNotMatch(text, /[^\x00-\x7F]/, name);
    }
  });

  it('the guide never relies on nssm being on PATH', () => {
    assert.doesNotMatch(guide, /^\s*nssm (stop|start|restart)/m);
    assert.match(guide, /install-all\.ps1/);
  });

  it('gives the app its own Node 22 when the server has another, so nothing needs compiling', () => {
    assert.match(setup, /\$NodeMajor = 22/);
    assert.match(setup, /node-\$v-win-x64\.zip/);
    assert.match(setup, /\$env:Path = \(Split-Path \$nodeExe\)/);
    // the Node step comes before anything npm installs
    assert.ok(setup.indexOf('$env:Path = (Split-Path $nodeExe)') < setup.indexOf('npm ci'));
  });

  it('the service runs on the same Node the packages were built with', () => {
    assert.match(service, /Join-Path \$root '\.node\\node\.exe'/);
  });
});
