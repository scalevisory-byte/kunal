const dayMs = 86400000;

export const todayIso = () => new Date().toISOString().slice(0, 10);
export const isoDay = (offset = 0) =>
  new Date(Date.now() + offset * dayMs).toISOString().slice(0, 10);

export const STATUSES = [
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'done', label: 'Done' },
];

export const PRIORITIES = [
  { key: 'high', label: 'High', dot: '🔴' },
  { key: 'medium', label: 'Medium', dot: '🟠' },
  { key: 'low', label: 'Low', dot: '🟢' },
];

export const statusLabel = (key) => STATUSES.find((s) => s.key === key)?.label || key;
export const isDone = (task) => task.status === 'done';
export const isOverdue = (task) => !isDone(task) && task.due_date && task.due_date < todayIso();

/** Days between a due date and today; negative means late. */
export function daysOut(dueDate) {
  if (!dueDate) return null;
  return Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${todayIso()}T00:00:00Z`)) / dayMs);
}

/** Short, human date. Long ISO strings read as noise on a phone. */
export function dueLabel(dueDate) {
  const diff = daysOut(dueDate);
  if (diff === null) return null;
  if (diff < 0) return { text: diff === -1 ? '1 day late' : `${Math.abs(diff)} days late`, tone: 'danger' };
  if (diff === 0) return { text: 'Today', tone: 'warn' };
  if (diff === 1) return { text: 'Tomorrow', tone: 'warn' };
  if (diff <= 6) return { text: `${diff}d`, tone: '' };
  return {
    text: new Date(`${dueDate}T00:00:00Z`).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }),
    tone: '',
  };
}

export const timeLabel = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const dateTimeLabel = (value) => {
  if (!value) return null;
  // SQLite writes "YYYY-MM-DD HH:MM:SS" in UTC without a marker.
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? value
    : at.toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

const FILLER = new Set([
  'a', 'an', 'and', 'be', 'by', 'do', 'done', 'for', 'has', 'have', 'is', 'it',
  'need', 'needs', 'of', 'on', 'the', 'to', 'today', 'tomorrow', 'up', 'with',
]);

const words = (text) =>
  new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !FILLER.has(w))
  );

/**
 * "Process BNF salary" / "BNF salary payment needs to be done today" says the
 * same thing twice. A description only earns its line when it carries something
 * the title does not.
 */
export function addsNothing(title, description) {
  if (!description) return true;
  const inTitle = words(title);
  const inDesc = words(description);
  if (!inDesc.size) return true;
  let shared = 0;
  for (const w of inDesc) if (inTitle.has(w)) shared += 1;
  return shared / inDesc.size >= 0.6;
}

export const taskChat = (task) => task.chat_name || task.contact || null;

/** Free-text match across the fields a person would actually search by. */
export function matchesQuery(task, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [task.title, task.description, task.chat_name, task.contact, task.source_message]
    .filter(Boolean)
    .some((field) => String(field).toLowerCase().includes(q));
}

/**
 * "919909993565@c.us" is what WhatsApp gives us. Show it the way the number is
 * actually written, and fall back to the raw digits for anything unexpected.
 */
export function formatWaNumber(wid) {
  const digits = String(wid || '').split('@')[0].replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}

/** First letter of the account name, for the header badge. */
export const initialOf = (name, fallback) =>
  (String(name || '').trim()[0] || String(fallback || '').replace(/\D/g, '')[0] || '·').toUpperCase();
