import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';
import { isoDay } from '../lib/task.js';

/**
 * One line, one task.
 *
 * Most tasks are a sentence and a day. Opening a form with notes, assignment,
 * deadline, time, reminder, follow-up and priority to write "send BNF report"
 * is six decisions nobody wanted to make, and the cost of it is not the typing
 * - it is the tasks that never get written down at all.
 *
 * So: a box, a row of days, and Enter. Everything else is still there behind
 * "More details", which opens the same full form as before - this is a faster
 * road to the same place, not a second kind of task.
 *
 * The words are read by the parser that already reads his own WhatsApp
 * messages, so "kal 5 baje" means tomorrow at five here too. Nothing is
 * invented: what it understood is shown after the task is made, and anything
 * it did not read comes from the saved defaults.
 */
const WHENS = [
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'none', label: 'No date' },
];

/** "Tomorrow · 5:00 pm", from whatever the task ended up with. */
function saidBack(task) {
  if (!task) return null;
  const bits = [];
  if (task.due_at) {
    const at = new Date(task.due_at);
    const day = at.toLocaleDateString('en-CA');
    const word = day === isoDay(0) ? 'Today' : day === isoDay(1) ? 'Tomorrow'
      : at.toLocaleDateString([], { day: 'numeric', month: 'short' });
    bits.push(`${word} · ${at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
  } else if (task.due_date) {
    const word = task.due_date === isoDay(0) ? 'Today'
      : task.due_date === isoDay(1) ? 'Tomorrow'
      : new Date(`${task.due_date}T00:00:00Z`).toLocaleDateString([], { day: 'numeric', month: 'short' });
    bits.push(word);
  } else {
    bits.push('No deadline');
  }

  const u = task.understood || {};
  if (u.reminder_offset) bits.push(`reminder ${minutes(u.reminder_offset)} before`);
  if (u.follow_up_offset) bits.push(`follow-up ${minutes(u.follow_up_offset)} after`);
  if (u.priority === 'high') bits.push('high priority');
  return bits.join(' · ');
}

const minutes = (n) =>
  n % 1440 === 0 ? `${n / 1440}d` : n % 60 === 0 ? `${n / 60}h` : `${n}m`;

export default function QuickAdd({
  groupId = null, groupName = null, onAdded, onMore, onError,
  autoFocus = false, compact = false, focusSignal = 0,
}) {
  const [text, setText] = useState('');
  const [when, setWhen] = useState(null);
  const [custom, setCustom] = useState({ date: '', time: '18:00' });
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(null);
  const box = useRef(null);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  /*
   * The + on the phone lands in the box, every press.
   *
   * autoFocus only fires when the box is first put on screen, so pressing +
   * again while it was already open left the focus on the button and the
   * keyboard down - which is the one thing that button exists to avoid.
   */
  useEffect(() => {
    if (focusSignal) box.current?.focus();
  }, [focusSignal]);

  const add = async (event) => {
    event?.preventDefault?.();
    const clean = text.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      const task = await api.quickAdd({
        text: clean,
        when: when === 'custom' && !custom.date ? null : when,
        due_date: custom.date || undefined,
        due_at: custom.date ? new Date(`${custom.date}T${custom.time || '18:00'}`).toISOString() : undefined,
        group_id: groupId || undefined,
      });
      setText('');
      /*
       * The chosen day stays. Adding four things for tomorrow means pressing
       * Tomorrow once, not once per task - and a custom date is a deliberate
       * choice, so it survives too.
       */
      setAdded(task);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setAdded(null), 6000);
      onAdded?.(task);
      box.current?.focus();
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy(false);
    }
  };

  /*
   * A chip is chosen mid-sentence, and the sentence is not finished. Pressing
   * one used to leave the focus on the button, so the next Enter did nothing
   * and the next keystroke went nowhere - the box goes back to being where you
   * are typing.
   */
  const pick = (key) => {
    setWhen((current) => (current === key ? null : key));
    box.current?.focus();
  };

  const keys = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (text) setText('');
      else box.current?.blur();
    }
  };

  return (
    <section className={`quickadd ${compact ? 'compact' : ''}`}>
      <form className="qa-row" onSubmit={add}>
        <Icon name="plus" size={16} className="qa-mark" />
        <input
          ref={box}
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={keys}
          placeholder={groupName ? `Add a task to ${groupName}…` : 'What needs to be done?'}
          aria-label="What needs to be done?"
        />
        <button type="submit" className="btn primary small" disabled={busy || !text.trim()}>
          {busy ? 'Adding…' : 'Add'}
        </button>
      </form>

      <div className="qa-when">
        {WHENS.map((w) => (
          <button
            key={w.key}
            type="button"
            className={`chip ${when === w.key ? 'on' : ''}`}
            aria-pressed={when === w.key}
            onClick={() => pick(w.key)}
          >
            {w.label}
          </button>
        ))}
        <button
          type="button"
          className={`chip ${when === 'custom' ? 'on' : ''}`}
          aria-pressed={when === 'custom'}
          onClick={() => pick('custom')}
        >
          Custom
        </button>

        {when === 'custom' && (
          <span className="qa-custom">
            <input
              type="date"
              value={custom.date}
              aria-label="Deadline date"
              onChange={(e) => setCustom((c) => ({ ...c, date: e.target.value }))}
            />
            <input
              type="time"
              value={custom.time}
              aria-label="Deadline time"
              onChange={(e) => setCustom((c) => ({ ...c, time: e.target.value }))}
            />
          </span>
        )}

        <span className="qa-gap" />

        {onMore && (
          <button type="button" className="link" onClick={() => onMore(text.trim())}>
            More details
          </button>
        )}
      </div>

      {/* What it made of the sentence, in the words it used. Shown rather than
          left to be discovered on the row, because a deadline read out of
          "kal 5 baje" is a guess the person should get to see. */}
      {added && (
        <p className="qa-said" role="status">
          <Icon name="check" size={13} /> Added <b>{added.title}</b> — {saidBack(added)}
        </p>
      )}

      {!when && !added && (
        <p className="qa-hint">
          Type a day if you like — “kal 5 baje”, “friday”, “today 6 pm”. Enter adds it.
        </p>
      )}
    </section>
  );
}
