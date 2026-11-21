import { longDate } from './offer.js';
import { safeLogo } from './logoUri.js';

/**
 * THE TWO LETTERS SOMEBODY LEAVING ACTUALLY ASKS FOR.
 *
 * Dinesh: *"Employee exit procedures banavo proper"*. The app had the
 * resignation, the notice, the clearance list and the full and final — and
 * then stopped, one step short of the only part the person who is leaving
 * ever sees. They are asked for a **relieving letter** by their next
 * employer and an **experience certificate** by everybody after that, and
 * until now both were typed in Word from memory.
 *
 * FOUR RULES, and each one is here because the opposite causes real trouble:
 *
 *   **A letter states what the app holds and nothing more.** The dates, the
 *   designation, the company. No sentence is written that the records cannot
 *   support.
 *
 *   **"All dues settled" is printed ONLY when the full and final actually
 *   is.** That line is read as a receipt by the next employer and by a
 *   labour office; printing it over an unpaid settlement is a statement
 *   against the company that cannot be taken back.
 *
 *   **The conduct sentence is a judgement, so somebody has to choose it.**
 *   It is a tick with its exact wording shown beside it, not boilerplate
 *   that silently vouches for a person who was dismissed.
 *
 *   **One file holds one person**, like the payslip. The whole letter is
 *   self-contained: it opens on any phone, prints to PDF, and loads nothing
 *   from the internet.
 */

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const LETTERS = [
  ['relieving', 'Relieving letter', 'Confirms the resignation was accepted and the date they were relieved.'],
  ['experience', 'Experience certificate', 'How long they worked here and as what. The one they are asked for years later.'],
];

export const isLetterKind = (kind) => LETTERS.some(([k]) => k === kind);

/** "3 years 8 months", from two dates. Never guessed when either is missing. */
export function servedFor(joined, last) {
  const from = joined ? new Date(joined) : null;
  const to = last ? new Date(last) : null;
  if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return '';
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  if (months < 0) return '';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const said = [];
  if (years) said.push(`${years} year${years === 1 ? '' : 's'}`);
  if (rest) said.push(`${rest} month${rest === 1 ? '' : 's'}`);
  return said.join(' ') || 'less than a month';
}

/**
 * How they went, in the words a letter uses.
 *
 * A relieving letter after a dismissal does not say "resigned", and one
 * after a resignation does not say "services were terminated". Getting this
 * wrong in either direction is the sort of thing that turns up in a tribunal.
 */
const WENT = {
  resigned: 'resigned from the services of the company',
  terminated: 'ceased to be in the services of the company',
  absconded: 'ceased to be in the services of the company',
  retired: 'retired from the services of the company',
  contract_ended: 'completed the term of engagement with the company',
};

export const fileNameFor = (kind, employee, exit) =>
  `${String(employee?.name || 'employee').trim().replace(/\s+/g, '-')}-${
    kind === 'relieving' ? 'relieving-letter' : 'experience-certificate'
  }${exit?.last_working_day ? `-${String(exit.last_working_day).slice(0, 10)}` : ''}.html`;

const SHELL = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 1.5rem 1rem; background: #f6f6f4; color: #16181d;
    font: 15px/1.7 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .sheet {
    max-width: 44rem; margin: 0 auto; background: #fff; padding: 2rem 2.2rem;
    border: 1px solid #e3e3df; border-radius: 10px;
  }
  h1 { font-size: 1.15rem; margin: 0 0 0.2rem; letter-spacing: 0.06em; color: #15284b; }
  h2 { font-size: 1rem; margin: 1.6rem 0 0.6rem; text-align: center; letter-spacing: 0.12em;
       text-transform: uppercase; }
  .muted { color: #6a6f7a; font-size: 0.85rem; }
  .head { border-bottom: 2px solid #15284b; padding-bottom: 0.8rem; margin-bottom: 1.2rem; }
  .head img { display: block; max-height: 54px; max-width: 16rem; margin-bottom: 0.6rem; }
  .ref { display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap;
         font-size: 0.85rem; color: #6a6f7a; margin-bottom: 1.4rem; }
  table { width: 100%; border-collapse: collapse; margin: 0.6rem 0 1rem; }
  th, td { text-align: left; padding: 0.42rem 0.2rem; border-bottom: 1px solid #ececea; }
  th { width: 42%; font-weight: 500; color: #6a6f7a; }
  td { font-weight: 600; }
  .sign { margin-top: 3rem; }
  .sign div { width: 16rem; border-top: 1px solid #16181d; padding-top: 0.4rem; font-size: 0.85rem; }
  .print { margin: 1rem auto 0; display: block; padding: 0.5rem 1rem; border: 1px solid #15284b;
           background: #15284b; color: #fff; border-radius: 6px; font: inherit; cursor: pointer; }
  @media print { body { background: #fff; padding: 0; } .sheet { border: 0; } .print { display: none; } }
</style>
</head>
<body>
<div class="sheet">
${body}
</div>
<button class="print" onclick="window.print()">Print or save as PDF</button>
</body>
</html>`;

const header = (company, mark, title, issued) => `  <div class="head">
    ${mark ? `<img src="${mark}" alt="${esc(company)}">` : ''}
    <h1>${esc(company || 'BOOKNFLY')}</h1>
    <p class="muted">${esc(title)}</p>
  </div>
  <div class="ref">
    <span>${esc(issued ? `Date: ${longDate(issued)}` : '')}</span>
  </div>`;

/**
 * The relieving letter.
 *
 * `settled` is the settlement's own state, not a claim typed here: when it is
 * false the dues sentence is simply not written.
 */
export function relievingLetterHtml({
  employee = {},
  exit = {},
  company = '',
  logo = '',
  issued = '',
  settled = false,
  note = '',
  conduct = false,
  signedBy = '',
} = {}) {
  const mark = safeLogo(logo);
  const went = WENT[exit.type] || WENT.resigned;
  const rows = [
    ['Employee name', employee.name],
    ['Employee code', employee.code],
    ['Designation', employee.designation],
    ['Department', employee.department],
    ['Date of joining', longDate(employee.joined_on)],
    ['Last working day', longDate(exit.last_working_day)],
  ].filter(([, v]) => String(v || '').trim());

  return SHELL(
    `${employee.name || 'Employee'} — relieving letter`,
    `${header(company, mark, 'Relieving letter', issued)}
  <h2>To whomsoever it may concern</h2>
  <p>
    This is to certify that <strong>${esc(employee.name)}</strong>${
      employee.code ? ` (${esc(employee.code)})` : ''
    } ${esc(went)} with effect from the close of working hours on
    <strong>${esc(longDate(exit.last_working_day))}</strong>.
  </p>
  <table>
    ${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('\n    ')}
  </table>
  ${
    settled
      ? '<p>All dues payable by and to the company have been settled, and the company has no claim outstanding against them.</p>'
      : '<p>The final settlement of accounts is being processed separately.</p>'
  }
  ${
    conduct
      ? '<p>During the period of their employment we found their conduct and performance satisfactory.</p>'
      : ''
  }
  ${note ? `<p>${esc(note)}</p>` : ''}
  <p>We wish them every success in their future assignments.</p>
  <div class="sign">
    <div>For ${esc(company || 'BOOKNFLY')}<br><span class="muted">${esc(
      signedBy || 'Authorised signatory'
    )}</span></div>
  </div>`
  );
}

/** The experience certificate: how long, as what, and nothing about dues. */
export function experienceLetterHtml({
  employee = {},
  exit = {},
  company = '',
  logo = '',
  issued = '',
  note = '',
  conduct = false,
  signedBy = '',
} = {}) {
  const mark = safeLogo(logo);
  const served = servedFor(employee.joined_on, exit.last_working_day);

  return SHELL(
    `${employee.name || 'Employee'} — experience certificate`,
    `${header(company, mark, 'Experience certificate', issued)}
  <h2>To whomsoever it may concern</h2>
  <p>
    This is to certify that <strong>${esc(employee.name)}</strong>${
      employee.code ? ` (${esc(employee.code)})` : ''
    } was employed with ${esc(company || 'BOOKNFLY')} from
    <strong>${esc(longDate(employee.joined_on))}</strong> to
    <strong>${esc(longDate(exit.last_working_day))}</strong>${served ? `, a period of ${esc(served)}` : ''}.
  </p>
  ${
    employee.designation
      ? `<p>They served as <strong>${esc(employee.designation)}</strong>${
          employee.department ? ` in the ${esc(employee.department)} department` : ''
        }.</p>`
      : ''
  }
  ${
    conduct
      ? '<p>During this period we found their conduct and performance satisfactory.</p>'
      : ''
  }
  ${note ? `<p>${esc(note)}</p>` : ''}
  <p>This certificate is issued at their request.</p>
  <div class="sign">
    <div>For ${esc(company || 'BOOKNFLY')}<br><span class="muted">${esc(
      signedBy || 'Authorised signatory'
    )}</span></div>
  </div>`
  );
}

export const letterHtml = (kind, data) =>
  kind === 'experience' ? experienceLetterHtml(data) : relievingLetterHtml(data);
