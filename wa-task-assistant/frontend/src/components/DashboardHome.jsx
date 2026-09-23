import Icon from './Icon.jsx';
import Progress from './Progress.jsx';
import { statusSlices, weekActivity, onDay, parseStamp } from '../lib/derive.js';
import { isDone, todayIso } from '../lib/task.js';

/**
 * The dashboard, laid out the way he drew it.
 *
 * Six figures across the top, the work that needs attention beside today's
 * numbers, the shape of the whole list beside the week just worked, what was
 * finished and what arrived, and the connection at the foot.
 *
 * Two things in the drawing would have printed a falsehood and are built
 * differently on purpose - the stacked bar's slices (they overlapped, so they
 * could not be parts of a whole) and the week chart's future days (they
 * carried bars for days that have not happened). Both are explained where they
 * are computed, in lib/derive.js.
 *
 * Everything here is derived from the tasks already loaded. There is no second
 * query, so no figure on this page can disagree with another, and none of them
 * is a placeholder.
 */

const timeOf = (stamp) => {
  const at = parseStamp(stamp);
  return at ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
};

/**
 * One of the six. Pressing it opens exactly what it counts.
 *
 * Every one of them goes somewhere, including the two the old row could not
 * reach: "Due today" scopes the board to today's date and "Completed today"
 * to the completions of this day. A figure you cannot press is a figure you
 * have to go and find by hand.
 */
function Figure({ cell, onPick }) {
  return (
    <button
      type="button"
      className={`fig t-${cell.tone}`}
      title={cell.title}
      onClick={() => onPick(cell.key)}
    >
      <span className="fig-icon"><Icon name={cell.icon} size={18} /></span>
      <span className="fig-body">
        <strong>{cell.value}</strong>
        <small>{cell.label}</small>
      </span>
    </button>
  );
}

/** The whole list in one bar, in slices that really are parts of it. */
function StatusBar({ tasks }) {
  const { slices, total, exact } = statusSlices(tasks);
  if (!total) return <p className="rail-empty">No tasks yet.</p>;
  return (
    <>
      <div className="statusbar" role="img"
        aria-label={slices.map((s) => `${s.label} ${s.value}`).join(', ')}>
        {slices.filter((s) => s.value > 0).map((s) => (
          <span key={s.key} className={`sb t-${s.tone}`} style={{ flexGrow: s.value }} />
        ))}
      </div>
      <dl className="sb-key">
        {slices.map((s) => (
          <div key={s.key}>
            <dt><span className={`dot t-${s.tone}`} /> {s.label}</dt>
            <dd>{s.value}</dd>
          </div>
        ))}
      </dl>
      {/* The caption is a fact about the bar, not a hope: if the slices ever
          stopped adding up the bar would be wrong and this would say so. */}
      <p className="rail-note">
        {exact
          ? `${total} tasks in all — every one of them in exactly one slice above.`
          : `These slices do not add up to ${tasks.length}; the bar is not to be trusted.`}
      </p>
    </>
  );
}

/** The week just worked, from when each task was actually finished. */
function WeekBars({ tasks }) {
  const { days, peak, total } = weekActivity(tasks);
  return (
    <>
      <div className="weekbars">
        {days.map((d) => (
          <div key={d.iso} className={`wb ${d.today ? 'now' : ''} ${d.future ? 'ahead' : ''}`}>
            <span className="wb-val">{d.future ? '' : d.count}</span>
            <span
              className="wb-bar"
              style={{ height: d.future ? 3 : `${Math.max(3, Math.round((d.count / peak) * 100))}%` }}
              title={d.future ? `${d.label} has not happened yet` : `${d.count} finished on ${d.label}`}
            />
            <span className="wb-day">{d.label}</span>
          </div>
        ))}
      </div>
      <p className="rail-note">
        {total
          ? `${total} finished so far this week. Days still ahead carry no bar.`
          : 'Nothing finished this week yet.'}
      </p>
    </>
  );
}

/** What was finished today, and what arrived — the two halves of the day. */
function DayList({ title, rows, icon, tone, empty, onOpen, onAll }) {
  return (
    <section className="card">
      <header className="card-head">
        <h3>{title}</h3>
        {onAll && rows.length > 0 && (
          <button className="link" onClick={onAll}>View all <Icon name="arrowRight" size={13} /></button>
        )}
      </header>
      {rows.length === 0 ? (
        <p className="rail-empty">{empty}</p>
      ) : (
        <ul className="daylist">
          {rows.map((task) => (
            <li key={task.id}>
              <span className={`dl-mark t-${tone}`}><Icon name={icon} size={14} /></span>
              <button className="dl-title" onClick={() => onOpen(task)}>{task.title}</button>
              <span className="dl-time">{timeOf(tone === 'ok' ? task.completed_at : task.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function DashboardHome({
  tasks, summary, status, onPick, onOpen, onCompleted, onUpcoming, onViewAi,
  chats = [], children, focus, calendar, innerRef = null,
}) {
  const { counts } = summary;
  const today = todayIso();
  const wa = status?.whatsapp;
  const connected = wa?.status === 'ready';
  const synced = wa?.lastReadyAt ? parseStamp(wa.lastReadyAt) : null;

  const figures = [
    { key: 'open', tone: 'info', icon: 'list', value: counts.open, label: 'Open', title: 'Everything not finished' },
    { key: 'overdue', tone: 'danger', icon: 'alert', value: counts.overdue, label: 'Overdue', title: 'Past their deadline' },
    { key: 'due_today', tone: 'warn', icon: 'calendar', value: counts.dueToday, label: 'Due today', title: 'Due before the day is out' },
    { key: 'added_today', tone: 'brand', icon: 'plus', value: counts.addedToday, label: 'Added today', title: `${counts.aiCreatedToday} of them from WhatsApp` },
    { key: 'done', tone: 'ok', icon: 'check', value: counts.done, label: 'Completed', title: 'Everything ever finished' },
    { key: 'completed_today', tone: 'ok', icon: 'check', value: counts.completedToday, label: 'Completed today', title: 'Finished since midnight' },
  ];

  const doneToday = tasks
    .filter((t) => isDone(t) && onDay(t.completed_at, today))
    .sort((a, b) => (parseStamp(b.completed_at) || 0) - (parseStamp(a.completed_at) || 0))
    .slice(0, 5);
  const addedToday = tasks
    .filter((t) => onDay(t.created_at, today))
    .sort((a, b) => (parseStamp(b.created_at) || 0) - (parseStamp(a.created_at) || 0))
    .slice(0, 5);

  return (
    <div className="home" ref={innerRef}>
      <section className="figs" aria-label="Task summary">
        {figures.map((cell) => (
          <Figure key={cell.key} cell={cell} onPick={onPick} />
        ))}
      </section>

      {/* The jump row and the duplicates notice, which are navigation and a
          warning rather than figures, keep the place they already had. */}
      {children}

      <div className="home-split">
        {/*
          * Focus today keeps its own fold, its rename and its tick - it is the
          * same strip, in the place the drawing puts it. The two charts sit
          * under it rather than below the whole split: the side column is
          * three cards tall and this one was one, which left a screen of
          * nothing between the strip and the next thing.
          */}
        <div className="home-main">
          {focus}
          <div className="home-two">
            <section className="card">
              <header className="card-head"><h3>Task status <span className="muted">(all tasks)</span></h3></header>
              <StatusBar tasks={tasks} />
            </section>
            <section className="card">
              <header className="card-head"><h3>My activity <span className="muted">(tasks finished this week)</span></h3></header>
              <WeekBars tasks={tasks} />
            </section>
          </div>
        </div>

        <aside className="home-side">
          <section className="card">
            <header className="card-head">
              <h3>{new Date().toLocaleDateString([], { weekday: 'long' })}</h3>
              <Icon name="calendar" size={16} />
            </header>
            <p className="home-date">
              {new Date().toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            <dl className="daystats">
              {[
                { tone: 'info', icon: 'calendar', value: counts.dueToday, label: 'Tasks due today' },
                { tone: 'danger', icon: 'alert', value: counts.overdue, label: 'Overdue tasks' },
                { tone: 'ok', icon: 'check', value: counts.done, label: 'Completed tasks' },
                { tone: 'ok', icon: 'check', value: counts.completedToday, label: 'Completed today' },
              ].map((s) => (
                <div key={s.label}>
                  <span className={`ds-icon t-${s.tone}`}><Icon name={s.icon} size={15} /></span>
                  <span className="ds-body"><strong>{s.value}</strong><small>{s.label}</small></span>
                </div>
              ))}
            </dl>
            <Progress
              progress={summary.progress}
              completedToday={counts.completedToday}
              todayTotal={summary.todayTotal}
            />
          </section>

          {/* What is coming. The drawing has no place for it, but "three
              tomorrow, eleven this week" is a real figure and the only thing
              on the page that looks past today. */}
          <section className="card">
            <header className="card-head"><h3>Upcoming</h3></header>
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

          {calendar}
        </aside>
      </div>

      <div className="home-two">
        <DayList
          title="Completed today" rows={doneToday} icon="check" tone="ok"
          empty="Nothing finished yet today." onOpen={onOpen} onAll={onCompleted}
        />
        <DayList
          title="Added today" rows={addedToday} icon="plus" tone="brand"
          empty="Nothing new has arrived today." onOpen={onOpen}
        />
      </div>

      <section className="card conn">
        <header className="card-head"><h3>Connected services</h3></header>
        <div className="conn-row">
          <span className={`conn-mark ${connected ? 'on' : 'off'}`}><Icon name="whatsapp" size={22} /></span>
          <span className="conn-who">
            <strong>WhatsApp</strong>
            <small className={connected ? 'ok-text' : 'warn-text'}>
              <span className="state-dot" /> {connected ? 'Connected' : wa?.status === 'authenticated' ? 'Syncing' : 'Not connected'}
            </small>
          </span>
          {/* The fact, not a reassurance: the moment the link last actually
              worked is written down when it happens, so it survives a deploy. */}
          <span className="conn-when">
            {synced
              ? <>Last linked<br />{synced.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</>
              : 'Never linked on this volume'}
          </span>
          <span className={`conn-pill ${connected ? 'ok' : 'warn'}`}>
            <Icon name={connected ? 'check' : 'alert'} size={14} />
            {connected ? 'Reading your messages' : 'Nothing is arriving'}
          </span>
        </div>
        {/*
          * What the connection actually produced. These figures used to sit in
          * a panel of their own; they are facts about this link, so they read
          * better underneath it than beside the day's numbers.
          */}
        <dl className="conn-figs">
          <div><dt>AI-created today</dt><dd>{counts.aiCreatedToday}</dd></div>
          <div><dt>Chats with tasks</dt><dd>{chats.length}</dd></div>
          <div><dt>Blocked chats</dt><dd>{status?.config?.blockedChats ?? 0}</dd></div>
          <div>
            <dt>Capture mode</dt>
            <dd>{status?.config?.extractionMode === 'ai' ? 'AI reads chats' : 'Only what you write'}</dd>
          </div>
        </dl>
        <button className="btn ghost wide" onClick={onViewAi}>
          View AI tasks <Icon name="arrowRight" size={16} />
        </button>
      </section>
    </div>
  );
}
