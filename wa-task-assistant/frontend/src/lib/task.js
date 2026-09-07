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

/**
 * When an undated task arrived, said the way you would say it.
 *
 * Today gives the clock time, because that is what tells this morning's
 * capture from this afternoon's. Anything older gives the day, because the
 * exact minute of a task from last week has stopped mattering.
 */
/**
 * When a task was added, said so it cannot be read as anything else.
 *
 * A bare "7:55 PM" beside a column that can say "No deadline" gave no way to
 * tell which of the two dates it was — so the label is part of the value.
 *
 * This is `created_at`: the moment the task was made. The WhatsApp message's
 * own time is a different fact and lives with the message, in the drawer.
 */
export const addedLabel = (value) => {
  if (!value) return null;
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;

  const clock = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = at.toLocaleDateString('en-CA');
  const now = new Date();

  if (day === now.toLocaleDateString('en-CA')) return `Added Today · ${clock}`;
  if (day === new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA')) {
    return `Added Yesterday · ${clock}`;
  }
  // The year only when it is not this one — on a list where almost everything
  // is from this month, "2026" on every row is four characters of nothing.
  const date = at.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
  return `Added ${date} · ${clock}`;
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
/**
 * How long ago, in the fewest words that still mean something.
 *
 * A progress note is read as "when was this last touched", so the useful part
 * is the distance, not the timestamp: "3 days ago" answers it and "4 Sep,
 * 6:12 PM" makes you do the subtraction yourself.
 */
export const agoLabel = (value) => {
  if (!value) return null;
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const mins = Math.round((Date.now() - at.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return at.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

export function addsNothing(title, description) {
  if (!description) return true;
  const inTitle = words(title);
  const inDesc = words(description);
  if (!inDesc.size) return true;
  let shared = 0;
  for (const w of inDesc) if (inTitle.has(w)) shared += 1;
  return shared / inDesc.size >= 0.6;
}

/*
 * Where the task came from, always answerable.
 *
 * A saved contact gives a name; an unsaved one gives WhatsApp's own id,
 * "919909993565@c.us", which is not something to put on a row. The number is,
 * written the way it would be dialled. In that order: the chat's name, the
 * person's name, then the number — falling back rather than giving up, because
 * "which chat was this?" is the question people ask of a task they do not
 * recognise, and a blank is no answer.
 */
const looksLikeWid = (value) => /^\d[\d\s+-]*(@[a-z.]+)?$/i.test(String(value || '').trim());

/*
 * WhatsApp group names written in stylised letters, made readable.
 *
 * "𝔻𝕂𝕊𝕃_𝕊𝕀𝕋𝕄" is not decoration in a font — they are different characters,
 * Unicode's mathematical alphabets, and the app's self-hosted faces have no
 * glyphs for them, so a real group name arrives on the row as a row of boxes.
 * You cannot tell which group a task came from, which is the one thing the
 * label is there to say.
 *
 * NFKC is compatibility composition: it maps those alphabets, circled letters
 * and fullwidth forms back to plain ones and leaves everything else exactly as
 * it is — accents stay accents, and Gujarati, Hindi and emoji are untouched.
 */
/*
 * Letters from other alphabets that are drawn to look like Latin ones.
 *
 * A group named with Cherokee characters - Ꮷ Ꭺ Ꮶ Ꮪ Ꮋ - reads as "DAKSH" to
 * anybody looking at it and as a row of boxes in a font that has no Cherokee.
 * NFKC does not touch these, and correctly so: they are a real alphabet, not a
 * decorative form of ours.
 *
 * Which is why the map below is only applied to a name that is *mixed* with
 * plain ASCII. "ᏧᏔK$Ⱨ_$IᏈᎻ" has "K$_$I" in it and is plainly a Latin name in
 * fancy dress; a name written wholly in Cherokee, Greek or Cyrillic is somebody
 * actually writing in that alphabet, and is left completely alone.
 */
const LOOKALIKE = {
  'Ꭺ': 'A', 'Ᏸ': 'B', 'Ꮯ': 'C', 'Ꭰ': 'D', 'Ꮛ': 'E', 'Ꮐ': 'G', 'Ꮋ': 'H',
  'Ꭲ': 'T', 'Ꮷ': 'D', 'Ꮶ': 'K', 'Ꮮ': 'L', 'Ꮇ': 'M', 'Ꮑ': 'N', 'Ꮎ': 'O',
  'Ꮲ': 'P', 'Ꮢ': 'R', 'Ꮪ': 'S', 'Ꮙ': 'V', 'Ꮤ': 'W', 'Ꭼ': 'Z', 'Ꮖ': 'P',
  'Ᏻ': 'G', 'Ᏼ': 'B', 'Ꭴ': 'O', 'Ꮂ': 'H', 'Ꮈ': 'L', 'Ꮌ': 'M', 'Ꮕ': 'N',
  'Ⱨ': 'H', 'Ⱪ': 'K', 'Ⱡ': 'L', 'Ᏹ': 'Y', 'Ꭶ': 'G', 'Ꮸ': 'C',
};
const LOOKALIKE_RE = new RegExp(`[${Object.keys(LOOKALIKE).join('')}]`, 'g');

export const readableName = (text) => {
  const value = String(text ?? '').trim();
  if (!value) return value;

  let out = value;
  try {
    // Mathematical alphabets, circled and fullwidth letters: compatibility
    // forms of our own alphabet, so composing them is lossless.
    out = out.normalize('NFKC');
  } catch { /* an engine without full Unicode support */ }

  // Only a name that already contains plain letters or digits is treated as
  // Latin in disguise. Everything else is somebody's own script.
  if (/[A-Za-z0-9]/.test(out) && LOOKALIKE_RE.test(out)) {
    LOOKALIKE_RE.lastIndex = 0;
    out = out.replace(LOOKALIKE_RE, (c) => LOOKALIKE[c]);
  }
  LOOKALIKE_RE.lastIndex = 0;
  return out;
};

export const taskChat = (task) => {
  const named = [task.chat_name, task.contact].find((v) => v && !looksLikeWid(v));
  if (named) return readableName(named);
  return formatWaNumber(task.chat_id || task.chat_name || task.contact) || null;
};

/**
 * Where a task came from, as the row shows it.
 *
 * In a group, "where" is two facts and both matter: a request in BOOK N FLY
 * LEGAL TEAM is a different thing depending on whether Hasmukh or the advocate
 * wrote it, and the group alone does not say. So a group reads
 * "Hasmukh · BOOK N FLY LEGAL TEAM" and a one-to-one chat stays a single name,
 * because there the two are the same person written twice.
 */
export function taskSource(task) {
  const chat = taskChat(task);
  if (!task?.is_group) return chat ? { label: chat, chat } : null;

  const who = [task.contact, task.requested_by].find((v) => v && !looksLikeWid(v));
  const sender = who ? readableName(who) : null;
  // Only when they are genuinely two different names: a group whose name is
  // also the sender's would otherwise be printed twice.
  if (!sender || !chat || sender === chat) return chat ? { label: chat, chat } : null;
  return { label: `${sender} · ${chat}`, chat, sender, group: chat };
}

/** Free-text match across the fields a person would actually search by. */
export function matchesQuery(task, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [task.title, task.description, task.chat_name, task.contact, task.source_message]
    .filter(Boolean)
    // Both forms: searching "DKSL" has to find a group whose name is stored as
    // "𝔻𝕂𝕊𝕃", because that is what the row shows and what you would type.
    .some((field) => {
      const raw = String(field).toLowerCase();
      return raw.includes(q) || readableName(raw).toLowerCase().includes(q);
    });
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
