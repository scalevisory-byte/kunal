import { Router } from 'express';
import {
  createInterview,
  deleteInterview,
  getApplication,
  getCandidate,
  getVacancy,
  listInterviews,
  updateInterview,
} from '../db.js';
import { config } from '../config.js';
import { stageMessage, waLink } from '../../../shared/messages.js';

export const interviewsRouter = Router();

interviewsRouter.get('/', (req, res) => {
  res.json({
    interviews: listInterviews({
      application_id: Number(req.query.application_id) || undefined,
      upcoming: req.query.upcoming === 'true',
    }),
  });
});

interviewsRouter.post('/', (req, res) => {
  try {
    const interview = createInterview(req.body || {});
    const application = getApplication(interview.application_id);
    const candidate = application ? getCandidate(application.candidate_id) : null;
    const vacancy = application ? getVacancy(application.vacancy_id) : null;
    // The call text, with the details filled in. Scheduling it does NOT move
    // the application - the recruiter does that when the candidate confirms.
    const text = candidate
      ? stageMessage('Interview', { candidate, vacancy, interview, brand: config.brandName })
      : null;
    res.status(201).json({
      interview,
      notify: text ? { text, whatsapp: waLink(candidate.phone, text) } : null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

interviewsRouter.patch('/:id', (req, res) => {
  const interview = updateInterview(Number(req.params.id), req.body || {});
  if (!interview) return res.status(404).json({ error: 'not found' });
  res.json(interview);
});

interviewsRouter.delete('/:id', (req, res) => {
  if (!deleteInterview(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});
