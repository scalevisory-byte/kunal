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
});
