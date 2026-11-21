/**
 * A table of rows, saved as a CSV the office can open.
 *
 * Three copies of this had grown — one on the ledger, one on the leave
 * reports, one about to be written for a third — so it is one function now.
 *
 * The BOM is not decoration: without it Excel opens a UTF-8 file as the
 * local code page and every rupee sign and every name with an accent comes
 * out as mojibake.
 */
export function saveCsv(filename, columns, rows = []) {
  const out = [columns.map(([head]) => head)];
  for (const row of rows) out.push(columns.map(([, key]) => row[key] ?? ''));
  const body = `﻿${out
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
