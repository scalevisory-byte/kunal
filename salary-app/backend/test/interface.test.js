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
  assert.match(a, /<AssetMasters onError=\{onError\} onChanged=\{setMasters\} \/>/);
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
  // The status half is already a chip, so only the four dropdowns are kept -
  // applying both would narrow twice.
  assert.match(a, /const \{ company_id, branch_id, category, year \} = from \|\| \{\};/);
  // ...and the register SAYS it is narrowed, with the way out. A register
  // silently showing a subset is how somebody concludes a row has gone.
  assert.match(a, /Narrowed to/);
  assert.match(a, /Show everything/);
});
