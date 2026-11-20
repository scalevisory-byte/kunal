import { safeLogo } from './logoUri.js';
import { qrSvg } from './qr.js';
import { duration, visitMinutes } from './frontOffice.js';

/**
 * THE VISITOR PASS: one card, printed, handed over at the desk.
 *
 * Built the same way the offer letter is, for the same reasons. It is one
 * self-contained page that loads NOTHING from the internet - the logo rides
 * inside it as a data URI - because the machine at a reception desk is the
 * least likely in the building to have a working connection, and a pass that
 * prints blank is worse than no pass at all.
 *
 * WHAT THE QR CODE CARRIES IS THE PASS NUMBER AND NOTHING ELSE.
 *
 * A visitor pass is pinned to a lanyard and walked around a building full of
 * people who are not staff. Anything in that code is readable by anybody
 * with a phone - so the mobile number, the purpose and who they came to see
 * stay off it. The number is a key to a record that is behind a login, which
 * is the whole of what a pass needs to be checked against.
 *
 * Dependency-free: the QR factory is handed in, like everywhere else here.
 */

const esc = (v) =>
  String(v ?? '').replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[c])
  );

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const longDay = (iso) => {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return y ? `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}` : String(iso || '');
};

/** A file name somebody can find again. */
export const passFileName = (visitor = {}) =>
  `${String(visitor.pass_no || 'Visitor-pass').replace(/[^A-Za-z0-9-]+/g, '-')}.html`;

/**
 * @param visitor  the stored row - nothing here is worked out twice
 * @param logo     that company's logo as a data: URI, or ''
 * @param qr       the qrcode-generator factory, handed in
 * @param office   what to print above the number
 */
export function visitorPassHtml(visitor = {}, { logo, qr, office = 'BOOKNFLY' } = {}) {
  const mark = safeLogo(logo);
  const code = visitor.pass_no && qr ? qrSvg(visitor.pass_no, { qr, sizeMm: 24, ecc: 'Q' }) || '' : '';
  const minutes = visitMinutes(visitor);

  const line = (label, value) =>
    value ? `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(visitor.pass_no || 'Visitor pass')}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 10mm; background: #f5f6f9; color: #1b2338;
         font: 13px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .pass { width: 86mm; margin: 0 auto; background: #fff; border: 1px solid #e4e7ef;
          border-radius: 10px; overflow: hidden; }
  .top { background: #132043; color: #fff; padding: 5mm 5mm 4mm; }
  .top img { display: block; max-height: 11mm; max-width: 40mm; margin-bottom: 2.5mm;
             background: #fff; border-radius: 3px; padding: 1mm 1.5mm; }
  .top h1 { font-size: 12px; margin: 0; letter-spacing: 0.08em; text-transform: uppercase; color: #c9a24b; }
  .top .no { font-size: 17px; font-weight: 700; letter-spacing: 0.04em; margin-top: 1mm;
             font-variant-numeric: tabular-nums; }
  .who { padding: 4mm 5mm 0; }
  .who .name { font-size: 16px; font-weight: 700; }
  .who .from { color: #6a6f7a; }
  table { width: 100%; border-collapse: collapse; margin: 3mm 0 0; }
  th, td { text-align: left; padding: 1.6mm 5mm; vertical-align: top; font-size: 12px; }
  th { width: 26mm; color: #6a6f7a; font-weight: 500; }
  td { font-weight: 600; }
  .qr { text-align: center; padding: 3mm 0 1mm; }
  .foot { border-top: 1px dashed #d9dce6; margin-top: 3mm; padding: 3mm 5mm 5mm;
          color: #6a6f7a; font-size: 10.5px; }
  .sign { margin-top: 6mm; border-top: 1px solid #1b2338; padding-top: 1.5mm; font-size: 10.5px; }
  button { font: inherit; margin: 6mm auto 0; display: block; padding: 2mm 6mm;
           border: 1px solid #132043; background: #132043; color: #fff; border-radius: 5px; cursor: pointer; }
  @media print {
    body { background: #fff; padding: 0; }
    .pass { border: 0; width: auto; }
    button { display: none; }
  }
</style>
</head>
<body>
<div class="pass">
  <div class="top">
    ${mark ? `<img src="${mark}" alt="">` : ''}
    <h1>Visitor pass</h1>
    <div class="no">${esc(visitor.pass_no || '')}</div>
  </div>

  <div class="who">
    <div class="name">${esc(visitor.name || '')}</div>
    <div class="from">${esc(visitor.company || visitor.visitor_type || '')}</div>
  </div>

  <table>
    ${line('To meet', visitor.meeting)}
    ${line('Purpose', visitor.purpose)}
    ${line('Date', longDay(visitor.day))}
    ${line('Time in', visitor.in_time)}
    ${line('Time out', visitor.out_time)}
    ${minutes !== null ? line('Inside for', duration(minutes)) : ''}
    ${line('Mobile', visitor.mobile)}
  </table>

  ${code ? `<div class="qr">${code}</div>` : ''}

  <div class="foot">
    Please wear this pass while you are in the building and hand it back at the desk when you
    leave. ${esc(office)}
    <div class="sign">Signature</div>
  </div>
</div>
<button onclick="window.print()">Print this pass</button>
</body>
</html>`;
}
