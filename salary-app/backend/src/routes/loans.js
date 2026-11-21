import { Router } from 'express';
import {
  allRepayments,
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

import { loanSettlement } from '../../../shared/loanSettlement.js';

export const loansRouter = Router();

/**
 * LOANS CLOSED OVER A PERIOD, and what is still running.
 *
 * Closure is DERIVED from the repayments rather than stored - a loan is
 * finished when what has been repaid reaches what was advanced, and the
 * month it finished in is the month of the repayment that got it there. A
 * `closed_on` column would be a second record of the same fact, and the two
 * would disagree the first time an instalment was edited.
 */
loansRouter.get('/settlement', (req, res) => {
  const loans = listLoans({ includeClosed: true });
  const byLoan = new Map();
  for (const r of allRepayments()) {
    if (!byLoan.has(r.loan_id)) byLoan.set(r.loan_id, []);
    byLoan.get(r.loan_id).push(r);
  }
  res.json(
    loanSettlement(loans, (id) => byLoan.get(id) || [], {
      year: Number(req.query.year) || undefined,
    })
  );
});

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
