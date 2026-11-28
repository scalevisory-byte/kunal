import path from 'node:path';
import { Router } from 'express';
import {
  assetRequestsWaiting,
  createAssetRequest,
  deleteAssetRequest,
  getAssetRequest,
  listAssetRequests,
  moveAssetRequest,
  updateAssetRequest,
} from '../assetRequests.js';
import { profileChangesWaiting } from '../profileChanges.js';
import { may } from '../../../shared/rights.js';
import { requireArea, requireAbility as requireAbilityLocal } from '../auth.js';
import { cleanSteps, renewalOverview } from '../../../shared/renewals.js';
import { getSetting, setSetting } from '../db.js';
import { digest } from '../../../shared/digest.js';
import { dailyReport, normaliseShape } from '../../../shared/dailyReport.js';
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
import { assetLedger, ledgerCsv, ledgerTransactions, transactionsCsv } from '../../../shared/assetLedger.js';
import { assetStatement, statementCsv } from '../../../shared/assetStatement.js';
import { ASSET_FIELDS, assetExportCsv, buildAssetExport, cleanFields, fieldGroups } from '../../../shared/assetExport.js';
import {
  REPORTS,
  buildServiceExport,
  cleanServiceFields,
  reportFor,
  serviceExportCsv,
  serviceFieldGroups,
} from '../../../shared/serviceExport.js';

/* In memory: the sheet is read once and never kept. 8 MB covers an office's
   whole asset list many times over. */
const assetSheet = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
import { deletePhotoFile, photoLink, uploadAssetPhoto } from '../assetPhotos.js';
import { deleteDocFile, docLink, uploadAssetDoc } from '../assetDocs.js';
import { removeVoucher, uploadVoucher, voucherPath } from '../claimVouchers.js';

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
import { todayIso } from '../../../shared/today.js';
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
  claimVoucherFile,
  setClaimVoucher,
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
  setAssetNature,
  listAssetClaims,
  decideAssetClaim,
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
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
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
  clearanceFor,
  setClearance,
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
  returnAssets,
  transferAssets,
  exitLetter,
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
  licenseActivity,
  logDueReminders,
  moveLicenseStage,
  recentLicenseActivity,
  reminderHistory,
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

/* ---------------- the noticeboard ---------------- */

/*
 * Dinesh: *"any announcmnet like celbration holiday o bhi"*.
 *
 * The staff portal's Announcements card used to say, in so many words, that
 * there was no noticeboard in the system to read from. This is the board.
 * Nothing is SENT anywhere: the office pins something, the staff see it when
 * they sign in, and it comes down when it is over.
 */
peopleRouter.get('/announcements', (req, res) =>
  res.json({
    announcements: listAnnouncements({
      company_id: Number(req.query.company_id) || undefined,
      live: req.query.live === 'true',
    }),
  })
);

peopleRouter.post('/announcements', (req, res) => {
  try {
    res.status(201).json(createAnnouncement(req.body || {}, who(req)));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.patch('/announcements/:id', (req, res) => {
  try {
    res.json(updateAnnouncement(Number(req.params.id), req.body || {}, who(req)));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.delete('/announcements/:id', (req, res) => {
  res.json({ deleted: deleteAnnouncement(Number(req.params.id), who(req)) });
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
/**
 * ONE PERSON'S ASSET LEDGER — everything they have ever been given.
 *
 * Both halves are fetched and handed over together: the handover LOG, which
 * says what happened, and the REGISTER, which says what stands against them
 * now. The two answer different questions, so the ledger asks both rather
 * than working one out from the other - that is how an asset imported with a
 * holder and no slip gets reported instead of vanishing.
 */
const ledgerFor = (employee, { from, to } = {}) => {
  const ledger = assetLedger({
    employee,
    handovers: listHandovers({ employee_id: employee.id }),
    assets: listAssets({ employee_id: employee.id }),
  });

  /*
   * The movement ledger needs three more things, and all three are read
   * rather than guessed:
   *
   *   the OTHER handovers of the same assets, which is the only evidence a
   *   return was really a transfer to somebody else;
   *   the SERVICES on those assets, for the maintenance lines;
   *   and nothing else - a movement this app cannot see is not written down.
   */
  const ids = new Set(ledger.lines.map((l) => Number(l.asset_id)));
  const others = [...ids]
    .flatMap((id) => listHandovers({ asset_id: id }))
    .filter((h) => Number(h.employee_id) !== Number(employee.id));
  const services = [...ids].flatMap((id) => listServices({ asset_id: id }));

  return {
    ...ledger,
    services,
    book: ledgerTransactions({ lines: ledger.lines, others, services, from, to }),
  };
};

peopleRouter.get('/assets/ledger/:employeeId', (req, res) => {
  const employee = getEmployee(Number(req.params.employeeId));
  if (!employee) return res.status(404).json({ error: 'employee not found' });
  res.json({
    ledger: ledgerFor(employee, { from: req.query.from, to: req.query.to }),
    /*
     * Who comes before and after, so the page can step through people
     * without going back to the list. Only those holding something - which
     * is who the Who-holds-what list shows - and in the same order.
     */
    neighbours: (() => {
      const holders = [
        ...new Map(
          listAssets({ out: true })
            .filter((a) => a.employee_id)
            .map((a) => [a.employee_id, { id: a.employee_id, name: a.employee_name }])
        ).values(),
      ].sort((a, b) => String(a.name).localeCompare(String(b.name)));
      const at = holders.findIndex((h) => Number(h.id) === Number(employee.id));
      return {
        all: holders,
        previous: at > 0 ? holders[at - 1] : null,
        next: at >= 0 && at < holders.length - 1 ? holders[at + 1] : null,
      };
    })(),
    /*
     * Who it could go to, for a transfer straight off this page. Three
     * fields only: a picker has no business being handed everybody's salary,
     * and this list is already in the browser of anybody who can see the
     * register. Anyone on the staff can receive something, so the list is
     * not narrowed to holders the way neighbours is - only people who have
     * left, since handing a laptop to somebody who no longer works here is a
     * mistake and not a transfer.
     */
    people: listEmployees({ active: true })
      .filter((e) => Number(e.id) !== Number(employee.id))
      .map((e) => ({ id: e.id, name: e.name, code: e.employee_code || '', company_name: e.company_name || '' })),
  });
});

/** The movement ledger as a CSV: opening, every line, closing. */
peopleRouter.get('/assets/ledger/:employeeId/transactions.csv', (req, res) => {
  const employee = getEmployee(Number(req.params.employeeId));
  if (!employee) return res.status(404).json({ error: 'employee not found' });
  const ledger = ledgerFor(employee, { from: req.query.from, to: req.query.to });
  const name = String(employee.name || 'employee').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  res.type('text/csv').attachment(`${name}-asset-ledger.csv`).send(transactionsCsv(ledger, ledger.book));
});

peopleRouter.get('/assets/ledger/:employeeId.csv', (req, res) => {
  const employee = getEmployee(Number(req.params.employeeId));
  if (!employee) return res.status(404).json({ error: 'employee not found' });
  const name = String(employee.name || 'employee').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  res.type('text/csv').attachment(`${name}-assets.csv`).send(ledgerCsv(ledgerFor(employee)));
});

/**
 * THE WHOLE REGISTER AS ONE STATEMENT — "total asset ka register".
 *
 * Written-off assets are FETCHED (written_off: true means "include them"),
 * because the statement reports them in their own block at the foot. They are
 * never inside the total, and the engine is what keeps them out.
 */
const statementFor = (req) =>
  assetStatement(
    listAssets({
      company_id: Number(req.query.company_id) || undefined,
      branch_id: Number(req.query.branch_id) || undefined,
      written_off: true,
    }),
    { by: ['group', 'person'].includes(String(req.query.by)) ? String(req.query.by) : 'company' }
  );

peopleRouter.get('/assets/statement', (req, res) => {
  res.json({ statement: statementFor(req) });
});

peopleRouter.get('/assets/statement.csv', (req, res) => {
  res.type('text/csv').attachment('asset-register-statement.csv').send(statementCsv(statementFor(req)));
});

/* ---------------- the export, with the columns somebody chose ---------------- */

/** What can be asked for, in blocks, so the picker can draw itself. */
peopleRouter.get('/assets/export/fields', (_req, res) => {
  res.json({ groups: fieldGroups(), all: ASSET_FIELDS.map(([key, label]) => ({ key, label })) });
});

/**
 * The report itself, as a spreadsheet or a CSV.
 *
 * A POST, and the IDS COME IN THE BODY. The screen has already narrowed the
 * register - company, department, kind, group, a search, a warranty line that
 * was clicked - and working all of that out a second time on the server is
 * how an export comes to disagree with the list it was taken from. So the
 * browser says exactly which assets it is looking at. A thousand ids do not
 * fit in a query string either.
 *
 * No ids at all means the whole register, which is what somebody asking for
 * "everything" expects.
 */
/**
 * A built report, written out as a spreadsheet.
 *
 * Shared by the asset report and the maintenance one rather than copied: a
 * frozen header, a filter row, widths that fit, money formatted, and a LIVE
 * SUM at the foot so deleting a row leaves the total still agreeing with
 * itself.
 */
async function writeSheet(res, built, { sheet, file, what = 'row' }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BNF HRMS';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheet, {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  ws.addRow(built.headers);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: 'middle' };
  for (const row of built.rows) ws.addRow(row);

  built.columns.forEach((column, at) => {
    const col = ws.getColumn(at + 1);
    if (column.type === 'money') col.numFmt = '#,##0';
    if (column.type === 'number') col.numFmt = '0';
    const longest = Math.max(column.label.length, ...built.rows.map((r) => String(r[at] ?? '').length));
    col.width = Math.min(42, Math.max(10, longest + 2));
  });

  if (built.has_totals && built.rows.length) {
    const last = built.rows.length + 1;
    // The first column that is not itself a total, so the label is not lost
    // when somebody ticks a money column first.
    const labelAt = built.totals.findIndex((t) => t === null);
    const footer = ws.addRow(
      built.totals.map((total, at) =>
        total === null
          ? at === labelAt
            ? `TOTAL — ${built.count} ${what}${built.count === 1 ? '' : 's'}`
            : null
          : { formula: `SUM(${ws.getColumn(at + 1).letter}2:${ws.getColumn(at + 1).letter}${last})` }
      )
    );
    footer.font = { bold: true };
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: built.columns.length } };

  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.attachment(`${file}.xlsx`);
  await wb.xlsx.write(res);
  res.end();
}

/**
 * The report itself, as a spreadsheet or a CSV.
 *
 * A POST, and the IDS COME IN THE BODY. The screen has already narrowed the
 * register - company, department, kind, group, a search, a warranty line that
 * was clicked - and working all of that out a second time on the server is
 * how an export comes to disagree with the list it was taken from. So the
 * browser says exactly which assets it is looking at. A thousand ids do not
 * fit in a query string either.
 *
 * No ids at all means the whole register, which is what somebody asking for
 * "everything" expects.
 */
peopleRouter.post('/assets/export', async (req, res, next) => {
  try {
    const wanted = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : null;
    const all = listAssets({ written_off: true });
    const chosen = wanted && wanted.length ? all.filter((a) => wanted.includes(a.id)) : all;
    const built = buildAssetExport(chosen, { fields: cleanFields(req.body?.fields) });

    if (String(req.body?.format || 'xlsx') === 'csv') {
      res.type('text/csv').attachment('asset-report.csv').send(assetExportCsv(built));
      return;
    }
    await writeSheet(res, built, { sheet: 'Assets', file: 'asset-report', what: 'asset' });
  } catch (err) {
    next(err);
  }
});

/* ---------------- the maintenance report, same shape ---------------- */

peopleRouter.get('/maintenance/export/fields', (req, res) => {
  const report = String(req.query.report || 'services');
  res.json({
    report: reportFor(report).key,
    reports: Object.values(REPORTS).map((r) => ({ key: r.key, label: r.label })),
    groups: serviceFieldGroups(report),
    defaults: reportFor(report).defaults,
  });
});

/**
 * Two reports from one door: every service, or every asset's running cost.
 *
 * Same rule as the asset export - the ids are the ones the screen is showing,
 * because the Maintenance panel has its own filters and a second opinion on
 * them is how a report stops matching the list it came from.
 */
peopleRouter.post('/maintenance/export', async (req, res, next) => {
  try {
    const which = reportFor(String(req.body?.report || 'services')).key;
    const wanted = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : null;

    const rows =
      which === 'services'
        ? (() => {
            const all = listServices({ limit: 5000 });
            return wanted && wanted.length ? all.filter((s) => wanted.includes(s.id)) : all;
          })()
        : (() => {
            const all = assetsWithOwnership({ written_off: true });
            return wanted && wanted.length ? all.filter((a) => wanted.includes(a.id)) : all;
          })();

    const built = buildServiceExport(rows, { report: which, fields: req.body?.fields });

    if (String(req.body?.format || 'xlsx') === 'csv') {
      res.type('text/csv').attachment(`${built.file}.csv`).send(serviceExportCsv(built));
      return;
    }
    await writeSheet(res, built, {
      sheet: built.sheet,
      file: built.file,
      what: which === 'services' ? 'service' : 'asset',
    });
  } catch (err) {
    next(err);
  }
});

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

/*
 * Fixed or movable for several at once. Declared BEFORE /assets/:id so the
 * word is not read as an id.
 */
peopleRouter.post('/assets/nature', (req, res) => {
  try {
    res.json(setAssetNature(req.body?.ids, req.body?.nature, { by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

/* What staff say they are holding, waiting for the office to decide. */
/* ---------------- purchase requests (v2.39.0) ---------------- */

const canApprove = (req) => Boolean(req.actor?.abilities?.includes('approve'));

peopleRouter.get('/assets/requests', (req, res) =>
  res.json({
    requests: listAssetRequests({ status: req.query.status || undefined }),
    can_approve: canApprove(req),
    me: req.actor?.id ?? null,
  })
);

peopleRouter.get('/assets/requests/:id', (req, res) => {
  const found = getAssetRequest(Number(req.params.id));
  if (!found) return res.status(404).json({ error: 'not found' });
  res.json({ request: found, can_approve: canApprove(req), me: req.actor?.id ?? null });
});

peopleRouter.post('/assets/requests', (req, res) => {
  try {
    res.status(201).json(createAssetRequest(req.body || {}, { by: who(req), userId: req.actor?.id }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.patch('/assets/requests/:id', (req, res) => {
  try {
    res.json(updateAssetRequest(Number(req.params.id), req.body || {}, { by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.post('/assets/requests/:id/:step', (req, res) => {
  try {
    res.json(
      moveAssetRequest(Number(req.params.id), req.params.step, {
        ...(req.body || {}),
        by: who(req),
        userId: req.actor?.id,
        canApprove: canApprove(req),
      })
    );
  } catch (err) {
    const forbidden = /only a Manager|nobody approves/.test(err.message);
    res.status(forbidden ? 403 : 400).json({ error: err.message });
  }
});

peopleRouter.delete('/assets/requests/:id', (req, res) => {
  try {
    deleteAssetRequest(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.get('/assets/claims', (req, res) =>
  res.json({ claims: listAssetClaims({ status: req.query.status || undefined }) })
);

peopleRouter.post('/assets/claims/:id/decide', (req, res) => {
  try {
    res.json(decideAssetClaim(Number(req.params.id), { ...req.body, by: who(req) }));
  } catch (err) {
    bad(res, err);
  }
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

/**
 * Several at once — somebody leaving, or a desk being handed over.
 *
 * The ids come from the screen that listed them, so what is taken back is
 * exactly what somebody ticked. Anything already back is reported rather than
 * re-dated.
 */
peopleRouter.post('/assets/return-many', (req, res) => {
  try {
    res.json(
      returnAssets(Array.isArray(req.body?.asset_ids) ? req.body.asset_ids : [], {
        ...req.body,
        by: who(req),
      })
    );
  } catch (err) {
    bad(res, err);
  }
});

/**
 * Straight from one person to another, from the ledger.
 *
 * `from_employee_id` is sent by the screen so a stale page cannot move
 * somebody else's asset: anything no longer with that person is refused by
 * name rather than quietly moved.
 */
peopleRouter.post('/assets/transfer', (req, res) => {
  try {
    res.json(
      transferAssets(Array.isArray(req.body?.asset_ids) ? req.body.asset_ids : [], {
        ...req.body,
        by: who(req),
      })
    );
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
    /* What is waiting for somebody to decide, for the Overview's list. */
    pending: {
      purchases: assetRequestsWaiting(),
      claims: listAssetClaims({ status: 'pending' }).length,
    },
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
    // The voucher goes with the claim: a file nothing points at is a file
    // nobody will ever clear up.
    const voucher = claimVoucherFile(Number(req.params.id));
    const deleted = deleteClaim(Number(req.params.id), who(req));
    if (deleted && voucher?.voucher_file) removeVoucher(voucher.voucher_file);
    res.json({ deleted });
  } catch (err) {
    bad(res, err);
  }
});

/*
 * The voucher - the bill behind the claim. Attaching a second replaces the
 * first, and the first file is removed from disk once the new one is on the
 * row, so a failed upload never leaves the claim with nothing.
 */
peopleRouter.post('/claims/:id/voucher', uploadVoucher, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'choose the file to attach' });
  try {
    const { replaced, claim } = setClaimVoucher(
      Number(req.params.id),
      { file: req.file.filename, name: req.file.originalname },
      who(req)
    );
    if (replaced) removeVoucher(replaced);
    res.status(201).json(claim);
  } catch (err) {
    removeVoucher(req.file.filename);
    res.status(err.message === 'not found' ? 404 : 400).json({ error: err.message });
  }
});

peopleRouter.get('/claims/:id/voucher', (req, res) => {
  const voucher = claimVoucherFile(Number(req.params.id));
  const full = voucher?.voucher_file ? voucherPath(voucher.voucher_file) : null;
  if (!full) return res.status(404).json({ error: 'no voucher attached to this claim' });
  res.download(full, voucher.voucher_name || path.basename(full));
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

/*
 * ONE SHAPE FOR THE EXIT, whoever asked for it.
 *
 * The checklist rides along: it is read on the same screen, and half of it is
 * worked out from registers this call has already opened. It used to ride
 * along with the GET only, so recording a resignation answered without it and
 * the checklist stayed off the screen until somebody closed the page and came
 * back - which is precisely the moment it is wanted. A read and a write that
 * describe the same thing differently is how the two come to disagree.
 */
const exitReply = (employeeId) => {
  const found = fullAndFinal(employeeId);
  return found && { ...found, clearance: clearanceFor(employeeId) };
};

peopleRouter.get('/exits/:employeeId', (req, res) => {
  const found = exitReply(Number(req.params.employeeId));
  if (!found) return res.status(404).json({ error: 'nothing recorded for this person' });
  res.json(found);
});

/**
 * The clearance checklist on its own — for anybody who has not recorded an
 * exit yet, which is the normal case on the day somebody resigns.
 */
peopleRouter.get('/exits/:employeeId/clearance', (req, res) => {
  try {
    res.json({ clearance: clearanceFor(Number(req.params.employeeId)) });
  } catch (err) {
    bad(res, err);
  }
});

/** One step, signed by somebody whose name goes on it. */
peopleRouter.put('/exits/:employeeId/clearance/:step', (req, res) => {
  try {
    res.json({
      clearance: setClearance(Number(req.params.employeeId), req.params.step, {
        ...req.body,
        by: who(req),
      }),
    });
  } catch (err) {
    bad(res, err);
  }
});

peopleRouter.put('/exits/:employeeId', (req, res) => {
  try {
    saveExit(Number(req.params.employeeId), { ...req.body, by: who(req) });
    res.json(exitReply(Number(req.params.employeeId)));
  } catch (err) {
    bad(res, err);
  }
});

/**
 * The relieving letter and the experience certificate, as one file each.
 *
 * Sent as an attachment, exactly like the offer letter: the browser prints it
 * from an iframe or saves it, and either way the company's own logo is
 * already inside it. ONE FILE HOLDS ONE PERSON.
 */
peopleRouter.get('/exits/:employeeId/letter/:kind', (req, res) => {
  try {
    const letter = exitLetter(Number(req.params.employeeId), {
      kind: String(req.params.kind),
      note: String(req.query.note || ''),
      conduct: req.query.conduct === 'true',
      signedBy: String(req.query.by || ''),
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${letter.filename}"`);
    return res.send(letter.html);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
});

peopleRouter.post('/exits/:employeeId/settle', (req, res) => {
  try {
    markSettled(Number(req.params.employeeId), { ...req.body, by: who(req) });
    res.json(exitReply(Number(req.params.employeeId)));
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

/* ---------------- the daily office report ---------------- */

/**
 * The report HR already types into WhatsApp every morning, built from the
 * roll call instead.
 *
 * `?format=text` returns it as plain text, so a cron - or the WhatsApp
 * assistant, which already holds a linked session - can fetch it and post it
 * without this app growing a second session on the same number.
 *
 * The three lines this app cannot know (office inspection, conduct,
 * incidents) come in as query values, exactly as the office words them. They
 * are NOT invented: left out, their headings do not appear at all.
 *
 * `?shape=` picks WHEN the message is true, which is the whole point of
 * having shapes: the hours cannot exist before people go home, so a cron
 * fetches `shape=morning` at ten and `shape=end_of_day` at eight, both of
 * them today's - or `shape=with_yesterday` once a day for one message
 * carrying yesterday's hours under yesterday's date. `?as_of=19:10` stamps
 * the hour it was built; left out, the text is exactly what it always was.
 */
peopleRouter.get('/daily-report', (req, res) => {
  const periods = listPeriods();
  const date = String(req.query.day || todayIso()).slice(0, 10);
  const [year, month, dayOfMonth] = date.split('-').map(Number);
  const period =
    periods.find((p) => p.year === year && p.month === month) ||
    periods.find((p) => !p.locked) ||
    periods[0];
  if (!period) return res.status(404).json({ error: 'no month is open' });

  // sync:false - reading a report must not open rows or post loan instalments.
  const payroll = buildPayroll(period.id, { sync: false, company_id: Number(req.query.company_id) || undefined });

  const typed = {};
  for (const key of ['inspection', 'conduct', 'incidents']) {
    if (req.query[key] !== undefined) typed[key] = String(req.query[key]);
  }

  /*
   * WHICH DAY THE HOURS COME FROM, worked out here rather than in the module.
   *
   * `attendance` is keyed by day of month, so the day before the 1st is not
   * day 0 - it is a different sheet. The module is told `null` and says so,
   * instead of being handed a number that reads as a day with nobody short.
   */
  const shape = normaliseShape(req.query.shape);
  const prev = new Date(Date.UTC(year, month - 1, dayOfMonth));
  prev.setUTCDate(prev.getUTCDate() - 1);
  const prevIso = prev.toISOString().slice(0, 10);
  const prevInThisMonth =
    prev.getUTCFullYear() === payroll.period.year && prev.getUTCMonth() + 1 === payroll.period.month;

  const built = dailyReport({
    period: payroll.period,
    rows: payroll.rows,
    day: dayOfMonth,
    date,
    shape,
    asOf: String(req.query.as_of || ''),
    hoursDay: prevInThisMonth ? prev.getUTCDate() : null,
    hoursDate: prevIso,
    /*
     * The month's own shift wins, exactly as the roll call's `shiftOfMonth`
     * does; the screen may send its own, because the usual timings are also
     * kept per browser and whoever is looking at the roll call should get
     * the same names here as they see there.
     */
    standard: {
      in: String(req.query.in || period.shift_in || ''),
      out: String(req.query.out || period.shift_out || ''),
      grace: Number.isFinite(Number(req.query.grace)) && req.query.grace !== '' ? Number(req.query.grace) : undefined,
    },
    typed,
    title: String(req.query.title || 'DAILY OFFICE REPORT'),
  });

  if (req.query.format === 'text') {
    res.type('text/plain').send(built.text);
    return;
  }
  res.json(built);
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
  const allDocuments = staff.flatMap((e) => listDocuments(e.id).map((d) => ({ ...d, employee_id: e.id, employee_name: e.name })));
  const documents = allDocuments.filter((d) => d.expires_on);
  // Uploaded and nobody has looked: null is "not checked", which is neither
  // verified nor rejected. Only people still on the staff.
  const unchecked = allDocuments.filter(
    (d) => (d.verified === null || d.verified === undefined) && byEmployee.get(d.employee_id)?.active !== 0
  );

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
    // The same scoping again: a login with no Employees tab is not told who
    // has filled in what, and one with no asset register is not told what
    // staff say they hold.
    profile_changes: may(req.actor, 'employees') ? profileChangesWaiting() : null,
    unchecked_documents: may(req.actor, 'employees') ? unchecked : [],
    asset_claims: may(req.actor, 'assets') ? listAssetClaims({ status: 'pending' }) : [],
    today: todayIso(),
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

/* ---------------- renewal management (v2.40.0) ---------------- */

const REMINDER_KEY = 'renewal_reminders';
const reminderRule = () => {
  const stored = getSetting(REMINDER_KEY, null) || {};
  return { steps: cleanSteps(stored.steps), by: stored.by || '', since: stored.since || '' };
};

/*
 * The Overview, the calendar and the reminders in one read. Reading it also
 * LOGS the reminders that have come due - once each, by a unique index - so
 * "shown" has a history and the same 30-day reminder never reads as new twice.
 */
peopleRouter.get('/licenses/overview', (req, res) => {
  const { licenses } = licenseRegister({ company_id: Number(req.query.company_id) || undefined });
  const rule = reminderRule();
  const { due, fresh } = logDueReminders(licenses, rule.steps);
  res.json({
    overview: renewalOverview(licenses),
    reminders: due,
    fresh_reminders: fresh,
    rule,
    activity: recentLicenseActivity(12),
    can_approve: Boolean(req.actor?.abilities?.includes('approve')),
  });
});

peopleRouter.get('/licenses/reminders', (_req, res) =>
  res.json({ rule: reminderRule(), history: reminderHistory(200) })
);

peopleRouter.put('/licenses/reminders', requireAbilityLocal('approve'), (req, res) => {
  const steps = cleanSteps(req.body?.steps);
  if (!steps.length) return res.status(400).json({ error: 'keep at least one reminder step' });
  setSetting(REMINDER_KEY, { steps, by: who(req), since: todayIso() }, who(req));
  res.json({ rule: reminderRule() });
});

peopleRouter.get('/licenses/:id/activity', (req, res) =>
  res.json({ activity: licenseActivity(Number(req.params.id)) })
);

peopleRouter.post('/licenses/:id/stage', (req, res) => {
  try {
    res.json(
      moveLicenseStage(Number(req.params.id), {
        ...(req.body || {}),
        by: who(req),
        canApprove: Boolean(req.actor?.abilities?.includes('approve')),
      })
    );
  } catch (err) {
    const forbidden = /only a Manager/.test(err.message);
    res.status(forbidden ? 403 : 400).json({ error: err.message });
  }
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
