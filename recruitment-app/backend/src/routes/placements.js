import { Router } from 'express';
import { createPlacement, feeFor, listPlacements, updatePlacement } from '../db.js';
import { config } from '../config.js';

export const placementsRouter = Router();

placementsRouter.get('/', (req, res) => {
  res.json({
    placements: listPlacements(),
    defaults: {
      fee_percent: config.feePercent,
      fee_basis: config.feeBasis,
      gst_percent: config.gstPercent,
      replacement_days: config.replacementDays,
    },
  });
});

/** What a fee would come to, before anything is saved. */
placementsRouter.get('/quote', (req, res) => {
  res.json(
    feeFor({
      ctc: Number(req.query.ctc),
      fee_percent: req.query.fee_percent === undefined ? undefined : Number(req.query.fee_percent),
      basis: req.query.basis || config.feeBasis,
      gst_percent: req.query.gst_percent === undefined ? undefined : Number(req.query.gst_percent),
    })
  );
});

placementsRouter.post('/', (req, res) => {
  try {
    res.status(201).json(createPlacement(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

placementsRouter.patch('/:id', (req, res) => {
  const placement = updatePlacement(Number(req.params.id), req.body || {});
  if (!placement) return res.status(404).json({ error: 'not found' });
  res.json(placement);
});
