/**
 * WhatsApp ids that are not names, and must never be shown as one.
 *
 * WhatsApp addresses a person two ways. `919909993565@c.us` is the phone
 * number, which is at least dialable and worth keeping. `202383321759941@lid`
 * is a "linked identity" — an opaque handle it uses when the sender's number
 * is not shared with you, and it often carries a `:33` device suffix. It
 * identifies nobody a human can recognise, and "202383321759941:33" is exactly
 * what was appearing on task rows where a chat name belonged, and once as the
 * name of the person a task had been given to.
 *
 * So: a lid is never a name. When a contact lookup fails on a lid the honest
 * answer is nothing at all, which leaves the row showing the chat it came
 * from — a real name, and the useful half of the fact anyway.
 */

/** The `@…` part, lowercased: 'c.us', 'lid', 'g.us', 'broadcast', or ''. */
const domainOf = (id) => String(id ?? '').split('@')[1]?.toLowerCase() || '';

/** '919909993565:33@c.us' → '919909993565'. The suffix is a device, not a person. */
const localOf = (id) => String(id ?? '').split('@')[0].split(':')[0].trim();

export const isLid = (id) => domainOf(id) === 'lid';

/**
 * A phone number to show for a wid, or null.
 *
 * Only for `@c.us`, which is the one form that really is a number. E.164 tops
 * out at 15 digits; a run longer than that is an internal id wearing a number
 * costume.
 */
export function phoneFromWid(id) {
  if (domainOf(id) !== 'c.us') return null;
  const digits = localOf(id).replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `+${digits}`;
}

/**
 * Whether a stored "name" is really an id.
 *
 * Deliberately narrower than a plain digit test: a phone number stored as a
 * contact is worth keeping — you can ring it — so only the shapes no human
 * reads count here. A device suffix, an `@` domain, or a digit run too long to
 * be a number anyone dials: country code and national number reach 13 digits
 * in practice, and the lids seen here are 15.
 */
export function isRawId(value) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  if (/@(c\.us|g\.us|lid|broadcast|s\.whatsapp\.net)$/i.test(text)) return true;
  if (/^\+?\d[\d\s-]*:\d+$/.test(text)) return true;
  const digits = text.replace(/[^\d]/g, '');
  return digits.length >= 14 && /^\+?[\d\s:-]+$/.test(text);
}

/**
 * Take the ids back off the rows that already have them.
 *
 * Nothing here is recoverable from the database - a lid names nobody, so
 * there is no better value to put in its place - and that is the point:
 * blank is honest and a number is not. A task whose contact is cleared shows
 * the chat it came from instead; one whose assignee is cleared shows the
 * Staff button again, ready to be given to a real person.
 *
 * The task, its deadline, its reminders and its history are untouched.
 */
export function scrubStoredIds(db) {
  const cleared = { contact: 0, assigned_to: 0, requested_by: 0, messages: 0 };

  const sweep = (table, column, apply) => {
    const rows = db
      .prepare(`SELECT id, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != ''`)
      .all();
    for (const row of rows) {
      if (!isRawId(row.value)) continue;
      apply(row.id);
      cleared[column === 'contact_name' ? 'messages' : column] += 1;
    }
  };

  const clearTask = (column, extra = '') =>
    db.prepare(`UPDATE tasks SET ${column} = NULL${extra} WHERE id = ?`);

  const contact = clearTask('contact');
  const assigned = clearTask('assigned_to', ', assigned_to_wid = NULL');
  const requested = clearTask('requested_by');
  const message = db.prepare(`UPDATE messages SET contact_name = NULL WHERE id = ?`);

  sweep('tasks', 'contact', (id) => contact.run(id));
  sweep('tasks', 'assigned_to', (id) => assigned.run(id));
  sweep('tasks', 'requested_by', (id) => requested.run(id));
  sweep('messages', 'contact_name', (id) => message.run(id));

  return cleared;
}
