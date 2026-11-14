import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELP, searchHelp, helpTopic } from '../../shared/help.js';
import { CHANGELOG, CURRENT, VERSION, hasNews, since } from '../../shared/version.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => fs.readFileSync(path.join(here, '../../frontend/src', p), 'utf8');

/* ---------------- the help topics ---------------- */

test('every topic explains itself and can be found', () => {
  assert.ok(HELP.length >= 30, `only ${HELP.length} topics`);
  const ids = new Set();
  for (const topic of HELP) {
    assert.ok(topic.id && !ids.has(topic.id), `duplicate or missing id: ${topic.id}`);
    ids.add(topic.id);
    assert.ok(topic.title && topic.title.length > 8, `${topic.id} has no real title`);
    assert.ok(topic.lines?.length, `${topic.id} says nothing`);
    for (const line of topic.lines) assert.ok(line.trim().length > 20, `${topic.id} has a stub line`);
    // Without keywords a topic can only be found by its own title, which is
    // the one wording somebody who needs it does not know.
    assert.ok((topic.keywords || []).length >= 3, `${topic.id} has too few keywords`);
  }
});

test('a topic that names a tab names a real one', () => {
  /*
   * Half of what has been reported as missing in this app was never missing -
   * it was behind a link nobody recognised. So help says where things are,
   * and "Open it →" must not land on a tab that does not exist.
   */
  const app = src('App.jsx');
  const tabs = new Set(
    [...app.matchAll(/^\s*\[\s*'([a-z]+)',\s*'[^']+',\s*'[a-z]+'\s*\]/gm)].map((m) => m[1])
  );
  assert.ok(tabs.size >= 8, `only found ${tabs.size} tabs to check against`);
  for (const topic of HELP) {
    if (!topic.tab) continue;
    assert.ok(tabs.has(topic.tab), `${topic.id} points at "${topic.tab}", which is not a tab`);
  }
});

test('the Hinglish somebody would actually type finds something', () => {
  // Searching "chutti" and getting nothing is the fastest way to decide a
  // help screen is useless.
  for (const word of ['chutti', 'pagar', 'hajri', 'ghante', 'saman', 'mahina', 'foto']) {
    assert.ok(searchHelp(word).length > 0, `nothing found for "${word}"`);
  }
});

test('search puts the topic somebody meant first', () => {
  assert.equal(searchHelp('leave')[0].topic.id.includes('leave'), true);
  assert.equal(searchHelp('sunday')[0].topic.id, 'sunday-register');
  assert.equal(searchHelp('pf')[0].topic.id, 'pf-esi-pt');
  assert.equal(searchHelp('payslip')[0].topic.id, 'payslips');
  assert.equal(searchHelp('backup')[0].topic.id, 'backup');
  assert.equal(searchHelp('essl')[0].topic.id, 'biometric');
});

test('every word has to land, so two words narrow instead of widen', () => {
  const sunday = searchHelp('sunday').length;
  const both = searchHelp('sunday register').length;
  assert.ok(both <= sunday, 'adding a word widened the results');

  // A word in nothing gives nothing, rather than everything.
  assert.deepEqual(searchHelp('zzzqqq'), []);
  assert.deepEqual(searchHelp('sunday zzzqqq'), []);
});

test('an empty search is a contents page, not an empty box', () => {
  assert.equal(searchHelp('').length, HELP.length);
  assert.equal(searchHelp('   ').length, HELP.length);
  // ...and in the order written, which is the reading order of the app.
  assert.equal(searchHelp('')[0].topic.id, HELP[0].id);
});

test('staff see only what applies to them', () => {
  const staff = HELP.filter((t) => t.staff);
  assert.ok(staff.length >= 5, 'a staff login would get almost no help');
  // Nothing that needs a screen they cannot reach.
  for (const id of ['bulk-employees', 'biometric', 'statutory', 'assets', 'roles', 'audit']) {
    assert.equal(helpTopic(id)?.staff, undefined, `${id} is offered to staff`);
  }
  assert.ok(staff.some((t) => t.id === 'apply-leave'));
  assert.ok(staff.some((t) => t.id === 'work-from-home'));
});

test('the traps are written down, because they are the valuable half', () => {
  // These are the sentences that stop somebody losing money, and each one
  // cost a real bug to learn.
  const noteOf = (id) => helpTopic(id)?.note || '';
  assert.match(noteOf('biometric'), /no record|absences nobody earned/i);
  assert.match(noteOf('assets'), /not checked/i);
  assert.match(noteOf('apply-leave'), /nobody|changes nothing/i);
  assert.match(noteOf('short-leave'), /twice/i);
  assert.match(noteOf('late-early'), /twice/i);
  assert.match(noteOf('payslips'), /ONE FILE HOLDS ONE PERSON|one person/i);
  assert.match(noteOf('salary-structure'), /never changes what anybody is paid/i);
});

/* ---------------- the version and its history ---------------- */

test('the version and the changelog agree, newest first', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(CHANGELOG[0].version, VERSION, 'the top of the history is not this version');
  assert.equal(CURRENT.version, VERSION);

  const rank = (v) => v.split('.').map(Number);
  for (let i = 1; i < CHANGELOG.length; i++) {
    const [a, b] = [rank(CHANGELOG[i - 1].version), rank(CHANGELOG[i].version)];
    const newer = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    assert.ok(newer > 0, `${CHANGELOG[i - 1].version} is not newer than ${CHANGELOG[i].version}`);
  }

  for (const entry of CHANGELOG) {
    assert.ok(entry.date && entry.title, `${entry.version} has no date or title`);
    assert.ok(entry.items?.length, `${entry.version} lists nothing`);
    for (const item of entry.items) assert.ok(item.length > 25, `${entry.version} has a stub item`);
  }
});

test('never having looked means everything is new, not nothing', () => {
  // The opposite would hide the whole history from somebody opening it for
  // the first time, which is exactly who it is for.
  assert.equal(since('').length, CHANGELOG.length);
  assert.equal(since(null).length, CHANGELOG.length);
  assert.equal(since('9.9.9').length, CHANGELOG.length, 'an unknown version hid the history');
  assert.equal(hasNews(''), true);

  assert.equal(since(VERSION).length, 0);
  assert.equal(hasNews(VERSION), false);
  assert.equal(since(CHANGELOG[1].version).length, 1);
});

test('the build stamp and the version are both on the rail', () => {
  const app = src('App.jsx');
  // The version says which release; the build stamp says which COPY of it -
  // the figure that settles "the update did not take".
  assert.match(app, /v\{VERSION\} · \{BUILT_ON\}/);
  assert.match(app, /className="side-version"/);
  assert.match(app, /className="side-help"/);
  // A help dot must never take the app down in a private window.
  assert.match(app, /try \{\s*return localStorage\.getItem\('bnf-hrms-seen-version'\)/);
});

test('the help header is a row, because a global rule says <header> is a column', () => {
  const css = fs.readFileSync(path.join(here, '../../frontend/src/styles.css'), 'utf8');
  /*
   * Not redundant. The panel's header is a <header>, and the global rule for
   * those stacks them. Without an explicit row the close button landed on its
   * own line and the header stood 111px tall instead of 62 - measured. Same
   * family as the checkbox that a global input rule collapsed to 0px.
   */
  const rule = css.match(/\.help-head-row \{[^}]*\}/);
  assert.ok(rule, 'the help header has no rule of its own');
  assert.match(rule[0], /flex-direction: row/);
  assert.match(css, /\.help-head-row > button \{[^}]*flex: 0 0 auto/);
});
