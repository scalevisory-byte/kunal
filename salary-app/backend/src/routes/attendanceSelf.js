import { Router } from 'express';
import {
  createOffice,
  createRequest,
  decideRequest,
  deleteOffice,
  listOffices,
  listPunches,
  listRequests,
  rollUpDay,
  updateOffice,
} from '../attendanceSelf.js';
import { REQUEST_KINDS } from '../../../shared/attendanceRequests.js';

export const attendanceSelfRouter = Router();

/* ---------------- office locations ---------------- */

attendanceSelfRouter.get('/offices', (req, res) =>
  res.json({ offices: listOffices({ active: req.query.all !== 'true' }) })
);

attendanceSelfRouter.post('/offices', (req, res) => {
  try {
    res.status(201).json(createOffice(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

attendanceSelfRouter.patch('/offices/:id', (req, res) => {
  const office = updateOffice(Number(req.params.id), req.body || {});
  if (!office) return res.status(404).json({ error: 'not found' });
  res.json(office);
});

attendanceSelfRouter.delete('/offices/:id', (req, res) => {
  if (!deleteOffice(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

/* ---------------- the punch log ---------------- */

attendanceSelfRouter.get('/punches', (req, res) =>
  res.json({
    punches: listPunches({
      employee_id: Number(req.query.employee_id) || undefined,
      day: req.query.day,
      from: req.query.from,
      to: req.query.to,
      limit: Number(req.query.limit) || 500,
    }),
  })
);

/** Re-derive a day from its punches, after a correction or a late arrival. */
attendanceSelfRouter.post('/punches/rollup', (req, res) => {
  const { employee_id: employeeId, day } = req.body || {};
  if (!employeeId || !day) return res.status(400).json({ error: 'which employee, and which day?' });
  res.json({ day: rollUpDay(Number(employeeId), String(day)) });
});

/* ---------------- requests and the decision ---------------- */

attendanceSelfRouter.get('/requests', (req, res) =>
  res.json({
    kinds: REQUEST_KINDS,
    requests: listRequests({
      status: req.query.status,
      employee_id: Number(req.query.employee_id) || undefined,
      period_id: Number(req.query.period_id) || undefined,
    }),
  })
);

/** The office raising one on somebody's behalf - "he told me on the phone". */
attendanceSelfRouter.post('/requests', (req, res) => {
  try {
    res.status(201).json(createRequest(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Approve or reject. Approving is the only thing here that writes attendance,
 * and nothing is ever approved automatically.
 */
attendanceSelfRouter.post('/requests/:id/decide', (req, res) => {
  try {
    const decided = decideRequest(Number(req.params.id), {
      approve: req.body?.approve === true || req.body?.approve === 'true',
      by: req.body?.by || 'office',
      note: req.body?.note,
    });
    res.json(decided);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
