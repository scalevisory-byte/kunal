import { Router } from 'express';
import { createFollowup, deleteFollowup, listFollowups, updateFollowup } from '../db.js';

export const followupsRouter = Router();

followupsRouter.get('/', (req, res) => {
  res.json({ followups: listFollowups({ status: req.query.status }) });
});

followupsRouter.post('/', (req, res) => {
  try {
    res.status(201).json(createFollowup(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

followupsRouter.patch('/:id', (req, res) => {
  const followup = updateFollowup(Number(req.params.id), req.body || {});
  if (!followup) return res.status(404).json({ error: 'not found' });
  res.json(followup);
});

followupsRouter.delete('/:id', (req, res) => {
  if (!deleteFollowup(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});
