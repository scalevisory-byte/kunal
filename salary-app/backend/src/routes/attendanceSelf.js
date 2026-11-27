import { Router } from 'express';
import { withLeaveContext } from '../leaveBalance.js';
import {
  createOffice,
  createRequest,
  cancelRequest,
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
    /* Each one carries what deciding it needs: the leave balance, the days
       it takes, and whether it is still the reporting manager's move. */
    requests: withLeaveContext(
      listRequests({
        status: req.query.status,
        employee_id: Number(req.query.employee_id) || undefined,
        period_id: Number(req.query.period_id) || undefined,
      })
    ),
  })
);

/**
 * How many are waiting, and on whom - for the count in the header, which is
 * on every tab. A new application used to be visible only to somebody who
 * happened to open the dashboard or Reports.
 */
attendanceSelfRouter.get('/requests/waiting', (_req, res) => {
  const open = withLeaveContext(listRequests({})).filter((r) => r.status === 'pending' || r.status === 'recommended');
  res.json({
    office: open.filter((r) => !r.needs_manager).length,
    with_manager: open.filter((r) => r.needs_manager).length,
  });
});

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
/**
 * CALL OFF A LEAVE THAT WAS ALREADY APPROVED.
 *
 * His brief: *"Never permanently delete approved leave transactions."* The
 * row stays and the days come back off the grid. It CLEARS those days rather
 * than marking them present - the app has no way to know whether they came
 * in, were absent or took something else, and guessing either way moves pay.
 */
attendanceSelfRouter.post('/requests/:id/cancel', (req, res) => {
  try {
    res.json(
      cancelRequest(Number(req.params.id), {
        by: req.body?.by || 'office',
        reason: req.body?.reason,
      })
    );
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

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
