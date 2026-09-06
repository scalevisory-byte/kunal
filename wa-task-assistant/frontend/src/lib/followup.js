const dayMs = 86400000;

export const FU_STATUS = {
  waiting: { label: 'Waiting', tone: 'plain' },
  due: { label: 'Due', tone: 'warn' },
  overdue: { label: 'Overdue', tone: 'danger' },
  snoozed: { label: 'Snoozed', tone: 'plain' },
  needs_attention: { label: 'Needs attention', tone: 'danger' },
  completed: { label: 'Completed', tone: 'ok' },
  cancelled: { label: 'Cancelled', tone: 'plain' },
};

export const isOpenFollowUp = (f) =>
  !['completed', 'cancelled'].includes(f.status);

/** How late or how soon, in words. */
export function whenLabel(dueAt) {
  if (!dueAt) return null;
  const diff = Date.parse(dueAt) - Date.now();
  const days = Math.round(diff / dayMs);
  if (diff < 0) {
    const late = Math.abs(days);
    if (late === 0) return 'earlier today';
    return late === 1 ? '1 day overdue' : `${late} days overdue`;
  }
  if (days === 0) {
    return `today, ${new Date(dueAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  if (days === 1) return 'tomorrow';
  return new Date(dueAt).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** Follow-ups that actually want attention now, most urgent first. */
export function needingAttention(followUps) {
  const rank = { overdue: 0, needs_attention: 1, due: 2 };
  return followUps
    .filter((f) => isOpenFollowUp(f) && f.status in rank)
    .sort((a, b) => rank[a.status] - rank[b.status] || a.due_at.localeCompare(b.due_at));
}

export const REMINDER_OFFSETS = [
  { key: 0, label: 'At the due time' },
  { key: 15, label: '15 minutes before' },
  { key: 30, label: '30 minutes before' },
  { key: 60, label: '1 hour before' },
  { key: 120, label: '2 hours before' },
  { key: 1440, label: '1 day before' },
];

export const SNOOZE_OPTIONS = [
  { minutes: 15, label: '15 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 180, label: '3 hours' },
  { minutes: 60 * 24, label: 'Tomorrow' },
];
