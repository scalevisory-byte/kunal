import { Router } from 'express';
import {
  createLoan,
  deleteLoan,
  getLoan,
  getPeriod,
  listLoans,
  listRepayments,
  postRepayments,
  setRepayment,
  updateLoan,
} from '../db.js';

export const loansRouter = Router();

loansRouter.get('/', (req, res) => {
  res.json({
    loans: listLoans({
      employee_id: Number(req.query.employee_id) || undefined,
      includeClosed: req.query.closed !== 'false',
    }),
    repayments: req.query.period_id ? listRepayments(Number(req.query.period_id)) : [],
  });
});

loansRouter.post('/', (req, res) => {
  try {
    res.status(201).json(createLoan(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

loansRouter.patch('/:id', (req, res) => {
  const loan = updateLoan(Number(req.params.id), req.body || {});
  if (!loan) return res.status(404).json({ error: 'not found' });
  res.json(loan);
});

loansRouter.delete('/:id', (req, res) => {
  if (!deleteLoan(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

/** Change what one loan takes in one month - nothing this month, say. */
loansRouter.put('/:id/repayment/:periodId', (req, res) => {
  const loan = getLoan(Number(req.params.id));
  const period = getPeriod(Number(req.params.periodId));
  if (!loan || !period) return res.status(404).json({ error: 'not found' });
  if (period.locked) return res.status(409).json({ error: 'period is locked' });
  res.json(setRepayment(loan.id, period.id, req.body?.amount));
});

/** Catch a month up after a loan was added late. */
loansRouter.post('/post/:periodId', (req, res) => {
  const period = getPeriod(Number(req.params.periodId));
  if (!period) return res.status(404).json({ error: 'period not found' });
  if (period.locked) return res.status(409).json({ error: 'period is locked' });
  res.json({ added: postRepayments(period.id) });
});
