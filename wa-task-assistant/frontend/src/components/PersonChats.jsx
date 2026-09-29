import { useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { receivedStamp } from '../lib/task.js';
import { chatOrder, lastActivity } from '../lib/people.js';

/*
 * By Chat, laid out the way WhatsApp is: the people down the left, one
 * person's work on the right.
 *
 * Asked for with a screenshot of the app beside WhatsApp and "iska view change
 * karo, ya to option do". The accordion made every name a full-width band with
 * its figures on a second line, so a page of forty people was a page of forty
 * bands and nothing to read. Here the names are a list you run an eye down -
 * newest activity first, with the last task and its time under each, and a
 * count of what is still owed - and pressing one shows exactly that person.
 *
 * The rows on the right are the board's own TaskItem (`row` is TaskList's),
 * so ticking, renaming, assigning and the ⋮ menu work exactly as everywhere
 * else. On a phone the two halves take turns, with a back arrow, as they do
 * in WhatsApp.
 */

const initials = (name) => {
  const parts = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};

const when = (value) => {
  const s = receivedStamp(value);
  if (!s) return '';
  return s.day === 'Today' ? s.clock : s.day;
};

const wide = () => {
  try { return window.matchMedia('(min-width: 761px)').matches; } catch { return true; }
};

export default function PersonChats({ sections, row }) {
  const [picked, setPicked] = useState(null);
  const [find, setFind] = useState('');
  const [showDone, setShowDone] = useState(false);
  const root = useRef(null);

  const ordered = useMemo(() => chatOrder(sections), [sections]);
  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    return q ? ordered.filter((s) => s.label.toLowerCase().includes(q)) : ordered;
  }, [ordered, find]);

  // On a wide screen the first chat is open on arrival, as a desktop mail or
  // chat app does; on a phone the list comes first.
  const current = ordered.find((s) => s.key === picked) || (picked === null && wide() ? ordered[0] : null);

  const open = (key) => {
    setPicked(key);
    setShowDone(false);
    // On a phone the list is swapped for the person, so start at their name
    // rather than wherever the list had been scrolled to.
    if (!wide()) requestAnimationFrame(() => root.current?.scrollIntoView({ block: 'start' }));
  };
  const back = () => {
    setPicked('');
    requestAnimationFrame(() => root.current?.scrollIntoView({ block: 'start' }));
  };

  return (
    <div ref={root} className={`pc ${current ? 'has-sel' : ''}`}>
      <aside className="pc-list" aria-label="People and chats">
        <label className="pc-find">
          <Icon name="search" size={15} />
          <input
            type="search"
            placeholder="Search a name"
            value={find}
            onChange={(e) => setFind(e.target.value)}
          />
        </label>
        <ul>
          {shown.map((s) => {
            const last = lastActivity(s);
            return (
              <li key={s.key}>
                <button
                  className={`pc-row ${current?.key === s.key ? 'on' : ''}`}
                  aria-current={current?.key === s.key ? 'true' : undefined}
                  onClick={() => open(s.key)}
                >
                  <span className={`pc-av ${s.group ? 'group' : ''}`} aria-hidden="true">
                    {s.group ? <Icon name="chat" size={17} /> : s.hand ? <Icon name="edit" size={16} /> : initials(s.label)}
                  </span>
                  <span className="pc-main">
                    <span className="pc-top">
                      <span className="pc-name">{s.label}</span>
                      <span className="pc-when">{when(last.at)}</span>
                    </span>
                    <span className="pc-bottom">
                      <span className={`pc-last ${last.done ? 'done' : ''}`}>
                        {last.done && <Icon name="check" size={13} />}
                        {last.task ? last.task.title : 'Nothing yet'}
                      </span>
                      {s.items.length > 0 && <span className="pc-count" title="Still owed">{s.items.length}</span>}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {!shown.length && <li className="pc-none">No name matches “{find}”.</li>}
        </ul>
      </aside>

      <section className="pc-detail" aria-live="polite">
        {!current ? (
          <p className="pc-empty">Pick a name to see its tasks.</p>
        ) : (
          <>
            <header className="pc-head">
              <button className="pc-back" onClick={back} aria-label="Back to the list">
                <Icon name="arrowRight" size={18} />
              </button>
              <span className={`pc-av ${current.group ? 'group' : ''}`} aria-hidden="true">
                {current.group ? <Icon name="chat" size={17} /> : current.hand ? <Icon name="edit" size={16} /> : initials(current.label)}
              </span>
              <span className="pc-title">
                <strong>{current.label}</strong>
                <small>{current.note || (current.group ? 'Group' : '')}</small>
              </span>
            </header>

            {current.from.length > 0 && current.given.length > 0 ? (
              <>
                <h4 className="person-sub">From {current.label}</h4>
                <ul className="task-list">{current.from.map(row)}</ul>
                <h4 className="person-sub">Given to {current.label}</h4>
                <ul className="task-list">{current.given.map(row)}</ul>
              </>
            ) : current.items.length > 0 ? (
              <>
                <h4 className="person-sub">
                  {current.given.length ? `Given to ${current.label}` : current.hand ? 'Added by hand' : `From ${current.label}`}
                </h4>
                <ul className="task-list">{current.items.map(row)}</ul>
              </>
            ) : (
              <p className="pc-empty small">Nothing owed. Everything with {current.label} is done.</p>
            )}

            {current.done.length > 0 && (
              <>
                <button
                  className="person-sub person-done"
                  aria-expanded={showDone}
                  onClick={() => setShowDone((v) => !v)}
                >
                  Done · {current.done.length}
                  <Icon name="chevronDown" size={14} className={`section-chevron ${showDone ? 'up' : ''}`} />
                </button>
                {showDone && <ul className="task-list">{current.done.map(row)}</ul>}
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
