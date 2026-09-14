/**
 * The chat name is on the row at every width.
 *
 * Reported five times as "the name is not coming", and answered four times by
 * fixing the data — the repair's scope, the fallback label, the rule that
 * decides whether a stored value is a name at all. Every one of those was a
 * real bug and none of them was this one. The count in Settings read "449 rows
 * showing their chat" over a list showing none, and both were telling the
 * truth: the name was in the row, and a stylesheet was hiding it.
 *
 *     @media (max-width: 1080px) { .t-chat { display: none; } }
 *
 * His window is a half-screen split at roughly 950px, squarely inside that
 * band. The rule dated from when the same line also carried the arrival date
 * and two more items and something had to go; the date has had its own column
 * for a while now, and the chat is the opposite of the thing to drop — it is
 * who asked.
 *
 * No other test could have caught it. Everything here runs against the API and
 * the database, where the name was always present and correct. So this one
 * reads the stylesheet: the chat name may be narrowed, and at some widths must
 * be, but it may never be removed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../frontend/src/styles.css', import.meta.url), 'utf8');
// Comments carry prose about these very rules, and a naive block reader would
// take a paragraph as part of the next selector.
const css = source.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every declaration block whose selector list mentions `.t-chat`. */
function blocksFor(selectorPart) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const selector = m[1].trim();
    if (selector.startsWith('@')) continue;
    if (selector.split(',').some((s) => s.includes(selectorPart))) {
      out.push({ selector, body: m[2] });
    }
  }
  return out;
}

describe('the chat name on a task row', () => {
  it('is never removed by any rule, at any width', () => {
    const offenders = blocksFor('.t-chat')
      .filter(({ body }) => /display\s*:\s*none/.test(body));
    assert.deepEqual(
      offenders.map((o) => o.selector), [],
      'a rule hides the chat name; it may be narrowed, never dropped — this is '
      + 'the bug that was reported five times and answered four times in the wrong layer',
    );
  });

  it('still has rules, so the test is testing something', () => {
    assert.ok(blocksFor('.t-chat').length >= 2, 'no .t-chat rules found — has it been renamed?');
  });

  it('keeps enough width to read a few characters when the line is short of room', () => {
    const base = blocksFor('.t-chat').find(({ selector }) => selector === '.t-chat');
    assert.ok(base, 'no plain .t-chat rule');
    assert.match(base.body, /min-width\s*:\s*[1-9]/,
      'without a floor the chat can shrink to its icon, which reads as a missing name');
    assert.match(base.body, /text-overflow\s*:\s*ellipsis/,
      'a name cut with no ellipsis reads as the wrong name rather than a shortened one');
  });

  it('is the item on the meta line that gives up room, not its neighbours', () => {
    // The neighbours are a word or two at a fixed size; the chat is the only
    // thing that can be forty characters. If everything shrank alike, "By hand"
    // and the priority would be clipped to save a name that had room to spare.
    assert.match(css, /\.t-line\s*>\s*\*\s*\{[^}]*flex\s*:\s*none/,
      'the other items on the line should not shrink');
    assert.match(css, /\.t-line\s*>\s*\.t-chat\s*\{[^}]*flex\s*:\s*0\s+1\s+auto/,
      'the chat should be the one item that shrinks');
  });
});
