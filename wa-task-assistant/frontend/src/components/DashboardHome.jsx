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
      <Icon name="arrowRight" size={15} className="fig-go" />
    </button>
  );
}

/**
 * The week just worked, from when each task was actually finished.
 *
 * The drawing carries a bar on every day of the week, including the four that
 * had not happened yet - which reads as "you did nothing on Friday" about a
 * Friday two days away. A day still ahead gets a hairline and no figure; a day
 * that has passed with nothing finished gets a real 0, because those are
 * different facts.
 */
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

/**
 * Task distribution: four parts of one whole, with the whole in the middle.
 *
 * The drawing put five slices in this ring — Open, Due today, Overdue, Added
 * today, Completed — over a total of 514, which is those five added together.
 * There are not 514 tasks: 349 + 13 + 25 + 41 + 86 double-counts every overdue
 * task (it is also open) and every task that arrived today (it is also
 * something else). A ring is a claim that the parts make the whole, and the
 * percentages printed beside it would each be wrong.
 *
 * So it draws `statusSlices`, which are disjoint, and the number in the middle
 * is the real count of tasks rather than the sum of five overlapping figures.
 *
 * These are status colours, which this app reserves for exactly these states
 * and uses the same way everywhere — so identity is never carried by the
 * colour alone: every slice has a dot, its word and its figure in the legend,
 * and each arc carries its own title for a pointer.
 */
function Donut({ tasks }) {
  const { slices, total, exact } = statusSlices(tasks);
  if (!total) return <p className="rail-empty">No tasks yet.</p>;

  const shown = slices.filter((s) => s.value > 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  const GAP = shown.length > 1 ? 4 : 0;   // a surface gap, so two arcs never touch
  let at = 0;

  return (
    <div className="donut-wrap">
      <div className="donut">
        <svg viewBox="0 0 140 140" role="img"
          aria-label={`${total} tasks: ${shown.map((s) => `${s.label} ${s.value}`).join(', ')}`}>
          <circle cx="70" cy="70" r={R} className="donut-track" />
          {shown.map((s) => {
            const len = (s.value / total) * C;
            const dash = Math.max(0, len - GAP);
            const el = (
              <circle
                key={s.key} cx="70" cy="70" r={R}
                className={`donut-arc t-${s.tone}`}
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-at}
              >
                <title>{`${s.label}: ${s.value} of ${total}`}</title>
              </circle>
            );
            at += len;
            return el;
          })}
        </svg>
        <span className="donut-mid">
          <strong>{total}</strong>
          <small>Total tasks</small>
        </span>
      </div>
      <dl className="sb-key donut-key">
        {slices.map((s) => (
          <div key={s.key}>
            <dt><span className={`dot t-${s.tone}`} /> {s.label}</dt>
            <dd>
              {s.value}
              <span className="muted"> · {total ? Math.round((s.value / total) * 100) : 0}%</span>
            </dd>
          </div>
        ))}
      </dl>
      {/* The invariant stated rather than assumed: a ring whose parts stopped
          making the whole would be wrong, and this would say so. */}
      <p className="rail-note">
        {exact
          ? 'Every task is in exactly one slice, so the parts really do make the whole.'
          : `These slices do not add up to ${tasks.length}; the ring is not to be trusted.`}
      </p>
    </div>
  );
}

/** What was finished today, and what arrived — the two halves of the day. */
function DayList({ title, count, rows, icon, tone, empty, onOpen, onAll }) {
  return (
    <section className="card">
      <header className="card-head">
        <h3>{title} <span className="muted">({count})</span></h3>
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
      {/*
        * Two columns from the very top.
        *
        * Asked with two crops - the figures and the jump row in one, the
        * calendar in the other - and "ye saare tab itni space me hi rakho /
        * itne part me calendar wala part": the figures used to run the whole
        * width and the calendar started below them, so the tallest card on
        * the page began a screen down and the page was longer than it needed
        * to be. The figures belong to the board's column; the calendar rises
        * beside them.
        */}
      <div className="home-split">
        <div className="home-main">
          <section className="figs" aria-label="Task summary">
            {figures.map((cell) => (
              <Figure key={cell.key} cell={cell} onPick={onPick} />
            ))}
          </section>

          {/* The jump row and the duplicates notice: navigation and a warning
              rather than figures, so they keep the place they already had. */}
          {children}

          {/* Focus today keeps its own fold, its rename and its tick - it is
              the same strip, in the place the drawing puts it. */}
          {focus}
          <div className="home-two">
            <section className="card">
              <header className="card-head"><h3>Task overview <span className="muted">(finished this week)</span></h3></header>
              <WeekBars tasks={tasks} />
            </section>
            <section className="card">
              <header className="card-head"><h3>Task distribution <span className="muted">(all tasks)</span></h3></header>
              <Donut tasks={tasks} />
            </section>
          </div>
        </div>

        <aside className="home-side">
          {/*
            * The day's four figures sit on the calendar rather than in a card
            * of their own: the date is beside the New Task button now, so a
            * card whose job was to say "Wednesday" had nothing left to do.
            */}
          <section className="card">
          {calendar}
          <dl className="daystats tiles">
            {[
              { tone: 'warn', icon: 'calendar', value: counts.dueToday, label: 'Due today' },
              { tone: 'danger', icon: 'alert', value: counts.overdue, label: 'Overdue' },
              { tone: 'ok', icon: 'check', value: counts.done, label: 'Completed' },
              { tone: 'ok', icon: 'check', value: counts.completedToday, label: 'Completed today' },
            ].map((d) => (
              <div key={d.label} className={`w-${d.tone}`}>
                <span className={`ds-icon t-${d.tone}`}><Icon name={d.icon} size={15} /></span>
                <span className="ds-body"><strong>{d.value}</strong><small>{d.label}</small></span>
              </div>
            ))}
          </dl>
          <Progress
            progress={summary.progress}
            completedToday={counts.completedToday}
            todayTotal={summary.todayTotal}
          />
          </section>

          {/*
            * What is coming. The second drawing has no place for it, and it
            * was taken out when that drawing was followed - which left
            * `onUpcoming` wired to nothing and the page with no figure that
            * looks past today. Now that the figures moved into the board's
            * column there is room beside them for it: "three tomorrow,
            * eleven this week" is a real count of real rows, and each line
            * opens exactly what it counts.
            */}
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
        </aside>
      </div>

      <div className="home-two">
        <DayList
          title="Completed today" count={counts.completedToday} rows={doneToday} icon="check" tone="ok"
          empty="Nothing finished yet today." onOpen={onOpen} onAll={onCompleted}
        />
        <DayList
          title="Added today" count={counts.addedToday} rows={addedToday} icon="plus" tone="brand"
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
