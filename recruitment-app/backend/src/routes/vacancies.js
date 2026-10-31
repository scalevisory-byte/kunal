import { Router } from 'express';
import {
  createVacancy,
  deleteVacancy,
  getVacancy,
  listApplications,
  listVacancies,
  rescoreVacancy,
  suggestForVacancy,
  updateVacancy,
} from '../db.js';
import { config } from '../config.js';
import { applyUrl, publicVacancy, vacancyBroadcast } from '../../../shared/messages.js';

export const vacanciesRouter = Router();

vacanciesRouter.get('/', (req, res) => {
  res.json({ vacancies: listVacancies({ status: req.query.status, q: req.query.q }) });
});

vacanciesRouter.post('/', (req, res) => {
  try {
    res.status(201).json(createVacancy(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

vacanciesRouter.get('/:id', (req, res) => {
  const vacancy = getVacancy(Number(req.params.id));
  if (!vacancy) return res.status(404).json({ error: 'not found' });
  const { rows } = listApplications({ vacancy_id: vacancy.id });
  res.json({ vacancy, applications: rows });
});

vacanciesRouter.patch('/:id', (req, res) => {
  const vacancy = updateVacancy(Number(req.params.id), req.body || {});
  if (!vacancy) return res.status(404).json({ error: 'not found' });
  // The requirement changed, so every score on it is now stale.
  rescoreVacancy(vacancy.id);
  res.json(vacancy);
});

vacanciesRouter.delete('/:id', (req, res) => {
  if (!deleteVacancy(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

/**
 * The people already on the books who fit this requirement, best first. This
 * is suggestion only - nothing is added to the pipeline until the recruiter
 * says so.
 */
vacanciesRouter.get('/:id/suggestions', (req, res) => {
  const vacancy = getVacancy(Number(req.params.id));
  if (!vacancy) return res.status(404).json({ error: 'not found' });
  res.json({
    suggestions: suggestForVacancy(vacancy.id, { limit: Number(req.query.limit) || 25 }),
  });
});

/**
 * Everything needed to share the job: the public version (no client name), the
 * apply link, and the broadcast text ready to paste into WhatsApp.
 */
vacanciesRouter.get('/:id/share', (req, res) => {
  const vacancy = getVacancy(Number(req.params.id));
  if (!vacancy) return res.status(404).json({ error: 'not found' });
  const baseUrl = config.publicUrl || req.query.base_url || '';
  res.json({
    public: publicVacancy(vacancy),
    apply_url: baseUrl ? applyUrl(baseUrl, vacancy) : null,
    broadcast: vacancyBroadcast(vacancy, { baseUrl, brand: config.brandName }),
    published: vacancy.status === 'published',
  });
});
