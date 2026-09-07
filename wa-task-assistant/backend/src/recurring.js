import { db, createTask, getTask } from './db.js';
import { config } from './config.js';
import { log } from './logger.js';
import { today, numberOrNull } from './dates.js';
import { isoAtLocal } from './quickparse.js';
import { EVENT, recordEvent } from './task-events.js';
import { planTask } from './task-lifecycle.js';

/**
 * Work that comes round on the same date every month.
 *
 * TDS on the 7th, GST on the 11th, GSTR-3B on the 20th - statutory dates that
 * do not move and where being late costs money. These are not reminders in the
 * engine's sense; each month they become a real task, so the ladder, the
 * briefing, the history and the groups all treat them like anything else.
 *
 * The rule that makes this safe: one task per rule per month, guaranteed by a
 * unique index on (rule, month) rather than by remembering to check. A restart,
 * a retry or two workers cannot produce a second copy.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS recurring_rules (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT NOT NULL,
    description   TEXT,
    day_of_month  INTEGER NOT NULL,
    due_time      TEXT NOT NULL DEFAULT '18:00',
    priority      TEXT NOT NULL DEFAULT 'high',
    lead_days     INTEGER NOT NULL DEFAULT 1,
    group_id      INTEGER REFERENCES task_groups(id) ON DELETE SET NULL,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- One task per rule per month. The index is the guarantee, not the code.
  CREATE TABLE IF NOT EXISTS recurring_runs (
    rule_id    INTEGER NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
    month      TEXT NOT NULL,
    task_id    INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (rule_id, month)
  );
`);

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const PRIORITIES = new Set(['high', 'medium', 'low']);

export const listRules = () =>
  db.prepare(
    `SELECT r.*, g.name AS group_name, g.colour AS group_colour
     FROM recurring_rules r LEFT JOIN task_groups g ON g.id = r.group_id
     ORDER BY r.day_of_month, r.title`
  ).all();

export const getRule = (id) =>
  db.prepare(
    `SELECT r.*, g.name AS group_name, g.colour AS group_colour
     FROM recurring_rules r LEFT JOIN task_groups g ON g.id = r.group_id
     WHERE r.id = ?`
  ).get(id) || null;

export function createRule(input) {
  const title = clean(input.title, 200);
  const day = Number(input.day_of_month);
  if (!title) throw new Error('a monthly deadline needs a title');
  // 1-28 only: every month has those days, so a rule can never silently skip
  // February. A 30th-of-the-month rule would miss two months a year.
  if (!Number.isInteger(day) || day < 1 || day > 28) {
    throw new Error('the day of the month must be between 1 and 28, so it exists in every month');
  }

  const info = db
    .prepare(
      `INSERT INTO recurring_rules (title, description, day_of_month, due_time, priority, lead_days, group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      title,
      input.description ? clean(input.description, 1000) : null,
      day,
      /^\d{2}:\d{2}$/.test(input.due_time || '') ? input.due_time : '18:00',
      PRIORITIES.has(input.priority) ? input.priority : 'high',
      Number.isInteger(Number(input.lead_days)) && Number(input.lead_days) >= 0
        ? Math.min(Number(input.lead_days), 15)
        : 1,
      numberOrNull(input.group_id)
    );
  return getRule(info.lastInsertRowid);
}

export function updateRule(id, patch) {
  const current = getRule(id);
  if (!current) return null;
  const merged = { ...current, ...patch };
  const day = Number(merged.day_of_month);
  if (!Number.isInteger(day) || day < 1 || day > 28) {
    throw new Error('the day of the month must be between 1 and 28, so it exists in every month');
  }
  db.prepare(
    `UPDATE recurring_rules
     SET title = ?, description = ?, day_of_month = ?, due_time = ?, priority = ?,
         lead_days = ?, group_id = ?, active = ?
     WHERE id = ?`
  ).run(
    clean(merged.title, 200) || current.title,
    merged.description ? clean(merged.description, 1000) : null,
    day,
    /^\d{2}:\d{2}$/.test(merged.due_time || '') ? merged.due_time : current.due_time,
    PRIORITIES.has(merged.priority) ? merged.priority : current.priority,
    Number.isInteger(Number(merged.lead_days)) ? Math.min(Math.max(Number(merged.lead_days), 0), 15) : current.lead_days,
    numberOrNull(merged.group_id),
    merged.active ? 1 : 0,
    id
  );
  return getRule(id);
}

export const deleteRule = (id) =>
  db.prepare(`DELETE FROM recurring_rules WHERE id = ?`).run(id).changes > 0;

/** The month a date belongs to, on the user's calendar: "2026-09". */
export const monthOf = (day) => String(day).slice(0, 7);

/** The date a rule falls on in a given month. */
export const dateFor = (rule, month) =>
  `${month}-${String(rule.day_of_month).padStart(2, '0')}`;

/**
 * Turn due rules into tasks.
 *
 * A rule's task is created `lead_days` before its date, so a deadline on the
 * 7th appears on the 6th with a day to act on it - the point of the whole
 * thing. The month is part of the claim, so the same month's task cannot be
 * created twice however many times this runs.
 */
export function materialiseDue({ now = new Date() } = {}) {
  const todayIso = today(config.timezone);
  const created = [];

  for (const rule of listRules()) {
    if (!rule.active) continue;

    // This month's occurrence, and next month's once this month's has passed.
    for (const month of [monthOf(todayIso), nextMonth(monthOf(todayIso))]) {
      const dueDay = dateFor(rule, month);
      const showFrom = shiftDays(dueDay, -rule.lead_days);
      if (todayIso < showFrom) continue;   // not yet worth putting on the list
      if (todayIso > dueDay) continue;     // that occurrence has already passed

      const claim = db
        .prepare(`INSERT OR IGNORE INTO recurring_runs (rule_id, month) VALUES (?, ?)`)
        .run(rule.id, month);
      if (claim.changes !== 1) continue;   // this month is already done

      try {
        const [h, m] = String(rule.due_time || '18:00').split(':').map(Number);
        const task = createTask({
          title: rule.title,
          description: rule.description,
          priority: rule.priority,
          due_date: dueDay,
          due_at: isoAtLocal(dueDay, h, m, config.timezone),
          group_id: rule.group_id,
          source: 'manual',
          origin: 'manual',
          status: 'open',
        });
        db.prepare(`UPDATE recurring_runs SET task_id = ? WHERE rule_id = ? AND month = ?`)
          .run(task.id, rule.id, month);

        recordEvent(task.id, EVENT.created, `monthly deadline — the ${ordinal(rule.day_of_month)}`);
        recordEvent(task.id, EVENT.deadlineSet, task.due_at);
        planTask(task);
        created.push(task);
        log.info(`Monthly deadline "${rule.title}" created for ${dueDay}.`);
      } catch (err) {
        // Free the claim so the next tick can try again rather than skipping
        // the month entirely.
        db.prepare(`DELETE FROM recurring_runs WHERE rule_id = ? AND month = ?`).run(rule.id, month);
        log.error(`Monthly deadline "${rule.title}" failed:`, err?.message || err);
      }
    }
  }
  return created;
}

/** Rules whose date is coming up, with the task if one exists yet. */
export function upcoming({ within = 40 } = {}) {
  const todayIso = today(config.timezone);
  const out = [];
  for (const rule of listRules()) {
    if (!rule.active) continue;
    for (const month of [monthOf(todayIso), nextMonth(monthOf(todayIso))]) {
      const dueDay = dateFor(rule, month);
      if (dueDay < todayIso) continue;
      const days = daysBetween(todayIso, dueDay);
      if (days > within) continue;
      const run = db
        .prepare(`SELECT task_id FROM recurring_runs WHERE rule_id = ? AND month = ?`)
        .get(rule.id, month);
      const task = run?.task_id ? getTask(run.task_id) : null;
      out.push({ rule, month, due_date: dueDay, days_away: days, task });
      break; // the next occurrence only
    }
  }
  return out.sort((a, b) => a.days_away - b.days_away);
}

/* ---------------- small date helpers, all on the user's calendar ------- */

function nextMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

function shiftDays(day, delta) {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + delta);
  return at.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
