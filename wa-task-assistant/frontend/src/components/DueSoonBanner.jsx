import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';

/**
 * The monthly deadlines that are nearly here.
 *
 * Two things, from one list. A compact card in the dashboard's own flow, which
 * is where you look for what is coming; and, for the nearest one inside its
 * warning window, a small popup, because "TDS is tomorrow" is worth
 * interrupting for in a way that a row in a list is not.
 *
 * What has been dealt with is recorded on the server, not in this browser. A
 * notice dismissed on the phone stays dismissed on the laptop, a refresh does
 * not bring it back, and a cleared browser does not resurrect it. Next month is
 * a different date and so a different notice, which is the entire point of a
 * recurring deadline.
 */
const LATER_MINUTES = 120;

const when = (days) =>
  days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;

/** "11 Sep · 6:00 pm", on the user's clock, from the deadline the rule sets. */
const stamp = (item) => {
  const iso = item.due_at || `${item.due_date}T00:00:00Z`;
  const at = new Date(iso);
  const date = at.toLocaleDateString([], { day: 'numeric', month: 'short' });
  if (!item.due_at) return date;
  return `${date} · ${at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
};

export default function DueSoonBanner({ onOpenTask }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  /*
   * One interruption per visit.
   *
   * Three statutory dates can be inside their warning windows at once, and
   * answering one dialog only to be handed the next is how a popup becomes
   * something you close without reading. The others are on the card below,
   * where they were going to be looked at anyway, and each still gets its own
   * dialog the next time the dashboard is opened.
   */
  const [interrupted, setInterrupted] = useState(false);

  const load = useCallback(() => {
    api.recurring()
      .then((d) => setItems(d.upcoming || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60_000);
    return () => clearInterval(id);
  }, [load]);

  // Inside the window the rule itself sets, and not already finished. Whether
  // a popup is owed is the server's answer, not this component's guess.
  const near = items.filter((u) => u.days_away <= (u.rule.lead_days ?? 1) && !u.done);
  const popup = interrupted ? null : (near.find((u) => u.popup) || null);

  const act = async (item, action) => {
    setBusy(true);
    setInterrupted(true);
    try {
      const { upcoming } = await api.deadlineNotice(item.rule.id, {
        due_date: item.due_date,
        action,
        minutes: LATER_MINUTES,
      });
      setItems(upcoming || []);
    } catch {
      // A notice that could not be recorded is shown again rather than
      // silently swallowed - the safe way round for a statutory date.
      load();
    } finally {
      setBusy(false);
    }
  };

  const open = (item) => {
    if (item.task) onOpenTask(item.task.id);
  };

  /*
   * Escape and a click outside put it back rather than closing it for good.
   * Dismissing means "I have dealt with this occurrence" and it never returns,
   * which is too much to infer from a stray click on a statutory deadline; the
   * same two hours "Remind me later" uses is the safe reading of both.
   */
  useEffect(() => {
    if (!popup) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') act(popup, 'later'); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!near.length) return null;

  return (
    <>
      {popup && (
        <div className="notice-backdrop" role="presentation" onClick={() => act(popup, 'later')}>
          <div
            className="notice"
            role="alertdialog"
            aria-labelledby="notice-title"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="notice-kicker">
              <Icon name="bell" size={13} /> Upcoming deadline
            </p>
            <h2 id="notice-title">{popup.rule.title}</h2>
            <p className="notice-sub">Monthly deadline{popup.rule.group_name ? ` · ${popup.rule.group_name}` : ''}</p>
            <p className="notice-when">{when(popup.days_away)} · {stamp(popup)}</p>
            <p className="notice-body">
              {popup.days_away === 1
                ? 'This monthly deadline is due tomorrow.'
                : popup.days_away === 0
                  ? 'This monthly deadline is due today.'
                  : `This monthly deadline is due in ${popup.days_away} days.`}
            </p>
            <div className="notice-foot">
              {popup.task && (
                <button type="button" className="btn primary" disabled={busy}
                  onClick={() => { open(popup); act(popup, 'dismiss'); }}>
                  Open task
                </button>
              )}
              <button type="button" className="btn ghost" disabled={busy}
                onClick={() => act(popup, 'later')}>
                Remind me later
              </button>
              <button type="button" className="link" disabled={busy}
                onClick={() => act(popup, 'dismiss')}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="due-soon" aria-label="Upcoming deadlines">
        <h2 className="due-soon-title">Upcoming deadlines</h2>
        {near.map((u) => (
          <div className="due-soon-row" key={`${u.rule.id}-${u.due_date}`}>
            <span className="due-soon-mark" aria-hidden="true">
              <Icon name="calendar" size={16} />
            </span>
            <div className="due-soon-what">
              <strong>{u.rule.title}</strong>
              <span>
                {when(u.days_away)} · {stamp(u)}
                {u.rule.group_name ? ` · ${u.rule.group_name}` : ''}
                {' · Monthly deadline'}
                {!u.task ? ' · task not made yet' : ''}
              </span>
            </div>
            <div className="due-soon-actions">
              {u.task && (
                <button type="button" className="btn small" onClick={() => open(u)}>
                  Open
                </button>
              )}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
