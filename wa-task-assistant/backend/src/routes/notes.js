import { Router } from 'express';
import {
  listNotes, getNote, createNote, updateNote, archiveNote, restoreNote, deleteNote,
  noteEvents, tagCounts, tasksFromNote, NOTE_EVENT, recordNoteEvent,
} from '../notes.js';
import { createTask } from '../db.js';
import { getGroup } from '../groups.js';
import { normalizeDueDate, normalizeInstant } from '../dates.js';
import { EVENT, recordEvent } from '../task-events.js';
import { planTask } from '../task-lifecycle.js';

export const notesRouter = Router();

/**
 * Notes are the account's own. Every route here sits behind the same password
 * as the rest of the API, and nothing a note holds is ever sent to a contact:
 * a note's reminder goes to the linked account's own chat, like every other
 * message this app sends.
 */

notesRouter.get('/', (req, res) => {
  const notes = listNotes({
    archived: req.query.archived === '1',
    groupId: req.query.group_id || null,
    tag: req.query.tag || null,
    withReminder: req.query.reminder === '1',
  });
  res.json({
    notes,
    tags: tagCounts(),
    archived_count: listNotes({ archived: true }).length,
  });
});

notesRouter.get('/:id', (req, res) => {
  const note = getNote(Number(req.params.id));
  if (!note) return res.status(404).json({ error: 'not found' });
  res.json({ note, events: noteEvents(note.id), tasks: tasksFromNote(note.id) });
});

notesRouter.post('/', (req, res) => {
  try {
    const body = req.body || {};
    if (body.group_id && !getGroup(Number(body.group_id))) {
      return res.status(400).json({ error: 'that group no longer exists' });
    }
    const note = createNote({ ...body, remind_at: normalizeInstant(body.remind_at) });
    res.status(201).json({ note });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

notesRouter.patch('/:id', (req, res) => {
  const body = req.body || {};
  if (body.group_id && !getGroup(Number(body.group_id))) {
    return res.status(400).json({ error: 'that group no longer exists' });
  }
  const patch = { ...body };
  if ('remind_at' in patch) patch.remind_at = normalizeInstant(patch.remind_at);

  const note = updateNote(Number(req.params.id), patch);
  if (!note) return res.status(404).json({ error: 'not found' });
  res.json({ note });
});

/** Archive by default; `?hard=1` really removes it. */
notesRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!getNote(id)) return res.status(404).json({ error: 'not found' });

  if (req.query.hard === '1') {
    deleteNote(id);
    return res.json({ deleted: true });
  }
  res.json({ note: archiveNote(id) });
});

notesRouter.post('/:id/restore', (req, res) => {
  const note = restoreNote(Number(req.params.id));
  if (!note) return res.status(404).json({ error: 'not found' });
  res.json({ note });
});

/**
 * The one place a note becomes work.
 *
 * Pressed by a person, never inferred: the note stays exactly as it is, and
 * what comes out is an ordinary task - same table, same deadline, same
 * reminder ladder, same history - carrying a line back to where it came from.
 */
notesRouter.post('/:id/task', (req, res) => {
  const note = getNote(Number(req.params.id));
  if (!note) return res.status(404).json({ error: 'not found' });

  const body = req.body || {};
  const title = String(body.title || note.title || '').trim();
  if (!title) return res.status(400).json({ error: 'the task needs a title' });

  try {
    const task = createTask({
      title,
      // The note's text is the task's description, so opening the task shows
      // what it was about without going back for the note.
      description: body.description ?? (note.body ? note.body.slice(0, 1000) : null),
      priority: body.priority,
      due_date: normalizeDueDate(body.due_date),
      due_at: normalizeInstant(body.due_at),
      group_id: body.group_id ?? note.group_id ?? null,
      note_id: note.id,
      source: 'manual',
      origin: 'manual',
    });

    recordEvent(task.id, EVENT.created, 'from a note');
    if (task.due_at || task.due_date) recordEvent(task.id, EVENT.deadlineSet, task.due_at || task.due_date);
    planTask(task, {
      reminderOffset: body.reminder_offset === undefined ? undefined : Number(body.reminder_offset),
      followUpOffset: body.follow_up_offset === undefined ? undefined : Number(body.follow_up_offset),
    });
    recordNoteEvent(note.id, NOTE_EVENT.taskCreated, title);

    res.status(201).json({ task, note: getNote(note.id), tasks: tasksFromNote(note.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
