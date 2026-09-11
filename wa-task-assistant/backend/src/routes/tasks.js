import { Router } from 'express';
import { createTask, getTask, listTasks, updateTask, deleteTask, taskStats } from '../db.js';
import { normalizeDueDate, normalizeInstant, today } from '../dates.js';
import { parseQuickTask, isoAtLocal } from '../quickparse.js';
import { config } from '../config.js';
import {
  remindersForTask, snoozeReminder, acknowledgeReminder, cancelReminder, getReminder,
  scheduleCustomReminder, getSettings, nextRemindersFor, cancelRemindersForTask,
} from '../scheduling.js';
import {
  planTask, completeTask, rescheduleTask, syncNextReminder, taskSchedule,
} from '../task-lifecycle.js';
import { EVENT, recordEvent, eventsForTask } from '../task-events.js';
import { getGroup } from '../groups.js';
import { duplicateGroups, subjectWords } from '../task-matching.js';
import { tidyTitles } from '../extractor.js';
import { subtaskProgressFor, subtasksFor } from '../subtasks.js';
import { addUpdate, deleteUpdate, knownStages, latestUpdateFor, updateCountFor, updatesFor } from '../progress.js';
import { blockedMap, blockersOf, blockedBy, unblockedBy } from '../dependencies.js';
import { attachmentCounts, attachmentsFor } from '../attachments.js';

export const tasksRouter = Router();

tasksRouter.get('/', (req, res) => {
  // "open" from the dashboard means everything unfinished, in progress included.
  const raw = req.query.status;
  const status = raw === 'all' ? undefined : raw === 'open' ? 'pending' : raw;
  const settings = getSettings();
  /*
   * Set-aside work is fetched but flagged, not withheld: the dashboard makes
   * one request and slices it client-side, so a group's own page needs the rows
   * in hand. `stats` below already leaves them out, and so does every query the
   * reminder engine runs — this is the one place they travel.
   */
  const rows = listTasks({
    status,
    limit: req.query.limit,
    includeSetAside: true,
    order: req.query.order === 'recent' ? 'recent' : undefined,
  });
  // One query each for the whole page rather than three per row.
  const ids = rows.map((t) => t.id);
  const progress = subtaskProgressFor(ids);
  const blocked = blockedMap(ids);
  const files = attachmentCounts(ids);
  const nextReminders = nextRemindersFor(ids);
  // The last thing said about each task, so the row can show it without the
  // drawer being opened - which is the whole point of writing it down.
  const latest = latestUpdateFor(ids);
  const updateCounts = updateCountFor(ids);

  const tasks = rows.map((task) => ({
    ...task,
    ...taskSchedule(task, settings, { next: nextReminders.get(task.id) || {} }),
    subtask_progress: progress.get(task.id) || null,
    blocked_by: blocked.get(task.id) || [],
    attachment_count: files.get(task.id) || 0,
    latest_update: latest.get(task.id) || null,
    update_count: updateCounts.get(task.id) || 0,
  }));
  /*
   * How many open tasks look like copies of each other.
   *
   * Counted here because the board polls this and nothing else: a Duplicates
   * page nobody knows about is the same as no page, and "why duplication?" is
   * asked of the list, not of the sidebar.
   */
  const duplicates = duplicateGroups().reduce((n, g) => n + g.drop.length, 0);
  res.json({ tasks, stats: { ...taskStats(), duplicates }, stages: knownStages() });
});

tasksRouter.post('/', (req, res) => {
  const {
    title, description, notes, contact, chat_name, due_date, due_at, priority, remind_at,
    reminder_offset, follow_up_offset, assigned_to, assigned_to_wid, requested_by,
    is_group, group_id,
  } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  // Checked here rather than left to the foreign key, whose message is
  // "FOREIGN KEY constraint failed" — a true sentence about the database and
  // no help at all to the person who just typed a task into a group somebody
  // deleted while the board was open.
  if (group_id !== undefined && group_id !== null && group_id !== '') {
    if (!getGroup(Number(group_id))) {
      return res.status(400).json({ error: 'that group no longer exists' });
    }
  }
  try {
    const task = createTask({
      title,
      description,
      contact,
      chat_name,
      due_date: normalizeDueDate(due_date),
      // The deadline itself, when a time was given rather than only a date.
      due_at: normalizeInstant(due_at || remind_at),
      remind_at: null,
      notes: notes || null,
      priority,
      source: 'manual',
      origin: 'manual',
      status: 'open',
      // A task typed by hand can be somebody else's from the start, and can
      // record who asked for it - the same two columns the extractor fills, so
      // a hand-written delegation is indistinguishable from a captured one.
      assigned_to,
      assigned_to_wid,
      requested_by,
      // So a task entered against a group chat still shows who wrote it.
      is_group,
      /*
       * The business it belongs to, when the caller already knows.
       *
       * createTask has always accepted this and the column has always been
       * there; the route simply never passed it on, so a task added from
       * inside a business landed unfiled and had to be moved into the place it
       * was just created in. Keyword routing does not run here — that is the
       * extractor's job, and a caller naming a group has already decided.
       */
      group_id,
    });
    recordEvent(task.id, EVENT.created, 'added by hand');
    if (task.assigned_to) recordEvent(task.id, EVENT.assigned, task.assigned_to);
    if (task.due_at || task.due_date) {
      recordEvent(task.id, EVENT.deadlineSet, task.due_at || task.due_date);
    }
    // Per-task overrides of the defaults, applied only when one was given.
    planTask(task, {
      reminderOffset: Number.isFinite(Number(reminder_offset)) ? Number(reminder_offset) : undefined,
      followUpOffset: Number.isFinite(Number(follow_up_offset)) ? Number(follow_up_offset) : undefined,
    });
    const fresh = getTask(task.id);
    res.status(201).json({ ...fresh, ...taskSchedule(fresh) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * One line in, one task out.
 *
 * The fast path for the ordinary case: a title, maybe "kal 5 baje", and
 * nothing else to fill in. It creates exactly the same kind of task the full
 * form does - same table, same deadline, same ladder, same history - so
 * nothing downstream can tell the two apart. What it saves is the six fields
 * you did not need this time.
 *
 * The parsing is quickparse, which already reads his own words for the manual
 * capture mode. Nothing is invented: a reminder or a follow-up offset is set
 * only where the words are actually there, and otherwise the saved defaults
 * apply, exactly as they do for a task typed into the form.
 */
tasksRouter.post('/quick', (req, res) => {
  const { text, when, due_date: pickedDate, due_at: pickedAt, group_id } = req.body || {};
  const raw = String(text || '').trim();
  if (!raw) return res.status(400).json({ error: 'type what needs doing' });

  if (group_id !== undefined && group_id !== null && group_id !== '') {
    if (!getGroup(Number(group_id))) {
      return res.status(400).json({ error: 'that group no longer exists' });
    }
  }

  const parsed = parseQuickTask(raw) || { title: raw.slice(0, 200), priority: 'medium' };

  /*
   * A button beats the words.
   *
   * Pressing Today after typing "kal" is a correction, not a contradiction to
   * puzzle over: whichever was chosen last is what the person means, and the
   * button is chosen after the typing.
   */
  let dueDate = parsed.due_date ?? null;
  let dueAt = parsed.remind_at ?? null;

  if (when === 'today' || when === 'tomorrow') {
    const day = localDayOffset(when === 'today' ? 0 : 1);
    // A time that was typed is kept and moved onto the chosen day; without one
    // the deadline is the day itself, and the default hour applies as usual.
    dueAt = dueAt ? moveToDay(dueAt, day) : null;
    dueDate = day;
  } else if (when === 'none') {
    dueDate = null;
    dueAt = null;
  } else if (when === 'custom') {
    dueDate = normalizeDueDate(pickedDate) ?? dueDate;
    dueAt = normalizeInstant(pickedAt) ?? (pickedDate ? null : dueAt);
  }

  try {
    const task = createTask({
      title: parsed.title,
      description: parsed.description || null,
      due_date: dueDate,
      due_at: dueAt,
      priority: parsed.priority,
      group_id: group_id || null,
      source: 'manual',
      origin: 'manual',
      status: 'open',
    });

    recordEvent(task.id, EVENT.created, 'quick add');
    if (task.due_at || task.due_date) {
      recordEvent(task.id, EVENT.deadlineSet, task.due_at || task.due_date);
    }
    planTask(task, {
      reminderOffset: parsed.reminder_offset ?? undefined,
      followUpOffset: parsed.follow_up_offset ?? undefined,
    });

    const fresh = getTask(task.id);
    res.status(201).json({
      ...fresh,
      ...taskSchedule(fresh),
      /*
       * What it made of the sentence, so the person can see it rather than
       * discover it later. Everything read out of the words is named here;
       * anything not named came from the settings.
       */
      understood: {
        title: fresh.title,
        due_date: fresh.due_date,
        due_at: fresh.due_at,
        priority: parsed.priority,
        reminder_offset: parsed.reminder_offset ?? null,
        follow_up_offset: parsed.follow_up_offset ?? null,
        from_words: Boolean(parsed.due_date || parsed.remind_at
          || parsed.reminder_offset || parsed.follow_up_offset),
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** A day on the user's calendar, offset from today. */
function localDayOffset(days) {
  const iso = today(config.timezone);
  const at = new Date(`${iso}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** The same clock time, on another day, read in the user's zone. */
function moveToDay(iso, day) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(at).map((p) => [p.type, p.value])
  );
  return isoAtLocal(day, Number(parts.hour), Number(parts.minute), config.timezone);
}

/**
 * Everything the extractor was unsure about. Declared before '/:id' - Express
 * matches in order, and '/:id' would otherwise take "pending" for an id.
 */
tasksRouter.get('/pending/confirmation', (req, res) => {
  const tasks = listTasks({ status: 'all', limit: 500 })
    .filter((t) => t.needs_confirmation)
    .map((task) => ({ ...task, ...taskSchedule(task) }));
  res.json({ tasks });
});

/* ---------------- copies of the same job ---------------- */

/**
 * Open tasks that are copies of each other.
 *
 * Read-only, and it decides nothing: the merging below happens only when
 * somebody presses the button, because two rows that look alike to a word
 * count are not always the same job.
 */
tasksRouter.get('/duplicates/open', (req, res) => {
  const settings = getSettings();
  const dress = (t) => ({ ...t, ...taskSchedule(t, settings) });
  res.json({
    groups: duplicateGroups().map((g) => ({ keep: dress(g.keep), drop: g.drop.map(dress) })),
  });
});

/**
 * Keep one, put the rest away.
 *
 * Archived, never deleted: a copy still holds whatever was done to it, and the
 * whole point of the archive is that a wrong call here can be looked at later.
 * Completing them first retires the reminder ladders that were the reason the
 * duplicate mattered at all.
 */
tasksRouter.post('/duplicates/merge', (req, res) => {
  const keep = getTask(Number(req.body?.keep));
  if (!keep) return res.status(404).json({ error: 'not found' });

  const ids = (Array.isArray(req.body?.drop) ? req.body.drop : [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id !== keep.id);

  const merged = [];
  for (const id of ids) {
    const task = getTask(id);
    if (!task || task.archived_at) continue;
    completeTask(id);
    updateTask(id, { archived_at: new Date().toISOString() });
    recordEvent(id, EVENT.archived, `duplicate of task ${keep.id}`);
    recordEvent(keep.id, EVENT.edited, `merged duplicate task ${id}`);
    merged.push(id);
  }
  res.json({ keep: keep.id, merged });
});

tasksRouter.get('/:id', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  res.json({
    ...task,
    ...taskSchedule(task),
    events: eventsForTask(task.id),
    subtasks: subtasksFor(task.id),
    updates: updatesFor(task.id),
    stages: knownStages(),
    blockers: blockersOf(task.id),
    blocking: blockedBy(task.id),
    attachments: attachmentsFor(task.id),
  });
});

/* ---------------- a task's reminders ---------------- */

tasksRouter.get('/:id/reminders', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  res.json({ reminders: remindersForTask(task.id) });
});

tasksRouter.post('/:id/reminders', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  try {
    const reminder = scheduleCustomReminder(
      task.id,
      normalizeInstant(req.body?.fire_at),
      req.body?.offset_minutes ?? null
    );
    syncNextReminder(task.id);
    res.status(201).json({ reminder, reminders: remindersForTask(task.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

tasksRouter.delete('/:id/reminders/:reminderId', (req, res) => {
  const reminder = getReminder(Number(req.params.reminderId));
  if (!reminder || reminder.task_id !== Number(req.params.id)) {
    return res.status(404).json({ error: 'not found' });
  }
  cancelReminder(reminder.id);
  syncNextReminder(reminder.task_id);
  res.json({ reminders: remindersForTask(reminder.task_id) });
});

tasksRouter.patch('/:id', (req, res) => {
  const patch = { ...(req.body || {}) };
  if ('due_date' in patch) patch.due_date = normalizeDueDate(patch.due_date);
  if ('due_at' in patch) patch.due_at = normalizeInstant(patch.due_at);
  if ('remind_at' in patch) patch.remind_at = normalizeInstant(patch.remind_at);

  const before = getTask(Number(req.params.id));

  /*
   * Filing a task under a business.
   *
   * Checked here rather than left to the foreign key, because the key's
   * failure is a bare 500 and the caller cannot tell a missing group from a
   * broken server. A group deleted while its menu was open is the ordinary way
   * to reach this.
   */
  if ('group_id' in patch && patch.group_id !== null && patch.group_id !== '') {
    if (!getGroup(Number(patch.group_id))) {
      return res.status(400).json({ error: 'that group no longer exists' });
    }
  }

  const task = updateTask(Number(req.params.id), patch);
  if (!task) return res.status(404).json({ error: 'not found' });

  if ('group_id' in patch && (task.group_id ?? null) !== (before?.group_id ?? null)) {
    recordEvent(task.id, EVENT.filed, task.group_name || 'no group');
  }

  // Every change worth looking back at is recorded before anything is rescheduled.
  if (patch.status && before && patch.status !== before.status) {
    recordEvent(task.id, EVENT.statusChanged, `${before.status} → ${patch.status}`,
      patch.status === 'waiting' && task.waiting_for ? { waiting_for: task.waiting_for } : null);
  }
  if ('notes' in patch && (patch.notes || '') !== (before?.notes || '')) {
    recordEvent(task.id, EVENT.noteAdded, patch.notes ? String(patch.notes).slice(0, 120) : 'cleared');
  }
  if (('title' in patch || 'description' in patch || 'priority' in patch) && before) {
    recordEvent(task.id, EVENT.edited, Object.keys(patch).join(', '));
  }
  if (task.status !== 'done' && before?.status === 'done') {
    recordEvent(task.id, EVENT.reopened);
  }

  // Finishing a task retires everything still scheduled for it.
  let unblocked = [];
  if (task.status === 'done' && before?.status !== 'done') {
    // Read before completing: once this one is done it is no longer a blocker,
    // so afterwards there would be nothing left to attribute the change to.
    unblocked = unblockedBy(task.id);
    completeTask(task.id);
    for (const freed of unblocked) {
      recordEvent(freed.id, EVENT.edited, `unblocked — "${task.title}" is done`);
    }
  } else if ('due_date' in patch || 'due_at' in patch) {
    // A new deadline restarts the whole cycle from that moment.
    rescheduleTask(task.id, { due_date: task.due_date, due_at: task.due_at });
  } else if (task.status !== 'done') {
    planTask(task);
  }
  const fresh = getTask(task.id);
  res.json({
    ...fresh,
    ...taskSchedule(fresh),
    events: eventsForTask(fresh.id),
    // So the dashboard can say "that freed up two other tasks" rather than
    // leaving the effect of finishing this one invisible.
    unblocked,
  });
});

/* ---------------- tidying up the titles already on the list ---------------- */

/**
 * What a tidy-up would change, without changing anything.
 *
 * Costs one API call, so it is a button rather than something that happens on
 * its own, and it only ever proposes: the rewrites come back for a look before
 * any of them are applied. A title is the thing read back for weeks, and a
 * model quietly rewriting one into something the person does not recognise is
 * worse than the typo it fixed.
 */
tasksRouter.post('/tidy/preview', async (req, res) => {
  const open = listTasks({ status: 'pending', limit: 200, includeSetAside: true })
    .map((t) => {
      /*
       * A title that names only a person cannot be fixed from itself: what the
       * conversation was about is in the message it came from, and nowhere
       * else. Sent only for those, so the button costs what it did before for
       * every title that is merely misspelt.
       */
      const vague = !subjectWords(t.title, t.contact).length;
      return {
        id: t.id,
        title: t.title,
        // Already on the row: every task carries the one message it came from.
        source_message: vague ? t.source_message || null : null,
      };
    });
  if (!open.length) return res.json({ proposals: [], considered: 0 });

  try {
    res.json({ proposals: await tidyTitles(open), considered: open.length });
  } catch (err) {
    res.status(503).json({ error: 'Could not reach Claude to tidy the titles.' });
  }
});

/** Apply the ones that were accepted, and only those. */
tasksRouter.post('/tidy/apply', (req, res) => {
  const wanted = Array.isArray(req.body?.titles) ? req.body.titles : [];
  const applied = [];

  for (const row of wanted.slice(0, 200)) {
    const id = Number(row?.id);
    const title = String(row?.title || '').trim().slice(0, 200);
    if (!Number.isInteger(id) || !title) continue;

    const before = getTask(id);
    if (!before || before.title === title) continue;
    updateTask(id, { title });
    // The old wording is kept, because a rename you cannot see is a rename you
    // cannot undo.
    recordEvent(id, EVENT.edited, `title tidied — was "${before.title.slice(0, 90)}"`);
    applied.push(id);
  }
  res.json({ applied });
});

/* ---------------- tasks the extractor was unsure about ---------------- */

/** "Yes, this is real." It becomes an ordinary task and enters the ladder. */
tasksRouter.post('/:id/confirm', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  if (!task.needs_confirmation) {
    return res.json({ ...task, ...taskSchedule(task) });
  }
  updateTask(task.id, { needs_confirmation: 0 });
  const fresh = getTask(task.id);
  recordEvent(fresh.id, EVENT.edited, 'confirmed as a real task');
  planTask(fresh);
  const planned = getTask(fresh.id);
  res.json({ ...planned, ...taskSchedule(planned) });
});

/**
 * "No, that was not a task." Archived rather than deleted: what the extractor
 * got wrong is worth being able to look back at, and archiving already removes
 * it from every active view.
 */
/**
 * "This is not a task."
 *
 * Reachable from any task, not only the ones the extractor asked about. An
 * ambient reader produces a lot of near-misses — a sales pitch, a price
 * enquiry, somebody's small talk — and the list is only worth reading if
 * throwing one out is as quick as ticking one off.
 *
 * Archived rather than deleted, so what the extractor got wrong stays visible
 * in Work History. The reminders go first: without that this would take the
 * task off the list and carry on chasing it, which was true of every archived
 * task until now.
 */
tasksRouter.post('/:id/reject', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });

  cancelRemindersForTask(task.id);
  updateTask(task.id, { archived_at: new Date().toISOString(), needs_confirmation: 0 });
  recordEvent(task.id, EVENT.archived, 'not a task');
  res.json({ ok: true, id: task.id, title: task.title });
});

/* ---------------- acting on a fired reminder ---------------- */

tasksRouter.post('/reminders/:reminderId/snooze', (req, res) => {
  const minutes = Number(req.body?.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return res.status(400).json({ error: 'minutes must be a positive number' });
  }
  const reminder = snoozeReminder(Number(req.params.reminderId), minutes);
  if (!reminder) return res.status(404).json({ error: 'not found' });
  recordEvent(reminder.task_id, EVENT.reminderSnoozed, `until ${reminder.fire_at}`);
  syncNextReminder(reminder.task_id);
  res.json({ reminder });
});

tasksRouter.post('/reminders/:reminderId/acknowledge', (req, res) => {
  const reminder = acknowledgeReminder(Number(req.params.reminderId));
  if (!reminder) return res.status(404).json({ error: 'not found' });
  syncNextReminder(reminder.task_id);
  res.json({ reminder });
});

/** Moving a task's deadline, which restarts its reminder and follow-up cycle. */
tasksRouter.post('/:id/reschedule', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  try {
    const updated = rescheduleTask(task.id, {
      due_date: normalizeDueDate(req.body?.due_date),
      due_at: normalizeInstant(req.body?.due_at),
    });
    res.json({ ...updated, ...taskSchedule(updated) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Archive rather than delete. A completed task is a record of work done, and
 * losing it to a stray tap is not recoverable - `?hard=1` still does the old
 * thing for anyone who genuinely wants the row gone.
 */
tasksRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const task = getTask(id);
  if (!task) return res.status(404).json({ error: 'not found' });

  if (req.query.hard === '1') {
    deleteTask(id);
    return res.status(204).end();
  }

  completeTask(id);
  updateTask(id, { archived_at: new Date().toISOString() });
  recordEvent(id, EVENT.archived);
  res.json({ archived: true, id });
});

tasksRouter.post('/:id/restore', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  updateTask(task.id, { archived_at: '' });
  recordEvent(task.id, EVENT.statusChanged, 'restored from archive');
  const fresh = getTask(task.id);
  res.json({ ...fresh, ...taskSchedule(fresh) });
});
