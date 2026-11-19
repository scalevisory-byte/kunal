import { Router } from 'express';
import { may } from '../../../shared/rights.js';
import { requireArea } from '../auth.js';
import { digest } from '../../../shared/digest.js';
import { buildPayroll } from '../payroll.js';
import { listPeriods } from '../db.js';
import { listRequests } from '../attendanceSelf.js';
import { getEmployee } from '../db.js';
import { listDocuments } from '../db.js';
import { barcodeSvg } from '../../../shared/barcode.js';
import qr from 'qrcode-generator';
import { qrSvg } from '../../../shared/qr.js';
import { labelSheet, labelSvg, voucherHtml } from '../../../shared/assetLabels.js';
import { assetDashboard, purchaseYears } from '../../../shared/assetDashboard.js';
import { financialYear } from '../../../shared/assetStatus.js';
import { config } from '../config.js';
import ExcelJS from 'exceljs';
import multer from 'multer';
import { planAssetImport } from '../../../shared/assetImport.js';
import { listCompanies, listEmployees } from '../db.js';
import { licensesCsv, seatsCsv, suggestRenewal } from '../../../shared/licenses.js';
import { assetAlerts } from '../../../shared/assetAlerts.js';

/* In memory: the sheet is read once and never kept. 8 MB covers an office's
   whole asset list many times over. */
const assetSheet = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
import { deletePhotoFile, photoLink, uploadAssetPhoto } from '../assetPhotos.js';
import { deleteDocFile, docLink, uploadAssetDoc } from '../assetDocs.js';

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
/* The path never leaves the server - the same rule the CVs and the KYC follow. */
const asDoc = ({ file_path, ...rest }) => ({ ...rest, link: docLink({ ...rest, file_path }) });

/* The sticker sheet is the only HTML this router sends, and an asset's name is
   typed by somebody. */
const esc = (v) =>
  String(v ?? '').replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[c])
  );
import { handoverCsv, handoverSlip, registerCsv, registerTotals } from '../../../shared/assetReport.js';
import { PENALTY_KINDS, penaltyReport } from '../../../shared/penalties.js';
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
  listVerifications,
  listAssetDocs,
  getAssetDoc,
  addAssetDoc,
  deleteAssetDoc,
  ASSET_DOC_KINDS,
  assetPrefixes,
  nextAssetCode,
  renumberAssets,
  renumberPreview,
  setAssetPrefix,
  setAssetState,
  acknowledgeHandover,
  listMasters,
  createMaster,
  updateMaster,
  deleteMaster,
  MASTER_KINDS,
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
  createPenalty,
  deletePenalty,
  getPenalty,
  listPenalties,
  listRecoveries,
  previewRecovery,
  recoverPenalty,
  updatePenalty,
  waivePenalty,
  reopenTicket,
  replyToTicket,
  returnAsset,
  saveExit,
  setTaskStatus,
  updateAppraisal,
  updateAsset,
  updateNote,
  updateTask,
  assignSeat,
  cancelLicense,
  createLicense,
  deleteLicense,
  getLicense,
  licenseRegister,
  listLicenseSeats,
  listLicenses,
  releaseSeat,
  renewLicense,
  revealLicenseKey,
  uncancelLicense,
  updateLicense,
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

/*
 * WHICH RIGHT THIS PATH NEEDS.
 *
 * One router, three tabs. The people registers (warnings, claims, penalties,
 * tickets, exits) need `people`; the asset register, its masters, its
 * maintenance and its stock takes need `assets`; the licence register needs
 * `license`, which is its own right because that is where the Tally and
 * Windows keys are.
 *
 * It is decided HERE and nowhere else. It used to be decided twice - a mount
 * in server.js for /api/people/assets and requireArea('people') on the router
 * - and both ran, so a login ticked to Assets alone passed the first, was
 * refused by the second, and had no asset register at all. The existing test
 * only ever checked that a login WITHOUT a right was refused; nobody had
 * checked that a login WITH one could work.
 */
const AREA_FOR_PATH = [
  [/^\/(assets|asset-masters|maintenance|rounds)\b/, 'assets'],
  [/^\/licenses\b/, 'license'],
];

peopleRouter.use((req, res, next) => {
  const path = req.path || '';
  /*
   * The pickers are open to anybody who carries any of the three: they are
   * lists of kinds and labels, and the Assets tab cannot draw its form
   * without them.
   */
  if (/^\/options\b/.test(path)) {
    if (['assets', 'license', 'people'].some((area) => may(req.actor, area))) return next();
  }
  const area = AREA_FOR_PATH.find(([pattern]) => pattern.test(path))?.[1] || 'people';
  return requireArea(area)(req, res, next);
});

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

/*
 * The next code for a company, so the Add Asset form can show it before
 * anything is saved. It RESERVES NOTHING - looking at a number does not take
 * it, and the code is drawn again inside the insert where the unique index
 * decides. Two people with the form open see the same number and exactly one
 * of them keeps it.
 */
peopleRouter.get('/assets/next-code', (req, res) =>
  res.json({ code: nextAssetCode(Number(req.query.company_id) || null) })
);

/* The prefixes, and what each company's series looks like today. */
peopleRouter.get('/assets/prefixes', (req, res) => res.json({ companies: assetPrefixes() }));

/* What renumbering would do. Changes nothing. */
peopleRouter.get('/assets/renumber', (req, res) =>
  res.json(renumberPreview({ company_id: Number(req.query.company_id) || null }))
);

peopleRouter.post('/assets/renumber', (req, res) => {
  try {
    res.json(renumberAssets({ company_id: Number(req.body?.company_id) || null, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.put('/assets/prefixes/:companyId', (req, res) => {
  try {
    res.json(setAssetPrefix(Number(req.params.companyId), req.body?.prefix, { by: who(req) }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

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
  const { svg, problem, status } = labelSvg(asset, {
    qr,
    as: String(req.query.as || 'qr'),
    heightMm: req.query.h,
    sizeMm: req.query.mm,
    link: assetLink(req, asset.code),
  });
  if (problem) return res.status(status || 400).json({ error: problem });
  res.type('image/svg+xml').send(svg);
});

/** A sheet of stickers, because nobody labels one asset at a time. */
peopleRouter.get('/assets/labels.html', (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((n) => Number(n))
    .filter(Boolean);

  const assets = ids.length
    ? ids.map((id) => getAsset(id)).filter(Boolean)
    : listAssets({
        company_id: Number(req.query.company_id) || undefined,
        written_off: false,
      });

  res.type('html').send(
    labelSheet(assets, {
      qr,
      mm: req.query.mm,
      as: req.query.as,
      linkFor: (a) => assetLink(req, a.code),
    })
  );
});

/**
 * The asset voucher: what was bought, from whom, on what bill, for how much.
 */
peopleRouter.get('/assets/:id/voucher.html', (req, res) => {
  const asset = getAsset(Number(req.params.id));
  if (!asset) return res.status(404).json({ error: 'not found' });
  res.type('html').send(voucherHtml(asset, { qr, link: assetLink(req, asset.code) }));
});

/* The paperwork: the invoice, the warranty card, the delivery note. */
peopleRouter.get('/assets/:id/documents', (req, res) => {
  if (!getAsset(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.json({ documents: listAssetDocs(Number(req.params.id)).map(asDoc), kinds: ASSET_DOC_KINDS });
});

peopleRouter.post('/assets/:id/documents', uploadAssetDoc, (req, res) => {
  try {
    const doc = addAssetDoc({
      asset_id: Number(req.params.id),
      file_path: req.file?.filename,
      // Kept only to show on screen; the path is the generated name.
      file_name: req.file?.originalname,
      kind: req.body?.kind,
      number: req.body?.number,
      dated: req.body?.dated,
      note: req.body?.note,
      by: who(req),
    });
    res.status(201).json({ document: asDoc(doc) });
  } catch (err) {
    // The file is already on disk; nothing points at it, so it goes rather
    // than sitting there forever.
    if (req.file?.filename) deleteDocFile({ file_path: req.file.filename });
    bad(res, err);
  }
});

peopleRouter.delete('/assets/:id/documents/:docId', (req, res) => {
  const doc = getAssetDoc(Number(req.params.docId));
  if (!doc || doc.asset_id !== Number(req.params.id)) {
    return res.status(404).json({ error: 'not found' });
  }
  deleteAssetDoc(doc.id);
  deleteDocFile(doc);
  res.status(204).end();
});

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
    // A serial already on the register is a QUESTION, not a refusal: serials
    // get retyped off a sticker and two boxes really do carry the same one.
    if (err.duplicate) return res.status(409).json({ error: err.message, duplicate: err.duplicate });
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
/**
 * The asset dashboard.
 *
 * Every figure is counted from the SAME register the Asset Register screen
 * shows, filtered the same way, and each card hands back the filter that
 * produced it - so a card saying 14 and a list showing 13 cannot happen.
 */
peopleRouter.get('/assets/dashboard', (req, res) => {
  const filter = {
    company_id: Number(req.query.company_id) || undefined,
    branch_id: Number(req.query.branch_id) || undefined,
  };
  // Written-off assets are counted, because "what have we spent on kit" has
  // to include the laptop that was scrapped last year.
  const all = listAssets({ ...filter, written_off: true });
  const category = req.query.category || '';
  const year = req.query.year || '';
  const assets = all
    .filter((a) => !category || a.kind === category)
    .filter((a) => !year || financialYear(a.purchase_date) === year);
  const ids = new Set(assets.map((a) => a.id));

  const round = req.query.round || listRounds()[0]?.round || null;
  res.json({
    ...assetDashboard({
      assets,
      handovers: listHandovers({}).filter((h) => ids.has(h.asset_id)),
      services: listServices({ limit: 5000 }).filter((s) => ids.has(s.asset_id)),
      verifications: listVerifications(round),
      round,
      soon: Number(req.query.soon) || 30,
    }),
    round,
    years: purchaseYears(all),
    categories: [...new Set(all.map((a) => a.kind).filter(Boolean))].sort(),
    /*
     * The departments the register actually uses, not a master list. A
     * department is free text on the asset, so the only honest picker is the
     * set of values somebody has really typed - offering a department no
     * asset carries gives an empty list and no reason why.
     *
     * Folded case-insensitively, because Accounts and ACCOUNTS are one room.
     */
    departments: [
      ...new Map(
        all
          .map((a) => String(a.department || '').trim())
          .filter(Boolean)
          .map((d) => [d.toLowerCase(), d])
      ).values(),
    ].sort((a, b) => a.localeCompare(b)),
  });
});

/** Under maintenance, damaged, missing - or back in use. */
peopleRouter.post('/assets/:id/state', (req, res) => {
  try {
    res.json(setAssetState(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

/** The employee signing for what they were handed. */
peopleRouter.post('/assets/handovers/:id/acknowledge', (req, res) => {
  try {
    res.json(acknowledgeHandover(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

/* ---------------- the lists behind the pickers ---------------- */

peopleRouter.get('/asset-masters', (req, res) =>
  res.json({ masters: listMasters(req.query.kind || undefined), kinds: MASTER_KINDS })
);

peopleRouter.post('/asset-masters', (req, res) => {
  try {
    res.status(201).json(createMaster(req.body || {}));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.patch('/asset-masters/:id', (req, res) => {
  try {
    res.json(updateMaster(Number(req.params.id), req.body || {}));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.delete('/asset-masters/:id', (req, res) => {
  res.json({ deleted: deleteMaster(Number(req.params.id)) });
});

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

/* ---------------- penalties: fines, losses, damage ---------------- */

peopleRouter.get('/penalties', (req, res) => {
  const penalties = listPenalties({
    employee_id: Number(req.query.employee_id) || undefined,
    status: req.query.status || undefined,
    company_id: Number(req.query.company_id) || undefined,
  });
  res.json({
    penalties,
    kinds: PENALTY_KINDS,
    // The register, in the same call: nobody wants a second round trip to see
    // what the month's fines add up to.
    report: penaltyReport(penalties, { from: req.query.from, to: req.query.to }),
  });
});

peopleRouter.get('/penalties/:id', (req, res) => {
  const penalty = getPenalty(Number(req.params.id));
  if (!penalty) return res.status(404).json({ error: 'not found' });
  res.json({ penalty, recoveries: listRecoveries(penalty.id) });
});

peopleRouter.post('/penalties', (req, res) => {
  try {
    res.status(201).json(createPenalty(req.body, who(req)));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.patch('/penalties/:id', (req, res) => {
  try {
    res.json(updatePenalty(Number(req.params.id), req.body, who(req)));
  } catch (err) {
    bad(res, err);
  }
});

/**
 * What a recovery WOULD do - the amount, what is already coming out of that
 * row, and what the Payment of Wages Act says about the total. Read-only, and
 * shown before the button, because a deduction is easy to make and hard to
 * undo.
 */
peopleRouter.get('/penalties/:id/preview', (req, res) => {
  try {
    res.json(
      previewRecovery(Number(req.params.id), {
        period_id: Number(req.query.period_id),
        amount: req.query.amount,
      })
    );
  } catch (err) {
    bad(res, err);
  }
});

/** The ONE call that moves money, and it names the month it comes out of. */
peopleRouter.post('/penalties/:id/recover', (req, res) => {
  try {
    res.json(recoverPenalty(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.post('/penalties/:id/waive', (req, res) => {
  try {
    res.json(waivePenalty(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.delete('/penalties/:id', (req, res) => {
  try {
    res.json({ deleted: deletePenalty(Number(req.params.id), who(req)) });
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
/**
 * The most recent review for each person, so a superseded one does not read
 * as a second appraisal falling due.
 */
function latestReviews(rows, byEmployee) {
  const newest = new Map();
  for (const row of rows) {
    const seen = newest.get(row.employee_id);
    if (!seen || String(row.reviewed_on) > String(seen.reviewed_on)) newest.set(row.employee_id, row);
  }
  return [...newest.values()]
    .filter((row) => byEmployee.get(row.employee_id)?.active !== 0)
    .map((row) => ({ ...row, employee_name: row.employee_name || byEmployee.get(row.employee_id)?.name }));
}

peopleRouter.get('/digest', (req, res) => {
  // The open month, unless one is named. sync:false - reading this must not
  // open rows or post loan instalments as a side effect of a reminder.
  const periods = listPeriods();
  const wanted = Number(req.query.period_id) || periods.find((p) => !p.locked)?.id || periods[0]?.id;
  const payroll = wanted ? buildPayroll(wanted, { sync: false }) : null;

  const exits = listExits({ settled: false });
  const leaverIds = new Set(exits.map((e) => e.employee_id));

  /*
   * Three dates the office is meant to remember: probation ending, a document
   * running out, a review falling due. Read from where they already live - no
   * new table, and nothing is computed twice.
   */
  const staff = listEmployees({});
  const byEmployee = new Map(staff.map((e) => [e.id, e]));
  const documents = staff
    .flatMap((e) => listDocuments(e.id).map((d) => ({ ...d, employee_name: e.name })))
    .filter((d) => d.expires_on);

  const built = digest({
    period: payroll?.period || null,
    rows: payroll?.rows || [],
    requests: listRequests({}),
    claims: listClaims({}),
    tickets: listTickets({}),
    tasks: listTasks({ status: 'open' }),
    exits,
    assets_out: listAssets({ out: true }).filter((a) => leaverIds.has(a.employee_id)),
    employees: staff,
    documents,
    // Only the latest review per person carries a live "next" date; an older
    // one that has been superseded would read as a second appraisal due.
    appraisals: latestReviews(listAllAppraisals({}), byEmployee),
    /*
     * Already dressed, so the digest reads the same status the licence tab
     * shows rather than working one out of its own.
     *
     * And ONLY for a login that carries the licence right. The digest lives
     * under the people right, so without this a login narrowed to People
     * would read the names and renewal dates of software it has no tab for -
     * a right that a summary quietly walks around is not a right.
     */
    licenses: may(req.actor, 'license') ? listLicenses({}) : [],
    // Same scoping: a login with no asset register is not told what is out of
    // warranty on it.
    asset_dates: may(req.actor, 'assets') ? assetAlerts(listAssets({})) : null,
    today: new Date().toISOString().slice(0, 10),
  });

  if (req.query.format === 'text') {
    res.type('text/plain').send(`${built.heading}\n\n${built.text}`);
    return;
  }
  res.json(built);
});

/* ---------------- an existing asset list, out of Excel ---------------- */

/**
 * Dry run, then write. Nothing is created until somebody has seen what would
 * be - an import that silently makes two hundred duplicates is worse than no
 * import at all.
 *
 * `?write=true` does it for real. Everything else about the two calls is
 * identical, deliberately: the plan you approve is the plan that runs.
 */
peopleRouter.post('/assets/import', assetSheet.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
    const wanted = String(req.body.sheet || '').trim().toLowerCase();
    const ws =
      (wanted && wb.worksheets.find((s) => s.name.trim().toLowerCase() === wanted)) ||
      wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: 'that file has no sheets' });

    const rows = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
      // ExcelJS indexes from 1 and puts a hole at 0; the planner wants a plain
      // array, and a formula cell has to give its cached result, not "=SUM(...)".
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(values.map((v) => (v && typeof v === 'object' && 'result' in v ? v.result : v)));
    });

    /*
     * WHOSE ASSETS THESE ARE, when the sheet does not say.
     *
     * His 1,008-row list has no company column at all, so every row came in
     * with no company - which left the company filter showing nothing for a
     * thousand assets, and gave every generated code the GEN- prefix because
     * there was no company series to join.
     *
     * A sheet that DOES name a company still wins, row by row. This only
     * fills the blanks.
     */
    const fallbackCompany = Number(req.body.company_id) || null;

    const plan = planAssetImport({
      rows,
      existing: listAssets({}),
      /*
       * Everybody, active or not. `active: false` would have asked for the
       * INACTIVE ones only - so every current employee's name came back
       * "not on the staff list" and nothing was matched to a holder.
       * Somebody who has left can still be holding a laptop, which is why
       * this is not narrowed to the active list either.
       */
      employees: listEmployees({}),
      companies: listCompanies(),
    });
    if (plan.problem) return res.status(400).json(plan);

    const write = String(req.body.write) === 'true';
    if (!write) {
      return res.json({
        ...plan,
        sheet: ws.name,
        sheets: wb.worksheets.map((s) => s.name),
        wrote: 0,
        updated: 0,
      });
    }

    if (fallbackCompany) {
      for (const asset of [...plan.create, ...plan.update]) {
        if (!asset.company_id) asset.company_id = fallbackCompany;
      }
    }

    let wrote = 0;
    let updated = 0;
    /*
     * ONE BAD ROW MUST NOT TAKE THE FILE DOWN.
     *
     * Six of Dinesh's thousand rows carried brackets in the asset code. The
     * first of them threw, the request died with a 500 - and 998 assets had
     * ALREADY been written. A partial import with no report is the worst
     * outcome there is: the register is wrong and nothing says where.
     *
     * So every row is tried on its own and a failure is collected by row
     * number and reason. The ones that worked stay; the ones that did not are
     * named, so the sheet can be fixed and imported again.
     */
    const failed = [];
    const why = (err) => String(err?.message || err || 'could not be saved');

    for (const asset of plan.create) {
      try {
      const made = createAsset({
        company_id: asset.company_id,
        kind: asset.kind,
        label: asset.label,
        /*
         * THE SHEET'S ID BECOMES old_code AND A NEW ONE IS DRAWN.
         *
         * Dinesh: "imported assets ko bhi naya code do". His own sheet's IDs
         * are a mixed bag - BNF-Assets-2456 beside BNF-AST-Big Storage
         * (Almari)-0006 - and he wants one uniform series. Keeping the
         * original is not optional: the sticker is on the desk, and the
         * import recognises rows by it.
         */
        old_code: asset.code || undefined,
        identifier: asset.identifier,
        purchase_cost: asset.purchase_cost,
        purchase_date: asset.purchase_date || null,
        vendor: asset.vendor,
        invoice_no: asset.invoice_no,
        warranty_until: asset.warranty_until || null,
        model: asset.model || null,
        location: asset.location || null,
        floor_room: asset.floor_room || null,
        condition: asset.condition || null,
        note: asset.note,
        // The holder is set ONLY where the name matched somebody real. An
        // unmatched name is reported, never guessed at.
        employee_id: asset.employee_id,
        issued_on: asset.employee_id ? asset.purchase_date || null : null,
        by: req.body.by || 'import',
      });
      /*
       * Only the two states that cannot be worked out from the rows
       * themselves - in for repair, and taken out of service. Available and
       * Assigned are DERIVED from the holder (see shared/assetStatus.js), so
       * writing them would be a second opinion that drifts.
       */
      if (asset.state && made?.id) {
        setAssetState(made.id, {
          state: asset.state,
          note: 'from the imported list',
          by: req.body.by || 'import',
        });
      }
      wrote++;
      } catch (err) {
        failed.push({ row: asset.row, code: asset.code, label: asset.label, why: why(err) });
      }
    }
    for (const asset of plan.update) {
      /*
       * Only the fields the sheet actually carries, and only where it has
       * something to say. An import must not blank a purchase date somebody
       * typed in here because the spreadsheet's column was empty.
       */
      const patch = {};
      for (const field of [
        'identifier', 'vendor', 'invoice_no', 'note',
        'model', 'location', 'floor_room', 'condition',
      ]) {
        if (asset[field]) patch[field] = asset[field];
      }
      // Fill a company in where the asset has none; never move one that has.
      if (asset.company_id && !asset.was?.company_id) patch.company_id = asset.company_id;
      for (const field of ['purchase_date', 'warranty_until']) {
        if (asset[field]) patch[field] = asset[field];
      }
      if (asset.purchase_cost > 0) patch.purchase_cost = asset.purchase_cost;
      try {
        if (Object.keys(patch).length) updateAsset(asset.id, patch);
        updated++;
      } catch (err) {
        failed.push({ row: asset.row, code: asset.code, label: asset.label, why: why(err) });
      }
    }

    res.json({ ...plan, sheet: ws.name, wrote, updated, failed });
  } catch (err) {
    next(err);
  }
});

/* ================================================================= *
 * SOFTWARE LICENCES
 *
 * The register, its seats and its renewals. Two things to know about these
 * routes before changing them:
 *
 *   NO ROUTE HERE RETURNS A LICENCE KEY except `/licenses/:id/key`, which
 *   writes to the audit trail every time it answers. The reads do not select
 *   the column at all - they take whether there is one and its last four
 *   characters - so a key cannot leak through a response somebody forgot
 *   about.
 *
 *   Over-allocation comes back as part of the answer, never as a refusal.
 *   Eleven installs on a ten-seat licence is a fact to report.
 * ================================================================= */

peopleRouter.get('/licenses', (req, res) => {
  res.json(
    licenseRegister({
      company_id: Number(req.query.company_id) || undefined,
      soon: Number(req.query.soon) || 30,
    })
  );
});

peopleRouter.get('/licenses.csv', (req, res) => {
  const { licenses } = licenseRegister({ company_id: Number(req.query.company_id) || undefined });
  // The key is not a column in LICENSE_COLUMNS, deliberately, and there is a
  // test for it: an export is emailed and opened on somebody's home laptop.
  res.type('text/csv').attachment('software-licences.csv').send(licensesCsv(licenses));
});

peopleRouter.get('/licenses/seats.csv', (req, res) => {
  res.type('text/csv').attachment('licence-seats.csv').send(seatsCsv(listLicenseSeats({})));
});

peopleRouter.get('/licenses/:id', (req, res) => {
  const license = getLicense(Number(req.params.id));
  if (!license) return res.status(404).json({ error: 'not found' });
  res.json({ license, suggested: suggestRenewal(license) });
});

/**
 * The whole key, once.
 *
 * A GET rather than a POST would be cacheable, logged in a proxy and bookmarked
 * - none of which should ever hold a licence key. It is a POST, and it is on
 * the trail.
 */
peopleRouter.post('/licenses/:id/key', (req, res) => {
  try {
    res.json(revealLicenseKey(Number(req.params.id), { by: who(req), why: req.body?.why }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.post('/licenses', (req, res) => {
  try {
    res.status(201).json(createLicense({ ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.patch('/licenses/:id', (req, res) => {
  try {
    res.json(updateLicense(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.post('/licenses/:id/cancel', (req, res) => {
  try {
    res.json(cancelLicense(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.post('/licenses/:id/uncancel', (req, res) => {
  try {
    res.json(uncancelLicense(Number(req.params.id), who(req)));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.delete('/licenses/:id', (req, res) => {
  try {
    res.json({ deleted: deleteLicense(Number(req.params.id), who(req)) });
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.post('/licenses/:id/seats', (req, res) => {
  try {
    res.status(201).json(assignSeat(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.post('/licenses/seats/:id/release', (req, res) => {
  try {
    res.json(releaseSeat(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.post('/licenses/:id/renew', (req, res) => {
  try {
    res.json(renewLicense(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});
