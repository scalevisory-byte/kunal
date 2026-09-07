import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';

const KEY = 'wa-tasks-dismissed-deadlines';

/** Dismissals are per date, so tomorrow's warning is not silenced by today's. */
const readDismissed = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
};

/**
 * "Tomorrow is the 7th — TDS."
 *
 * A statutory date is worth interrupting for, which a row in a list is not. It
 * shows only inside the warning window the rule itself sets, and dismissing it
 * silences that one date and nothing else - so the same notice returns next
 * month, which is the entire point.
 */
export default function DueSoonBanner({ onOpenTask }) {
  const [items, setItems] = useState([]);
  const [dismissed, setDismissed] = useState(readDismissed);

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

  const due = items.filter(
    (u) => u.days_away <= (u.rule.lead_days ?? 1) && !dismissed[`${u.rule.id}:${u.due_date}`]
  );
  if (!due.length) return null;

  const dismiss = (u) => {
    const next = { ...dismissed, [`${u.rule.id}:${u.due_date}`]: true };
    setDismissed(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* a private window will simply show it again, which is the safe way round */
    }
  };

  return (
    <section className="due-soon" role="status">
      {due.map((u) => (
        <div className="due-soon-row" key={`${u.rule.id}-${u.due_date}`}>
          <span className="due-soon-mark" aria-hidden="true">
            <Icon name="calendar" size={16} />
          </span>
          <div className="due-soon-what">
            <strong>
              {u.days_away === 0 ? 'Today' : u.days_away === 1 ? 'Tomorrow' : `In ${u.days_away} days`}
              {' — '}
              {u.rule.title}
            </strong>
            <span>
              Due {u.due_date} by {u.rule.due_time}
              {u.rule.group_name ? ` · ${u.rule.group_name}` : ''}
              {u.task ? ' · already on your list' : ''}
            </span>
          </div>
          <div className="due-soon-actions">
            {u.task && (
              <button type="button" className="btn small" onClick={() => onOpenTask(u.task.id)}>
                Open the task
              </button>
            )}
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(u)}>
              ✕
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
