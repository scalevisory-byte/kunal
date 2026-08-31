import { Router } from 'express';
import { leaveSummary } from '../db.js';

export const leaveRouter = Router();

/** The leave register for a calendar year. */
leaveRouter.get('/', (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  res.json({ year, rows: leaveSummary(year) });
});
