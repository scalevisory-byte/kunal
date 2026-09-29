/*
 * "Upar ka hata do, new task ka option kahi aur de do, ye sab screen ke liye
 * karo": pages open on their content, and New Task is in the top bar that
 * every page shares.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(`../../frontend/src/${rel}`, import.meta.url), 'utf8');
const app = read('App.jsx');
const css = read('styles.css');
const header = read('components/Header.jsx');

describe('pages open on their content', () => {
  it('hides every page heading visually, but keeps it for screen readers', () => {
    const rule = css.match(/\.page-head:not\(\.keep\) \{([^}]*)\}/);
    assert.ok(rule, 'a rule hides the page headings');
    assert.match(rule[1], /clip: rect\(0 0 0 0\)/);
    assert.doesNotMatch(rule[1], /display: none/, 'hidden visually, not removed from the page');
  });

  it('keeps only the dashboard greeting and the search results line', () => {
    assert.equal((app.match(/className="page-head keep"/g) || []).length, 2);
  });

  it('has no New Task button left on any page, only the one in the bar', () => {
    assert.doesNotMatch(app, /<\/span> New Task/);
  });
});

describe('New Task is in the top bar', () => {
  it('is a button in the bar every page shares', () => {
    assert.match(header, /className="btn primary topbar-new" onClick=\{onNewTask\}/);
    assert.match(app, /onNewTask=\{newTask\}/);
  });

  it('opens All Tasks with the box ready from a page that has no list of its own', () => {
    const fn = app.slice(app.indexOf('const newTask = () =>'), app.indexOf('const goFigure'));
    assert.match(fn, /if \(noList\) \{ goto\('all'\); setQuick\(true\); \}/);
    assert.match(fn, /setQuickFocus/);
    for (const key of ['settings', 'law', 'legal', 'history', 'usage', 'duplicates']) {
      assert.match(app, new RegExp(`OWN_PAGES = \\[[^\\]]*'${key}'`), key);
    }
  });

  it('leaves the phone to its bottom-bar +', () => {
    assert.match(css, /@media \(max-width: 760px\) \{[^}]*\.topbar-new \{ display: none; \}/);
  });
});
