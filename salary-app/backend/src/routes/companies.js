import { Router } from 'express';
import {
  getCompany,
  createBranch,
  createCompany,
  deleteBranch,
  deleteCompany,
  listBranches,
  listCompanies,
  updateBranch,
  updateCompany,
} from '../db.js';
import {
  MAX_LOGO_BYTES, logoDataUri, logoFile, removeLogo, saveLogo, uploadLogo,
} from '../companyLogos.js';

export const companiesRouter = Router();

companiesRouter.get('/', (req, res) => res.json({ companies: listCompanies() }));

companiesRouter.post('/', (req, res) => {
  try {
    res.status(201).json(createCompany(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

companiesRouter.patch('/:id', (req, res) => {
  const company = updateCompany(Number(req.params.id), req.body || {});
  if (!company) return res.status(404).json({ error: 'not found' });
  res.json(company);
});

companiesRouter.delete('/:id', (req, res) => {
  if (!deleteCompany(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

/* ---------------- the logo, for the papers that leave the building ---------------- */

/*
 * "offer letter me company ka logo bhi aana chahiye".
 *
 * One logo per company, because these are separate businesses: an offer from
 * BOOKNFLY must not go out under SCALE VISORY's mark.
 *
 * Uploading and removing are changes, so the mount's `requireAdminForChanges`
 * already has them. Reading the picture is a read.
 */
/*
 * Every logo at once, as data: URIs, for the documents the BROWSER builds.
 *
 * The offer letter is written on the server and can read the file itself. A
 * payslip is not: the slip on screen, the stack printed off the salary sheet
 * and the file forwarded on WhatsApp are all assembled in the browser from
 * `calculateRow`, so the picture has to get there.
 *
 * Asked for only when one of those is being made - never on the companies
 * list, which every screen loads. A logo is a few kilobytes; eighty-five of
 * them on every page load would not be.
 */
companiesRouter.get('/logos', (req, res) => {
  res.json({
    logos: listCompanies()
      .filter((c) => c.has_logo)
      .map((c) => ({ id: c.id, name: c.name, logo: logoDataUri(c.id) }))
      .filter((c) => c.logo),
  });
});

companiesRouter.post('/:id/logo', uploadLogo, (req, res) => {
  const company = getCompany(Number(req.params.id));
  if (!company) return res.status(404).json({ error: 'not found' });
  if (!req.file) {
    const kb = Math.round(MAX_LOGO_BYTES / 1024);
    return res.status(400).json({ error: `Choose a PNG, JPG, WEBP or GIF of up to ${kb} KB.` });
  }
  return res.json({ company: company.name, ...saveLogo(company.id, req.file) });
});

companiesRouter.delete('/:id/logo', (req, res) => {
  const company = getCompany(Number(req.params.id));
  if (!company) return res.status(404).json({ error: 'not found' });
  res.json({ company: company.name, ...removeLogo(company.id) });
});

/*
 * The picture itself, served inline behind the session.
 *
 * Deliberately NOT a signed expiring link like a document: this is drawn by an
 * <img> on a settings page that may sit open all afternoon, and it is a logo -
 * the one picture in this app that is meant to be seen by outsiders anyway.
 * The same reasoning as the employee photograph route.
 */
companiesRouter.get('/:id/logo', (req, res) => {
  const file = logoFile(Number(req.params.id));
  if (!file) return res.status(404).json({ error: 'no logo on file' });
  res.setHeader('cache-control', 'private, max-age=3600');
  return res.sendFile(file);
});

/* ---------------- branches, beneath a company ---------------- */

/*
 * Dinesh's answer when asked what "branch" meant here: *"branches under a
 * company"*, because the salary already runs across three or four separate
 * companies and a branch is a place inside one of them.
 *
 * Reads are open to anybody signed in - the employee form needs the list.
 * Changes are an admin's, which the server mount already enforces.
 */
companiesRouter.get('/branches', (req, res) => {
  res.json({
    branches: listBranches({
      company_id: Number(req.query.company_id) || undefined,
      active: req.query.all === 'true' ? undefined : true,
    }),
  });
});

companiesRouter.post('/branches', (req, res) => {
  try {
    res.status(201).json(createBranch(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

companiesRouter.patch('/branches/:id', (req, res) => {
  try {
    res.json(updateBranch(Number(req.params.id), req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** The people stay with their company; only the branch goes. */
companiesRouter.delete('/branches/:id', (req, res) => {
  if (!deleteBranch(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});
