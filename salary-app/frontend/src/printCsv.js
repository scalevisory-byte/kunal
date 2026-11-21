import { fetchText } from './api.js';
import { col, num, printReport } from './printReport.js';
import { looksNumeric, numericColumns, parseCsv } from '../../shared/csvTable.js';

/**
 * PRINTING A REPORT THAT ONLY EXISTED AS A DOWNLOAD.
 *
 * Dinesh: *"sare reports me proper printing reports dalo"*. Half the reports
 * on that screen were a Download button and nothing else - right for a bank
 * file, useless for the register somebody has to sign and file. Printing the
 * browser's view of a CSV is not an option either: there is no view.
 *
 * So the file is FETCHED and laid out as a document - the same `printReport`
 * the muster roll and the payslip use, with the letterhead, the month, the
 * filters that were on, and totals under the numeric columns.
 *
 * ---------------------------------------------------------------------------
 * IT PRINTS THE FILE, AND NOTHING IT WORKED OUT ITSELF.
 *
 * Every figure on the page came out of the same endpoint the Download button
 * hands over, so the paper and the spreadsheet cannot disagree. The ONE
 * thing added is a total row, and only under a column whose every value is a
 * number - a column of codes that happen to be digits is not a column to add
 * up, and a column with one word in it is not either.
 * ---------------------------------------------------------------------------
 */

/**
 * Fetch a report file and print it.
 *
 * @param path     the same endpoint the Download button uses
 * @param title    the report's name, as the catalogue calls it
 * @param meta     the lines under the title - the month, the filters that were on
 */
export async function printFromCsv(path, { title, subtitle = '', meta = [], footer = '' } = {}) {
  const text = await fetchText(path);
  const rows = parseCsv(text);
  if (!rows.length) {
    printReport({ title, subtitle, meta, columns: [col('', () => '')], rows: [], empty: 'Nothing in this report.' });
    return 0;
  }

  const [head, ...body] = rows;
  const isNum = numericColumns(head, body);
  const columns = head.map((heading, i) =>
    isNum[i] ? num(heading, (r) => r[i]) : col(heading, (r) => r[i])
  );

  /*
   * One total row, under the columns that are figures.
   *
   * `printReport` takes totals as an OBJECT KEYED BY COLUMN HEAD, with an
   * optional label - not an array of cells. Handing it an array printed a
   * row that said "Total" and nothing else, which looks like a report whose
   * figures did not add up. Caught by rendering the page to PDF and reading
   * it back, which is the only way to see what actually comes out.
   *
   * It computes nothing of its own: the sums are taken here, from the same
   * cells printed above them, never from a second fetch.
   */
  const totals = isNum.some(Boolean)
    ? head.reduce(
        (out, heading, i) => {
          if (!isNum[i]) return out;
          const sum = body.reduce((t, r) => t + (looksNumeric(r[i]) || 0), 0);
          out[heading] = Number.isInteger(sum)
            ? sum.toLocaleString('en-IN')
            : sum.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return out;
        },
        { label: `Total \u00b7 ${body.length} ${body.length === 1 ? 'row' : 'rows'}` }
      )
    : null;

  printReport({
    title,
    subtitle,
    meta,
    columns,
    rows: body,
    totals,
    /* Wide files go on their side rather than off the edge of the page. */
    landscape: head.length > 7,
    compact: head.length > 10,
    footer,
  });
  return body.length;
}
