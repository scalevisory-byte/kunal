/**
 * Purchase requests for assets - the store behind shared/purchaseRequest.js.
 *
 * Two tables: the request (its headline: what, how many, for whom, where it
 * has got to) and its history (append-only: every step, who took it, when,
 * and what they said). The same split as an asset and its handovers - the
 * request row answers "where is it now", the history answers "how did it get
 * here", and nothing reads the history to work out the first.
 */
import { audit, db } from './db.js';
import { log } from './logger.js';
import {
  OPEN_STATUSES,
  PR_STEPS,
  requestNumber,
  stepProblem,
  validatePurchaseRequest,
} from '../../shared/purchaseRequest.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS asset_requests (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    number          TEXT NOT NULL UNIQUE,
    status          TEXT NOT NULL DEFAULT 'draft',
    company_id      INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    department      TEXT,
    employee_id     INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    kind            TEXT NOT NULL,
    description     TEXT,
    quantity        INTEGER NOT NULL DEFAULT 1,
    estimated_cost  REAL,
    purpose         TEXT NOT NULL,
    priority        TEXT NOT NULL DEFAULT 'normal',
    vendor          TEXT,
    requested_by    TEXT,
    requested_by_user INTEGER,
    decided_by      TEXT,
    decided_at      TEXT,
    asset_codes     TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_asset_requests_status ON asset_requests(status);

  CREATE TABLE IF NOT EXISTS asset_request_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id  INTEGER NOT NULL REFERENCES asset_requests(id) ON DELETE CASCADE,
    action      TEXT NOT NULL,
    from_status TEXT,
    to_status   TEXT,
    who         TEXT,
    note        TEXT,
    at          TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_asset_request_events ON asset_request_events(request_id, id);
`);

const SELECT = `
  SELECT r.*, c.name AS company_name, e.name AS employee_name
    FROM asset_requests r
    LEFT JOIN companies c ON c.id = r.company_id
    LEFT JOIN employees e ON e.id = r.employee_id`;

const event = (requestId, action, from, to, who, note) =>
  db
    .prepare(
      `INSERT INTO asset_request_events (request_id, action, from_status, to_status, who, note)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(requestId, action, from || null, to || null, who || null, note || null);

export function getAssetRequest(id) {
  const row = db.prepare(`${SELECT} WHERE r.id = ?`).get(Number(id));
  if (!row) return null;
  row.events = db
    .prepare(`SELECT * FROM asset_request_events WHERE request_id = ? ORDER BY id`)
    .all(row.id);
  return row;
}

export function listAssetRequests({ status } = {}) {
  const rows = status
    ? db.prepare(`${SELECT} WHERE r.status = ? ORDER BY r.id DESC`).all(status)
    : db.prepare(`${SELECT} ORDER BY r.id DESC`).all();
  return rows;
}

/** How many are waiting for a decision - for the digest and the overview. */
export const assetRequestsWaiting = () =>
  db.prepare(`SELECT COUNT(*) AS n FROM asset_requests WHERE status = 'submitted'`).get().n;

export function createAssetRequest(input = {}, { by, userId } = {}) {
  const { ok, problems } = validatePurchaseRequest(input);
  if (!ok) throw new Error(problems.join('; '));
  const make = db.transaction(() => {
    // The highest number used, never a count: a cancelled PR-0004 keeps 4.
    const top = db.prepare(`SELECT number FROM asset_requests ORDER BY id DESC LIMIT 1`).get();
    const last = Number(String(top?.number || '').replace(/\D/g, '')) || 0;
    const number = requestNumber(last + 1);
    const submit = input.submit === true;
    const info = db
      .prepare(
        `INSERT INTO asset_requests
           (number, status, company_id, department, employee_id, kind, description, quantity,
            estimated_cost, purpose, priority, vendor, requested_by, requested_by_user)
         VALUES (@number, @status, @company_id, @department, @employee_id, @kind, @description, @quantity,
                 @estimated_cost, @purpose, @priority, @vendor, @requested_by, @requested_by_user)`
      )
      .run({
        number,
        status: submit ? 'submitted' : 'draft',
        company_id: Number(input.company_id) || null,
        department: String(input.department || '').trim() || null,
        employee_id: Number(input.employee_id) || null,
        kind: String(input.kind).trim(),
        description: String(input.description || '').trim() || null,
        quantity: Number(input.quantity),
        estimated_cost:
          input.estimated_cost === '' || input.estimated_cost === undefined || input.estimated_cost === null
            ? null
            : Number(input.estimated_cost),
        purpose: String(input.purpose).trim(),
        priority: input.priority || 'normal',
        vendor: String(input.vendor || '').trim() || null,
        requested_by: by || null,
        requested_by_user: Number(userId) || null,
      });
    const id = info.lastInsertRowid;
    event(id, 'created', null, 'draft', by, null);
    if (submit) event(id, 'submit', 'draft', 'submitted', by, null);
    return id;
  });
  const id = make();
  const made = getAssetRequest(id);
  audit({ who: by, action: 'created', entity: 'asset_requests', entity_id: id, label: made.number });
  return made;
}

/** A draft may still be edited; anything submitted is the record it was. */
const EDITABLE = ['company_id', 'department', 'employee_id', 'kind', 'description', 'quantity', 'estimated_cost', 'purpose', 'priority', 'vendor'];

export function updateAssetRequest(id, patch = {}, { by } = {}) {
  const before = getAssetRequest(id);
  if (!before) throw new Error('request not found');
  // Vendor stays editable while it is being bought - it is often only known then.
  const open = before.status === 'draft' ? EDITABLE : ['approved', 'ordered'].includes(before.status) ? ['vendor'] : [];
  const fields = Object.keys(patch).filter((k) => open.includes(k));
  if (!fields.length) {
    if (Object.keys(patch).some((k) => EDITABLE.includes(k))) {
      throw new Error('a request is changed only while it is a draft — cancel it and raise a new one');
    }
    return before;
  }
  const merged = { ...before, ...patch };
  const { ok, problems } = validatePurchaseRequest(merged);
  if (!ok) throw new Error(problems.join('; '));
  const values = fields.map((k) =>
    ['company_id', 'employee_id'].includes(k)
      ? Number(patch[k]) || null
      : k === 'quantity'
        ? Number(patch[k])
        : k === 'estimated_cost'
          ? patch[k] === '' || patch[k] === null ? null : Number(patch[k])
          : String(patch[k] ?? '').trim() || null
  );
  db.prepare(
    `UPDATE asset_requests SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`
  ).run(...values, Number(id));
  event(Number(id), 'edited', before.status, before.status, by, fields.join(', '));
  return getAssetRequest(id);
}

/**
 * One step along the line. `asset_codes` may ride on `complete`, naming what
 * was registered - typed by the person who registered them, not inferred.
 */
export function moveAssetRequest(id, stepKey, { by, userId, canApprove = false, note = '', vendor, asset_codes } = {}) {
  const request = getAssetRequest(id);
  const isRequester = Boolean(userId) && Number(userId) === Number(request?.requested_by_user);
  const problem = stepProblem(request, stepKey, { canApprove, isRequester, note });
  if (problem) throw new Error(problem);
  const step = PR_STEPS[stepKey];
  db.transaction(() => {
    const sets = [`status = ?`, `updated_at = datetime('now')`];
    const values = [step.to];
    if (step.approve) {
      sets.push('decided_by = ?', `decided_at = datetime('now')`);
      values.push(by || null);
    }
    if (vendor !== undefined && String(vendor).trim()) {
      sets.push('vendor = ?');
      values.push(String(vendor).trim());
    }
    if (stepKey === 'complete' && asset_codes !== undefined) {
      sets.push('asset_codes = ?');
      values.push(String(asset_codes || '').trim() || null);
    }
    db.prepare(`UPDATE asset_requests SET ${sets.join(', ')} WHERE id = ?`).run(...values, Number(id));
    event(Number(id), stepKey, request.status, step.to, by, note);
  })();
  audit({
    who: by,
    action: stepKey,
    entity: 'asset_requests',
    entity_id: Number(id),
    label: request.number,
    field: 'status',
    from_value: request.status,
    to_value: step.to,
    note: note || null,
  });
  log.info(`Purchase request ${request.number}: ${request.status} -> ${step.to} by ${by || 'office'}`);
  return getAssetRequest(id);
}

/** Only a draft that went nowhere may be deleted; anything else is history. */
export function deleteAssetRequest(id) {
  const request = getAssetRequest(id);
  if (!request) throw new Error('request not found');
  if (request.status !== 'draft') throw new Error('only a draft can be deleted — cancel it instead, which keeps the record');
  db.prepare(`DELETE FROM asset_requests WHERE id = ?`).run(Number(id));
  return true;
}

export const isOpenRequest = (r) => OPEN_STATUSES.has(r?.status);
