import { Router } from 'express';
import { getTask, listTasks } from '../db.js';
import {
  delegates, requesters, delegationCounts, assignTask, followUpText, directionOf,
} from '../assignment.js';
import { EVENT, recordEvent } from '../task-events.js';
import { taskSchedule } from '../task-lifecycle.js';
import { getSettings, nextRemindersFor } from '../scheduling.js';
import { sendMessage, state as waState } from '../whatsapp.js';

/**
 * Work between the user and other people.
 *
 * Two lists that mirror each other: what he was given (`requested_by`), and what
 * he gave out (`assigned_to`). Both are ordinary tasks - same table, same
 * lifecycle, same reminder ladder - so nothing here re-implements a task; it
 * only reads them along a different axis.
 *
 * The rule that constrains every route in this file: **the app never messages
 * anybody but the user on its own.** Reminders and follow-ups for a delegated
 * task tell the *user* that somebody owes him something. A message to the
 * assignee happens only through POST /nudge, only when a person presses the
 * button, and only one message per press.
 */
export const delegationRouter = Router();

const decorate = (rows) => {
  const settings = getSettings();
  const next = nextRemindersFor(rows.map((t) => t.id));
  return rows.map((task) => ({
    ...task,
    ...taskSchedule(task, settings, { next: next.get(task.id) || {} }),
    direction: directionOf(task),
  }));
};

/** Everything with another person's name on it, either way round. */
delegationRouter.get('/', (req, res) => {
  // "all" includes finished work, for the same reason the task list offers it.
  const all = req.query.status === 'all';
  const rows = listTasks({ status: all ? undefined : 'pending', limit: 500 });
  const allotted = decorate(rows.filter((t) => t.assigned_to));
  const received = decorate(rows.filter((t) => t.requested_by && !t.assigned_to));

  res.json({
    allotted,
    received,
    // Who is on each side, so the page can be read as people rather than rows.
    people: { allotted: delegates(), received: requesters() },
    counts: delegationCounts(),
  });
});

/** Just the two numbers, for the sidebar. Cheap enough to poll. */
delegationRouter.get('/counts', (req, res) => res.json(delegationCounts()));

/**
 * Give a task to somebody, or take it back.
 *
 * Naming nobody hands it back to the user, which is what a task looked like
 * before it was ever delegated - so undoing is the same operation, not a
 * separate one.
 */
delegationRouter.post('/tasks/:id/assign', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });

  const { name, wid } = req.body || {};
  const assigned = assignTask(task.id, name, wid);

  if (assigned && assigned !== task.assigned_to) {
    recordEvent(task.id, EVENT.assigned, assigned);
  } else if (!assigned && task.assigned_to) {
    recordEvent(task.id, EVENT.unassigned, task.assigned_to);
  }

  const fresh = getTask(task.id);
  res.json({ ...fresh, ...taskSchedule(fresh), direction: directionOf(fresh) });
});

/**
 * What a nudge would say. Shown before sending, and the same string that is
 * sent - a preview that differs from the message would be a lie.
 */
delegationRouter.get('/tasks/:id/nudge', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  if (!task.assigned_to) return res.status(400).json({ error: 'this task is not assigned to anybody' });
  res.json({
    to: task.assigned_to,
    wid: task.assigned_to_wid,
    text: followUpText(task),
    // The button is honest about being unable to send when it cannot.
    can_send: Boolean(task.assigned_to_wid) && waState.status === 'ready',
  });
});

/**
 * Send that nudge. Nothing else in the app can reach this code path: no cron,
 * no reminder pass, no extractor. One press, one message, to one person the
 * user chose - and it is recorded on the task so the history shows who was
 * chased and when.
 */
delegationRouter.post('/tasks/:id/nudge', async (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  if (!task.assigned_to) return res.status(400).json({ error: 'this task is not assigned to anybody' });
  if (!task.assigned_to_wid) {
    return res.status(400).json({ error: 'no WhatsApp chat is known for this person' });
  }

  const text = String(req.body?.text || followUpText(task)).slice(0, 1000);
  try {
    await sendMessage(task.assigned_to_wid, text);
  } catch (err) {
    return res.status(503).json({ error: 'WhatsApp could not send that right now' });
  }
  recordEvent(task.id, EVENT.nudgeSent, task.assigned_to, { text });
  res.json({ sent: true, to: task.assigned_to, text });
});

/*
 * Marking one of these done is deliberately not a route here. PATCH
 * /api/tasks/:id already does it and, more to the point, cancels the reminders
 * that are still scheduled behind it. A second way in would be a second way to
 * get that wrong.
 */
