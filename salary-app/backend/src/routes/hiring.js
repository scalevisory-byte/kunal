import fs from 'node:fs';
import { Router } from 'express';
import {
  createApplication,
  createCandidate,
  createInterview,
  createTask,
  createVacancy,
  deleteApplication,
  deleteCandidate,
  deleteInterview,
  deleteTask,
  deleteVacancy,
  getApplication,
  getCandidate,
  getVacancy,
  hireApplication,
  hiringOverview,
  listApplications,
  listCandidates,
  listInterviews,
  listTasks,
  listTests,
  listVacancies,
  moveApplication,
  recordTest,
  rescoreVacancy,
  suggestForVacancy,
  updateApplication,
  updateCandidate,
  updateInterview,
  updateTask,
  updateVacancy,
} from '../hiring.js';
import { config } from '../config.js';
import { matchScore } from '../../../shared/match.js';
import { MATCH_BANDS, REJECTED, STAGES } from '../../../shared/stages.js';
import { WEIGHTS } from '../../../shared/match.js';
import {
  applyUrl,
  hiringDigest,
  publicVacancy,
  stageMessage,
  vacancyBroadcast,
  waLink,
} from '../../../shared/hiringMessages.js';
import { CSV_COLUMNS, toCsv } from '../../../shared/hiringCsv.js';
import {
  deleteResumeFile,
  resumeFile,
  resumeLink,
  uploadResumeSafely,
} from '../resumes.js';

export const hiringRouter = Router();

const num = (v) => (v === undefined || v === '' ? undefined : Number(v));

/* ---------------- what the dashboard needs to draw itself ---------------- */

hiringRouter.get('/config', (req, res) =>
  res.json({
    stages: STAGES,
    rejected: REJECTED,
    bands: MATCH_BANDS,
    weights: WEIGHTS,
    public_url: config.publicUrl || null,
    test_configured: !!config.testEmbedUrl,
    test_pass_percent: config.testPassPercent,
    whatsapp: config.officeWhatsapp || null,
  })
);

hiringRouter.get('/overview', (req, res) => {
  const interviews = listInterviews({ upcoming: true });
  const tasks = listTasks({ status: 'open' });
  const { rows: recent } = listApplications({ limit: 12 });
  res.json({ ...hiringOverview(), upcoming: interviews, open_tasks: tasks, recent });
});

/** The hiring day as one message, with a link to the office's own number. */
hiringRouter.get('/digest', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const interviews = listInterviews({ upcoming: true }).filter(
    (i) => String(i.at).slice(0, 10) === today
  );
  const text = hiringDigest({
    interviews,
    tasks: listTasks({ status: 'open' }),
    newApplications: hiringOverview().applications.thisWeek,
  });
  res.json({ text, whatsapp: config.officeWhatsapp ? waLink(config.officeWhatsapp, text) : null });
});

/* ---------------- openings ---------------- */

hiringRouter.get('/vacancies', (req, res) =>
  res.json({
    vacancies: listVacancies({
      status: req.query.status,
      company_id: num(req.query.company_id),
      q: req.query.q,
    }),
  })
);

hiringRouter.post('/vacancies', (req, res) => {
  try {
    res.status(201).json(createVacancy(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

hiringRouter.get('/vacancies/:id', (req, res) => {
  const vacancy = getVacancy(Number(req.params.id));
  if (!vacancy) return res.status(404).json({ error: 'not found' });
  const { rows } = listApplications({ vacancy_id: vacancy.id });
  res.json({ vacancy, applications: rows });
});

hiringRouter.patch('/vacancies/:id', (req, res) => {
  const vacancy = updateVacancy(Number(req.params.id), req.body || {});
  if (!vacancy) return res.status(404).json({ error: 'not found' });
  // The requirement changed, so every score measured against the old one is stale.
  rescoreVacancy(vacancy.id);
  res.json(vacancy);
});

hiringRouter.delete('/vacancies/:id', (req, res) => {
  if (!deleteVacancy(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

/** People already on file who fit. Suggestion only - nothing joins the pipeline. */
hiringRouter.get('/vacancies/:id/suggestions', (req, res) => {
  const vacancy = getVacancy(Number(req.params.id));
  if (!vacancy) return res.status(404).json({ error: 'not found' });
  res.json({ suggestions: suggestForVacancy(vacancy.id, { limit: num(req.query.limit) || 25 }) });
});

/** Everything needed to put the opening out: the advert and the apply link. */
hiringRouter.get('/vacancies/:id/share', (req, res) => {
  const vacancy = getVacancy(Number(req.params.id));
  if (!vacancy) return res.status(404).json({ error: 'not found' });
  const baseUrl = config.publicUrl || req.query.base_url || '';
  res.json({
    public: publicVacancy(vacancy),
    apply_url: baseUrl ? applyUrl(baseUrl, vacancy) : null,
    broadcast: vacancyBroadcast(vacancy, { baseUrl }),
    published: vacancy.status === 'published',
  });
});

/* ---------------- candidates ---------------- */

hiringRouter.get('/candidates', (req, res) =>
  res.json(
    listCandidates({
      q: req.query.q,
      limit: num(req.query.limit) || 500,
      offset: num(req.query.offset) || 0,
    })
  )
);

hiringRouter.post('/candidates', (req, res) => {
  try {
    res.status(201).json(createCandidate(req.body || {}));
  } catch (err) {
    const already = /UNIQUE/i.test(err.message);
    res.status(already ? 409 : 400).json({
      error: already ? 'Somebody with this mobile number is already on file' : err.message,
    });
  }
});

hiringRouter.get('/candidates/:id', (req, res) => {
  const candidate = getCandidate(Number(req.params.id));
  if (!candidate) return res.status(404).json({ error: 'not found' });
  const { rows } = listApplications({ candidate_id: candidate.id });
  res.json({
    candidate,
    applications: rows,
    tests: listTests(candidate.id),
    resume: resumeLink(candidate),
  });
});

hiringRouter.patch('/candidates/:id', (req, res) => {
  const candidate = updateCandidate(Number(req.params.id), req.body || {});
  if (!candidate) return res.status(404).json({ error: 'not found' });
  res.json(candidate);
});

hiringRouter.delete('/candidates/:id', (req, res) => {
  const candidate = getCandidate(Number(req.params.id));
  if (!candidate) return res.status(404).json({ error: 'not found' });
  deleteResumeFile(candidate);
  deleteCandidate(candidate.id);
  res.status(204).end();
});

hiringRouter.get('/candidates/:id/resume-link', (req, res) => {
  const candidate = getCandidate(Number(req.params.id));
  if (!candidate) return res.status(404).json({ error: 'not found' });
  const link = resumeLink(candidate);
  if (!link) return res.status(404).json({ error: 'no CV on file' });
  if (!resumeFile(candidate)) return res.status(410).json({ error: 'the file is missing from disk' });
  res.json(link);
});

/** Attaching a CV that arrived by WhatsApp or email. */
hiringRouter.post('/candidates/:id/resume', uploadResumeSafely, (req, res) => {
  const candidate = getCandidate(Number(req.params.id));
  if (!candidate) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'not found' });
  }
  if (!req.file) return res.status(400).json({ error: 'no file was uploaded' });

  const previous = candidate.resume_path;
  const updated = updateCandidate(candidate.id, {
    resume_path: req.file.filename,
    resume_name: req.file.originalname,
  });
  if (previous && previous !== req.file.filename) {
    deleteResumeFile({ ...candidate, resume_path: previous });
  }
  res.status(201).json({ candidate: updated, resume: resumeLink(updated) });
});

/* ---------------- the pipeline ---------------- */

hiringRouter.get('/applications', (req, res) =>
  res.json(
    listApplications({
      vacancy_id: num(req.query.vacancy_id),
      candidate_id: num(req.query.candidate_id),
      company_id: num(req.query.company_id),
      stage: req.query.stage,
      q: req.query.q,
      limit: num(req.query.limit) || 1000,
      offset: num(req.query.offset) || 0,
    })
  )
);

/** Putting somebody already on file forward for an opening. */
hiringRouter.post('/applications', (req, res) => {
  try {
    const { application, created } = createApplication({
      vacancy_id: Number(req.body?.vacancy_id),
      candidate_id: Number(req.body?.candidate_id),
      source: req.body?.source || 'office',
      by: req.body?.by || 'office',
    });
    res.status(created ? 201 : 200).json({ application, created });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

hiringRouter.get('/applications/:id', (req, res) => {
  const application = getApplication(Number(req.params.id));
  if (!application) return res.status(404).json({ error: 'not found' });
  const candidate = getCandidate(application.candidate_id);
  const vacancy = getVacancy(application.vacancy_id);
  res.json({
    application,
    // Why it scored what it scored, and what is missing. The number on its own
    // is no use to somebody deciding.
    match: matchScore(candidate, vacancy),
    interviews: listInterviews({ application_id: application.id }),
    tests: listTests(application.candidate_id),
    resume: resumeLink(candidate),
  });
});

hiringRouter.patch('/applications/:id', (req, res) => {
  const application = updateApplication(Number(req.params.id), req.body || {});
  if (!application) return res.status(404).json({ error: 'not found' });
  res.json(application);
});

/**
 * The one way an application changes stage. Somebody asked for it; neither the
 * match score nor a test result moves anybody.
 *
 * Comes back with the message to send, because the point of the move is usually
 * that a person needs telling.
 */
hiringRouter.post('/applications/:id/stage', (req, res) => {
  const stage = req.body?.stage;
  if (!stage) return res.status(400).json({ error: 'which stage?' });
  try {
    const application = moveApplication(Number(req.params.id), stage, {
      by: req.body?.by || 'office',
      note: req.body?.note,
    });
    if (!application) return res.status(404).json({ error: 'not found' });

    const candidate = getCandidate(application.candidate_id);
    const vacancy = getVacancy(application.vacancy_id);
    const text = stageMessage(stage, {
      candidate,
      vacancy,
      offer: { salary: application.offer_salary, joining_date: application.joining_date },
    });
    res.json({
      application,
      notify: text ? { text, whatsapp: waLink(candidate.phone, text) } : null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * The handover to payroll. Deliberately its own button and not a side effect of
 * reaching "Joined": a wrong salary typed here is a wrong payslip at month end.
 */
hiringRouter.post('/applications/:id/hire', (req, res) => {
  try {
    res.status(201).json(hireApplication(Number(req.params.id), req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

hiringRouter.post('/applications/:id/test', (req, res) => {
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

hiringRouter.delete('/applications/:id', (req, res) => {
  if (!deleteApplication(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

/* ---------------- interviews and the office's list ---------------- */

hiringRouter.get('/interviews', (req, res) =>
  res.json({
    interviews: listInterviews({
      application_id: num(req.query.application_id),
      upcoming: req.query.upcoming === 'true',
    }),
  })
);

hiringRouter.post('/interviews', (req, res) => {
  try {
    const interview = createInterview(req.body || {});
    const application = getApplication(interview.application_id);
    const candidate = application ? getCandidate(application.candidate_id) : null;
    const vacancy = application ? getVacancy(application.vacancy_id) : null;
    // The call text with the details filled in. Scheduling does NOT move the
    // application - that happens when the candidate confirms.
    const text = candidate ? stageMessage('Interview', { candidate, vacancy, interview }) : null;
    res.status(201).json({
      interview,
      notify: text ? { text, whatsapp: waLink(candidate.phone, text) } : null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

hiringRouter.patch('/interviews/:id', (req, res) => {
  const interview = updateInterview(Number(req.params.id), req.body || {});
  if (!interview) return res.status(404).json({ error: 'not found' });
  res.json(interview);
});

hiringRouter.delete('/interviews/:id', (req, res) => {
  if (!deleteInterview(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

hiringRouter.get('/tasks', (req, res) => res.json({ tasks: listTasks({ status: req.query.status }) }));

hiringRouter.post('/tasks', (req, res) => {
  try {
    res.status(201).json(createTask(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

hiringRouter.patch('/tasks/:id', (req, res) => {
  const task = updateTask(Number(req.params.id), req.body || {});
  if (!task) return res.status(404).json({ error: 'not found' });
  res.json(task);
});

hiringRouter.delete('/tasks/:id', (req, res) => {
  if (!deleteTask(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

/* ---------------- exports ---------------- */

const sendCsv = (res, filename, body) => {
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${filename}"`);
  res.send(body);
};

hiringRouter.get('/export/pipeline.csv', (req, res) => {
  const { rows } = listApplications({
    vacancy_id: num(req.query.vacancy_id),
    stage: req.query.stage,
    limit: 100000,
  });
  sendCsv(res, 'hiring-pipeline.csv', toCsv(CSV_COLUMNS.pipeline, rows));
});

hiringRouter.get('/export/candidates.csv', (req, res) => {
  const { rows } = listCandidates({ q: req.query.q, limit: 100000 });
  sendCsv(
    res,
    'candidates.csv',
    toCsv(
      CSV_COLUMNS.candidates,
      // The CV itself is never in an export - a spreadsheet of strangers'
      // résumés is exactly the file that gets forwarded by mistake.
      rows.map((r) => ({ ...r, has_resume: r.resume_path ? 'yes' : '' }))
    )
  );
});
