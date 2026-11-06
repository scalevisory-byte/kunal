/**
 * One person's own month, as a file you can send them.
 *
 * Dinesh: *"ABHI BINA DEPLY K BHEJ SAKU ESA BANAVO"* — he wants to hand the
 * month to his staff now, without putting anything on the internet.
 *
 * The staff portal answers this properly, and it needs a server. This is the
 * part that does not: a small self-contained HTML file per person, carrying
 * THAT PERSON'S month and nobody else's, which he forwards on WhatsApp. It
 * opens on any phone with no login, no network and no app, and prints to PDF.
 *
 * ---------------------------------------------------------------------------
 * The rule the whole thing hangs on:
 *
 *   ONE FILE HOLDS ONE PERSON. NOTHING ELSE GOES IN IT.
 *
 * The single-file build holds every salary in the company. Forwarding THAT to
 * an employee hands them the lot. So this is built from one row and never from
 * the store, and there is a test that nobody else's name or figure appears in
 * what comes out.
 * ---------------------------------------------------------------------------
 *
 * Dependency-free, like every other shared module, so the server and the
 * single file produce the same document.
 */

import { ATTENDANCE_CODES } from './calc.js';

const esc = (v) =>
  String(v ?? '').replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[c])
  );

const money = (v) => {
  const n = Math.round(Number(v) || 0);
  return n.toLocaleString('en-IN');
};

const money2 = (v) =>
  (Math.round((Number(v) || 0) * 100) / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const days = (v) => {
  const n = Math.round((Number(v) || 0) * 100) / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '');
};

/** A file name somebody can find again: Amit-Shah-October-2026.html */
export function payslipFileName(employee = {}, period = {}) {
  const tidy = (s) =>
    String(s || '')
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-');
  return `${tidy(employee.name || employee.employee_name) || 'payslip'}-${
    tidy(period.label) || 'month'
  }.html`;
}

/**
 * The whole document, as a string.
 *
 * `row` is what `calculateRow` returned - this ASSEMBLES, it never
 * recalculates, so the file and the sheet cannot disagree.
 */
export function payslipHtml({ employee = {}, period = {}, row = {}, leave = null, note } = {}) {
  const name = employee.name || row.employee_name || 'Employee';
  const company = employee.company_name || row.company_name || '';

  /* ---- how it was worked out, as a sum you can follow down the page ---- */
  const lines = [];
  const line = (what, why, amount, kind) =>
    lines.push({ what, why, amount, kind });

  line('Monthly salary', 'what you are on', row.salary);
  line(
    `Day rate — ${money2(row.per_day)} × ${days(row.present_days)} days paid`,
    `the month is paid on ${days(row.working_days)} working days, whatever the calendar says`,
    row.gross_after_absent,
    'strong'
  );
  if (row.absent_salary) {
    line(
      `Days not worked — ${days(row.absent_days)}`,
      'already taken off the figure above',
      -Math.abs(row.absent_salary),
      'muted'
    );
  }
  if (row.ot_salary) {
    line(
      `${row.ot_minutes > 0 ? 'Overtime' : 'Short hours'} — ${Math.abs(row.ot_minutes)} minutes`,
      `at ${money2(row.per_hour)} an hour`,
      row.ot_salary
    );
  }
  if (row.late_salary) {
    line('Late in and early out', 'beyond the month’s free minutes', -Math.abs(row.late_salary));
  }
  if (row.addition) line('Added', row.adjustment_note || 'an extra this month', row.addition);
  if (row.deduction) {
    line('Deducted', row.adjustment_note || 'taken off this month', -Math.abs(row.deduction));
  }
  line('Gross', '', row.gross_salary, 'strong');
  if (row.pf) line('PF', 'your share', -row.pf);
  if (row.esi) line('ESI', 'your share', -row.esi);
  if (row.pt) line('Professional tax', 'charged on the gross above', -row.pt);
  if (row.loan_deduction) line('Loan instalment', '', -row.loan_deduction);
  line('Net pay', '', row.net_salary, 'strong');

  const sum = lines
    .map(
      (l) => `<tr class="${l.kind === 'strong' ? 'strong' : ''}">
        <td>${esc(l.what)}${l.why ? `<div class="why">${esc(l.why)}</div>` : ''}</td>
        <td class="num ${l.kind === 'muted' ? 'muted' : ''}">${money(l.amount)}</td>
      </tr>`
    )
    .join('');

  /* ---- the month's days, so the figures above can be checked ---- */
  const marks = row.attendance || {};
  const dayCells = Object.keys(marks)
    .map(Number)
    .filter((d) => d > 0)
    .sort((a, b) => a - b)
    .map((d) => {
      const entry = marks[d];
      const code = (typeof entry === 'object' ? entry?.code : entry) || '';
      const label = ATTENDANCE_CODES[code]?.label || code;
      return `<span class="day" title="${esc(label)}"><b>${d}</b>${esc(code || '·')}</span>`;
    })
    .join('');

  const counts = Object.entries(row.mark_counts || {})
    .filter(([, n]) => n)
    .map(
      ([code, n]) =>
        `<span class="count"><b>${n}</b> ${esc(ATTENDANCE_CODES[code]?.label || code)}</span>`
    )
    .join('');

  /* ---- leave, when it was handed in ---- */
  const leaveRows = leave
    ? ['CL', 'SL', 'PL']
        .map((code) => {
          const quota = Number(leave.quotas?.[code]) || 0;
          const taken = Number(leave.taken?.[code]) || 0;
          if (!quota && !taken) return '';
          return `<tr><td>${esc(ATTENDANCE_CODES[code]?.label || code)}</td>
            <td class="num">${days(taken)}</td>
            <td class="num">${days(Math.max(quota - taken, 0))}</td>
            <td class="num muted">${days(quota)}</td></tr>`;
        })
        .join('')
    : '';

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} — ${esc(period.label)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    margin: 0; padding: 16px; color: #16181d; background: #f6f6f4;
    -webkit-text-size-adjust: 100%;
  }
  .sheet { max-width: 620px; margin: 0 auto; background: #fff; padding: 20px;
           border: 1px solid #e3e3df; border-radius: 10px; }
  h1 { font-size: 1.15rem; margin: 0 0 2px; }
  h2 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: .07em;
       color: #6b6f76; margin: 22px 0 6px; font-weight: 600; }
  .sub { color: #6b6f76; font-size: .84rem; margin: 0; }
  .net { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
         margin: 16px 0 4px; padding: 12px 14px; background: #f3f6fb;
         border: 1px solid #dfe7f3; border-radius: 8px; }
  .net b { font-size: 1.7rem; font-variant-numeric: tabular-nums; }
  .net span { color: #6b6f76; font-size: .82rem; }
  table { border-collapse: collapse; width: 100%; }
  td, th { padding: 6px 4px; border-bottom: 1px solid #eceae6; text-align: left;
           vertical-align: top; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .muted { color: #6b6f76; }
  .why { color: #6b6f76; font-size: .76rem; margin-top: 1px; }
  tr.strong td { font-weight: 700; border-bottom-width: 2px; border-bottom-color: #d8d5cf; }
  .days { display: flex; flex-wrap: wrap; gap: 3px; margin: 2px 0 8px; }
  .day { font-size: .68rem; min-width: 30px; text-align: center; padding: 3px 2px;
         border: 1px solid #e3e3df; border-radius: 4px; background: #fbfbfa; }
  .day b { display: block; color: #9a9ea6; font-weight: 600; }
  .count { font-size: .78rem; margin-right: 10px; color: #4a4e55; }
  .foot { color: #6b6f76; font-size: .76rem; margin-top: 18px; }
  .no-print { margin: 0 auto 12px; max-width: 620px; }
  button { font: inherit; padding: 8px 14px; border: 1px solid #c9ccd2;
           background: #fff; border-radius: 7px; cursor: pointer; }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { border: 0; max-width: none; padding: 0; }
    .no-print { display: none; }
  }
</style>
</head><body>
<div class="no-print"><button onclick="window.print()">Print / save as PDF</button></div>
<div class="sheet">
  <h1>${esc(name)}</h1>
  <p class="sub">${[company, employee.code, employee.designation].filter(Boolean).map(esc).join(' · ')}</p>

  <div class="net">
    <b>₹${money(row.net_salary)}</b>
    <span>net pay for ${esc(period.label)}${
      String(row.status || '').toLowerCase() === 'paid' ? ' · paid' : ' · not marked paid yet'
    }</span>
  </div>

  <h2>How it was worked out</h2>
  <table><tbody>${sum}</tbody></table>
  ${
    row.sunday_salary
      ? `<p class="foot">Sunday / holiday duty: ${days(row.sundays_worked)} day(s), ₹${money(
          row.sunday_salary
        )} — paid on its own register, separately from the salary above.</p>`
      : ''
  }

  ${
    dayCells
      ? `<h2>Your month</h2><div class="days">${dayCells}</div><p>${counts}</p>`
      : ''
  }

  ${
    leaveRows
      ? `<h2>Leave this year</h2>
         <table><thead><tr><th>Kind</th><th class="num">Taken</th><th class="num">Left</th><th class="num">Of</th></tr></thead>
         <tbody>${leaveRows}</tbody></table>`
      : ''
  }

  <p class="foot">
    ${note ? `${esc(note)}<br>` : ''}
    Computer generated — no signature needed. Every figure here is the one the office’s own
    salary sheet was paid from. If something looks wrong, tell the office.
  </p>
</div>
</body></html>`;
}
