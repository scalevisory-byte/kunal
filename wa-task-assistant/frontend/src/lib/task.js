const dayMs = 86400000;

/*
 * Today, on the calendar the person is actually looking at.
 *
 * These used to be `toISOString()`, which is UTC. In India that is five and a
 * half hours behind, so between midnight and half past five in the morning the
 * app thought it was still yesterday: a task added at 5:22 am said "Added
 * Today" on its row - that label reads the local clock - while every figure and
 * every "due today" list counted it under the day before. Deadlines are stored
 * as local calendar dates, so this is the clock they have to be read against.
 */
export const todayIso = () => new Date().toLocaleDateString('en-CA');
export const isoDay = (offset = 0) =>
  new Date(Date.now() + offset * dayMs).toLocaleDateString('en-CA');

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

/*
 * Work he has handed to somebody else.
 *
 * It is still his to chase, which is why it is still a task and still gets
 * reminders - but it is not what he sits down to do, and a hundred allotted
 * rows in All Tasks is what made the list unreadable. Task allotted is its
 * home; the board says how many are there rather than hiding them silently.
 */
export const isAllotted = (task) => Boolean(task.assigned_to);

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
/**
 * When a task came in, in two short pieces for the column at the head of the
 * row: the day, and the time under it.
 *
 * Asked for as "need task rec date on starting of task". It was already on the
 * row - "Added Sep 11 · 7:05 PM", fourth item along a meta line of six - and
 * that is a place you read a date you already went looking for, not one you
 * scan. At the front, every row's date sits in the same column, so "what has
 * been sitting here since last week" is answered by running an eye down it.
 *
 * Today and Yesterday are named rather than dated, because on a list where
 * most of the work arrived this week the date itself is the part that says
 * least.
 */
export const receivedStamp = (value) => {
  if (!value) return null;
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;

  const now = new Date();
  const day = at.toLocaleDateString('en-CA');
  const clock = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (day === now.toLocaleDateString('en-CA')) return { day: 'Today', clock };
  if (day === new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA')) {
    return { day: 'Yesterday', clock };
  }
  const sameYear = at.getFullYear() === now.getFullYear();
  return {
    day: at
      .toLocaleDateString([], {
        day: 'numeric',
        month: 'short',
        // The year only when it is not this one - on a list where almost
        // everything is from this month, "2026" on every row says nothing.
        ...(sameYear ? {} : { year: '2-digit' }),
      })
      // "Dec 19, 25" is one character too wide for the column; the comma is
      // the one character in it that carries nothing.
      .replace(',', ''),
    clock,
  };
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

/**
 * How long something has been going on, as a plain span rather than a point.
 *
 * "None since the restart" is worth exactly what the restart is old: a deploy
 * four minutes ago proves nothing, four days ago proves the block. So the
 * figure has to carry its own basis - "none in the 3 days since" - which is a
 * length, not a timestamp.
 */
export const spanLabel = (value) => {
  if (!value) return null;
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const mins = Math.max(0, Math.round((Date.now() - at.getTime()) / 60000));
  if (mins < 2) return 'a minute';
  if (mins < 60) return `${mins} minutes`;
  const hours = Math.round(mins / 60);
  if (hours === 1) return 'an hour';
  if (hours < 36) return `${hours} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'a day' : `${days} days`;
};

/**
 * Whether a "nothing since the restart" reading has had long enough to mean
 * anything. Two hours is the line: below it the app may simply not have been
 * up long enough for the chat to have written.
 */
export const tooSoonToTell = (value) => {
  if (!value) return false;
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return false;
  return Date.now() - at.getTime() < 2 * 60 * 60 * 1000;
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
/*
 * A WhatsApp id wearing a name's clothes.
 *
 * The device suffix is the part that used to get through: "202383321759941:33"
 * is a linked identity and a device number, it identifies nobody a person can
 * recognise, and with no colon in the pattern it sailed onto the row as if it
 * were a name. Anything ending in an @domain is an id too.
 */
export const looksLikeWid = (value) =>
  /^\d[\d\s+-]*(:\d+)?(@[a-z.]+)?$/i.test(String(value || '').trim());

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
  /*
   * A row is never silent about where it came from.
   *
   * Reported as "ye sab me kisne msg kiya, wo kyu nahi he" - rows with nothing
   * at all on the line. The cause is a chat WhatsApp never named: it is stored
   * under its id, and a `@lid` id has no dialable number inside it to fall back
   * on, so every road ended in null and the row printed nothing. Nothing reads
   * as a bug; "Unnamed chat" reads as the truth, and it is - the name really is
   * missing, the app is going back to WhatsApp for it, and the id is in the
   * tooltip meanwhile.
   */
  const unknown = task?.chat_id || task?.message_id
    ? { label: 'Unnamed chat', chat: null, unnamed: true, id: task?.chat_id || null }
    /*
     * Reported a second time as "name abhi nahi aya", because the line above
     * only speaks for a task that carries some trace of its chat. One that came
     * out of WhatsApp with neither an id nor a message — early versions did not
     * put the chat on the task, and the extractor leaves both empty when it
     * points at no message — still fell through to nothing, which is the blank
     * he was looking at.
     *
     * Nothing can recover those: there is no id to ask WhatsApp about. Saying
     * so is the whole of what can be done, and it beats a silent row, which
     * reads as something broken rather than something missing.
     *
     * A task he typed himself is the one case that stays quiet: it has no chat
     * because it never came from one, the row already says "By hand", and
     * "No chat" beside that is a second way of saying the same thing.
     */
    : (task?.origin === 'ai' || task?.source === 'whatsapp')
      ? { label: 'No chat', chat: null, unnamed: true, noSource: true, id: null }
      : null;

  if (!task?.is_group) return chat ? { label: chat, chat } : unknown;

  const who = [task.contact, task.requested_by].find((v) => v && !looksLikeWid(v));
  const sender = who ? readableName(who) : null;
  // Only when they are genuinely two different names: a group whose name is
  // also the sender's would otherwise be printed twice.
  if (!sender || !chat || sender === chat) return chat ? { label: chat, chat } : unknown;
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
  const text = String(wid || '');
  /*
   * A lid is not a number and must not be dressed as one: "+202383321759941"
   * looks dialable and is not. Nor is any run longer than E.164 allows.
   */
  if (/@lid$/i.test(text)) return null;
  const digits = text.split('@')[0].split(':')[0].replace(/\D/g, '');
  if (!digits || digits.length > 15) return null;
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}

/** First letter of the account name, for the header badge. */
export const initialOf = (name, fallback) =>
  (String(name || '').trim()[0] || String(fallback || '').replace(/\D/g, '')[0] || '·').toUpperCase();

/* ---------------- which month a task belongs to ---------------- */

/**
 * The month a task is filed under.
 *
 * Its DEADLINE's month when it has one, and the month it arrived when it does
 * not. That is how the work is actually thought about: a job due on 20 October
 * is October's work even if the message came in on 5 September. Only work with
 * no deadline at all has nothing better to go on than when it turned up.
 *
 * `due_date` is already a plain local day, so it needs no conversion. A task
 * that only has `due_at` (an instant) or nothing but `created_at` is read in
 * the browser's own calendar, which is his - the same calendar the row's date
 * column is printed in, so a task never appears under one month and prints a
 * date in another.
 */
export function taskMonth(task) {
  if (task.due_date) return String(task.due_date).slice(0, 7);
  const stamp = task.due_at || task.created_at;
  if (!stamp) return null;
  const at = new Date(stamp.includes('T') ? stamp : `${stamp.replace(' ', 'T')}Z`);
  if (Number.isNaN(at.getTime())) return null;
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`;
}

/** This month, in the same calendar taskMonth uses. */
export function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** "Sep 2026", or just "Sep" inside the current year, which is most of them. */
export function monthLabel(key, now = new Date()) {
  const [y, m] = String(key).split('-').map(Number);
  if (!y || !m) return key;
  const name = new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'short' });
  return y === now.getFullYear() ? name : `${name} ${y}`;
}

/**
 * The months worth showing above the list, newest first.
 *
 * The rule he asked for: a month that is over still gets its chip **while it
 * still has work owed** - "month complete ho or o month k task pending he to
 * us month ki tab me dikhe". A past month everything is finished in has
 * nothing left to chase, so it stops taking up the row; its work is in
 * Completed, where finished work lives.
 *
 * The current month is always there even when it is empty, because a row that
 * loses today's chip on a quiet morning reads as broken.
 *
 * Counted from the tasks the board is showing - the same rows, after the same
 * filters - so the chip and the sections underneath can never disagree.
 */
export function monthsFor(tasks = [], now = new Date()) {
  const here = currentMonth(now);
  const byMonth = new Map();

  for (const task of tasks) {
    const key = taskMonth(task);
    if (!key) continue;
    if (!byMonth.has(key)) byMonth.set(key, { key, total: 0, pending: 0, overdue: 0 });
    const row = byMonth.get(key);
    row.total += 1;
    if (!isDone(task)) {
      row.pending += 1;
      if (isOverdue(task)) row.overdue += 1;
    }
  }

  if (!byMonth.has(here)) byMonth.set(here, { key: here, total: 0, pending: 0, overdue: 0 });

  return [...byMonth.values()]
    .filter((m) => m.key === here || m.pending > 0)
    .map((m) => ({ ...m, label: monthLabel(m.key, now), current: m.key === here }))
    .sort((a, b) => b.key.localeCompare(a.key));
}
