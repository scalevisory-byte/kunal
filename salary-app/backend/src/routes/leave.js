import { Router } from 'express';
import {
  addLeaveCredit,
  deleteLeaveCredit,
  getEmployee,
  leaveSummary,
  leaveTaken,
  listEmployees,
  listLeaveCredits,
} from '../db.js';
import { balanceRow, ledgersFor } from '../../../shared/leaveLedger.js';
import { ATTENDANCE_CODES } from '../../../shared/calc.js';

export const leaveRouter = Router();

/**
 * THE LEAVE TYPES IN PLAY.
 *
 * Read off `ATTENDANCE_CODES`, which is what the grid marks and the salary
 * sheet pays from - NOT a second list of leave types that could disagree
 * with it. A company that wants Compensatory Off adds a mark there, and it
 * appears here, on the ledger and in the balance register without another
 * line of code.
 */
const LEAVE_CODES = ['CL', 'SL', 'PL', 'UL'];
const TYPES = LEAVE_CODES.map((code) => ({
  code,
  label: ATTENDANCE_CODES[code]?.label || code,
  /* Whether it costs pay. UL is leave without pay, so its "balance" is a
     count of what was taken, not an entitlement anybody has. */
  paid: !ATTENDANCE_CODES[code]?.absent,
}));

const quotasOf = (employee) => ({
  CL: employee?.cl_quota || 0,
  SL: employee?.sl_quota || 0,
  PL: employee?.pl_quota || 0,
  UL: 0,
});

const byCode = (rows) => {
  const out = {};
  for (const r of rows) (out[r.code] ||= []).push(r);
  return out;
};

/** The leave register for a calendar year. Unchanged: other screens read it. */
leaveRouter.get('/', (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  res.json({ year, rows: leaveSummary(year) });
});

/** Which leave types the ledger and the register show. */
leaveRouter.get('/types', (_req, res) => res.json({ types: TYPES }));

/**
 * ONE PERSON'S LEDGER, the way Dinesh asked for it: date, particulars,
 * credit, debit, balance, reference, with opening and closing.
 *
 * Every debit is DERIVED from the attendance marks, so this and the muster
 * roll cannot disagree about a day. Only the credits are stored.
 */
leaveRouter.get('/ledger/:employeeId', (req, res) => {
  const employee = getEmployee(Number(req.params.employeeId));
  if (!employee) return res.status(404).json({ error: 'not found' });
  const year = Number(req.query.year) || new Date().getFullYear();

  const ledgers = ledgersFor({
    types: TYPES,
    credits: listLeaveCredits({ employee_id: employee.id, year }),
    takenByCode: byCode(leaveTaken({ year, employee_id: employee.id, codes: LEAVE_CODES })),
    quotas: quotasOf(employee),
    year,
  });

  res.json({
    employee: {
      id: employee.id,
      name: employee.name,
      code: employee.code || '',
      company_name: employee.company_name || '',
      branch_name: employee.branch_name || '',
      department: employee.department || '',
    },
    year,
    types: TYPES,
    ledgers,
  });
});

/**
 * THE BALANCE REGISTER: every person, every type, side by side.
 *
 * Built from the same `ledgerFor` one person's page uses, so a figure here
 * and the ledger behind it cannot differ - which is the whole reason the
 * balances are not computed twice.
 */
leaveRouter.get('/balances', (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const company_id = Number(req.query.company_id) || undefined;
  const employees = listEmployees({ active: true, company_id });

  const credits = listLeaveCredits({ year });
  const taken = leaveTaken({ year, codes: LEAVE_CODES });
  const creditsFor = new Map();
  for (const c of credits) {
    if (!creditsFor.has(c.employee_id)) creditsFor.set(c.employee_id, []);
    creditsFor.get(c.employee_id).push(c);
  }
  const takenFor = new Map();
  for (const t of taken) {
    if (!takenFor.has(t.employee_id)) takenFor.set(t.employee_id, []);
    takenFor.get(t.employee_id).push(t);
  }

  res.json({
    year,
    types: TYPES,
    rows: employees.map((employee) =>
      balanceRow({
        employee,
        ledgers: ledgersFor({
          types: TYPES,
          credits: creditsFor.get(employee.id) || [],
          takenByCode: byCode(takenFor.get(employee.id) || []),
          quotas: quotasOf(employee),
          year,
        }),
      })
    ),
  });
});

/* ---------------- posting a credit ---------------- */

/**
 * The only way the ledger is written to.
 *
 * Nothing here touches attendance: a credit gives somebody leave to take, it
 * does not mark a day. Marking a day is the grid's job and an approval's,
 * and that is still the only thing that changes what anybody is paid.
 */
leaveRouter.post('/credits', (req, res) => {
  try {
    res.status(201).json(addLeaveCredit(req.body || {}, req.actor?.name || 'office'));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

leaveRouter.get('/credits', (req, res) =>
  res.json({
    credits: listLeaveCredits({
      employee_id: Number(req.query.employee_id) || undefined,
      code: req.query.code || undefined,
      year: Number(req.query.year) || undefined,
    }),
  })
);

leaveRouter.delete('/credits/:id', (req, res) =>
  res.json({ deleted: deleteLeaveCredit(Number(req.params.id), req.actor?.name || 'office') })
);
