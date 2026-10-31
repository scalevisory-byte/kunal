import { Router } from 'express';
import {
  listApplications,
  listCandidates,
  listFollowups,
  listInterviews,
  listPlacements,
  overview,
} from '../db.js';
import { CSV_COLUMNS, toCsv } from '../../../shared/csv.js';
import { recruiterDigest, waLink } from '../../../shared/messages.js';
import { config } from '../config.js';

export const reportsRouter = Router();

reportsRouter.get('/overview', (req, res) => {
  const interviews = listInterviews({ upcoming: true });
  const followups = listFollowups({ status: 'open' });
  const { rows: recent } = listApplications({ limit: 12 });
  res.json({ ...overview(), upcoming: interviews, open_followups: followups, recent });
});

/**
 * The recruiter's own day as one WhatsApp message. Nothing sends this on its
 * own - there is no WhatsApp session in this app - so it comes back as text
 * plus a link to his own number.
 */
reportsRouter.get('/digest', (req, res) => {
  const interviews = listInterviews({ upcoming: true }).filter(
    (i) => String(i.at).slice(0, 10) === new Date().toISOString().slice(0, 10)
  );
  const followups = listFollowups({ status: 'open' });
  const counts = overview();
  const text = recruiterDigest({
    interviews,
    followups,
    newApplications: counts.applications.thisWeek,
  });
  res.json({
    text,
    whatsapp: config.agencyWhatsapp ? waLink(config.agencyWhatsapp, text) : null,
  });
});

const sendCsv = (res, filename, body) => {
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${filename}"`);
  res.send(body);
};

reportsRouter.get('/export/pipeline.csv', (req, res) => {
  const { rows } = listApplications({
    vacancy_id: Number(req.query.vacancy_id) || undefined,
    stage: req.query.stage,
    limit: 100000,
  });
  sendCsv(res, 'pipeline.csv', toCsv(CSV_COLUMNS.pipeline, rows));
});

reportsRouter.get('/export/candidates.csv', (req, res) => {
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

reportsRouter.get('/export/placements.csv', (req, res) => {
  sendCsv(res, 'placements.csv', toCsv(CSV_COLUMNS.placements, listPlacements()));
});
