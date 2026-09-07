import { db, createTask, getTask } from './db.js';
import { findDuplicateTask } from './task-matching.js';
import { config } from './config.js';
import { log } from './logger.js';
import { today, numberOrNull } from './dates.js';
import { isoAtLocal } from './quickparse.js';
import { EVENT, recordEvent } from './task-events.js';
import { activeRemindersForTask, snoozeReminder } from './scheduling.js';
import { planTask, rescheduleTask } from './task-lifecycle.js';

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

  /*
   * Whether the day-before notice for one occurrence has been dealt with.
   *
   * On the server rather than in the browser, because "I have seen this" is a
   * fact about the person, not about the tab: dismissing it on the phone and
   * then opening the dashboard on the laptop must not show it again, and a
   * cleared browser must not resurrect it. Keyed on the occurrence's own date,
   * so next month's notice is a different row and always appears.
   */
  CREATE TABLE IF NOT EXISTS deadline_notices (
    rule_id      INTEGER NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
    due_date     TEXT NOT NULL,
    seen_at      TEXT,
    snooze_until TEXT,
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (rule_id, due_date)
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
  const rule = getRule(id);
  resyncRule(rule, current);
  return rule;
}

/**
 * An edited rule reaches the task it has already produced.
 *
 * Moving GSTR-1 from the 11th to the 12th, or from 6 PM to 5 PM, has to move
 * *this* month's task too - otherwise the rule says one thing and the task on
 * the list says another, and the reminders are laid out against the old time.
 * The month's claim is untouched, so nothing is created twice: the existing
 * task is rescheduled through the ordinary path, which resets its ladder from
 * the new deadline and cancels what is now stale.
 *
 * Only the deadline and the warning are carried over. Title, priority and
 * notes on a task in flight may have been edited by hand, and a rule change is
 * not a reason to overwrite what somebody wrote on this month's work.
 */
export function resyncRule(rule, before = null) {
  if (!rule) return [];
  const moved = [];
  const sameShape = before
    && before.day_of_month === rule.day_of_month
    && before.due_time === rule.due_time
    && before.lead_days === rule.lead_days;
  if (sameShape) return moved;

  const todayIso = today(config.timezone);
  const [h, m] = String(rule.due_time || '18:00').split(':').map(Number);

  for (const month of [monthOf(todayIso), nextMonth(monthOf(todayIso))]) {
    const run = db
      .prepare(`SELECT task_id FROM recurring_runs WHERE rule_id = ? AND month = ?`)
      .get(rule.id, month);
    if (!run?.task_id) continue;

    const task = getTask(run.task_id);
    // A finished or archived occurrence is history. Rewriting its deadline
    // would rewrite whether it was completed on time, which it was not.
    if (!task || task.status === 'done' || task.archived_at) continue;

    const dueDay = dateFor(rule, month);
    const dueAt = isoAtLocal(dueDay, h, m, config.timezone);

    if (Number(task.warn_days) !== Number(rule.lead_days)) {
      db.prepare(`UPDATE tasks SET warn_days = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(rule.lead_days, task.id);
    }

    if (task.due_date !== dueDay || task.due_at !== dueAt) {
      rescheduleTask(task.id, { due_date: dueDay, due_at: dueAt });
    } else {
      // Only the warning moved: rebuild the schedule without resetting the
      // escalation count, which has nothing to do with when we warn.
      planTask(getTask(task.id), { reset: true });
    }

    /*
     * The notice is about an occurrence on a particular date. Once that date
     * changes the old row describes something that no longer exists, and a
     * notice already dismissed for the 11th must not silence the 12th.
     */
    db.prepare(`DELETE FROM deadline_notices WHERE rule_id = ? AND due_date >= ?`)
      .run(rule.id, todayIso);

    moved.push(getTask(task.id));
  }
  return moved;
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
      /*
       * A day earlier than the warning, deliberately.
       *
       * The warning is scheduled on the task, so the task has to exist before
       * its warning is due - created exactly `lead_days` ahead, the warning's
       * moment was the creation moment or already gone, and a reminder for a
       * moment that has passed is never arranged. One day of margin means the
       * ladder is laid out while the warning is still in the future.
       *
       * It only affects when the row appears on the list. What interrupts, and
       * when, is still the rule's own warning: the popup and the card both key
       * off `lead_days`.
       */
      const showFrom = shiftDays(dueDay, -(rule.lead_days + 1));
      if (todayIso < showFrom) continue;   // not yet worth putting on the list
      if (todayIso > dueDay) continue;     // that occurrence has already passed

      const claim = db
        .prepare(`INSERT OR IGNORE INTO recurring_runs (rule_id, month) VALUES (?, ?)`)
        .run(rule.id, month);
      if (claim.changes !== 1) continue;   // this month is already done

      /*
       * The month's claim stops this rule firing twice, but says nothing about
       * the same job arriving another way. "Pay BNF TDS today last date" typed
       * into a chat on the 7th becomes a task, and then the rule for the 7th
       * made a second one - two rows, two ladders, two reminders for one job.
       *
       * Scoped to this occurrence's own day, so an unfinished August TDS never
       * suppresses September's: that is a different obligation with the same
       * words. The claim is kept either way, because this month *is* handled -
       * the task exists, it just came from somewhere else.
       */
      const already = findDuplicateTask(rule.title, { dueDate: dueDay });
      if (already) {
        db.prepare(`UPDATE recurring_runs SET task_id = ? WHERE rule_id = ? AND month = ?`)
          .run(already.id, rule.id, month);
        log.info(
          `Monthly deadline "${rule.title}" for ${dueDay} already exists as task ${already.id}.`
        );
        continue;
      }

      try {
        const [h, m] = String(rule.due_time || '18:00').split(':').map(Number);
        const task = createTask({
          title: rule.title,
          description: rule.description,
          priority: rule.priority,
          due_date: dueDay,
          due_at: isoAtLocal(dueDay, h, m, config.timezone),
          group_id: rule.group_id,
          // The rule's warning becomes the task's own, so the ordinary
          // lifecycle schedules it, moves it with the deadline and cancels it
          // on completion - there is no second reminder engine here.
          warn_days: rule.lead_days,
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

/**
 * The rule a task came from, if it came from one.
 *
 * Used where a message about the task should say that it comes round every
 * month - a warning reads differently when the deadline is statutory and will
 * be back on the same date in October.
 */
export const ruleForTask = (taskId) =>
  db.prepare(
    `SELECT r.* FROM recurring_runs run
     JOIN recurring_rules r ON r.id = run.rule_id
     WHERE run.task_id = ?`
  ).get(taskId) || null;

/* ---------------- the day-before notice ---------------- */

export const noticeFor = (ruleId, dueDate) =>
  db.prepare(`SELECT * FROM deadline_notices WHERE rule_id = ? AND due_date = ?`)
    .get(ruleId, dueDate) || null;

/**
 * Records what was done with one occurrence's notice.
 *
 *   dismiss — that is the end of it for this occurrence. Next month is a
 *             different date and so a different row, which is the whole reason
 *             the date is part of the key.
 *   later   — put it back after `minutes`. The task's own pending warning is
 *             moved by the same amount through the ordinary snooze, so the
 *             popup and the notification stay in step and no second reminder
 *             is created.
 */
export function setNotice(ruleId, dueDate, action, minutes = 120) {
  const now = new Date();
  const snoozeUntil = action === 'later'
    ? new Date(now.getTime() + Math.max(1, Number(minutes) || 120) * 60_000).toISOString()
    : null;

  db.prepare(
    `INSERT INTO deadline_notices (rule_id, due_date, seen_at, snooze_until)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(rule_id, due_date) DO UPDATE
       SET seen_at = excluded.seen_at,
           snooze_until = excluded.snooze_until,
           updated_at = datetime('now')`
  ).run(ruleId, dueDate, action === 'later' ? null : now.toISOString(), snoozeUntil);

  if (action === 'later') {
    const run = db
      .prepare(`SELECT task_id FROM recurring_runs WHERE rule_id = ? AND month = ?`)
      .get(ruleId, monthOf(dueDate));
    if (run?.task_id) {
      const pending = activeRemindersForTask(run.task_id).find((r) => r.kind === 'warning');
      /*
       * Only ever later, never sooner.
       *
       * The popup appears from the start of the warning day, while the
       * warning itself is still to come that evening. Snoozing it then would
       * drag a 6 PM notification forward to lunchtime - "remind me later"
       * making the reminder arrive earlier. Where the warning is already
       * further out than the snooze, there is nothing to move.
       */
      if (pending && snoozeUntil > pending.fire_at) {
        snoozeReminder(pending.id, Math.max(1, Number(minutes) || 120));
      }
    }
  }
  return noticeFor(ruleId, dueDate);
}

/** Rules whose date is coming up, with the task if one exists yet. */
export function upcoming({ within = 40, now = new Date() } = {}) {
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
      const notice = noticeFor(rule.id, dueDay);

      /*
       * Whether the dashboard should interrupt for this one.
       *
       *   - inside the warning window the rule itself sets, and
       *   - the work is not already finished, and
       *   - it has not been dismissed, and any "remind me later" has elapsed.
       *
       * Computed here rather than in the browser so every device agrees, and
       * so a refresh, a reopen or a second tab cannot bring back a notice that
       * has been dealt with.
       */
      const finished = Boolean(task && (task.status === 'done' || task.archived_at));
      const snoozed = Boolean(notice?.snooze_until && notice.snooze_until > now.toISOString());
      const popup = days <= (rule.lead_days ?? 1)
        && !finished
        && !notice?.seen_at
        && !snoozed;

      out.push({
        rule, month, due_date: dueDay, days_away: days, task,
        due_at: task?.due_at || isoAtLocal(dueDay, ...hourMinute(rule.due_time), config.timezone),
        notice, popup, done: finished,
      });
      break; // the next occurrence only
    }
  }
  return out.sort((a, b) => a.days_away - b.days_away);
}

const hourMinute = (hhmm) => String(hhmm || '18:00').split(':').map(Number);

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
