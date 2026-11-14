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
  assert.match(d, /out\.people = rows\.length;/);

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
  assert.match(d, /const PER_PAGE = 10;/);
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
  assert.match(tab, /const usual = timesToDay\(standard, \{ hoursPerDay: period\.hours_per_day \}\)/);
  assert.match(tab, /SHORT of the/);
  assert.match(tab, /every day filled is docked/);
  assert.match(tab, /OVER the/);
  assert.match(tab, /usual\.minutes < 0 \? 'small warn-text'/);

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

  // And what is deliberately NOT a setting is listed, so nobody hunts for it.
  assert.match(settings, /What is deliberately not a setting/);
  for (const why of ['26 working days', 'half-day line', 'Sunday pay', 'Weekly off']) {
    assert.ok(settings.includes(why), `${why} is not explained`);
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
