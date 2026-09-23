import { Router } from 'express';
import { getTask, listTasks, findChats } from '../db.js';
import {
  delegates, requesters, delegationCounts, assignTask, followUpText, handoverText,
  directionOf, listStaff, addStaff, removeStaff,
} from '../assignment.js';
import { EVENT, recordEvent, lastActivityFor } from '../task-events.js';
import { taskSchedule } from '../task-lifecycle.js';
import { getSettings, nextRemindersFor } from '../scheduling.js';
import { sendMessage, resolveSendable, state as waState } from '../whatsapp.js';
import { chatForAssignee } from '../assignee-nudge.js';
import { log } from '../logger.js';

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
  const ids = rows.map((t) => t.id);
  const next = nextRemindersFor(ids);
  // For work in somebody else's hands, "when did anything last move" is the
  // question — a task given three days ago with nothing since is the one to
  // chase, and the deadline alone does not say that.
  const activity = lastActivityFor(ids);
  return rows.map((task) => ({
    ...task,
    ...taskSchedule(task, settings, { next: next.get(task.id) || {} }),
    direction: directionOf(task),
    last_activity: activity.get(task.id) || null,
  }));
};

/** Everything with another person's name on it, either way round. */
delegationRouter.get('/', (req, res) => {
  // "all" includes finished work, for the same reason the task list offers it.
  const all = req.query.status === 'all';
  /*
   * Set-aside work is included here, unlike everywhere else.
   *
   * "Who owes me what" is a different question from "what is on my list
   * today", and it is the only question this page asks. A vacancy handed to a
   * recruiter is still with that recruiter — and since most of what gets handed
   * over here is recruitment, excluding it emptied the page of very nearly
   * every automatic delegation. The sidebar badge counted them (its own query
   * has no such filter) while the page did not, which is how the two came to
   * disagree: 2 against 1.
   */
  const rows = listTasks({
    status: all ? undefined : 'pending',
    limit: 500,
    includeSetAside: true,
  });
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
delegationRouter.get('/tasks/:id/nudge', async (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  if (!task.assigned_to) return res.status(400).json({ error: 'this task is not assigned to anybody' });
  /*
   * The chat comes from `chatForAssignee`, not from the task's own column.
   *
   * Reported as "unable to send msg", and the dead end was worse than it
   * looked. A task given by typing a name carries no wid, so the button said
   * "no WhatsApp chat is known for Nidhi" - and putting her number on the
   * Staff list afterwards did not help, because this route never read it.
   * Nothing would have, ever: the wid is copied onto the task when the work is
   * handed over, so a number learnt later could not reach a task already
   * given. Meanwhile the automatic reminder resolved through the staff list
   * happily, so the app could message her on its own while the button a person
   * pressed could not. One rule for both now, and it is the engine's.
   */
  const wid = chatForAssignee(task);
  /*
   * And the chat is checked here, not only on the press.
   *
   * A Send button that is enabled and then fails is worse than one that was
   * never offered: the message looks sent. So if WhatsApp will not take this
   * chat, the sheet says so with the reason while there is still something to
   * do about it.
   */
  const target = wid && waState.status === 'ready' ? await resolveSendable(wid) : null;
  res.json({
    to: task.assigned_to,
    wid,
    text: followUpText(task),
    handover: handoverText(task),
    // The button is honest about being unable to send when it cannot.
    can_send: Boolean(target?.ok),
    connected: waState.status === 'ready',
    problem: wid && target && !target.ok ? target.reason : null,
  });
});

/**
 * Chats this app has seen, to answer "which Nidhi?".
 *
 * Only ever reached from the picker below, and it hands back names and numbers
 * of one-to-one chats - never a group, never a message body, and never a chat
 * this app has not actually seen. See `findChats`.
 */
delegationRouter.get('/chats', (req, res) => {
  res.json({ chats: findChats(req.query.q, 8) });
});

/**
 * Say which chat a person is, once, and mean it everywhere.
 *
 * It writes to the task *and* to the staff list, deliberately: the task so
 * this nudge can go now, the list so every other task of theirs - and the
 * automatic reminder, which reads the same list - knows it too. Answering the
 * question twice for the same person is how it stops being answered.
 */
delegationRouter.post('/tasks/:id/chat', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  if (!task.assigned_to) return res.status(400).json({ error: 'this task is not assigned to anybody' });

  const wid = String(req.body?.wid ?? '').trim();
  /*
   * Either a chat id this app has seen, or a plain number typed by hand.
   * A group is refused outright - a nudge names one person and says what they
   * owe; sending that to twenty people is a different act entirely.
   */
  if (wid.endsWith('@g.us')) return res.status(400).json({ error: 'a nudge cannot go to a group' });
  const digits = wid.replace(/\D/g, '');
  const picked = wid.includes('@')
    ? wid
    : (digits.length >= 8 && digits.length <= 15 ? `${digits}@c.us` : null);
  if (!picked) return res.status(400).json({ error: 'that does not look like a WhatsApp number' });

  assignTask(task.id, task.assigned_to, picked);
  addStaff(task.assigned_to, { wid: picked, number: digits || null });
  res.json({ ...getTask(task.id), wid: picked });
});

/**
 * The one door out of this file, used by both messages it can send.
 *
 * Nothing else in the app reaches it: no cron, no reminder pass, no extractor.
 * A person presses a button, one message goes to one person they chose, and it
 * is recorded on the task. Two callers - the nudge and the handover - because
 * a second copy of the resolve-and-send steps is a second place for the rails
 * to drift out of line.
 */
async function messageAssignee(task, text, kind) {
  const chat = chatForAssignee(task);
  if (!chat) return { ok: false, status: 400, error: 'no WhatsApp chat is known for this person' };

  const target = await resolveSendable(chat);
  if (!target.ok) {
    log.warn(`Message to ${task.assigned_to} (${chat}) not sent: ${target.reason}`);
    return { ok: false, status: 400, error: target.reason };
  }
  if (target.corrected) {
    assignTask(task.id, task.assigned_to, target.wid);
    addStaff(task.assigned_to, { wid: target.wid });
    log.info(`Corrected ${task.assigned_to}'s chat: ${chat} -> ${target.wid}`);
  }

  try {
    await sendMessage(target.wid, text);
  } catch (err) {
    log.error(`Message to ${task.assigned_to} (${target.wid}) failed:`, err?.message || err);
    return {
      ok: false,
      status: 503,
      error: `WhatsApp refused to send that: ${String(err?.message || err).slice(0, 200)}`,
    };
  }
  recordEvent(task.id, kind, task.assigned_to, { text });
  return { ok: true };
}

/**
 * Chase somebody about work already given to them.
 */
delegationRouter.post('/tasks/:id/nudge', async (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  if (!task.assigned_to) return res.status(400).json({ error: 'this task is not assigned to anybody' });

  const text = String(req.body?.text || followUpText(task)).slice(0, 1000);
  const out = await messageAssignee(task, text, EVENT.nudgeSent);
  if (!out.ok) return res.status(out.status).json({ error: out.error });
  res.json({ sent: true, to: task.assigned_to, text });
});

/**
 * Tell somebody, once, that a job is now theirs.
 *
 * Asked as "muje koi task dena he to direct app se de sakta hu - task me bhi
 * add ho jayega and msg bhi chala jayega". Handing work over in the app used
 * to tell nobody: the task existed, the deadline was set, and the first the
 * person heard of it was the reminder on the day it fell due.
 *
 * Same door, same rails, and still a press - the checkbox on the Give sheet.
 * What differs is the event it writes: a handover is not a chase, and filing
 * it as one would spend one of the two automatic follow-ups before anybody
 * had been chased at all.
 */
delegationRouter.post('/tasks/:id/handover', async (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  if (!task.assigned_to) return res.status(400).json({ error: 'this task is not assigned to anybody' });

  const text = String(req.body?.text || handoverText(task)).slice(0, 1000);
  const out = await messageAssignee(task, text, EVENT.handoverSent);
  if (!out.ok) return res.status(out.status).json({ error: out.error });
  res.json({ sent: true, to: task.assigned_to, text });
});

/*
 * Marking one of these done is deliberately not a route here. PATCH
 * /api/tasks/:id already does it and, more to the point, cancels the reminders
 * that are still scheduled behind it. A second way in would be a second way to
 * get that wrong.
 */

/* ---------------- the staff list ---------------- */

/**
 * The people work can be handed to.
 *
 * Separate from `GET /` on purpose: that answers "who holds what", which is
 * about tasks, and this answers "who is there to give work to", which is not.
 * A person on this list who holds nothing is still an answer to the second.
 */
delegationRouter.get('/staff', (req, res) => {
  res.json({ staff: listStaff() });
});

delegationRouter.post('/staff', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'a name is required' });
  /*
   * A number is optional and is only ever used for the Nudge button — the one
   * place in the app a message can reach anybody but the user, and only when a
   * person presses it. Storing it here sends nothing.
   */
  const number = String(req.body?.number ?? '').replace(/\D/g, '').slice(0, 15) || null;
  res.status(201).json({ person: addStaff(name, { number, wid: number ? `${number}@c.us` : null }) });
});

delegationRouter.delete('/staff/:id', (req, res) => {
  /*
   * Their work is untouched. A delete that silently un-assigned six tasks would
   * be a very expensive way to tidy up a list, so this only stops the name being
   * offered — if they still hold something, the page goes on showing them
   * because the tasks say so.
   */
  const gone = removeStaff(req.params.id);
  if (!gone) return res.status(404).json({ error: 'not found' });
  res.json({ removed: true });
});
