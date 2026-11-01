import { Router } from 'express';
import {
  createBranch,
  createCompany,
  deleteBranch,
  deleteCompany,
  listBranches,
  listCompanies,
  updateBranch,
  updateCompany,
} from '../db.js';

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
