import { Router } from 'express';
import { db, getTask } from '../db.js';
import { taskHistory, onTimeLabel, dueMoment } from '../task-lifecycle.js';
import { recentEvents } from '../task-events.js';
import { getSettings } from '../scheduling.js';

export const historyRouter = Router();

/**
 * The permanent record: everything finished or archived, whatever its source.
 * Completed shows what is recently done; this answers "what did I do, and what
 * happened to it" months later - so nothing is filtered out by age.
 */
const HISTORY_WHERE = `(t.status = 'done' OR t.archived_at IS NOT NULL)`;

const like = (value) => `%${String(value).toLowerCase()}%`;

/** The rows a set of filters selects. Shared so the CSV is exactly what is shown. */
function queryHistory(query) {
  const { q, from, to, source, priority, chat, timing, limit } = query;
  const settings = getSettings();

  const clauses = [HISTORY_WHERE];
  const params = [];

  if (q) {
    clauses.push(`(LOWER(t.title) LIKE ? OR LOWER(COALESCE(t.description, '')) LIKE ?
                   OR LOWER(COALESCE(t.notes, '')) LIKE ? OR LOWER(COALESCE(t.chat_name, '')) LIKE ?
                   OR LOWER(COALESCE(t.contact, '')) LIKE ? OR LOWER(COALESCE(m.body, '')) LIKE ?)`);
    params.push(like(q), like(q), like(q), like(q), like(q), like(q));
  }
  // Ranged on completion, because that is the date a person remembers.
  if (from) { clauses.push(`COALESCE(t.completed_at, t.archived_at) >= ?`); params.push(from); }
  if (to) { clauses.push(`COALESCE(t.completed_at, t.archived_at) <= ?`); params.push(`${to} 23:59:59`); }
  if (source === 'ai' || source === 'manual') { clauses.push(`t.origin = ?`); params.push(source); }
  if (['high', 'medium', 'low'].includes(priority)) { clauses.push(`t.priority = ?`); params.push(priority); }
  if (chat) { clauses.push(`t.chat_name = ?`); params.push(chat); }

  const rows = db
    .prepare(
      `SELECT t.*, m.body AS source_message, m.sent_at AS source_message_at
       FROM tasks t LEFT JOIN messages m ON m.id = t.message_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY COALESCE(t.completed_at, t.archived_at) DESC, t.id DESC
       LIMIT ?`
    )
    .all(...params, Math.min(Number(limit) || 200, 1000))
    .map((task) => ({
      ...task,
      on_time: onTimeLabel(task),
      archived: Boolean(task.archived_at),
      due_at_resolved: dueMoment(task, settings)?.toISOString() ?? null,
    }));

  // Timing is a property of the row, not something SQL can filter on cleanly.
  return ['on time', 'late', 'no deadline'].includes(timing)
    ? rows.filter((t) => t.on_time === timing)
    : rows;
}

historyRouter.get('/', (req, res) => {
  const rows = queryHistory(req.query);
  res.json({ tasks: rows, stats: historyStats(rows) });
});

/* ---------------- CSV export ---------------- */

const CSV_COLUMNS = [
  ['Title', (t) => t.title],
  ['Status', (t) => (t.archived_at ? 'archived' : t.status)],
  ['Priority', (t) => t.priority],
  ['Chat', (t) => t.chat_name],
  ['Contact', (t) => t.contact],
  ['Source', (t) => (t.origin === 'ai' ? 'AI' : 'manual')],
  ['Created', (t) => t.created_at],
  ['Deadline', (t) => t.due_at_resolved],
  ['Completed', (t) => t.completed_at],
  ['On time', (t) => t.on_time],
  ['Notes', (t) => t.notes],
  ['Description', (t) => t.description],
  ['Original message', (t) => t.source_message],
];

/**
 * A spreadsheet of the same rows the page is showing. Excel decides a field is
 * a formula when it starts with =, + or @, so those are prefixed with a quote -
 * a task literally titled "=total" should not execute when the file is opened.
 */
function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

historyRouter.get('/export', (req, res) => {
  const rows = queryHistory({ ...req.query, limit: req.query.limit || 1000 });
  const lines = [CSV_COLUMNS.map(([name]) => csvCell(name)).join(',')];
  for (const task of rows) {
    lines.push(CSV_COLUMNS.map(([, read]) => csvCell(read(task))).join(','));
  }
  const day = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="wa-tasks-history-${day}.csv"`);
  // A BOM, so Excel opens the Gujarati and Hindi titles as UTF-8 rather than mojibake.
  res.send(`\uFEFF${lines.join('\r\n')}\r\n`);
});

/** Figures over exactly the rows being shown, so they always agree with the list. */
function historyStats(rows) {
  const done = rows.filter((t) => t.status === 'done');
  const onTime = done.filter((t) => t.on_time === 'on time').length;
  const late = done.filter((t) => t.on_time === 'late').length;

  // Average turnaround, over the tasks that have both ends recorded.
  const spans = done
    .map((t) => {
      const created = Date.parse(`${String(t.created_at).replace(' ', 'T')}Z`);
      const finished = Date.parse(`${String(t.completed_at).replace(' ', 'T')}Z`);
      return Number.isFinite(created) && Number.isFinite(finished) ? finished - created : null;
    })
    .filter((n) => n !== null && n >= 0);

  return {
    total: rows.length,
    completed: done.length,
    archived: rows.filter((t) => t.archived_at).length,
    onTime,
    late,
    // Reported only where there is something to average.
    averageDays: spans.length ? Number((spans.reduce((a, b) => a + b, 0) / spans.length / 86400000).toFixed(1)) : null,
  };
}

/** Counts over fixed windows, for the summary strip. */
historyRouter.get('/summary', (req, res) => {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(completed_at >= date('now', '-7 days')), 0)   AS week,
         COALESCE(SUM(completed_at >= date('now', 'start of month')), 0) AS month,
         COALESCE(SUM(completed_at >= date('now', 'start of year')), 0)  AS year,
         COUNT(*) AS total
       FROM tasks WHERE status = 'done'`
    )
    .get();

  // On-time needs the deadline resolved per row, so it is counted in JS.
  const settings = getSettings();
  const done = db.prepare(`SELECT * FROM tasks WHERE status = 'done'`).all();
  const withDeadline = done.filter((t) => dueMoment(t, settings));
  res.json({
    ...row,
    onTime: withDeadline.filter((t) => onTimeLabel(t) === 'on time').length,
    late: withDeadline.filter((t) => onTimeLabel(t) === 'late').length,
    activity: recentEvents(10),
  });
});

/** One task's complete lifecycle. */
historyRouter.get('/:id', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  res.json(taskHistory(task));
});
