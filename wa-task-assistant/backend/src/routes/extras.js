import { Router } from 'express';
import express from 'express';
import { getTask, createTask } from '../db.js';
import { normalizeDueDate, normalizeInstant } from '../dates.js';
import {
  subtasksFor, addSubtask, updateSubtask, deleteSubtask, reorderSubtasks, addSubtasks,
} from '../subtasks.js';
import {
  blockersOf, blockedBy, addDependency, removeDependency,
} from '../dependencies.js';
import {
  listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate,
  noteTemplateUsed, taskFromTemplate,
} from '../templates.js';
import {
  attachmentsFor, addAttachment, readAttachment, deleteAttachment, storageState,
} from '../attachments.js';
import {
  listGroups, getGroup, createGroup, updateGroup, deleteGroup, reorderGroups,
  groupCounts, applyGroupToExisting, COLOURS,
} from '../groups.js';
import { EVENT, recordEvent } from '../task-events.js';
import { planTask, taskSchedule } from '../task-lifecycle.js';

/* ---------------- checklists ---------------- */

export const subtaskRouter = Router({ mergeParams: true });

const requireTask = (req, res, next) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  req.task = task;
  next();
};

subtaskRouter.get('/:id/subtasks', requireTask, (req, res) => {
  res.json({ subtasks: subtasksFor(req.task.id) });
});

subtaskRouter.post('/:id/subtasks', requireTask, (req, res) => {
  try {
    const subtask = addSubtask(req.task.id, req.body?.title);
    recordEvent(req.task.id, EVENT.edited, `checklist item added: ${subtask.title}`);
    res.status(201).json({ subtask, subtasks: subtasksFor(req.task.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

subtaskRouter.patch('/:id/subtasks/:subtaskId', requireTask, (req, res) => {
  try {
    const subtask = updateSubtask(Number(req.params.subtaskId), req.body || {});
    if (!subtask) return res.status(404).json({ error: 'not found' });
    res.json({ subtask, subtasks: subtasksFor(req.task.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

subtaskRouter.delete('/:id/subtasks/:subtaskId', requireTask, (req, res) => {
  if (!deleteSubtask(Number(req.params.subtaskId))) return res.status(404).json({ error: 'not found' });
  res.json({ subtasks: subtasksFor(req.task.id) });
});

subtaskRouter.post('/:id/subtasks/reorder', requireTask, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  res.json({ subtasks: reorderSubtasks(req.task.id, ids) });
});

/* ---------------- dependencies ---------------- */

subtaskRouter.get('/:id/dependencies', requireTask, (req, res) => {
  res.json({ blockers: blockersOf(req.task.id), blocking: blockedBy(req.task.id) });
});

subtaskRouter.post('/:id/dependencies', requireTask, (req, res) => {
  try {
    const blockers = addDependency(req.task.id, Number(req.body?.depends_on_id));
    const blocker = blockers.find((b) => b.id === Number(req.body?.depends_on_id));
    recordEvent(req.task.id, EVENT.edited, `now waits on: ${blocker?.title || req.body?.depends_on_id}`);
    res.status(201).json({ blockers, blocking: blockedBy(req.task.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

subtaskRouter.delete('/:id/dependencies/:blockerId', requireTask, (req, res) => {
  removeDependency(req.task.id, Number(req.params.blockerId));
  res.json({ blockers: blockersOf(req.task.id), blocking: blockedBy(req.task.id) });
});

/* ---------------- attachments ---------------- */

/**
 * Raw body rather than multipart: a single file per request needs no boundary
 * parsing and no extra dependency. The browser sends the bytes, and the name
 * and type ride along as query parameters.
 */
const rawFile = express.raw({ type: () => true, limit: '11mb' });

subtaskRouter.get('/:id/attachments', requireTask, (req, res) => {
  res.json({ attachments: attachmentsFor(req.task.id), storage: storageState() });
});

subtaskRouter.post('/:id/attachments', requireTask, rawFile, (req, res) => {
  try {
    const attachment = addAttachment(req.task.id, {
      filename: req.query.filename,
      mime: req.query.type || req.get('content-type'),
      buffer: req.body,
    });
    recordEvent(req.task.id, EVENT.edited, `file attached: ${attachment.filename}`);
    res.status(201).json({ attachment, attachments: attachmentsFor(req.task.id), storage: storageState() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export const attachmentRouter = Router();

attachmentRouter.get('/:attachmentId', (req, res) => {
  const file = readAttachment(Number(req.params.attachmentId));
  if (!file) return res.status(404).json({ error: 'not found' });
  if (file.missing) return res.status(410).json({ error: 'the file is no longer on disk' });

  const disposition = file.inline ? 'inline' : 'attachment';
  // The name is quoted and percent-encoded so a comma or a quote in it cannot
  // break the header, and non-ASCII names survive via the RFC 5987 form.
  const ascii = file.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  res.set('Content-Type', file.mime);
  res.set(
    'Content-Disposition',
    `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`
  );
  res.set('Content-Length', String(file.bytes));
  res.send(file.buffer);
});

attachmentRouter.delete('/:attachmentId', (req, res) => {
  if (!deleteAttachment(Number(req.params.attachmentId))) return res.status(404).json({ error: 'not found' });
  res.json({ storage: storageState() });
});

/* ---------------- templates ---------------- */

export const templateRouter = Router();

templateRouter.get('/', (req, res) => {
  res.json({ templates: listTemplates() });
});

templateRouter.post('/', (req, res) => {
  try {
    res.status(201).json({ template: createTemplate(req.body || {}) });
  } catch (err) {
    const conflict = /UNIQUE/.test(err.message);
    res.status(400).json({ error: conflict ? 'a template with that name already exists' : err.message });
  }
});

templateRouter.patch('/:id', (req, res) => {
  try {
    const template = updateTemplate(Number(req.params.id), req.body || {});
    if (!template) return res.status(404).json({ error: 'not found' });
    res.json({ template });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

templateRouter.delete('/:id', (req, res) => {
  if (!deleteTemplate(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.json({ templates: listTemplates() });
});

/**
 * Using a template produces an ordinary task, so the reminder ladder, the
 * history and the briefing all treat it as one - there is no second kind of
 * task in the system.
 */
templateRouter.post('/:id/use', (req, res) => {
  const template = getTemplate(Number(req.params.id));
  if (!template) return res.status(404).json({ error: 'not found' });

  const overrides = req.body || {};
  const draft = taskFromTemplate(template, {
    ...(overrides.title ? { title: String(overrides.title) } : {}),
    ...(overrides.due_date !== undefined ? { due_date: normalizeDueDate(overrides.due_date) } : {}),
    ...(overrides.due_at !== undefined ? { due_at: normalizeInstant(overrides.due_at) } : {}),
    ...(overrides.priority ? { priority: overrides.priority } : {}),
  });

  const task = createTask({
    title: draft.title,
    description: draft.description,
    priority: draft.priority,
    due_date: draft.due_date,
    due_at: draft.due_at,
    source: 'manual',
    origin: 'manual',
    status: 'open',
  });

  recordEvent(task.id, EVENT.created, `from template "${template.name}"`);
  if (task.due_at || task.due_date) {
    recordEvent(task.id, EVENT.deadlineSet, task.due_at || task.due_date);
  }
  if (template.subtasks.length) addSubtasks(task.id, template.subtasks);

  planTask(task, {
    reminderOffset: Number.isFinite(draft.reminder_offset) ? draft.reminder_offset : undefined,
    followUpOffset: Number.isFinite(draft.follow_up_offset) ? draft.follow_up_offset : undefined,
  });
  noteTemplateUsed(template.id);

  const fresh = getTask(task.id);
  res.status(201).json({
    ...fresh,
    ...taskSchedule(fresh),
    subtasks: subtasksFor(task.id),
  });
});


/* ---------------- groups ---------------- */

export const groupRouter = Router();

groupRouter.get('/', (req, res) => {
  const counts = groupCounts();
  res.json({
    groups: listGroups().map((g) => ({ ...g, counts: counts.get(g.id) || { open: 0, total: 0 } })),
    colours: COLOURS,
  });
});

groupRouter.post('/', (req, res) => {
  try {
    res.status(201).json({ group: createGroup(req.body || {}) });
  } catch (err) {
    const conflict = /UNIQUE/i.test(err.message);
    res.status(400).json({ error: conflict ? 'a group with that name already exists' : err.message });
  }
});

groupRouter.patch('/:id', (req, res) => {
  try {
    const group = updateGroup(Number(req.params.id), req.body || {});
    if (!group) return res.status(404).json({ error: 'not found' });
    res.json({ group });
  } catch (err) {
    const conflict = /UNIQUE/i.test(err.message);
    res.status(400).json({ error: conflict ? 'a group with that name already exists' : err.message });
  }
});

/** Deleting a group leaves its tasks alone; they simply stop being grouped. */
groupRouter.delete('/:id', (req, res) => {
  if (!deleteGroup(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.json({ groups: listGroups() });
});

groupRouter.post('/reorder', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  res.json({ groups: reorderGroups(ids) });
});

/**
 * Apply the keyword rules to work that already exists, so making a group after
 * the fact does not mean re-filing everything by hand.
 */
groupRouter.post('/:id/apply', (req, res) => {
  const result = applyGroupToExisting(Number(req.params.id));
  if (!result.group) return res.status(404).json({ error: 'not found' });
  for (const id of result.ids) {
    recordEvent(id, EVENT.edited, `grouped under ${result.group.name}`);
  }
  res.json({ moved: result.moved, group: result.group });
});
