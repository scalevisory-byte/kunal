import { Router } from 'express';
import { digest } from '../../../shared/digest.js';
import { buildPayroll } from '../payroll.js';
import { listPeriods } from '../db.js';
import { listRequests } from '../attendanceSelf.js';
import { getEmployee } from '../db.js';
import { barcodeSvg } from '../../../shared/barcode.js';
import qr from 'qrcode-generator';
import { qrSvg } from '../../../shared/qr.js';
import { voucher } from '../../../shared/voucher.js';
import { config } from '../config.js';
import { deletePhotoFile, photoLink, uploadAssetPhoto } from '../assetPhotos.js';

/*
 * What a sticker's QR actually carries: a link to that asset, so scanning it
 * with any phone camera opens its page rather than showing a string somebody
 * then has to retype into the search box.
 *
 * The address is PUBLIC_URL when it is set, and otherwise whatever host this
 * request came in on - so a sticker printed from the office laptop carries the
 * office laptop's address, which is wrong on a phone but honestly wrong rather
 * than silently useless. Set PUBLIC_URL before printing a sheet that goes on
 * the kit.
 *
 * `?as=text` still puts the bare code in, for anybody who wants a sticker that
 * outlives the address.
 */
const assetLink = (req, code) => {
  const base = (config.publicUrl || `${req.protocol}://${req.get('host') || ''}`).replace(/\/$/, '');
  return `${base}/a/${encodeURIComponent(code)}`;
};

/*
 * A photo as the browser may see it: a signed link that expires, and never
 * `file_path`. Where the file is on disk is not the page's business, and a
 * path that leaves the server is a path somebody can guess the next one of.
 */
const asPhoto = ({ file_path, ...rest }) => ({ ...rest, link: photoLink({ ...rest, file_path }) });

/* The sticker sheet is the only HTML this router sends, and an asset's name is
   typed by somebody. */
const esc = (v) =>
  String(v ?? '').replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[c])
  );
import { handoverCsv, handoverSlip, registerCsv, registerTotals } from '../../../shared/assetReport.js';
import {
  SERVICE_KINDS,
  maintenanceAlerts,
  maintenanceTotals,
  spendReport,
  ownershipCsv,
  servicesCsv,
} from '../../../shared/maintenance.js';
import {
  ASSET_KINDS,
  CLAIM_KINDS,
  CLAIM_STATUSES,
  NOTE_KINDS,
  TASK_PRIORITIES,
  TICKET_CATEGORIES,
  WARNING_LEVELS,
  applyAppraisal,
  closeTicket,
  createAppraisal,
  createAsset,
  createClaim,
  createNote,
  createTask,
  createTicket,
  decideClaim,
  deleteAppraisal,
  deleteAsset,
  deleteClaim,
  deleteExit,
  deleteNote,
  deleteTask,
  fullAndFinal,
  getTicket,
  issueAsset,
  listAllAppraisals,
  listAllNotes,
  listAppraisals,
  assetHistory,
  addAssetPhoto,
  assetsWithOwnership,
  deleteAssetPhoto,
  getAssetPhoto,
  listAssetPhotos,
  deleteService,
  getAsset,
  getAssetByCode,
  listAssets,
  listAudit,
  listHandovers,
  listRounds,
  listServices,
  logService,
  roundProgress,
  updateService,
  verifyAsset,
  writeOffAsset,
  listClaims,
  listExits,
  listNotes,
  listTasks,
  listTickets,
  markSettled,
  payClaim,
  reopenTicket,
  replyToTicket,
  returnAsset,
  saveExit,
  setTaskStatus,
  updateAppraisal,
  updateAsset,
  updateNote,
  updateTask,
} from '../people.js';

/**
 * The people registers over HTTP.
 *
 * `who` on a write is whoever the office says did it - this app has one shared
 * password and no user accounts, so it is a name typed on the form, not an
 * identity the server can vouch for. The audit trail says that plainly rather
 * than implying an authentication that does not exist.
 */
export const peopleRouter = Router();

const bad = (res, err) => res.status(400).json({ error: err.message });
/**
 * Whose name goes on the record.
 *
 * The signed-in user wins, because that is somebody the server actually
 * checked. A typed name is only the fallback, for the API key and for an
 * installation running open - and in those two cases the trail says so
 * ("the API key", "nobody (open)") rather than inventing a person.
 */
const who = (req) =>
  (req.actor?.via === 'session' ? req.actor.name : null) ||
  req.body?.by ||
  req.get('x-acted-by') ||
  req.actor?.name ||
  null;

/* ---------------- what the pickers offer ---------------- */

peopleRouter.get('/options', (_req, res) => {
  res.json({
    asset_kinds: ASSET_KINDS,
    claim_kinds: CLAIM_KINDS,
    claim_statuses: CLAIM_STATUSES,
    note_kinds: NOTE_KINDS,
    task_priorities: TASK_PRIORITIES,
    ticket_categories: TICKET_CATEGORIES,
    warning_levels: WARNING_LEVELS,
  });
});

/* ---------------- warnings and appreciations ---------------- */

peopleRouter.get('/notes', (req, res) => {
  const employeeId = Number(req.query.employee_id) || null;
  res.json({
    notes: employeeId
      ? listNotes(employeeId, { kind: req.query.kind || undefined })
      : listAllNotes({ kind: req.query.kind || undefined, limit: req.query.limit }),
  });
});

peopleRouter.post('/notes', (req, res) => {
  try {
    res.status(201).json(createNote(Number(req.body?.employee_id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.patch('/notes/:id', (req, res) => {
  try {
    res.json(updateNote(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.delete('/notes/:id', (req, res) => {
  res.json({ deleted: deleteNote(Number(req.params.id), who(req)) });
});

/* ---------------- appraisals ---------------- */

peopleRouter.get('/appraisals', (req, res) => {
  const employeeId = Number(req.query.employee_id) || null;
  res.json({
    appraisals: employeeId
      ? listAppraisals(employeeId)
      : listAllAppraisals({
          cycle: req.query.cycle || undefined,
          pending: req.query.pending === 'true',
        }),
  });
});

peopleRouter.post('/appraisals', (req, res) => {
  try {
    res.status(201).json(createAppraisal(Number(req.body?.employee_id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.patch('/appraisals/:id', (req, res) => {
  try {
    res.json(updateAppraisal(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

/** The only call here that moves money, and it is deliberately its own verb. */
peopleRouter.post('/appraisals/:id/apply', (req, res) => {
  try {
    res.json(applyAppraisal(Number(req.params.id), { by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.delete('/appraisals/:id', (req, res) => {
  try {
    res.json({ deleted: deleteAppraisal(Number(req.params.id), who(req)) });
  } catch (err) {
    bad(res, err);
  }
});

/* ---------------- assets ---------------- */

peopleRouter.get('/assets', (req, res) => {
  const assets = listAssets({
    employee_id: Number(req.query.employee_id) || undefined,
    company_id: Number(req.query.company_id) || undefined,
    branch_id: Number(req.query.branch_id) || undefined,
    out: req.query.out === 'true',
    written_off: req.query.written_off === 'true',
    round: req.query.round || undefined,
  });
  res.json({ assets, totals: registerTotals(assets), kinds: ASSET_KINDS });
});

/** Scanning a label. The code off a barcode scanner lands here. */
peopleRouter.get('/assets/by-code/:code', (req, res) => {
  const asset = getAssetByCode(req.params.code);
  if (!asset) return res.status(404).json({ error: `nothing on the register with the code ${req.params.code}` });
  res.json(asset);
});

peopleRouter.get('/assets/register.csv', (req, res) => {
  const assets = listAssets({
    company_id: Number(req.query.company_id) || undefined,
    written_off: req.query.written_off === 'true',
  });
  res.type('text/csv').attachment('asset-register.csv').send(registerCsv(assets));
});

peopleRouter.get('/assets/handovers.csv', (req, res) => {
  const handovers = listHandovers({
    employee_id: Number(req.query.employee_id) || undefined,
    open: req.query.open === 'true',
  });
  res.type('text/csv').attachment('asset-handovers.csv').send(handoverCsv(handovers));
});

peopleRouter.get('/assets/handovers', (req, res) => {
  res.json({
    handovers: listHandovers({
      asset_id: Number(req.query.asset_id) || undefined,
      employee_id: Number(req.query.employee_id) || undefined,
      open: req.query.open === 'true',
    }),
  });
});

/** One person's slip, to print and have signed. */
peopleRouter.get('/assets/slip/:employeeId', (req, res) => {
  const employee = getEmployee(Number(req.params.employeeId));
  if (!employee) return res.status(404).json({ error: 'employee not found' });
  res.json(
    handoverSlip({
      employee,
      company: employee.company_name,
      handovers: listHandovers({ employee_id: employee.id }),
    })
  );
});

/** The label, as an SVG the browser can print. */
/*
 * The sticker that goes on the thing.
 *
 * ?as=qr for a QR code, ?as=bar for the Code 128, anything else for both -
 * which is the default, because a phone camera reads the QR and the office's
 * laser scanner reads the barcode, and a sticker is printed once.
 */
peopleRouter.get('/assets/:id/label.svg', (req, res) => {
  const asset = getAsset(Number(req.params.id));
  if (!asset) return res.status(404).json({ error: 'not found' });
  if (!asset.code) return res.status(400).json({ error: 'that asset has no code to print' });

  const as = String(req.query.as || 'qr');
  if (as === 'bar') {
    const svg = barcodeSvg(asset.code, { heightMm: Number(req.query.h) || 12 });
    if (!svg) return res.status(400).json({ error: 'that code cannot be made into a barcode' });
    return res.type('image/svg+xml').send(svg);
  }

  const svg = qrSvg(as === 'text' ? asset.code : assetLink(req, asset.code), {
    qr,
    sizeMm: Number(req.query.mm) || 18,
    // Q survives a scuff, a thumbprint and a corner peeling off a vehicle.
    // A sticker gets exactly that, and the code is short enough to afford it.
    ecc: 'Q',
    // The caption is the code, always. A URL printed under a sticker is
    // unreadable and nobody types one off a laptop lid.
    label: asset.code,
  });
  if (!svg) return res.status(400).json({ error: 'that code cannot be made into a QR' });
  res.type('image/svg+xml').send(svg);
});

/**
 * A sheet of stickers to print, because nobody labels one asset at a time.
 *
 * Plain HTML with the SVGs inline and a print stylesheet: no PDF library, and
 * what comes out of the printer is what is on the screen. Sized in
 * millimetres, so a 40mm sticker is 40mm.
 */
peopleRouter.get('/assets/labels.html', (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((n) => Number(n))
    .filter(Boolean);

  const assets = (
    ids.length
      ? ids.map((id) => getAsset(id)).filter(Boolean)
      : listAssets({
          company_id: Number(req.query.company_id) || undefined,
          written_off: false,
        })
  ).filter((a) => a.code);

  const mm = Number(req.query.mm) || 18;
  const cells = assets
    .map((a) => {
      const svg =
        qrSvg(String(req.query.as) === 'text' ? a.code : assetLink(req, a.code), {
          qr,
          sizeMm: mm,
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

  res.type('html').send(
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
});

/**
 * The purchase voucher, to hand to accounts.
 *
 * Dinesh's rule: nobody releases money for a thing that is not on the
 * register. So this is printed FROM the asset rather than filled in - it
 * cannot exist unless the asset does, and its number carries the asset's own
 * code so the two can always be matched up.
 */
peopleRouter.get('/assets/:id/voucher.html', (req, res) => {
  const asset = getAsset(Number(req.params.id));
  if (!asset) return res.status(404).json({ error: 'not found' });

  const v = voucher(asset);
  const qrCode = asset.code
    ? qrSvg(assetLink(req, asset.code), { qr, sizeMm: 20, ecc: 'Q' }) || ''
    : '';

  const row = (k, val) => `<tr><th>${esc(k)}</th><td>${esc(val || '—')}</td></tr>`;

  res.type('html').send(
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
});

/* ---- photographs of the kit ---- */

peopleRouter.get('/assets/:id/photos', (req, res) => {
  if (!getAsset(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.json({ photos: listAssetPhotos(Number(req.params.id)).map(asPhoto) });
});

peopleRouter.post('/assets/:id/photos', uploadAssetPhoto, (req, res) => {
  try {
    const photo = addAssetPhoto({
      asset_id: Number(req.params.id),
      file_path: req.file?.filename,
      note: req.body?.note,
      taken_on: req.body?.taken_on,
      by: who(req),
    });
    res.status(201).json({ photo: asPhoto(photo) });
  } catch (err) {
    // The file is already on disk at this point; nothing points at it, so it
    // goes rather than sitting there forever.
    if (req.file?.filename) deletePhotoFile({ file_path: req.file.filename });
    bad(res, err);
  }
});

peopleRouter.delete('/assets/:id/photos/:photoId', (req, res) => {
  const photo = getAssetPhoto(Number(req.params.photoId));
  if (!photo || photo.asset_id !== Number(req.params.id)) {
    return res.status(404).json({ error: 'not found' });
  }
  deleteAssetPhoto(photo.id);
  deletePhotoFile(photo);
  res.status(204).end();
});

peopleRouter.get('/assets/:id/history', (req, res) => {
  const found = assetHistory(Number(req.params.id));
  if (!found) return res.status(404).json({ error: 'not found' });
  res.json(found);
});

peopleRouter.post('/assets', (req, res) => {
  try {
    res.status(201).json(createAsset({ ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.patch('/assets/:id', (req, res) => {
  try {
    res.json(updateAsset(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.post('/assets/:id/issue', (req, res) => {
  try {
    res.json(issueAsset(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.post('/assets/:id/return', (req, res) => {
  try {
    res.json(returnAsset(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.post('/assets/:id/write-off', (req, res) => {
  try {
    res.json(writeOffAsset(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.post('/assets/:id/verify', (req, res) => {
  try {
    res.json(verifyAsset(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.delete('/assets/:id', (req, res) => {
  try {
    res.json({ deleted: deleteAsset(Number(req.params.id), who(req)) });
  } catch (err) {
    bad(res, err);
  }
});

/* ---------------- maintenance ---------------- */

/** The register with each asset's running cost worked out, plus what is due. */
peopleRouter.get('/maintenance', (req, res) => {
  const assets = assetsWithOwnership({
    company_id: Number(req.query.company_id) || undefined,
    written_off: req.query.written_off === 'true',
  });
  /*
   * The spend side comes with it rather than as a second call: the panel asks
   * both questions on one screen - what is due, and what it is all costing -
   * and the services are already in hand to answer the first.
   */
  const services = listServices({
    company_id: Number(req.query.company_id) || undefined,
    limit: 5000,
  });
  res.json({
    assets,
    totals: maintenanceTotals(assets),
    alerts: maintenanceAlerts(assets),
    spend: spendReport(assets, services, { year: req.query.year || 'all' }),
    kinds: SERVICE_KINDS,
  });
});

peopleRouter.get('/maintenance/services', (req, res) => {
  res.json({
    services: listServices({
      asset_id: Number(req.query.asset_id) || undefined,
      company_id: Number(req.query.company_id) || undefined,
      from: req.query.from || undefined,
      to: req.query.to || undefined,
    }),
  });
});

peopleRouter.get('/maintenance/services.csv', (req, res) => {
  const services = listServices({
    company_id: Number(req.query.company_id) || undefined,
    from: req.query.from || undefined,
    to: req.query.to || undefined,
    limit: 2000,
  });
  res.type('text/csv').attachment('asset-services.csv').send(servicesCsv(services));
});

peopleRouter.get('/maintenance/ownership.csv', (req, res) => {
  const assets = assetsWithOwnership({
    company_id: Number(req.query.company_id) || undefined,
    written_off: true,
  });
  res.type('text/csv').attachment('asset-cost-of-ownership.csv').send(ownershipCsv(assets));
});

/**
 * Record a service.
 *
 * A duplicate comes back as 409 with the row it resembles, so the browser can
 * ask rather than refuse - two identical repairs on one day do happen, and a
 * system that will not record the truth gets worked around.
 */
peopleRouter.post('/assets/:id/services', (req, res) => {
  try {
    res.status(201).json(logService(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    if (err.duplicate) {
      return res.status(409).json({ error: err.message, duplicate: err.duplicate });
    }
    bad(res, err);
  }
});

peopleRouter.patch('/maintenance/services/:id', (req, res) => {
  try {
    res.json(updateService(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.delete('/maintenance/services/:id', (req, res) => {
  res.json({ deleted: deleteService(Number(req.params.id), who(req)) });
});

/* ---------------- the stock take ---------------- */

peopleRouter.get('/rounds', (_req, res) => {
  res.json({ rounds: listRounds() });
});

peopleRouter.get('/rounds/:round', (req, res) => {
  res.json(roundProgress(req.params.round));
});

/* ---------------- expense claims ---------------- */

peopleRouter.get('/claims', (req, res) => {
  res.json({
    claims: listClaims({
      employee_id: Number(req.query.employee_id) || undefined,
      status: req.query.status || undefined,
    }),
  });
});

peopleRouter.post('/claims', (req, res) => {
  try {
    res.status(201).json(createClaim(Number(req.body?.employee_id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.post('/claims/:id/decide', (req, res) => {
  try {
    res.json(decideClaim(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

/**
 * Pay it through a month's payroll. Kept apart from the decision on purpose:
 * approving says it is a real expense, paying says which month it came out of.
 */
peopleRouter.post('/claims/:id/pay', (req, res) => {
  try {
    res.json(payClaim(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.delete('/claims/:id', (req, res) => {
  try {
    res.json({ deleted: deleteClaim(Number(req.params.id), who(req)) });
  } catch (err) {
    bad(res, err);
  }
});

/* ---------------- leaving ---------------- */

peopleRouter.get('/exits', (req, res) => {
  const settled = req.query.settled === 'true' ? true : req.query.settled === 'false' ? false : undefined;
  res.json({ exits: listExits({ settled }) });
});

peopleRouter.get('/exits/:employeeId', (req, res) => {
  const found = fullAndFinal(Number(req.params.employeeId));
  if (!found) return res.status(404).json({ error: 'nothing recorded for this person' });
  res.json(found);
});

peopleRouter.put('/exits/:employeeId', (req, res) => {
  try {
    saveExit(Number(req.params.employeeId), { ...req.body, by: who(req) });
    res.json(fullAndFinal(Number(req.params.employeeId)));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.post('/exits/:employeeId/settle', (req, res) => {
  try {
    markSettled(Number(req.params.employeeId), { ...req.body, by: who(req) });
    res.json(fullAndFinal(Number(req.params.employeeId)));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.delete('/exits/:employeeId', (req, res) => {
  try {
    res.json({ deleted: deleteExit(Number(req.params.employeeId), who(req)) });
  } catch (err) {
    bad(res, err);
  }
});

/* ---------------- audit trail ---------------- */

peopleRouter.get('/audit', (req, res) => {
  res.json({
    entries: listAudit({
      entity: req.query.entity || undefined,
      entity_id: Number(req.query.entity_id) || undefined,
      who: req.query.who || undefined,
      since: req.query.since || undefined,
      limit: req.query.limit,
    }),
  });
});

/* ---------------- tasks ---------------- */

peopleRouter.get('/tasks', (req, res) => {
  res.json({
    tasks: listTasks({
      employee_id: Number(req.query.employee_id) || undefined,
      status: req.query.status || undefined,
    }),
  });
});

peopleRouter.post('/tasks', (req, res) => {
  try {
    res.status(201).json(createTask({ ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.patch('/tasks/:id', (req, res) => {
  try {
    res.json(updateTask(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.post('/tasks/:id/status', (req, res) => {
  try {
    res.json(setTaskStatus(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.delete('/tasks/:id', (req, res) => {
  try {
    res.json({ deleted: deleteTask(Number(req.params.id), who(req)) });
  } catch (err) {
    bad(res, err);
  }
});

/* ---------------- helpdesk ---------------- */

peopleRouter.get('/tickets', (req, res) => {
  res.json({
    tickets: listTickets({
      employee_id: Number(req.query.employee_id) || undefined,
      status: req.query.status || undefined,
    }),
  });
});

peopleRouter.get('/tickets/:id', (req, res) => {
  const ticket = getTicket(Number(req.params.id));
  if (!ticket) return res.status(404).json({ error: 'not found' });
  res.json(ticket);
});

peopleRouter.post('/tickets', (req, res) => {
  try {
    res.status(201).json(createTicket(Number(req.body?.employee_id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.post('/tickets/:id/reply', (req, res) => {
  try {
    res.json(
      replyToTicket(Number(req.params.id), {
        side: 'office',
        author: who(req),
        body: req.body?.body,
      })
    );
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.post('/tickets/:id/close', (req, res) => {
  try {
    res.json(closeTicket(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.post('/tickets/:id/reopen', (req, res) => {
  try {
    res.json(reopenTicket(Number(req.params.id), { by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

/* ---------------- the digest ---------------- */

/**
 * Everything waiting on somebody, as text.
 *
 * It assembles and does not send. There is no WhatsApp session here on purpose:
 * the task assistant already holds one, and a second session on the same
 * personal number is a risk to the number. Email needs an SMTP account, which
 * is a decision about credentials rather than code. So this returns the text,
 * ready to paste or to be fetched by a cron that posts it wherever Dinesh wants.
 */
peopleRouter.get('/digest', (req, res) => {
  // The open month, unless one is named. sync:false - reading this must not
  // open rows or post loan instalments as a side effect of a reminder.
  const periods = listPeriods();
  const wanted = Number(req.query.period_id) || periods.find((p) => !p.locked)?.id || periods[0]?.id;
  const payroll = wanted ? buildPayroll(wanted, { sync: false }) : null;

  const exits = listExits({ settled: false });
  const leaverIds = new Set(exits.map((e) => e.employee_id));

  const built = digest({
    period: payroll?.period || null,
    rows: payroll?.rows || [],
    requests: listRequests({}),
    claims: listClaims({}),
    tickets: listTickets({}),
    tasks: listTasks({ status: 'open' }),
    exits,
    assets_out: listAssets({ out: true }).filter((a) => leaverIds.has(a.employee_id)),
    today: new Date().toISOString().slice(0, 10),
  });

  if (req.query.format === 'text') {
    res.type('text/plain').send(`${built.heading}\n\n${built.text}`);
    return;
  }
  res.json(built);
});
