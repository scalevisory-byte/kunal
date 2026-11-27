/**
 * What staff do from their own login that waits for the office reaches the
 * dashboard - and each line opens the screen that can deal with it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { digest } from '../../shared/digest.js';

test('three waiting lines, each with the tab that can act on it', () => {
  const built = digest({
    profile_changes: { people: 2, changes: 7, names: ['Amit Shah', 'Riya Pal'] },
    unchecked_documents: [{ employee_name: 'Amit Shah' }, { employee_name: 'Amit Shah' }],
    asset_claims: [{ employee_name: 'Riya Pal' }],
    today: '2026-11-27',
  });
  const find = (re) => built.items.find((i) => re.test(i.text));
  const profile = find(/filled in their own record/);
  assert.match(profile.text, /2 people .* 7 changes waiting for HR: Amit Shah, Riya Pal/);
  assert.equal(profile.go, 'employees');
  const docs = find(/uploaded and not checked yet/);
  assert.match(docs.text, /^2 documents .*: Amit Shah$/, 'named once, however many papers');
  assert.deepEqual([docs.go, docs.focus], ['reports', 'documents']);
  const assets = find(/say they are holding/);
  assert.equal(assets.go, 'assets');
});

test('nothing waiting says nothing', () => {
  const built = digest({ profile_changes: { people: 0, changes: 0, names: [] }, today: '2026-11-27' });
  assert.ok(!built.items.some((i) => /own record|not checked|holding/.test(i.text)));
});

test('the screens: HR’s panel is first on the Employees tab, and the portal says what is waiting', () => {
  const read = (f) => fs.readFileSync(new URL(`../../frontend/src/${f}`, import.meta.url), 'utf8');
  const tab = read('components/Employees.jsx');
  assert.match(tab, /import ProfileApprovals from '\.\/ProfileApprovals\.jsx'/);
  assert.match(tab, /import \{ STANDALONE \} from '\.\.\/api\.js'/);
  assert.ok(tab.indexOf('<ProfileApprovals') < tab.indexOf('<div className="card">', tab.indexOf('religion-list')), 'above the staff list, not under it');
  const form = read('components/my/MyProfileForm.jsx');
  assert.match(form, /waiting for HR/);
  assert.match(form, /onRecord\.includes\(f\.field\)/, 'locked only once it is really on the record');
  const reports = read('components/Reports.jsx');
  assert.match(reports, /focus !== 'documents'/);
  const css = read('styles.css');
  for (const cls of ['profile-approvals', 'pa-decide', 'vf-waiting']) assert.ok(css.includes(cls), `${cls} has a rule`);
});
