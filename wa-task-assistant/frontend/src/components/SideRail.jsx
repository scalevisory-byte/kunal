import Progress from './Progress.jsx';
import Icon from './Icon.jsx';
import { todayIso } from '../lib/task.js';

const timeOfDay = (at) => at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const dayLabel = (at) => {
  const iso = at.toISOString().slice(0, 10);
  if (iso === todayIso()) return null;
  return at.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

/**
 * The rail answers the questions the board cannot: how today is going, what is
 * coming, whether the WhatsApp side is actually working, and what changed last.
 */
export default function SideRail({
  summary, activity, chats, status, onUpcoming, onChat, onViewAi,
  /*
   * `spread` lays the same cards across the page instead of down a 276px
   * strip. It is the dashboard's layout now: with the task list gone from
   * that page, a narrow column beside an empty half-screen was the worst of
   * both. Each card carries an `r-` class so the stylesheet can put it in a
   * named grid area - the calendar down the side, Recent activity across the
   * full width - rather than letting an auto-fit grid drop them wherever they
   * happen to land. `innerRef` is what the phone's "Summary" button scrolls
   * to - it used to sit on the wrapper this no longer has.
   */
  spread = false, innerRef = null,
}) {
  const wa = status?.whatsapp;
  const connected = wa?.status === 'ready';
  const { counts } = summary;

  return (
    <aside className={`rail ${spread ? 'spread' : ''}`} aria-label="Summary" ref={innerRef}>
      <section className="rail-card r-today">
        <h3 className="rail-title">Today's summary</h3>
        <p className="rail-date">
          {new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
        <div className="mini-stats">
          {[
            { key: 'today', tone: 'info', icon: 'calendar', value: counts.dueToday, label: 'Today' },
            { key: 'overdue', tone: 'danger', icon: 'alert', value: counts.overdue, label: 'Overdue' },
            { key: 'pending', tone: 'plain', icon: 'clipboard', value: counts.open, label: 'Pending' },
            { key: 'done', tone: 'ok', icon: 'check', value: counts.completedToday, label: 'Completed' },
          ].map((m) => (
            <div key={m.key} className={`mini t-${m.tone}`}>
              <span className="mini-icon"><Icon name={m.icon} size={16} /></span>
              <span className="mini-body">
                <strong>{m.value}</strong>
                <small>{m.label}</small>
              </span>
            </div>
          ))}
        </div>
        <Progress
          progress={summary.progress}
          completedToday={counts.completedToday}
          todayTotal={summary.todayTotal}
        />
      </section>

      <section className="rail-card r-upcoming">
        <h3 className="rail-title">Upcoming</h3>
        {summary.upcoming.every((u) => u.count === 0) ? (
          <p className="rail-empty">Nothing dated in the next two weeks.</p>
        ) : (
          <ul className="rail-list">
            {summary.upcoming.map((u) => (
              <li key={u.key}>
                <button className="rail-row" onClick={() => onUpcoming(u.key)}>
                  <span className="rail-name"><Icon name="calendar" size={15} /> {u.label}</span>
                  <span className="rail-count">{u.count} {u.count === 1 ? 'task' : 'tasks'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rail-card ai-card r-ai">
        <h3 className="rail-title">AI task intelligence</h3>
        <div className="ai-state">
          <span className={`ai-mark ${connected ? 'on' : 'off'}`}><Icon name="whatsapp" size={17} /></span>
          <span>
            <strong className={connected ? 'ok-text' : 'warn-text'}>
              {connected ? 'Connected to WhatsApp' : wa?.status === 'authenticated' ? 'Syncing chats' : 'Not connected'}
            </strong>
            <small>
              {status?.config?.extractionMode === 'ai'
                ? 'AI is monitoring actionable messages'
                : 'Manual capture: only what you write becomes a task'}
            </small>
          </span>
        </div>
        <dl className="rail-figures tight">
          <div><dt>AI-created today</dt><dd>{counts.aiCreatedToday}</dd></div>
          <div><dt>Chats with tasks</dt><dd>{chats.length}</dd></div>
          <div><dt>Blocked chats</dt><dd>{status?.config?.blockedChats ?? 0}</dd></div>
        </dl>
        <button className="btn ghost wide" onClick={onViewAi}>
          View AI tasks <Icon name="arrowRight" size={16} />
        </button>
        {chats.length > 0 && (
          <>
            <p className="rail-sub">Most active</p>
            <ul className="rail-list">
              {chats.slice(0, 3).map(([name, count]) => (
                <li key={name}>
                  <button className="rail-row" onClick={() => onChat(name)}>
                    <span className="rail-name">{name}</span>
                    <span className="rail-count">{count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="rail-card r-activity">
        <h3 className="rail-title">Recent activity</h3>
        {activity.length === 0 ? (
          <p className="rail-empty">Nothing yet.</p>
        ) : (
          <ul className="activity">
            {activity.map((event, i) => (
              <li key={`${event.at.toISOString()}-${i}`} className={`act-${event.kind}`}>
                <span className="act-time">
                  {dayLabel(event.at) || timeOfDay(event.at)}
                </span>
                <span className="act-text">{event.text}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="rail-note">
          Built from when each task was created and completed — the timestamps the
          app actually records.
        </p>
      </section>
    </aside>
  );
}
