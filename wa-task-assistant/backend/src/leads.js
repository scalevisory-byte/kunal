import { db } from './db.js';
import { numberOrNull } from './dates.js';
import { log } from './logger.js';

/**
 * People who might buy something, and where each of them has got to.
 *
 * A lead is not a task and not a note. A task is owed by him; a note is
 * remembered; a lead is somebody else's decision that he is waiting on, and
 * the only thing he owes it is the next contact. So it carries a stage and a
 * date to chase - and the chasing, as everywhere in this app, is the app
 * chasing *him*. Nothing here messages a customer: the follow-up is a button
 * that opens the chat with the words ready, and he presses send.
 *
 * It lives in its own section for the same reason set-aside groups exist: a
 * hundred open leads in the task list would bury the day's work, and the day's
 * work is what the app is for.
 */

export const STAGES = [
  { key: 'new', label: 'New', note: 'Come in, not yet spoken to.' },
  { key: 'contacted', label: 'Contacted', note: 'You have replied; waiting on them.' },
  { key: 'quoted', label: 'Quoted', note: 'A price or proposal has gone out.' },
  { key: 'negotiating', label: 'Negotiating', note: 'Talking terms.' },
  { key: 'won', label: 'Won', note: 'Closed. Nothing further is chased.' },
  { key: 'lost', label: 'Lost', note: 'Closed. Nothing further is chased.' },
];

const STAGE_KEYS = new Set(STAGES.map((s) => s.key));
export const CLOSED = new Set(['won', 'lost']);

export const SOURCES = [
  { key: 'facebook', label: 'Facebook ad' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'referral', label: 'Referral' },
  { key: 'walkin', label: 'Walk-in' },
  { key: 'indiamart', label: 'IndiaMART' },
  { key: 'manual', label: 'Added by hand' },
];
const SOURCE_KEYS = new Set(SOURCES.map((s) => s.key));

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    phone        TEXT,
    wid          TEXT,
    group_id     INTEGER REFERENCES task_groups(id) ON DELETE SET NULL,
    source       TEXT NOT NULL DEFAULT 'manual',
    source_ref   TEXT,
    stage        TEXT NOT NULL DEFAULT 'new',
    value        INTEGER,
    note         TEXT,
    /*
     * When to speak to them next, and whether that has been said.
     *
     * The same shape a note's reminder has, and for the same reason: one
     * moment, delivered once, claimed with a conditional UPDATE so a restart
     * or a second tick cannot send it twice. A lead has no ladder - being
     * chased three times about one phone call is how you stop reading the
     * notifications.
     */
    next_action_at TEXT,
    reminded_at    TEXT,
    /*
     * Captured from a chat and not yet looked at. Held rather than filed: a
     * courier asking for an address is not a lead, and a pipeline full of
     * those is worth less than an empty one.
     */
    needs_confirmation INTEGER NOT NULL DEFAULT 0,
    message_id   INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    chat_name    TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at    TEXT
  );

  CREATE TABLE IF NOT EXISTS lead_events (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    kind    TEXT NOT NULL,
    detail  TEXT,
    at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_leads_stage  ON leads(stage, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_leads_next   ON leads(next_action_at) WHERE next_action_at IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_lead_events  ON lead_events(lead_id, id DESC);

  -- One lead per person per chat. The index is the guarantee: a second message
  -- from the same number cannot open a second card for them.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_wid ON leads(wid) WHERE wid IS NOT NULL;
`);

export const EVENT = {
  created: 'created',
  stage: 'stage changed',
  edited: 'edited',
  nextAction: 'next contact set',
  reminded: 'reminder triggered',
  confirmed: 'confirmed as a lead',
  rejected: 'not a lead',
  contacted: 'contacted',
};

export const recordLeadEvent = (leadId, kind, detail = null) =>
  db.prepare(`INSERT INTO lead_events (lead_id, kind, detail) VALUES (?, ?, ?)`)
    .run(leadId, kind, detail ? String(detail).slice(0, 300) : null);

export const leadEvents = (leadId) =>
  db.prepare(`SELECT * FROM lead_events WHERE lead_id = ? ORDER BY id DESC`).all(leadId);

/* ---------------- reading ---------------- */

const SELECT = `
  SELECT l.*, g.name AS group_name, g.colour AS group_colour,
         m.body AS first_message
  FROM leads l
  LEFT JOIN task_groups g ON g.id = l.group_id
  LEFT JOIN messages m ON m.id = l.message_id
`;

const shape = (row) =>
  row ? { ...row, needs_confirmation: Boolean(row.needs_confirmation), closed: CLOSED.has(row.stage) } : null;

export const getLead = (id) => shape(db.prepare(`${SELECT} WHERE l.id = ?`).get(id));

export const leadByWid = (wid) =>
  wid ? shape(db.prepare(`${SELECT} WHERE l.wid = ?`).get(wid)) : null;

/**
 * The pipeline. Open leads first and closed ones last, and within a stage the
 * one you should speak to soonest at the top - an undated lead after them,
 * because a lead with no next contact is one nobody has decided about.
 */
export function listLeads({ includeClosed = true, includeUnconfirmed = false } = {}) {
  const where = [];
  if (!includeClosed) where.push(`l.stage NOT IN ('won', 'lost')`);
  if (!includeUnconfirmed) where.push(`l.needs_confirmation = 0`);
  const sql = `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  return db.prepare(sql).all().map(shape).sort(soonestFirst);
}

export const heldLeads = () =>
  db.prepare(`${SELECT} WHERE l.needs_confirmation = 1 ORDER BY l.created_at DESC`).all().map(shape);

/** Nearest next contact first; undated after, most recent first. */
export function soonestFirst(a, b) {
  const an = a.next_action_at || '';
  const bn = b.next_action_at || '';
  if (an && bn && an !== bn) return an < bn ? -1 : 1;
  if (an && !bn) return -1;
  if (!an && bn) return 1;
  return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
}

/** How many sit in each stage, for the board's own headings. */
export function stageCounts() {
  const counts = Object.fromEntries(STAGES.map((s) => [s.key, 0]));
  for (const row of db.prepare(`SELECT stage, COUNT(*) AS n FROM leads WHERE needs_confirmation = 0 GROUP BY stage`).all()) {
    if (counts[row.stage] !== undefined) counts[row.stage] = row.n;
  }
  return counts;
}

/* ---------------- writing ---------------- */

const clean = (v, max) => String(v ?? '').trim().slice(0, max);

export function createLead(input = {}) {
  const name = clean(input.name, 120);
  if (!name) throw new Error('a lead needs a name');

  // Somebody already on the board is not a new lead; their card is updated
  // instead, so a second enquiry cannot split one person in two.
  const existing = input.wid ? leadByWid(input.wid) : null;
  if (existing) return existing;

  const info = db
    .prepare(
      `INSERT INTO leads (name, phone, wid, group_id, source, source_ref, stage, value, note,
                          next_action_at, needs_confirmation, message_id, chat_name)
       VALUES (@name, @phone, @wid, @group_id, @source, @source_ref, @stage, @value, @note,
               @next_action_at, @needs_confirmation, @message_id, @chat_name)`
    )
    .run({
      name,
      phone: input.phone ? clean(input.phone, 30) : null,
      wid: input.wid || null,
      group_id: numberOrNull(input.group_id),
      source: SOURCE_KEYS.has(input.source) ? input.source : 'manual',
      source_ref: input.source_ref ? clean(input.source_ref, 200) : null,
      stage: STAGE_KEYS.has(input.stage) ? input.stage : 'new',
      value: numberOrNull(input.value),
      note: input.note ? clean(input.note, 2000) : null,
      next_action_at: input.next_action_at || null,
      needs_confirmation: input.needs_confirmation ? 1 : 0,
      message_id: numberOrNull(input.message_id),
      chat_name: input.chat_name ? clean(input.chat_name, 120) : null,
    });

  const lead = getLead(info.lastInsertRowid);
  recordLeadEvent(lead.id, EVENT.created, lead.source);
  if (lead.next_action_at) recordLeadEvent(lead.id, EVENT.nextAction, lead.next_action_at);
  return lead;
}

const FIELDS = ['name', 'phone', 'group_id', 'source', 'stage', 'value', 'note', 'next_action_at'];

export function updateLead(id, patch = {}) {
  const current = getLead(id);
  if (!current) return null;

  const sets = [];
  const args = [];
  const said = [];
  for (const key of FIELDS) {
    if (!(key in patch)) continue;
    let value = patch[key];
    if (key === 'name') { value = clean(value, 120); if (!value) continue; }
    if (key === 'phone') value = value ? clean(value, 30) : null;
    if (key === 'note') value = value ? clean(value, 2000) : null;
    if (key === 'group_id' || key === 'value') value = numberOrNull(value);
    if (key === 'stage' && !STAGE_KEYS.has(value)) continue;
    if (key === 'source' && !SOURCE_KEYS.has(value)) continue;
    if (key === 'next_action_at') value = value || null;
    sets.push(`${key} = ?`);
    args.push(value);
    said.push(key);
  }
  if (!sets.length) return current;

  /*
   * A next contact that has been moved has not been made yet. Without clearing
   * the mark, a lead whose reminder had already gone out would never be
   * reminded about again however many times the date was changed.
   */
  if (said.includes('next_action_at')) sets.push(`reminded_at = NULL`);

  // Closing stamps the day it closed; reopening takes that back off.
  if (said.includes('stage')) {
    sets.push(`closed_at = ${CLOSED.has(patch.stage) ? "datetime('now')" : 'NULL'}`);
  }

  db.prepare(`UPDATE leads SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...args, id);

  const next = getLead(id);
  if (said.includes('stage') && current.stage !== next.stage) {
    recordLeadEvent(id, EVENT.stage, `${current.stage} → ${next.stage}`);
  }
  if (said.includes('next_action_at') && current.next_action_at !== next.next_action_at) {
    recordLeadEvent(id, EVENT.nextAction, next.next_action_at || 'cleared');
  }
  const wrote = said.filter((k) => !['stage', 'next_action_at'].includes(k));
  if (wrote.length) recordLeadEvent(id, EVENT.edited, wrote.join(', '));
  return next;
}

/** Confirming a held capture puts it on the board; rejecting removes it. */
export function confirmLead(id) {
  const changed = db
    .prepare(`UPDATE leads SET needs_confirmation = 0, updated_at = datetime('now')
              WHERE id = ? AND needs_confirmation = 1`)
    .run(id).changes;
  if (changed) recordLeadEvent(id, EVENT.confirmed);
  return getLead(id);
}

export const deleteLead = (id) => db.prepare(`DELETE FROM leads WHERE id = ?`).run(id).changes > 0;

/**
 * Marks that you have just spoken to them.
 *
 * Its own verb rather than an edit, because it is the thing the whole board is
 * about: the date moves on, the stage moves up if it was still New, and the
 * record says when contact was actually made.
 */
export function markContacted(id, { nextAt = null, note = null } = {}) {
  const lead = getLead(id);
  if (!lead) return null;
  updateLead(id, {
    stage: lead.stage === 'new' ? 'contacted' : lead.stage,
    next_action_at: nextAt,
    ...(note ? { note: [lead.note, note].filter(Boolean).join('\n') } : {}),
  });
  recordLeadEvent(id, EVENT.contacted, note || null);
  return getLead(id);
}

/* ---------------- the one reminder a lead can have ---------------- */

/** Leads whose next contact is due and who have not been mentioned yet. */
export const dueLeadReminders = (nowIso) =>
  db
    .prepare(
      `SELECT * FROM leads
       WHERE next_action_at IS NOT NULL AND reminded_at IS NULL
         AND needs_confirmation = 0
         AND stage NOT IN ('won', 'lost')
         AND next_action_at <= ?
       ORDER BY next_action_at ASC`
    )
    .all(nowIso)
    .map(shape);

/** Exactly one caller can deliver it - the same claim the notes use. */
export function claimLeadReminder(id) {
  const info = db
    .prepare(`UPDATE leads SET reminded_at = datetime('now') WHERE id = ? AND reminded_at IS NULL`)
    .run(id);
  if (info.changes !== 1) return null;
  recordLeadEvent(id, EVENT.reminded);
  return getLead(id);
}

/** Everything the search box should find about a lead. */
export function searchLeads(query, { limit = 20 } = {}) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  return listLeads({ includeUnconfirmed: true })
    .filter((lead) =>
      [lead.name, lead.phone, lead.note, lead.group_name, lead.chat_name, lead.source_ref]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle))
    )
    .slice(0, limit);
}

log.info('Leads ready.');
