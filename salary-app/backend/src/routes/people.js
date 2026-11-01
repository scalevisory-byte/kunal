import { Router } from 'express';
import { digest } from '../../../shared/digest.js';
import { buildPayroll } from '../payroll.js';
import { listPeriods } from '../db.js';
import { listRequests } from '../attendanceSelf.js';
import { getEmployee } from '../db.js';
import { barcodeSvg } from '../../../shared/barcode.js';
import { handoverCsv, handoverSlip, registerCsv, registerTotals } from '../../../shared/assetReport.js';
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
  getAsset,
  getAssetByCode,
  listAssets,
  listAudit,
  listHandovers,
  listRounds,
  roundProgress,
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
peopleRouter.get('/assets/:id/label.svg', (req, res) => {
  const asset = getAsset(Number(req.params.id));
  if (!asset) return res.status(404).json({ error: 'not found' });
  if (!asset.code) return res.status(400).json({ error: 'that asset has no code to print' });
  const svg = barcodeSvg(asset.code, { heightMm: Number(req.query.h) || 12 });
  if (!svg) return res.status(400).json({ error: 'that code cannot be made into a barcode' });
  res.type('image/svg+xml').send(svg);
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
