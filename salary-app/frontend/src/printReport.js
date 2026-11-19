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
/*
 * `tint` shades a whole column - the weekly off days on a muster. Without
 * it thirty-one identical columns are read by counting across with a finger.
 */
const alignOf = (column) => {
  const classes = [
    column.align === 'num' ? 'num' : column.align === 'mid' ? 'mid' : '',
    column.tint ? 'pr-off' : '',
  ].filter(Boolean);
  return classes.length ? ` class="${classes.join(' ')}"` : '';
};

const cell = (column, row, index) => {
  const value = typeof column.get === 'function' ? column.get(row, index) : row[column.get];
  return `<td${alignOf(column)}>${esc(value)}</td>`;
};

const tableOf = ({ columns = [], rows = [], totals = null, empty = 'Nothing to show.' }) => {
  if (!rows.length) return `<p class="pr-empty">${esc(empty)}</p>`;
  const head = columns
    .map(
      (c) =>
        `<th${alignOf(c)}${c.width ? ` style="width:${esc(c.width)}"` : ''}>${esc(c.head)}${
          /* A day column carries its weekday under the number, so a Sunday
             is obvious on a muster somebody reads across. */
          c.sub ? `<span class="pr-sub-head">${esc(c.sub)}</span>` : ''
        }</th>`
    )
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
      cells.push(`<td${alignOf(c)}>${esc(totals[c.head] ?? '')}</td>`);
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
  compact = false,
  footer = '',
  printedOn = null,
} = {}) {
  const blocks = sections || [{ columns, rows, totals, empty }];
  const count = blocks.reduce((sum, b) => sum + (b.rows?.length || 0), 0);
  return `
    <article class="pr-doc${landscape ? ' pr-wide' : ''}${compact ? ' pr-tight' : ''}">
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
  compact = false,
  footer = '',
} = {}) {
  mount(
    reportHtml({ title, subtitle, meta, sections, columns, rows, totals, empty, landscape, compact, footer }),
    landscape
  );
}

/**
 * Put a built document beside the app, turn the paper the right way, and
 * open the print dialog.
 *
 * Shared by the reports and the slips, because everything here except the
 * document itself is the same both ways.
 */
function mount(html, landscape) {
  let root = document.getElementById(PRINT_ROOT);
  if (!root) {
    root = document.createElement('div');
    root.id = PRINT_ROOT;
    document.body.appendChild(root);
  }
  root.innerHTML = html;

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

/* ---------------------------------------------------------------------
 * SLIPS — a document per person, not a table of everybody.
 *
 * A payslip is not a report shape: it is a header, a few facts, two columns
 * of lines facing each other, and one figure at the foot. Printed in a
 * batch, EACH ONE STARTS A NEW PAGE — a slip is handed to one person, and
 * two people's pay on one sheet is the thing a payslip exists to avoid.
 * ------------------------------------------------------------------- */

const slipRows = (lines = [], total = null) =>
  [
    ...lines.map(
      ([label, amount]) => `<tr><td>${esc(label)}</td><td class="num">${esc(amount)}</td></tr>`
    ),
    total
      ? `<tr class="pr-slip-total"><td>${esc(total[0])}</td><td class="num">${esc(total[1])}</td></tr>`
      : '',
  ].join('');

const slipOf = (slip) => `
  <section class="pr-slip">
    <header class="pr-slip-head">
      <div>
        <h2>${esc(slip.company || '')}</h2>
        <p class="pr-slip-what">${esc(slip.what || 'Salary slip')}</p>
      </div>
      <div class="pr-slip-who">
        <strong>${esc(slip.name || '')}</strong>
        ${slip.about ? `<span>${esc(slip.about)}</span>` : ''}
      </div>
    </header>
    ${
      slip.facts?.length
        ? `<table class="pr-table pr-slip-facts"><tbody>${slip.facts
            .map(([label, value]) => `<tr><th>${esc(label)}</th><td class="num">${esc(value)}</td></tr>`)
            .join('')}</tbody></table>`
        : ''
    }
    <div class="pr-slip-cols">
      <table class="pr-table">
        <thead><tr><th>Earnings</th><th class="num">Amount</th></tr></thead>
        <tbody>${slipRows(slip.earnings, slip.earningsTotal)}</tbody>
      </table>
      <table class="pr-table">
        <thead><tr><th>Deductions</th><th class="num">Amount</th></tr></thead>
        <tbody>${
          slip.deductions?.length
            ? slipRows(slip.deductions, slip.deductionsTotal)
            : `<tr><td>None</td><td class="num">—</td></tr>${
                slip.deductionsTotal
                  ? `<tr class="pr-slip-total"><td>${esc(slip.deductionsTotal[0])}</td><td class="num">${esc(
                      slip.deductionsTotal[1]
                    )}</td></tr>`
                  : ''
              }`
        }</tbody>
      </table>
    </div>
    <table class="pr-table pr-slip-net">
      <tbody>
        <tr class="pr-slip-grand"><td>${esc(slip.net?.[0] || 'Net payable')}</td><td class="num">${esc(
          slip.net?.[1] ?? ''
        )}</td></tr>
        ${(slip.extras || [])
          .map(([label, value]) => `<tr><td>${esc(label)}</td><td class="num">${esc(value)}</td></tr>`)
          .join('')}
      </tbody>
    </table>
    ${slip.note ? `<p class="pr-slip-note">${esc(slip.note)}</p>` : ''}
  </section>`;

/** The slips as HTML, apart from the browser so they can be tested. */
export function slipsHtml({ slips = [], printedOn = null } = {}) {
  return `<article class="pr-doc pr-slips">${slips.map(slipOf).join('')}
    <footer class="pr-foot">${esc(`${slips.length} ${slips.length === 1 ? 'slip' : 'slips'} · printed ${printedOn || today()}`)}</footer>
  </article>`;
}

/** Print one slip, or a batch of them, one to a page. */
export function printSlips({ slips = [] } = {}) {
  if (!slips.length) return;
  mount(slipsHtml({ slips }), false);
}

/** A money column, formatted by the caller and right-aligned here. */
export const num = (head, get, width) => ({ head, get, align: 'num', width });
export const col = (head, get, width) => ({ head, get, width });
