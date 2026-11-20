import { Router } from 'express';
import {
  addCourier,
  addUsualAreas,
  addVisitor,
  clearDay,
  createArea,
  deleteCourier,
  deleteVisitor,
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
    res.json(frontOfficeDay(req.params.day));
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
  res.json({ areas: listAreas({ all: req.query.all === 'true' }) })
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
    fail(res, err);
  }
});

frontOfficeRouter.patch('/visitors/:id', (req, res) => {
  const visitor = updateVisitor(Number(req.params.id), req.body || {});
  if (!visitor) return res.status(404).json({ error: 'not found' });
  return res.json(visitor);
});

frontOfficeRouter.delete('/visitors/:id', (req, res) => {
  if (!deleteVisitor(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
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

frontOfficeRouter.delete('/courier/:id', (req, res) => {
  if (!deleteCourier(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  return res.status(204).end();
});
