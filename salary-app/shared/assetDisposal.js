/**
 * Approving a write-off or a disposal (v2.48.0).
 *
 * Buying already asks first - Purchase Requests (v2.39.0). Taking something
 * OFF the register did not: anybody with the Assets right and `destroy` could
 * write a laptop off in one prompt, and "disposed" was one more option in a
 * drop-down. This module is the rule for both, and the rule is the leave rule:
 *
 *   **A REQUEST CHANGES NOTHING. AN APPROVAL DOES.** An asked-for write-off
 *   leaves the asset exactly where it was - still on the register, still in
 *   somebody's name - until a Manager or an Admin approves it. Approving is
 *   the one call that writes it off.
 *
 *   **NOBODY APPROVES THEIR OWN.** The person who asked cannot decide it.
 *
 *   **AN APPROVER ACTING ON THEIR OWN IS STILL RECORDED AS AN APPROVAL** -
 *   one row, raised and decided by the same person, marked `direct`. So the
 *   list of write-offs is complete whoever did them, and "who said this was
 *   fine" always has an answer. Blocking a Manager from writing off a phone
 *   until somebody else agrees would just send it round the system.
 *
 * Two different acts, kept apart because they are different facts:
 *
 *   - **Write off**: it is off the books - broken beyond repair, lost,
 *     stolen. It may still be sitting in a drawer.
 *   - **Dispose**: it has physically gone - sold, scrapped, donated, sent back.
 *     A sale brings money IN, so the amount and to whom are recorded. A
 *     written-off asset can still be disposed of later (sold for scrap), and a
 *     disposal writes it off too if it was not already.
 *
 * Dependency-free: used by the server and the screens alike.
 */

export const DISPOSAL_ACTIONS = [
  ['write_off', 'Write off', 'Off the books — broken beyond repair, lost or stolen. It keeps its code and history.'],
  ['dispose', 'Dispose', 'It has physically gone — sold, scrapped, donated or sent back.'],
];
export const disposalActionLabel = (key) => DISPOSAL_ACTIONS.find(([k]) => k === key)?.[1] || key;

export const DISPOSAL_METHODS = [
  ['sold', 'Sold'],
  ['scrapped', 'Scrapped'],
  ['donated', 'Donated'],
  ['returned', 'Returned to vendor'],
  ['exchanged', 'Exchanged / buy-back'],
];
export const disposalMethodLabel = (key) => DISPOSAL_METHODS.find(([k]) => k === key)?.[1] || key || '';
/** Money comes back on these, so the amount is asked for. */
export const METHODS_WITH_MONEY = new Set(['sold', 'exchanged']);

export const DISPOSAL_STATUSES = [
  ['pending', 'Waiting for approval'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['cancelled', 'Cancelled'],
];
export const disposalStatusLabel = (key) => DISPOSAL_STATUSES.find(([k]) => k === key)?.[1] || key;

/** Request numbers: WD-0001. The highest used, never a count. */
export const disposalNumber = (n) => `WD-${String(n).padStart(4, '0')}`;

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

/**
 * Can this asset be asked for? A sentence when not - "no" without a reason
 * sends people hunting.
 */
export function disposalAllowed(asset, action) {
  if (!asset) return 'that asset is not on the register';
  if (!DISPOSAL_ACTIONS.some(([k]) => k === action)) return 'choose Write off or Dispose';
  if (asset.state === 'disposed') return `${asset.code || 'It'} has already been disposed of`;
  if (action === 'write_off' && asset.written_off_on) return `${asset.code || 'It'} is already written off`;
  return '';
}

/** What is wrong with a request as typed. Empty array when nothing. */
export function validateDisposal(input = {}, { today } = {}) {
  const problems = [];
  const action = input.action;
  if (!DISPOSAL_ACTIONS.some(([k]) => k === action)) problems.push('choose Write off or Dispose');
  if (!String(input.reason || '').trim()) problems.push('say why');
  if (action === 'dispose') {
    if (!DISPOSAL_METHODS.some(([k]) => k === input.method)) problems.push('say how it went — sold, scrapped, donated, returned or exchanged');
    if (METHODS_WITH_MONEY.has(input.method)) {
      const amount = input.amount;
      if (amount === '' || amount === null || amount === undefined || !Number.isFinite(Number(amount))) {
        problems.push('how much came back for it? Type 0 if nothing');
      } else if (Number(amount) < 0) {
        problems.push('the amount received cannot be negative');
      }
    }
  }
  if (input.on_date) {
    if (!isDate(input.on_date)) problems.push('the date is not a date');
    else if (today && input.on_date > today) problems.push('the date cannot be in the future');
  }
  return problems;
}

/**
 * Whether a decision may be taken, as a sentence when not.
 *
 * @param decision 'approve' | 'reject' | 'cancel'
 */
export function decisionProblem(request, decision, { canApprove = false, isRaiser = false, note = '' } = {}) {
  if (!request) return 'request not found';
  if (request.status !== 'pending') return `${request.number} is already ${disposalStatusLabel(request.status).toLowerCase()}`;
  if (decision === 'approve' || decision === 'reject') {
    if (!canApprove) return 'only a Manager or an Admin decides a write-off or a disposal';
    if (isRaiser) return 'nobody approves their own request — somebody else has to';
    if (decision === 'reject' && !String(note).trim()) return 'say why it is rejected';
    return '';
  }
  if (decision === 'cancel') {
    if (!isRaiser && !canApprove) return 'only the person who asked, or a Manager or Admin, can cancel it';
    if (!String(note).trim()) return 'say why it is cancelled';
    return '';
  }
  return 'approve, reject or cancel';
}

/** What approving will do, in words, for the confirmation. */
export function approvalEffect(request = {}, asset = {}) {
  const what = `${asset.code || request.asset_code || ''} ${asset.label || request.asset_label || ''}`.trim();
  const held = asset.employee_id && !asset.returned_on ? ` It is taken back from ${asset.employee_name || 'its holder'} first.` : '';
  if (request.action === 'write_off') {
    return `${what} is written off: it leaves the register, keeps its code and its history.${held}`;
  }
  const money = METHODS_WITH_MONEY.has(request.method) ? ` for ${Number(request.amount || 0).toLocaleString('en-IN')}` : '';
  const to = request.party ? ` to ${request.party}` : '';
  const alsoOff = asset.written_off_on ? '' : ' It is written off too, so it leaves the books.';
  return `${what} is marked ${disposalMethodLabel(request.method).toLowerCase()}${to}${money}.${alsoOff}${held}`;
}

/** Figures for the top of the screen. Money received counts approved sales only. */
export function disposalFigures(rows = [], { year } = {}) {
  const inYear = (r) => !year || String(r.decided_at || r.created_at || '').slice(0, 4) === String(year);
  const approved = rows.filter((r) => r.status === 'approved' && inYear(r));
  return {
    waiting: rows.filter((r) => r.status === 'pending').length,
    written_off: approved.filter((r) => r.action === 'write_off').length,
    disposed: approved.filter((r) => r.action === 'dispose').length,
    received: approved
      .filter((r) => r.action === 'dispose' && METHODS_WITH_MONEY.has(r.method))
      .reduce((s, r) => s + (Number(r.amount) || 0), 0),
    book_value_off: approved.reduce((s, r) => s + (Number(r.purchase_cost) || 0), 0),
  };
}
