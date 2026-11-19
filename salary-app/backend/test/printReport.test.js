/**
 * THE PRINTED REPORT — built, not a screenshot of the screen.
 *
 * Dinesh, after the print pass that cleared the sidebar and the pickers off
 * the paper: *"PURA SCREEN PRINT NAHI KARNA HE, REPORT PRINT KARNA HOTA
 * HE"*. Hiding furniture with CSS still leaves the working screen with its
 * bits taken off. This builds a document instead.
 *
 * What these pin — the two things that can be quietly wrong on a page
 * nobody checks against the screen it came from:
 *
 *  - **Every value is escaped.** It builds HTML, and `O'Brien & Sons <Pvt>`
 *    is an ordinary company name.
 *  - **The totals label runs across the columns before the first total.**
 *    In the first cell alone it landed in the `#` column, three per cent
 *    wide, and "Total (8)" printed as "Tota / l (8)".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { col, num, reportHtml } from '../../frontend/src/printReport.js';

const doc = (over = {}) =>
  reportHtml({
    title: 'Asset register',
    columns: [col('#', (_r, i) => i + 1), col('Asset', (r) => r.label), num('Cost', (r) => r.cost)],
    rows: [{ label: 'Laptop', cost: '54,000' }],
    printedOn: '19 November 2026',
    ...over,
  });

test('a name with markup in it is text on the page, never markup', () => {
  const html = doc({
    rows: [{ label: '<script>alert(1)</script>', cost: '1' }],
    title: 'O’Brien & Sons <Pvt>',
  });
  assert.ok(!html.includes('<script>'), 'a script tag reached the document');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('O’Brien &amp; Sons &lt;Pvt&gt;'));
});

test('the totals label spans the columns before the first total', () => {
  const html = doc({ totals: { label: 'Total (1)', Cost: '54,000' } });
  // '#' and 'Asset' carry no total, so the label runs across both.
  assert.match(html, /<td colspan="2">Total \(1\)<\/td>/);
  assert.match(html, /<tfoot>/);
  // A column that is not totalled stays blank rather than being guessed at.
  const foot = html.slice(html.indexOf('<tfoot>'));
  assert.ok(!foot.includes('undefined'));
});

test('a total on the very first column still gets a label cell', () => {
  const html = reportHtml({
    columns: [num('Cost', (r) => r.cost)],
    rows: [{ cost: '1' }],
    totals: { label: 'Total', Cost: '1' },
    printedOn: 'today',
  });
  assert.match(html, /<td colspan="1">Total<\/td>/);
});

test('an empty section says so instead of printing an empty table', () => {
  const html = doc({ rows: [], empty: 'Nothing with them at the moment.' });
  assert.ok(!html.includes('<tbody></tbody>'));
  assert.match(html, /Nothing with them at the moment\./);
});

test('several sections each keep their own heading, columns and total', () => {
  const html = reportHtml({
    title: 'Asset ledger',
    sections: [
      { heading: 'Assets with them now', columns: [col('Asset', (r) => r.a)], rows: [{ a: 'Laptop' }] },
      { heading: 'Every movement', columns: [col('Date', (r) => r.on)], rows: [{ on: '2026-11-19' }] },
    ],
    printedOn: 'today',
  });
  assert.match(html, /<h2>Assets with them now<\/h2>/);
  assert.match(html, /<h2>Every movement<\/h2>/);
  assert.equal(html.match(/class="pr-block"/g).length, 2);
});

test('the head carries the title, what it was narrowed to, and the day', () => {
  const html = doc({ subtitle: 'BOOKNFLY · by person', meta: ['8 assets'] });
  assert.match(html, /<h1>Asset register<\/h1>/);
  assert.match(html, /BOOKNFLY · by person/);
  assert.match(html, /8 assets · Printed 19 November 2026/);
});

test('the foot counts the lines when the caller says nothing', () => {
  assert.match(doc(), /<footer class="pr-foot">1 line<\/footer>/);
  assert.match(
    doc({ rows: [{ label: 'a' }, { label: 'b' }] }),
    /<footer class="pr-foot">2 lines<\/footer>/
  );
});

test('a muster column can carry its weekday and shade its off days', () => {
  /*
   * Thirty-one identical columns are otherwise read by counting across with
   * a finger, and the week a day falls in is the first thing somebody
   * checking a muster looks for.
   */
  const html = reportHtml({
    columns: [
      col('Employee', (r) => r.name),
      { head: '1', sub: 'SUN', tint: true, align: 'mid', get: (r) => r.d1 },
      { head: '2', sub: 'MON', align: 'mid', get: (r) => r.d2 },
    ],
    rows: [{ name: 'Amit Patel', d1: 'S', d2: 'P' }],
    printedOn: 'today',
  });
  assert.match(html, /<th class="mid pr-off"[^>]*>1<span class="pr-sub-head">SUN<\/span><\/th>/);
  assert.match(html, /<th class="mid"[^>]*>2<span class="pr-sub-head">MON<\/span><\/th>/);
  // The shading follows the column down the rows, not only its header.
  assert.match(html, /<td class="mid pr-off">S<\/td>/);
  assert.match(html, /<td class="mid">P<\/td>/);
});

test('a compact report says so, for the one that is thirty-eight columns wide', () => {
  assert.match(reportHtml({ compact: true, printedOn: 'today' }), /class="pr-doc pr-tight"/);
  assert.ok(!reportHtml({ printedOn: 'today' }).includes('pr-tight'));
});
