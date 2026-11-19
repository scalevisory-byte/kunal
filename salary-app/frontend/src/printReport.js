/**
 * PRINTING A REPORT, NOT A SCREENSHOT OF THE SCREEN.
 *
 * Dinesh, after the print pass that cleared the sidebar and the pickers off
 * the paper: *"PURA SCREEN PRINT NAHI KARNA HE, REPORT PRINT KARNA HOTA
 * HE"*. He is right, and hiding furniture with CSS was never going to be
 * the answer — what came out was still the working screen with its bits
 * taken off: the filter row, the tick boxes, the figures strip, the
 * explanatory paragraphs, the inputs that each cell really is.
 *
 * So a report is BUILT, not hidden into existence. This takes the rows a
 * screen is showing and writes a document: a title block, the columns the
 * office actually wants, totals, and a footer saying where it came from.
 * It is rendered into its own element beside the app, and on paper the app
 * is hidden and only that element prints — so nothing on the screen can
 * leak onto the page, whatever is open and however somebody prints.
 *
 * THREE RULES.
 *
 *   **IT PRINTS WHAT IS ON SCREEN, NOT EVERYTHING.** The caller passes the
 *   rows the person is looking at, filters and search already applied.
 *   A report that quietly widened to the whole register would be a
 *   different document from the one they asked for.
 *
 *   **IT COMPUTES NOTHING.** Every figure is handed to it. A total here
 *   that disagreed with the total on the screen above it would be the worst
 *   kind of bug: both look right, and only one is.
 *
 *   **EVERY VALUE IS ESCAPED.** A person called `O'Brien & Sons <Pvt>` is
 *   ordinary, and this builds HTML.
 */

const PRINT_ROOT = 'print-root';

/** `<` in a name is a person's name, never markup. */
const esc = (v) =>
  v === null || v === undefined
    ? ''
    : String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

const today = () =>
  new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * A column: `{ head, get, align, width }`.
 *
 * `get` is a function of the row, so the caller formats its own figures with
 * the same `rupees()` the screen used. `align: 'num'` only sets the column
 * right and keeps the digits in one width.
 */
const cell = (column, row, index) => {
  const value = typeof column.get === 'function' ? column.get(row, index) : row[column.get];
  const klass = column.align === 'num' ? ' class="num"' : '';
  return `<td${klass}>${esc(value)}</td>`;
};

const tableOf = ({ columns = [], rows = [], totals = null, empty = 'Nothing to show.' }) => {
  if (!rows.length) return `<p class="pr-empty">${esc(empty)}</p>`;
  const head = columns
    .map((c) => `<th${c.align === 'num' ? ' class="num"' : ''}${c.width ? ` style="width:${esc(c.width)}"` : ''}>${esc(c.head)}</th>`)
    .join('');
  const body = rows
    .map((row, i) => `<tr>${columns.map((c) => cell(c, row, i)).join('')}</tr>`)
    .join('');
  /*
   * The totals row is given as values against column heads, so a column the
   * caller does not total simply stays blank rather than being guessed at.
   */
  /*
   * The label runs across every column before the first one that is
   * actually totalled. Put in the first cell alone it landed in the `#`
   * column, three per cent wide, and "Total (8)" printed as "Tota / l (8)".
   */
  let foot = '';
  if (totals) {
    const firstTotalled = Math.max(
      1,
      columns.findIndex((c) => totals[c.head] !== undefined)
    );
    const cells = [`<td colspan="${firstTotalled}">${esc(totals.label || 'Total')}</td>`];
    for (let i = firstTotalled; i < columns.length; i += 1) {
      const c = columns[i];
      cells.push(`<td${c.align === 'num' ? ' class="num"' : ''}>${esc(totals[c.head] ?? '')}</td>`);
    }
    foot = `<tfoot><tr>${cells.join('')}</tr></tfoot>`;
  }
  return `<table class="pr-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
};

const sectionOf = (section) => {
  const heading = section.heading ? `<h2>${esc(section.heading)}</h2>` : '';
  const note = section.note ? `<p class="pr-note">${esc(section.note)}</p>` : '';
  const lines = section.lines?.length
    ? `<div class="pr-figures">${section.lines
        .map((l) => `<span><em>${esc(l.label)}</em> ${esc(l.value)}</span>`)
        .join('')}</div>`
    : '';
  // A block is kept whole on the page where it fits on one.
  return `<section class="pr-block">${heading}${lines}${note}${tableOf(section)}</section>`;
};

/**
 * Build the document and open the browser's print dialog.
 *
 * @param title      what the report is: "Asset register"
 * @param subtitle   what it was narrowed to: "BOOKNFLY · out with staff"
 * @param meta       extra lines under the title, each a short string
 * @param sections   one or more { heading, columns, rows, totals, lines, note }
 * @param columns/rows/totals  a single-section shorthand
 * @param landscape  true for a table wider than it is tall
 * @param footer     one line at the foot of every page's last block
 */
/**
 * The document as HTML, apart from the browser so it can be tested.
 *
 * Exported for the tests, which is the point: the escaping rule and the
 * totals row are the two things here that can be quietly wrong, and neither
 * is visible by looking at a printed page.
 */
export function reportHtml({
  title = 'Report',
  subtitle = '',
  meta = [],
  sections = null,
  columns = [],
  rows = [],
  totals = null,
  empty,
  landscape = false,
  footer = '',
  printedOn = null,
} = {}) {
  const blocks = sections || [{ columns, rows, totals, empty }];
  const count = blocks.reduce((sum, b) => sum + (b.rows?.length || 0), 0);
  return `
    <article class="pr-doc${landscape ? ' pr-wide' : ''}">
      <header class="pr-head">
        <h1>${esc(title)}</h1>
        ${subtitle ? `<p class="pr-sub">${esc(subtitle)}</p>` : ''}
        <p class="pr-meta">${[...meta, `Printed ${printedOn || today()}`].map(esc).join(' · ')}</p>
      </header>
      ${blocks.map(sectionOf).join('')}
      <footer class="pr-foot">${esc(footer || `${count} ${count === 1 ? 'line' : 'lines'}`)}</footer>
    </article>`;
}

export function printReport({
  title = 'Report',
  subtitle = '',
  meta = [],
  sections = null,
  columns = [],
  rows = [],
  totals = null,
  empty,
  landscape = false,
  footer = '',
} = {}) {
  let root = document.getElementById(PRINT_ROOT);
  if (!root) {
    root = document.createElement('div');
    root.id = PRINT_ROOT;
    document.body.appendChild(root);
  }

  root.innerHTML = reportHtml({ title, subtitle, meta, sections, columns, rows, totals, empty, landscape, footer });

  /*
   * The orientation is written into the document itself, because `@page`
   * cannot be scoped by a class and Chrome ignores a named page on a nested
   * element - both were tried and read back off a printed PDF.
   */
  let page = document.getElementById('print-page-rule');
  if (!page) {
    page = document.createElement('style');
    page.id = 'print-page-rule';
    document.head.appendChild(page);
  }
  page.textContent = `@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm 10mm; }`;

  document.body.classList.add('printing-report');
  /*
   * `afterprint` fires whether the dialog was used or cancelled; the class
   * coming off matters either way, because while it is on, the app itself
   * is the thing that would be hidden on the next print.
   */
  const done = () => {
    document.body.classList.remove('printing-report');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);

  // A beat, so the browser has laid the document out before the dialog opens.
  window.setTimeout(() => {
    window.print();
    // Safari and some Linux builds never fire afterprint; this is the net.
    window.setTimeout(done, 1000);
  }, 60);
}

/** A money column, formatted by the caller and right-aligned here. */
export const num = (head, get, width) => ({ head, get, align: 'num', width });
export const col = (head, get, width) => ({ head, get, width });
