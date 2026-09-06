/** How a task's derived state reads, and the actions offered against it. */
export const TASK_STATE = {
  open: { label: 'Open', tone: 'plain' },
  in_progress: { label: 'In progress', tone: 'info' },
  due: { label: 'Due', tone: 'warn' },
  overdue: { label: 'Overdue', tone: 'danger' },
  done: { label: 'Done', tone: 'ok' },
};

export const REMINDER_OFFSETS = [
  { key: 0, label: 'At the due time' },
  { key: 15, label: '15 min before' },
  { key: 30, label: '30 min before' },
  { key: 60, label: '1 hour before' },
  { key: 120, label: '2 hours before' },
  { key: 1440, label: '1 day before' },
];

export const SNOOZE_OPTIONS = [
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 180, label: '3 hours' },
  { minutes: 60 * 24, label: 'Tomorrow' },
];

const MIN = 60_000;

/** "Due 30 min ago", "Due in 2 hours", "Due tomorrow". */
export function dueLabel(dueAt) {
  if (!dueAt) return null;
  const diff = Date.parse(dueAt) - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / MIN);

  const amount =
    mins < 60 ? `${mins} min`
      : abs < 36 * 60 * MIN ? `${Math.round(mins / 60)} hour${Math.round(mins / 60) === 1 ? '' : 's'}`
        : `${Math.round(mins / (60 * 24))} days`;

  return diff < 0 ? `Due ${amount} ago` : `Due in ${amount}`;
}

export const clock = (iso) =>
  iso
    ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : null;

/** Tasks the app is currently chasing: past the deadline, or given up on. */
export const needsAttention = (tasks) =>
  tasks
    .filter((t) => t.status !== 'done' && (['due', 'overdue'].includes(t.state) || t.needs_attention))
    .sort((a, b) => (a.due_at || '').localeCompare(b.due_at || ''));
