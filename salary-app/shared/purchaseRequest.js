/*
 * PURCHASE REQUESTS FOR ASSETS (v2.39.0).
 *
 * The brief: Employee / Department -> Request -> Approval -> Purchase ->
 * Asset Registration -> Assignment. There was no procurement module anywhere
 * in the HRMS to reuse, so this is the smallest one that holds that line:
 *
 *   draft -> submitted (waiting for approval) -> approved | rejected
 *         -> ordered -> received -> completed;  cancelled from any open step.
 *
 * The rules are here, apart from the route and the screen, because a rule
 * inside a component cannot be tested.
 *
 *   - AN APPROVAL BUYS NOTHING AND REGISTERS NOTHING. It is a decision on
 *     record. The asset is registered by a person, on the register, through
 *     the same createAsset every other asset goes through - so the code
 *     series, the duplicate-serial check and the audit trail all hold.
 *   - Approving needs the `approve` ability (Manager and Admin - the same
 *     right that approves Sunday pay), and nobody approves their own request.
 *   - Every step is a row in the request's history, written by the same call
 *     that moves it, never edited afterwards.
 */

export const PR_STATUSES = [
  { key: 'draft', label: 'Draft', tone: 'muted' },
  { key: 'submitted', label: 'Pending approval', tone: 'warn' },
  { key: 'approved', label: 'Approved', tone: 'info' },
  { key: 'rejected', label: 'Rejected', tone: 'bad' },
  { key: 'ordered', label: 'Ordered', tone: 'info' },
  { key: 'received', label: 'Received', tone: 'info' },
  { key: 'completed', label: 'Completed', tone: 'good' },
  { key: 'cancelled', label: 'Cancelled', tone: 'muted' },
];

export const PR_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export const statusLabel = (key) => PR_STATUSES.find((s) => s.key === key)?.label || key;

/*
 * Which step may follow which, and what each step needs. `approve: true` is a
 * step only somebody with the approve ability may take.
 */
export const PR_STEPS = {
  submit: { from: ['draft'], to: 'submitted', label: 'Submit for approval' },
  approve: { from: ['submitted'], to: 'approved', label: 'Approve', approve: true },
  reject: { from: ['submitted'], to: 'rejected', label: 'Reject', approve: true, needsNote: true },
  order: { from: ['approved'], to: 'ordered', label: 'Mark ordered' },
  receive: { from: ['ordered'], to: 'received', label: 'Mark received' },
  complete: { from: ['received'], to: 'completed', label: 'Mark completed' },
  cancel: { from: ['draft', 'submitted', 'approved', 'ordered'], to: 'cancelled', label: 'Cancel', needsNote: true },
};

export const OPEN_STATUSES = new Set(['draft', 'submitted', 'approved', 'ordered', 'received']);

/** The steps that can be taken on a request now, for the person looking. */
export function stepsFor(request, { canApprove = false, isRequester = false } = {}) {
  if (!request) return [];
  return Object.entries(PR_STEPS)
    .filter(([, step]) => step.from.includes(request.status))
    .filter(([, step]) => !step.approve || (canApprove && !isRequester))
    .map(([key, step]) => ({ key, ...step }));
}

/** Why a step cannot be taken, or null. */
export function stepProblem(request, stepKey, { canApprove = false, isRequester = false, note = '' } = {}) {
  const step = PR_STEPS[stepKey];
  if (!request) return 'request not found';
  if (!step) return `unknown step: ${stepKey}`;
  if (!step.from.includes(request.status)) {
    return `a request that is ${statusLabel(request.status).toLowerCase()} cannot be moved to ${statusLabel(step.to).toLowerCase()}`;
  }
  if (step.approve && !canApprove) return 'only a Manager or an Admin can approve or reject a purchase request';
  if (step.approve && isRequester) return 'nobody approves their own purchase request';
  if (step.needsNote && !String(note || '').trim()) return `say why — a ${step.label.toLowerCase()} needs a reason`;
  return null;
}

/** What a new request must carry. */
export function validatePurchaseRequest(input = {}) {
  const problems = [];
  if (!String(input.kind || '').trim()) problems.push('say what is to be bought');
  const qty = Number(input.quantity);
  if (!Number.isInteger(qty) || qty < 1) problems.push('the quantity is a whole number, at least 1');
  if (input.estimated_cost !== undefined && input.estimated_cost !== null && input.estimated_cost !== '') {
    const cost = Number(input.estimated_cost);
    if (!Number.isFinite(cost) || cost < 0) problems.push('the estimated cost is a figure in rupees');
  }
  if (!String(input.purpose || '').trim()) problems.push('say what it is for');
  if (input.priority && !PR_PRIORITIES.includes(input.priority)) problems.push('pick a priority');
  return { ok: problems.length === 0, problems };
}

/** PR-0001, PR-0002 - read off the highest used, so a number is never reused. */
export const requestNumber = (n) => `PR-${String(n).padStart(4, '0')}`;
