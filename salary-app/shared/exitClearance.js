/**
 * EXIT CLEARANCE — what has to be settled before somebody walks out.
 *
 * Dinesh: *"exit par clearance checklist bhi bana do"*.
 *
 * THE RULE THE WHOLE THING RESTS ON: **what the app can work out, it works
 * out; what only a person knows, a person signs.**
 *
 * A clearance form that is nothing but tick boxes is how "Assets: cleared"
 * ends up next to a register saying three things are still out. So the list
 * is in two halves:
 *
 *   **CHECKED** — assets still out, a loan still owed, a penalty still being
 *   recovered, a claim approved and unpaid, a staff login still working.
 *   These come from the registers that already hold them and **cannot be
 *   ticked off**: they clear when the thing itself is settled.
 *
 *   **SIGNED** — IT, Accounts, Store, HR, and the person's own manager. These
 *   are judgements nobody can compute: whether the handover notes are
 *   readable, whether the keys came back, whether there is anything the
 *   office should know. Somebody puts their name to each.
 *
 * TWO MORE RULES, both the ones this app keeps:
 *
 *   **NOT LOOKED AT IS NOT REFUSED.** A step nobody has touched is `pending`,
 *   which is a third state and not a "no".
 *
 *   **IT IS A CHECKLIST, NOT A GATE.** Nothing here blocks the full and
 *   final: the office sometimes pays on a promise, and a system that refuses
 *   gets worked around with a cash payment nobody records. What it does is
 *   say, in words, what is still open at the moment the money goes out.
 *
 * Dependency-free, like the rest of shared/.
 */

/** The steps a person signs. Key, who it is for, and what they are confirming. */
export const CLEARANCE_STEPS = [
  ['it', 'IT', 'Email and logins closed, files handed over, any company device wiped or collected.'],
  ['accounts', 'Accounts', 'Nothing outstanding on advances, reimbursements, cards or petty cash.'],
  ['store', 'Store / Admin', 'Keys, uniform, ID card, locker and anything from the store are back.'],
  ['manager', 'Reporting manager', 'Work handed over, customers and files passed on, nothing left half-done.'],
  ['hr', 'HR', 'Exit interview done, documents collected, relieving and experience letters agreed.'],
];

export const STEP_KEYS = CLEARANCE_STEPS.map(([key]) => key);
export const stepLabel = (key) => CLEARANCE_STEPS.find(([k]) => k === key)?.[1] || key;
export const stepAsk = (key) => CLEARANCE_STEPS.find(([k]) => k === key)?.[2] || '';

/**
 * The three states a signed step can be in.
 *
 * `pending` is what a step nobody has touched reads as — NOT `blocked`. The
 * same three-state rule the attendance approvals and the uniform check follow:
 * nobody having looked is not a refusal.
 */
export const CLEARANCE_STATES = [
  ['pending', 'Not looked at yet'],
  ['given', 'Cleared'],
  ['blocked', 'Something is pending'],
  ['na', 'Does not apply'],
];

export const cleanState = (value) =>
  CLEARANCE_STATES.some(([key]) => key === value) ? value : 'pending';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (n) => `₹${Math.round(num(n)).toLocaleString('en-IN')}`;

/**
 * The whole checklist for one person.
 *
 * @param signed      rows from exit_clearances for this employee
 * @param assets_out  what is still with them (the register's own answer)
 * @param loans       their loans, as listLoans returns them
 * @param penalties   their penalties
 * @param claims      their expense claims
 * @param login       their staff login row, or null
 */
export function exitClearance({
  signed = [],
  assets_out: assetsOut = [],
  loans = [],
  penalties = [],
  claims = [],
  login = null,
} = {}) {
  const by = new Map(signed.map((row) => [row.step, row]));

  const people = CLEARANCE_STEPS.map(([key, label, ask]) => {
    const row = by.get(key) || null;
    return {
      kind: 'signed',
      key,
      label,
      ask,
      state: cleanState(row?.state),
      by_whom: row?.by_whom || '',
      on: row?.cleared_on || '',
      note: row?.note || '',
      // Open until somebody has actually said something about it. "Does not
      // apply" is a decision too, so it counts as dealt with.
      open: !['given', 'na'].includes(cleanState(row?.state)),
    };
  });

  /* ---- the half the app already knows ---- */

  const assetValue = assetsOut.reduce((sum, a) => sum + num(a.purchase_cost ?? a.value), 0);
  const owing = loans.filter((l) => num(l.outstanding ?? (num(l.amount) - num(l.repaid))) > 0);
  const owed = owing.reduce((sum, l) => sum + num(l.outstanding ?? (num(l.amount) - num(l.repaid))), 0);
  const unpaidPenalties = penalties.filter(
    (p) => p.status !== 'waived' && num(p.outstanding ?? p.amount) > 0 && p.status !== 'recovered'
  );
  const unpaidClaims = claims.filter((c) => c.status === 'approved' || c.status === 'pending');

  const checked = [
    {
      kind: 'checked',
      key: 'assets',
      label: 'Company property back',
      state: assetsOut.length ? 'blocked' : 'given',
      open: assetsOut.length > 0,
      detail: assetsOut.length
        ? `${assetsOut.length} still with them, ${money(assetValue)} at cost — ${assetsOut
            .slice(0, 4)
            .map((a) => a.code || a.label || 'one')
            .join(', ')}${assetsOut.length > 4 ? ' and more' : ''}`
        : 'Nothing is out with them.',
      // Said on the screen, because it is the question people ask next.
      note: assetsOut.length
        ? 'Named and valued, never deducted. Take it back from their asset ledger.'
        : '',
    },
    {
      kind: 'checked',
      key: 'loan',
      label: 'Loans and advances',
      state: owing.length ? 'blocked' : 'given',
      open: owing.length > 0,
      detail: owing.length
        ? `${owing.length} still running, ${money(owed)} outstanding`
        : 'Nothing outstanding.',
      note: owing.length ? 'Decide whether it comes out of the final payment — it is not taken automatically.' : '',
    },
    {
      kind: 'checked',
      key: 'penalties',
      label: 'Penalties being recovered',
      state: unpaidPenalties.length ? 'blocked' : 'given',
      open: unpaidPenalties.length > 0,
      detail: unpaidPenalties.length
        ? `${unpaidPenalties.length} not fully recovered`
        : 'Nothing outstanding.',
    },
    {
      kind: 'checked',
      key: 'claims',
      label: 'Expense claims',
      state: unpaidClaims.length ? 'blocked' : 'given',
      open: unpaidClaims.length > 0,
      detail: unpaidClaims.length
        ? `${unpaidClaims.length} raised and not paid`
        : 'Nothing waiting.',
      note: unpaidClaims.length ? 'Approve and pay, or reject — a claim left pending is money nobody decided about.' : '',
    },
    {
      kind: 'checked',
      key: 'login',
      label: 'Staff login',
      // No login at all is not an outstanding item: most people never had one.
      state: login ? (login.active === 0 ? 'given' : 'blocked') : 'na',
      open: Boolean(login) && login.active !== 0,
      detail: login
        ? login.active === 0
          ? `${login.username} is switched off.`
          : `${login.username} still works — their payslips and their punch link are still open.`
        : 'They never had one.',
    },
  ];

  const items = [...checked, ...people];
  const open = items.filter((i) => i.open);

  return {
    items,
    checked,
    signed: people,
    outstanding: open.length,
    /** Everything dealt with — said plainly, and still not a gate. */
    ready: open.length === 0,
    // What to put in front of somebody about to pay the full and final.
    blocking: open.map((i) => i.label),
  };
}
