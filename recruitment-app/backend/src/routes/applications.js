import { Router } from 'express';
import {
  createApplication,
  deleteApplication,
  getApplication,
  getCandidate,
  getVacancy,
  listApplications,
  listInterviews,
  listTests,
  moveApplication,
  recordTest,
  updateApplication,
} from '../db.js';
import { config } from '../config.js';
import { matchScore } from '../../../shared/match.js';
import { resumeLink } from '../resumes.js';
import { stageMessage, waLink } from '../../../shared/messages.js';

export const applicationsRouter = Router();

applicationsRouter.get('/', (req, res) => {
  res.json(
    listApplications({
      vacancy_id: Number(req.query.vacancy_id) || undefined,
      candidate_id: Number(req.query.candidate_id) || undefined,
      stage: req.query.stage,
      q: req.query.q,
      limit: Number(req.query.limit) || 500,
      offset: Number(req.query.offset) || 0,
    })
  );
});

/** Putting a candidate already on the books forward for a job. */
applicationsRouter.post('/', (req, res) => {
  try {
    const { application, created } = createApplication({
      vacancy_id: Number(req.body?.vacancy_id),
      candidate_id: Number(req.body?.candidate_id),
      source: req.body?.source || 'recruiter',
      by: req.body?.by || 'recruiter',
    });
    res.status(created ? 201 : 200).json({ application, created });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

applicationsRouter.get('/:id', (req, res) => {
  const application = getApplication(Number(req.params.id));
  if (!application) return res.status(404).json({ error: 'not found' });
  const candidate = getCandidate(application.candidate_id);
  const vacancy = getVacancy(application.vacancy_id);
  res.json({
    application,
    // Why it scored what it scored, and what the candidate is missing. The
    // number on its own is not useful to a person deciding.
    match: matchScore(candidate, vacancy),
    interviews: listInterviews({ application_id: application.id }),
    tests: listTests(application.candidate_id),
    resume: resumeLink(candidate),
  });
});

applicationsRouter.patch('/:id', (req, res) => {
  const application = updateApplication(Number(req.params.id), req.body || {});
  if (!application) return res.status(404).json({ error: 'not found' });
  res.json(application);
});

/**
 * The one way an application changes stage. A recruiter asked for it; neither
 * the match score nor a test result ever moves anybody on its own.
 *
 * Comes back with the message to send, ready for a tap - the point of the move
 * is usually that somebody needs telling.
 */
applicationsRouter.post('/:id/stage', (req, res) => {
  const stage = req.body?.stage;
  if (!stage) return res.status(400).json({ error: 'which stage?' });
  try {
    const application = moveApplication(Number(req.params.id), stage, {
      by: req.body?.by || 'recruiter',
      note: req.body?.note,
    });
    if (!application) return res.status(404).json({ error: 'not found' });

    const candidate = getCandidate(application.candidate_id);
    const vacancy = getVacancy(application.vacancy_id);
    const text = stageMessage(stage, { candidate, vacancy, brand: config.brandName });
    res.json({
      application,
      notify: text ? { text, whatsapp: waLink(candidate.phone, text) } : null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** A test taken outside the app, typed in or posted back by the test system. */
applicationsRouter.post('/:id/test', (req, res) => {
  const application = getApplication(Number(req.params.id));
  if (!application) return res.status(404).json({ error: 'not found' });
  try {
    const test = recordTest({
      ...req.body,
      application_id: application.id,
      candidate_id: application.candidate_id,
    });
    res.status(201).json({ test, application: getApplication(application.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

applicationsRouter.delete('/:id', (req, res) => {
  if (!deleteApplication(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});
