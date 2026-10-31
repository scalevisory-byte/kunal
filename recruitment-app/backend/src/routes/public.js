import fs from 'node:fs';
import { Router } from 'express';
import {
  createApplication,
  getApplication,
  getCandidate,
  getVacancyByRef,
  listVacancies,
  recordTest,
  updateCandidate,
  upsertCandidate,
} from '../db.js';
import { config } from '../config.js';
import { log } from '../logger.js';
import { publicVacancy } from '../../../shared/messages.js';
import { deleteResumeFile, uploadResumeSafely } from '../resumes.js';
import { makeToken, readToken } from '../tokens.js';

export const publicRouter = Router();

/*
 * Everything in here is reachable WITHOUT the password, because a candidate
 * cannot have one. So the rule is narrow and absolute: this side may create an
 * application and attach a CV to it, and may read only what a job advert says.
 *
 *   - published vacancies only, never a draft or a closed one,
 *   - the public shape only, so the client company's name never leaves,
 *   - no way to list, read or search candidates, and no way to see a stage.
 *
 * A candidate is never charged anything, and nothing here takes a payment.
 */

/* ---------------- a crude rate limit ---------------- */

/**
 * In-memory, per IP, per minute. Not a real rate limiter and not meant to be -
 * it is here so that one bored person with a loop cannot fill the candidate
 * table overnight. The window resets with the process; that is acceptable.
 */
const hits = new Map();
const rateLimit = (max) => (req, res, next) => {
  const key = `${req.ip}:${Math.floor(Date.now() / 60000)}`;
  const n = (hits.get(key) || 0) + 1;
  hits.set(key, n);
  if (hits.size > 5000) hits.clear();
  if (n > max) {
    log.warn(`Rate limited ${req.ip} on ${req.path}`);
    return res.status(429).json({ error: 'Too many attempts. Please try again in a minute.' });
  }
  next();
};

/* ---------------- what a candidate may read ---------------- */

publicRouter.get('/config', (req, res) =>
  res.json({
    brand: config.brandName,
    whatsapp: config.agencyWhatsapp || null,
    // The résumé is optional at the quick-apply step but we say the limit.
    max_resume_mb: Math.round(config.maxResumeBytes / (1024 * 1024)),
    // So the apply page does not ask for a test URL that does not exist.
    test_configured: !!config.testEmbedUrl,
  })
);

publicRouter.get('/vacancies', (req, res) =>
  res.json({ vacancies: listVacancies({ status: 'published' }).map(publicVacancy) })
);

publicRouter.get('/vacancies/:ref', (req, res) => {
  const vacancy = getVacancyByRef(req.params.ref);
  if (!vacancy || vacancy.status !== 'published') {
    return res.status(404).json({ error: 'This opening is no longer accepting applications.' });
  }
  res.json({ vacancy: publicVacancy(vacancy) });
});

/* ---------------- applying ---------------- */

const REQUIRED = ['name', 'phone'];

/**
 * Apply. One endpoint for both shapes: JSON for a quick apply (multer ignores
 * a request that is not multipart) and multipart when the CV comes with it.
 *
 * Comes back with an upload token so somebody who applied from a phone with no
 * file handy can attach the CV a minute later without re-typing everything -
 * and so that token is the ONLY way the public side can touch that row.
 */
publicRouter.post('/vacancies/:ref/apply', rateLimit(10), uploadResumeSafely, (req, res) => {
  const cleanUp = () => {
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* already gone */
      }
    }
  };

  const vacancy = getVacancyByRef(req.params.ref);
  if (!vacancy || vacancy.status !== 'published') {
    cleanUp();
    return res.status(404).json({ error: 'This opening is no longer accepting applications.' });
  }

  const body = req.body || {};
  const missing = REQUIRED.filter((f) => !String(body[f] || '').trim());
  if (missing.length) {
    cleanUp();
    return res.status(400).json({ error: `Please fill in: ${missing.join(', ')}` });
  }
  if (String(body.phone).replace(/\D/g, '').length < 10) {
    cleanUp();
    return res.status(400).json({ error: 'Please enter a 10-digit mobile number.' });
  }

  try {
    const { candidate, created } = upsertCandidate({
      name: String(body.name).trim(),
      phone: body.phone,
      email: body.email,
      location: body.location,
      preferred_location: body.preferred_location,
      education: body.education,
      experience: body.experience,
      current_company: body.current_company,
      current_salary: body.current_salary,
      expected_salary: body.expected_salary,
      notice_period: body.notice_period,
      role: body.role || vacancy.title,
      skills: body.skills,
      industry: body.industry || vacancy.industry,
      source: body.source || 'apply',
      referred_by: body.referred_by,
      ...(req.file ? { resume_path: req.file.filename, resume_name: req.file.originalname } : {}),
    });

    // upsertCandidate never overwrites a filled field, which is right for a
    // salary but wrong for a CV: the newest one is the one to keep.
    let person = candidate;
    if (req.file && candidate.resume_path !== req.file.filename) {
      const previous = candidate.resume_path;
      person = updateCandidate(candidate.id, {
        resume_path: req.file.filename,
        resume_name: req.file.originalname,
      });
      if (previous) deleteResumeFile({ ...candidate, resume_path: previous });
    }

    const { application, created: isNew } = createApplication({
      vacancy_id: vacancy.id,
      candidate_id: person.id,
      source: 'apply',
      by: 'candidate',
    });

    res.status(isNew ? 201 : 200).json({
      ok: true,
      already_applied: !isNew,
      candidate_ref: person.ref_no,
      new_candidate: created,
      has_resume: !!person.resume_path,
      upload_token: makeToken('resume-upload', { c: person.id, a: application.id }),
      message: isNew
        ? 'Your application has been received. We will be in touch.'
        : 'You have already applied for this opening — your details have been updated.',
      // Deliberately NOT returned: the stage, the match score, the client's
      // name. A candidate is told where they stand by a person, not a page.
    });
  } catch (err) {
    cleanUp();
    log.error(`Public apply failed: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

/** Attaching the CV after the fact, using the token the apply call returned. */
publicRouter.post('/resume/:token', rateLimit(10), uploadResumeSafely, (req, res) => {
  const claim = readToken('resume-upload', req.params.token);
  if (!claim) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(403).json({ error: 'This upload link has expired. Please apply again.' });
  }
  if (!req.file) return res.status(400).json({ error: 'Please choose a file.' });

  const candidate = getCandidate(claim.c);
  if (!candidate) {
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'not found' });
  }
  const previous = candidate.resume_path;
  updateCandidate(candidate.id, {
    resume_path: req.file.filename,
    resume_name: req.file.originalname,
  });
  if (previous && previous !== req.file.filename) {
    deleteResumeFile({ ...candidate, resume_path: previous });
  }
  res.status(201).json({ ok: true, message: 'Thank you — your CV has been received.' });
});

/* ---------------- the test ---------------- */

/**
 * Where the candidate's test lives. The test is Dinesh's own system, dropped
 * into an iframe: this hands back its URL with a callback token on it, so a
 * score can come back without the test system needing the app's password.
 */
publicRouter.get('/test/:token', (req, res) => {
  const claim = readToken('resume-upload', req.params.token) || readToken('test', req.params.token);
  if (!claim) return res.status(403).json({ error: 'This test link has expired.' });
  if (!config.testEmbedUrl) return res.status(404).json({ error: 'No test is set up yet.' });

  const back = makeToken('test', { c: claim.c, a: claim.a }, { minutes: 240 });
  const url = new URL(config.testEmbedUrl);
  url.searchParams.set('ref', String(claim.a ?? claim.c));
  url.searchParams.set('callback_token', back);
  res.json({ url: url.toString(), pass_percent: config.testPassPercent });
});

/** The test system posting a score back. The token is what authorises it. */
publicRouter.post('/test-result/:token', rateLimit(30), (req, res) => {
  const claim = readToken('test', req.params.token);
  if (!claim) return res.status(403).json({ error: 'invalid or expired token' });
  const application = claim.a ? getApplication(claim.a) : null;
  const candidateId = application ? application.candidate_id : claim.c;
  if (!candidateId) return res.status(404).json({ error: 'not found' });

  try {
    const test = recordTest({
      candidate_id: candidateId,
      application_id: application?.id ?? null,
      type: req.body?.type || 'skills',
      score: req.body?.score,
      max_score: req.body?.max_score,
      percentage: req.body?.percentage,
      source: req.body?.source || 'embedded test',
      answers: req.body?.answers ? JSON.stringify(req.body.answers) : null,
      pass_percent: req.body?.pass_percent,
    });
    // The score is recorded and nothing moves. A test result is one more thing
    // for the recruiter to weigh, never an automatic shortlist or rejection.
    res.status(201).json({ ok: true, percentage: test.percentage });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
