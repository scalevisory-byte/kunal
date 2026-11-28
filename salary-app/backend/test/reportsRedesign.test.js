/**
 * The Reports page redesign (v2.43.0).
 *
 * A searchable sidebar of categories, a grid of report cards with favourites
 * and recently used, and the report itself unchanged behind a breadcrumb.
 * What these tests hold it to:
 *
 *   - every report has a line on its card, and no line names a report that
 *     does not exist;
 *   - an unfinished report is MARKED, never dressed as ready;
 *   - favourites and recent are a desk's conveniences, wrapped so a private
 *     window cannot take the page down;
 *   - the ways in from other tabs (approvals, documents, import) still land.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ABOUT, CATEGORIES, REPORTS, aboutOf } from '../../shared/reportCatalog.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, '..', '..', rel), 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
const jsx = strip(read('frontend/src/components/Reports.jsx'));

test('every report has its own line, and no line is for a report that does not exist', () => {
  for (const r of REPORTS) {
    assert.ok(ABOUT[r.id] || r.note, `${r.id} has no line on its card`);
    const hint = CATEGORIES.find((c) => c.key === r.category).hint;
    assert.notEqual(aboutOf(r), hint, `${r.id} would read as its category's hint`);
  }
  for (const id of Object.keys(ABOUT)) assert.ok(REPORTS.some((r) => r.id === id), `ABOUT names ${id}, which is not a report`);
});

test('an unfinished report is marked on its card, never shown as ready', () => {
  assert.match(jsx, /report\.status !== 'ready' \?/);
  assert.match(jsx, /STATUS\[report\.status\]\.label/);
  assert.match(jsx, /className=\{`rp-card s-\$\{report\.status\}`\}/);
});

test('favourites and recently used never touch storage outside a try', () => {
  const reads = [...jsx.matchAll(/localStorage\.(getItem|setItem)/g)].length;
  assert.equal(reads, 2, 'one read and one write, both in the wrapped helpers');
  const helpers = jsx.slice(jsx.indexOf('const readList'), jsx.indexOf('export default function Reports'));
  assert.equal((helpers.match(/try \{/g) || []).length, 2);
  // The star is a real toggle a screen reader can hear.
  assert.match(jsx, /className=\{`rp-star\$\{fav \? ' on' : ''\}`\}[\s\S]{0,80}aria-pressed=\{fav\}/);
});

test('search reads a card’s line only from the start of a word', () => {
  assert.match(jsx, /new RegExp\(`\\\\b\$\{hunt/);
  // "late" must not find a report because its line says "calculated".
  const re = new RegExp('\\blate', 'i');
  assert.equal(re.test('OT minutes and OT pay are calculated.'), false);
  assert.equal(re.test('Same panel as late coming.'), true);
});

test('the ways in from other tabs still open their report', () => {
  assert.match(jsx, /setOpenId\('attendance-approvals'\)/);
  assert.match(jsx, /setOpenId\('employee-documents'\)/);
  assert.match(jsx, /focus !== 'import'/);
  // and an open report has a way back to the list
  assert.match(jsx, /onClick=\{backToList\}/);
});

test('the landing does not offer a date range that would do nothing', () => {
  const landing = jsx.slice(jsx.indexOf('Reports at your fingertips'), jsx.indexOf('rp-crumbs'));
  assert.ok(!/type="date"/.test(landing), 'ranges live in each report’s own filter bar');
  assert.match(landing, /dates, wherever that\s+report takes them/);
});

test('every rp- class has a rule in styles.css', () => {
  const css = read('frontend/src/styles.css');
  const used = new Set([...jsx.matchAll(/\brp-[a-z-]+/g)].map((m) => m[0]));
  for (const cls of used) assert.ok(css.includes(`.${cls}`), `.${cls} has no rule`);
});
