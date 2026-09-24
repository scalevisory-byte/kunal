/**
 * The version history on the What's new page.
 *
 * It ships inside the dashboard bundle, so the top entry is the version that
 * is running. These cases keep it readable: newest first, one entry per
 * version, every entry saying something, and "new" meaning newer.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CHANGELOG, CURRENT, compareVersions, unseen } from '../../frontend/src/changelog.js';

const read = (p) => fs.readFileSync(new URL(`../../frontend/src/${p}`, import.meta.url), 'utf8');

describe('changelog', () => {
  it('is newest first, by version and by date', () => {
    for (let i = 1; i < CHANGELOG.length; i += 1) {
      const [newer, older] = [CHANGELOG[i - 1], CHANGELOG[i]];
      assert.ok(compareVersions(newer.version, older.version) > 0, `${newer.version} should be above ${older.version}`);
      assert.ok(newer.date >= older.date, `${newer.version} is dated before ${older.version}`);
    }
    assert.equal(CURRENT, CHANGELOG[0]);
  });

  it('has one entry per version, each with a date, a title and changes', () => {
    const versions = CHANGELOG.map((r) => r.version);
    assert.equal(new Set(versions).size, versions.length, 'a version number is used twice');
    for (const r of CHANGELOG) {
      assert.match(r.version, /^\d+\.\d+(\.\d+)?$/);
      assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(!Number.isNaN(Date.parse(r.date)), `${r.version} has an impossible date`);
      assert.ok(r.title?.trim(), `${r.version} has no title`);
      assert.ok(r.changes.length > 0 && r.changes.every((c) => c.trim()), `${r.version} lists no changes`);
    }
  });

  it('compares versions as numbers, so 1.13 is newer than 1.9', () => {
    assert.ok(compareVersions('1.13', '1.9') > 0);
    assert.ok(compareVersions('2.0', '1.99') > 0);
    assert.equal(compareVersions('1.4', '1.4.0'), 0);
  });

  it('counts only newer versions as new, and nothing on a first visit', () => {
    assert.deepEqual(unseen(null), []);
    assert.deepEqual(unseen(CURRENT.version), []);
    const second = CHANGELOG[1].version;
    assert.deepEqual(unseen(second).map((r) => r.version), [CURRENT.version]);
  });

  it('is reachable: a sidebar item, a page, a banner and the version in the build line', () => {
    assert.match(read('components/Sidebar.jsx'), /key: 'whatsnew'/);
    const app = read('App.jsx');
    assert.match(app, /section === 'whatsnew'/);
    assert.match(app, /newReleases\.length > 0/);
    assert.match(read('components/StatusBar.jsx'), /CURRENT\.version/);
  });
});
