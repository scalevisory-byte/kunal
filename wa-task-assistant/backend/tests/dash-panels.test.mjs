/**
 * The dashboard's panels have places, not just a grid to fall into.
 *
 * The first version laid them with `repeat(auto-fit, minmax(300px, 1fr))`,
 * which is a reflow, not a layout: each card goes wherever the one before it
 * left off. So the calendar sat in the middle of the first row and Recent
 * activity got a 375px column it had to wrap every line into — reported as
 * "recent activity ko sidhi line me lo / calendar ko side me kar do / thodi
 * height badi karna".
 *
 * Named areas answer all three at once, and this test pins the two rules that
 * a later edit could quietly lose: the log runs the full width of its row, and
 * a panel the stylesheet does not place cannot appear on the page. It reads
 * the stylesheet because nothing else can — every other test here runs against
 * the API, where a layout does not exist.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../../frontend/src/styles.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const jsx = fs.readFileSync(new URL('../../frontend/src/components/SideRail.jsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');

/** Every `grid-template-areas` value written for `.rail.spread`, as rows of names. */
function areaMaps() {
  const out = [];
  const re = /\.rail\.spread\s*\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const areas = /grid-template-areas:\s*([^;]+);/.exec(m[1]);
    if (!areas) continue;
    out.push([...areas[1].matchAll(/"([^"]*)"/g)].map((q) => q[1].trim().split(/\s+/)));
  }
  return out;
}

describe('the dashboard panels are placed, not dropped', () => {
  it('lays them out by name at every width', () => {
    const maps = areaMaps();
    assert.ok(maps.length >= 3, 'expected a layout for wide, medium and phone');
    assert.ok(
      !/\.rail\.spread\s*\{[^{}]*repeat\(auto-fit/.test(css),
      'an auto-fit grid puts each panel wherever it lands, which is how the calendar ended up in the middle',
    );
  });

  it('gives every panel in the markup a place', () => {
    const named = [...jsx.matchAll(/className="rail-card[^"]*\br-([a-z]+)\b/g)].map((m) => m[1]);
    assert.ok(named.length >= 4, `expected the panels to be named, saw ${named.length}`);
    for (const name of named) {
      assert.match(
        css,
        new RegExp(`\\.rail\\.spread\\s+\\.r-${name}\\s*\\{[^{}]*grid-area:\\s*${name}`),
        `.r-${name} has no grid area, so it would land outside the layout`,
      );
      for (const map of areaMaps()) {
        assert.ok(
          map.some((row) => row.includes(name)),
          `.r-${name} is missing from one of the layouts`,
        );
      }
    }
  });

  /*
   * Asked with a screenshot of the empty strip down the right of the page:
   * "calendar ko yaha dalo". It had been one of the panels at the foot of the
   * dashboard, a screen and a half below the work it is about.
   */
  it('keeps the calendar beside the board, not among the panels', () => {
    assert.ok(
      !/r-cal/.test(jsx) && !/MonthCalendar/.test(jsx),
      'the calendar is back in the rail, where it is below everything it is about',
    );
    assert.match(app, /className="dash-cal"/, 'nothing renders the calendar column');
    assert.match(app, /<MonthCalendar/, 'the column is empty');
    assert.match(
      css,
      /\.workspace\.withcal\s*\{[^{}]*grid-template-columns:\s*minmax\(0, 1fr\)\s+minmax\(/,
      'the dashboard has no second column for it',
    );
    // A calendar that scrolls away is one you scroll back up to, so it sticks.
    assert.match(css, /\.dash-cal\s*\{[^{}]*position:\s*sticky/, 'the column does not stay put');
    // And where there is no strip to take it from, it must not take the board's.
    const narrow = /@media\s*\(max-width:\s*1240px\)\s*\{([\s\S]*?)\n\}/.exec(css);
    assert.ok(narrow, 'no breakpoint folding the column away');
    assert.match(narrow[1], /\.workspace\.withcal\s*\{[^{}]*grid-template-columns:\s*minmax\(0, 1fr\)\s*;/);
  });

  it('runs the activity log the full width of its row', () => {
    for (const map of areaMaps()) {
      const rows = map.filter((row) => row.includes('activity'));
      assert.ok(rows.length > 0, 'the log is not in this layout at all');
      for (const row of rows) {
        assert.ok(
          row.every((cell) => cell === 'activity'),
          `the log shares its row with ${row.filter((c) => c !== 'activity').join(', ')}, so its lines wrap`,
        );
      }
    }
  });

  it('lets the log wrap where a line cannot be held straight', () => {
    // One line per entry needs width. At 390px five of six entries were cut
    // mid-word, and a truncated sentence says less than a second line costs.
    const phone = /@media\s*\(max-width:\s*820px\)\s*\{([\s\S]*?)\n\}/.exec(css);
    assert.ok(phone, 'no phone breakpoint for the panels');
    assert.match(
      phone[1],
      /\.rail\.spread\s+\.r-activity\s+\.act-text\s*\{[^{}]*white-space:\s*normal/,
      'the log still refuses to wrap on a phone',
    );
  });
});
