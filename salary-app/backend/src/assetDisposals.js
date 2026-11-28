/**
 * Write-offs and disposals that wait for an approval (v2.48.0) - the store
 * behind shared/assetDisposal.js. The table is created in people.js beside
 * the other asset tables, because the register's own reads carry the open
 * request on every row.
 *
 * The rule, once more, because everything here hangs off it: a request
 * changes nothing; approving is the only call that writes an asset off or
 * marks it disposed, and it does so in one transaction with the decision.
 */
import { audit, db } from './db.js';
import { log } from './logger.js';
import { getAsset, returnAsset, writeOffAsset } from './people.js';
import {
  METHODS_WITH_MONEY,
  approvalEffect,
  decisionProblem,
  disposalActionLabel,
  disposalAllowed,
  disposalMethodLabel,
  disposalNumber,
  validateDisposal,
} from '../../shared/assetDisposal.js';
import { todayIso } from '../../shared/today.js';

const SELECT = `
  SELECT d.*, a.code AS asset_code, a.label AS asset_label, a.kind AS asset_kind,
         a.purchase_cost, a.employee_id AS holder_id, e.name AS holder_name, c.name AS company_name
    FROM asset_disposals d
    JOIN assets a ON a.id = d.asset_id
    LEFT JOIN employees e ON e.id = a.employee_id AND a.returned_on IS NULL
    LEFT JOIN companies c ON c.id = a.company_id`;

const shape = (row) => (row ? { ...row, direct: Boolean(row.direct) } : null);

export const getDisposal = (id) => shape(db.prepare(`${SELECT} WHERE d.id = ?`).get(Number(id)));

export function listDisposals({ status, asset_id } = {}) {
  const where = [];
  const params = [];
  if (status) {
    where.push('d.status = ?');
    params.push(status);
  }
  if (asset_id) {
    where.push('d.asset_id = ?');
    params.push(Number(asset_id));
  }
  return db
    .prepare(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY (d.status = 'pending') DESC, d.id DESC`)
    .all(...params)
    .map(shape);
}

export const disposalsWaiting = () =>
  db.prepare(`SELECT COUNT(*) AS n FROM asset_disposals WHERE status = 'pending'`).get().n;

const label = (asset) => `${asset.code || ''} ${asset.label || ''}`.trim();

/**
 * Carry out an approved request. Inside the caller's transaction.
 *
 * A write-off is the existing writeOffAsset - one implementation of what
 * writing off means. A disposal brings it back from its holder, marks it
 * disposed with how and to whom, and writes it off as well if it was not
 * already, so it is off the books either way.
 */
function carryOut(request, { by }) {
  const asset = getAsset(request.asset_id);
  const on = request.on_date || todayIso();
  if (request.action === 'write_off') {
    writeOffAsset(asset.id, { on, why: request.reason, by });
    return;
  }
  if (asset.employee_id && !asset.returned_on) {
    returnAsset(asset.id, { returned_on: on, condition: `disposed (${disposalMethodLabel(request.method).toLowerCase()})`, by });
  }
  const money = METHODS_WITH_MONEY.has(request.method) ? ` for ${Number(request.amount || 0)}` : '';
  const note = `${disposalMethodLabel(request.method)}${request.party ? ` to ${request.party}` : ''}${money} — ${request.reason}`;
  db.prepare(
    `UPDATE assets
        SET state = 'disposed', state_note = ?, state_since = ?,
            written_off_on = COALESCE(written_off_on, ?),
            written_off_why = COALESCE(written_off_why, ?)
      WHERE id = ?`
  ).run(note, on, on, `Disposed: ${note}`, asset.id);
  audit({
    who: by,
    action: 'disposed',
    entity: 'assets',
    entity_id: asset.id,
    label: label(asset),
    from_value: asset.state || 'in use',
    to_value: 'disposed',
    note: `${request.number}: ${note}`,
  });
}

/**
 * Ask for it - or, for somebody who may approve, do it and record it as
 * approved by them (`direct`). Returns the request row.
 */
export function raiseDisposal(assetId, input = {}, { by, userId, canApprove = false } = {}) {
  const asset = getAsset(Number(assetId));
  const refusal = disposalAllowed(asset, input.action);
  if (refusal) throw new Error(refusal);
  if (asset.disposal_pending) {
    throw new Error(`${asset.code || 'It'} already has ${asset.disposal_number} waiting — decide or cancel that one first`);
  }
  const problems = validateDisposal(input, { today: todayIso() });
  if (problems.length) throw new Error(problems.join('; '));

  const direct = canApprove === true;
  const id = db.transaction(() => {
    const top = db.prepare(`SELECT number FROM asset_disposals ORDER BY id DESC LIMIT 1`).get();
    const last = Number(String(top?.number || '').replace(/\D/g, '')) || 0;
    const info = db
      .prepare(
        `INSERT INTO asset_disposals
           (number, asset_id, action, reason, method, party, amount, on_date, status,
            raised_by, raised_by_user, decided_by, decided_by_user, decided_at, decision_note, direct)
         VALUES (@number, @asset_id, @action, @reason, @method, @party, @amount, @on_date, @status,
                 @raised_by, @raised_by_user, @decided_by, @decided_by_user, @decided_at, @decision_note, @direct)`
      )
      .run({
        number: disposalNumber(last + 1),
        asset_id: asset.id,
        action: input.action,
        reason: String(input.reason).trim(),
        method: input.action === 'dispose' ? input.method : null,
        party: input.action === 'dispose' ? String(input.party || '').trim() || null : null,
        amount:
          input.action === 'dispose' && METHODS_WITH_MONEY.has(input.method) ? Number(input.amount) : null,
        on_date: input.on_date || null,
        status: direct ? 'approved' : 'pending',
        raised_by: by || null,
        raised_by_user: Number(userId) || null,
        decided_by: direct ? by || null : null,
        decided_by_user: direct ? Number(userId) || null : null,
        decided_at: direct ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null,
        decision_note: direct ? 'done directly by somebody who may approve' : null,
        direct: direct ? 1 : 0,
      });
    const made = getDisposal(info.lastInsertRowid);
    if (direct) carryOut(made, { by });
    return made.id;
  })();
  const made = getDisposal(id);
  audit({
    who: by,
    action: direct ? `${disposalActionLabel(made.action).toLowerCase()} (direct)` : 'asked to ' + disposalActionLabel(made.action).toLowerCase(),
    entity: 'asset_disposals',
    entity_id: id,
    label: `${made.number} ${label(asset)}`,
    note: made.reason,
  });
  log.info(`${made.number} ${made.action} for ${label(asset)}: ${made.status} (${by || 'office'})`);
  return made;
}

/** Approve, reject or cancel. Approving carries it out in the same transaction. */
export function decideDisposal(id, decision, { by, userId, canApprove = false, note = '' } = {}) {
  const request = getDisposal(id);
  const isRaiser = Boolean(userId) && Number(userId) === Number(request?.raised_by_user);
  const problem = decisionProblem(request, decision, { canApprove, isRaiser, note });
  if (problem) throw new Error(problem);
  const to = { approve: 'approved', reject: 'rejected', cancel: 'cancelled' }[decision];

  db.transaction(() => {
    if (decision === 'approve') {
      // The asset may have moved since it was asked for.
      const refusal = disposalAllowed(getAsset(request.asset_id), request.action);
      if (refusal) throw new Error(`${refusal} — cancel this request instead`);
    }
    db.prepare(
      `UPDATE asset_disposals
          SET status = ?, decided_by = ?, decided_by_user = ?, decided_at = datetime('now'), decision_note = ?
        WHERE id = ? AND status = 'pending'`
    ).run(to, by || null, Number(userId) || null, String(note || '').trim() || null, request.id);
    if (decision === 'approve') carryOut({ ...request, status: 'approved' }, { by });
  })();
  audit({
    who: by,
    action: `${to} ${disposalActionLabel(request.action).toLowerCase()}`,
    entity: 'asset_disposals',
    entity_id: request.id,
    label: `${request.number} ${request.asset_code || ''} ${request.asset_label || ''}`.trim(),
    note: `asked by ${request.raised_by || 'office'}${note ? ` — ${note}` : ''}`,
  });
  return getDisposal(request.id);
}

export { approvalEffect };
