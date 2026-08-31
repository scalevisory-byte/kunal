import { Router } from 'express';
import { createEmployee, deleteEmployee, getEmployee, listEmployees, updateEmployee } from '../db.js';

export const employeesRouter = Router();

employeesRouter.get('/', (req, res) => {
  const active = req.query.active === undefined ? undefined : req.query.active !== 'false';
  res.json({ employees: listEmployees({ company_id: Number(req.query.company_id) || undefined, active }) });
});

employeesRouter.post('/', (req, res) => {
  try {
    res.status(201).json(createEmployee(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

employeesRouter.get('/:id', (req, res) => {
  const employee = getEmployee(Number(req.params.id));
  if (!employee) return res.status(404).json({ error: 'not found' });
  res.json(employee);
});

employeesRouter.patch('/:id', (req, res) => {
  const employee = updateEmployee(Number(req.params.id), req.body || {});
  if (!employee) return res.status(404).json({ error: 'not found' });
  res.json(employee);
});

employeesRouter.delete('/:id', (req, res) => {
  if (!deleteEmployee(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});
