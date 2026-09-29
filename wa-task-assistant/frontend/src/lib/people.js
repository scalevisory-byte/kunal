import { taskChat, looksLikeWid, readableName, isDone } from './task.js';

/*
 * By Chat, read as "by person": one section per chat, holding the work that
 * came FROM that chat and the work GIVEN TO that person.
 *
 * Asked as "jisse task aaya he ya diya he uski chat me dikhe - sahil ke 4 task
 * he to sahil ka name open kare to o dikhe". Grouping by the chat a task came
 * out of answered only half of that: a job handed to Sahil was filed under
 * whoever asked for it, or under "Added by hand", and never under Sahil.
 *
 * One person is one section however they are written down. A chat and an
 * assignee are matched by WhatsApp id first (exact) and by name second, with
 * case, spacing and punctuation ignored - "NIDHI BNF" typed on a row is the
 * same person as the chat "Nidhi Bnf".
 *
 * A group stays a section of its own: it is a conversation, not a person, and
 * work is never given to a group.
 *
 * A task can be in two sections - asked for by Sahil, given to Nidhi - because
 * it genuinely belongs to both conversations. Inside one section it is listed
 * once.
 *
 * Finished work belongs to the person too ("jo purane task he usko bhi wese kar
 * do"): it goes in the section's `done`, whichever direction it went, newest
 * first, so a person's history is under their name rather than in one
 * Completed heap at the foot of the page. `from` and `given` stay what is
 * still owed, and the heading's count is that - a person with forty finished
 * jobs and nothing open is not a busy person.
 */

const HAND = 'Added by hand';

const flat = (name) => String(name || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// A WhatsApp id that names one person, never a group.
const personWid = (wid) => (wid && /@(c\.us|lid)$/.test(wid) ? wid : null);

const byFinished = (a, b) =>
  String(b.completed_at || b.updated_at || '').localeCompare(String(a.completed_at || a.updated_at || ''));

export function byPerson(tasks = []) {
  const sections = [];
  const byWid = new Map();
  const byName = new Map();

  const sectionFor = ({ wid, name, group }) => {
    const key = flat(name);
    let found = (wid && byWid.get(wid)) || (!group && key && byName.get(key)) || null;
    if (!found) {
      found = {
        key: `p:${wid || key || sections.length}`, label: name,
        group: Boolean(group), hand: name === HAND, from: [], given: [], done: [],
      };
      sections.push(found);
    }
    if (wid && !byWid.has(wid)) byWid.set(wid, found);
    if (!group && key && !byName.has(key)) byName.set(key, found);
    return found;
  };

  const put = (s, list, task) => {
    if (isDone(task)) { if (!s.done.includes(task)) s.done.push(task); }
    else if (!s.from.includes(task) && !s.given.includes(task)) s[list].push(task);
  };

  for (const task of tasks) {
    const chat = taskChat(task);
    const assignee = task.assigned_to && !looksLikeWid(task.assigned_to)
      ? readableName(task.assigned_to)
      : null;

    if (chat) {
      const group = Boolean(task.is_group) || /@g\.us$/.test(task.chat_id || '');
      put(sectionFor({ wid: group ? task.chat_id : personWid(task.chat_id), name: chat, group }), 'from', task);
    } else if (!assignee) {
      put(sectionFor({ name: HAND }), 'from', task);
    }

    if (assignee) put(sectionFor({ wid: personWid(task.assigned_to_wid), name: assignee }), 'given', task);
  }

  return sections
    .map((s) => ({
      ...s,
      items: [...s.from, ...s.given],
      done: s.done.sort(byFinished),
    }))
    .sort((a, b) =>
      (a.label === HAND) - (b.label === HAND)
      || b.items.length - a.items.length
      || b.done.length - a.done.length
      || a.label.localeCompare(b.label));
}

/** "3 from them · 1 given to them · 12 done", for the section heading. */
export function personNote({ from, given, done = [], group, hand }) {
  const parts = [];
  if (!group && !hand) {
    if (from.length) parts.push(`${from.length} from them`);
    if (given.length) parts.push(`${given.length} given to them`);
  }
  if (done.length) parts.push(`${done.length} done`);
  return parts.join(' · ') || null;
}
