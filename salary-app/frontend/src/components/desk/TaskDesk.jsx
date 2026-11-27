import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { rupees } from '../../format.js';
import {
  PRIORITIES,
  RANKS,
  SEES_ALL_APPROVALS,
  SEES_ALL_TASKS,
  approvalOpen,
  canDecide,
  deskFigures,
  isClosed,
  isOverdue,
  isStale,
  matches,
  priorityLabel,
  rankOf,
  sortTasks,
  tally,
  waitingSentence,
} from '../../../../shared/taskDesk.js';

/*
 * THE TASK & APPROVAL DESK.
 *
 * Dinesh sent the desk his office ran on a Google Sheet and said *"ye bhi add
 * karo"*. This is that desk, inside the HRMS: work given to somebody and
 * talked through on one thread until it is done, and a spend or a decision
 * sent UP for a yes, a no or a question.
 *
 * ONE COMPONENT FOR BOTH SIDES. The office app and the staff portal render
 * this same file against the same /api/desk, because what somebody sees is
 * decided by who they ARE on the desk and not by which side they signed into.
 * Two copies would be two desks by the second fix.
 *
 * Every rule - who may be given work, who may be asked, what a status may
 * move to - is shared/taskDesk.js, the same file the server checks against.
 * The screen only decides what to OFFER; the server decides what is allowed.
 *
 * What his desk did that this one does not: it emailed people. This app has
 * no channel to send on, so what is waiting on somebody is shown on screen
 * and counted on the tab, and the forms say so rather than promising a mail.
 */

const DAY = 864e5;

const shortDate = (v) => {
  if (!v) return '—';
  const d = new Date(String(v).length === 10 ? `${v}T12:00:00` : v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const stamp = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
};
const ago = (v, now = Date.now()) => {
  const ms = now - Date.parse(v || '');
  if (!Number.isFinite(ms)) return '';
  if (ms < 60e3) return 'just now';
  if (ms < 3600e3) return `${Math.floor(ms / 60e3)}m ago`;
  if (ms < DAY) return `${Math.floor(ms / 3600e3)}h ago`;
  return `${Math.floor(ms / DAY)}d ago`;
};
const initials = (name) =>
  String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const tomorrow = () => {
  const d = new Date(Date.now() + DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const STATUS_CLASS = {
  Pending: 'pending', 'In Progress': 'progress', Waiting: 'waiting', Done: 'done', Dropped: 'dropped',
  Query: 'waiting', Approved: 'done', Rejected: 'rejected',
};
const StatusPill = ({ status }) => <span className={`desk-status ${STATUS_CLASS[status] || 'pending'}`}>{status}</span>;

/*
 * `you` changes the WORD, never the initials: "You" in a circle marked "Y"
 * reads as somebody called Y, on a page where every other circle is a person.
 */
const Who = ({ name, you = false }) => (
  <span className="desk-who">
    <span className="desk-avatar" aria-hidden="true">{initials(name)}</span>
    <span className="desk-who-name">{you ? 'You' : name}</span>
  </span>
);

/** Due date, said the way it matters: how late, or how soon. */
function DueChip({ task, today }) {
  if (!task.due_on) return <span className="muted">no date</span>;
  if (isClosed(task)) return <span className="muted">{shortDate(task.due_on)}</span>;
  const days = Math.round((Date.parse(`${task.due_on}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
  if (days < 0) return <span className="desk-due late">{-days}d overdue</span>;
  if (days === 0) return <span className="desk-due today">due today</span>;
  if (days === 1) return <span className="desk-due">tomorrow</span>;
  return <span className="desk-due">{shortDate(task.due_on)}</span>;
}

const SEGMENTS = [
  ['open', 'Open'],
  ['Pending', 'Pending'],
  ['In Progress', 'In progress'],
  ['Waiting', 'Waiting'],
  ['overdue', 'Overdue'],
  ['Done', 'Done'],
  ['all', 'All'],
];

export default function TaskDesk({ onError, onCount }) {
  const [data, setData] = useState(null);
  const [view, setView] = useState('dash');
  const [segment, setSegment] = useState('open');
  const [scope, setScope] = useState('mine');
  const [apprScope, setApprScope] = useState('forme');
  const [apprSegment, setApprSegment] = useState('open');
  const [pick, setPick] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(null); // { type, id }
  const [adding, setAdding] = useState(null); // 'task' | 'approval'
  const [bell, setBell] = useState(false);
  const alive = useRef(true);

  const load = async () => {
    try {
      const got = await api.get('/desk');
      if (!alive.current) return;
      setData(got);
      onCount?.(got.waiting?.total || 0);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    alive.current = true;
    load();
    // A desk left open all day has to notice what other people did on it.
    const timer = setInterval(load, 45000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const me = data?.me;
  const today = data?.today || '';
  const tasks = data?.tasks || [];
  const approvals = data?.approvals || [];
  const people = data?.people || [];
  const byKey = useMemo(() => new Map(people.map((p) => [p.key, p])), [people]);
  const figures = useMemo(
    () => (me ? deskFigures(me, tasks, approvals, { today }) : null),
    [me, tasks, approvals, today]
  );

  if (!data || !me) return <p className="muted">Opening the desk…</p>;

  const seesAllTasks = me.level <= SEES_ALL_TASKS;
  const seesAllApprovals = me.level <= SEES_ALL_APPROVALS;
  const mine = tasks.filter((t) => t.to === me.key);
  const given = tasks.filter((t) => t.by === me.key && t.to !== me.key);

  const bySegment = (list, seg = segment) => {
    if (seg === 'all') return list;
    if (seg === 'open') return list.filter((t) => !isClosed(t));
    if (seg === 'overdue') return list.filter((t) => isOverdue(t, today));
    if (seg === 'Done') return list.filter((t) => isClosed(t));
    return list.filter((t) => t.status === seg);
  };
  const shown = (list) => sortTasks(bySegment(list).filter((t) => matches(t, query)), today);

  const go = (next, seg) => {
    setView(next);
    if (seg) setSegment(seg);
    setPick('');
  };

  const openBell = async () => {
    const next = !bell;
    setBell(next);
    if (next && data.unseen) {
      try {
        await api.post('/desk/seen', {});
        setData((d) => ({ ...d, unseen: 0 }));
      } catch (err) {
        onError(err);
      }
    }
  };

  /* ------------------------------ pieces ------------------------------ */

  const Flags = ({ task }) => (
    <>
      {task.personal ? <span className="tag">personal</span> : null}
      {isStale(task) ? <span className="tag desk-quiet" title="Nobody has written on this for two days or more">no update 2d+</span> : null}
    </>
  );

  const TaskRows = ({ list, show = 'both' }) =>
    list.length ? (
      <div className="table-wrap">
        <table className="sheet desk-table">
          <thead>
            <tr>
              <th>Task</th>
              {show !== 'by' ? <th>For</th> : null}
              {show !== 'to' ? <th>From</th> : null}
              <th>Priority</th>
              <th>Due</th>
              <th>Status</th>
              <th>Last word</th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id} className="desk-row" onClick={() => setOpen({ type: 'task', id: t.id })}>
                <td className="desk-title">
                  <button className="link" onClick={(e) => { e.stopPropagation(); setOpen({ type: 'task', id: t.id }); }}>
                    {t.title}
                  </button>
                  <span className="desk-code">{t.code}</span> <Flags task={t} />
                </td>
                {show !== 'by' ? <td><Who name={t.to_name} you={t.to === me.key} /></td> : null}
                {show !== 'to' ? <td><Who name={t.by_name} you={t.by === me.key} /></td> : null}
                <td><span className={`desk-prio ${t.priority}`}>{priorityLabel(t.priority)}</span></td>
                <td><DueChip task={t} today={today} /></td>
                <td><StatusPill status={t.status} /></td>
                <td className="muted small">{ago(t.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <p className="empty">Nothing here.</p>
    );

  const ApprovalRows = ({ list }) =>
    list.length ? (
      <div className="table-wrap">
        <table className="sheet desk-table">
          <thead>
            <tr>
              <th>Request</th>
              <th>From</th>
              <th>To decide</th>
              <th className="num">Amount</th>
              <th>Status</th>
              <th>Asked</th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} className="desk-row" onClick={() => setOpen({ type: 'approval', id: a.id })}>
                <td className="desk-title">
                  <button className="link" onClick={(e) => { e.stopPropagation(); setOpen({ type: 'approval', id: a.id }); }}>
                    {a.title}
                  </button>
                  <span className="desk-code">{a.code}</span>
                </td>
                <td><Who name={a.by_name} you={a.by === me.key} /></td>
                <td><Who name={a.approver_name} you={a.approver === me.key} /></td>
                <td className="num">{a.amount != null ? `₹${rupees(a.amount)}` : '—'}</td>
                <td><StatusPill status={a.status} /></td>
                <td className="muted small">{ago(a.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <p className="empty">Nothing here.</p>
    );

  const Segments = ({ value, onChange, options = SEGMENTS }) => (
    <div className="sub-tabs toolbar">
      {options.map(([key, label]) => (
        <button key={key} className={value === key ? 'active' : undefined} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  );

  /* ------------------------------ the views ------------------------------ */

  const dash = () => {
    const attention = sortTasks(
      tasks.filter((t) => (t.to === me.key || t.by === me.key) && (isOverdue(t, today) || isStale(t))),
      today
    ).slice(0, 6);
    const forMe = approvals.filter((a) => canDecide(me, a));
    const kpis = [
      ['My open tasks', figures.my_open, () => go('mine', 'open')],
      ['Given by me, open', figures.given_open, () => go('given', 'open')],
      ['Waiting for my approval', figures.to_decide, () => { setView('approvals'); setApprScope('forme'); setApprSegment('open'); }],
      ['My requests, open', figures.my_requests_open, () => { setView('approvals'); setApprScope('mine'); setApprSegment('open'); }],
      ['Overdue', figures.overdue, () => go(figures.overdue && !mine.some((t) => isOverdue(t, today)) ? 'given' : 'mine', 'overdue'), 'bad'],
      ['No update in 2+ days', figures.stale, null, 'warn'],
    ];
    return (
      <>
        <div className="card desk-hello">
          <div>
            <h3>{me.name}</h3>
            <p className="muted small">
              {rankOf(me.level).label}
              {me.department ? ` · ${me.department}` : ''}
              {me.guessed ? ' · rank not set yet, worked out for now' : ''}
            </p>
          </div>
          <div className="desk-week" title="Of the work given to you: done in the last seven days, against that plus what is still open">
            <strong>{figures.week_percent == null ? '—' : `${figures.week_percent}%`}</strong>
            <span className="muted small">
              {figures.week_percent == null ? 'nothing on your desk this week' : `${figures.done_week} done this week`}
            </span>
          </div>
        </div>

        <div className="figures desk-figures">
          {kpis.map(([label, value, onClick, tone]) => (
            <div className="figure" key={label}>
              <span className="k">{label}</span>
              {onClick ? (
                <button className={`n${value && tone ? ` ${tone}` : ''}`} onClick={onClick}>{value}</button>
              ) : (
                <span className={`n${value && tone ? ` ${tone}` : ''}`}>{value}</span>
              )}
            </div>
          ))}
        </div>

        <div className="desk-grid">
          <section className="card">
            <h3>My open tasks</h3>
            <TaskRows list={sortTasks(mine.filter((t) => !isClosed(t)), today).slice(0, 8)} show="to" />
          </section>
          <section className="card">
            <h3>Waiting for your decision</h3>
            {forMe.length ? <ApprovalRows list={forMe.slice(0, 6)} /> : <p className="empty">Nobody is waiting on you.</p>}
            <h3 className="desk-second">Needs attention</h3>
            {attention.length ? (
              <TaskRows list={attention} />
            ) : (
              <p className="empty">Nothing overdue, nothing gone quiet.</p>
            )}
          </section>
        </div>
      </>
    );
  };

  const board = () => {
    const pool = scope === 'everyone' && seesAllTasks ? tasks : scope === 'given' ? given : mine;
    const list = pool.filter((t) => matches(t, query));
    const weekAgo = Date.now() - 7 * DAY;
    const columns = [
      ['Pending', list.filter((t) => t.status === 'Pending')],
      ['In Progress', list.filter((t) => t.status === 'In Progress')],
      ['Waiting', list.filter((t) => t.status === 'Waiting')],
      // A board that keeps every finished task is a board nobody can read.
      ['Done', list.filter((t) => t.status === 'Done' && Date.parse(t.done_at || '') > weekAgo)],
    ];
    return (
      <>
        <div className="toolbar">
          <Segments
            value={scope}
            onChange={setScope}
            options={[['mine', 'For me'], ['given', 'From me'], ...(seesAllTasks ? [['everyone', 'Everyone']] : [])]}
          />
          <span className="muted small">Done shows the last seven days. Click a card to move it.</span>
        </div>
        <div className="board">
          {columns.map(([title, items]) => (
            <div className="column" key={title}>
              <header>
                <span className="t">{title}</span>
                <span className="n">{items.length}</span>
              </header>
              <div className="stack">
                {sortTasks(items, today).map((t) => (
                  <button className="pcard desk-card" key={t.id} onClick={() => setOpen({ type: 'task', id: t.id })}>
                    <span className="desk-card-title">{t.title}</span>
                    <span className="meta">
                      <span className={`desk-prio ${t.priority}`}>{priorityLabel(t.priority)}</span>
                      <DueChip task={t} today={today} />
                    </span>
                    <span className="job">{t.to === me.key ? `from ${t.personal ? 'yourself' : t.by_name}` : `for ${t.to_name}`}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </>
    );
  };

  const approvalsView = () => {
    const pool =
      apprScope === 'all' && seesAllApprovals
        ? approvals
        : apprScope === 'mine'
          ? approvals.filter((a) => a.by === me.key)
          : approvals.filter((a) => a.approver === me.key);
    const list = pool
      .filter((a) =>
        apprSegment === 'all' ? true : apprSegment === 'open' ? approvalOpen(a) : a.status === apprSegment
      )
      .filter((a) => matches(a, query));
    return (
      <>
        <div className="toolbar">
          <Segments
            value={apprScope}
            onChange={setApprScope}
            options={[['forme', 'Waiting for me'], ['mine', 'My requests'], ...(seesAllApprovals ? [['all', 'Everybody’s']] : [])]}
          />
          <Segments
            value={apprSegment}
            onChange={setApprSegment}
            options={[['open', 'Open'], ['Approved', 'Approved'], ['Rejected', 'Rejected'], ['all', 'All']]}
          />
        </div>
        <div className="card">
          <ApprovalRows list={list} />
        </div>
        <p className="muted small">
          An approval here is a decision on record. It pays nobody — an expense is still paid from People → Claims, into a
          named month.
        </p>
      </>
    );
  };

  const departments = () => {
    const work = tasks.filter((t) => !t.personal);
    const byDept = tally(work, (t) => t.department, { today });
    const byPerson = tally(work, (t) => t.to, { today });
    const Table = ({ lines, person }) => (
      <div className="table-wrap">
        <table className="sheet desk-table">
          <thead>
            <tr>
              <th>{person ? 'Person' : 'Department'}</th>
              <th className="num">Open</th>
              <th className="num">Overdue</th>
              <th className="num">No update</th>
              <th className="num">Done (7d)</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className={`desk-row${pick === l.key ? ' picked' : ''}`} onClick={() => setPick(pick === l.key ? '' : l.key)}>
                <td>{person ? <Who name={byKey.get(l.key)?.name || work.find((t) => t.to === l.key)?.to_name || '—'} /> : <strong>{l.key}</strong>}</td>
                <td className="num">{l.open}</td>
                <td className={`num${l.overdue ? ' over' : ''}`}>{l.overdue}</td>
                <td className="num">{l.stale}</td>
                <td className="num">{l.done}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    const narrowed = pick ? work.filter((t) => t.department === pick || t.to === pick) : work;
    return (
      <>
        <div className="desk-grid">
          <section className="card">
            <h3>By department</h3>
            {byDept.length ? <Table lines={byDept} /> : <p className="empty">No work given out yet.</p>}
          </section>
          <section className="card">
            <h3>By person</h3>
            {byPerson.length ? <Table lines={byPerson} person /> : <p className="empty">No work given out yet.</p>}
          </section>
        </div>
        <div className="toolbar">
          <Segments value={segment} onChange={setSegment} />
          {pick ? (
            <button className="ghost" onClick={() => setPick('')}>
              {byKey.get(pick)?.name || pick} ✕
            </button>
          ) : null}
          <span className="muted small">{shown(narrowed).length} tasks · personal reminders are not counted</span>
        </div>
        <div className="card">
          <TaskRows list={shown(narrowed)} />
        </div>
      </>
    );
  };

  const listView = (list, show, blurb) => (
    <>
      <div className="toolbar">
        <Segments value={segment} onChange={setSegment} />
        <span className="muted small">{shown(list).length} · {blurb}</span>
      </div>
      <div className="card">
        <TaskRows list={shown(list)} show={show} />
      </div>
    </>
  );

  const VIEWS = [
    ['dash', 'Desk'],
    ['mine', `My tasks${figures.my_open ? ` (${figures.my_open})` : ''}`],
    ['given', 'Given by me'],
    ['board', 'Board'],
    ['approvals', `Approvals${figures.to_decide ? ` (${figures.to_decide})` : ''}`],
    ...(seesAllTasks ? [['departments', 'Departments']] : []),
    ...(data.can_manage ? [['ranks', 'People & ranks']] : []),
  ];
  const waitingLine = waitingSentence(data.waiting);

  return (
    <section className="stack desk">
      <div className="toolbar desk-top">
        <div className="sub-tabs toolbar">
          {VIEWS.map(([key, label]) => (
            <button key={key} className={view === key ? 'active' : undefined} onClick={() => go(key)}>
              {label}
            </button>
          ))}
        </div>
        <input
          className="search desk-search"
          type="search"
          placeholder="Search tasks and requests"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="desk-bell-wrap">
          <button className={`ghost desk-bell${data.unseen ? ' on' : ''}`} onClick={openBell} title="What other people have written on your work">
            Updates{data.unseen ? ` (${data.unseen})` : ''}
          </button>
          {bell ? (
            <div className="desk-bell-list card">
              {data.notifications.length ? (
                data.notifications.slice(0, 15).map((n) => (
                  <button
                    key={n.id}
                    className="desk-note"
                    onClick={() => { setBell(false); setOpen({ type: n.ref_type, id: n.ref_id }); }}
                  >
                    <span><strong>{n.by_name}</strong> on {n.code} — {n.title}</span>
                    <span className="muted small">{n.status ? `${n.status} · ` : ''}{n.body.slice(0, 90)} · {ago(n.created_at)}</span>
                  </button>
                ))
              ) : (
                <p className="empty">You are all caught up.</p>
              )}
            </div>
          ) : null}
        </div>
        <button className="primary" onClick={() => setAdding('task')}>New task</button>
        <button onClick={() => setAdding('approval')}>Request approval</button>
      </div>

      {me.shared ? (
        <p className="banner">
          You are signed in with the shared key, so the desk knows you only as “Office”. You can give work and see
          everything, but nobody can give you a task or send you a request — sign in with your own login for that
          (Admin → Logins).
        </p>
      ) : null}
      {waitingLine ? <p className="banner">Waiting on you: {waitingLine}</p> : null}

      {query && view === 'dash' ? (
        <>
          <div className="card"><h3>Tasks</h3><TaskRows list={sortTasks(tasks.filter((t) => matches(t, query)), today)} /></div>
          <div className="card"><h3>Requests</h3><ApprovalRows list={approvals.filter((a) => matches(a, query))} /></div>
        </>
      ) : null}
      {view === 'dash' && !query && dash()}
      {view === 'mine' && listView(mine, 'to', 'work given to you, and your own reminders')}
      {view === 'given' && listView(given, 'by', 'work you have given to other people')}
      {view === 'board' && board()}
      {view === 'approvals' && approvalsView()}
      {view === 'departments' && seesAllTasks && departments()}
      {view === 'ranks' && data.can_manage && <Ranks onError={onError} onChanged={load} />}

      {adding === 'task' ? (
        <NewTask
          me={me}
          people={people}
          assignable={data.assignable}
          onClose={() => setAdding(null)}
          onMade={(task) => { setAdding(null); load(); setOpen({ type: 'task', id: task.id }); }}
        />
      ) : null}
      {adding === 'approval' ? (
        <NewApproval
          people={people}
          approvers={data.approvers}
          onClose={() => setAdding(null)}
          onMade={(a) => { setAdding(null); load(); setOpen({ type: 'approval', id: a.id }); }}
        />
      ) : null}
      {open ? (
        <Detail
          key={`${open.type}-${open.id}`}
          open={open}
          me={me}
          today={today}
          onClose={() => setOpen(null)}
          onChanged={load}
        />
      ) : null}
    </section>
  );
}

/* ================================================================= *
 * the conversation under a task or a request
 * ================================================================= */

function Thread({ updates, me }) {
  if (!updates.length) return <p className="empty">Nothing said yet.</p>;
  return (
    <div className="desk-thread">
      {updates.map((u) =>
        u.system ? (
          <p className="desk-sys" key={u.id}>
            {u.by_name ? `${u.by_name}: ` : ''}{u.body} · {stamp(u.created_at)}
          </p>
        ) : (
          <div className={`desk-msg${u.by_key === me.key ? ' mine' : ''}`} key={u.id}>
            <span className="desk-avatar" aria-hidden="true">{initials(u.by_name)}</span>
            <div className="desk-bubble">
              <div className="desk-by">
                <strong>{u.by_key === me.key ? 'You' : u.by_name}</strong> {stamp(u.created_at)}
                {u.status ? <> · <StatusPill status={u.status} /></> : null}
              </div>
              {u.body}
            </div>
          </div>
        )
      )}
    </div>
  );
}

function Detail({ open, me, today, onClose, onChanged }) {
  const [got, setGot] = useState(null);
  const [text, setText] = useState('');
  const [move, setMove] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const isTask = open.type === 'task';
  const path = isTask ? `/desk/tasks/${open.id}` : `/desk/approvals/${open.id}`;

  useEffect(() => {
    let live = true;
    api.get(path).then((d) => live && setGot(d)).catch((err) => live && setProblem(err.message));
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => {
      live = false;
      document.removeEventListener('keydown', esc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const send = async (call) => {
    setBusy(true);
    setProblem('');
    try {
      setGot(await call());
      setText('');
      setMove('');
      onChanged();
    } catch (err) {
      // Said beside the box it is about, not in a banner behind this panel.
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };

  const item = got ? (isTask ? got.task : got.approval) : null;
  const moveLabel = (s) =>
    s === 'Done' ? 'Mark as done' : s === 'Pending' && item && isClosed(item) ? 'Reopen it' : `Move to ${s}`;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal desk-detail" role="dialog" aria-label={item?.title || 'Loading'}>
        {!item ? (
          <p className={problem ? 'banner bad' : 'muted'}>{problem || 'Loading…'}</p>
        ) : (
          <>
            <div className="desk-detail-head">
              <div>
                <p className="desk-detail-code">
                  <span className="desk-code">{item.code}</span> <StatusPill status={item.status} />{' '}
                  {isTask && item.personal ? <span className="tag">personal</span> : null}
                  {isTask && isStale(item) ? <span className="tag desk-quiet">no update 2d+</span> : null}
                </p>
                <h3>{item.title}</h3>
              </div>
              <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
            </div>

            <dl className="desk-meta">
              {isTask ? (
                <>
                  <div><dt>From</dt><dd><Who name={item.by_name} you={item.by === me.key} /></dd></div>
                  <div><dt>For</dt><dd><Who name={item.to_name} you={item.to === me.key} /></dd></div>
                  <div><dt>Priority</dt><dd><span className={`desk-prio ${item.priority}`}>{priorityLabel(item.priority)}</span></dd></div>
                  <div><dt>Due</dt><dd><DueChip task={item} today={today} /></dd></div>
                  <div><dt>Department</dt><dd>{item.department || '—'}</dd></div>
                  <div><dt>Given</dt><dd>{stamp(item.created_at)}</dd></div>
                </>
              ) : (
                <>
                  <div><dt>Asked by</dt><dd><Who name={item.by_name} you={item.by === me.key} /></dd></div>
                  <div><dt>To decide</dt><dd><Who name={item.approver_name} you={item.approver === me.key} /></dd></div>
                  <div><dt>Amount</dt><dd className="desk-amount">{item.amount != null ? `₹${rupees(item.amount)}` : '—'}</dd></div>
                  <div><dt>Asked</dt><dd>{stamp(item.created_at)}</dd></div>
                  <div><dt>Decided</dt><dd>{item.decided_at ? stamp(item.decided_at) : 'not yet'}</dd></div>
                </>
              )}
            </dl>

            {(isTask ? item.detail : item.details) ? <p className="desk-desc">{isTask ? item.detail : item.details}</p> : null}

            <h4 className="desk-sec">{isTask ? 'Conversation and progress' : 'Conversation and decision'}</h4>
            <Thread updates={got.updates} me={me} />

            {problem ? <p className="banner bad">{problem}</p> : null}

            {isTask && got.can_post ? (
              <div className="desk-reply">
                <textarea
                  rows={3}
                  value={text}
                  placeholder={item.personal ? 'A note for yourself…' : 'What happened, or what it is waiting for…'}
                  onChange={(e) => setText(e.target.value)}
                />
                <div className="desk-reply-acts">
                  {got.choices.length ? (
                    <select value={move} onChange={(e) => setMove(e.target.value)} aria-label="Move the task">
                      <option value="">Status stays {item.status}</option>
                      {got.choices.map((s) => (
                        <option key={s} value={s}>{moveLabel(s)}</option>
                      ))}
                    </select>
                  ) : null}
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => send(() => api.post(`${path}/updates`, { text, status: move || undefined }))}
                  >
                    {move === 'Done' ? 'Send and mark done' : 'Send'}
                  </button>
                </div>
              </div>
            ) : null}

            {!isTask && got.can_decide ? (
              <div className="desk-reply">
                <textarea
                  rows={3}
                  value={text}
                  placeholder="A note, a condition, or your question (needed for a query)…"
                  onChange={(e) => setText(e.target.value)}
                />
                <div className="desk-reply-acts">
                  <button disabled={busy} onClick={() => send(() => api.post(`${path}/decide`, { decision: 'Query', note: text }))}>
                    Ask a question
                  </button>
                  <button className="danger" disabled={busy} onClick={() => send(() => api.post(`${path}/decide`, { decision: 'Rejected', note: text }))}>
                    Reject
                  </button>
                  <button className="primary" disabled={busy} onClick={() => send(() => api.post(`${path}/decide`, { decision: 'Approved', note: text }))}>
                    Approve
                  </button>
                </div>
                <p className="muted small">Approving records the decision. It pays nobody.</p>
              </div>
            ) : null}

            {!isTask && !got.can_decide && got.can_comment ? (
              <div className="desk-reply">
                <textarea
                  rows={2}
                  value={text}
                  placeholder={item.status === 'Query' && item.by === me.key ? 'Answer the question — it goes back to them to decide…' : 'Add a comment…'}
                  onChange={(e) => setText(e.target.value)}
                />
                <div className="desk-reply-acts">
                  <button className="primary" disabled={busy} onClick={() => send(() => api.post(`${path}/updates`, { text }))}>
                    Send
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/* ================================================================= *
 * the two forms
 * ================================================================= */

function Sheet({ title, children, onClose }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal desk-form" role="dialog" aria-label={title}>
        <div className="desk-detail-head">
          <h3>{title}</h3>
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** People grouped by their rung, highest first, for a select. */
function PeopleOptions({ people }) {
  return RANKS.map((rank) => {
    const here = people.filter((p) => p.level === rank.level);
    if (!here.length) return null;
    return (
      <optgroup key={rank.key} label={rank.label}>
        {here.map((p) => (
          <option key={p.key} value={p.key}>
            {p.name}{p.department ? ` — ${p.department}` : ''}
          </option>
        ))}
      </optgroup>
    );
  });
}

function NewTask({ me, people, assignable, onClose, onMade }) {
  const [draft, setDraft] = useState({ title: '', to: '', due_on: tomorrow(), priority: 'normal', detail: '' });
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const can = new Set(assignable);
  const others = people.filter((p) => can.has(p.key));
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    if (!draft.title.trim()) return setProblem('What needs to be done? Give it a title.');
    if (!draft.to) return setProblem('Choose who it is for — yourself, for a personal reminder.');
    setBusy(true);
    setProblem('');
    try {
      onMade(await api.post('/desk/tasks', draft));
    } catch (err) {
      setProblem(err.message);
      setBusy(false);
    }
    return undefined;
  };

  return (
    <Sheet title="New task" onClose={onClose}>
      <div className="form-grid desk-form-grid">
        <label className="wide">
          <span className="ef-text">What needs to be done? <span className="ef-star">*</span></span>
          <input autoFocus value={draft.title} placeholder="e.g. Renew Goa hotel contract" onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label>
          <span className="ef-text">Who is it for? <span className="ef-star">*</span></span>
          <select value={draft.to} onChange={(e) => set({ to: e.target.value })}>
            <option value="">Select a person…</option>
            <option value={me.key}>Myself (a personal reminder)</option>
            <PeopleOptions people={others} />
          </select>
        </label>
        <label>
          Due date
          <input type="date" value={draft.due_on} onChange={(e) => set({ due_on: e.target.value })} />
        </label>
        <label>
          Priority
          <select value={draft.priority} onChange={(e) => set({ priority: e.target.value })}>
            {PRIORITIES.map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
        <label className="wide">
          Details (optional)
          <textarea rows={3} value={draft.detail} placeholder="Context, links, what done looks like…" onChange={(e) => set({ detail: e.target.value })} />
        </label>
      </div>
      {!others.length ? (
        <p className="muted small">
          You can set reminders for yourself. Giving work to other people is for whoever they report to, and for Heads of
          Department and above.
        </p>
      ) : (
        <p className="muted small">
          They will see it on their own desk the next time they open it. Nothing is emailed or sent.
        </p>
      )}
      {problem ? <p className="banner bad">{problem}</p> : null}
      <div className="desk-form-acts">
        <button className="ghost" onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy} onClick={save}>
          {draft.to === me.key ? 'Add the reminder' : 'Give the task'}
        </button>
      </div>
    </Sheet>
  );
}

function NewApproval({ people, approvers, onClose, onMade }) {
  // Kept in the order the server sent: their own manager first.
  const list = approvers.map((key) => people.find((p) => p.key === key)).filter(Boolean);
  const [draft, setDraft] = useState({ title: '', approver: list[0]?.key || '', amount: '', details: '' });
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    if (!draft.title.trim()) return setProblem('What needs approval? Give it a title.');
    if (!draft.approver) return setProblem('Choose who should approve it.');
    setBusy(true);
    setProblem('');
    try {
      onMade(await api.post('/desk/approvals', draft));
    } catch (err) {
      setProblem(err.message);
      setBusy(false);
    }
    return undefined;
  };

  return (
    <Sheet title="Request approval" onClose={onClose}>
      {!list.length ? (
        <p className="banner">
          Nobody is above you on the desk, so there is nobody to send a request to. Requests come up to you.
        </p>
      ) : (
        <>
          <div className="form-grid desk-form-grid">
            <label className="wide">
              <span className="ef-text">What needs approval? <span className="ef-star">*</span></span>
              <input autoFocus value={draft.title} placeholder="e.g. Canton Fair stall booking advance" onChange={(e) => set({ title: e.target.value })} />
            </label>
            <label>
              <span className="ef-text">Who should approve it? <span className="ef-star">*</span></span>
              <select value={draft.approver} onChange={(e) => set({ approver: e.target.value })}>
                {list.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name} ({rankOf(p.level).key})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount ₹ (optional)
              <input type="number" min="0" value={draft.amount} placeholder="0" onChange={(e) => set({ amount: e.target.value })} />
            </label>
            <label className="wide">
              Details
              <textarea rows={4} value={draft.details} placeholder="Reason, vendor, terms, deadline…" onChange={(e) => set({ details: e.target.value })} />
            </label>
          </div>
          <p className="muted small">
            They will see it on their desk. An approval records the decision — it does not pay anything.
          </p>
          {problem ? <p className="banner bad">{problem}</p> : null}
          <div className="desk-form-acts">
            <button className="ghost" onClick={onClose}>Cancel</button>
            <button className="primary" disabled={busy} onClick={save}>Send for approval</button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ================================================================= *
 * who stands where - an Admin's two settings
 * ================================================================= */

function Ranks({ onError, onChanged }) {
  const [settings, setSettings] = useState(null);
  const [find, setFind] = useState('');
  const [onlySet, setOnlySet] = useState(false);

  useEffect(() => {
    api.get('/desk/settings').then(setSettings).catch(onError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!settings) return <p className="muted">Loading…</p>;

  const put = async (path, body) => {
    try {
      setSettings(await api.put(path, body));
      onChanged();
    } catch (err) {
      onError(err);
    }
  };
  const employees = settings.people.filter((p) => !p.office);
  const shown = settings.people
    .filter((p) => (onlySet ? !p.guessed : true))
    .filter((p) => `${p.name} ${p.department} ${p.designation}`.toLowerCase().includes(find.trim().toLowerCase()))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const guessed = settings.people.filter((p) => p.guessed).length;

  return (
    <>
      <div className="card">
        <h3>Which office login is which employee</h3>
        <p className="muted small">
          An office login is somebody on the desk in its own right. Where that person is also on the staff list, tie the
          two together — otherwise they are on the desk twice, and work given to one of them is never seen by the other.
          Tying moves what the login already has onto the employee; untying does not move it back.
        </p>
        {settings.logins.length ? (
          <div className="table-wrap">
            <table className="sheet desk-table">
              <thead>
                <tr><th>Login</th><th>Role</th><th>Is this employee</th></tr>
              </thead>
              <tbody>
                {settings.logins.map((l) => (
                  <tr key={l.user_id}>
                    <td>{l.name} <span className="muted small">{l.username}</span></td>
                    <td>{l.role}</td>
                    <td>
                      <select
                        value={l.employee_id || ''}
                        onChange={(e) => put(`/desk/logins/${l.user_id}`, { employee_id: e.target.value ? Number(e.target.value) : null })}
                      >
                        <option value="">Not on the staff list</option>
                        {employees.map((p) => (
                          <option key={p.key} value={p.key.slice(2)}>{p.name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">There are no office logins yet — Admin → Logins makes them.</p>
        )}
      </div>

      <div className="card">
        <h3>Who stands where</h3>
        <p className="muted small">
          A rank decides who somebody can give work to and send requests to, and — from General Manager up — whose work
          they can see. {guessed} of {settings.people.length} have not been set and are worked out for now: an Admin
          login as MD, a Manager login as GM, other office logins as Senior Manager, anybody with people reporting to
          them as Head of Department, and everybody else as Staff.
        </p>
        <div className="toolbar">
          <input className="search" type="search" placeholder="Find somebody" value={find} onChange={(e) => setFind(e.target.value)} />
          <label className="inline small">
            <input type="checkbox" checked={onlySet} onChange={(e) => setOnlySet(e.target.checked)} /> only the ones that were set
          </label>
        </div>
        <div className="table-wrap">
          <table className="sheet desk-table">
            <thead>
              <tr><th>Person</th><th>Department</th><th>Rank</th><th /></tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.key}>
                  <td>{p.name}{p.office ? <span className="tag">office login</span> : null}</td>
                  <td className="muted">{p.department || '—'}{p.designation ? ` · ${p.designation}` : ''}</td>
                  <td>
                    <select value={p.level} onChange={(e) => put(`/desk/ranks/${encodeURIComponent(p.key)}`, { level: Number(e.target.value) })}>
                      {RANKS.map((r) => (
                        <option key={r.key} value={r.level}>{r.key} — {r.label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {p.guessed ? (
                      <span className="muted small">worked out</span>
                    ) : (
                      <button className="ghost tiny" onClick={() => put(`/desk/ranks/${encodeURIComponent(p.key)}`, { level: null })}>
                        hand back
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
