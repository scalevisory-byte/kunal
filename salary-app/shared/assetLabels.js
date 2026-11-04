/**
 * The sticker that goes on the thing, the sheet of them, and the voucher.
 *
 * These were written inline in the asset routes, which meant the single-file
 * build could not print a label at all - and copying a hundred lines of HTML
 * into localStore.js is how the two start drifting. The libraries are passed
 * in (`qr`), so this stays dependency-free like every other shared module.
 *
 * Plain HTML and inline SVG with a print stylesheet: no PDF library, and what
 * comes out of the printer is what is on the screen. Sized in millimetres, so
 * a 40mm sticker really is 40mm.
 */
import { barcodeSvg } from './barcode.js';
import { qrSvg } from './qr.js';
import { voucher } from './voucher.js';

const esc = (v) =>
  String(v ?? '').replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[c])
  );

/**
 * One label.
 *
 * `as` picks the symbology: 'bar' for the Code 128 the office scanner reads,
 * 'text' for a QR of the bare code, anything else for a QR of the link - which
 * is the default, because a phone camera opens it and lands on the asset.
 */
export function labelSvg(asset, { qr, as = 'qr', heightMm, sizeMm, link } = {}) {
  if (!asset) return { problem: 'not found', status: 404 };
  if (!asset.code) return { problem: 'that asset has no code to print', status: 400 };

  if (as === 'bar') {
    const svg = barcodeSvg(asset.code, { heightMm: Number(heightMm) || 12 });
    return svg ? { svg } : { problem: 'that code cannot be made into a barcode', status: 400 };
  }
  const svg = qrSvg(as === 'text' ? asset.code : link || asset.code, {
    qr,
    sizeMm: Number(sizeMm) || 18,
    // Q survives a scuff, a thumbprint and a corner peeling off a vehicle.
    ecc: 'Q',
    // The caption is the code, always: a URL printed under a sticker is
    // unreadable and nobody types one off a laptop lid.
    label: asset.code,
  });
  return svg ? { svg } : { problem: 'that code cannot be made into a QR', status: 400 };
}

/** A sheet of stickers, because nobody labels one asset at a time. */
export function labelSheet(assets = [], { qr, mm = 18, as, linkFor } = {}) {
  const size = Number(mm) || 18;
  const cells = assets
    .map((a) => {
      const svg =
        qrSvg(String(as) === 'text' ? a.code : (linkFor ? linkFor(a) : a.code), {
          qr,
          sizeMm: size,
          ecc: 'Q',
        }) || '';
      const what = [a.kind, a.label].filter(Boolean).join(' — ');
      return (
        `<div class="sticker">${svg}` +
        `<div class="code">${esc(a.code)}</div>` +
        `<div class="what">${esc(what)}</div>` +
        `<div class="who">${esc(a.company_name || '')}</div></div>`
      );
    })
    .join('');

  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>Asset labels</title><style>
      body { font: 11px/1.3 system-ui, sans-serif; margin: 8mm; }
      h1 { font-size: 14px; margin: 0 0 6mm; }
      .sheet { display: flex; flex-wrap: wrap; gap: 4mm; }
      .sticker {
        width: ${(mm + 14).toFixed(0)}mm;
        border: 0.2mm dashed #bbb;
        padding: 2mm;
        text-align: center;
        page-break-inside: avoid;
      }
      .sticker svg { display: block; margin: 0 auto; }
      .code { font-family: monospace; font-weight: 700; margin-top: 1mm; }
      .what, .who { color: #555; font-size: 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      @media print { body { margin: 5mm; } h1, .note { display: none; } .sticker { border-color: #eee; } }
    </style></head><body>
      <h1>${assets.length} label${assets.length === 1 ? '' : 's'} — print this page</h1>
      <p class="note">The dashed lines are a cutting guide and do not print dark. Scanning one
      with a phone opens that asset — ${esc(assetLink(req, 'CODE').replace('/CODE', ''))} — and
      asks for a sign-in first, because an asset register is not public.</p>
      <div class="sheet">${cells}</div>
    </body></html>`
  );

}

/** The asset voucher, to print and file. */
export function voucherHtml(asset, { qr, link } = {}) {
  const v = voucher(asset);
  const qrCode = asset.code
    ? qrSvg(link || asset.code, { qr, sizeMm: 20, ecc: 'Q' }) || ''
    : '';

  const row = (k, val) => `<tr><th>${esc(k)}</th><td>${esc(val || '—')}</td></tr>`;

  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(v.no || 'Asset voucher')}</title><style>
      body { font: 12px/1.5 system-ui, sans-serif; margin: 12mm; color: #111; }
      .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; }
      h1 { font-size: 16px; margin: 0 0 1mm; letter-spacing: 0.02em; }
      .sub { color: #555; margin: 0; }
      .no { font-family: monospace; font-size: 13px; font-weight: 700; }
      table { border-collapse: collapse; width: 100%; margin-top: 6mm; }
      th, td { border: 0.2mm solid #ccc; padding: 2mm 3mm; text-align: left; vertical-align: top; }
      th { width: 42mm; font-weight: 600; background: #f6f6f4; }
      .amount td { font-size: 15px; font-weight: 700; }
      .words td { font-style: italic; }
      .gap { border: 0.3mm solid #b8402e; color: #b8402e; padding: 3mm; margin-top: 5mm; }
      .sign { display: flex; gap: 10mm; margin-top: 16mm; }
      .sign div { flex: 1; border-top: 0.2mm solid #888; padding-top: 2mm; color: #555; }
      .foot { margin-top: 8mm; color: #666; font-size: 10px; }
      @media print { body { margin: 10mm; } .noprint { display: none; } }
    </style></head><body>
      <div class="head">
        <div>
          <h1>ASSET PURCHASE VOUCHER</h1>
          <p class="sub">${esc(v.company)}${v.branch ? ` · ${esc(v.branch)}` : ''}</p>
          <p class="sub no">${esc(v.no || 'no code — no voucher number')}</p>
        </div>
        <div style="text-align:center">${qrCode}<div style="font-family:monospace;font-size:10px">${esc(v.code)}</div></div>
      </div>

      <table>
        ${row('Voucher date', v.dated)}
        ${row('Asset code', v.code)}
        ${row('What it is', v.what)}
        ${row('Serial / number', v.identifier)}
        ${row('Supplier', v.vendor)}
        ${row('Invoice number', v.invoice_no)}
        ${row('Invoice date', v.purchase_date)}
        ${row('Warranty until', v.warranty_until)}
        ${row('Issued to', v.holder || 'in the office')}
        <tr class="amount"><th>Amount payable</th><td>₹ ${v.amount.toLocaleString('en-IN')}</td></tr>
        <tr class="words"><th>In words</th><td>${esc(v.amount_in_words)}</td></tr>
      </table>

      ${
        v.complete
          ? ''
          : `<p class="gap"><strong>Not ready to pay.</strong> Still missing: ${esc(
              v.missing.join(', ')
            )}. Fill it in on the asset register and print this again — the voucher number does
            not change.</p>`
      }

      <div class="sign">
        <div>Prepared by</div>
        <div>Approved by</div>
        <div>Accounts — paid on</div>
      </div>

      <p class="foot">
        This voucher is printed from the asset register. ${esc(v.code || 'The asset')} is on the
        register, which is what it certifies; the number above is worked out from that code and
        the financial year, so a reprint is the same voucher and not a second claim.
      </p>
      <p class="noprint foot">Print this page, or save it as a PDF from the print dialog.</p>
    </body></html>`
  );

}
