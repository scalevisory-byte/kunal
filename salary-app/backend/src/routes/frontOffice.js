import { Router } from 'express';
import {
  addCourier,
  archiveCourier,
  archiveVisitor,
  checkOut,
  getCourier,
  getVisitor,
  handOver,
  listHandovers,
  pendingCourier,
  searchCourier,
  searchVisitors,
  setCourierStatus,
  undoCheckOut,
  addUsualAreas,
  addVisitor,
  clearDay,
  createArea,
  frontOfficeDay,
  frontOfficeMonth,
  listAreas,
  retireArea,
  setInspection,
  updateArea,
  updateVisitor,
} from '../frontOffice.js';

export const frontOfficeRouter = Router();

/** Whoever is signed in, for "checked by" and "logged by". */
const actorName = (req) =>
  (req.actor?.via === 'session' ? req.actor.name : null) || req.body?.by || req.actor?.name || 'office';

const fail = (res, err) => res.status(err.status || 400).json({ error: err.message });

/* ---------------- the day ---------------- */

frontOfficeRouter.get('/day/:day', (req, res) => {
  try {
    res.json(
      frontOfficeDay(req.params.day, {
        company_id: req.query.company_id,
        branch_id: req.query.branch_id,
      })
    );
  } catch (err) {
    fail(res, err);
  }
});

frontOfficeRouter.delete('/day/:day', (req, res) => {
  try {
    res.json(clearDay(req.params.day, { by: actorName(req) }));
  } catch (err) {
    fail(res, err);
  }
});

frontOfficeRouter.get('/month/:month', (req, res) => {
  try {
    res.json(frontOfficeMonth(req.params.month));
  } catch (err) {
    fail(res, err);
  }
});

/* ---------------- housekeeping ---------------- */

frontOfficeRouter.get('/areas', (req, res) =>
  res.json({
    areas: listAreas({
      all: req.query.all === 'true',
      company_id: req.query.company_id,
      branch_id: req.query.branch_id,
    }),
  })
);

frontOfficeRouter.post('/areas', (req, res) => {
  try {
    res.status(201).json(createArea(req.body || {}));
  } catch (err) {
    fail(res, err);
  }
});

/** The twelve he already walks, for an office starting from nothing. */
frontOfficeRouter.post('/areas/usual', (req, res) => res.json({ areas: addUsualAreas() }));

frontOfficeRouter.patch('/areas/:id', (req, res) => {
  const area = updateArea(Number(req.params.id), req.body || {});
  if (!area) return res.status(404).json({ error: 'not found' });
  return res.json(area);
});

/* Off the list, not out of the records - see retireArea. */
frontOfficeRouter.delete('/areas/:id', (req, res) => {
  const area = retireArea(Number(req.params.id));
  if (!area) return res.status(404).json({ error: 'not found' });
  return res.json(area);
});

frontOfficeRouter.put('/inspections', (req, res) => {
  try {
    res.json({ inspection: setInspection({ ...(req.body || {}), by: actorName(req) }) });
  } catch (err) {
    fail(res, err);
  }
});

/* ---------------- visitors ---------------- */

frontOfficeRouter.post('/visitors', (req, res) => {
  try {
    res.status(201).json(addVisitor({ ...(req.body || {}), by: actorName(req) }));
  } catch (err) {
    /* A refusal that carries the visitor it clashed with, so the desk can
       see whose pass is already open rather than being told "409". */
    if (err.visitor) return res.status(err.status || 409).json({ error: err.message, visitor: err.visitor });
    return fail(res, err);
  }
});

/** The register, searched. One query for the screen and for the reports. */
frontOfficeRouter.get('/visitors', (req, res) => {
  try {
    res.json(
      searchVisitors({
        day: req.query.day,
        from: req.query.from,
        to: req.query.to,
        q: req.query.q,
        employee_id: req.query.employee_id,
        visitor_type: req.query.visitor_type,
        status: req.query.status,
        company_id: req.query.company_id,
        branch_id: req.query.branch_id,
        archived: req.query.archived === 'true',
        limit: req.query.limit,
        offset: req.query.offset,
      })
    );
  } catch (err) {
    fail(res, err);
  }
});

frontOfficeRouter.get('/visitors/:id', (req, res) => {
  const visitor = getVisitor(Number(req.params.id));
  if (!visitor) return res.status(404).json({ error: 'not found' });
  return res.json({ visitor });
});

frontOfficeRouter.patch('/visitors/:id', (req, res) => {
  try {
    const visitor = updateVisitor(Number(req.params.id), req.body || {}, { by: actorName(req) });
    if (!visitor) return res.status(404).json({ error: 'not found' });
    return res.json(visitor);
  } catch (err) {
    return fail(res, err);
  }
});

/** Sign them out. Posting again with a time corrects it; DELETE takes it back. */
frontOfficeRouter.post('/visitors/:id/checkout', (req, res) => {
  try {
    const visitor = checkOut(Number(req.params.id), { time: req.body?.time, by: actorName(req) });
    if (!visitor) return res.status(404).json({ error: 'not found' });
    return res.json(visitor);
  } catch (err) {
    return fail(res, err);
  }
});

frontOfficeRouter.delete('/visitors/:id/checkout', (req, res) => {
  const visitor = undoCheckOut(Number(req.params.id), { by: actorName(req) });
  if (!visitor) return res.status(404).json({ error: 'not found' });
  return res.json(visitor);
});

/* Archived, never destroyed - see archiveVisitor. */
frontOfficeRouter.delete('/visitors/:id', (req, res) => {
  if (!archiveVisitor(Number(req.params.id), { by: actorName(req) })) {
    return res.status(404).json({ error: 'not found' });
  }
  return res.status(204).end();
});

/* ---------------- courier ---------------- */

frontOfficeRouter.post('/courier', (req, res) => {
  try {
    res.status(201).json(addCourier({ ...(req.body || {}), by: actorName(req) }));
  } catch (err) {
    fail(res, err);
  }
});

frontOfficeRouter.get('/courier', (req, res) => {
  try {
    res.json(
      searchCourier({
        day: req.query.day,
        from: req.query.from,
        to: req.query.to,
        q: req.query.q,
        employee_id: req.query.employee_id,
        status: req.query.status,
        direction: req.query.direction,
        company_id: req.query.company_id,
        branch_id: req.query.branch_id,
        archived: req.query.archived === 'true',
        limit: req.query.limit,
        offset: req.query.offset,
      })
    );
  } catch (err) {
    fail(res, err);
  }
});

/** Everything still in the drawer, for the alert. */
frontOfficeRouter.get('/courier/pending', (req, res) => res.json({ rows: pendingCourier() }));

frontOfficeRouter.get('/courier/:id', (req, res) => {
  const row = getCourier(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'not found' });
  return res.json({ courier: row, handovers: listHandovers(row.id) });
});

/** Writing a handover is what makes it delivered. */
frontOfficeRouter.post('/courier/:id/handover', (req, res) => {
  try {
    const row = handOver(Number(req.params.id), { ...(req.body || {}), by: actorName(req) });
    if (!row) return res.status(404).json({ error: 'not found' });
    return res.json(row);
  } catch (err) {
    return fail(res, err);
  }
});

frontOfficeRouter.patch('/courier/:id', (req, res) => {
  try {
    const row = setCourierStatus(Number(req.params.id), req.body?.status, {
      by: actorName(req),
      remark: req.body?.remark,
    });
    if (!row) return res.status(404).json({ error: 'not found' });
    return res.json(row);
  } catch (err) {
    return fail(res, err);
  }
});

frontOfficeRouter.delete('/courier/:id', (req, res) => {
  if (!archiveCourier(Number(req.params.id), { by: actorName(req) })) {
    return res.status(404).json({ error: 'not found' });
  }
  return res.status(204).end();
});
