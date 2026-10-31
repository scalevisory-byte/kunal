import fs from 'node:fs';
import { Router } from 'express';
import {
  createCandidate,
  deleteCandidate,
  getCandidate,
  listApplications,
  listCandidates,
  listTests,
  updateCandidate,
} from '../db.js';
import {
  deleteResumeFile,
  resumeFile,
  resumeLink,
  uploadResumeSafely,
} from '../resumes.js';

export const candidatesRouter = Router();

candidatesRouter.get('/', (req, res) => {
  res.json(
    listCandidates({
      q: req.query.q,
      limit: Number(req.query.limit) || 500,
      offset: Number(req.query.offset) || 0,
    })
  );
});

candidatesRouter.post('/', (req, res) => {
  try {
    res.status(201).json(createCandidate(req.body || {}));
  } catch (err) {
    // The unique index on the mobile number is the one that fires here, and
    // "this person is already on your books" is the useful thing to say.
    const already = /UNIQUE/i.test(err.message);
    res.status(already ? 409 : 400).json({
      error: already ? 'A candidate with this mobile number already exists' : err.message,
    });
  }
});

candidatesRouter.get('/:id', (req, res) => {
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

candidatesRouter.patch('/:id', (req, res) => {
  const candidate = updateCandidate(Number(req.params.id), req.body || {});
  if (!candidate) return res.status(404).json({ error: 'not found' });
  res.json(candidate);
});

candidatesRouter.delete('/:id', (req, res) => {
  const candidate = getCandidate(Number(req.params.id));
  if (!candidate) return res.status(404).json({ error: 'not found' });
  deleteResumeFile(candidate);
  deleteCandidate(candidate.id);
  res.status(204).end();
});

/** A fresh short-lived link, for a click that happens later in the session. */
candidatesRouter.get('/:id/resume-link', (req, res) => {
  const candidate = getCandidate(Number(req.params.id));
  if (!candidate) return res.status(404).json({ error: 'not found' });
  const link = resumeLink(candidate);
  if (!link) return res.status(404).json({ error: 'no CV on file' });
  if (!resumeFile(candidate)) return res.status(410).json({ error: 'the file is missing from disk' });
  res.json(link);
});

/** The recruiter attaching a CV that arrived by WhatsApp or email. */
candidatesRouter.post('/:id/resume', uploadResumeSafely, (req, res) => {
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
