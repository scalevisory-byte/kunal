import test from 'node:test';
import assert from 'node:assert/strict';
import { REPORTS } from '../../shared/reportCatalog.js';
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
  /*
   * The LABEL on the first one changed when the sheet learned to print only
   * the ticked rows ("Labels for 4 ticked"), so this looks for what it DOES
   * rather than what it says. The rule being kept is the grouping: the ways
   * out wrap as one block, never one orphan on its own line.
   */
  for (const text of ['labelSheet', 'Register (CSV)', 'Handovers (CSV)']) {
    assert.ok(group.slice(0, 2000).includes(text), `${text} is outside the group again`);
  }
});

test('a service cost can be recorded on the day the register is new', () => {
  /*
   * Fifth time, and the worst shape of it: "log a service" existed ONLY as a
   * button on a table row, and the Maintenance tab opens on "Due or overdue"
   * - a filter that is empty until something already carries a next-service
   * date. So on day one the screen read "Nothing is due" with no way anywhere
   * on it to record the first repair, and the question was "maintenance cost
   * kaise update hoga".
   *
   * Driven after: toolbar button -> pick the asset -> 3,500 -> the headline
   * moves to SPENT KEEPING THEM 3,500, IN ALL 45,500, 8.3% to keep.
   */
  const m = src('components/people/Maintenance.jsx');
  assert.match(m, /Record a service/, 'there is no way in that does not need a row');
  // It is on the toolbar, not inside the table.
  // ...from the toolbar to the table AFTER it: there is a second table in the
  // costing card above, and slicing to the first one gave an empty string that
  // every assertion then "passed" against until one of them did not.
  const at = m.indexOf('<div className="toolbar');
  const toolbar = m.slice(at, m.indexOf('<table', at));
  assert.match(toolbar, /setLogging\('pick'\)/);
  // ...and only when there is something to service.
  assert.match(toolbar, /disabled=\{!assets\.length\}/);

  // The form asks which asset when it was not opened from one, and refuses to
  // save until that is answered - a service against nothing is not a record.
  assert.match(m, /function ServiceForm\(\{ asset, assets = \[\]/);
  assert.match(m, /\{!asset && \([\s\S]{0,200}Which one/);
  assert.match(m, /disabled=\{busy \|\| !on\}/);

  // The empty "due" state no longer dead-ends: it says why nothing is due and
  // offers the whole list.
  assert.match(m, /Show all \{assets\.length\}/);
});

test('the AMC can be typed somewhere', () => {
  /*
   * Sixth time, and the clearest case yet: `amc_until`, `amc_vendor` and
   * `amc_cost` were columns on the asset, accepted by the API and by the
   * offline store, counted in their own figure ("AMC ON IT"), shown in the
   * register's Cover column, and ALERTED ON when they lapsed - on the
   * maintenance screen and on the main dashboard. There was no box anywhere
   * in the app to put one in. Every one of those features was reporting a
   * number that could never be anything but zero.
   *
   * Driven offline after: AMC until 2027-03-31, Sai Computers, 6,000 ->
   * "AMC ON IT 6,000", cover "AMC to 2027-03-31", 14.3% to keep; renewed from
   * Maintenance to 2028-03-31 at 7,500 -> 17.9%; a past date is named as "1
   * with a lapsed AMC".
   */
  const assets = src('components/people/Assets.jsx');
  for (const f of ['amc_until', 'amc_vendor', 'amc_cost']) {
    assert.match(assets, new RegExp(`draft\\.${f}`), `the asset form cannot set ${f}`);
  }

  /*
   * ...and renewing it is on the Maintenance screen, because setting it once
   * on the way in is not the thing that happens repeatedly - a contract is
   * renewed every year.
   */
  const m = src('components/people/Maintenance.jsx');
  assert.match(m, /Set an AMC/);
  assert.match(m, /renew AMC/);
  assert.match(m, /function AmcForm/);
  // It writes the three AMC columns and nothing else, so renewing a contract
  // cannot disturb the purchase price, the warranty, or who is holding it.
  const form = m.slice(m.indexOf('function AmcForm'));
  const patch = form.slice(form.indexOf('api.patch'), form.indexOf('api.patch') + 320);
  assert.ok(!/purchase_cost|warranty|employee_id/.test(patch), 'the AMC save touches other columns');
  // A contract with no end date is not a contract.
  assert.match(form, /disabled=\{busy \|\| !on \|\| !form\.amc_until\}/);
  // Clearing one is explicit, never a blank date slipping through.
  assert.match(form, /There is no AMC on this/);
});

test('a search box in a column is one line, not twelve rems tall', () => {
  /*
   * `.search { flex: 1 1 12rem }` sizes the MAIN axis, and `.stack` is a
   * COLUMN. A search box sitting straight in a stack rather than in a toolbar
   * row therefore took a 12rem flex-basis VERTICALLY and grew from there: the
   * stock take's "Narrow the list" was a 250px-tall empty box eating a third
   * of that screen. Measured after: an ordinary 31px line, full width.
   */
  assert.match(css, /\.stack > \.search \{[^}]*flex:\s*0 0 auto/);
});

test('the asset sub-tabs scroll their own tables', () => {
  /*
   * Nine columns of stock take on a 390px phone pushed the PAGE 268px
   * sideways (maintenance, 149px). Every wide table elsewhere in the app is
   * already inside a ScrollFrame - these three were the ones that never got
   * one. Measured after: all six asset sub-tabs clean at 1440, 950 and 390.
   *
   * One ScrollFrame, not a second answer to "does this table carry on past
   * the edge" - a fade that means "there is more" on one page and nothing on
   * the next is worse than no fade at all.
   */
  for (const f of ['StockTake', 'Maintenance']) {
    const s = src(`components/people/${f}.jsx`);
    assert.match(s, /import ScrollFrame from '\.\.\/ScrollFrame\.jsx'/, `${f} has no scroll frame`);
    const tables = (s.match(/<table className="sheet"/g) || []).length;
    const frames = (s.match(/<ScrollFrame>/g) || []).length;
    assert.equal(frames, tables, `${f}: ${tables} tables but ${frames} frames`);
  }
});

test('a handover slip prints whole, and the register does not move a phone', () => {
  /*
   * "Who holds what" works and always did - one line per person, what they
   * have, what it is worth, and a slip to sign. Driven: two laptops and a SIM
   * issued to two people, the slip listing only what each still has.
   *
   * Two things about the SCREEN did not. On a 390px phone the list pushed the
   * page 289px sideways and the slip 132px, because neither table was in the
   * ScrollFrame every other wide table already uses. And the "What" column
   * joins everything one person holds into a single line, which `table.sheet`
   * keeps on one line - a list is the one thing in a sheet that is meant to
   * run on, so it wraps. Measured after: 0 at 1440, 950 and 390.
   */
  const h = src('components/people/HandoverSlips.jsx');
  assert.match(h, /import ScrollFrame from '\.\.\/ScrollFrame\.jsx'/);
  assert.equal(
    (h.match(/<ScrollFrame>/g) || []).length,
    (h.match(/<table className="sheet"/g) || []).length
  );
  assert.match(h, /className="muted small wrap"/);
  assert.match(css, /table\.sheet td\.wrap \{[^}]*white-space:\s*normal/);

  /*
   * ...and a frame that scrolls on screen CLIPS on paper. A slip somebody
   * signs must show every item, so on paper it is not a frame. Driven with
   * eight items in a 700x500 window (where `max-height: 65vh` is in play):
   * all eight rows, the undertaking and both signature lines on the PDF.
   */
  const print = css.slice(css.lastIndexOf('@media print'));
  assert.match(print, /\.table-wrap \{[^}]*overflow:\s*visible !important/);
  assert.match(print, /max-height:\s*none !important/);

  // The offline note printed across the top of that slip. It does not now.
  assert.match(src('components/AssetsTab.jsx'), /className="muted small no-print"/);
});

test('all four asset lists are behind a picker', () => {
  /*
   * The Lists tab calls itself "the four lists behind the pickers" and only
   * TWO of them were. Brands fed a datalist and Vendors fed one; a Type added
   * there ("Printer", "Desk") appeared NOWHERE, because the "What" picker was
   * a hard-coded list of ten, and a Category appeared nowhere at all. Two of
   * the four lists took typing and did nothing with it - which is worse than
   * a screen that is hard to find.
   *
   * Driven offline after: 2 categories, 2 types, 1 brand, 1 vendor added, and
   * the register's picker reads
   *   «Furniture: Desk» | «IT equipment: Printer» | «The usual ones: Laptop,
   *   Desktop, Mobile, SIM card, ID card, Access card, Vehicle, Tools,
   *   Furniture, Other»
   * with Epson and Sai Computers suggested on brand and vendor.
   */
  const a = src('components/people/Assets.jsx');
  assert.match(a, /const kindGroups = useMemo/);
  assert.match(a, /m\.kind === 'type'/);
  assert.match(a, /<optgroup key=\{category\} label=\{category\}>/);
  /*
   * The built-in ten are KEPT, not replaced. Nothing here is a gate: a kind
   * that could be picked yesterday has to be pickable today, and an asset
   * stores its kind as text anyway.
   */
  assert.match(a, /builtIn: KINDS\.filter/);
  assert.match(a, /label="The usual ones"/);

  /*
   * ...and a Type added on the Lists tab reaches that picker with no reload.
   * The register holds its own copy of the masters and loads it once, so
   * without this the new Type simply was not there - which reads exactly like
   * the list not working.
   */
  /*
   * It used to pin the exact JSX. Adding a Category now also tells the
   * group engine, so the callback does two things rather than one - the
   * rule this stands for is that a change on the Lists tab reaches the
   * register's own copy WITHOUT a reload, and that is what is checked.
   */
  assert.match(a, /<AssetMasters[\s\S]{0,400}onChanged=\{\(list\) => \{[\s\S]{0,400}setMasters\(list \|\| \[\]\);/);
  assert.match(src('components/people/AssetMasters.jsx'), /onChanged\?\.\(masters\)/);

  // The chip counts had no space before them - "Categories2" - because .chip
  // is inline-flex and flex drops a whitespace-only child.
  assert.match(css, /\.chip > \.muted \{[^}]*margin-left/);
});

test('the register agrees with the dashboard that opens it', () => {
  /*
   * The dashboard's own comment promises "a card that says 14 and a list that
   * shows 13 cannot happen - clicking a card hands back the exact filter that
   * produced it". Three of its five cards broke that promise. Driven, before:
   *
   *   "4 REGISTERED"        -> Everything      -> 3 rows
   *   "2 AVAILABLE"         -> no chip lit     -> 3 rows
   *   "0 UNDER MAINTENANCE" -> Everything      -> 3 rows
   *
   * After: all five agree.
   */
  const a = src('components/people/Assets.jsx');

  // 1. `?written_off=true` means INCLUDE them, not only them - so the Written
  //    off chip fetched the whole register and narrowed it by nothing.
  assert.match(a, /filter === 'gone' && !a\.written_off_on/);

  // 2. 'available' mapped to 'in', which no filter knows about.
  assert.match(a, /f\.status === 'available' \? 'office'/);
  assert.ok(!/f\.status === 'available' \? 'in'/.test(a), "'available' maps to a filter nothing reads again");

  // 3. "Under maintenance" had no filter at all and fell through to Everything.
  assert.match(a, /filter === 'maintenance' && assetStatus\(a\) !== 'maintenance'/);
  assert.match(a, /\['maintenance', 'Being repaired'\]/);

  // ...and Registered counts what is ON the register. "Bought, in all" still
  // counts the scrapped ones, because that question is about money spent.
  const dash = fs.readFileSync(path.join(here, '../../shared/assetDashboard.js'), 'utf8');
  assert.match(dash, /label: 'Registered',\s*\n\s*n: withStatus\.filter\(\(a\) => a\.status !== 'written_off' && a\.status !== 'disposed'\)\.length/);
});

test('an asset can be said to be at the repair shop', () => {
  /*
   * `ASSET_STATES` lists four states somebody sets, the dashboard counts
   * "Under maintenance", the API has a route for it - and NOTHING in the app
   * could set one. `statusLabel` was imported into the register and never
   * used. A laptop away being repaired could not be said to be away being
   * repaired, and the single file had no route for it at all.
   *
   * Driven offline: mark it... -> Under maintenance -> the row reads "Under
   * maintenance since 2026-11-13 / back in use", the "Being repaired" chip
   * finds it, the dashboard reads 1 UNDER MAINTENANCE and 1 AVAILABLE.
   */
  const a = src('components/people/Assets.jsx');
  assert.match(a, /mark it…/);
  assert.match(a, /\/state`, \{ state, note \}/);
  assert.match(a, /back in use/);
  // The offline store had no route for it, so the single file silently could not.
  assert.match(src('localStore.js'), /parts\[3\] === 'state' && method === 'POST'/);

  /*
   * ...and a thing at the repair shop cannot be handed to somebody.
   * `allocationProblem` exists to answer exactly that and nothing used it.
   * Disabled with the reason on it, not hidden: "no" without a reason sends
   * people hunting.
   */
  assert.match(a, /disabled=\{Boolean\(allocationProblem\(asset\)\)\}/);
  assert.match(a, /title=\{allocationProblem\(asset\) \|\| undefined\}/);
});

test('the dashboard filter survives the click into the register', () => {
  /*
   * The asset dashboard narrows by company, branch, category and financial
   * year. The register stored that in `from` and NEVER READ IT - dead state,
   * which is why nobody noticed. Driven before: with Category = Laptop the
   * card read "2 REGISTERED" and opened a list of all four assets; with
   * Financial year = 2025-26 it read 2 and opened four.
   *
   * After: "2 REGISTERED" opens exactly the two laptops, and 2025-26 opens
   * exactly the two bought in that year.
   */
  const a = src('components/people/Assets.jsx');
  assert.match(a, /import \{ matchesFilter \}/);
  assert.match(a, /if \(narrowed && !matchesFilter\(a, narrowed\)\) return false;/);
  // The status half is already a chip, so only the dropdowns are kept -
  // applying both would narrow twice. Department joined them when Dinesh
  // asked for it; choosing one and then clicking a figure must not open a
  // list that quietly ignores it.
  assert.match(
    a,
    /const \{ company_id, branch_id, category, department, year \} = from \|\| \{\};/
  );
  // ...and the register SAYS it is narrowed, with the way out. A register
  // silently showing a subset is how somebody concludes a row has gone.
  assert.match(a, /Narrowed to/);
  assert.match(a, /Show everything/);
});

test('a figure that follows the year picker says which year', () => {
  /*
   * The maintenance screen has a year picker, and it governs the costing card
   * only - the four figures above it are lifetime totals. So picking 2025 put
   * "Spent keeping them 7,000" directly above "Repairs on it 2,000" with
   * nothing on the page saying why the two disagreed.
   *
   * Driven, now: "Spent keeping them, EVER 5,500" over "Repairs IN 2025
   * 2,000 | AMC in 2025 0 | Both together in 2025 2,000", and with the
   * picker on every year those read plainly "Repairs 5,500 | AMC 0 | Costing
   * in all 5,500".
   */
  const m = src('components/people/Maintenance.jsx');
  assert.match(m, /const inYear = year && year !== 'all' \? ` in \$\{year\}` : '';/);
  assert.match(m, /Repairs\{inYear\}/);
  assert.match(m, /AMC\{inYear\}/);
  assert.match(m, /Spent keeping them, ever/);
  // Not "Costing in all in 2025".
  assert.ok(!/Costing in all\{inYear\}/.test(m), 'that label reads "Costing in all in 2025"');
});

test('every person on the roll call lands in a figure somebody can see', () => {
  /*
   * The roll call classifies the day into seven buckets with one if/else
   * chain, so they are exhaustive and exclusive - but only FIVE of them were
   * ever drawn. `holiday` and `sunday` were counted and shown nowhere, so on
   * a weekly off or a festival every figure on the card read 0 and the bar
   * was empty, as though the day had not happened.
   *
   * Driven in the single file, 18 people:
   *   Sun 25 Oct, everyone marked Sunday (off) -> weekly off=18, sum=18,
   *     attendance "—" (nobody was expected, so it is not known - never 100%)
   *   Sat 24 Oct, everyone marked Paid Holiday -> holiday=18, sum=18,
   *     attendance 100% (paid time off is in both halves of the fraction)
   *   and every ordinary day of that month reconciles to the headcount too.
   */
  const d = src('components/Dashboard.jsx');
  for (const label of ['Holiday', 'Weekly off', 'Not marked', 'Half day', 'On leave']) {
    assert.ok(d.includes(`label="${label}"`), `the roll call has no ${label} figure`);
  }
  // Shown only on a day that has any, so an ordinary Tuesday is not given two
  // permanent zeroes.
  assert.match(d, /roll\.holiday\.length > 0 &&/);
  assert.match(d, /roll\.sunday\.length > 0 &&/);
  // ...and the bar carries them too, or the bar and the figures disagree.
  assert.match(d, /label: 'Weekly off', value: roll\.sunday\.length/);
  assert.match(d, /label: 'Holiday', value: roll\.holiday\.length/);

  /*
   * The arithmetic is said out loud rather than hoped for: a bucket added
   * later and not drawn is exactly the fault this is here to stop.
   */
  assert.match(d, /out\.accounted =/);
  /*
   * THE HEADCOUNT IS WHO WAS ON THE STAFF THAT DAY, not the month's payroll.
   * This used to pin `out.people = rows.length`, which is exactly what listed
   * somebody who had left as absent every morning for the rest of the month.
   * The sum still holds by construction: everybody is either left out BEFORE
   * the if/else chain (and kept in `gone`, with the reason) or lands in
   * exactly one bucket.
   */
  assert.match(d, /out\.people = rows\.length - out\.gone\.length;/);
  const loop = d.slice(d.indexOf('for (const row of rows) {'), d.indexOf('if (!code) out.unmarked.push(person);'));
  assert.match(loop, /onStaffThatDay\(row,/, 'the roll call never asks whether they were on the staff that day');
  assert.match(loop, /out\.gone\.push\(/, 'somebody left out of the day is dropped without a word');

  // The day's attendance comes from the report's own function, so this figure
  // and Reports cannot disagree.
  assert.match(d, /import \{ attendancePercent \}/);
  assert.match(d, /const pct = attendancePercent\(\[\{ mark_counts: counts \}\]\);/);

  // The band at the top is not repeated inside the card.
  const card = d.slice(d.indexOf('className="card roll-call"'), d.indexOf('<SegBar'));
  assert.ok(!/label="On the payroll"/.test(card), 'the staff count is repeated inside the roll call');
  assert.ok(!/label="Needs attention"/.test(card), 'the alert count is repeated inside the roll call');
});

test('the month has a day-by-day trend, and it agrees with the day below it', () => {
  /*
   * Spec §2 asked for a daily attendance trend. One bar a day, height is that
   * day's attendance by the same `attendancePercent` everything else uses,
   * and clicking one moves the roll call to that day - which is the point of
   * a trend on a page that also shows a single day.
   *
   * Driven in the single file: 31 bars for October, tooltips carrying the
   * real counts ("3 — 15 in, 2 absent, 1 on leave, 0 half, 0 off · 89%"),
   * clicking bar 10 put the roll call on Sat 10 October and marked that bar.
   */
  const d = src('components/Dashboard.jsx');
  assert.match(d, /function DayTrend/);
  assert.match(d, /onClick=\{\(\) => onDay\(d\.day\)\}/);

  /*
   * It classifies EXACTLY as the roll call does, final else included -
   * anything not recognised counts as present. Listing the known codes
   * instead made the two disagree on a day carrying a mark from an imported
   * sheet: the trend read "2 in" where the roll call under it read 18.
   */
  assert.match(d, /present: marked - absent - leave - halfDay - off,/);

  // A day nobody has marked draws a GAP, not a zero bar: zero reads as
  // "nobody came in", which is a different and much more alarming thing.
  assert.match(d, /d\.marked === 0 \?/);
  assert.match(d, /className="trend-gap"/);
  assert.match(css, /\.trend-gap \{/);
});

test('attendance is broken down by department as well as by company', () => {
  /*
   * Spec §2. `department` is already on the payroll row - the query joins it
   * and the offline store merges it - so this is a group-by, not a second
   * source of truth.
   *
   * Driven offline after setting six people: Not set 12 (97%), Accounts 3
   * (95%), Sales 2 (89%), Operations 1 (92%).
   */
  const d = src('components/Dashboard.jsx');
  assert.match(d, /const departments = useMemo/);
  assert.match(d, /By department/);
  // Anybody with none is NAMED, not dropped: a department nobody filled in is
  // a thing to fix, not a thing to hide.
  assert.match(d, /\|\| 'Not set';/);
  // ...and the card only appears when there is more than one, because a
  // single "Not set" bar says nothing anybody can act on.
  assert.match(d, /departments\.length > 1 &&/);
  // The same percentage rule as everywhere else on the page.
  assert.match(d, /rate: presentRate\(d\.rows\)/);
});

test('the attendance register carries what §3 asks of it', () => {
  /*
   * Driven in the single file, 18 people:
   *   headers  NAME | STATUS | WHAT | IN | OUT | HOURS | WHY | ALLOWED? |
   *            DEPARTMENT | COMPANY | (view)
   *   a row    "Himanshu Rana / E106 | Absent | Absent | — | — | — | Family
   *            function | yes no — | — | SCALE VISORY | view"
   *   search   "nidhi" -> 1 of 18, with a clear
   *   sort     Name ▲ -> Ankita first, ▼ -> Vishal first, third click back to
   *            the page's own order with Himanshu (the absence) first
   *   export   attendance-2026-10-31.csv, 18 rows, BOM, "Not decided" and
   *            "Not checked" written as words
   *   view     opens that person's record
   */
  const d = src('components/Dashboard.jsx');

  // The employee code rides under the name rather than taking a column of its
  // own; department, hours and the mark get columns.
  assert.match(d, /\{p\.employee_code\}/);
  assert.match(d, /by="department"/);
  assert.match(d, /by="hours"/);
  assert.match(d, /className=\{`mark-pill code-\$\{p\.code\}`\}/);

  /*
   * A day nobody clocked shows a dash, never 0h - "not known" is not "stayed
   * for none of it" - and the export leaves that cell blank for the same
   * reason.
   */
  assert.match(d, /p\.workedMinutes === null \? \(/);
  assert.match(d, /p\.workedMinutes === null \? '' : formatDuration/);

  // Search, sort and export.
  assert.match(d, /className="roll-tools"/);
  assert.match(d, /function Th\(\{ by, sort, setSort/);
  assert.match(d, /function exportRegister/);
  /*
   * Three sort states, not two: the default order is "how much has to be done
   * about this person", which is the order a morning list is read in. Sorting
   * by name buries the one absence among seventy-eight, and without a way
   * back somebody is stuck there.
   */
  assert.match(d, /if \(sort\.dir === 1\) return \{ by, dir: -1 \};\s*\n\s*return \{ by: '', dir: 1 \};/);
  // The file is what is on screen - the chip, the search and the sort already
  // applied - because an export that differs from the table is worse than none.
  assert.match(d, /exportRegister\(listed, period, shownDay\)/);
  assert.match(d, /'\\ufeff' \+ lines\.join/);
  // Three states written as words, never a bare No for a day nobody looked at.
  assert.match(d, /'Yes' : p\.approved === false \? 'No' : 'Not decided'/);
  assert.match(d, /'Proper' : p\.uniform === false \? 'Not proper' : 'Not checked'/);

  /*
   * "View" opens that person's record. The morning list is where somebody
   * notices a problem; making them go to Employees and find the name again
   * among eighty is how the noticing stops happening.
   */
  assert.match(d, /onGo\('employees', p\.id\)/);
  /*
   * And App has to act on that second argument. It now carries two kinds of
   * thing - an employee id to open, or the name of something on the
   * destination tab to scroll to (the importers) - so the rule is checked,
   * not the line: a NUMBER still opens the record.
   */
  assert.match(src('App.jsx'), /typeof what === 'number'\) setOpenEmployee\(what\)/);
  assert.match(src('App.jsx'), /typeof what === 'string'\) setFocusOn\(what\)/);
  // ...and Employees clears it, so coming back later does not reopen a drawer
  // nobody asked for.
  assert.match(src('components/Employees.jsx'), /onOpened\?\.\(\);/);
});

test('Pending Actions keeps the lines that were being thrown away', () => {
  /*
   * The digest tags each line with a kind, and the dashboard kept ONLY
   * `kind === 'queue'`. Everything tagged `dates` was computed, sent to this
   * page, and dropped on the floor: probation finished and nobody has
   * confirmed it, a document already expired, an appraisal past its date -
   * four of the eight things §4 asks this section for.
   *
   * It now keeps everything except `payroll`, which the alerts list below
   * already says - two cards repeating each other is how a dashboard stops
   * being read.
   */
  const d = src('components/Dashboard.jsx');
  assert.match(d, /item\.kind !== 'payroll'/);
  assert.ok(!/item\.kind === 'queue'/.test(d), 'the dates lines are being dropped again');
  // ...and those lines really are tagged that way.
  const dg = fs.readFileSync(path.join(here, '../../shared/digest.js'), 'utf8');
  assert.match(dg, /probation'\)\} finished and not confirmed/);
  assert.match(dg, /document'\)\} already expired/);

  /*
   * Two more the dashboard can work out for itself. Driven: clearing one
   * out-time on 31 October put "1 clocked in on 31 October and never clocked
   * out — Daksh Trivedi" on the list.
   */
  assert.match(d, /key: 'clockout'/);
  assert.match(d, /if \(parseTime\(times\.out_time\) === null\) out\.noClockOut\.push\(person\);/);
  /*
   * The uniform line counts the NOT-LOOKED-AT, not the offenders. Nobody
   * looked is not "they turned up wrong" - that is the whole reason the
   * column is three-state.
   */
  assert.match(d, /roll\.uniformChecked < roll\.atWork\.length/);
  assert.match(d, /have not been checked for uniform/);

  /*
   * Both belong to `alerts`, not to `filings`. The first attempt put them in
   * the filing list by mistake: the PF/ESI/PT card would have carried two
   * attendance lines, and the page crashed outright with "Cannot access
   * 'naming' before initialization" because that array is built before
   * `naming` exists. Reproduced 3/3 and fixed, so this pins the boundary.
   */
  const filings = d.slice(d.indexOf('const filings = useMemo'), d.indexOf('const alerts = ['));
  assert.ok(!/noClockOut|uniformChecked/.test(filings), 'they are back in the filing list');
  assert.match(filings, /\{ label: 'ESI'[^\n]*\n\s*\{ label: 'Professional tax'/);
});

test('the dashboard says what it is counting, and says it shortly', () => {
  /*
   * §5 asked for the explanatory paragraphs to go and §6 for employee-days to
   * be labelled. Four paragraphs of 90-317 characters became one line each,
   * with what they said moved onto the hover - nothing lost, nothing read
   * every morning by somebody who already knows it.
   *
   * The facts that stayed ON the page are the ones a reader cannot infer:
   * that Why and Allowed? are stored on the DAY (so typing there is not a
   * note to self), that neither moves a rupee, and the actual start/end/grace
   * the page is judging against.
   */
  const d = src('components/Dashboard.jsx');
  assert.match(d, /are saved on the day itself and\s*\n\s*change nobody's pay\./);
  assert.ok(
    !/live on the day itself, not on\s*\n\s*this screen/.test(d),
    'the six-line explanation is back'
  );

  /*
   * "23 days absent" is 23 employee-days - one person absent for 23 days, or
   * 23 people absent once - and the page has to say which it is counting.
   */
  assert.match(d, /employee-days absent this month/);

  /*
   * And the "need looking at" denominator is `roll.accounted`, not five
   * buckets added by hand. The hand-written sum left out holiday and weekly
   * off, so on a Sunday it read "0 of 0 need looking at" with eighteen people
   * on the card directly above it.
   */
  assert.match(d, /\$\{needsLooking\.length\} of \$\{roll\.accounted\} need looking at\./);
});

test('the dashboard wears the corporate look and nothing else does', () => {
  /*
   * Dinesh sent a mock-up and asked for it by picture: a navy rail, tinted
   * KPI tiles, cards with a navy head, a line chart, a donut, quick stats and
   * pending actions. It is a deliberate change of register - this page is
   * read for ten seconds at the start of a day, not for an hour - so it is
   * SCOPED to `.dash`, and the other eleven tabs keep the quiet hairline
   * sheet they were built for.
   */
  assert.match(src('App.jsx'), /tab === 'dashboard' \? 'dash' : undefined/);
  assert.match(css, /\.dash \.kpi\.t1 \{/);
  assert.match(css, /\.dash \.pcard-head \{/);

  /*
   * `pcard`, NOT `panel`. `.panel` was already the slide-in drawer, which
   * carries `height: 100%` and a 4rem bottom padding - the three cards
   * silently inherited both, came out the height of the tallest with half of
   * each empty, and `align-self: start` could not fix it because nothing was
   * stretching them. Measured in the browser, not guessed.
   */
  const d = src('components/Dashboard.jsx');
  assert.ok(!/className="panel"/.test(d), 'the dashboard cards are back on the drawer class');
  assert.match(d, /className="pcard"/);

  /*
   * Both charts are inline SVG - no charting library, because the whole of
   * what they need is a polyline and some arcs and the single file has to
   * stay small enough to send on WhatsApp.
   */
  assert.match(d, /function LineChart/);
  assert.match(d, /function Donut/);
  /*
   * The line starts at a FLOOR, not at zero: real attendance sits between 85
   * and 100 and a 0-100 axis draws a flat line across the top that says
   * nothing. The floor is labelled, so a half-height point is not read as
   * 50%. And a day with nothing marked is a GAP in the line, never a zero.
   */
  assert.match(d, /const lo = Math\.max\(0, Math\.floor/);
  assert.match(d, /if \(p\.value === null\) \{/);
  /*
   * The donut's middle is the OVERALL rate, not the average of the slices -
   * four companies of different sizes do not average. Slices are sized by
   * headcount and each is labelled with its own rate.
   */
  assert.match(d, /weight: c\.totals\.count,/);

  // Three readings of ONE figure, never three figures.
  assert.match(d, /trendBy === 'monthly'/);
  assert.match(d, /trendBy === 'company'/);

  /*
   * The register pages, and the page resets whenever what is listed changes -
   * narrowing to one company while on page 4 would otherwise show an empty
   * table, which reads as "nobody matched".
   */
  /* Fifteen since the rows were halved in height: a page of ten used a third
     of the screen and sent somebody through four pages for thirty-three
     people. Rewritten from `PER_PAGE = 10` rather than loosened. */
  assert.match(d, /const PER_PAGE = 15;/);
  assert.match(d, /\}, \[bucket, find, sort, regCompany, regDept, shownDay\]\);/);
  assert.match(d, /All companies<\/option>/);
  assert.match(d, /All departments<\/option>/);
});

test('the logo is imported, not linked, so the single file stays offline', () => {
  const app = src('App.jsx');
  const file = path.join(here, '../../frontend/src/assets/booknfly.png');

  assert.ok(fs.existsSync(file), 'the logo file is missing from the repo');

  /*
   * The whole point of the import.
   *
   * vite inlines an IMPORTED asset as a data URI in the single-file build
   * (assetsInlineLimit is unlimited there) and serves it as a hashed file
   * otherwise. Written as a path instead - src="/assets/booknfly.png" - the
   * served build still works, so it looks fine, while the standalone file
   * shows a broken image AND reaches out to the network from a file:// page.
   * That file is handed out on WhatsApp precisely because it needs nothing.
   *
   * Driven to confirm: the built single file makes zero requests that are not
   * file:// or data:, and .side-logo loads from a data: URI.
   */
  assert.match(app, /import logoUrl from '\.\/assets\/booknfly\.png';/);
  assert.match(app, /<img className="side-logo" src=\{logoUrl\}/);
  assert.ok(
    !/src="[^"]*booknfly/i.test(app),
    'the logo is referenced by path somewhere, which breaks the offline file',
  );

  // Small enough that inlining it does not bloat the file people are sent.
  // 11 KB becomes ~15 KB of base64 in a 1.9 MB file.
  const kb = fs.statSync(file).size / 1024;
  assert.ok(kb < 40, `the logo is ${Math.round(kb)} KB - too big to inline comfortably`);

  /*
   * A dark-navy wordmark on a navy rail is an invisible wordmark. The white
   * plate is what makes it readable, so it is not decoration.
   */
  assert.match(app, /className="side-plate"/);
  assert.match(css, /\.side-plate \{[^}]*background: #fff;/s);
});

test('the importers have a way in from where somebody is actually standing', () => {
  const attendance = src('components/Attendance.jsx');
  const reports = src('components/Reports.jsx');
  const dashboard = src('components/Dashboard.jsx');

  /*
   * Fourth time this has come up - the hiring vacancy form, the People tab,
   * the asset invoice, and now the importers. Dinesh asked for an "excel
   * import ka option" that had been built for months, because the only way
   * to it was the Reports tab, then a closed fold called Tools, then a
   * scroll. A feature reachable only from somewhere nobody is standing is a
   * feature that does not exist.
   *
   * Driven: Attendance -> Import from Excel lands on Reports with the fold
   * open at the top of the viewport and all three importers on screen.
   */
  assert.match(attendance, /Import from Excel/);
  assert.match(attendance, /onGo\('reports', 'import'\)/);

  // The dashboard's empty-month button aims at the importers, not merely at
  // the tab they are a third of the way down.
  assert.match(dashboard, /onGo\('reports', 'import'\)/);

  // And Reports has to act on it: open the fold AND scroll to it. Opening a
  // fold below the fold is not arriving.
  assert.match(reports, /focus !== 'import'/);
  assert.match(reports, /setToolsOpen\(true\)/);
  assert.match(reports, /scrollIntoView/);
  // Handed back, so returning to the tab later does not re-open it.
  assert.match(reports, /onFocused\?\.\(\)/);
});

test('a file dialog never hides the file somebody is holding', () => {
  /*
   * Dinesh: "CANT SHOW EXCEL", with his BasicWorkDurationReport.xls sitting
   * in the folder the dialog showed as empty.
   *
   * He had opened "Import a salary sheet", whose accept was ".xlsx,.xlsm" -
   * so Windows filtered his file out of its own folder. The conclusion
   * anybody draws from an empty folder is that the app cannot read Excel,
   * not that they are at the wrong one of three identical Choose File boxes.
   *
   * So every Excel picker lists .xls even where the importer cannot read
   * one, and the server answers with a sentence saying which panel can. An
   * explained file beats an invisible file.
   */
  for (const file of ['components/PunchImport.jsx', 'components/Reports.jsx', 'components/MonthlyStatusImport.jsx']) {
    const text = src(file);
    const accepts = text.match(/accept="[^"]*xls[^"]*"/g) || [];
    assert.ok(accepts.length, `${file} has no Excel picker`);
    for (const a of accepts) {
      assert.ok(/\.xls[",]/.test(a), `${file}: ${a} hides a plain .xls`);
    }
  }

  // And the two that genuinely cannot read one say so rather than failing
  // with ExcelJS complaining about a zip file.
  const routes = fs.readFileSync(path.join(here, '../src/routes/reports.js'), 'utf8');
  assert.match(routes, /const legacyXls =/);
  assert.match(routes, /isLegacyXls\(buffer\)/);
  assert.match(routes, /Monthly status from the attendance machine" above/);
  assert.match(routes, /Save As - Excel Workbook/);

  /*
   * Three Choose File boxes in a row look identical, so each says which file
   * it wants by name.
   */
  assert.match(src('components/MonthlyStatusImport.jsx'), /BasicWorkDurationReport/);
  assert.match(src('components/MonthlyStatusImport.jsx'), /MonthlyStatus_BasicReport/);
  assert.match(src('components/PunchImport.jsx'), /The punch LOG/);
});

test("the office's usual timings add up to the day, and say so", () => {
  const defaults = src('standardTimes.js');
  const tab = src('components/TimeSheet.jsx');

  /*
   * The shipped default was 09:30-18:30 LESS a 45-minute lunch = 8h 15m,
   * against a nine-hour day. So one click on "Fill the usual timings" docked
   * every person 45 minutes for a full day they had worked - about 83 rupees
   * each on a 26,000 salary, and at 114 people on 26 days roughly two and a
   * half lakh a month, out of the app's own defaults.
   *
   * Measured: 495 minutes worked against 540 expected, charged -45. Driven
   * before and after on eight people: 8 short-hour days and 360 minutes
   * became 0, and the month's net went up 855 rupees.
   */
  /*
   * Dinesh's rule, asked and answered: "time sabka flexible, 9 hrs complete
   * hone chahiye" and "9 hrs including lunch". So 09:30-18:30 with the lunch
   * columns BLANK - the half hour sits inside the nine and is not taken off.
   * Blank is deliberate; typing the lunch back in docks every day by 30m.
   */
  assert.match(defaults, /lunch_out: '',/);
  assert.match(defaults, /lunch_in: '',/);
  assert.match(defaults, /in_time: '09:30'/);
  assert.match(defaults, /out_time: '18:30'/);
  assert.match(defaults, /9 hrs including lunch/);

  /*
   * And the screen ADDS THEM UP, because the button writes one figure onto
   * everybody and nothing on the page had ever shown the sum. A mismatch is
   * stated before the button, not discovered on the payslip.
   */
  /*
   * ...ON THE MONTH'S OWN LUNCH SETTING.
   *
   * This assertion used to pin the call WITHOUT `deductLunch`, which is
   * exactly what was wrong: `timesToDay` and `minutesForMark` both default to
   * deducting, so on a month with "Lunch is inside the day" ticked the Time
   * tab read a nine-hour day as 8h 20m and -40m — and SAVED it, because the
   * tab sends `minutes` and a caller that names minutes beats the server's
   * own figure. calc.js, db.js and localStore.js all read `period.lunch_paid`
   * already; this screen was the one that did not, and it is the one people
   * type into. Rewritten to state that, not patched to pass.
   */
  /*
   * REWRITTEN again at v2.8.0, not patched: the same call now also carries
   * the month's own daily grace, and pinning the exact one-line spelling
   * broke on nothing but a line wrap. The RULE is what matters - the usual
   * day is judged on the month's lunch setting and the month's grace - so
   * that is what is asserted.
   */
  const usualCall = tab.slice(tab.indexOf('const usual = timesToDay(standard'));
  const usualArgs = usualCall.slice(0, usualCall.indexOf('});') + 1);
  assert.match(usualArgs, /hoursPerDay: period\.hours_per_day/);
  assert.match(usualArgs, /deductLunch/);
  assert.match(usualArgs, /graceMinutes: grace/);
  assert.match(tab, /const deductLunch = !period\.lunch_paid;/);
  assert.match(tab, /const grace = dayGrace\(period\);/);
  /*
   * And NOTHING on this screen may judge a day without it.
   *
   * Scanned with balanced brackets rather than a regex: the first attempt was
   * /\([^)]*\{[^}]*\}/, which stops at the first ')' and so cut
   * `hoursOf(row || {})` in half and failed on a call that was perfectly
   * correct. A naive match here would have had me "fixing" working code.
   */
  for (const name of ['timesToDay', 'minutesForMark', 'monthTotals']) {
    let at = 0;
    for (;;) {
      const start = tab.indexOf(`${name}(`, at);
      if (start < 0) break;
      let depth = 0;
      let end = start + name.length;
      for (; end < tab.length; end++) {
        if (tab[end] === '(') depth++;
        else if (tab[end] === ')' && --depth === 0) break;
      }
      const call = tab.slice(start, end + 1);
      at = end + 1;
      assert.match(
        call,
        /deductLunch/,
        `this call decides hours without the month's lunch setting:\n${call}`
      );
    }
  }
  assert.match(tab, /SHORT of the/);
  assert.match(tab, /every day filled this way is docked/);
  assert.match(tab, /OVER the/);
  /*
   * The redesign moved this sentence out of the toolbar it used to wrap
   * through - it was pushing "change" onto a row of its own - and into one
   * line under the settings strip. It is still MARKED when the timings fall
   * short of the paid day, which is the whole point of it, and the sum is
   * still beside the timings themselves rather than only in the sentence.
   *
   * REWRITTEN at v2.12.0, not patched. Dinesh: *"ye part bahut space kha
   * raha he"*. On an agreeable month the sentence only repeated the strip
   * directly above it, so the paragraph is no longer rendered at all - which
   * means the `usual.minutes < 0 ? 'warn-text' : undefined` conditional it
   * used to carry is gone, because inside the branch that now draws it the
   * answer is always `warn-text`. The RULE is what is asserted: the
   * paragraph appears only when there is something to say, and the mismatch
   * is marked when it does.
   */
  assert.match(tab, /\{\(ownShifts > 0 \|\| usual\.minutes !== 0 \|\| lunchEffect\.days > 0\) && \(/);
  assert.match(tab, /\{usual\.minutes !== 0 \? \(/);
  assert.match(tab, /<span className="warn-text">/);
  assert.match(tab, /className="time-notes muted small"/);
  // The read-out beside the usual day, which carries the same warning.
  assert.match(tab, /ts-sum\$\{usual\.minutes < 0 \? ' short'/);

  /*
   * And when they disagree it is FIXABLE IN ONE CLICK, both ways, with the
   * one that moves money saying how much. Driven: setting the finish to
   * 17:30 produced "8h 00m - 1h 00m SHORT of the 9h 00m day" and a panel
   * pricing it at 29,624 a month across eight people.
   */
  assert.match(tab, /do not agree/);
  assert.match(tab, /Pay the day as \{formatDuration\(usual\.worked\)\}/);
  assert.match(tab, /onPatchPeriod\(\{ hours_per_day: h \}\)/);
  assert.match(tab, /Finish at \{formatTime/);
  // The money one asks first - hours_per_day is the divisor every minute rate
  // is worked out from.
  assert.match(tab, /window\.confirm\(\s*\n?\s*`Pay the month on a/);

  /*
   * gapCost reads `lines`, so it has to be declared AFTER it. Putting the
   * block above `lines` crashed the whole tab with "Cannot access 'L' before
   * initialization" - the toolbar rendered and everything below it vanished,
   * which is the same temporal-dead-zone trap the dashboard hit.
   */
  assert.ok(
    tab.indexOf('const gapCost') > tab.indexOf('const lines ='),
    'gapCost is declared before `lines` and will crash the tab',
  );
});

test('the build stamp carries the time, not just the date', () => {
  /*
   * Three updates went out on one afternoon and every one of them read
   * "14 Nov 2026" in the rail, so there was no way to tell from the screen
   * which was running - "vesruon nahi dikh rahahe".
   *
   * The build stamp IS the version here: no semver, no release notes, just
   * the moment the file was built. A date alone stops being a version the
   * moment two builds share a day.
   *
   * Measured in the rail: 194px inside a 224px sidebar, not clipped.
   */
  const app = src('App.jsx');
  assert.match(app, /hour: '2-digit'/);
  assert.match(app, /minute: '2-digit'/);
  assert.match(app, /toLocaleString\('en-IN'/);
  assert.ok(
    !/toLocaleDateString\('en-IN'[\s\S]{0,200}?__BUILT__/.test(app),
    'the stamp is back to a date with no time on it',
  );
  // Rendered in the VIEWER's timezone, so a build made at 08:47 UTC reads as
  // 2:17 pm on a machine in India - which is when it arrived.
  assert.match(app, /__BUILT__/);
});

test('every setting is settable in Settings, and the rest says why not', () => {
  /*
   * Dinesh: "sare configration manlau set kar sake wese option dena setting
   * me". Most of it already was. The one that was not: the usual lunch
   * lived in localStorage only, so the office's usual day was whatever each
   * PC happened to remember - two people filling the same month on two
   * machines worked to two different days, and neither could see or change
   * it in Settings.
   */
  const settings = src('components/admin/Settings.jsx');
  for (const field of [
    'hours_per_day',
    'lunch_paid',
    'shift_in',
    'shift_out',
    'shift_lunch_out',
    'shift_lunch_in',
    'pt_threshold',
    'pt_amount',
    'late_policy',
    'late_concession_minutes',
    'late_grace_minutes',
  ]) {
    assert.match(settings, new RegExp(field), `${field} cannot be set in Settings`);
  }

  // The usual day states what it comes to against the day the month pays on,
  // the same arithmetic the Time tab shows, so the two cannot disagree.
  assert.match(settings, /timesToDay\(/);
  assert.match(settings, /deductLunch: !period\.lunch_paid/);
  assert.match(settings, /SHORT of the/);

  // Added when a second hours rule and then a third arrived: the month may
  // now fall short of its total by this much.
  assert.match(settings, /monthly_hours_grace/);

  /*
   * TWO LISTS, AND NOTHING ON BOTH.
   *
   * "What is deliberately not a setting" is for things that genuinely cannot
   * be changed - 26 working days, the half-day line, Sunday pay. The weekly
   * off and the leave quotas were on it too, which was simply wrong: they
   * ARE settings, they just belong to a company or a person. They are in
   * "Set elsewhere" now, with a button each, because naming something
   * somebody cannot reach is how a feature comes to read as missing.
   */
  assert.match(settings, /What is deliberately not a setting/);
  for (const why of ['26 working days', 'half-day line', 'Sunday pay']) {
    assert.ok(settings.includes(why), `${why} is not explained`);
  }
  assert.match(settings, /Set elsewhere/);
  assert.match(settings, /onGo\?\.\(tab\)/, 'the list names tabs but cannot open them');
  for (const elsewhere of ['Leave quotas', 'The day off', 'Leave bonus', 'Festivals']) {
    assert.ok(settings.includes(elsewhere), `${elsewhere} has no way in from Settings`);
  }
  /*
   * COMMENTS STRIPPED FIRST. The comment left in place of the removed
   * bullets explains that weekly off and leave quotas are NOT on this list -
   * and matched the assertion that they are not. Third time for that shape
   * (`readable()`, the candidate list, this): an explanation must never pass
   * for the thing it warns about.
   */
  const noComments = settings.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const notASetting = noComments.slice(noComments.indexOf('What is deliberately not a setting'));
  for (const movable of ['Weekly off', 'leave quotas and festivals']) {
    assert.ok(
      !notASetting.includes(movable),
      `${movable} is a setting - it must not be listed as one that is not`
    );
  }

  // The month wins over the browser for the lunch too, not just the shift.
  const std = src('standardTimes.js');
  assert.match(std, /period\?\.shift_lunch_out/);
  assert.match(std, /period\?\.shift_lunch_in/);
  assert.match(src('components/TimeSheet.jsx'), /useState\(\(\) => shiftOfMonth\(period\)\)/);
});

test('a tick in a form grid is a tick, not a 357-pixel box', () => {
  /*
   * `.form-grid label > input { width: 100%; min-width: 0 }` was written for
   * date boxes, which Chromium gives an intrinsic 209px. Applied to a
   * checkbox inside a flex label it collapsed the thing to ZERO PIXELS wide:
   * the caption and the hint rendered perfectly and the box simply was not
   * there. Excluding it then left it stretching the full column, because a
   * flex basis of auto reads the width property.
   *
   * Measured in a real browser: 0px before, 13px after.
   */
  assert.match(css, /\.form-grid label > input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\)/);
  assert.match(css, /\.form-grid label\.inline > input\[type='checkbox'\][^}]*width: auto/);
  assert.match(css, /\.form-grid label\.inline \{[^}]*flex-direction: row/);
});

/*
 * The sign-in screen. It was redesigned into a brand panel and a card, which
 * is the kind of change that can quietly take a way in with it.
 */

test('the sign-in screen talks to the same three auth routes and no others', () => {
  const login = src('components/Login.jsx');

  // The three the server exposes without a session, and nothing else. A
  // redesign that invented `/api/auth/forgot` or `/api/auth/remember` would
  // be shipping a door the backend does not have.
  const called = [...login.matchAll(/['"`](\/api\/[a-z0-9/_-]+)['"`]/gi)].map((m) => m[1]);
  assert.deepEqual([...new Set(called)].sort(), ['/api/auth/login', '/api/auth/setup', '/api/auth/state']);

  // All three ways in survive. The dashboard-password one is how an
  // installation with APP_PASSWORD and no logins yet is reached at all.
  for (const mode of ["'setup'", "'signin'", "'key'"]) assert.ok(login.includes(mode), `mode ${mode} is gone`);
  assert.match(login, /authorization: `Bearer \$\{form\.password\}`/);

  // One answer for a bad name and a bad password is a property of the server.
  // The screen may tidy the wording - it must not read the answer and decide
  // which of the two it was. So: one place the server's refusal is raised,
  // and one place it is shown, straight through `readable`.
  assert.equal([...login.matchAll(/body\?\.error/g)].length, 1);
  assert.match(login, /<span>\{readable\(problem\)\}<\/span>/);
  assert.equal([...login.matchAll(/\{readable\(/g)].length, 1);
});

test('remember me stores the username, never a password', () => {
  const login = src('components/Login.jsx');

  // Exactly one thing is written, and it is the username. `form.password`
  // must never reach a storage call - a login screen that keeps the password
  // in localStorage is the whole point of the box being a lie.
  assert.match(login, /localStorage\.setItem\(REMEMBER_KEY, username\)/);
  const writes = [...login.matchAll(/localStorage\.setItem\(([^)]*)\)/g)].map((m) => m[1]);
  assert.equal(writes.length, 1);
  for (const w of writes) assert.ok(!/password/i.test(w), `a password is being stored: ${w}`);

  // Reading and writing it are both wrapped: a private window throws on even
  // touching localStorage, and a convenience must not take the screen down.
  assert.match(login, /try \{\s*return localStorage\.getItem\(REMEMBER_KEY\)/);
});

test('forgot password says what really happens instead of inventing a flow', () => {
  const login = src('components/Login.jsx');

  // There is no self-service reset in this app. The link has to say so and
  // point at the admin, not open an email box that goes nowhere.
  assert.match(login, /Forgot password\?/);
  assert.match(login, /no self-service reset/i);
  assert.match(login, /Admin . Logins/);
  assert.ok(!/type="email"|sendReset|resetLink/i.test(login));
});

test('the sign-in screen leaves .login alone, because ChangePassword uses it', () => {
  const login = src('components/Login.jsx');
  const change = src('components/ChangePassword.jsx');

  // ChangePassword stands between a reset password and the app, and renders
  // `login` + `login-card`. Restyling those into a split screen would have
  // rebuilt a screen nobody was looking at.
  assert.match(change, /className="card login-card"/);
  assert.ok(!/className="login-card"|className="card login-card"/.test(login));
  assert.match(login, /className="signin-card"/);

  // And the old rules are still there for it to land on.
  assert.match(css, /^\.login \{/m);
  assert.match(css, /^\.login-card \{/m);
});

test('the remember tick is handed back to the browser', () => {
  // `input, select` gives every input a border, a background and padding,
  // which on a checkbox replaces the native tick with an empty box. A
  // checkbox has been lost to exactly that once already; measured at 15px.
  const rule = css.match(/\.signin-remember input\[type='checkbox'\] \{[^}]*\}/);
  assert.ok(rule, 'the checkbox has no rule of its own');
  for (const undo of [/border: 0/, /background: none/, /padding: 0/, /width: 0\.95rem/]) {
    assert.match(rule[0], undo);
  }
});

test('nobody is asked about the uniform of somebody working from home', () => {
  const dash = src('components/Dashboard.jsx');

  /*
   * WORKED_MARKS is the uniform check's list AND its denominator - the roll
   * call reads "3 of 40 at work not looked at" off it, and the alert clears
   * only when the two match. A person working from home is at work and is
   * nowhere anybody can see what they are wearing, so leaving WH in would
   * hold the morning's walk open for ever on a name nobody can ever tick.
   */
  const set = dash.match(/const WORKED_MARKS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(set, 'WORKED_MARKS is gone');
  assert.ok(!/'WH'/.test(set[1]), 'somebody at home is being asked about their uniform');
  for (const code of ["'P'", "'HF'", "'SP'", "'HP'"]) {
    assert.ok(set[1].includes(code), `${code} fell out of the uniform check`);
  }

  // It still counts as a day present, which is a different question.
  assert.match(dash, /code === 'WH'/);
});

test('working from home can be asked for, and only ever marks WH', () => {
  const requests = fs.readFileSync(
    path.join(here, '../../shared/attendanceRequests.js'),
    'utf8'
  );

  // The mark is a property of the KIND. Offering a picker would only be a
  // chance to choose the wrong one, and a stale form could post anything.
  assert.match(requests, /key: 'remote'/);
  assert.match(requests, /writes: 'WH'/);
  assert.match(requests, /const fixed = markOf\(request\.kind\)/);

  // A week at home is one request and one decision.
  assert.match(requests, /key: 'remote',[\s\S]{0,200}span: true/);

  // Both places the staff can raise one.
  assert.match(src('components/MyPage.jsx'), /kind: 'remote'/);
  assert.match(src('components/PunchPage.jsx'), /REQUEST_KINDS\.map/);
});

test('the line saying staff are waiting opens the queue that can decide', () => {
  const digest = fs.readFileSync(path.join(here, '../../shared/digest.js'), 'utf8');

  /*
   * Every digest line used to send the dashboard to People. That is right for
   * a claim, a ticket or a job - and wrong for an attendance request, because
   * the approvals queue lives in Reports. So the one line telling the office
   * somebody had applied for leave opened a tab that does not hold it.
   */
  assert.match(digest, /const add = \(line, n = 1, kind = 'queue', go = 'people', focus = null\)/);
  assert.match(digest, /attendance request[\s\S]{0,320}'reports',\s*\n\s*'approvals'/);

  // The dashboard follows what the line says instead of always saying People.
  const dash = src('components/Dashboard.jsx');
  assert.equal([...dash.matchAll(/onGo\(item\.go \|\| 'people', item\.focus\)/g)].length, 2);
  assert.ok(!/queues\.map\(\(item\) => \(\s*<li/.test(dash), 'the waiting lines are not clickable');

  // ...and Reports knows what to do when it is handed that focus.
  const reports = src('components/Reports.jsx');
  assert.match(reports, /if \(focus !== 'approvals'\) return;/);
  assert.match(reports, /setOpenId\('attendance-approvals'\)/);
});

test('the decision on a request cannot be the one thing off the edge', () => {
  // Measured at 1280px, which is an ordinary laptop: the Approve button sat
  // at 1393px, past the right edge of the scroller. Pinned right, it comes
  // back to 1156px. The name column is pinned left for the same reason.
  assert.match(css, /table\.sheet\.request-queue th\.decide,\s*\ntable\.sheet\.request-queue td\.decide \{/);
  const rule = css.match(/table\.sheet\.request-queue th\.decide,[\s\S]*?\}/)[0];
  for (const bit of [/position: sticky/, /right: 0/, /background: var\(--surface\)/]) {
    assert.match(rule, bit);
  }

  const queue = src('components/AttendanceRequests.jsx');
  assert.match(queue, /className="sheet request-queue"/);
  assert.match(queue, /className="right decide"/);
  assert.match(queue, /<th className="decide" \/>/);
});

test('the candidate list opens from the whole row, and the CV opens from the list', () => {
  const list = src('components/hiring/Candidates.jsx');

  /*
   * The name was a bare <button>, which renders as plain bold text - so the
   * one way into everything about a candidate did not look like a way in, and
   * it was reported as missing when it had been there all along. Fifth time
   * for that shape of bug (hiring's "add vacancy", People, assets, the asset
   * invoice, this).
   */
  assert.match(list, /<tr key=\{c\.id\} onClick=\{\(\) => onOpen\(c\.id\)\}/);
  assert.match(list, /className="rows-open"|hiring-table rows-open/);
  assert.match(css, /table\.rows-open tbody tr \{[^}]*cursor: pointer/);
  assert.match(css, /table\.rows-open tbody tr:hover/);
  assert.ok(!/<button onClick=\{\(\) => onOpen\(c\.id\)\}>\{c\.name\}<\/button>/.test(list));

  // The CV column is a way to GET it, not the word "yes".
  assert.match(list, /onOpenCv\(c\.id\)/);
  assert.match(list, /download/);
  // ...and clicking it must not also open the row behind it.
  assert.match(list, /e\.stopPropagation\(\);\s*\n\s*onOpenCv/);

  /*
   * No new tab, and the href is absolute. Two attempts failed first and both
   * are worth keeping out: a `window.open` after an `await` is outside the
   * click and the browser blocks it silently, and a tab left on about:blank
   * cannot resolve the relative URL the route returns. `/files/resume/:id`
   * is served with res.download anyway, so a tab would only sit there empty.
   */
  // Comments stripped first: this file EXPLAINS why window.open is wrong, and
  // a test that matched its own explanation caught itself once already.
  const hiring = src('components/hiring/Hiring.jsx')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/window\.open/.test(hiring), 'a tab is opened for a file that downloads');
  assert.match(hiring, /new URL\(link\.url, window\.location\.origin\)/);
  assert.match(hiring, /a\.download = link\.filename/);

  // It asks whether there is one; it is never told where it is.
  assert.match(list, /c\.has_cv/);
  assert.ok(!/c\.resume_path/.test(list), 'the list still reads the server filename');
});

test('a candidate can be put forward for an opening from their own record', () => {
  const panel = src('components/hiring/CandidatePanel.jsx');

  /*
   * Sixth time for this shape of bug.
   *
   * The "Put forward for" card only LISTED the openings somebody was already
   * on. From the candidate list - where anybody looking at a person is
   * actually standing - there was no way to put them forward at all; the only
   * route was Vacancies, open the opening, "On file". Dinesh asked how to
   * select somebody for an interview and the honest answer was "not from
   * where you are".
   */
  assert.match(panel, /api\.post\('\/hiring\/applications'/);
  assert.match(panel, /Put forward for an opening/);

  // The route answers { application, created } - reading it as the application
  // itself gave an undefined id and no way onto the card.
  assert.match(panel, /const \{ application, created \} = await api\.post/);

  // ...and the openings route answers { vacancies }, not { rows }. Destructuring
  // the wrong key gave an empty picker that said "no open vacancy" with three
  // of them on file.
  assert.match(panel, /\.then\(\(\{ vacancies \}\)/);

  // A CLOSED opening is never offered: putting somebody on a filled seat is
  // not what was meant.
  assert.match(panel, /filter\(\(v\) => v\.status !== 'closed'\)/);

  // Nor one they are already on - the pair is unique, so offering it again can
  // only produce an error message.
  assert.match(panel, /alreadyOn/);
});

test('the pipeline board fits its stages on an ordinary screen', () => {
  /*
   * Eight columns at `flex: 1 0 15rem` need 120rem. A 1920px screen with the
   * rail gives 1656px, so "Joined" was cut in half and "Rejected" was off the
   * screen entirely - and you cannot drag somebody into a column you cannot
   * see.
   */
  const column = css.match(/\.column \{[^}]*\}/);
  assert.ok(column, 'the board column rule is gone');
  assert.match(column[0], /flex: 1 1 /);
  assert.ok(!/flex: 1 0 15rem/.test(column[0]), 'the column still refuses to shrink');
  assert.match(css, /\.board \{[^}]*overflow-x: auto/);
});

test('"+ New vacancy" is on the tab bar only, never twice on one screen', () => {
  const hiring = src('components/hiring/Hiring.jsx');
  const vacancies = src('components/hiring/Vacancies.jsx');

  // The tab bar carries it on every screen of the tab, deliberately.
  assert.match(hiring, /\+ New vacancy/);

  /*
   * So the Vacancies screen must NOT carry its own: there were two of them a
   * few centimetres apart, in the same navy, and two buttons that do one thing
   * read as two different things. Comments are stripped first - a test that
   * matches its own explanation proves nothing.
   */
  const code = vacancies.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/\+ New vacancy/.test(code), 'Vacancies.jsx has its own New vacancy button again');

  // ...and the tab bar's button must still be able to open the form here.
  assert.match(vacancies, /if \(askNew\) setAdding\(true\)/);
});

test('the hiring tables fill their card, without one column eating the slack', () => {
  assert.match(css, /table\.hiring-table \{ width: 100%; \}/);

  /*
   * `width: 100%` on the name column was the first attempt: "Riya Pal" then
   * sat in 860px of white while Skills wrapped onto two lines beside it. Auto
   * layout shares the slack in proportion to what each column holds.
   */
  assert.ok(
    !/table\.hiring-table td\.grow[^}]*width: 100%/.test(css),
    'the name column is greedy again'
  );
  // The buttons take none of it.
  assert.match(css, /table\.hiring-table td:last-child[^}]*width: 1%/);

  // And the salary sheet keeps the width it was given on purpose.
  assert.match(css, /table\.sheet \{[^}]*width: auto/);
});

test('a reference and a date never break across two lines', () => {
  /*
   * `table.sheet.hiring-table td { white-space: normal }` lets every hiring
   * cell run on, which is right for skills and for a place with a second line
   * under it. Applied to a code it is nonsense: in a narrow window "CAN-002"
   * broke as "CAN-" / "002" and "2026-11-14" as "2026-11-" / "14", which reads
   * as corruption rather than as a narrow column.
   */
  assert.match(css, /table\.sheet\.hiring-table td\.num,[\s\S]{0,120}white-space: nowrap/);
  assert.match(css, /table\.sheet\.hiring-table td\.nowrap/);

  // The Added column is a date, so it carries the class.
  const list = src('components/hiring/Candidates.jsx');
  assert.match(list, /className="small muted nowrap">\{String\(c\.created_at/);

  // ...and the cells that are MEANT to run on still do.
  assert.match(css, /table\.sheet\.hiring-table td \{ white-space: normal/);
});

test('the two interview forms are reachable from the interviews list', () => {
  const list = src('components/hiring/Interviews.jsx');

  /*
   * Seventh time for this shape of bug, so it gets a test. Somebody about to
   * interview is looking at THIS list; a form reachable only from somewhere
   * else is a form that does not exist.
   */
  assert.match(list, /onForm\(i\.id\)/);
  assert.match(list, /onEvaluate\(i\.id\)/);

  // The button says which it is, so a round already written up is not written
  // up twice.
  assert.match(list, /form_status === 'submitted'/);
  assert.match(list, /evaluation_status === 'approved'/);
});

test('the evaluation offers only the review steps this login may take', () => {
  const panel = src('components/hiring/InterviewForms.jsx');

  // The gate is the shared one, so a greyed-out button and a server refusal
  // have the same reason behind them.
  assert.match(panel, /movesFrom\(status, abilities\)/);
  assert.match(panel, /approving is an Admin/);

  // Abilities come down from the signed-in session, not from the component.
  assert.match(src('App.jsx'), /abilities=\{me\?\.abilities \|\| \[\]\}/);
});

test('the interview sections fold with state, never an uncontrolled details', () => {
  const panel = src('components/hiring/InterviewForms.jsx');

  /*
   * The panel reloads itself after every save, and a <details> resets when
   * React re-renders around it - so an open section would shut under the
   * person's hands halfway through typing. That exact bug cost a morning on
   * the roll call's uniform fold.
   */
  const code = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/<details/.test(code), 'the interview form uses an uncontrolled details again');
  assert.match(panel, /open === section\.key/);
});

test('the rating dot is drawn, not a native control a global rule would collapse', () => {
  /*
   * `input, select` gives every input a border, a background and padding,
   * which on a radio replaces the native control with an empty box - the same
   * trap the Settings panel and the sign-in screen both hit. So the rating is
   * a plain button that paints itself.
   */
  const panel = src('components/hiring/InterviewForms.jsx');
  assert.ok(!/type="radio"/.test(panel), 'the rating is a radio again');
  assert.match(css, /\.iv-rate \.dot \{[^}]*border-radius: 50%/);
  assert.match(css, /\.iv-rate \.dot\.on \{[^}]*background: var\(--brand\)/);
});

test('the wide panel overrides the width, not just the max-width', () => {
  /*
   * .panel sets `width: min(560px, 100%)`, so a max-width alone did nothing
   * and the interview form sat in a 560px slot with its remarks column off the
   * screen. And its 4rem bottom padding pushed the sticky action bar 64px up
   * the page, where it read as a bar floating in the middle of the form.
   */
  const wide = css.match(/\.panel\.wide \{[\s\S]*?\n\}/);
  assert.ok(wide, 'the wide panel rule is gone');
  assert.match(wide[0], /width: min\(1040px, 100%\)/);
  assert.match(wide[0], /padding-bottom: 0/);
});

test('there is one print block, and it carries the interview form', () => {
  /*
   * Two @media print blocks is how a rule ends up in the one nobody is
   * reading - and it broke the asset handover's own print test, which takes
   * the last block on the page.
   */
  const print = css.slice(css.lastIndexOf('@media print'));
  assert.match(print, /\.panel\.interview-form \{[^}]*overflow: visible/);
  assert.match(print, /\.iv-actions/);
});

test('an in-house test is sent from the candidate’s own application', () => {
  const panel = src('components/hiring/ApplicationPanel.jsx');

  /*
   * Eighth time for this shape. The Tests tab is a screen about PAPERS; the
   * person deciding to test somebody is looking at that somebody. So the
   * button lives on the application.
   */
  assert.match(panel, /Send an in-house test/);
  assert.match(panel, /\/hiring\/papers\/\$\{paperId\}\/assign/);
  assert.match(panel, /Draw their paper/);

  /*
   * And the link is made absolute in the browser. The server answers an
   * absolute one only when the public address is configured; without it the
   * link came back as "/sit/TST-…", which looks fine in the box and is dead
   * the moment it is pasted into WhatsApp.
   */
  assert.match(panel, /window\.location\.origin\}\$\{sentLink\}/);
  assert.match(panel, /The public web address is not set/);
});

test('the candidate’s test page keeps no secret and no second chance', () => {
  const sit = src('components/hiring/SitTest.jsx');
  const code = sit.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  // Nothing on this page renders an answer, because nothing is sent one.
  assert.ok(!/\.correct/.test(code), 'the test page reads a correct answer');

  // Reaching zero sends what they have rather than losing it.
  assert.match(sit, /if \(left <= 0\) \{\s*submit\(true\);/);

  // A double submit is impossible even if the timer and the button fire at
  // once.
  assert.match(sit, /if \(sent\.current\) return;\s*sent\.current = true;/);

  // The token is the whole of the identity - nothing else is sent.
  assert.ok(!/candidate_id/.test(code), 'the test page sends a candidate id');
});

test('the screening report is advice and cannot stop a verdict', () => {
  const screen = src('components/hiring/Screening.jsx');

  /*
   * The whole rule, checked where it could be broken: there must be no state
   * in which the eligibility report disables the save. People are hired
   * against the criteria every day and are usually right to be.
   */
  assert.match(screen, /disabled=\{busy \|\| problems\.length\}/);
  assert.ok(!/report.*disabled|disabled.*report\.meets/.test(screen), 'the report gates the button');
  // Matched on the claim, not on where JSX happened to wrap the line - a
  // reflow of the prose is not a regression.
  assert.match(screen.replace(/\s+/g, ' '), /you can take somebody who misses every line of it/);

  // Three states, and the third is drawn differently from a miss.
  assert.match(css, /\.scr-line\.unknown \.scr-mark \{ color: var\(--muted\)/);
  assert.match(css, /\.scr-line\.no \.scr-mark \{ color: var\(--bad/);
});

test('screening is reachable from the tab AND from the application', () => {
  const hiring = src('components/hiring/Hiring.jsx');
  /*
   * The KEY, not the label. This pinned the exact words 'Screening' and
   * broke the moment the question bank folded in and the tab became
   * "Screening & tests" — which is a rename, not a feature going missing.
   * What this test is actually about is that the tab exists at all.
   */
  assert.match(hiring, /\['screening', '[^']+'\]/);

  /*
   * Dinesh asked, standing on the candidate list, how to move somebody
   * forward. So the verdict is also on the application card, which is what
   * opens from there - ninth time this codebase has learnt that a feature
   * reachable only from somewhere nobody is standing does not exist.
   */
  const panel = src('components/hiring/ApplicationPanel.jsx');
  assert.match(panel, /<ScreeningForm/);
  assert.match(panel, /<ReportLines report=\{screening\.report\}/);
});

test('there is no download button until the offer is approved', () => {
  const offer = src('components/hiring/Offer.jsx');

  /*
   * The server refuses an unapproved letter too; this is so nobody is offered
   * a button that cannot work. An unapproved letter that can be downloaded is
   * an unapproved letter that gets sent.
   */
  assert.match(offer, /status !== 'draft' \? \(/);
  assert.match(offer, /Download the letter/);
  assert.match(offer, /there is no letter until somebody has/);

  // The letter downloads as a file, no tab - the CV button learnt that the
  // hard way, through a pop-up blocker and an about:blank.
  assert.match(offer, /a\.download = ''/);
  assert.ok(!/window\.open/.test(offer), 'the letter opens a tab again');
});

test('the application panel has ONE place a salary is offered', () => {
  const panel = src('components/hiring/ApplicationPanel.jsx');
  const code = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  /*
   * There used to be an Offer card here with its own salary and joining date,
   * written straight onto the application. The offer record has its own, and
   * two numbers for one fact is how a letter and a first payslip come to
   * disagree. Approving writes the figure back to where hireApplication has
   * always read it.
   */
  assert.ok(!/offer_salary: e\.target\.value/.test(code), 'the old offer box is back');
  assert.match(panel, /<Offer\n/);
});

test('the version and the history move together', () => {
  const version = fs.readFileSync(path.join(here, '../../shared/version.js'), 'utf8');
  const named = version.match(/export const VERSION = '([^']+)'/)[1];
  const newest = version.match(/CHANGELOG = \[\s*\{\s*version: '([^']+)'/)[1];

  /*
   * Dinesh opened "What's new" and it still said 1.6.0 with four modules
   * shipped since. The version is written by hand, which means it is written
   * by somebody who can forget - so the test is that the top of the changelog
   * and the version number are the same string.
   */
  assert.equal(named, newest, 'VERSION and the newest changelog entry disagree');
});

test('“where they are” is the way into the application, not a label', () => {
  const list = src('components/hiring/Candidates.jsx');

  /*
   * Tenth time for this shape of bug, and the third time Dinesh asked this
   * exact question: "candidate ko interview tak le jaane ka raasta kahan hai".
   * He was looking at a column that said precisely where they were and could
   * not be clicked. Opening the application is where Move, Screening, the
   * offer and scheduling all live.
   */
  assert.match(list, /onOpenApplication\(c\.latest_application_id\)/);
  assert.match(list, /className="opens"/);
  // ...and it must not also open the candidate behind it.
  assert.match(list, /e\.stopPropagation\(\);\s*\n\s*onOpenApplication/);

  // The panel's own list of openings had the same bug: `link` renders as
  // plain text, so the one way in did not look like one.
  const panel = src('components/hiring/CandidatePanel.jsx');
  assert.match(panel, /className="opens" onClick=\{\(\) => onOpenApplication\(a\.id\)\}/);
});

test('the application panel reads in the order the work happens', () => {
  const panel = src('components/hiring/ApplicationPanel.jsx');
  const order = [...panel.matchAll(/<h3>([^<]+)<\/h3>|<Offer\n/g)].map((m) => m[1] || 'Offer');

  /*
   * Payroll used to be the SECOND card and Screening the fifth, which is the
   * reverse of the order anybody works a candidate in. The steps come first;
   * the things you look at afterwards come after.
   */
  const at = (name) => order.indexOf(name);
  assert.ok(at('Move') < at('Screening'), 'Move is not first');
  assert.ok(at('Screening') < at('Interviews'), 'Screening comes after Interviews');
  assert.ok(at('Interviews') < at('Offer'), 'Interviews comes after the Offer');
  assert.ok(at('Offer') < at('Payroll'), 'Payroll is above the Offer again');
  assert.ok(at('Payroll') < at('What happened'), 'the history is not last');
});

test('the age range shows its error, rather than silently refusing to save', () => {
  const form = src('components/hiring/VacancyForm.jsx');

  /*
   * The `error` prop was missing on the first attempt, so validateVacancy
   * refused to save a range of 35 to 21 and the screen said nothing at all -
   * the Publish button simply did not work. A rule that blocks without a
   * reason is worse than no rule.
   */
  assert.match(form, /error=\{bad\('age_min'\)\}/);
  assert.match(form, /error=\{bad\('age_max'\)\}/);
  assert.match(form, /data-field=\{name\}/);
});

test('the screening verdict is on the candidate row, and still needs a reason', () => {
  const screen = src('components/hiring/Screening.jsx');
  const list = src('components/hiring/Candidates.jsx');

  // Dinesh asked for these buttons "front me bhi" - on the list, without
  // opening anybody.
  assert.match(list, /<QuickVerdict/);
  assert.match(list, /c\.latest_application_id/);

  /*
   * Eligible saves on the click because it needs nothing else; the other two
   * open a reason box in the row first. The rule is not relaxed because the
   * control got smaller.
   */
  assert.match(screen, /v === 'Eligible' \? save\(v\) : setPicked\(v\)/);
  assert.match(screen, /disabled=\{busy \|\| !reason\.trim\(\)\}/);
});

test('an interview can be deleted from both places it is listed', () => {
  assert.match(src('components/hiring/Interviews.jsx'), /onClick=\{\(\) => drop\(i\.id\)\}/);
  assert.match(src('components/hiring/ApplicationPanel.jsx'), /dropInterview\(i\.id\)/);
  // Deleting is asked about first - it cannot be undone.
  assert.match(src('components/hiring/Interviews.jsx'), /window\.confirm\('Delete this interview/);
});

test('the candidate page cannot show or send a decision', () => {
  const page = src('components/hiring/CandidateInterviewForm.jsx');

  // It renders only the sections named in the allow-list.
  assert.match(page, /CANDIDATE_SECTIONS\.includes\(s\.key\)/);
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const forbidden of ['decision', 'rejection_reason', 'observations', 'recommendation']) {
    assert.ok(!new RegExp(`\\b${forbidden}\\b`).test(code), `the candidate page mentions ${forbidden}`);
  }
});

test('the particulars form has no verdict on it, and does declare', () => {
  const panel = src('components/hiring/InterviewForms.jsx');
  const code = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  /*
   * Dinesh: this form is filled in BEFORE the interview, by the candidate, so
   * a verdict and the interviewer's notes had no business on it. Both live on
   * the evaluation now.
   */
  assert.ok(!/Result and next step/.test(code), 'the decision is back on the particulars form');
  assert.ok(!/DECISIONS/.test(code), 'the form still imports the decisions');
  assert.match(panel, /\{DECLARATION\}/);

  // The candidate's own copy ticks the declaration before it will send.
  const page = src('components/hiring/CandidateInterviewForm.jsx');
  assert.match(page, /disabled=\{busy \|\| !agreed\}/);
  assert.match(page, /type="checkbox"/);
  // ...and the checkbox is handed back to the browser, or the global
  // `input, select` rule turns it into an empty box. Third time for that trap.
  assert.match(css, /\.sit-declare input\[type='checkbox'\] \{[^}]*all: revert/);
});

test('short lists are ticked, not opened', () => {
  const panel = src('components/hiring/InterviewForms.jsx');

  /*
   * Every list on this form is four options or fewer, and a dropdown for four
   * things is two taps and a hidden menu where one tap would do. Languages was
   * worse than slow: it is a LIST and was rendering as a select, so only one
   * could be chosen and it did not save as a list at all.
   */
  assert.match(panel, /field\.type === 'tags' && field\.options/);
  assert.match(panel, /field\.options\.length <= 4 \?/);
  assert.match(panel, /value=\{field\.key === 'languages' \? form\.languages/);
  // Clicking the chosen one again clears it: blank is a real answer.
  assert.match(panel, /onPick\(value === o \? '' : o\)/);
});

test('the interview paperwork prints as a document, not as the panel', () => {
  const panel = src('components/hiring/InterviewForms.jsx');
  assert.match(panel, /form\/print/);
  assert.match(panel, /evaluation\/print/);
  const code = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/window\.print\(\)/.test(code), 'it prints the panel again');
  assert.ok(!/window\.open/.test(code));
});

test('the evaluator is typed and required, never taken from the login', () => {
  const panel = src('components/hiring/InterviewForms.jsx');
  assert.match(panel, /Evaluated by \*/);
  assert.match(panel, /set\('evaluated_by', e\.target\.value\)/);

  /*
   * This office signs in as one or two people and the person in the room is
   * often neither of them, so the login name would put Dinesh's name on
   * Priya's judgement.
   */
  const evalModule = fs.readFileSync(path.join(here, '../../shared/interviewEval.js'), 'utf8');
  assert.match(evalModule, /Put the name of whoever did this interview/);
});

test('the news that a form came back is on the button that opens it', () => {
  const list = src('components/hiring/Interviews.jsx');

  /*
   * It was on the SEND button - "They filled it ✓" replaced "Send form" -
   * which hid the way to send it again and put the news where nobody would
   * act on it. The button that OPENS the form carries it now.
   *
   * Short labels, because four of these sit on one line: the dot IS the news
   * and the tooltip carries the sentence.
   */
  assert.match(list, /'Their form ●'/);
  assert.match(list, /They filled this in — open it to read what they sent/);
  assert.match(list, /i\.candidate_sent_at \? 'Sent' : 'Send'/);

  const overview = src('components/hiring/HiringOverview.jsx');
  assert.match(overview, /sent their details/);
  assert.match(overview, /go: 'interviews'/);
});

test('a panel header is a row, and nothing scrolls past above it', () => {
  /*
   * The global `header` rule sets flex-direction: column for the page's own
   * banner and it was reaching into every panel - so the Close button dropped
   * onto its own line under the title and the header stood 129px tall instead
   * of 83. FOURTH time this exact trap: the help panel's header, the Settings
   * checkbox, the sign-in checkbox, this. Anything here that styles a bare
   * element name reaches into every component on the page.
   */
  const rule = css.match(/\.panel > header \{[\s\S]*?\n\}/);
  assert.ok(rule, 'the panel header rule is gone');
  assert.match(rule[0], /flex-direction: row/);

  /*
   * And the panel has no top padding, because the header owns it. With 1rem
   * there the sticky header stuck 16px down and content scrolled past in the
   * strip above it - which Dinesh saw as a stray "99% HERE TODAY" over the
   * candidate's name.
   */
  const panel = css.match(/\.panel \{[\s\S]*?\n\}/);
  assert.match(panel[0], /padding: 0 1\.1rem 4rem/);
  assert.match(rule[0], /padding: 1rem 0 0\.6rem/);
});

test('the interview process is shown as steps, on the tab where it happens', () => {
  const steps = fs.readFileSync(path.join(here, '../../shared/hiringSteps.js'), 'utf8');
  const strip = src('components/hiring/ProcessSteps.jsx');
  const tab = src('components/hiring/Interviews.jsx');

  assert.match(tab, /<ProcessSteps onGo=\{onGo\} \/>/);

  /*
   * Every step names WHERE it is done and the click, because "screen the
   * candidate" is no use to somebody who cannot find the button - and the
   * label is also the way there.
   */
  assert.match(strip, /onGo\(s\.tab \|\| tabFor\(s\.where\)\)/);
  for (const field of ['where:', 'how:', 'note:']) {
    assert.ok(steps.includes(field), `the steps carry no ${field}`);
  }

  /*
   * The traps are on the list, set apart. Each of these cost a bug to learn,
   * and running them in with the prose is how they get skimmed past.
   */
  assert.match(steps, /advice, not a gate/);
  assert.match(steps, /moves the paperwork, never the candidate/);
  assert.match(steps, /no letter at all until somebody has approved it/);

  // Folded away with state, never an uncontrolled <details>: this tab reloads
  // itself and a details element resets when React re-renders around it.
  const code = strip.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/<details/.test(code));
  // ...and reading the preference cannot take the page down in a private
  // window, where even touching localStorage throws.
  assert.match(strip, /catch \{/);
});

test('the row actions stay on one line, and the cell stays a table cell', () => {
  /*
   * REWRITTEN. This test used to assert that the buttons WRAP - and that was
   * the wrong rule, as Dinesh pointed out the moment he saw it: four buttons
   * stacked into a column and the row grew four times as tall. The one-line
   * format was right; only the overflow was wrong.
   */
  const rule = css.match(/\.row-actions \{[^}]*\}/);
  assert.match(rule[0], /flex-wrap: nowrap/);

  /*
   * The fix is short labels plus a cell pinned to the right - and the flex on
   * a div INSIDE the cell. `display: flex` straight on a <td> takes the cell
   * out of table layout: it collapsed to 14px and the buttons spilled out of
   * it and off the screen, which looked exactly like the overflow it was
   * meant to fix.
   */
  assert.match(css, /table\.hiring-table td\.actions-cell \{[^}]*position: sticky/);
  assert.match(src('components/hiring/Interviews.jsx'), /<td className="actions-cell">/);
});

test('the row actions stay on one line and stay on the screen', () => {
  const list = src('components/hiring/Interviews.jsx');

  /*
   * Letting them wrap was worse than the overflow it fixed: four buttons
   * stacked into a column and the row grew four times as tall, which is what
   * Dinesh reported. Short labels on one line instead.
   */
  assert.match(css, /\.row-actions \{[^}]*flex-wrap: nowrap/);
  assert.match(list, /'Their form ●'/);
  assert.match(list, /i\.candidate_sent_at \? 'Sent' : 'Send'/);

  /*
   * And the flex goes on a div INSIDE the cell. `display: flex` straight on a
   * <td> takes the cell out of table layout - it collapsed to 14px and the
   * buttons spilled out of it and off the screen, which looked exactly like
   * the overflow it was meant to fix.
   */
  assert.match(list, /<td className="actions-cell">/);
  assert.match(list, /<div className="row-actions">/);
  assert.match(css, /table\.hiring-table td\.actions-cell \{[^}]*position: sticky/);
});

test('evaluations waiting for a decision are listed where interviews are', () => {
  const list = src('components/hiring/Interviews.jsx');
  assert.match(list, /Waiting for a decision/);
  assert.match(list, /\/hiring\/evaluations\/waiting/);
  // Clicking one opens that evaluation, which is the point of listing it.
  assert.match(list, /onEvaluate\(w\.interview_id\)/);
});

/* ---------------- the shell, to his dashboard mock-up ---------------- */

test('the navy bar is a ROW, said out loud', () => {
  /*
   * A global rule stacks every <header> into a column, so `display: flex`
   * alone put the page's name on one line and the avatar centred on the
   * next. Third time that rule has caught something - the help panel's close
   * button and the sign-in screen were the other two - so it is pinned.
   */
  const css = src('styles.css');
  const bar = css.slice(css.indexOf('.page > header {\n  display: flex;'));
  const body = bar.slice(0, bar.indexOf('}'));
  assert.match(body, /flex-direction: row/);
  assert.match(body, /flex-wrap: nowrap/);
});

test('the title keeps the avatar at the far end', () => {
  // `h1.here` sets `margin: 0` elsewhere, and element+class beats class
  // alone - written weaker, the avatar sits glued to the title.
  const css = src('styles.css');
  assert.match(css, /\.page > header h1\.here \{ margin-right: auto; \}/);
  // ...and the identity strip must NOT carry one too: two auto margins split
  // the free space and centre the title between them.
  const strip = css.slice(css.indexOf('.who-strip {'));
  assert.ok(
    !/margin-left: auto/.test(strip.slice(0, strip.indexOf('}'))),
    'two auto margins centre the page name instead of leaving it at the left'
  );
});

test('the rail names the element it actually styles', () => {
  // `.sidebar nav button.active` matched nothing and lost silently to the
  // rule it was meant to replace. The element is `.side-nav`.
  const css = src('styles.css');
  assert.match(css, /\.side-nav button\.active \{[^}]*background: var\(--gold\)/);
});

test('assets and licences do not wait for a month to be opened', () => {
  // A laptop bought in March is on the register in November. The banner
  // telling somebody to open a month was noise above the figures, and noise
  // above the figures is how a real warning stops being read.
  const app = src('App.jsx');
  assert.match(app, /\['employees', 'dashboard', 'hiring', 'assets', 'license'\]\.includes\(tab\)/);
});

test('the ledger never hands a row renderer straight to .map', () => {
  /*
   * `.map(fn)` passes the INDEX as the second argument. The ledger's row
   * renderer takes a "show a tick box" flag there, so `returned.map(line)`
   * printed a literal 0 in the first row (`0 && …` renders the zero in JSX)
   * and put a tick box on every later one, shifting the table out of line
   * with its own header.
   */
  const file = fs.readFileSync(
    new URL('../../frontend/src/components/people/AssetLedger.jsx', import.meta.url),
    'utf8'
  );
  /*
   * Comments stripped before the negative assertion - the comment ABOVE this
   * explains the bug by quoting the very code it forbids, and the first run
   * of this test failed against perfectly good code because of it. Third time
   * in this file.
   */
  const code = file.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\.map\(line\)/.test(code), 'a row renderer is being handed the array index as a flag');
  /*
   * The call sites moved when the ledger grew tabs and a serial number
   * column - the renderer now takes the row's position too. The RULE is
   * unchanged and is what this test is for: the flag is always passed
   * explicitly, never left to `.map` to fill in.
   */
  assert.match(code, /returned\.map\(\(l, i\) => line\(l, false, i\)\)/);
  assert.match(code, /holding\.map\(\(l, i\) => line\(l, taking, i\)\)/);
  // And the flag is rendered as a ternary, so a falsy number cannot print.
  assert.ok(!/\{tickable && \(/.test(code), 'a falsy flag would render as 0');
});

/* ======================================================================
 * Paper, and the two lists that read as empty when they were only blank.
 * ====================================================================== */

test('a joiner with no date, and a leaver with no date, are counted and named', () => {
  const dash = src('components/Dashboard.jsx');

  /*
   * Dinesh added joiners and leavers and the card still read "Nobody new
   * this month" and "Nobody left." Both were true of the DATA:
   *
   *   "Add to payroll" needs only a name and a salary, so a joiner can land
   *   with no joining date at all.
   *   Unticking "active" - the only way out of the payroll on that screen -
   *   records NO leaving date.
   *
   * And the old footnote counted neither, because it counted people with
   * NEITHER a birth date NOR a joining date. The three are separate counts
   * now, and the empty lists say which of them is why.
   */
  assert.match(dash, /noJoined: active\.filter\(\(e\) => !e\.joined_on\)\.length/);
  assert.match(dash, /noDob: active\.filter\(\(e\) => !e\.dob\)\.length/);
  assert.match(dash, /goneNoDate: mine\.filter\(\(e\) => !e\.active && !e\.left_on\)\.length/);

  // The empty text is not a flat "Nobody": it names the gap and offers the
  // way to fill it.
  assert.match(dash, /no joining date at all/);
  assert.match(dash, /no last working day/);
  // The sentence wraps in the source, so the gap may be a newline.
  assert.match(dash, /unticking .active. does[\s\S]{0,20}not set one/i);

  // The counts are worded one at a time, not "1 have".
  assert.match(dash, /people\.noDob === 1 \? 'has' : 'have'/);
});

test('Left is a column on the Employees table, beside Born and Joined', () => {
  const emp = src('components/Employees.jsx');

  /*
   * It existed only on the profile drawer, below six other blocks - which
   * is why the tick box beside it got used instead, and that records no
   * date. Fifth time for this shape: the way in has to be where the person
   * is already standing.
   */
  assert.match(emp, /<th title="The last working day[^"]*">\s*Left\s*<\/th>/);
  assert.match(emp, /onPatch\(emp\.id, \{ left_on: e\.target\.value \}\)/);
  // And the tick box says what it does NOT do.
  assert.match(emp, /It does not record a leaving date/);
});

test('there is still one print block, and it clears the screen furniture off the paper', () => {
  const print = css.slice(css.lastIndexOf('@media print'));

  // The navy top bar printed with a signed-in avatar on it; the month and
  // company pickers printed as dropdowns somebody cannot press.
  assert.match(print, /\.page > header/);
  assert.match(print, /\.page-filters/);
  assert.match(print, /aside, \.sidebar/);

  // Headers repeat on every sheet and a row is never split in half.
  assert.match(print, /thead \{ display: table-header-group/);
  assert.match(print, /tr, img \{ page-break-inside: avoid/);

  // All three dialog layers are flattened: one of them printed a grey tint
  // over the whole page.
  assert.match(print, /\.modal-backdrop, \.picker-backdrop, \.backdrop \{/);

  // A section that prints whether or not its tab is open.
  assert.match(print, /\.print-only \{ display: block !important/);
});

test('the wide screens take landscape paper, and nothing else does', () => {
  const app = src('App.jsx');

  /*
   * `@page` cannot be scoped by a class, and Chrome ignores a named page
   * (`page: wide`) on a nested element - both were tried and read back off
   * the printed PDF. A stylesheet that exists only while one of those tabs
   * is open can say it, and it works for Ctrl+P too.
   */
  assert.match(app, /const LANDSCAPE_TABS = new Set\(\['sheet', 'attendance'\]\)/);
  assert.match(app, /LANDSCAPE_TABS\.has\(tab\) && <style>\{'@page \{ size: A4 landscape/);

  // And the printed page says what it is, since the browser's own header
  // can only say the date and the address.
  assert.match(app, /className="print-head"/);
  assert.match(css, /\.print-head \{ display: none; \}/);
});

test('the printed register lists the assets, and a name on it opens that ledger', () => {
  const st = src('components/people/AssetStatement.jsx');

  /*
   * "agar 3 mobile he to 3 ki alag alag detail dikhna chahiye" - a
   * staff-wise register that says "Mobile 3" is a count, not a register. So
   * By person turns on listing every asset.
   */
  assert.match(st, /setBy\('person'\);\s*\n\s*setFull\(true\);/);

  // "agar ek jan ka ledger dekhna he to uska bhi option do" - the name on
  // the block IS the way in. Sixth time for this shape.
  assert.match(st, /setLedger\(\{ id: block\.employee_id, name: block\.name \}\)/);
  assert.match(st, /<AssetLedger/);

  // Each person's block stays whole on paper and shares one set of column
  // widths with every other block.
  assert.match(st, /className="statement-block"/);
  const print = css.slice(css.lastIndexOf('@media print'));
  assert.match(print, /\.statement-block table\.sheet \{ table-layout: fixed/);
});

test('one person’s whole ledger prints, not whichever tab is open', () => {
  const led = src('components/people/AssetLedger.jsx');

  /*
   * Printing from Overview gave a sheet with six figures and no list of
   * what the person holds - which is the one thing a ledger is handed over
   * for. Current assets and the movement ledger are always rendered now,
   * hidden on screen when their tab is not the open one.
   */
  assert.match(led, /tab === 'current' \? undefined : 'print-only'/);
  assert.match(led, /tab === 'ledger' \? undefined : 'print-only'/);
  // With a heading each, because on screen the tab button was the heading.
  assert.match(led, /<h4 className="print-only">Assets with them now<\/h4>/);
});

test('a report is built, and while it prints the app is not on the paper at all', () => {
  /*
   * "PURA SCREEN PRINT NAHI KARNA HE, REPORT PRINT KARNA HOTA HE". Hiding
   * the furniture with CSS still printed the working screen with its bits
   * taken off - the filter row, the tick boxes, and every cell an input.
   */
  const print = css.slice(css.lastIndexOf('@media print'));
  assert.match(print, /body\.printing-report > #root \{ display: none !important/);
  assert.match(print, /body\.printing-report #print-root \{ display: block !important/);
  assert.match(css, /#print-root \{ display: none; \}/);

  // The screens that print a built report rather than themselves.
  for (const file of [
    'components/people/Assets.jsx',
    'components/people/AssetStatement.jsx',
    'components/people/AssetLedger.jsx',
    'components/people/Maintenance.jsx',
    'components/Employees.jsx',
    'components/SalarySheet.jsx',
  ]) {
    assert.match(src(file), /printReport/, `${file} should print a built report`);
  }

  // And those three no longer print the page itself.
  for (const file of [
    'components/people/AssetStatement.jsx',
    'components/people/AssetLedger.jsx',
  ]) {
    assert.ok(!src(file).includes('window.print()'), `${file} still prints the screen`);
  }
});

test('a printed staff list says it carries salaries', () => {
  /*
   * The employee list is the one report here that is somebody's pay. On
   * screen it is behind a login; on paper it is a sheet on a desk.
   */
  assert.match(src('components/Employees.jsx'), /This list carries salaries/);
});

test('attendance and leave each print their own register', () => {
  /*
   * "attendance aur leave ka bhi print report do". The grid is a month of
   * boxes to click and the balances screen is a table of quota boxes; what
   * the office files is a muster and a leave register.
   */
  const att = src('components/Attendance.jsx');
  assert.match(att, /printReport/);
  assert.match(att, /title: 'Attendance muster'/);
  // The marks it prints are the ones ON SCREEN, unsaved edits included.
  assert.match(att, /effectiveAttendance\(row\)/);
  // Every day of the month, with its weekday, and the off days shaded.
  assert.match(att, /\.\.\.dayList\.map/);
  assert.match(att, /sub: weekday\(period\.year, period\.month, d\)/);
  assert.match(att, /tint: isSunday\(period\.year, period\.month, d\)/);
  // The codes are on the paper: a muster is read by somebody who did not
  // mark it.
  assert.match(att, /ATTENDANCE_CODES/);

  const leave = src('components/Leave.jsx');
  assert.match(leave, /title: 'Leave register'/);
  // Due / taken / left for each kind, and over-entitlement shown as a minus
  // rather than hidden at zero.
  assert.match(leave, /left < 0 \? '-' : ''/);
  assert.match(leave, /Taken is counted from the attendance marks/);
});

test('the payslip and the batch of payslips are one document, built once', () => {
  const slip = src('components/Payslip.jsx');
  const sheet = src('components/SalarySheet.jsx');

  // The lines live in shared/, so the screen and the printed stack cannot
  // drift - the first hand-written copy had already lost the penalty line.
  assert.match(slip, /payslipLines/);
  assert.match(slip, /export function slipFor/);
  assert.match(sheet, /import \{ slipFor \} from '\.\/Payslip\.jsx'/);

  // Neither prints the screen any more.
  assert.ok(!slip.includes('window.print()'));
  assert.match(slip, /printSlips\(\{ slips: \[slipFor\(row, period, calc, logo\)\] \}\)/);
  assert.match(sheet, /Print \{filtered\.length\} payslip/);

  /*
   * The company's letterhead, handed IN rather than looked up inside the
   * slip: these are built in the browser, so the picture has to travel.
   * "payslip me bhi logo aana chahiye".
   */
  assert.match(slip, /export function slipFor\(row, period, calc, logo = ''\)/);
  for (const file of [slip, sheet]) assert.match(file, /logoFor\(/);
  // The whole stack is built AFTER they arrive, so it cannot come out with
  // the first few carrying a logo and the rest not.
  assert.match(sheet, /await loadCompanyLogos\(\);\s*\n\s*printSlips/);

  // One slip to a page, and the last one does not leave a blank sheet.
  assert.match(css, /\.pr-slips \.pr-slip \{ page-break-after: always/);
  assert.match(css, /\.pr-slips \.pr-slip:last-of-type \{ page-break-after: auto/);

  /*
   * The <header> trap, fourth time: a global rule stacks every header into
   * a column, so the employee's name landed UNDER the company name instead
   * of opposite it. Measured on a printed PDF.
   */
  assert.match(css, /\.pr-slip-head \{\s*display: flex !important; flex-direction: row !important/);
});

test('a Category added under Lists becomes a group, in the browser and on the server', () => {
  /*
   * "ASSET ME NEW GROP KAHA SE ADD HOTA HE". It could not be: the groups
   * were written in shared/assetGroups.js. Meanwhile Lists → Categories had
   * existed all along and reclassified nothing — the shape this app keeps
   * running into, where the thing exists and is not joined up.
   */
  const assets = src('components/people/Assets.jsx');
  assert.match(assets, /setOwnGroups\(/);
  // Both places the lists arrive: the first load, and an add on the Lists tab.
  assert.equal(assets.match(/setOwnGroups\(/g).length, 2);
  // The buttons are redrawn when the categories change.
  // (`nature` joined the list in v2.31: the Fixed / Movable chip narrows
  // what the group buttons count, so it has to redraw them too.)
  assert.match(assets, /\[assets, filter, query, narrowed, masters, nature\]/);
  // And the way in sits where somebody is already looking at the groups.
  assert.match(assets, /\+ group/);
  assert.match(assets, /Groups come from Lists → Categories/);

  // The Lists panel says what a Category is for, instead of "broad groups".
  assert.match(src('components/people/AssetMasters.jsx'), /These ARE the register’s groups/);
});

test('the staff page does not shout somebody’s pay across the room', () => {
  const my = src('components/MyPage.jsx');

  /*
   * "EMPLOYEE LOGIN PE FRONT PE ITNE BADHE FONDT ME SALARY MAT DIKHAVO" —
   * it was 1.8rem, legible from the next desk while somebody signed in at
   * the counter. It reads at the size of every other figure now, with a
   * hide beside it for a shared screen.
   */
  assert.match(css, /\.my-net \.n \{ font-size: 1\.05rem/);
  assert.ok(!/\.my-net \.n \{ font-size: 1\.8rem/.test(css));
  assert.match(my, /showPay \? rupees\(row\.net_salary\) : '••••••'/);
  // What is hidden is remembered on that device, and localStorage is
  // wrapped because touching it throws in a private window.
  assert.match(my, /localStorage\.getItem\('bnf-hrms-hide-pay'\)/);
  assert.equal((my.match(/catch \{/g) || []).length >= 2, true);
});

test('the open month shows what has been earned up to today', () => {
  const my = src('components/MyPage.jsx');

  // "jo date ko open kare o date tak ki earning bhi dikhavo".
  assert.match(my, /earnedSoFar\(\{/);
  assert.match(my, /upto: now\.getDate\(\)/);
  // Only for the month we are living in: a finished month's net IS the answer.
  assert.match(my, /now\.getFullYear\(\) !== detail\.period\.year/);
  // And it never pretends to be take-home.
  assert.match(my, /It is not a promise of\s*\n?\s*what will be paid/);

  /*
   * EVERY HOOK ABOVE THE FIRST RETURN. This memo sat below the "no month
   * has been run for you yet" return, so the page rendered a different
   * number of hooks once the months arrived and React tore it down with
   * error #310 - a staff login opened on a blank white page. Found by
   * signing in as an employee and looking.
   */
  const memo = my.indexOf('earnedSoFar({');
  const firstReturn = my.indexOf('if (!months.length)');
  assert.ok(memo > 0 && memo < firstReturn, 'the memo must sit above the early return');
});

test('loans and advances print as a register', () => {
  const loans = src('components/Loans.jsx');

  // "loan aur advance ka bhi print report do". The screen is two instalment
  // boxes and a status picker; what the office files is a list.
  assert.match(loans, /printReport/);
  assert.match(loans, /title: 'Loans and advances'/);

  /*
   * The month column is the instalment POSTED against this month's row, not
   * the standing instalment - the two differ the moment a month is skipped,
   * which is the whole reason a month can be skipped without the debt going
   * anywhere. The paper says that out loud.
   */
  assert.match(loans, /thisMonth\.get\(l\.id\) \|\| 0/);
  assert.match(loans, /Nothing here deducts by itself/);

  // A loan on hold is not counted into what a full month would take.
  assert.match(loans, /l\.outstanding > 0 && l\.status !== 'held'/);
});

test('penalties and expense claims each print a register', () => {
  const pen = src('components/people/Penalties.jsx');
  const claims = src('components/people/Claims.jsx');

  // "penalty aur expense claim ka bhi print report do".
  assert.match(pen, /title: 'Penalties, losses and damage'/);
  assert.match(claims, /title: 'Expense claims'/);

  /*
   * The penalty register takes the SERVER'S totals, so the paper and the
   * panel cannot disagree about the line people get wrong: held money is
   * still owed and sits inside the outstanding, and only waived money
   * leaves it.
   */
  assert.match(pen, /report\?\.totals \|\| \{\}/);
  assert.match(pen, /Held money is still owed/);
  // The note is the whole reason the module exists, so it is a column.
  assert.match(pen, /col\('Why it was charged', \(r\) => r\.note/);
  // The Act is reported, never enforced - said where somebody signs it off.
  assert.match(pen, /it does not enforce/);

  /*
   * A claim is paid only THROUGH A NAMED MONTH, and that month is now on
   * the row by name: `paid_period_id` was there and nothing could say
   * "November 2026".
   */
  assert.match(claims, /col\('Paid through', \(c\) => c\.paid_period_label/);
  assert.match(claims, /An approved claim is not a paid claim/);
});

test('appraisals and asset handovers each print a register', () => {
  const app = src('components/people/Appraisals.jsx');
  const slips = src('components/people/HandoverSlips.jsx');

  // "appraisal aur asset handover ka bhi print report do".
  assert.match(app, /title: 'Appraisals and increments'/);
  assert.match(slips, /title: 'Asset handover register'/);

  /*
   * An appraisal is a PROPOSAL until applied, and a printed list of
   * increments is exactly the thing somebody reads as a decision already
   * taken. So the paper carries the applied date per row, totals only the
   * applied ones, and says both out loud.
   */
  assert.match(app, /r\.applied \? String\(r\.applied_at \|\| ''\)\.slice\(0, 10\) : 'not yet'/);
  assert.match(app, /label: `Applied \(\$\{applied\.length\}\)`/);
  assert.match(app, /An appraisal is a proposal until it is applied/);

  /*
   * The handover register is the LOG - every issue and return - and the
   * list on screen is who holds something NOW, built from the register so
   * that somebody holding an imported asset with no slip is on it. Two
   * different questions, and the paper says which one it answers.
   */
  assert.match(slips, /api\.get\('\/people\/assets\/handovers'\)/);
  assert.match(slips, /This is the handover LOG/);
  assert.match(slips, /Print the handover register/);
});

test('staff jobs and the helpdesk each print a register', () => {
  const tasks = src('components/people/Tasks.jsx');
  const desk = src('components/people/Helpdesk.jsx');

  // "helpdesk aur staff tasks ka bhi print report do".
  assert.match(tasks, /title: 'Work given to staff'/);
  assert.match(desk, /title: 'Helpdesk — what staff have asked'/);

  /*
   * Two rules of the task module, said where somebody reading the list
   * will act on it: a job with no date is not late, and a done job is
   * never deleted - only dropped, and that is the office's call.
   */
  assert.match(tasks, /A job with no date is not late/);
  assert.match(tasks, /not the WhatsApp task assistant/);

  /*
   * And two of the helpdesk's, both easy to read the wrong way round:
   * waiting means waiting on US, and answering is not closing.
   */
  assert.match(desk, /t\.waiting \? 'the office' :/);
  assert.match(desk, /Answering is not closing/);

  /*
   * The columns use the row's OWN field names, read off the API rather
   * than guessed: `last_reply_at` and `last_side`. The first attempt
   * printed an `answered_at` that does not exist, so the column was blank
   * on a ticket that had been answered that morning.
   */
  assert.match(desk, /t\.last_reply_at/);
  assert.match(desk, /t\.last_side === 'office'/);
});

test('exits print as a register, and a full and final as a statement', () => {
  const leaving = src('components/people/Leaving.jsx');

  // "exit aur full and final ka bhi print report do".
  assert.match(leaving, /title: 'Exit register'/);
  assert.match(leaving, /printSlips\(\{/);
  assert.match(leaving, /Full and final settlement/);

  /*
   * THE RULE THAT HAD TO SURVIVE ONTO THE PAPER: an unreturned asset is
   * named and valued, NEVER deducted - a laptop docked for and then found
   * in a drawer cannot be undone once the payment is made.
   */
  assert.match(leaving, /Still with them: \$\{a\.label\} — not deducted/);
  assert.match(leaving, /are NOT deducted/);

  // The Act's rounding reads as a contradiction unless it says so.
  assert.match(leaving, /counted as \$\{s\.gratuity\.years\} for gratuity/);

  // And a register could hide that the settlement is assembled until paid.
  assert.match(leaving, /worked out fresh each time it is opened/);
});

test('candidates and interviews each print a register, and the CV never leaves', () => {
  const cands = src('components/hiring/Candidates.jsx');
  const ivs = src('components/hiring/Interviews.jsx');

  // "interview aur candidate ka bhi print report do".
  assert.match(cands, /title: 'Candidates'/);
  assert.match(ivs, /title: 'Interview schedule'/);

  /*
   * A CV is a stranger's own document, kept on disk behind an expiring
   * signed link - and a printed list is exactly how one leaves the
   * building. The column says only whether there is one on file, and the
   * page says what it carries, because paper travels further than a screen.
   */
  assert.match(cands, /col\('CV', \(c\) => \(c\.has_cv \? 'on file' : ''\)\)/);
  assert.ok(!cands.includes('resume_path'));
  assert.match(cands, /This sheet carries strangers’ phone numbers/);
  assert.match(cands, /never printed or exported/);

  /*
   * The hiring module's own rule, on the schedule: nothing moves a
   * candidate on by itself and nobody is rejected by a score.
   */
  assert.match(ivs, /papers, not decisions/);
  // The two columns the list exists for.
  assert.match(ivs, /col\('Their form'/);
  assert.match(ivs, /col\('Evaluation'/);
});

test('vacancies print a register, and the offer letter prints itself', () => {
  const vac = src('components/hiring/Vacancies.jsx');
  const offer = src('components/hiring/Offer.jsx');

  // "vacancy aur offer letter ka bhi print report do".
  assert.match(vac, /title: 'Vacancies'/);
  assert.match(vac, /printReport/);
  // The three figures somebody asks about, added up at the foot.
  for (const head of ['Openings', 'Hired', 'Applications']) {
    assert.match(vac, new RegExp(`num\\('${head}'`), `the register needs a ${head} column`);
  }
  assert.match(vac, /Openings: sum/);
  /*
   * A printed list of openings reads as a list of live ones, and a draft is
   * not one - nobody can apply to it.
   */
  assert.match(vac, /apply link is not live until it is published/);

  /*
   * "ha to da sake wesa banavo" - he hands the letter over, so it prints.
   *
   * It FETCHES the server's letter rather than building a second copy here.
   * It was built here at first, from the same shared function; once the
   * company's logo had to be inlined into it on the server, a copy built in
   * the browser would have been a copy that could say something else.
   */
  assert.match(offer, /fetchPage\(`\/hiring\/applications\/\$\{applicationId\}\/offer\/letter`\)/);
  assert.ok(!offer.includes('offerLetterHtml'), 'the browser must not build the letter again');
  assert.match(offer, /Print the letter/);
  // An iframe, because a whole document cannot print inside this page.
  assert.match(offer, /frame\.srcdoc = html/);
});

test('the hiring reports print the report, not the screen', () => {
  const rep = src('components/hiring/HiringReports.jsx');
  assert.match(rep, /printReport/);
  assert.ok(!rep.includes('window.print()'), 'HiringReports still prints the screen');
  // It prints what is on screen, narrowed the same way, from the same grid.
  assert.match(rep, /grid\.rows\[index\]/);
});

test('the front desk is a tab, and its help topic names the trap', () => {
  /*
   * Dinesh sent the single-file tool he had built for reception and said
   * "need this all feature in this".
   */
  const app = src('App.jsx');
  assert.match(app, /\['frontoffice', 'Front office', 'frontdesk', 'frontoffice'\]/);
  assert.match(app, /tab === 'frontoffice' && \(/);
  // It is handed the staff list, so "here to meet" is an employee.
  assert.match(app, /<FrontOffice[\s\S]{0,200}employees=\{employees\}/);

  const fo = src('components/FrontOffice.jsx');
  /*
   * The screens his tool had, in its order. "Today" held the figures AND the
   * walk, so neither had a name - somebody sent to the dashboard and
   * somebody sent to housekeeping were sent to the same tab. Dinesh:
   * *"dashboard banavo / housekeeping ka tab banavo"*.
   */
  for (const label of [
    'Dashboard', 'Housekeeping', 'Visitors', 'Courier', 'Daily report', 'Monthly summary', 'Areas',
  ]) {
    assert.match(fo, new RegExp(`'${label}'`), `the ${label} view is missing`);
  }
  /*
   * The visitor book and the courier register moved into their own
   * components when they grew a form, filters, a pass and a handover; the
   * shell keeps the housekeeping walk and the month's own papers. Every one
   * of them still builds a document rather than printing the screen.
   */
  assert.match(fo, /printReport/);
  for (const file of [
    'components/frontoffice/VisitorDesk.jsx',
    'components/frontoffice/CourierDesk.jsx',
    'components/frontoffice/VisitorReports.jsx',
  ]) {
    assert.match(src(file), /printReport/, `${file} should print a built report`);
  }

  /*
   * The row button must NOT be called "Sign out": the sidebar has one, and
   * a receptionist clicking the wrong one is signed out of the app. Found
   * by a browser run doing exactly that. It lives on the visitor desk now.
   */
  const visitors = src('components/frontoffice/VisitorDesk.jsx');
  assert.ok(!/>\s*Sign out\s*</.test(visitors));
  assert.match(visitors, /Out now/);

  // The rule the module exists for, said where somebody is standing.
  assert.match(fo, /never as clean/);
});

test('the front desk shows on the dashboard, for the day the roll call is on', () => {
  /*
   * "front office ka data dashboard me bhi dikhao". It is the other half of
   * the same morning, so it follows the ‹ › arrows rather than carrying a
   * date of its own - two halves read against different days would be worse
   * than not showing it.
   */
  const dash = src('components/Dashboard.jsx');
  assert.match(dash, /front-office\/day\//);
  // The SAME module the tab counts with, so the two cannot disagree.
  assert.match(dash, /import \{ dayStats \} from '\.\.\/\.\.\/\.\.\/shared\/frontOffice\.js'/);
  assert.match(dash, /Front desk —/);

  // Its own right: no front office on this login, no card and no refusals.
  assert.match(dash, /mayUse\('frontoffice'\)/);

  /*
   * Zeroes would read as a clean, quiet day. A desk nobody wrote anything
   * at says so instead - the rule the whole module exists for.
   */
  assert.match(dash, /Nothing recorded at the desk for this day/);
  assert.match(dash, /key: 'fo-flags'/);
  assert.match(dash, /key: 'fo-unchecked'/);
});

test('somebody who has left is not offered in any "pick somebody" box', () => {
  /*
   * "agar employee exited he to o current list me nahi aana chahiye". One
   * rule in one file: they go from the lists you choose FROM and stay in
   * every list of what already happened.
   */
  const helper = fs.readFileSync(
    new URL('../../frontend/src/onStaff.js', import.meta.url),
    'utf8'
  );
  assert.match(helper, /export const onStaff/);
  // The line wraps in the file, so the words are checked rather than the line.
  assert.match(helper, /lists you choose FROM/);
  assert.match(helper, /already happened/);

  // And the Employees grid no longer tells you to untick Active as well.
  const employees = src('components/Employees.jsx');
  assert.ok(!employees.includes('Typing it does not take them off the payroll'));
  assert.match(employees, /A date that has passed takes them off the list/);
});

test('the front office report opens WhatsApp with itself already typed', () => {
  /*
   * "front office ka daily report whatsapp pe auto bhej sakte he kya?" -
   * unattended sending needs a number this app may send from, which it does
   * not have yet. This is the honest half, and the screen says exactly that:
   * one tap opens WhatsApp with the message in the box, and the person picks
   * the chat. NOTHING IS SENT BY ITSELF, so it cannot land in the wrong group.
   */
  const fo = src('components/FrontOffice.jsx');
  assert.match(fo, /https:\/\/wa\.me\/\?text=\$\{encodeURIComponent\(text\)\}/);
  assert.match(fo, /Send on WhatsApp/);
  // wa.me, not whatsapp://, so the same link works on a phone and on the desktop.
  assert.ok(!fo.includes('whatsapp://'));
  assert.match(fo, /It is never sent by itself/);
  // The text is the same one the screen is showing and the Copy button copies.
  assert.match(fo, /openWhatsApp\(reportText\)/);
});

test('the front desk registers read like registers', () => {
  /*
   * He sent a picture of one visitor row: "ye format sahi karo". Three
   * things were wrong with it - an em dash in every empty box, a table that
   * hugged its own width and left half the card blank, and Delete spelled
   * out in full on every line.
   */
  const fo = src('components/FrontOffice.jsx');

  // A blank cell is blank. No dash standing in for "nothing to say".
  assert.ok(!/\|\| '—'/.test(fo), 'an empty cell must not carry a dash');

  // Numbered and full width, like every other register in this app.
  assert.match(fo, /className="sheet numbered fo-table"/);
  assert.match(css, /table\.sheet\.fo-table \{ width: 100%; \}/);
  for (const file of [
    'components/frontoffice/VisitorDesk.jsx',
    'components/frontoffice/CourierDesk.jsx',
  ]) {
    assert.match(src(file), /className="sheet numbered fo-table"/, `${file} is not a register`);
    assert.match(src(file), /className="row-no"/);
  }

  // Headings over words line up with the words.
  assert.match(css, /table\.sheet\.fo-table thead th \{ text-align: left; \}/);

  /*
   * Nothing on the desk is deleted any more - a visitor book is a record of
   * who was in the building, so a row is ARCHIVED, and the confirmation
   * says so rather than saying "remove".
   */
  const desk = src('components/frontoffice/VisitorDesk.jsx');
  assert.match(desk, /Archive \$\{open\.name\}'s visit\?/);
  assert.match(desk, /nothing is deleted/);

  // The "saved" note goes away rather than sitting on the page for ever.
  assert.match(fo, /setTimeout\(\(\) => setSaid\(''\), 4000\)/);
});

/*
 * BEING SIGNED OUT HAS TO SAY SO.
 *
 * `handle` in App.jsx called `setAuthError`, which was never declared and
 * never rendered - so a 401 dropped somebody onto the sign-in screen with
 * nothing said, which reads as the app having lost its place. It did not
 * matter much while the only way out was a fortnight; it matters now that a
 * login signs itself out after a spell of doing nothing.
 */
test('the sign-in screen is told WHY it is back, and the setter is a real one', () => {
  const app = src('App.jsx');
  const login = src('components/Login.jsx');

  // Declared, set, cleared on the way back in, and handed over.
  assert.match(app, /const \[authNotice, setAuthNotice\] = useState\(''\)/);
  assert.match(app, /setAuthNotice\('You were signed out after a spell of doing nothing/);
  assert.match(app, /setAuthNotice\(''\)/);
  assert.match(app, /notice=\{authNotice\}/);

  /* And nothing is left CALLING the setter that never existed. The comment
     explaining this names it, so comments come out before asking - the same
     trap the candidate-list test hit. */
  const code = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/setAuthError/.test(code), 'the setter that was never declared is back');

  // Login takes it and renders it as a NOTICE, not as the red error line -
  // nothing went wrong and nothing was typed incorrectly.
  assert.match(login, /notice = ''/);
  assert.match(login, /className="signin-note">\{notice\}/);
});

/*
 * The idle rule is an Admin's, and it says "never" out loud.
 */
test('Signing out by itself is on the Logins screen, with never as a choice', () => {
  const users = src('components/admin/Users.jsx');

  assert.match(users, /Signing out by itself/);
  assert.match(users, /\/auth\/session-rule/);
  // Nought is offered in words. A setting that cannot admit it is off gets
  // worked around by nobody ever signing out.
  assert.match(users, /never — stay signed in/);
  // And the sentence changes with the figure rather than printing a number
  // nobody has to read.
  assert.match(users, /A login that does nothing for \$\{minutes\} minutes is signed out/);
});

/*
 * THE ATTENDANCE GRID - his brief's first section.
 *
 * Frozen name AND code, sticky date headers, today marked, the summary
 * columns he named, and the name as a way into that person's own month.
 */
test('the attendance grid freezes the code beside the name and pins the dates', () => {
  const att = src('components/Attendance.jsx');

  assert.match(att, /className="sticky-code"/);
  assert.match(att, /<th className="sticky-code">Code<\/th>/);

  // The date row stays put. Eighty-five names deep, the day numbers have
  // scrolled off and the only way to know which column you are clicking is
  // to count across with a finger - which is how the wrong day gets marked.
  assert.match(css, /table\.attendance thead th \{[^}]*position: sticky/);
  assert.match(css, /table\.attendance \.sticky-code \{[^}]*position: sticky/);

  // Today, and ONLY when today is in this month: October opened in November
  // with a day lit up would be wrong rather than merely missing.
  assert.match(att, /now\.getFullYear\(\) === Number\(period\.year\)/);
  assert.match(css, /table\.attendance th\.today/);
});

test('the summary columns are the ones he listed, counted off the same marks', () => {
  const att = src('components/Attendance.jsx');
  for (const head of ['>P<', '>Absent<', '>WO<', '>PL<', '>LWP<', '>HD<', '>Sun<', '>Hours<']) {
    assert.ok(att.includes(head), `the ${head} column is missing`);
  }
  /*
   * PRESENT COUNTS EVERY DAY SOMEBODY WAS AT WORK - here, at home, out on
   * the company's business, or on a round-the-clock duty.
   *
   * This assertion used to pin the sum written out by hand. It was written
   * out TWICE - the grid row and the printed muster - which is how v2.24.0's
   * paid-leave figure came to differ between two screens while a comment
   * promised it could not, so adding a fifth mark meant remembering both.
   * `daysPresent` in shared/calc.js is the one answer and the rule asserted
   * here is that neither screen works it out for itself.
   */
  assert.match(att, /daysPresent\(l\.counts\)/, 'the printed muster does not read the shared helper');
  assert.match(att, /daysPresent\(counts\)/, 'the grid row does not read the shared helper');
  assert.ok(
    !/counts\.P \|\| 0\) \+ \(counts\.WH/.test(att),
    'the present-days list is written out by hand again'
  );
  // Hours are what was CLOCKED, not the OT/LT column, which is a different
  // question and already has its own column beside it.
  assert.match(att, /monthTotals\(Object\.values\(merged\)/);
});

test('the name in the grid is a way in, and it looks like one', () => {
  const att = src('components/Attendance.jsx');
  assert.match(att, /className="link name-link"/);
  assert.match(att, /setStatementFor\(row\)/);
  assert.match(css, /\.name-link \{/);
});

test('the attendance statement assembles and cannot be edited from', () => {
  const stm = src('components/AttendanceStatement.jsx');
  // Read-only: the grid behind it is where attendance is marked, and a day
  // that can be changed from two screens gets changed from the wrong one.
  const code = stm.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/api\.(post|put|patch|del)\(/.test(code), 'the statement is writing something');
  assert.match(stm, /attendanceStatement\(row, period/);
  assert.match(stm, /Export CSV/);
  assert.match(stm, /onClick=\{print\}/);
});

/*
 * "MAKE CLEAR DESIGN" - the attendance statement's figures.
 *
 * Eight figures in one row at one weight: days, hours and a count of blanks
 * all shouting equally, with nowhere for the eye to land. They are two
 * questions, so they are two blocks with one headline figure each.
 */
test('the attendance statement groups its figures instead of lining up eight', () => {
  const stm = src('components/AttendanceStatement.jsx');

  assert.match(stm, /className="stm-stats"/);
  assert.match(stm, /<h3>Days<\/h3>/);
  assert.match(stm, /<h3>Hours<\/h3>/);
  // One headline per block - the figure somebody came to read.
  assert.equal((stm.match(/className="stm-fig lead"/g) || []).length, 2);

  /*
   * AND IT DOES NOT BORROW `.fo-figures`. That class is on eight other
   * screens - the front office, the dashboard, payment tracking, the monthly
   * summary - and restyling it here would silently redraw all of them. The
   * `.alerts` / `.login` / `.sticky-name` trap, for the fourth time.
   */
  /* Comments out first: the one explaining this decision names the class,
     which is the trap the candidate-list test and the sign-out test both
     hit. A comment is not a className. */
  const code = stm.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/fo-figures/.test(code), 'it is back on the shared class');
  assert.match(css, /\.stm-stats \{/);
  assert.match(css, /\.stm-fig\.lead b \{/);
});

test('the statement header puts the name first on a phone', () => {
  // One row with the month, the badge and the close button all holding
  // their width squeezed the name to "Emplo…" at 390px, and the company
  // wrapped onto four lines under it.
  assert.match(css, /@media \(max-width: 700px\) \{\s*\.stm-head \{ flex-wrap: wrap/);
  assert.match(css, /\.stm-head > div:first-child \{ flex: 1 0 100%/);
  // And the name is never cut off: the month is held by flex instead.
  assert.ok(!/\.stm-head h2 \{[^}]*text-overflow: ellipsis/.test(css));
  assert.match(css, /\.stm-head \.stm-month \{ flex: 0 0 auto; \}/);
});

/*
 * THE TIME TAB REDESIGN.
 *
 * Dinesh's brief: *"compact filter toolbar... modern segmented controls...
 * keep the card short and professional... subtle alternating row
 * backgrounds... avoid horizontal overflow"* - and, in capitals, **modify
 * the Time tab only**.
 *
 * The page had FOUR stacked toolbars: mode + day + search on one, the fill
 * button and a paragraph on a second, an orphaned "change" on a third, the
 * lunch toggle on a fourth. 560px of chrome above the grid that is the only
 * reason to open the tab.
 */
test('the Time tab is one filter bar and one settings strip, not four toolbars', () => {
  const tab = src('components/TimeSheet.jsx');

  assert.match(tab, /className="time-bar"/);
  assert.match(tab, /className="time-settings"/);
  // The mode is a segmented control: one pill with the chosen half filled.
  // Two loose buttons read as two things you could have both of.
  assert.match(tab, /className="time-seg" role="tablist"/);
  assert.match(tab, /aria-selected=\{view === 'day'\}/);
  // The day stepper reads as ONE control rather than three beside each other.
  assert.match(tab, /className="time-daystep"/);

  // Every feature the brief lists is still on the page.
  for (const feature of [
    'One day, everybody', 'One person, whole month', 'Import from Excel',
    'Fill the usual timings', 'Lunch is inside the day', 'Search employee or company',
  ]) {
    assert.ok(tab.includes(feature), `"${feature}" has gone`);
  }
});

test('the Time grid fills its frame, stripes, and names what is missing', () => {
  // 766px of columns in a 1230px page: cramped cells with empty space
  // beside them, and the table scrolling sideways anyway.
  assert.match(css, /table\.timesheet \{ width: 100%; \}/);
  assert.match(css, /table\.timesheet thead th \{[^}]*position: sticky/);
  assert.match(css, /table\.timesheet tbody tr:nth-child\(even\)/);
  assert.match(css, /table\.timesheet tbody tr:hover > td/);

  const tab = src('components/TimeSheet.jsx');
  // A day started and not finished was indistinguishable from an empty one.
  assert.match(tab, /const halfTyped = !!\(entry\.in_time && !entry\.out_time\)/);
  assert.match(css, /table\.timesheet tr\.part-row > td/);
  // And the pill says WHICH fault. It said "check" on every one of them,
  // with the reason only in a tooltip - so the column read the same whether
  // somebody forgot to clock out or typed a nineteen-hour day.
  assert.match(tab, /read\.warning === 'no out time'/);
  assert.match(tab, /\? 'no out'/);
});

test('THE TIME TAB REDESIGN TOUCHES ONLY THE TIME TAB', () => {
  /*
   * The brief says it in capitals, and this app has been bitten four times
   * by a shared class name: `.alerts` restyled the dashboard's list,
   * `.login` would have rebuilt the password screen, `.sticky-name` broke
   * the Festivals date, `.fo-figures` is on eight screens.
   *
   * So every selector added for this page is prefixed. `.seg` and
   * `.day-step` were the two that were not, and the Dashboard already
   * carries `viz-seg` - near enough to be worth removing the doubt.
   */
  for (const bare of ['.seg ', '.seg{', '.seg,', '.day-step ', '.day-step{']) {
    assert.ok(!css.includes(`\n${bare}`), `${bare.trim()} is unscoped`);
  }
  assert.match(css, /\.time-seg \{/);
  assert.match(css, /\.time-daystep \{/);

  // And nothing outside the Time tab uses the components that changed.
  const app = src('App.jsx');
  assert.ok(app.includes("import TimeSheet from './components/TimeSheet.jsx'"));
  assert.match(src('components/TimeSheet.jsx'), /import LatePolicy/);
});

/*
 * THE EMPLOYEE SELF-SERVICE PORTAL.
 *
 * Dinesh's brief, with its own capitals: *"Employees must only access their
 * own data"*, *"Do not rely only on hiding frontend menus"*, *"Do not use
 * fake attendance, salary or leave data"*, and *"If some dashboard data is
 * unavailable, display a proper empty state instead of inventing values."*
 */
test('the portal is a rail of pages, and the actions are not pretend pages', () => {
  const page = src('components/MyPage.jsx');

  assert.match(page, /my-shell\$\{navOpen \? ' nav-open'/);
  assert.match(page, /className="my-rail"/);
  for (const label of [
    'Dashboard', 'My attendance', 'My leave', 'My salary',
    'My profile', 'Holidays', 'Documents', 'My record', 'Notices & jobs',
  ]) {
    assert.ok(page.includes(`'${label}'`), `${label} is missing from the rail`);
  }
  // Help and Sign out are ACTIONS, so they sit at the foot of the rail
  // rather than pretending to be pages.
  assert.match(page, /Help &amp; support/);
  assert.match(page, /onClick=\{onSignOut\}/);

  /*
   * "My Time" is deliberately NOT a separate entry: it is the same days as
   * My attendance with the clock times on them, and two entries showing one
   * set of days is how two things come to disagree.
   */
  assert.ok(!/\['time',/.test(page), 'a second page showing the same days');
});

test('the portal reads ONLY /api/me - there is no id in any URL on it', () => {
  const files = ['components/MyPage.jsx', 'components/my/MyDashboard.jsx',
    'components/my/MyHolidays.jsx', 'components/my/MyDocuments.jsx',
    'components/my/MyRecord.jsx', 'components/my/MyNotices.jsx'];
  for (const file of files) {
    const text = src(file);
    const calls = [...text.matchAll(/api\.(get|post|patch|put|del)\(`?'?([^`',)]+)/g)].map((m) => m[2]);
    for (const url of calls) {
      assert.ok(
        url.startsWith('/me') || url.startsWith('/auth'),
        `${file} reaches ${url}, which is not the employee's own door`
      );
    }
    // And no employee id is ever interpolated into a path - the server takes
    // it off the login, which is the whole of the design.
    assert.ok(
      !/\/employees\/\$\{/.test(text),
      `${file} puts an employee id in a URL`
    );
  }
});

test('the dashboard says NOT KNOWN rather than nought, and admits what is not built', () => {
  const dash = src('components/my/MyDashboard.jsx');

  // A day nobody has marked is not an absence, and no hours is not 0 hours.
  assert.match(dash, /worked === null \|\| worked === undefined \? '\u2014'/);
  assert.match(dash, /Nothing on your record yet/);
  assert.match(dash, /Nothing is marked for you yet/);

  /*
   * ANNOUNCEMENTS used to have no noticeboard behind it anywhere in the
   * system, and the card said so rather than being filled with something
   * invented. There IS a board now, so the rule is the other half of the
   * same one: when there is nothing on it, it says the board is empty - it
   * does not invent a notice to fill the card.
   */
  assert.match(dash, /Nothing on the board today/);
  const code = dash.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/const DEMO|placeholder|lorem/i.test(code), 'demo data on the employee dashboard');
});

test('the portal styles cannot reach the office app', () => {
  /*
   * "Do not change Dashboard / Salary Sheet / Attendance / ..." inside one
   * shared stylesheet means every selector has to be prefixed. `.my-*` is
   * carried by MyPage and the three files under components/my/ and by
   * nothing else.
   */
  const office = ['components/Dashboard.jsx', 'components/SalarySheet.jsx',
    'components/Attendance.jsx', 'components/Employees.jsx'];
  for (const file of office) {
    assert.ok(
      !/className="[^"]*\bmy-(shell|rail|card|cards|grid|top|body|dash)\b/.test(src(file)),
      `${file} has picked up a portal class`
    );
  }
  assert.match(css, /\.my-shell \{/);
  assert.match(css, /\.my-rail \{/);
  // The header trap, for the fourth time: a global rule stacks every
  // <header> into a column.
  assert.match(css, /\.my-top \{[^}]*flex-direction: row/);
});

/*
 * MY RECORD - appreciations, warnings and penalties on the person's own page.
 *
 * Dinesh: *"emp[loyee me unke achvemnet and penlatlites bhi dikhe esa karo"*.
 */
test('the record page shows the good list first, and offers no way to change anything', () => {
  const page = src('components/my/MyRecord.jsx');

  /*
   * THE GOOD LIST FIRST, deliberately. Putting somebody's fines at the top of
   * their own page is a choice about how the company talks to its staff.
   */
  /* The row classes, not the headings: "Appreciations" and "Warnings" are
     also the names of two stat tiles above, so an indexOf on the words finds
     the tile and not the list. */
  const good = page.indexOf('my-rec-item good');
  const warn = page.indexOf('my-rec-item warn');
  const pen = page.indexOf('my-rec-item pen');
  assert.ok(good > 0 && warn > good && pen > warn, 'appreciations come first');

  /*
   * The ONE thing it can write is the acknowledgement, and nothing else -
   * an employee cannot waive their own fine or edit a warning.
   */
  const writes = [...page.matchAll(/api\.(post|patch|del|put)\(`?'?([^`',)]+)/g)].map((m) => m[2]);
  assert.deepEqual(writes, ['/me/notes/${id}/acknowledge']);

  /* Every empty list says what it is empty OF, not just "nothing". */
  assert.match(page, /No penalty on your record/);
  assert.match(page, /No warning on your record/);

  /* And the penalty note travels, because it is the answer to "why was this
     cut" and the same line the payslip prints. */
  assert.match(page, /\{p\.note\}/);
  /* Where the money went: the months it came out of. */
  assert.match(page, /Taken from:/);
});

test('acknowledging is reading, not agreeing - and there is no such button on a penalty', () => {
  const page = src('components/my/MyRecord.jsx');
  /*
   * `employee_notes.acknowledged_on` means SEEN, which is exactly what a tap
   * can mean. `penalties.acknowledged_on` means ACCEPTED, and one column
   * cannot tell "I have seen this" from "I agree to this money coming out" -
   * so the portal shows whether it was accepted and offers no button.
   */
  assert.match(page, /it is not agreement, and it\s+changes nothing about your pay/);
  const penaltyBlock = page.slice(page.indexOf('Penalties &amp; recoveries'));
  assert.ok(!/acknowledge\(/.test(penaltyBlock), 'a penalty must not be acceptable by tap');
});

test('the record rule lives in one place, not in the page', () => {
  const page = src('components/my/MyRecord.jsx');
  /*
   * What is theirs to see is decided in shared/myRecord.js, which the route,
   * the page and the tests all read. A page with its own idea of it is how
   * the screen and the payload come to disagree.
   */
  assert.match(page, /from '\.\.\/\.\.\/\.\.\/\.\.\/shared\/myRecord\.js'/);
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/kind === 'note'/.test(code), 'the page must not re-decide which kinds are shown');
});

/*
 * THE ROLL CALL'S LISTS ARE ALWAYS REACHABLE.
 *
 * Dinesh, looking at a day when everybody turned up: *"yaha dashboard pe
 * proper list chiaye / absent employee ki / late comiong / without uniform o
 * sab"*. The lists existed — but the whole apparatus was rendered only when
 * somebody needed looking at, so on a good morning there were no chips, no
 * search and no way to ask who was absent. The one question vanished exactly
 * when it was quickest to answer.
 */
test('the roll call keeps its chips and its table on a day when nobody needs looking at', () => {
  const dash = src('components/Dashboard.jsx');

  /* The "everybody is at work" line is a SENTENCE ABOVE the table now, not
     something rendered instead of it. */
  const line = dash.indexOf('Everybody on the list is at work');
  const chips = dash.indexOf('roll-chips');
  assert.ok(line > 0 && chips > line, 'the chips must survive a quiet morning');
  assert.ok(
    !/needsLooking\.length === 0 \? \([\s\S]{0,200}\) : \(\s*<>/.test(dash),
    'the table is gated on there being something wrong'
  );

  /* A chip with nothing behind it still presses: "Absent 0" is an answer. */
  assert.ok(!/disabled=\{count === 0/.test(dash), 'a zero chip that cannot be pressed');

  /* And an empty list says WHAT is empty, rather than drawing no rows. */
  assert.match(dash, /const EMPTY_LINE = \{/);
  for (const key of ['absent', 'late', 'uniform', 'unmarked', 'present']) {
    assert.ok(new RegExp(`\\b${key}:`).test(dash.slice(dash.indexOf('const EMPTY_LINE'))),
      `${key} has no sentence for an empty list`);
  }
});

test('“At work” is a chip on the one table, not a second list of bare names', () => {
  const dash = src('components/Dashboard.jsx');
  assert.match(dash, /\['present', 'At work'/);
  /* The old fold listed the same people with no times, no hours and no
     search. Two places listing one thing is how two things disagree. */
  assert.ok(!/show all \$\{roll\.present\.length\}/.test(dash), 'the duplicate Present fold is back');
  assert.ok(!/setShowPresent/.test(dash));
  /* "Everyone" counted only the people who needed looking at, which is not
     everyone. */
  assert.ok(!/\['all', 'Everyone'/.test(dash));
});

test('the roll call’s reasons column is styled by class, not by position', () => {
  /*
   * It was `td:nth-child(2)` and the reasons had since moved to the third
   * column — so fifteen rems went to Status while "Late by 42m at 10:12"
   * wrapped down five lines beside it. The same drift the workbook's
   * hand-numbered columns hit.
   */
  assert.match(css, /table\.sheet\.roll-table td\.what-cell/);
  assert.match(src('components/Dashboard.jsx'), /<th className="what-cell">What<\/th>/);
});

/*
 * THE JOINING FORM.
 *
 * Dinesh's brief: a *"complete, professional New Employee form with 8
 * sections"*, tabbed, mandatory fields marked, drafts, duplicate detection,
 * and PAN and Aadhaar masked.
 */
test('the form reads its shape from the shared module, not from its own JSX', () => {
  const form = src('components/EmployeeForm.jsx');
  /*
   * A form whose fields live in its own markup cannot answer "what is still
   * missing", and the answer drifts the first time a field is added. The
   * sections, what is starred and what counts towards completeness all come
   * from shared/employeeMaster.js.
   */
  assert.match(form, /from '\.\.\/\.\.\/\.\.\/shared\/employeeMaster\.js'/);
  assert.match(form, /SECTIONS\.map|tabs\.map/);
  const code = form.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/'Full name'|'Date of joining'/.test(code), 'a field label typed into the form');
});

test('the form warns about a duplicate and refuses only a code clash', () => {
  const form = src('components/EmployeeForm.jsx');
  assert.match(form, /check-duplicate/);
  assert.match(form, /This is a warning, not a refusal/);
  /* Save draft is a real second button, not the same one with a tick. */
  assert.match(form, /Save draft/);
  assert.match(form, /Save employee/);
});

test('the old six-box add form is gone, and nothing else kept its fields', () => {
  const list = src('components/Employees.jsx');
  assert.match(list, /import EmployeeForm/);
  /* The inline form had its own state; leaving it behind would mean two
     ways to add somebody, one of which nobody maintains. */
  const code = list.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/const BLANK = \{/.test(code), 'the old add form is still here');
  assert.ok(!/setForm\(\{ \.\.\.BLANK/.test(code));
});

test('PAN, Aadhaar and the account are masked on the record, and the reveal is recorded', () => {
  const profile = src('components/EmployeeProfile.jsx');
  assert.match(profile, /MASKED\[field\]/);
  assert.match(profile, /\/viewed/);
  assert.match(profile, /hidden — showing it is recorded/);
  /* Honest about what the mask is: the value already travelled, because the
     PF return and the staff export need it. */
  assert.match(profile, /not encryption/);
});

test('a draft says so on the list and on the record', () => {
  assert.match(src('components/Employees.jsx'), /pill draft/);
  assert.match(src('components/EmployeeProfile.jsx'), /This record is a draft/);
  /* And it says what being a draft MEANS, which is the part that matters. */
  assert.match(src('components/EmployeeProfile.jsx'), /no payroll month/);
});

/*
 * PRINTING, ON EVERY REPORT THAT HAS ANYTHING TO PRINT.
 *
 * Dinesh: *"sare reports me proper printing reports dalo"*. Half of them
 * were a Download button and nothing else - right for a bank file, useless
 * for a register the office has to sign and file.
 */
test('a report that downloads a CSV can also be printed', () => {
  const reports = src('components/Reports.jsx');
  assert.match(reports, /import \{ printFromCsv \}/);
  /* Beside Download, not instead of it: the spreadsheet is still what goes
     to the bank. */
  assert.match(reports, /printOne\(open\)/);
  /* Only a CSV. An .xlsx is a zip and there is nothing honest to lay out
     from it without a parser the standalone build cannot carry - so the
     salary register prints from the month's flat CSV instead. */
  assert.match(reports, /\.includes\('\.csv'\)/);
  assert.match(reports, /export\.csv/);
});

test('the printed report says which month and which filters it is', () => {
  const reports = src('components/Reports.jsx');
  /* A printed register with no month on it is a page somebody has to ask
     about. */
  assert.match(reports, /meta: narrowed/);
  assert.match(reports, /period \? period\.label : null/);
});

test('the absent/present report and the muster print what is on screen', () => {
  const report = src('components/AttendanceReport.jsx');
  assert.match(report, /printReport\(/);
  /* The search is already applied to `rows` and `dayRows`: a page that
     quietly widened to the whole staff would be a different document from
     the one somebody asked for. */
  assert.match(report, /rows,\n        landscape: true/);
  assert.match(report, /rows: dayRows/);
  /* The muster reads its marks BY POSITION - `marks` is an array in the
     same order as `days`, and reading it by day number would be off by one
     for every row. */
  assert.match(report, /r\.marks\[i\]/);
});

/*
 * THE NOTICEBOARD, both sides.
 */
test('the portal shows notices and openings, and the dashboard card reads the board', () => {
  const page = src('components/my/MyNotices.jsx');
  assert.match(page, /We are hiring/);
  assert.match(page, /pass the link on/);
  /* The advert, not the vacancy: the page renders what the server narrowed,
     and never asks hiring for anything. */
  const calls = [...page.matchAll(/api\.(get|post|patch|del)\('([^']+)/g)].map((m) => m[2]);
  assert.deepEqual(calls.sort(), ['/me/announcements', '/me/openings']);

  const dash = src('components/my/MyDashboard.jsx');
  /* The card used to say there was no noticeboard in the system. There is
     one now, so the honest empty state is a different sentence. */
  assert.ok(!/no announcements noticeboard in the system/.test(dash));
  assert.match(dash, /Nothing on the board today/);
});

test('the office writes the board, and nothing is sent anywhere', () => {
  const panel = src('components/people/Noticeboard.jsx');
  assert.match(panel, /Nothing is sent/);
  /* A start date and an end date, both optional, both explained - a board
     with no "comes down" is a board nobody ever clears. */
  assert.match(panel, /leave empty for straight away/);
  assert.match(panel, /leave empty to take it down by hand/);
  /* And it says plainly that it needs the server. */
  assert.match(panel, /STANDALONE/);
});

/*
 * THE LEAVE LEDGER, on screen.
 */
test('the ledger opens from the name, and says when nothing has been posted', () => {
  const leave = src('components/Leave.jsx');
  /* The name was plain text, which is not a way in - the sixth time that
     exact shape has come up in this app. */
  assert.match(leave, /name-link/);
  assert.match(leave, /LeaveLedger/);

  const ledger = src('components/LeaveLedger.jsx');
  assert.match(ledger, /Nothing has been posted on this ledger yet/);
  /* And the button that stops a posted opening balance silently ending the
     yearly entitlement. */
  assert.match(ledger, /Start the ledger with their/);
  assert.match(ledger, /kind: 'annual'/);
});

test('the ledger says a credit marks no day and moves no money', () => {
  const ledger = src('components/LeaveLedger.jsx');
  assert.match(ledger, /It does <strong>not<\/strong> mark a day/);
  /* NOTHING ON THIS PAGE CAN REACH ATTENDANCE OR A PAYSLIP. It writes to
     the ledger (credits) and to the encashment door, which takes days off
     the ledger and pays nobody - the amount reaches a payslip only as an
     addition typed on the month's salary sheet. */
  const calls = [...ledger.matchAll(/api\.(post|patch|del)\(`?'?([^`',)]+)/g)].map((m) => m[2]);
  assert.ok(
    calls.every((u) => u.startsWith('/leave/credits') || u === '/leave/encash'),
    `the ledger wrote to ${calls}`
  );
  assert.ok(calls.some((u) => u === '/leave/encash'), 'encashing is on this page');
  /* And it says out loud that the days are off the ledger and nothing has
     been paid - a screen that took the days and went quiet would read as
     having paid for them. */
  assert.match(ledger, /pays nobody/);
});

/*
 * ONBOARDING: the office invites, the person fills in their own record.
 */
test('the joining form shows what the office set as read-only, and never asks a salary', () => {
  const page = src('components/JoinPage.jsx');
  /* The fields are the MASTER's own - a second list here would drift from
     it the first time one was added. */
  assert.match(page, /from '\.\.\/\.\.\/\.\.\/shared\/employeeMaster\.js'/);
  assert.match(page, /THEIRS_TO_FILL\.includes/);
  /* What the office decided is shown and cannot be typed over. */
  assert.match(page, /These were set when you were taken on/);
  /* And the pay section is relabelled, because what is left of it is the
     bank details - "Salary & bank" reads as a form about to ask. */
  assert.match(page, /title: 'Bank details'/);
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/monthly_salary/.test(code), 'the joining form mentions a salary');
});

test('the joining link can only reach its own form', () => {
  const page = src('components/JoinPage.jsx');
  const calls = [...page.matchAll(/api\.(get|post|patch|del)\(`?'?([^`',)]+)/g)].map((m) => m[2]);
  /* Everything goes through /join/<token>, and the server reads the
     invitation from the TOKEN rather than the URL. */
  assert.ok(calls.every((u) => u.startsWith('/join/')), `the joining page reached ${calls}`);
  assert.match(page, /Nothing is final until the office approves it/);
});

test('the office panel says nothing is sent, and the salary is typed there', () => {
  const panel = src('components/Onboarding.jsx');
  assert.match(panel, /<strong>Nothing is sent\.<\/strong>/);
  assert.match(panel, /never read from what they filled in/);
  /* Approving is the only thing that creates an employee. */
  assert.match(panel, /Approve — add to the staff list/);
});

/*
 * DOCUMENTS: checked, sent back, or nobody has looked.
 */
test('the record verifies a document in three states, not a tick box', () => {
  const record = src('components/EmployeeRecord.jsx');
  assert.match(record, /documents\/\$\{doc\.id\}\/verify/);
  /* Null is "nobody has checked", which is NOT rejected - the same shape as
     the roll call's Allowed? control. */
  assert.match(record, /verify\(doc, null\)/);
  assert.match(record, /What is wrong with it\?/);
  /*
   * AND IT IS DECLARED ABOVE THE EARLY RETURN. Put below it, `verify`
   * landed inside the `if (STANDALONE)` branch and the real render called a
   * function that was not in scope: every test passed and the control was
   * dead until somebody pressed it.
   */
  const verifyAt = record.indexOf('const verify = async');
  const standaloneAt = record.indexOf('if (STANDALONE) {', record.indexOf('export default function EmployeeRecord'));
  assert.ok(verifyAt > 0 && verifyAt < standaloneAt, 'verify is inside the standalone branch');
});

test('the joining form takes documents, and the register counts unchecked apart', () => {
  const join = src('components/JoinPage.jsx');
  assert.match(join, /uploadOpen/);
  /* Nothing is refused for want of a document: somebody joining tomorrow
     may not have a passbook photo today. */
  assert.match(join, /bring them on your first day/);

  const reg = src('components/DocumentRegister.jsx');
  assert.match(reg, /Not checked is not rejected/);
  assert.match(reg, /All four on file/);
  assert.match(reg, /All four checked/);
});

/*
 * CANCELLING AN APPROVED LEAVE — what the two screens promise.
 */
test('cancelling says the days are cleared, not marked present', () => {
  const queue = src('components/AttendanceRequests.jsx');
  /* The confirmation has to say this, because anybody pressing it will
     assume the opposite - that the day goes back to a day at work. */
  assert.match(queue, /left UNMARKED/);
  assert.match(queue, /Cancel it/);
  /* And the row keeps saying who cancelled it and why: the whole point of
     cancelling rather than deleting. */
  assert.match(queue, /cancelled by \{r\.cancelled_by\}/);
});

test('asking to cancel says plainly that nothing has changed yet', () => {
  const mine = src('components/MyPage.jsx');
  assert.match(mine, /Ask to cancel/);
  /* The same rule the whole queue runs on. A screen that said "cancelled"
     here would have somebody turn up to work on an approved day off. */
  assert.match(mine, /waiting for the office/);
  const calls = [...mine.matchAll(/api\.post\(`\/me\/requests\/[^`]*`/g)].map((m) => m[0]);
  assert.ok(
    calls.every((u) => u.includes('/cancel')),
    `the leave page posted to ${calls}`
  );
});

/*
 * THE LEAVE REGISTER — what a page of zeros has to say for itself.
 *
 * On the live server all 79 people read 0 due, 0 taken, 0 left, and the
 * screen said nothing about why. It was not broken: nobody had set an
 * entitlement. Three things came out of that.
 */
test('a register with no quota set anywhere explains itself', () => {
  const leave = src('components/Leave.jsx');
  /* It tells the office what is actually wrong, rather than showing 237
     zeros and letting them conclude the data is lost. */
  assert.match(leave, /No leave quota has been set for anybody yet/);
  assert.match(leave, /noQuotas/);
  /* And says the half that IS right, so nobody re-marks the grid. */
  assert.match(leave, /counted off the attendance grid and are right/);
});

test('"over their entitlement" is measured against an entitlement somebody SET', () => {
  const leave = src('components/Leave.jsx');
  const line = leave.split('\n').find((l) => l.includes('LEAVE_TYPES.filter((t) =>'));
  /* With every quota still nil, one day taken read as "over" - which is not
     an offence, it is an unset quota, and a register that flags the whole
     staff for it gets ignored. */
  assert.ok(line, 'the over() rule is still one line');
  assert.match(leave, /row\.quotas\[t\.code\] > 0 && row\.taken\[t\.code\] > row\.quotas\[t\.code\]/);
});

test('seventy-nine people can be given a quota without 237 boxes', () => {
  const leave = src('components/Leave.jsx');
  assert.match(leave, /setQuotasForAll/);
  /* It must not quietly flatten a quota somebody has already adjusted by
     hand - it says how many have one and offers to leave those alone. */
  assert.match(leave, /already have a quota set/);
  assert.match(leave, /only fill in the blanks/);
  /* ONE reload at the end, not one per person: reloading inside the loop
     would be seventy-nine round trips behind a spinner. The loop body is
     read out and checked on its own. */
  const start = leave.indexOf('for (const row of target) {');
  assert.ok(start > -1, 'the bulk loop is still there');
  const body = leave.slice(start, leave.indexOf('\n      }', start));
  assert.ok(!body.includes('load('), `load() is inside the loop: ${body}`);
  assert.match(leave.slice(start), /\n      \}\n      await load\(year\);/);
});

test('the leave register fills its width without a scrollbar inside a scrollbar', () => {
  const css = src('styles.css');
  /* `table.sheet` is deliberately width:auto so the Time tab's six columns
     do not stretch; this one table opts in, scoped by its own class. */
  assert.match(css, /table\.sheet\.leave-register \{ width: 100%; \}/);
  /* Every figure column needs its own width or the slack pools in one of
     them - widening the table alone gave Casual leave's Taken column the
     whole 688px. */
  assert.match(css, /leave-register thead tr:nth-child\(2\) th \{ width: [\d.]+%; \}/);
  /* And it is not boxed in its own 684px window inside a page that already
     scrolls. */
  assert.match(css, /\.table-wrap\.unboxed \{ max-height: none; overflow: visible; \}/);
  const leave = src('components/Leave.jsx');
  assert.match(leave, /table-wrap unboxed/);
  assert.match(leave, /sheet leave-register/);
});

/*
 * "MAKE ALL SCREEN PROPER" / "chekc all report also" — five screenshots of
 * the Leave tabs and two of a report, all with the content in a narrow
 * column and most of the screen empty. Measured at 1900px: thirteen reports
 * had a table between 552 and 937px inside a 1,364px panel.
 */
test('every report fills the reading area, and no other tab is touched', () => {
  const css = src('styles.css');
  /* Scoped to the report body so it reaches every report there is and every
     one added later. `table.sheet` stays width:auto everywhere else, or the
     Time tab's six columns stretch across a monitor. */
  assert.match(css, /\.report-body table\.sheet \{ width: 100%; \}/);
  assert.ok(
    /table\.sheet \{[^}]*width: auto;/.test(css),
    'the global sheet rule must still be width:auto'
  );
});

test('a settings panel narrows instead of stretching; a list of people widens', () => {
  const css = src('styles.css');
  /* Four rows of tick boxes stretched across a monitor is worse, not
     better. The card narrows to its content; a data table opts in. */
  assert.match(css, /\.card\.narrow \{ max-width: [\d.]+rem; \}/);
  assert.match(css, /table\.sheet\.wide \{ width: 100%; \}/);
  assert.match(css, /\.card-grid \{/);

  assert.match(src('components/LeaveYearEnd.jsx'), /className="card narrow"/);
  assert.match(src('components/WeeklyOff.jsx'), /className="card-grid"/);
  for (const file of ['LeaveBonus.jsx', 'SandwichLeave.jsx', 'LeaveYearEnd.jsx']) {
    assert.match(src(`components/${file}`), /className="sheet wide"/, file);
  }
});

test('THE FILTER BAR ACTUALLY FILTERS', () => {
  const reports = src('components/Reports.jsx');
  /* Salary deductions was shown with Company set to one company and all 86
     people still in it, on screen and in the print: nine panels took
     `payroll` whole and never looked at `filters`. Narrowed ONCE, rather
     than nine panels each growing their own idea of what a filter means. */
  assert.match(reports, /const shown = useMemo\(/);
  assert.match(reports, /String\(r\.company_id\) === String\(filters\.company_id\)/);
  assert.match(reports, /String\(r\.department \|\| ''\) === String\(filters\.department\)/);

  /* And every panel that takes a month takes the narrowed one. A panel
     still reading `payroll` would quietly ignore the bar again. */
  const body = reports.slice(reports.indexOf('const PANELS'), reports.indexOf('const FILES'));
  const stale = [...body.matchAll(/payroll=\{payroll\}/g)].length;
  assert.equal(stale, 0, 'a report panel is still handed the unfiltered month');
  assert.ok([...body.matchAll(/payroll=\{shown\}/g)].length >= 8);
});

test('the leave register column says what it actually shows', () => {
  /* It renders `department || company_name`, so "Company" was wrong on
     every row that has a department — nearly all of them on the live
     server. */
  assert.match(src('components/Leave.jsx'), /Company \/ department/);
});

test('the profile in the corner is a BUTTON, not something that looks like one', () => {
  const app = src('App.jsx');
  /* Dinesh: "profile pe clcik larne se kuch nahi aata". It was a <span> -
     round, in the corner where every app puts an account menu, and inert.
     The same lesson as the asset invoice and the candidate row, the other
     way round: a thing that reads as a control has to be one. */
  assert.match(app, /<button\s+className="who-face"/);
  assert.ok(!/<span className="who-face"/.test(app), 'the avatar is a span again');
  assert.match(app, /Change my password/);
  /* It also gave the office its first VOLUNTARY way to change a password -
     until now that screen only appeared when the server forced it. */
  assert.match(app, /changingPassword/);
});

test('the staff contact list is in the catalogue and reachable', () => {
  const reports = src('components/Reports.jsx');
  assert.match(reports, /'employee-contacts': \(\) => \(/);
  assert.match(reports, /<ContactList/);
  assert.ok(
    REPORTS.some((r) => r.id === 'employee-contacts' && r.status === 'ready'),
    'the contact list is not in the catalogue'
  );
});

test('FILLING BLANK DAYS AS PRESENT STOPS AT TODAY', () => {
  /*
   * Dinesh, looking at a Sunday: "ye aaj sunday sab ka present kese dikha
   * raha he" - 86 of 86 Present, and the trend at 100% through the 28th,
   * days that had not happened yet.
   *
   * Filling the rest of the month ahead of time makes the month read fully
   * attended, and a real absence next Tuesday lands on a day already marked
   * Present, where nobody looks again. On the monthly-hours rule it is worse
   * than cosmetic: a day marked P is a day that owes its nine hours.
   *
   * In a past month `todayDay` is 0 and the whole month fills, which is
   * right - a closed month is written up after the fact.
   */
  const code = src('components/Attendance.jsx')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  assert.match(
    code,
    /const fillableDays = useMemo\(\s*\(\) => \(todayDay \? dayList\.filter\(\(d\) => d <= todayDay\) : dayList\)/,
    'the blank-fill must be bounded by today, and unbounded in a month that is not this one',
  );

  // Both blank-fills must walk that list, not the whole month.
  const fillRow = code.slice(code.indexOf('const fillRow ='), code.indexOf('const fillRow =') + 500);
  assert.match(fillRow, /for \(const day of fillableDays\)/, 'the per-row fill still walks the whole month');

  const bulk = code.slice(code.indexOf('const markEveryonePresent ='));
  const body = bulk.slice(0, bulk.indexOf('queueSave'));
  assert.ok(!/for \(const day of dayList\)/.test(body), '"Mark everyone Present" still walks the whole month');
  assert.match(body, /for \(const day of fillableDays\)/);
  assert.match(body, /have not happened yet/, 'the confirmation must say what it is leaving alone');
});

test('A REQUIRED MARKER MUST NOT PUSH THE BOX ONTO ITS OWN LINE', () => {
  /*
   * `.form-grid label` is `display: flex; flex-direction: column`, so a bare
   * text node and a sibling <span> are TWO flex items and stack. The star
   * landed on its own line and the input dropped 38px below every other box
   * in the row - measured at 508 against 470, and 610 against 574.
   *
   * On screen that reads as THE FIELD BEING MISSING, because the box sits
   * under the next column's label. Dinesh reported it twice in one message:
   * "date of joining me entry ka option nahi he" and "mobile num kese add
   * karenge". Both were there, 38px down.
   */
  const jsx = src('components/EmployeeForm.jsx').replace(/\/\*[\s\S]*?\*\//g, '');
  const star = jsx.slice(jsx.indexOf('const label = ('), jsx.indexOf('const label = (') + 400);
  assert.match(star, /<span className="ef-text">/, 'the label text and its star must be one element');
  assert.ok(
    !/const label = \(\s*<>/.test(star),
    'a fragment makes the text and the star two flex items, which stacks them',
  );
});

test('the punch ID is on the joining form', async () => {
  /*
   * The readers hold a number and no names at all, so somebody with no punch
   * ID never appears in any punch however well the machines run. It could
   * only be set from the import or by editing the row - never while adding
   * the person, which is when somebody actually has the number in hand.
   */
  const { SECTIONS } = await import('../../shared/employeeMaster.js');
  const access = SECTIONS.find((s) => s.key === 'access');
  const field = access.fields.find(([f]) => f === 'device_code');
  assert.ok(field, 'device_code must be on the form');
  assert.equal(field[1], 'Punch ID');
  assert.match(field[3].hint, /punches reach nobody/);
});

test('A PANEL MAY NOT INVENT A FIGURE-STRIP CLASS', () => {
  /*
   * Third time for this exact shape. `.late-figures` in v1.82 had no CSS
   * behind it and the panel read "Short of their total1"; `.figs` in the
   * Punch ID report did the same and ran four figures into one sentence.
   * The established class is `.late-figs`, with the value in <b> and what it
   * is in <em>.
   */
  const css = fs.readFileSync(
    path.join(here, '../../frontend/src/styles.css'),
    'utf8',
  );
  for (const file of ['components/PunchIdReport.jsx', 'components/LatePolicy.jsx']) {
    const jsx = src(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    for (const cls of [...jsx.matchAll(/className="([a-z-]*fig[a-z-]*)"/g)].map((m) => m[1])) {
      assert.ok(
        css.includes(`.${cls}`),
        `${file} uses .${cls}, which has no rule in styles.css`,
      );
    }
  }
});

test('the Time tab judges a day by its MARK, not by the clock alone', () => {
  /*
   * `timesToDay` knows how long somebody was here. Only `minutesForMark`
   * knows what the day's mark does with that: a shortfall on a Sunday, on
   * leave or on a holiday is not charged, and a day under half is already
   * paid at half.
   *
   * Both halves matter. Reading it without the mark showed a Sunday docked
   * 219 minutes that the payslip took nothing for - a screen disagreeing
   * with the sheet. WRITING it without the mark was worse: typing a time
   * onto a Sunday stored that deduction, which the biometric import
   * deliberately refuses to store.
   */
  const tab = src('components/TimeSheet.jsx');
  assert.match(tab, /minutesForMark,/, 'it must import the one rule');
  assert.match(
    tab,
    /minutes:\s*\n?\s*worked\.worked === null[\s\S]{0,160}minutesForMark\(merged/,
    'the saved minutes must come from minutesForMark'
  );
  assert.doesNotMatch(tab, /minutes: worked\.minutes/, 'never straight off the clock');
  assert.match(tab, /minutes: minutesForMark\(entry/, 'and the figure on screen is the same one');
});

test('A STICKY HEADER CELL IS OPAQUE, or the table scrolls through it', () => {
  /*
   * Dinesh: *"DATE PE SCROLL KAR RAHE HE TO GLITCH AA RAAHE"*, with a grid
   * reading "P" and "+35" printed over Sun 1, Sun 8 and Sun 15.
   *
   * The Sunday and today tints are `color-mix(..., transparent)` - 92% and
   * 91% see-through. In the BODY that is right: the tint sits over the row's
   * own stripe and its hover rather than replacing them. In the STICKY
   * HEADER there is nothing behind it but the rows scrolling past, so they
   * showed straight through - and only ever in those two kinds of column,
   * because every other header cell was already opaque.
   *
   * Measured in a browser on one Sunday date cell across fourteen scroll
   * positions: 14 of 14 changed before, 0 of 14 after.
   */
  const css = src('styles.css');
  const headerTints = css.match(/table\.attendance thead th\.(sunday|today)[^{]*\{[^}]*\}/g) || [];
  assert.ok(headerTints.length >= 2, 'the header tints must be stated for the header, not inherited');
  for (const rule of headerTints) {
    assert.doesNotMatch(
      rule,
      /,\s*transparent\s*\)/,
      `a sticky header cell cannot be mixed into transparent:\n${rule}`
    );
    assert.match(rule, /var\(--line-soft\)/, 'it mixes into the header’s own background');
  }
});

test('A SUPPRESSED OUT TIME STILL SHOWS ITS PUNCH, on both screens', () => {
  /*
   * Dinesh: *"employee me bhi nahi dikh rahe"*, looking at his own portal.
   *
   * The rule was "more than two punches", on the reasoning that two punches
   * ARE the in and the out and printing them again is noise. v2.0.0 broke it:
   * a one-punch day and a day whose last punch is the return from lunch both
   * have their OUT TIME SUPPRESSED, because neither of those is a departure.
   * So the punch was on the record, the Out column read a dash, and nothing
   * on the page showed it.
   *
   * The rule lived in TWO components, which is how a rule comes to disagree
   * with itself. It is one function now and both must call it.
   */
  for (const file of ['components/MyPage.jsx', 'components/AttendanceStatement.jsx']) {
    const text = src(file);
    assert.match(text, /showPunches/, `${file} must use the one rule`);
    assert.match(text, /from '\.\.\/\.\.\/\.\.\/shared\/punchLog\.js'/, `${file} must import it`);
    assert.doesNotMatch(
      text,
      /\(punches\[d\.day\] \|\| \[\]\)\.length > 2/,
      `${file} must not keep its own copy of the old rule`
    );
  }
});

test('the portal says when NO reader can reach somebody', () => {
  /*
   * "Not matched" and "not seen" are different problems, and only one of them
   * is the employee's to raise. Somebody with no punch ID has never been
   * looked for at all, so an empty list would read to them as the machine
   * having missed them all month.
   */
  const page = src('components/MyPage.jsx');
  assert.match(page, /punch_match/, 'the portal must be told whether anything could match');
  assert.match(page, /no number for you yet/, 'and must say so in words');
});

test('a day marked HF with no departure can be put right, across the month', () => {
  /*
   * The importer used to decide the mark from a last punch that was really
   * the return from lunch, then refuse to write that punch as an out time -
   * so a day still running came out HF and docked half a day. That is fixed
   * where days are WRITTEN, and a fix to the write path never reaches back.
   *
   * Three things this pins, each one learnt the hard way:
   *  - it scans the whole month, not the view. This tab shows one day across
   *    everybody or one person down the month, and the spoilt days are
   *    scattered through both;
   *  - it writes ONLY the mark, so the per-field merge keeps the arrival,
   *    the lunch and the stored minutes;
   *  - it asks first, and says that it PAYS A FULL DAY, because that is what
   *    somebody pressing it is about to do.
   */
  const tab = src('components/TimeSheet.jsx');
  assert.match(tab, /halfDayNoOut/, 'the finder must exist');
  assert.match(tab, /for \(const row of filtered\)[\s\S]{0,120}for \(const d of dayList\)/,
    'it must sweep every visible person across every day of the month');
  assert.match(tab, /day: d, code: 'P'/, 'it writes the mark and nothing else');
  assert.doesNotMatch(
    tab,
    /halfDayNoOut\.map\([^)]*(in_time|out_time|minutes)/,
    'it must not resend the times - the merge keeps them'
  );
  assert.match(tab, /window\.confirm\(\s*\n?\s*`\$\{halfDayNoOut\.length\}/, 'it must ask first');
  assert.match(tab, /PAYS A FULL DAY/, 'and say what pressing it costs');
});

test('the day menu says where a day’s minutes came from, ABOVE the marks', () => {
  /*
   * Dinesh, hovering a cell reading "P / −50": *"yaha click karne se uske time
   * log bhi open ho esa ho sakta he, jisse −50 minute ka hisab mil sake"*. The
   * figure was on the grid and the sum behind it was two screens away.
   *
   * It goes ABOVE the fourteen mark buttons, because it is why somebody
   * clicked the cell — put below them it was at 922px in a card 1442 tall,
   * which is the "feature nobody can find" mistake again.
   *
   * And it ASSEMBLES: `readTimes` and `minutesForMark` are the same two
   * functions the Time tab, the server and the payslip use, so it can never
   * become a second opinion about the day.
   */
  const grid = src('components/Attendance.jsx');
  assert.match(grid, /picker-clock/, 'the block must exist');
  assert.match(grid, /readTimes\(entry, \{ deductLunch \}\)/, 'it reads the day with the month’s own lunch rule');
  assert.match(grid, /minutesForMark\(entry, \{/, 'and the minutes with the one rule');
  assert.match(grid, /typedOver/, 'a figure typed over the clock must say so');
  assert.ok(
    grid.indexOf('picker-clock') < grid.indexOf('<ul className="picker-list">'),
    'it must come before the mark list, not after it'
  );
});

test('the Time tab shows every punch too, and never calls a running day short', () => {
  /*
   * *"yaha pe bhi sare log dekhne ka option do"* and *"out time abhi bhi aa
   * raha he"*, both off the same screen.
   */
  const tab = src('components/TimeSheet.jsx');
  assert.match(tab, /showPunches\(entry, dayPunches\)/, 'the one rule decides whether to show them');
  assert.match(tab, /punchTimes\(dayPunches\)/, 'and the one formatter prints them');
  assert.match(tab, /dayNotFinished\(\{/, 'a day still running must be recognised');
  assert.match(tab, /still in/, 'and said in words, not reported as a missing out time');
  // One person down the month is one request; one day across eighty is eighty,
  // so that one is asked for.
  assert.match(tab, /view !== 'day' && person\?\.employee_id/, 'the month view loads itself');
  assert.match(tab, /onWantPunches/, 'the day view asks per person');
});

test('the in/out register fills the page and is allowed to scroll sideways', () => {
  /*
   * Dinesh: *"need all logs / all in out"*. Ten things per row, so it is the
   * one report allowed to be wider than the panel.
   *
   * `.report-body table.sheet { width: 100% }` squeezes every report into the
   * panel — right for a report with six columns. Here it clipped the OT column
   * off the right edge with NO way to scroll to it, and squashed a day's
   * punches into a column so narrow they stacked five lines tall. Measured at
   * 1280px: 810px table in a 660px frame, last cell 150px past the edge and
   * now reachable, row height 40px at every width.
   */
  const css = src('styles.css');
  assert.match(css, /\.report-body table\.sheet\.inout\s*\{[^}]*width:\s*auto/, 'it may exceed the panel');
  assert.match(css, /\.report-body table\.sheet\.inout\s*\{[^}]*min-width:\s*100%/, 'and still fill it');
  assert.match(
    css,
    /table\.sheet\.inout \.ts-lunch-len\.punches\s*\{[^}]*white-space:\s*nowrap/,
    'a day of punches stays on one line here, whatever the Time tab does'
  );

  const panel = src('components/InOutRegister.jsx');
  // The payroll arrives as { period, rows }; taking it as a list threw
  // "t is not iterable" on render.
  assert.match(panel, /payroll\?\.rows \|\| \[\]/, 'it must read .rows off the month');
  assert.match(panel, /payroll\?\.period \|\| \{\}/, 'and the period off the same object');
  assert.doesNotMatch(panel, /inOutRegister\(payroll/, 'never the object straight in');
});

test('a forgotten punch can be typed where it is noticed, and the minutes are RE-WORKED', () => {
  /*
   * HR, on the attendance grid: *"punch krna bhul jye aur add krna ho toh?"*
   * — and asked where the option was, *"na nhi hai"*. It existed on the Time
   * tab all along, which is a different tab from the one she was standing on.
   * Eleventh time for that shape.
   *
   * THE TRAP: `queueSave` sends `minutes` on every entry and `setAttendance`
   * leaves a caller's own minutes alone, so typing an out time while carrying
   * the old figure would save new hours beside a stale deduction — exactly
   * the bug the Time tab had in v2.0.0. Driven: 09:30 with no out and 0
   * minutes, typed 1730, stored as −60 rather than left at 0.
   */
  const grid = src('components/Attendance.jsx');
  assert.match(grid, /TIME_FIELDS\.some\(\(f\) => f in patch\)/, 'it must notice a time changing');
  assert.match(
    grid,
    /entry\.minutes = touchedTime && row\s*\n?\s*\? minutesForMark\(entry/,
    'and re-work the minutes with the one rule'
  );
  // The same box as the Time tab, so "930" and "6pm" are read identically.
  assert.match(grid, /import \{ TimeInput \} from '\.\/TimeSheet\.jsx'/);
  assert.match(grid, /<TimeInput/, 'the day menu must offer the four times');
  assert.match(src('components/TimeSheet.jsx'), /export function TimeInput/, 'and it must be shared, not copied');
});

test('the grid can show the day’s HOURS under each mark, and says that changes no pay', () => {
  /*
   * HR: *"sir iske place pe total hours hi rakho na ismai jiska minus hai
   * uska kam ho raha hai salary jiska + hai uska salry jyada ho raha hai"*.
   *
   * Her reason is not right on this month's rule — `calc.js` charges the
   * MONTH's hours total on monthly/monthly_late and the daily minutes are not
   * charged individually — but the request is, because the hours are what the
   * month is judged on and a column of ±119s reads as a column of deductions.
   * So it is a VIEW, and the strip says so in words.
   */
  const grid = src('components/Attendance.jsx');
  assert.match(grid, /under === 'hours' && worked !== null/, 'hours where the clock knows them');
  assert.match(grid, /neither changes the pay/, 'and it must say so, because that was the worry');
  // A day with minutes typed on it and no clock times must still show them,
  // or a real deduction would be hidden by the new view.
  assert.match(grid, /under !== 'off' && entry\.minutes !== 0/);
  assert.match(grid, /readTimes\(entry, \{ deductLunch: !period\.lunch_paid \}\)/, 'the month’s own lunch rule');

  // Sixth time for the invented-class trap, so both are checked.
  const css = src('styles.css');
  assert.match(css, /\.mark-minutes\.hours\s*\{/, '.mark-minutes.hours needs a rule');
  assert.match(css, /\.under-pick\s*\{/, '.under-pick needs a rule');
});

/*
 * "naam wala column wala fix kar do" — the attendance grid's name column was
 * pinned at 10rem and his names do not fit it. AJEETKUMAR UPDHYAY read as
 * "AJEETKUMAR UPDHYAY." and ALIFAYA CHIKHALIWALA as "ALIFAYA CHIKHALIWALA.",
 * because the `td`'s own ellipsis was drawn PAST its right border and over
 * the code beside it. A full stop after a surname reads as a typo in
 * somebody's name, not as a column that is too narrow.
 */
test('the name column and the code column are driven by one figure', () => {
  const css = src('styles.css');
  /* The code freezes at exactly the name column's width. Two hand-written
     `10rem`s is how a gap or an overlap appears the first time one of them
     is changed; one variable cannot drift from itself. */
  assert.match(css, /table\.attendance \{ --name-col: [\d.]+rem; \}/);
  assert.match(css, /table\.attendance \.sticky-code \{[^}]*left: var\(--name-col\);/);
  assert.match(
    css,
    /table\.attendance \.sticky-name \{ min-width: var\(--name-col\); max-width: var\(--name-col\); \}/
  );
  /* Neither may go back to a literal figure. */
  const codeRule = css.slice(css.indexOf('table.attendance .sticky-code {'));
  assert.ok(
    !/left: [\d.]+rem/.test(codeRule.slice(0, codeRule.indexOf('}'))),
    'the code column must not freeze at a hand-written offset again'
  );
});

test('a name too long for the column is cut off inside the cell', () => {
  const css = src('styles.css');
  /* Widening alone only moves the problem to the next longer name, so the
     ellipsis sits on the link itself, inside the cell that clips it. */
  const rule = css.match(/table\.attendance td\.sticky-name \.name-link \{[^}]*\}/);
  assert.ok(rule, 'the name link needs its own ellipsis rule');
  assert.match(rule[0], /overflow: hidden/);
  assert.match(rule[0], /text-overflow: ellipsis/);
  assert.match(rule[0], /max-width: 100%/);
  /* An inline element cannot be given a max-width. */
  assert.match(rule[0], /display: inline-block/);
});


/*
 * "yaha pe name pe click kare to pure month ka in out report dikhe wese karo"
 *
 * The view already existed - "One person, whole month" is the toggle at the
 * top of the Time tab - but reaching it meant scrolling back up and finding
 * the name in a select of eighty-five. THIRTEENTH time for that shape: a
 * feature reachable only from a control that does not look like one.
 */
test('a name on the Time tab opens that person\u2019s whole month', () => {
  const tab = src('components/TimeSheet.jsx');
  /* One handler, setting the SAME two pieces of state the toggle and the
     select above set - not a third way of saying who is on screen. */
  assert.match(tab, /const openPerson = \(id\) => \{[\s\S]{0,120}setPersonId\(id\);[\s\S]{0,60}setView\('month'\);/);
  /* Only in the day view: in the month view that cell is a DATE, and a date
     that opened somebody's month would be nonsense. */
  assert.match(tab, /onOpenPerson=\{view === 'day' \? \(\) => openPerson\(line\.row\.employee_id\) : null\}/);
  /* And it has to LOOK like a way in, which is the whole point. */
  const cell = tab.slice(tab.indexOf('{onOpenPerson ? ('));
  const upTo = cell.slice(0, cell.indexOf('</td>'));
  assert.match(upTo, /<button/);
  assert.match(upTo, /className="link"/);
  assert.match(upTo, /onClick=\{onOpenPerson\}/);
});


/*
 * "date bhi header me daal do" — after he compared a row off the Time tab
 * with a row off the attendance grid and asked how one person had two
 * different out times. They were two different days, and the date picker had
 * scrolled off the top of the screen.
 *
 * `table.sheet thead th` is sticky, so the header is the one place the day
 * cannot scroll away from the rows it labels.
 */
test('the Time tab header says which day, and whose month', () => {
  const tab = src('components/TimeSheet.jsx');
  const start = tab.indexOf('<th className="sticky-name">');
  assert.ok(start > -1, 'the header cell is there');
  const cell = tab.slice(start, tab.indexOf('</th>', start));
  /* The day view names the DATE... */
  assert.match(cell, /weekday\(period\.year, period\.month, day\)/);
  assert.match(cell, /MONTHS\[period\.month - 1\]/);
  /* ...and the month view names the PERSON, because there the first column
     IS the day and repeating it would say nothing. */
  assert.match(cell, /person\?\.employee_name/);
  /* It must be the established sub-line class, not an invented one - the
     trap this file has caught six times. */
  assert.match(cell, /className="hint"/);
  assert.match(src('styles.css'), /\.hint \{/);
  /* And the header has to actually stick, or putting the date there buys
     nothing the picker above did not already. */
  assert.match(src('styles.css'), /table\.sheet thead th \{[^}]*position: sticky;/);
});

test('THE TIME TAB’S RULE PANELS ARE ONE LINE UNTIL SOMEBODY OPENS THEM', () => {
  /*
   * Dinesh, pointing at the top of that tab: *"ye part bahut space kha raha
   * he"*. Measured at 1420x1200: the two cards were 156px and 146px and the
   * table did not start until 681px of a 1,200px window. After: 52px each
   * and the table at 414px.
   *
   * THE LINE THIS MUST NOT CROSS is hiding a figure. What folds away is the
   * explaining sentence and the person-by-person list; the figures stay on
   * the closed row, so nothing readable before is behind a click now.
   */
  const css = src('styles.css');
  for (const panel of ['components/LatePolicy.jsx', 'components/MonthlyHours.jsx']) {
    const jsx = src(panel);
    assert.match(jsx, /late-card\$\{open \? ' open' : ''\}/, `${panel} marks its open state`);
    assert.match(jsx, /className="muted small late-why"/, `${panel} names the folding sentence`);
    /* The figures are NOT inside the fold. */
    const why = jsx.indexOf('late-why');
    const figs = jsx.indexOf('className="late-figs"');
    assert.ok(figs > 0 && why > 0 && why < figs, `${panel} keeps the figures out of the fold`);
  }
  assert.match(css, /\.late-card \.late-why,\n\.late-card \.late-detail \{ display: none; \}/);
  assert.match(css, /\.late-card\.open \.late-why \{ display: block/);
  /* The figures must never be given `display: none` by the fold. */
  assert.ok(
    !/\.late-card[^{]*\.late-figs[^{]*\{[^}]*display:\s*none/.test(css),
    'the figures are never hidden'
  );
});

test('THE MARK LEGEND IS FOLDED, BUT ITS KEY IS STILL READABLE CLOSED', () => {
  /*
   * Dinesh: *"attendance tab me bhi same karo"*. Measured at 1420x1200: the
   * legend card was 454px - bigger than the grid above it - so reaching
   * Sunday working and Paid holidays meant scrolling past half a screen of
   * explanation every time. Closed it is 91px.
   *
   * THE LINE THIS MUST NOT CROSS: the key cannot go into the fold. The
   * summary spells out every mark, and it is BUILT FROM `codes` - the same
   * object the list inside is built from - so a mark added later cannot
   * appear in one and not the other.
   */
  const jsx = src('components/Attendance.jsx');
  const css = src('styles.css');
  assert.match(jsx, /<details className="card fold legend-fold">/);
  assert.match(jsx, /className="muted small legend-key"/);
  assert.match(
    jsx,
    /Object\.entries\(codes\)\.map\(\(\[code, meta\]\) => `\$\{code\} \$\{String\(meta\.label\)\.toLowerCase\(\)\}`\)/,
    'the key is derived from `codes`, never typed out a second time'
  );
  /* The summary must come before the list, or the key is inside the fold. */
  assert.ok(
    jsx.indexOf('legend-key') < jsx.indexOf('<div className="legend">'),
    'the key sits on the summary, not inside the fold'
  );
  assert.match(css, /\.legend-key \{ display: inline;/);
  assert.match(css, /\.legend-fold \.legend \{ margin-top:/);
});

test('THE MISSING PUNCH REPORT CAN OPEN THE DAY IT FOUND', () => {
  /*
   * Dinesh: *"kisi ka punch missing he to manually kaise log hoga"*. The
   * report named the person and the day and then left you to remember both,
   * switch tab, find them in a list of eighty-five and count down to the
   * date - FOURTEENTH time for that shape in this app.
   *
   * THE LINE IT MUST NOT CROSS: the report does not write. One screen owns
   * typing a clock time, because a second one would be a second answer to
   * how the day's minutes are worked out - which is the v2.0.0 bug that
   * saved a wrong deduction.
   */
  const report = src('components/MissingPunch.jsx');
  const app = src('App.jsx');
  const tab = src('components/TimeSheet.jsx');

  assert.match(report, /onGo\('time', \{ employee_id: l\.employee_id, day: l\.day \}\)/);
  assert.match(report, /className="link name-link"/);
  /* It reads; it does not save. */
  const code = report.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/onSave/.test(code), 'the report must not write attendance');
  assert.ok(!/minutesForMark/.test(code), 'nor work out a day of its own');

  assert.match(app, /openAt=\{timeAt\}/);
  assert.match(app, /if \(what && typeof what === 'object'\) setTimeAt\(what\)/);
  /* Clearing it matters: an ordinary visit to the tab must not jump. */
  assert.match(app, /onOpened=\{\(\) => setTimeAt\(null\)\}/);
  assert.match(tab, /openPerson\(openAt\.employee_id\)/);
  assert.match(tab, /onOpened\?\.\(\)/);
});

test('THE SALARY SHEET’S CHROME IS CUT WITHOUT LOSING A FIGURE', () => {
  /*
   * Dinesh: *"salary sheet tab me bhi space kam karo"*. Measured at
   * 1420x1200: six KPI cards 107px, the workflow card 137px, the exception
   * card 117px FOLDED, and `table.sheet` did not start until 667px of a
   * 1,200px window. After: 61 / 52 / 73 and the table at 489px.
   *
   * THE LINE: nothing may be hidden. What went is the box around each
   * figure, four stage captions describing what has already happened, and a
   * sentence that repeated the pills above it.
   */
  const css = src('styles.css');
  const sheet = src('components/SalarySheet.jsx');
  const wf = src('components/salary/PayrollWorkflow.jsx');
  const pex = src('components/salary/PayrollExceptions.jsx');

  /* All six figures are still rendered. */
  assert.equal((sheet.match(/className=\{?["`]kpi /g) || []).length + (sheet.match(/className="kpi"/g) || []).length, 6);
  /* ...and the stylesheet never hides one. */
  assert.ok(
    !/\.kpi[^-{][^{]*\{[^}]*display:\s*none/.test(css),
    'a KPI figure is never hidden'
  );

  /* The workflow folds, and the DOTS stay - where the month has got to is
     still visible at a glance - while the four finished captions go. */
  assert.match(wf, /card wf-card\$\{steps \? ' open' : ''\}/);
  assert.match(wf, /All \$\{workflow\.stages\.length\} steps/);
  assert.match(css, /\.wf-card:not\(\.open\) \.wf-step:not\(\.at\) \.wf-label,\n\.wf-card:not\(\.open\) \.wf-step:not\(\.at\) \.wf-why \{ display: none; \}/);
  assert.ok(
    !/\.wf-card:not\(\.open\)[^{]*\.wf-dot[^{]*\{[^}]*display:\s*none/.test(css),
    'the stage dots are never hidden'
  );
  /* The action button is outside the fold entirely. */
  assert.ok(
    !/\.wf-card:not\(\.open\)[^{]*\.wf-actions[^{]*\{[^}]*display:\s*none/.test(css),
    'the approve button never folds away'
  );

  /* The exception card's folded sentence repeated the pills beside it. */
  assert.match(pex, /\{folded \? null : \(/);
  assert.ok(
    !/\$\{summary\.open\} open — \$\{summary\.critical\} critical/.test(pex),
    'the sentence that repeated the pills is gone'
  );
  /* The total it carried moved into the heading, so it is not lost. */
  assert.match(pex, /Things to check\{summary\?\.open \? ` \(\$\{summary\.open\}\)` : ''\}/);
});

test('THE DASHBOARD OPENS ON THE ROLL CALL, NOT BELOW IT', () => {
  /*
   * Dinesh: *"dashboard tab me bhi space kam karo"*. Measured at 1420x1200:
   * six tiles 265px in two rows of three, the charts row 381px (set by Quick
   * stats, six rows at 49px), and the ROLL CALL - the thing this page was
   * deliberately made to open on - started at 807px, below the fold. After:
   * 134 / 295, roll call at 588px.
   *
   * TWO BUGS THE BROWSER FOUND, both in my own first attempt:
   *  - laying the tile out as a ROW let `.kpi-head`'s `width: 100%` take the
   *    whole tile and print the value over the tile beside it;
   *  - `align-items: flex-start` on the column sized `.kpi-body` to its own
   *    content, so a long caption ran 70px past the tile with the ellipsis
   *    never coming into play. The tiles never overlapped, so only a
   *    per-child measurement found it.
   */
  const css = src('styles.css');
  /* Six across only where they fit, and the measured phone rules still win. */
  assert.match(css, /@media \(min-width: 1200px\) \{ \.dash \.kpi-band \{ grid-template-columns: repeat\(6/);
  assert.match(css, /@media \(min-width: 861px\) and \(max-width: 1199px\)/);
  /* The tile is a column; a row layout is what broke it. */
  assert.ok(
    !/\.dash \.kpi \{[^}]*flex-direction:\s*row/.test(css),
    'the dashboard tile must stay a column'
  );
  assert.match(css, /\.dash \.kpi \{[^}]*align-items: stretch/);
  /* The caption wraps rather than being cut: an ellipsis at 185px would eat
     the figure it carries. */
  assert.match(css, /\.dash \.kpi-caption \{[\s\S]*?white-space: normal/);
  /* Nothing on the band is hidden. */
  assert.ok(
    !/\.dash \.kpi[-a-z]*\s*\{[^}]*display:\s*none/.test(css),
    'no tile or part of one is hidden'
  );
});

test('THE STAFF PORTAL’S CALENDAR ASSEMBLES, LIKE THE OFFICE ONE', () => {
  /*
   * Dinesh: *"employe login me bhi calander wala oprtion do"*.
   *
   * It draws from `statement.days` - the SAME array the list beside it is
   * drawn from, which the server built from the row the payslip is printed
   * from. No second reading of the clock, so the list, the calendar and the
   * payslip cannot give three answers about a day.
   */
  const portal = src('components/MyPage.jsx');
  const code = portal.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  assert.match(portal, /function MyCalendar\(/);
  assert.match(portal, /monthWeeks\(\{ year: period\.year, month: period\.month, cells: all \}\)/);
  /* The toggle, and it is remembered. */
  assert.match(code, /localStorage\.getItem\('my-att-shape'\)/);
  assert.match(code, /localStorage\.setItem\('my-att-shape', next\)/);
  /* A private window throws on even touching localStorage. */
  assert.match(portal, /catch \{ \/\* a private window throws \*\/ \}/);

  /* It never recalculates: no clock reading of its own anywhere in the file. */
  assert.ok(!/timesToDay\(/.test(code), 'the portal must not read the clock itself');
  assert.ok(!/minutesForMark\(/.test(code), 'nor judge a mark itself');

  /* Not known is a dash, never nought hours - in the square and in the day. */
  assert.match(portal, /d\.worked_minutes !== null && \(d\.in_time \|\| d\.out_time\)/);
  assert.match(portal, /chosen\.worked_minutes === null \? '—' :/);

  /* The day's detail is ABOVE the grid - the measured lesson from the office
     calendar, where below it the answer landed under the fold. */
  assert.ok(
    portal.indexOf('{chosen ? (') < portal.indexOf('<div className="lc-grid tc-grid">'),
    'the detail comes before the grid'
  );

  /* Same layout module and same classes as the office calendar, so the two
     read alike rather than being two ideas of what a calendar looks like. */
  assert.match(portal, /from '\.\.\/\.\.\/\.\.\/shared\/monthGrid\.js'/);
});

test('A PUNCH THAT CANNOT FIND A LOCATION SAYS WHY, NOT JUST "ALLOW IT"', () => {
  /*
   * Dinesh: *"Punching error"*. The server has ONE message for a missing
   * location — *"Allow location access and try again."* — and it is right
   * when somebody tapped Block.
   *
   * IT IS ADVICE NOBODY CAN FOLLOW over plain http: a browser does not offer
   * the location API on an insecure origin at all, so there is nothing to
   * allow and the punch can never work. Somebody would tap it all morning.
   * Only the phone knows which of the four it was, so the phone says.
   *
   * Proved from a real LAN address (http://192.0.2.2:4387), not reasoned
   * about: the page now names the http problem instead of the server's line.
   *
   * THIS TEST USED TO READ PunchPage.jsx, and it was rewritten rather than
   * repointed when the portal grew a punch button of its own: the rule is no
   * longer "the link page explains itself", it is the stronger one below.
   */
  const shared = src('components/PunchNow.jsx');
  assert.match(shared, /window\.isSecureContext === false/);
  assert.match(shared, /only give a location over https/);
  /* The three browser reasons, told apart. */
  assert.match(shared, /err\.code === 1/);
  assert.match(shared, /err\.code === 3/);
  /* The server still decides; the phone only explains a location refusal. */
  assert.match(shared, /problem && \/location\/i\.test\(message\)/);
  /* And the point still travels under its own names, or the fence is blind. */
  assert.match(shared, /\.\.\.\(found\.point \|\| \{\}\)/);
});

test('ONE LOCATION HELPER, because two would become two sets of advice', () => {
  /*
   * Two screens can punch now — the personal link and the staff portal — and
   * the four reasons above were a real bug fixed in ONE of them. A copy in
   * the other is how the fix comes to exist in one place and not the other,
   * which is worse than never having made it: both screens would LOOK right.
   *
   * So `navigator.geolocation` is asked for in exactly one file in the whole
   * frontend, and the screens that punch go through it.
   */
  const dir = path.join(here, '../../frontend/src');
  const asks = [];
  const walk = (at) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.jsx?$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes('navigator.geolocation')) {
        asks.push(path.relative(dir, full));
      }
    }
  };
  walk(dir);
  /*
   * One exception, and it is not a punch: the office setting an office's own
   * coordinates with "Use where I am". It fills a form box and has no advice
   * to give, so it owes nothing to the rule above - but it is NAMED here, so
   * that a third caller has to be thought about rather than slipping in.
   */
  assert.deepEqual(
    asks.sort(),
    ['components/AttendanceRequests.jsx', 'components/PunchNow.jsx'],
    `a screen asks for a location on its own: ${asks}`
  );

  /* Neither screen that punches has one of its own. */
  for (const file of ['components/PunchPage.jsx', 'components/my/MyDashboard.jsx']) {
    assert.ok(
      !src(file).includes('navigator.geolocation'),
      `${file} asks for a location itself instead of going through PunchNow`
    );
  }

  for (const file of ['components/PunchPage.jsx', 'components/my/MyDashboard.jsx']) {
    assert.match(src(file), /PunchNow/, `${file} does not use the shared punch button`);
  }
});

test('the shared punch block carries its own look, wherever it is put', () => {
  /*
   * `.jobs` and `.note` only ever had rules under `.public` — the link page's
   * own wrapper. On the portal there is no such ancestor, so the punches
   * would have rendered as a default bulleted list and the caption at full
   * body size. Caught before it shipped by reading the rules rather than the
   * screen; it is the invented-class trap with the ancestor moved.
   */
  const css = src('styles.css');
  for (const rule of ['.punch-now .jobs', '.punch-now .note', '.my-punch']) {
    assert.ok(css.includes(rule), `${rule} has no rule in styles.css`);
  }
});

test('THE PUNCH BUTTON IS FIRST ON THE PORTAL, above the day it reports on', () => {
  /*
   * Dinesh, looking at his own staff dashboard: *"punch in wala kaha he"*.
   * It is what somebody opens the portal at half past nine to DO; everything
   * below it is a report on a day already worked. Below the fold it would be
   * the fifteenth feature that exists and cannot be found.
   */
  const dash = src('components/my/MyDashboard.jsx');
  assert.ok(
    dash.indexOf('<MyPunch') < dash.indexOf('className="my-cards"'),
    'the punch button sits below the cards it should be above'
  );
  /* And it posts to the door where the LOGIN says who is punching. */
  assert.match(dash, /api\.post\('\/me\/punch'/);
});

test('THE PUNCH PANELS NAME ALL THREE FEEDS, not just the readers', () => {
  /*
   * Both of these were written when there was one feed, and both still said
   * so after phone punches joined them: the log was headed *"every punch the
   * readers recorded"* and the totals counted *"people the readers saw"*,
   * on screens that were plainly showing punches from somebody's own login.
   *
   * Twice in one release is a drift worth pinning rather than re-reading.
   * Comments are stripped first, so an explanation of the old wording cannot
   * pass for the wording itself.
   */
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  for (const file of ['components/PunchLog.jsx', 'components/PunchTotals.jsx']) {
    const body = strip(src(file));
    assert.match(body, /own login or punch link/, `${file} does not mention the phone feed`);
    assert.match(body, /Bizcompass/, `${file} does not mention the spool`);
    assert.ok(
      !/every punch the readers recorded/i.test(body),
      `${file} still calls the log the readers' own record`
    );
    assert.ok(
      !/people the readers saw/i.test(body),
      `${file} still counts only what the readers saw`
    );
  }
});

test('a person with no Punch ID can still be picked in the punch log', () => {
  /*
   * The picker filtered to people a reader could match, which was right
   * while that was the only way a punch could arrive. Their punches were on
   * the screen and could not be narrowed to.
   */
  const body = src('components/PunchLog.jsx').replace(/\/\*[\s\S]*?\*\//g, '');
  const pickable = body.slice(body.indexOf('const pickable'), body.indexOf('if (STANDALONE)'));
  assert.ok(!/device_code/.test(pickable), 'the picker still excludes people with no Punch ID');
});

test('EVERY QUICK STATS ROW OPENS ITS OWN LIST, not another tab', () => {
  /*
   * Dinesh: *"ye open karne se hali inki list mile esa karo"*. The rows used
   * to call onGo('time') / onGo('attendance') — which leaves the dashboard
   * for a tab with no filter on it, where the people behind the figure are
   * not shown at all. A figure with a chevron on it has to lead to its names.
   *
   * The roll call below already has a chip per list, so the rows set that
   * chip rather than growing a second idea of what "the late list" is.
   */
  const dash = src('components/Dashboard.jsx');
  /* `.roll-call` also appears far ABOVE this card, inside openRoll's own
     querySelector, so the end of the slice is searched from the start of the
     card rather than from the start of the file. */
  const from = dash.indexOf('Quick stats');
  const card = dash.slice(from, dash.indexOf('card roll-call', from));
  assert.match(card, /onClick=\{\(\) => openRoll\(key\)\}/, 'the rows do not open the roll call');
  assert.ok(!/onGo\(to\)/.test(card), 'a Quick stats row still jumps to another tab');

  /* Every key it names must be a real bucket, or the chip silently matches
     nobody and the table goes empty — worse than the old jump. */
  const buckets = dash.slice(dash.indexOf('const buckets'), dash.indexOf('const atWorkRows'));
  for (const key of ['late', 'early', 'halfDay', 'overtime', 'short', 'uniform']) {
    assert.match(card, new RegExp(`'${key}'\\]`), `Quick stats does not offer ${key}`);
    assert.match(buckets, new RegExp(`\\['${key}',`), `${key} is not a roll call chip`);
  }
});

test('OVERTIME IS A LIST, not only a number', () => {
  /*
   * `roll.overtime` was counted from the day this page was built and put on
   * no list at all, so the card could say "Overtime 3" with nowhere saying
   * WHICH three — the one figure on it with nothing behind it.
   */
  const dash = src('components/Dashboard.jsx');
  assert.match(dash, /for \(const p of roll\.overtime\) \{/, 'overtime people reach no list');
  assert.match(dash, /'overtime'\);/, 'overtime rows carry no bucket key');
});

test('the roll call footnote does not state one office day for everybody', () => {
  /*
   * It read *"early before 18:30"* flat, on a screen listing somebody judged
   * against their own 23:00 — which is exactly what made a shift look as if
   * it did nothing. It counts them and says so, and only when there are any.
   */
  const dash = src('components/Dashboard.jsx');
  assert.match(dash, /out\.ownShift\+\+/, 'nothing counts the people on their own shift');
  assert.match(dash, /judged against their own shift instead/, 'the footnote never mentions them');
});

test('AN ABSENCE IS NEVER A UNIFORM FAILURE, even with a verdict stored on the day', () => {
  /*
   * Checked by hand first: somebody marked `A` with `uniform: false` really
   * sitting on their attendance row — which the grid will store, because the
   * two columns are independent and a verdict typed before an absence came in
   * stays there. The roll call read "Out of uniform 1" (the one person who was
   * actually at work) and "check the 2 at work", leaving the absent one out of
   * both the list and the denominator.
   *
   * That rests entirely on the push being guarded by WORKED_MARKS rather than
   * by `person.uniform === false` alone, so the guard is what is pinned. Without
   * it an absence reads as a uniform offence, and the morning's walk could never
   * be finished — nobody can inspect somebody who was not there.
   */
  const dash = src('components/Dashboard.jsx');
  const guard = dash.match(/if \(code && WORKED_MARKS\.has\(code\)\) \{([\s\S]{0,400}?)\n        \}/);
  assert.ok(guard, 'the uniform lists are no longer behind the at-work guard');
  assert.match(guard[1], /outOfUniform\.push/, 'out of uniform is counted outside the guard');
  assert.match(guard[1], /uniformChecked\+\+/, 'the denominator is counted outside the guard');

  /* And the marks that mean "not at work" are not in the set. */
  const set = dash.match(/const WORKED_MARKS = new Set\(\[([^\]]*)\]\)/);
  for (const code of ["'A'", "'UL'", "'AD'", "'CL'", "'SL'", "'PL'"]) {
    assert.ok(!set[1].includes(code), `${code} would be asked about its uniform`);
  }
});
