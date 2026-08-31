import { Router } from 'express';
import { createCompany, deleteCompany, listCompanies, updateCompany } from '../db.js';

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
