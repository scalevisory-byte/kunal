/**
 * A CSV, READ BACK.
 *
 * Half the reports in this app exist only as a file to download - right for
 * a bank file, useless for a register somebody has to sign and file. To
 * PRINT one, the file has to be read back and laid out, and that means
 * parsing it properly and deciding which of its columns are figures.
 *
 * Here rather than beside the printer, because these are the two parts worth
 * testing and the printer itself needs a browser. Dependency-free, like the
 * rest of shared/.
 */

/**
 * A CSV, split properly.
 *
 * Not `line.split(',')`: these files carry names like `O'Brien, Sons` and
 * remarks with commas in them, all of it correctly quoted by the server, and
 * a naive split shifts every column after it by one.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  /* A BOM is written deliberately so Excel opens the rupee signs; it is not
     part of the first heading. */
  const body = text.replace(/^﻿/, '');

  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quoted) {
      if (c === '"') {
        if (body[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  /* A trailing newline leaves one empty row; a file of nothing but headings
     is still a report, so only the blank tail goes. */
  while (rows.length && rows[rows.length - 1].every((v) => v === '')) rows.pop();
  return rows;
}

const CLEAN = /[\s,₹•]/g;

/** Is this a figure, or a code that happens to be digits? */
export const looksNumeric = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return null; // blank says nothing either way
  if (/^-?\d{1,3}(,\d{2,3})*(\.\d+)?$/.test(s) || /^-?\d+(\.\d+)?$/.test(s)) {
    return Number(s.replace(CLEAN, ''));
  }
  if (/^₹\s?-?[\d,]+(\.\d+)?$/.test(s)) return Number(s.replace(CLEAN, ''));
  return null;
};

/**
 * Which columns are worth adding up.
 *
 * A column counts only if EVERY value in it that is filled in reads as a
 * number, and at least one does. That keeps an employee code, a PIN code, a
 * phone number and a date off the totals row - each of which is digits and
 * none of which means anything added together.
 *
 * A column whose heading names an identifier is left alone whatever its
 * values look like, because `UAN` summing to 1.2 billion is worse than no
 * total at all.
 */
const NEVER_TOTAL = /\b(code|no\.?|number|pan|uan|aadhaar|esic|pf no|ifsc|account|phone|mobile|pin|year|date|id)\b/i;

export function numericColumns(head, rows) {
  return head.map((heading, i) => {
    if (NEVER_TOTAL.test(heading)) return false;
    let seen = 0;
    for (const row of rows) {
      const n = looksNumeric(row[i]);
      if (n === null) {
        if (String(row[i] ?? '').trim() !== '') return false;
        continue;
      }
      seen += 1;
    }
    return seen > 0;
  });
}

