import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Rules about the SHAPE of the screens, pinned where they can be checked.
 *
 * Nothing that runs against the API can see any of this: the figure was on
 * the page, the name was in the row, the employee list was rendered - and a
 * person still could not read them, because of a block element, a wrapped
 * label, and the order the cards were written in. Every one of these was
 * found by measuring a real browser, so each case below says the measurement
 * it stands for.
 *
 * These read the source. That is the point: a test that drove the app would
 * need a browser, and the four facts here are decided in the markup and the
 * stylesheet, not at run time.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => fs.readFileSync(path.join(here, '../../frontend/src', p), 'utf8');
const css = src('styles.css');

test('the roll call decides allowed/not/undecided on ONE line', () => {
  const dash = src('components/Dashboard.jsx');

  // The three states still exist - this is not a tick box, and "nobody has
  // decided" must never be stored or read as a refusal.
  assert.match(dash, /approved: true/);
  assert.match(dash, /approved: false/);
  assert.match(dash, /approved: null/);

  // One inline control, not two buttons with a block under them. The block
  // was 'not decided' in a <div>, which made every row of this table 89px
  // tall: eighteen people came to 1,479px of a 3,635px page, for a list
  // that is read at a glance each morning. Measured after: 31px a row.
  assert.match(dash, /className="yesno"/);
  assert.ok(
    !/<div className="muted small">not decided<\/div>/.test(dash),
    'the undecided state is back to being a block under the buttons'
  );
  assert.match(css, /\.yesno\s*\{[^}]*display:\s*inline-flex/);

  // An absence of a decision carries no fill. Lighting it put an identical
  // grey mark down every row, which is the wall this is undoing.
  assert.match(css, /\.yesno button\.on\.none\s*\{[^}]*background:\s*none/);
});

test('the Why example appears on the row you are on, not on all eighteen', () => {
  // It read "rang in - fever" in grey on every empty row, which is a column
  // of identical text that looks like something somebody typed.
  assert.match(css, /input\.why-box::placeholder\s*\{\s*color:\s*transparent/);
  assert.match(css, /tbody tr:hover input\.why-box::placeholder/);
  assert.match(css, /input\.why-box:focus::placeholder/);

  // ...but an empty cell still has to say it can be typed in. A touch screen
  // has no hover, so this mark and the :focus rule above are the whole of
  // what it gets.
  assert.match(css, /input\.why-box:placeholder-shown\s*\{[^}]*border-bottom/);
});

test('nine figures in a row sit on one baseline, at every width', () => {
  // "Out of uniform" is the only label long enough to wrap, which dropped
  // that one figure 9px below the other eight and made the row read as two
  // rows. The label reserves two lines whether it needs them or not, so it
  // holds at the widths that wrap as well as the widths that do not.
  assert.match(css, /\.roll-call \.stat \.stat-label\s*\{[^}]*min-height/);
});

test('Employees opens on the employees', () => {
  const emp = src('components/Employees.jsx');
  const list = emp.indexOf('<ScrollFrame>');
  const queue = emp.indexOf('<OnboardingQueue');
  const add = emp.indexOf("<h2>Add employee</h2>");
  assert.ok(list > 0 && queue > 0 && add > 0, 'all three blocks are on the page');
  // The list used to start 1,434px down a 2,392px page, behind twelve rows
  // of the same sentence and a form. It is first now: top 100 of 1,843.
  assert.ok(list < queue, 'the employee list comes before "Still to finish"');
  assert.ok(list < add, 'the employee list comes before the Add employee form');
});

test('"Still to finish" folds, but never folds its count away', () => {
  const emp = src('components/Employees.jsx');
  const start = emp.indexOf('function OnboardingQueue');
  const block = emp.slice(start, emp.indexOf('\n}', start));
  assert.match(block, /<details className="card fold"/);
  // A fold may hide rows. It may not hide the fact that there is something
  // to do - so the count is in the summary, which is what stays on screen.
  const summary = block.slice(block.indexOf('<summary>'), block.indexOf('</summary>'));
  assert.match(summary, /open\.length/, 'the count is outside the fold');
});

test('a sheet wider than its frame says so, and only when it is', () => {
  const frame = src('components/ScrollFrame.jsx');
  // It measures. A breakpoint cannot know that the window changed, that a
  // filter dropped a column, or that the sidebar folded away.
  assert.match(frame, /scrollWidth/);
  assert.match(frame, /clientWidth/);
  assert.match(frame, /ResizeObserver/);
  // Nothing at all when the table fits: a shadow that is always on would say
  // "there is more over here" about a table with nothing hidden.
  assert.match(css, /\.scroll-frame::before,\s*\.scroll-frame::after\s*\{[^}]*opacity:\s*0/);
  assert.match(css, /\.scroll-frame\.more-left::before,\s*\.scroll-frame\.more-right::after\s*\{\s*opacity:\s*1/);

  // The three sheets that are genuinely cut at 1440px: measured at 500px,
  // 740px and 523px past their frames.
  for (const file of [
    'components/SalarySheet.jsx',
    'components/Attendance.jsx',
    'components/Employees.jsx',
  ]) {
    assert.match(src(file), /<ScrollFrame/, `${file} has no scroll frame`);
    assert.match(src(file), /import ScrollFrame from '\.\/ScrollFrame\.jsx'/, `${file} does not import it`);
  }
});

test('no visually-hidden span inside a scrolling sheet', () => {
  /*
   * A span with position: absolute is laid out against the nearest POSITIONED
   * ancestor - and a .table-wrap is not one. So it escapes the frame it looks
   * like it is inside, takes its static position from a cell 340px past the
   * right-hand edge of a phone, and pushes the whole page sideways. Measured:
   * 55px at 950 and 340px at 390, on the dashboard, from one 1px span.
   *
   * The same bug cost this codebase a 635px sideways scroll once before. A
   * button that needs words for a screen reader gets aria-label.
   */
  assert.ok(!/className="sr-only"/.test(src('components/Dashboard.jsx')));
  assert.ok(!/\.sr-only\s*\{/.test(css), 'an unused .sr-only is a trap for the next person');
  assert.match(src('components/Dashboard.jsx'), /aria-label="not decided"/);
});

test('a sheet is the width of its columns, not of its card', () => {
  /*
   * The slack used to go entirely into the LAST column so that the figure
   * columns kept their own width - which is right until the last column is
   * itself a figure. On the Time tab "Would cost" was 601px wide for a 79px
   * number: a row read "11h 30m", then six hundred pixels of nothing, then
   * "944". Measured slack on four sheets before the change: Time 522px,
   * Attendance 823, Dashboard 603, Leave 321. After: none over 80 anywhere.
   */
  assert.ok(
    !/table\.sheet th:last-child,\s*table\.sheet td:last-child\s*\{[^}]*width:\s*100%/.test(css),
    'the last column is taking all the slack again'
  );
  // And the table no longer stretches to fill the card to get that slack.
  const rule = css.slice(css.indexOf('table.sheet {'), css.indexOf('}', css.indexOf('table.sheet {')));
  assert.ok(!/min-width:\s*100%/.test(rule), 'table.sheet is stretching to its card again');
  // The last column keeps losing its right-hand rule - that is the sheet's
  // outer edge, not a missing gridline.
  assert.match(css, /table\.sheet td:last-child \{ border-right: none; \}/);
});

test('a class the markup uses 46 times has a rule', () => {
  /*
   * .row had NONE. Every one of them was a plain block, so inline children
   * ran together with no space ("Raise a vacancyoradd somebody by hand",
   * "+ New vacancyAdd a candidate") and block children stacked where a
   * toolbar was meant. Measured across the tabs, sub-tabs and a drawer: 6
   * squashed to a 0px gap, 6 stacked, 0 laid out as anyone would choose.
   *
   * That flex was always the intent is not a guess - the only two rules that
   * existed for it set flex properties, and .split-add .row set align-items
   * and gap on what was a block, where neither does anything.
   */
  assert.match(css, /^\.row \{[^}]*display:\s*flex/m);
  assert.match(css, /^\.row \{[^}]*gap:/m);
  // .field.inline had the same hole: on the Assets filter "Financial year"
  // wrapped to two lines and dropped its select 6px below its neighbours.
  assert.match(css, /^\.field\.inline \{[^}]*display:\s*inline-flex/m);
});

test('the hiring module uses the same tables as the rest of the app', () => {
  /*
   * Hiring was built as a separate app and moved in; its six tables never
   * got the house class, so they had no header band, no gridlines and no
   * cell padding. An empty Vacancies list read as one run-on line:
   * "Ref Job Company Location Seats Joined Applied Status".
   */
  const dir = path.join(here, '../../frontend/src/components/hiring');
  const bare = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jsx'))
    .filter((f) => /<table>/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepEqual(bare, [], `these hiring tables carry no class: ${bare.join(', ')}`);
  // Their name cells carry a second line, which table.sheet's one-line rows
  // would clip - the same exception the roll call takes.
  assert.match(css, /table\.sheet\.hiring-table td \{[^}]*white-space:\s*normal/);
});

test('the asset screen offers the thing its own sentence names', () => {
  /*
   * The Assets tab opens on the Dashboard. "Add an asset" lived only on the
   * Register tab, and the empty dashboard read:
   *
   *   Nothing on the register yet for this filter. Add an asset, or import
   *   the list you already keep in Excel.
   *
   * ...as grey text, with no button anywhere on the screen. The first
   * question asked about it was "new asset add ka option kaha he".
   *
   * Fourth time now (hiring's "add vacancy", People, the asset invoice, this):
   * a feature reachable only from somewhere you are not is a feature that
   * does not exist. A sentence that names an action has to BE the action.
   */
  const dash = src('components/people/AssetDashboard.jsx');
  assert.match(dash, /onAdd/, 'the asset dashboard has no way to add one');
  assert.match(dash, /onImport/);
  // ...and the sentence's own words are the buttons, not prose beside them.
  assert.ok(
    !/Nothing on the register yet for this filter\. Add an asset, or import/.test(dash),
    'the empty state is back to naming an action it does not offer'
  );
  // Both land on the Register with the right panel already open, so there is
  // still exactly one add form in the module.
  const assets = src('components/people/Assets.jsx');
  assert.match(assets, /onAdd=\{\(\) => \{[^}]*setAdding\(true\)[^}]*setView\('register'\)/);
  assert.match(assets, /onImport=\{\(\) => \{[^}]*setImporting\(true\)[^}]*setView\('register'\)/);
});

test('a filter strip is a row on every screen that uses one', () => {
  /*
   * `.pf-find-row` was written as `.person-find .pf-find-row`, so the asset
   * dashboard's copy of the same markup matched NO rule: its four fields fell
   * into ordinary inline flow and "Financial year" wrapped onto two lines,
   * standing 38px against its neighbours' 31px and dropping its select 9px
   * out of line. Measured after: 31/31/31/31, one baseline, at 1680, 1440,
   * 950, 390 and in dark.
   */
  assert.match(css, /^\.pf-find-row \{[^}]*display:\s*flex/m);
  assert.ok(
    !/^\.person-find \.pf-find-row \{/m.test(css),
    'the filter strip is scoped to one screen again'
  );
  // A two-word caption stays beside its box rather than wrapping above it.
  assert.match(css, /^\.field\.inline \{[^}]*white-space:\s*nowrap/m);
});

test('a form field with a hint does not drag its row out of line', () => {
  /*
   * `.form-grid { align-items: end }` bottom-aligns each field, so the one
   * carrying a hint under its box ("Invoice - the number; attaching the PDF
   * needs the server version") rode UP by the height of that hint while the
   * three beside it stayed down. The asset form's second row read as four
   * boxes at four different heights.
   *
   * Measured after, at 1680/1440/950/390: 11 fields, every box in a row on
   * one line, and no sideways scroll.
   */
  assert.match(css, /^\.form-grid \{[^}]*align-items:\s*start/m);
  // Comments stripped first: the rule explains itself by quoting the old
  // declaration, and the first version of this check matched its own comment.
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(
    !/^\.form-grid \{[^}]*align-items:\s*end/m.test(code),
    'the form grid is bottom-aligned again'
  );
  /*
   * And the boxes fill their cell. Chromium's date input has an intrinsic
   * 209px it will not give up, so "Bought on" and "Warranty until" pushed the
   * page 6-20px sideways the moment the label became a grid.
   */
  assert.match(css, /\.form-grid label > input[^{]*\{[^}]*min-width:\s*0/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test('a long toolbar wraps in groups, never one orphan', () => {
  // "Handovers (CSV)" wrapped onto a line of its own under everything else.
  // The three ways out now wrap as one block pushed to the right-hand end.
  assert.match(css, /\.toolbar \.push-right \{[^}]*margin-left:\s*auto/);
  const assets = src('components/people/Assets.jsx');
  const group = assets.slice(assets.indexOf('className="push-right"'));
  for (const text of ['Labels to print', 'Register (CSV)', 'Handovers (CSV)']) {
    assert.ok(group.slice(0, 1400).includes(text), `${text} is outside the group again`);
  }
});
