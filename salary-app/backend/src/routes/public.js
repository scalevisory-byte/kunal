import fs from 'node:fs';
import { Router } from 'express';
import { createApplication, getApplication, getCandidate, getVacancy, getVacancyByRef, listVacancies, openAttempt, recordTest, submitAttempt, updateCandidate, upsertCandidate } from '../hiring.js';
import { config } from '../config.js';
import { log } from '../logger.js';
import { publicVacancy } from '../../../shared/hiringMessages.js';
import { testFor } from '../../../shared/hiringTest.js';
import { deleteResumeFile, uploadResumeSafely } from '../resumes.js';
import { makeToken, readToken } from '../tokens.js';

export const publicRouter = Router();

/*
 * The only part of this app a person outside the office ever sees.
 *
 * It is reachable WITHOUT the password, because a candidate cannot have one.
 * So the rule is narrow and absolute: this side may create an application and
 * attach a CV to it, and may read only what a job advert says.
 *
 *   - published openings only, never a draft or a closed one,
 *   - the public shape only, so internal notes and who the seat reports to
 *     never leave the office,
 *   - no way to list, read or search candidates, and no way to see a stage,
 *   - and nothing of the payroll side: this router cannot see an employee, a
 *     salary sheet or an attendance row at all.
 *
 * Nothing here takes a payment or asks for one.
 */

/* ---------------- a crude rate limit ---------------- */

/**
 * In-memory, per IP, per minute. Not a real rate limiter and not meant to be -
 * it is here so one bored person with a loop cannot fill the candidate table
 * overnight. The window resets with the process; that is acceptable.
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
    whatsapp: config.officeWhatsapp || null,
    max_resume_mb: Math.round(config.maxResumeBytes / (1024 * 1024)),
    /*
     * Whether a test is offered now depends on the OPENING, so this only says
     * whether there is an app-wide fallback. The apply page asks for the test
     * link itself and handles a 404 as "this job has none".
     */
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
 * file to hand can attach the CV a minute later without re-typing everything -
 * and that token is the ONLY way the public side can touch that row again.
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
      dob: body.dob,
      gender: body.gender,
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
      source: body.source || 'apply',
      referred_by: body.referred_by,
      ...(req.file ? { resume_path: req.file.filename, resume_name: req.file.originalname } : {}),
    });

    // upsertCandidate never overwrites a filled field, which is right for a
    // salary and wrong for a CV: the newest one is the one to keep.
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
      // Deliberately NOT returned: the stage, the match score, the internal
      // notes. A candidate is told where they stand by a person, not a page.
    });
  } catch (err) {
    cleanUp();
    log.error(`Public apply failed: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

/** Attaching the CV afterwards, using the token the apply call returned. */
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
 * Where the candidate's test lives. The test is Dinesh's own system in an
 * iframe: this hands back its URL with a callback token on it, so a score can
 * come back without the test system needing this app's password.
 */
publicRouter.get('/test/:token', (req, res) => {
  const claim = readToken('resume-upload', req.params.token) || readToken('test', req.params.token);
  if (!claim) return res.status(403).json({ error: 'This test link has expired.' });

  /*
   * The test belongs to the OPENING they applied for, falling back to the
   * app-wide one. The vacancy is read from the application rather than from
   * anything the request says, so a token for one job cannot fetch another
   * job's test.
   */
  const application = claim.a ? getApplication(claim.a) : null;
  const vacancy = application ? getVacancy(application.vacancy_id) : null;
  const test = testFor(vacancy, {
    url: config.testEmbedUrl,
    passPercent: config.testPassPercent,
    secondsPerQuestion: config.testSecondsPerQuestion,
  });
  if (!test.url) return res.status(404).json({ error: 'No test is set up for this opening yet.' });

  const back = makeToken('test', { c: claim.c, a: claim.a }, { minutes: 240 });
  const url = new URL(test.url);
  url.searchParams.set('ref', String(claim.a ?? claim.c));
  url.searchParams.set('callback_token', back);
  /*
   * The per-question limit rides on the URL so the test system can run the
   * clock - this app cannot, it is not the thing watching the candidate type.
   * Left OFF the URL entirely when there is no limit, rather than sent as 0,
   * which a test system could read as "no time at all".
   */
  if (test.secondsPerQuestion) {
    url.searchParams.set('seconds_per_question', String(test.secondsPerQuestion));
  }
  res.json({
    url: url.toString(),
    pass_percent: test.passPercent,
    seconds_per_question: test.secondsPerQuestion,
  });
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
    // Recorded, and nothing moves. A test result is one more thing to weigh,
    // never an automatic shortlist or rejection.
    res.status(201).json({ ok: true, percentage: test.percentage });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ---------------- sitting an in-house test ---------------- */

/*
 * Two unauthenticated routes, and the token is the whole of the identity.
 *
 * Nothing here takes a candidate id, a paper id or a question id from the
 * caller: the token reaches exactly one attempt and everything else is read
 * off it. A caller who changes the token gets a 404, not somebody else's test.
 *
 * And what comes back carries NO correct answers. That is enforced in
 * shared/questionBank.js by forCandidate(), which builds the candidate's copy
 * field by field rather than deleting fields from the stored one - a delete
 * list is a list somebody forgets to add to.
 */
publicRouter.get('/sit/:token', (req, res) => {
  const paper = openAttempt(req.params.token);
  return paper ? res.json(paper) : res.status(404).json({ error: 'no such test' });
});

publicRouter.post('/sit/:token', (req, res) => {
  try {
    const out = submitAttempt(req.params.token, req.body?.answers || {}, {
      auto: Boolean(req.body?.auto),
    });
    return out ? res.json(out) : res.status(404).json({ error: 'no such test' });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * Anything else under /api/public is a 404 here rather than falling through to
 * the authenticated catch-all, which would answer "unauthorized" and send
 * somebody hunting for a password that was never the problem.
 */
publicRouter.use((req, res) => res.status(404).json({ error: 'not found' }));
