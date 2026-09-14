/**
 * The board controls stay put while the list scrolls.
 *
 * Asked for over a 277-task list: the tabs, the day chips and the folders were
 * ten screens up by the time you wanted one, so changing the view meant
 * scrolling to the top and then finding your place again.
 *
 * Pinned here because the two things that can quietly break it are both
 * invisible in a screenshot taken at the top of the page: the offset drifting
 * away from the top bar's real height, and the controls being split into
 * separate sticky elements that then need each other's heights.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../../frontend/src/styles.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const header = fs.readFileSync(new URL('../../frontend/src/components/Header.jsx', import.meta.url), 'utf8');

const block = (selector) => {
  const re = new RegExp(`(^|[,}])\\s*${selector.replace('.', '\\.')}\\s*\\{([^{}]*)\\}`, 'm');
  return css.match(re)?.[2] ?? null;
};

describe('the board controls', () => {
  it('are one block, so they cannot drift apart', () => {
    assert.match(app, /className="board-controls"/, 'the wrapper is gone');
    // Everything that should be inside it, in order, before the closing tag.
    const start = app.indexOf('className="board-controls"');
    const end = app.indexOf('</div>', app.indexOf('FolderStrip', start));
    const inside = app.slice(start, end);
    for (const part of ['work-head', 'DayBar', 'FolderStrip']) {
      assert.ok(inside.includes(part), `${part} should be inside the sticky block`);
    }
  });

  it('stick, and under the top bar rather than over or below it', () => {
    const body = block('.board-controls');
    assert.ok(body, 'no .board-controls rule');
    assert.match(body, /position:\s*sticky/);
    assert.match(body, /top:\s*var\(--topbar-h/,
      'the offset must follow the measured bar height, not a number typed here');
    const z = Number(body.match(/z-index:\s*(\d+)/)?.[1]);
    const barZ = Number(block('.topbar').match(/z-index:\s*(\d+)/)?.[1]);
    assert.ok(z < barZ, `controls (${z}) must pass under the top bar (${barZ})`);
    assert.match(body, /background:/, 'rows would show through a transparent block');
  });

  it('take their offset from a bar that is actually measured', () => {
    // The bar wraps to two rows on a phone and grows with the browser's font
    // size, so any constant is wrong on some screen - and wrong here means the
    // controls hide behind the bar or float below a gap.
    assert.match(header, /--topbar-h/, 'the top bar never publishes its height');
    assert.match(header, /ResizeObserver/, 'the height is measured once and never again');
  });

  it('scroll away on a phone, where pinning them would cost the list', () => {
    // Every .board-controls rule in the file, with the media query it sits
    // under. Splitting the text on "@media" ignores nesting and attributes a
    // rule to whichever query came before it, which is how an earlier version
    // of this test read the desktop rule as the phone one.
    const rules = [];
    const re = /\.board-controls\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
      const before = css.slice(0, m.index);
      const query = [...before.matchAll(/@media([^{]*)\{/g)].pop()?.[1]?.trim() ?? null;
      // Only count that query if the rule is actually still inside it.
      const opens = (before.match(/\{/g) || []).length;
      const closes = (before.match(/\}/g) || []).length;
      rules.push({ body: m[1], query: opens > closes ? query : null });
    }
    const phone = rules.find((r) => /max-width:\s*760px/.test(r.query || ''));
    assert.ok(phone, 'no phone rule for the controls');
    assert.match(phone.body, /position:\s*static/,
      'on a 390px screen the block is 226px tall - pinning it leaves no list');
    // And the unconditional rule is the sticky one, not the other way round.
    const base = rules.find((r) => !r.query);
    assert.match(base.body, /position:\s*sticky/);
  });
});
