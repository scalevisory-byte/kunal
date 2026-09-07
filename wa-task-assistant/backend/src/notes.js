import { db } from './db.js';
import { numberOrNull } from './dates.js';
import { log } from './logger.js';

/**
 * Things to remember, as opposed to things to do.
 *
 * A task is owed: it has a deadline, a ladder of reminders behind it, and a
 * point at which not having done it is a problem. A note is none of that -
 * "what the CA said about the audit" is worth keeping and worth finding again,
 * and nothing should ever chase him about it. Keeping them apart is the whole
 * design: notes deliberately do not get a status, a follow-up, or a place in
 * the digest.
 *
 * Where the two meet is a note that turns out to contain work. That is one
 * button, pressed by a person, which makes an ordinary task through the
 * ordinary task system - never something the app decides on its own.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT,
    body        TEXT NOT NULL DEFAULT '',
    group_id    INTEGER REFERENCES task_groups(id) ON DELETE SET NULL,
    tags        TEXT NOT NULL DEFAULT '[]',
    pinned      INTEGER NOT NULL DEFAULT 0,
    archived_at TEXT,
    /*
     * A note's reminder lives here rather than in the reminders table.
     *
     * That table's rows belong to a task and carry a ladder - a kind, a round,
     * an escalation count - none of which a note has or should have. One
     * moment, delivered once, through the same pass and the same notification
     * centre as everything else: reusing the engine, not the task's schedule.
     */
    remind_at   TEXT,
    reminded_at TEXT,
    source      TEXT NOT NULL DEFAULT 'manual',
    source_ref  TEXT,
    chat_name   TEXT,
    contact     TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- The same shape as task_events, for the same reason: rows are never
  -- rewritten, so a note pinned and unpinned twice shows both.
  CREATE TABLE IF NOT EXISTS note_events (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    kind    TEXT NOT NULL,
    detail  TEXT,
    at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_notes_live   ON notes(archived_at, pinned, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_notes_remind ON notes(remind_at) WHERE remind_at IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_note_events  ON note_events(note_id, id DESC);
`);

export const NOTE_EVENT = {
  created: 'created',
  edited: 'edited',
  pinned: 'pinned',
  unpinned: 'unpinned',
  reminderSet: 'reminder set',
  reminderCleared: 'reminder cleared',
  reminderTriggered: 'reminder triggered',
  taskCreated: 'converted to task',
  archived: 'archived',
  restored: 'restored',
};

export const recordNoteEvent = (noteId, kind, detail = null) =>
  db.prepare(`INSERT INTO note_events (note_id, kind, detail) VALUES (?, ?, ?)`)
    .run(noteId, kind, detail ? String(detail).slice(0, 300) : null);

export const noteEvents = (noteId) =>
  db.prepare(`SELECT * FROM note_events WHERE note_id = ? ORDER BY id DESC`).all(noteId);

/* ---------------- shape ---------------- */

const parseTags = (raw) => {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed)
      ? [...new Set(parsed.map((t) => String(t || '').trim()).filter(Boolean))].slice(0, 12)
      : [];
  } catch {
    return [];
  }
};

const clean = (value, max) => String(value ?? '').trim().slice(0, max);

const SELECT = `
  SELECT n.*, g.name AS group_name, g.colour AS group_colour,
         (SELECT COUNT(*) FROM tasks t WHERE t.note_id = n.id AND t.archived_at IS NULL) AS task_count
  FROM notes n
  LEFT JOIN task_groups g ON g.id = n.group_id
`;

const shape = (row) =>
  row
    ? {
        ...row,
        tags: parseTags(row.tags),
        pinned: Boolean(row.pinned),
        archived: Boolean(row.archived_at),
      }
    : null;

export const getNote = (id) => shape(db.prepare(`${SELECT} WHERE n.id = ?`).get(id));

/**
 * The notes, newest activity first, pinned above everything.
 *
 * Pinned notes are not repeated below - a note in two places is a note you
 * think you have two of.
 */
export function listNotes({ archived = false, groupId = null, tag = null, withReminder = false } = {}) {
  const where = [archived ? 'n.archived_at IS NOT NULL' : 'n.archived_at IS NULL'];
  const args = [];
  if (groupId) { where.push('n.group_id = ?'); args.push(Number(groupId)); }
  if (withReminder) where.push('n.remind_at IS NOT NULL');

  const rows = db
    .prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY n.pinned DESC, n.updated_at DESC`)
    .all(...args)
    .map(shape);

  if (!tag) return rows;
  const wanted = String(tag).toLowerCase();
  return rows.filter((n) => n.tags.some((t) => t.toLowerCase() === wanted));
}

/** Every tag in use, with how many notes carry it. */
export function tagCounts() {
  const counts = new Map();
  for (const note of listNotes()) {
    for (const tag of note.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/* ---------------- writing ---------------- */

export function createNote(input = {}) {
  const title = clean(input.title, 200);
  const body = String(input.body ?? '').slice(0, 20_000);
  // A note with neither is nothing to keep. Either alone is fine: a heading
  // with nothing under it yet is how a note usually starts.
  if (!title && !body.trim()) throw new Error('a note needs a title or something in it');

  const info = db
    .prepare(
      `INSERT INTO notes (title, body, group_id, tags, pinned, remind_at, source, source_ref, chat_name, contact)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      title || null,
      body,
      numberOrNull(input.group_id),
      JSON.stringify(parseTags(JSON.stringify(input.tags || []))),
      input.pinned ? 1 : 0,
      input.remind_at || null,
      ['manual', 'whatsapp'].includes(input.source) ? input.source : 'manual',
      input.source_ref ? clean(input.source_ref, 120) : null,
      input.chat_name ? clean(input.chat_name, 120) : null,
      input.contact ? clean(input.contact, 120) : null
    );

  const note = getNote(info.lastInsertRowid);
  recordNoteEvent(note.id, NOTE_EVENT.created, note.source === 'whatsapp' ? 'saved from WhatsApp' : null);
  if (note.remind_at) recordNoteEvent(note.id, NOTE_EVENT.reminderSet, note.remind_at);
  return note;
}

const FIELDS = ['title', 'body', 'group_id', 'tags', 'pinned', 'remind_at'];

export function updateNote(id, patch = {}) {
  const current = getNote(id);
  if (!current) return null;

  const sets = [];
  const args = [];
  const said = [];

  for (const key of FIELDS) {
    if (!(key in patch)) continue;
    let value = patch[key];
    if (key === 'title') value = clean(value, 200) || null;
    if (key === 'body') value = String(value ?? '').slice(0, 20_000);
    if (key === 'group_id') value = numberOrNull(value);
    if (key === 'tags') value = JSON.stringify(parseTags(JSON.stringify(value || [])));
    if (key === 'pinned') value = value ? 1 : 0;
    if (key === 'remind_at') value = value || null;
    sets.push(`${key} = ?`);
    args.push(value);
    said.push(key);
  }
  if (!sets.length) return current;

  /*
   * A reminder that is moved is a reminder that has not been sent yet. Clearing
   * the mark is what lets the new moment fire; without it, editing the time on
   * a note whose reminder had already gone out would leave it silent forever.
   */
  if (said.includes('remind_at')) {
    sets.push('reminded_at = NULL');
  }

  db.prepare(`UPDATE notes SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...args, id);

  const next = getNote(id);
  if (said.includes('pinned') && Boolean(current.pinned) !== Boolean(next.pinned)) {
    recordNoteEvent(id, next.pinned ? NOTE_EVENT.pinned : NOTE_EVENT.unpinned);
  }
  if (said.includes('remind_at') && current.remind_at !== next.remind_at) {
    recordNoteEvent(id, next.remind_at ? NOTE_EVENT.reminderSet : NOTE_EVENT.reminderCleared, next.remind_at);
  }
  const wrote = said.filter((k) => ['title', 'body', 'tags', 'group_id'].includes(k));
  if (wrote.length) recordNoteEvent(id, NOTE_EVENT.edited, wrote.join(', '));
  return next;
}

/**
 * Archive, not delete.
 *
 * The same trade tasks make: what was written down is worth keeping, and a
 * note removed by accident cannot be got back. Archived notes leave the main
 * grid and stay searchable under Archived; a real delete is still available
 * for the ones that should never have been written.
 */
export function archiveNote(id) {
  const changed = db
    .prepare(`UPDATE notes SET archived_at = datetime('now'), pinned = 0, updated_at = datetime('now')
              WHERE id = ? AND archived_at IS NULL`)
    .run(id).changes;
  if (changed) recordNoteEvent(id, NOTE_EVENT.archived);
  return getNote(id);
}

export function restoreNote(id) {
  const changed = db
    .prepare(`UPDATE notes SET archived_at = NULL, updated_at = datetime('now')
              WHERE id = ? AND archived_at IS NOT NULL`)
    .run(id).changes;
  if (changed) recordNoteEvent(id, NOTE_EVENT.restored);
  return getNote(id);
}

/**
 * A real delete. The tasks made from the note are kept - they are work that is
 * owed, and deleting the notebook page does not undo the job - so they simply
 * stop pointing at a note that is no longer there.
 */
export function deleteNote(id) {
  db.prepare(`UPDATE tasks SET note_id = NULL WHERE note_id = ?`).run(id);
  return db.prepare(`DELETE FROM notes WHERE id = ?`).run(id).changes > 0;
}

/* ---------------- finding ---------------- */

/**
 * Notes matching a search, for the app's one search box.
 *
 * Title, body, tags, business and where it came from - the same fields the
 * note shows, because searching for what you can see is the only rule anybody
 * remembers. Archived notes are included: "I wrote that down somewhere" is
 * exactly when you go looking.
 */
export function searchNotes(query, { limit = 20 } = {}) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  const all = [...listNotes(), ...listNotes({ archived: true })];
  return all
    .filter((note) =>
      [note.title, note.body, note.group_name, note.chat_name, note.contact, note.tags.join(' ')]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle))
    )
    .slice(0, limit);
}

/** The tasks made from one note - the other half of "related". */
export const tasksFromNote = (noteId) =>
  db.prepare(
    `SELECT id, title, status, due_at, due_date, priority, archived_at
     FROM tasks WHERE note_id = ? ORDER BY id DESC`
  ).all(noteId);

/* ---------------- the one reminder a note can have ---------------- */

/** Notes whose moment has come and which have not been told about yet. */
export const dueNoteReminders = (nowIso) =>
  db
    .prepare(
      `SELECT * FROM notes
       WHERE remind_at IS NOT NULL AND reminded_at IS NULL
         AND archived_at IS NULL AND remind_at <= ?
       ORDER BY remind_at ASC`
    )
    .all(nowIso)
    .map(shape);

/**
 * Claims one, so exactly one caller can deliver it.
 *
 * The same conditional-UPDATE trick the reminder engine uses on its own rows:
 * a second tick, a restart mid-send or a retry finds the row already claimed
 * and sends nothing.
 */
export function claimNoteReminder(id) {
  const info = db
    .prepare(`UPDATE notes SET reminded_at = datetime('now') WHERE id = ? AND reminded_at IS NULL`)
    .run(id);
  if (info.changes !== 1) return null;
  recordNoteEvent(id, NOTE_EVENT.reminderTriggered);
  return getNote(id);
}

log.info('Notes ready.');
