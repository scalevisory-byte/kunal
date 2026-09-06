import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';
import { SNOOZE_OPTIONS } from '../lib/schedule.js';
import { dateTimeLabel } from '../lib/task.js';
import { parseStamp } from '../lib/derive.js';

const KIND_ICON = { reminder: 'clock', follow_up: 'chat', missed: 'alert' };

const isToday = (at) => {
  const stamp = parseStamp(at);
  return stamp ? stamp.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10) : false;
};

/**
 * What the engine has fired, and the two things worth doing about it: put it
 * off, or take it as read. Both act on the reminder, not on a copy of it.
 */
export default function NotificationCentre({ items, onClose, onReload, onOpenTask, onError }) {
  const panel = useRef(null);

  useEffect(() => {
    const onDown = (e) => !panel.current?.contains(e.target) && onClose();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const run = async (fn) => {
    try {
      await fn();
      await onReload();
    } catch (err) {
      onError(err);
    }
  };

  const today = items.filter((n) => isToday(n.at));
  const earlier = items.filter((n) => !isToday(n.at));

  const Group = ({ label, rows }) =>
    rows.length === 0 ? null : (
      <div className="notif-group">
        <h4>{label}</h4>
        {rows.map((n) => (
          <article key={n.id} className={`notif ${n.read_at ? '' : 'unread'} k-${n.kind}`}>
            <Icon name={KIND_ICON[n.kind] || 'bell'} size={16} className="notif-icon" />
            <div className="notif-body">
              <strong>{n.title}</strong>
              {n.body && <small>{n.body}</small>}
              <span className="notif-at">{dateTimeLabel(n.at)}</span>

              <div className="notif-tools">
                {n.task_id && (
                  <button className="tool" onClick={() => { onOpenTask(n.task_id); onClose(); }}>
                    Open task
                  </button>
                )}
                {n.reminder_id && SNOOZE_OPTIONS.slice(0, 3).map((o) => (
                  <button
                    key={o.minutes}
                    className="tool"
                    onClick={() => run(() => api.snoozeReminder(n.reminder_id, o.minutes))}
                  >
                    +{o.label}
                  </button>
                ))}
                {!n.read_at && (
                  <button className="tool" onClick={() => run(() => api.readNotification(n.id))}>
                    Mark read
                  </button>
                )}
                <button className="tool" onClick={() => run(() => api.dismissNotification(n.id))}>
                  Dismiss
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    );

  return (
    <div className="notif-panel" ref={panel} role="dialog" aria-label="Notifications">
      <header className="notif-head">
        <h3>Notifications</h3>
        {items.some((n) => !n.read_at) && (
          <button className="link" onClick={() => run(() => api.readAllNotifications())}>
            Mark all read
          </button>
        )}
      </header>

      {items.length === 0 ? (
        <p className="notif-empty">Nothing yet. Reminders and follow-ups appear here when they fire.</p>
      ) : (
        <div className="notif-list">
          <Group label="Today" rows={today} />
          <Group label="Earlier" rows={earlier} />
        </div>
      )}
    </div>
  );
}
