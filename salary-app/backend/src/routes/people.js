import { Router } from 'express';
import {
  ASSET_KINDS,
  CLAIM_KINDS,
  CLAIM_STATUSES,
  NOTE_KINDS,
  WARNING_LEVELS,
  applyAppraisal,
  createAppraisal,
  createAsset,
  createClaim,
  createNote,
  decideClaim,
  deleteAppraisal,
  deleteAsset,
  deleteClaim,
  deleteExit,
  deleteNote,
  fullAndFinal,
  issueAsset,
  listAllAppraisals,
  listAllNotes,
  listAppraisals,
  listAssets,
  listAudit,
  listClaims,
  listExits,
  listNotes,
  markSettled,
  payClaim,
  returnAsset,
  saveExit,
  updateAppraisal,
  updateAsset,
  updateNote,
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
const who = (req) => req.body?.by || req.get('x-acted-by') || null;

/* ---------------- what the pickers offer ---------------- */

peopleRouter.get('/options', (_req, res) => {
  res.json({
    asset_kinds: ASSET_KINDS,
    claim_kinds: CLAIM_KINDS,
    claim_statuses: CLAIM_STATUSES,
    note_kinds: NOTE_KINDS,
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
  res.json({
    assets: listAssets({
      employee_id: Number(req.query.employee_id) || undefined,
      company_id: Number(req.query.company_id) || undefined,
      out: req.query.out === 'true',
    }),
  });
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

peopleRouter.delete('/assets/:id', (req, res) => {
  res.json({ deleted: deleteAsset(Number(req.params.id), who(req)) });
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
