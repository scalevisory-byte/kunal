import { db, audit, createEmployee, getEmployee, listEmployees } from './db.js';
import { duplicatesOf } from '../../shared/employeeMaster.js';
import { isOpen, masterFieldsFrom, progress, whatIsMissing } from '../../shared/onboardingFlow.js';
import { makeToken, readToken } from './tokens.js';

/**
 * INVITING SOMEBODY TO FILL IN THEIR OWN RECORD.
 *
 * Dinesh's brief: HR invites, the person completes their details, HR checks
 * and approves, and only then is there an employee.
 *
 * AN INVITATION IS NOT AN EMPLOYEE. Nothing reaches the payroll, the
 * attendance grid or any register until `approve` is called - which is the
 * only function here that writes to `employees`, and it goes through the
 * same `createEmployee` and the same duplicate check the office's own
 * joining form uses.
 *
 * The draft is kept as JSON rather than as columns, on purpose: it is not a
 * record yet, its shape is `shared/employeeMaster.js`'s and it changes with
 * that file. A parallel set of columns would be a second definition of what
 * an employee is, and the two would drift.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS employee_invitations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    -- What the office decided when it hired them. The person filling the
    -- form can read these and cannot change them.
    company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id       INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    phone           TEXT,
    email           TEXT,
    department      TEXT,
    designation     TEXT,
    employment_type TEXT,
    joined_on       TEXT,
    reports_to_id   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    -- invited | opened | submitted | returned | approved | cancelled
    status          TEXT NOT NULL DEFAULT 'invited',
    -- Their answers, as JSON. See the note above.
    draft           TEXT NOT NULL DEFAULT '{}',
    expires_on      TEXT,
    opened_at       TEXT,
    submitted_at    TEXT,
    declared        INTEGER NOT NULL DEFAULT 0,
    remarks         TEXT,
    employee_id     INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    created_by      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS invitation_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    invitation_id INTEGER NOT NULL REFERENCES employee_invitations(id) ON DELETE CASCADE,
    status        TEXT NOT NULL,
    note          TEXT,
    by_whom       TEXT,
    at            TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const row = (id) => db.prepare(`SELECT * FROM employee_invitations WHERE id = ?`).get(Number(id)) || null;

const dress = (r) => {
  if (!r) return null;
  const draft = JSON.parse(r.draft || '{}');
  const company = db.prepare(`SELECT name FROM companies WHERE id = ?`).get(r.company_id);
  const manager = r.reports_to_id ? getEmployee(r.reports_to_id) : null;
  return {
    ...r,
    draft,
    declared: !!r.declared,
    company_name: company?.name || '',
    reports_to_name: manager?.name || '',
    progress: progress(draft),
    history: db
      .prepare(`SELECT * FROM invitation_history WHERE invitation_id = ? ORDER BY id`)
      .all(r.id),
  };
};

const note = (invitationId, status, by, text) =>
  db
    .prepare(`INSERT INTO invitation_history (invitation_id, status, note, by_whom) VALUES (?, ?, ?, ?)`)
    .run(Number(invitationId), status, text || null, by || null);

export const getInvitation = (id) => dress(row(id));

export function listInvitations({ status, company_id } = {}) {
  const where = [];
  const params = [];
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (company_id) {
    where.push('company_id = ?');
    params.push(Number(company_id));
  }
  return db
    .prepare(
      `SELECT * FROM employee_invitations ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC, id DESC`
    )
    .all(...params)
    .map(dress);
}

/** 30 days by default: long enough to be useful, short enough to expire. */
const DEFAULT_DAYS = 30;
const inDays = (days) =>
  new Date(Date.now() + Math.max(1, days) * 86400000).toISOString().slice(0, 10);

/**
 * Make one.
 *
 * It REFUSES a mobile number that is already on the staff list or on another
 * open invitation - the brief asks for exactly that, and it is the cheapest
 * place to stop one person becoming two records. A name on its own is not a
 * duplicate and never refuses.
 */
export function createInvitation(input = {}, by) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('who are you inviting?');
  if (!Number(input.company_id)) throw new Error('which company?');

  const phone = String(input.phone || '').replace(/\D/g, '').slice(-10);
  if (phone.length === 10) {
    const already = duplicatesOf({ phone }, listEmployees({})).find((d) =>
      d.why.includes('the same mobile number')
    );
    if (already) {
      throw new Error(`${already.name} is already on the staff list with that mobile number`);
    }
    const open = listInvitations({})
      .filter((i) => isOpen(i.status))
      .find((i) => String(i.phone || '').replace(/\D/g, '').slice(-10) === phone);
    if (open) throw new Error(`${open.name} already has an invitation open with that number`);
  }

  const info = db
    .prepare(
      `INSERT INTO employee_invitations
         (company_id, branch_id, name, phone, email, department, designation,
          employment_type, joined_on, reports_to_id, expires_on, created_by)
       VALUES (@company_id, @branch_id, @name, @phone, @email, @department, @designation,
               @employment_type, @joined_on, @reports_to_id, @expires_on, @created_by)`
    )
    .run({
      company_id: Number(input.company_id),
      branch_id: Number(input.branch_id) || null,
      name,
      phone: input.phone || null,
      email: input.email || null,
      department: input.department || null,
      designation: input.designation || null,
      employment_type: input.employment_type || null,
      joined_on: input.joined_on || null,
      reports_to_id: Number(input.reports_to_id) || null,
      expires_on: input.expires_on || inDays(Number(input.days) || DEFAULT_DAYS),
      created_by: by || null,
    });
  note(info.lastInsertRowid, 'invited', by, 'invitation created');
  audit({
    who: by,
    action: 'created',
    entity: 'employee_invitations',
    entity_id: info.lastInsertRowid,
    label: name,
  });
  return dress(row(info.lastInsertRowid));
}

/**
 * THE LINK.
 *
 * A purpose-scoped signed token, the same machinery the apply link and the
 * punch link use - and the same honest limit, said in the UI: a link can be
 * forwarded. It is handed over by whoever made it, on WhatsApp or on paper;
 * nothing here sends anything, and no status claims it did.
 */
export const invitationToken = (invitation) =>
  makeToken('onboard', { i: invitation.id }, {
    minutes: Math.max(
      60,
      Math.round(
        (new Date(`${invitation.expires_on}T23:59:59Z`).getTime() - Date.now()) / 60000
      )
    ),
  });

/** Whoever holds the token, or null. Expiry is checked twice: in the token
    and against the invitation, because the office can shorten one. */
export function invitationFromToken(token) {
  const payload = readToken('onboard', token);
  if (!payload?.i) return null;
  const invitation = row(payload.i);
  if (!invitation) return null;
  if (invitation.expires_on && invitation.expires_on < new Date().toISOString().slice(0, 10)) {
    return null;
  }
  if (!isOpen(invitation.status)) return null;
  return dress(invitation);
}

export function updateInvitation(id, patch = {}, by) {
  const before = row(id);
  if (!before) throw new Error('not found');
  const fields = [];
  const values = [];
  for (const key of ['expires_on', 'joined_on', 'designation', 'department', 'employment_type',
    'branch_id', 'reports_to_id', 'phone', 'email', 'name']) {
    if (!(key in patch)) continue;
    fields.push(`${key} = ?`);
    values.push(patch[key] === '' ? null : patch[key]);
  }
  if (fields.length) {
    db.prepare(`UPDATE employee_invitations SET ${fields.join(', ')} WHERE id = ?`).run(...values, Number(id));
    note(id, before.status, by, 'details changed by the office');
  }
  return dress(row(id));
}

/** Withdrawn. The link stops working at once. */
export function cancelInvitation(id, by, why) {
  const before = row(id);
  if (!before) throw new Error('not found');
  if (before.status === 'approved') throw new Error('that one has already been approved');
  db.prepare(`UPDATE employee_invitations SET status = 'cancelled', remarks = ? WHERE id = ?`)
    .run(why || null, Number(id));
  note(id, 'cancelled', by, why || 'withdrawn');
  audit({ who: by, action: 'cancelled', entity: 'employee_invitations', entity_id: Number(id), label: before.name, note: why || null });
  return dress(row(id));
}

/* ---------------- the person's own side ---------------- */

/** They opened it. Recorded once, so "has anybody started?" has an answer. */
export function markOpened(id) {
  const before = row(id);
  if (!before || before.opened_at || before.status !== 'invited') return dress(before);
  db.prepare(`UPDATE employee_invitations SET status = 'opened', opened_at = datetime('now') WHERE id = ?`)
    .run(Number(id));
  note(id, 'opened', null, 'opened the link');
  return dress(row(id));
}

/**
 * Saving what they have typed so far.
 *
 * A DRAFT IS SAVED WHOLE AND MERGED, not replaced: two tabs open would
 * otherwise have the last save wipe the other's answers. And it is refused
 * once submitted, because what the office is checking must not change under
 * it - a correction goes back through `returnForCorrection`.
 */
export function saveDraft(id, patch = {}) {
  const before = row(id);
  if (!before) throw new Error('not found');
  if (!isOpen(before.status)) throw new Error('this form has been closed');
  if (before.status === 'submitted') {
    throw new Error('it has been sent in — the office has to send it back before it can change');
  }
  const draft = { ...JSON.parse(before.draft || '{}'), ...patch };
  db.prepare(`UPDATE employee_invitations SET draft = ? WHERE id = ?`)
    .run(JSON.stringify(draft), Number(id));
  return dress(row(id));
}

/**
 * Sent in, with the declaration.
 *
 * THE DECLARATION IS REQUIRED and is not a default: it is the one thing on
 * the form that is a statement by a person rather than a fact about them.
 */
export function submit(id, { declared } = {}) {
  const before = row(id);
  if (!before) throw new Error('not found');
  if (!isOpen(before.status)) throw new Error('this form has been closed');
  if (!declared) throw new Error('please confirm the declaration before sending it in');
  const draft = JSON.parse(before.draft || '{}');
  const missing = whatIsMissing(draft);
  if (missing.length) throw new Error(`still wanted: ${missing.join(', ')}`);

  db.prepare(
    `UPDATE employee_invitations
     SET status = 'submitted', submitted_at = datetime('now'), declared = 1 WHERE id = ?`
  ).run(Number(id));
  note(id, 'submitted', before.name, 'declared correct and sent in');
  return dress(row(id));
}

/* ---------------- the office's side ---------------- */

/** Sent back, with remarks saying what to correct. Remarks are required. */
export function returnForCorrection(id, { remarks } = {}, by) {
  const before = row(id);
  if (!before) throw new Error('not found');
  if (before.status !== 'submitted') throw new Error('only a submitted form can be sent back');
  if (!String(remarks || '').trim()) throw new Error('say what needs correcting');
  db.prepare(`UPDATE employee_invitations SET status = 'returned', remarks = ? WHERE id = ?`)
    .run(String(remarks).trim(), Number(id));
  note(id, 'returned', by, String(remarks).trim());
  return dress(row(id));
}

/**
 * APPROVED - the one call in this module that creates an employee.
 *
 * Three things it refuses, each of which would be expensive:
 *   - approving anything but a submitted form, because the declaration is
 *     what makes the draft somebody's own statement;
 *   - approving twice, which would make one person two records;
 *   - approving over an employee code already in use.
 *
 * `masterFieldsFrom` is a WHITELIST: this is data typed by somebody outside
 * the office, and it must not be able to set a salary, a status or anything
 * else the office did not decide, however the request is written.
 */
export function approve(id, { code, extra = {} } = {}, by) {
  const invitation = row(id);
  if (!invitation) throw new Error('not found');
  /* ALREADY DONE is checked FIRST, so a second press says the real reason.
     Checked the other way round it answered "only a submitted form can be
     approved", which is true of an approved one and tells nobody anything. */
  if (invitation.employee_id) throw new Error('that one is already on the staff list');
  if (invitation.status !== 'submitted') throw new Error('only a submitted form can be approved');

  const draft = JSON.parse(invitation.draft || '{}');
  const fields = masterFieldsFrom(draft, invitation);
  if (code) fields.code = code;
  /* The office's own additions at the moment of approval - a salary, a
     quota, how they are paid. Never from the draft. */
  for (const key of ['monthly_salary', 'payment_mode', 'cl_quota', 'sl_quota', 'pl_quota', 'pf', 'esi']) {
    if (key in extra) fields[key] = extra[key];
  }

  const clash = duplicatesOf(fields, listEmployees({})).find((d) => d.blocking);
  if (clash) throw new Error(`${clash.code} is already ${clash.name}'s code`);

  const employee = createEmployee(fields);
  db.prepare(`UPDATE employee_invitations SET status = 'approved', employee_id = ? WHERE id = ?`)
    .run(employee.id, Number(id));
  note(id, 'approved', by, `added to the staff list as ${employee.name}`);
  audit({
    who: by,
    action: 'approved',
    entity: 'employee_invitations',
    entity_id: Number(id),
    label: invitation.name,
    note: `employee #${employee.id}`,
  });
  return { invitation: dress(row(id)), employee };
}
