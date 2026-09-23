import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import TaskItem, { AssignButton } from './TaskItem.jsx';
import { api } from '../api.js';
import { lastActivityLabel, pipeline, peopleFrom, soonestFirst, stageCounts, stageOf } from '../lib/pipeline.js';

/**
 * Work between the user and other people, read from whichever end you are on.
 *
 * **Task received** is what somebody has asked him for. It is his to do, so it
 * behaves like any other task; the only thing this view adds is who asked, so
 * he can see at a glance that four of today's six came from one person.
 *
 * **Task allotted** is what he has handed out. It is still his to chase - the
 * app reminds *him*, never the assignee - so each row carries a Nudge button
 * that composes a message and sends it only when pressed. Nothing on this page
 * messages anybody on its own.
 */

const ago = (iso) => {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return '';
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

/**
 * One person, and everything on their side of the ledger.
 *
 * The rows are the app's own task rows, not a second design: the same one-line
 * shape, the same checkbox, the same ⋮ menu. Grouping by person is the only
 * thing this page changes about how a task is read.
 */
function Person({ person, tasks, side, actions, onNudge }) {
  const [shut, setShut] = useState(false);
  const key = side === 'allotted' ? 'assigned_to' : 'requested_by';
  const mine = tasks.filter((t) => t[key] === person.name);
  if (!mine.length) return null;

  return (
    <section className="section tone-plain">
      <button className="section-head" aria-expanded={!shut} onClick={() => setShut((v) => !v)}>
        <Icon name="person" size={17} className="section-icon" />
        <h3>{person.name}</h3>
        <span className="section-count">{mine.length}</span>
        {side === 'allotted' && person.last_at && (
          <span className="section-note">given {ago(person.last_at)}</span>
        )}
        <Icon name="chevronDown" size={17} className={`section-chevron ${shut ? '' : 'up'}`} />
      </button>

      {!shut && (
        <ul className="task-list">
          {mine.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              {...actions}
              extra={side === 'allotted' && task.status !== 'done' ? (
                <button
                  className="btn ghost small nudge"
                  onClick={() => onNudge(task)}
                  title={`Write a WhatsApp message to ${task.assigned_to}`}
                >
                  <Icon name="whatsapp" size={14} /> Nudge
                </button>
              ) : null}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * "Which chat is Nidhi?"
 *
 * Reported as *"unable to send msg"*. A task handed over by typing a name
 * carries the name and nothing else, so the button had no chat to send to -
 * and the old answer, a red line saying so, left him with one road: find her
 * number, go to another page, type fifteen digits. Meanwhile his phone has had
 * her chat open for months.
 *
 * So the question is asked where it arises, and answered with what the app
 * already knows: the one-to-one chats it has actually seen, searched by the
 * name he would recognise. A number can still be typed, for somebody who has
 * never written to him.
 *
 * **It never guesses.** Typing "nidhi" offers every Nidhi it has seen, most
 * recent first, with the number under each - and nothing is sent until one is
 * chosen. Picking the wrong chat here sends a person's work to a stranger,
 * which is the one mistake this panel exists to make impossible to do by
 * accident. Groups are not offered at all: a nudge names one person.
 */
function ChatPicker({ task, onError, onPicked }) {
  const [term, setTerm] = useState(task.assigned_to || '');
  const [hits, setHits] = useState(null);
  const [busy, setBusy] = useState(false);

  /* Search as he types, a beat behind, so it does not fire on every key. */
  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) { setHits(null); return undefined; }
    const timer = setTimeout(() => {
      api.findChats(q).then((d) => setHits(d.chats)).catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [term]);

  const choose = async (wid) => {
    setBusy(true);
    try {
      await api.setAssigneeChat(task.id, wid);
      onPicked();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const digits = term.replace(/\D/g, '');
  const couldBeNumber = digits.length >= 8 && digits.length <= 15;

  return (
    <div className="chat-pick">
      <p className="banner warn prose">
        No WhatsApp chat is known for <b>{task.assigned_to}</b> yet. Pick their chat once and
        every task of theirs can reach them.
      </p>

      <label className="field">
        <span>Search your chats</span>
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Name or number"
          autoFocus
        />
      </label>

      {hits === null ? (
        <p className="hint">Type at least two letters of the name as it appears in WhatsApp.</p>
      ) : hits.length === 0 ? (
        <p className="hint">
          No chat here matches “{term.trim()}”. This app only offers chats it has actually
          seen — if they have never written to you, type their number instead.
        </p>
      ) : (
        <ul className="chat-hits">
          {hits.map((chat) => (
            <li key={chat.id}>
              <button disabled={busy} onClick={() => choose(chat.id)}>
                <span className="ch-name">{chat.name || <i>Unnamed chat</i>}</span>
                <span className="ch-meta">
                  {chat.number || chat.id}
                  {chat.messages ? ` · ${chat.messages} message${chat.messages === 1 ? '' : 's'}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {couldBeNumber && (
        <button className="btn ghost small" disabled={busy} onClick={() => choose(digits)}>
          Use the number {digits}
        </button>
      )}

      <p className="field-note">
        Saved against {task.assigned_to} on the staff list too, so you are asked this once.
      </p>
    </div>
  );
}

/**
 * The nudge, shown in full before it goes anywhere.
 *
 * The text is editable and is exactly what gets sent - a preview that differed
 * from the message would be worse than no preview. Sending happens on this
 * button and nowhere else in the app.
 */
function NudgeSheet({ task, onClose, onSent, onError, onChanged }) {
  const [preview, setPreview] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.nudgePreview(task.id)
      .then((p) => { setPreview(p); setText((t) => t || p.text); })
      .catch(onError);
  }, [task.id, onError]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    setBusy(true);
    try {
      await api.sendNudge(task.id, text);
      onSent();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  /*
   * Rendered onto the body rather than in place. `.page > *` is a stacking
   * context, so a sheet mounted inside it sits under the sticky top bar however
   * high its z-index goes - which cut the heading off. Every other sheet in the
   * app is mounted at the root; this is the same thing said with a portal.
   */
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-label={`Follow up with ${task.assigned_to}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-head">
          <h2>Follow up with {task.assigned_to}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="sheet-body">
          <p className="muted">
            This sends one WhatsApp message, now, to {task.assigned_to}. It is the only thing
            in the app that messages anybody but you — reminders and follow-ups always come
            to you, never to them.
          </p>

          {preview && !preview.can_send && (
            preview.wid
              ? <p className="banner error">WhatsApp is not connected right now.</p>
              : (
                <ChatPicker
                  task={task}
                  onError={onError}
                  onPicked={() => { load(); onChanged?.(); }}
                />
              )
          )}

          <label className="field">
            <span>Message</span>
            <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
        </div>

        <footer className="sheet-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={busy || !text.trim() || !preview?.can_send}
            onClick={send}
          >
            {busy ? 'Sending…' : 'Send on WhatsApp'}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

/**
 * Recording a handover by hand.
 *
 * The extractor catches work handed over in a chat. Plenty is not: agreed on a
 * call, said across a desk, decided in a meeting. Those never touch WhatsApp,
 * so no amount of reading messages will ever find them — and without this the
 * page can only ever show half of what he has given out.
 *
 * Three fields, because three is what the page is asking: who, what, and by
 * when. Everything else a task can carry is in the drawer afterwards.
 */
function GiveSheet({ onClose, onSaved, onError }) {
  const [form, setForm] = useState({ name: '', title: '', date: '', time: '18:00' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const isoDay = (offset) => {
    const at = new Date();
    at.setDate(at.getDate() + offset);
    return at.toISOString().slice(0, 10);
  };

  const save = async (e) => {
    e.preventDefault();
    const name = form.name.trim();
    const title = form.title.trim();
    if (!name || !title) return;

    setBusy(true);
    try {
      await api.createTask({
        title,
        assigned_to: name,
        due_date: form.date || null,
        // The deadline is a moment when one was given, so it enters the same
        // reminder ladder as anything else - and the reminders come to you.
        due_at: form.date ? new Date(`${form.date}T${form.time || '18:00'}:00`).toISOString() : null,
      });
      onSaved();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <form
        className="sheet"
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        aria-label="Give someone a task"
      >
        <header className="sheet-head">
          <h2>Give someone a task</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="sheet-body">
          <label className="field">
            <span>Who is doing it</span>
            <input value={form.name} onChange={set('name')} placeholder="Rahul" autoFocus />
          </label>

          <label className="field">
            <span>What they have to do</span>
            <input value={form.title} onChange={set('title')} placeholder="Send the GST documents" />
          </label>

          <div className="field-row">
            <label className="field">
              <span>By when</span>
              <input type="date" value={form.date} onChange={set('date')} />
              <div className="quick-dates">
                <button type="button" className="link" onClick={() => setForm((f) => ({ ...f, date: isoDay(0) }))}>today</button>
                <button type="button" className="link" onClick={() => setForm((f) => ({ ...f, date: isoDay(1) }))}>tomorrow</button>
                {form.date && (
                  <button type="button" className="link" onClick={() => setForm((f) => ({ ...f, date: '' }))}>clear</button>
                )}
              </div>
            </label>
            <label className="field">
              <span>Time</span>
              <input type="time" value={form.time} onChange={set('time')} disabled={!form.date} />
            </label>
          </div>

          <p className="field-note">
            The reminders come to you, not to them. Chasing them is the Nudge button on the
            row, and only when you press it.
          </p>
        </div>

        <footer className="sheet-foot">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            className="btn primary"
            disabled={busy || !form.name.trim() || !form.title.trim()}
          >
            {busy ? 'Saving…' : 'Add'}
          </button>
        </footer>
      </form>
    </div>,
    document.body
  );
}

const VIEW_STORE = 'wa.allotted.view';

const readView = () => {
  try { return localStorage.getItem(VIEW_STORE) === 'list' ? 'list' : 'pipeline'; }
  catch { return 'pipeline'; }
};

const when = (iso) => {
  if (!iso) return null;
  const at = new Date(String(iso).includes('T') ? iso : `${String(iso).replace(' ', 'T')}Z`);
  if (Number.isNaN(at.getTime())) return null;
  const today = at.toLocaleDateString('en-CA') === new Date().toLocaleDateString('en-CA');
  return at.toLocaleString([], {
    hour: 'numeric', minute: '2-digit',
    ...(today ? {} : { day: 'numeric', month: 'short' }),
  });
};

/**
 * Taking a task off this page.
 *
 * Asked as "how to delet task from here": every row here carried a Nudge and
 * nothing else, so the one page that fills up with work you have handed out -
 * and with the copies and the false positives that come with it - was the one
 * page you could not clear. The board has had this on its ⋮ menu all along;
 * this page draws its own rows, which is why it never inherited it.
 *
 * It **archives**, exactly like the board's delete: the task, its history and
 * its completion survive and stay searchable in Work History, its reminders
 * stop, and one press of Undo puts it back. That is why there is no "are you
 * sure" - a confirm buys nothing a working undo does not, and it costs a click
 * on every single row.
 */
function RemoveButton({ task, onDelete }) {
  if (!onDelete) return null;
  return (
    <button
      className="tool danger-tool"
      onClick={() => onDelete(task)}
      title="Take it off this list - it stays in Work History, and Undo puts it back"
      aria-label={`Remove ${task.title}`}
    >
      Delete
    </button>
  );
}

/** One delegated task, the same card in both views. */
function Card({ task, onOpen, onNudge, onDelete, people, onAssign }) {
  const activity = lastActivityLabel(task);
  return (
    <li className="al-card">
      <button className="al-title" onClick={() => onOpen(task)}>{task.title}</button>
      {/*
        * Who has it, as the control that moves it.
        *
        * It used to be a line of text - the one fact this page is organised
        * by, and the one thing you could not change without going back to the
        * board and finding the row again.
        */}
      <p className="al-who">
        {onAssign
          ? <AssignButton task={task} people={people} onAssign={onAssign} />
          : <><Icon name="person" size={12} /> {task.assigned_to}</>}
        {task.group_name && <span className="al-group">{task.group_name}</span>}
      </p>
      <p className="al-facts">
        {task.due_at
          ? <span className={task.state === 'overdue' ? 'danger-text' : ''}>Due {when(task.due_at)}</span>
          : <span className="muted">No deadline</span>}
        {task.next_follow_up_at && task.state === 'overdue' && (
          <span className="al-follow"><Icon name="refresh" size={11} /> {when(task.next_follow_up_at)}</span>
        )}
        {task.follow_up_count > 0 && (
          <span className="muted">
            {task.follow_up_count >= task.follow_up_max
              ? `all ${task.follow_up_max} follow-ups spent`
              : `follow-up ${task.follow_up_count} of ${task.follow_up_max}`}
          </span>
        )}
      </p>
      {activity && <p className="al-activity">{activity}</p>}
      <div className="al-acts">
        {task.status !== 'done' && (
          <button className="tool" onClick={() => onNudge(task)}>Nudge</button>
        )}
        <RemoveButton task={task} onDelete={onDelete} />
      </div>
    </li>
  );
}

/**
 * The pipeline: one column per stage.
 *
 * Every stage is derived from what a task already is — status, deadline,
 * follow-up counter — so nothing here can disagree with the task itself, and a
 * task moves between columns because the facts changed, not because somebody
 * dragged it.
 */
function Board({ stages, onOpen, onNudge, onDelete, people, onAssign }) {
  return (
    <div className="al-board">
      {stages.map((stage) => (
        <section className="al-col" key={stage.key}>
          <header className="al-col-head">
            <h4>{stage.label}</h4>
            <span className="board-count">{stage.items.length}</span>
          </header>
          {stage.items.length === 0
            ? <p className="board-empty">Nothing here.</p>
            : <ul className="al-list">
                {stage.items.map((t) => (
                  <Card key={t.id} task={t} onOpen={onOpen} onNudge={onNudge}
                    onDelete={onDelete} people={people} onAssign={onAssign} />
                ))}
              </ul>}
        </section>
      ))}
    </div>
  );
}

/** The same work as rows, for reading down rather than across. */
function Rows({ tasks, onOpen, onNudge, onDelete, people, onAssign }) {
  if (!tasks.length) return <p className="board-empty">Nothing in this stage.</p>;
  return (
    <ul className="al-rows">
      {[...tasks].sort(soonestFirst).map((task) => {
        const stage = stageOf(task);
        const activity = lastActivityLabel(task);
        return (
          <li key={task.id}>
            <div className="al-row-main">
              <button className="al-title" onClick={() => onOpen(task)}>{task.title}</button>
              <span className="al-row-meta">
                {/* The same control as the board and the cards: who has it,
                    and the way to hand it to somebody else. */}
                {onAssign
                  ? <AssignButton task={task} people={people} onAssign={onAssign} />
                  : <><Icon name="person" size={12} /> {task.assigned_to}</>}
                {task.group_name && <span className="al-group">{task.group_name}</span>}
                {activity && <span className="muted">{activity}</span>}
              </span>
            </div>
            <span className={`al-stage s-${stage.key}`}>{stage.label}</span>
            <span className="al-row-due">
              {task.due_at
                ? <span className={task.state === 'overdue' ? 'danger-text' : ''}>{when(task.due_at)}</span>
                : <span className="muted">No deadline</span>}
            </span>
            <span className="al-acts">
              {task.status !== 'done' && (
                <button className="tool" onClick={() => onNudge(task)}>Nudge</button>
              )}
              <RemoveButton task={task} onDelete={onDelete} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The people work can be handed to.
 *
 * Asked for as "staff ma name me staff ka name add karne de". Until now this
 * list was derived from tasks already assigned, so a person who had never been
 * given anything did not exist: his name had to be typed from scratch each
 * time, and one typo made a second person with a section of their own.
 *
 * It still fills itself — a name typed on a row is remembered — so this is for
 * putting the team in before the first task, not a form to keep up to date.
 *
 * Nothing here can message anybody. The number is optional and is only ever
 * used by the Nudge button, which sends one message when a person presses it.
 */
function StaffList({ onError, onChanged }) {
  const [staff, setStaff] = useState(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');

  const load = useCallback(() => {
    api.staff().then((d) => setStaff(d.staff)).catch(() => setStaff([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      await api.addStaff(name.trim(), number.trim() || null);
      setName('');
      setNumber('');
      load();
      onChanged?.();
    } catch (err) { onError(err); }
  };

  const remove = async (person) => {
    try {
      await api.removeStaff(person.id);
      load();
      onChanged?.();
    } catch (err) { onError(err); }
  };

  if (!staff) return null;

  return (
    <section className="staff-panel">
      <button className="link staff-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide' : 'Manage'} staff{staff.length ? ` (${staff.length})` : ''}
      </button>

      {open && (
        <div className="staff-body">
          <p className="hint">
            Names here are offered by the <b>Staff</b> button on every task, so you
            do not have to type them. A name you type on a row is added here by
            itself. Nobody is ever messaged from this list — the number is only for
            the Nudge button, which sends one message when you press it.
          </p>

          <form className="add-row" onSubmit={add}>
            <input
              className="grow"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              autoComplete="off"
            />
            <input
              className="staff-number"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="WhatsApp number (optional)"
              inputMode="numeric"
              autoComplete="off"
            />
            <button className="btn primary" type="submit" disabled={!name.trim()}>Add</button>
          </form>

          {staff.length > 0 && (
            <ul className="staff-rows">
              {staff.map((person) => (
                <li key={person.id}>
                  <Icon name="person" size={14} />
                  <span className="staff-name">{person.name}</span>
                  {person.number && <span className="muted">{person.number}</span>}
                  {/* Their tasks stay exactly where they are; this only stops the
                      name being offered. */}
                  <button
                    className="chip-x"
                    onClick={() => remove(person)}
                    title="Take off the list — their tasks are not touched"
                    aria-label={`Remove ${person.name} from the staff list`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export default function Delegation({ side, onOpenTask, onError, onChanged, wa }) {
  const [data, setData] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const [nudging, setNudging] = useState(null);
  // Recording a handover by hand. The extractor catches the ones written in a
  // chat; this is for the ones agreed on a call, or in the room.
  const [giving, setGiving] = useState(false);
  const [sent, setSent] = useState(null);
  // The last task taken off the page, held so one press puts it back.
  const [removed, setRemoved] = useState(null);
  // The pipeline's own controls: which layout, which stage, whose work.
  const [view, setView] = useState(readView);
  const [stage, setStage] = useState(null);
  const [who, setWho] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.delegation(showDone ? 'all' : 'open'));
    } catch (err) {
      onError(err);
    }
  }, [showDone, onError]);

  useEffect(() => { load(); }, [load]);

  /*
   * Every change goes through PATCH /api/tasks/:id, the same call the main
   * board makes - so finishing something here cancels its reminders exactly as
   * it would anywhere else. Grouping by person changes what is shown, never
   * what a change to a task means.
   */
  const patch = async (id, body) => {
    try {
      await api.updateTask(id, body);
      await load();
      onChanged?.();
    } catch (err) {
      onError(err);
    }
  };

  const isoDay = (offset) => {
    const at = new Date();
    at.setDate(at.getDate() + offset);
    return at.toISOString().slice(0, 10);
  };

  const actions = {
    onToggle: (task) => patch(task.id, { status: task.status === 'done' ? 'open' : 'done' }),
    onOpen: (task) => onOpenTask(task.id),
    onStatus: (task, status) => patch(task.id, { status }),
    // Same rename as the board: F2 or a double-click on the title.
    onRename: (task, title) => patch(task.id, { title }),
    onQuickDate: (task, offset) => patch(task.id, { due_date: isoDay(offset) }),
    /*
     * Moving it to somebody else, from this page.
     *
     * Asked as "allotted me staff ke sath move karne wala option bana he?" -
     * and it was not. The board had the Staff button; the page that exists to
     * hold delegated work did not, so the one screen you read when you are
     * deciding who is doing what was the one screen that could not change it.
     * Passing an empty name gives it back, which is the same control saying
     * "nobody" - exactly as it behaves on the board.
     */
    people: side === 'allotted' ? (data?.people?.allotted || []) : [],
    /*
     * Only the allotted side can hand work on. Task received is work somebody
     * asked HIM for: there is no assignee on it to move, and the control there
     * would offer to give away a task that was never given to anybody.
     */
    onAssign: side !== 'allotted' ? undefined : async (task, name, wid) => {
      try {
        await api.assign(task.id, name, wid);
        await load();
        onChanged?.();
      } catch (err) {
        onError(err);
      }
    },
    /*
     * Archive, never destroy - the same call the board's delete makes.
     *
     * The confirm that used to sit here was replaced by the undo below: a
     * dialog asks before the mistake and an undo fixes it after, and only one
     * of those costs a click on every row you meant to remove.
     */
    onDelete: async (task) => {
      try {
        await api.deleteTask(task.id);
        setRemoved({ id: task.id, title: task.title });
        await load();
        onChanged?.();
      } catch (err) {
        onError(err);
      }
    },
  };

  const undoRemove = async () => {
    if (!removed) return;
    const last = removed;
    setRemoved(null);
    try {
      await api.restoreTask(last.id);
      await load();
      onChanged?.();
    } catch (err) {
      onError(err);
    }
  };

  if (!data) return <p className="muted">Loading…</p>;

  const tasks = side === 'allotted' ? data.allotted : data.received;
  const people = side === 'allotted' ? data.people.allotted : data.people.received;
  const listed = new Set(tasks.map((t) => (side === 'allotted' ? t.assigned_to : t.requested_by)));
  const shown = people.filter((p) => listed.has(p.name));

  // Person first, then stage — so a stage column shows that person's work in
  // it rather than everybody's, which is how the two filters are read together.
  const scoped = who ? tasks.filter((t) => t.assigned_to === who) : tasks;
  const stages = pipeline(scoped);
  const counts = stageCounts(scoped);
  const pipelinePeople = peopleFrom(tasks);
  const pickView = (next) => {
    setView(next);
    try { localStorage.setItem(VIEW_STORE, next); } catch { /* private window */ }
  };

  return (
    <div className="deleg">
      <div className="toolbar">
        {side === 'allotted' && (
          <button className="btn primary" onClick={() => setGiving(true)}>
            <span aria-hidden="true">+</span> Give someone a task
          </button>
        )}
        <label className="check-inline">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          <span>Include finished</span>
        </label>
        <span className="muted">
          {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} across {shown.length}{' '}
          {shown.length === 1 ? 'person' : 'people'}
        </span>
        {side === 'allotted' && <StaffList onError={onError} onChanged={load} />}
      </div>

      {/*
        * Always, not only on an empty page.
        *
        * It was shown only when there was nothing here, so the moment one task
        * appeared - a manual one - the figure that explains the automatic ones
        * disappeared with it. Which is exactly when it is needed: the page is
        * no longer empty and the pipeline is still not working.
        */}
      {side === 'allotted' && wa && (
        <p className="deleg-counts">
          Read from your own messages: <b>{wa.ownSeenEver ?? 0}</b>
          {typeof wa.ownSeen === 'number' && wa.ownSeen !== wa.ownSeenEver && ` (${wa.ownSeen} since this server started)`}
          {' · '}handed to somebody by Claude: <b>{wa.delegatedEver ?? 0}</b>
          {!wa.ownSeenEver && ' — nothing you have written has been read at all, which is a connection problem rather than a wording one.'}
        </p>
      )}

      {sent && (
        <p className="banner ok" role="status">
          Sent to {sent}. <button className="link" onClick={() => setSent(null)}>Dismiss</button>
        </p>
      )}

      {removed && (
        <p className="banner ok undo-bar" role="status">
          <span>
            Took <b>{removed.title}</b> off this list. It is in Work History.
          </span>
          <button className="link" onClick={undoRemove}>Undo</button>
          <button className="link" onClick={() => setRemoved(null)}>Dismiss</button>
        </p>
      )}

      {/*
        * The pipeline, on the allotted side only.
        *
        * "What have I given, to whom, what state is it in, and who needs
        * chasing" is one question, and it was being answered by scrolling a
        * list of people. Every stage below is derived from the task itself —
        * nothing new is stored, and no assignee needs an account to appear in
        * it, because what identifies them is the name already on the task.
        */}
      {side === 'allotted' && tasks.length > 0 && (
        <>
          <div className="al-summary">
            <button
              className={`al-count ${!stage ? 'on' : ''}`}
              onClick={() => setStage(null)}
            >
              <b>{counts.total}</b><span>Total</span>
            </button>
            {stages.map((s) => (
              <button
                key={s.key}
                className={`al-count ${stage === s.key ? 'on' : ''}`}
                title={s.note}
                onClick={() => setStage(stage === s.key ? null : s.key)}
              >
                <b>{s.items.length}</b><span>{s.label}</span>
              </button>
            ))}
          </div>

          {pipelinePeople.length > 1 && (
            <div className="al-people">
              {pipelinePeople.map((p) => (
                <button
                  key={p.name}
                  className={`al-person ${who === p.name ? 'on' : ''}`}
                  onClick={() => setWho(who === p.name ? null : p.name)}
                >
                  <b>{p.name}</b>
                  <span>
                    {p.active} active
                    {p.overdue > 0 && <span className="danger-text"> · {p.overdue} overdue</span>}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="al-head">
            <div className="board-views" role="group" aria-label="How to show the work">
              <button
                className={view === 'pipeline' ? 'on' : ''}
                aria-pressed={view === 'pipeline'}
                title="Pipeline" aria-label="Pipeline view"
                onClick={() => pickView('pipeline')}
              >
                <Icon name="board" size={16} />
              </button>
              <button
                className={view === 'list' ? 'on' : ''}
                aria-pressed={view === 'list'}
                title="List" aria-label="List view"
                onClick={() => pickView('list')}
              >
                <Icon name="list" size={16} />
              </button>
            </div>
            {(stage || who) && (
              <button className="link" onClick={() => { setStage(null); setWho(null); }}>
                Clear filter
              </button>
            )}
          </div>

          {view === 'pipeline'
            ? <Board stages={stage ? stages.filter((s) => s.key === stage) : stages}
                     onOpen={actions.onOpen} onNudge={setNudging} onDelete={actions.onDelete}
                     people={actions.people} onAssign={actions.onAssign} />
            : <Rows tasks={stage ? stages.find((s) => s.key === stage).items : scoped}
                    onOpen={actions.onOpen} onNudge={setNudging} onDelete={actions.onDelete}
                    people={actions.people} onAssign={actions.onAssign} />}
        </>
      )}

      {!tasks.length ? (
        <div className="empty">
          <strong>
            {side === 'allotted'
              ? 'Nothing is with anybody else.'
              : 'Nobody has asked you for anything.'}
          </strong>
          <p>
            {side === 'allotted'
              ? 'When you write "Rahul, GST documents kal bhej dena" in a chat, or type an instruction into one of your team groups, the task lands here with their name on it.'
              : 'Requests that arrive in your chats show up here, alongside who sent them.'}
          </p>

          {/*
            * Delegation has two halves and they fail differently: either his own
            * messages are never read, or they are read and never look like
            * handing work over. An empty page that does not say which is a
            * guess, and it was guessed at three times.
            */}
          {side === 'allotted' && wa && (
            <p className="empty-why">
              It has read <b>{wa.ownSeenEver ?? 0}</b>{' '}
              {wa.ownSeenEver === 1 ? 'message' : 'messages'} you wrote yourself
              {wa.ownSeen !== wa.ownSeenEver && ` (${wa.ownSeen ?? 0} since this server started)`}
              , and none looked like handing work to somebody.
              {!wa.ownSeenEver && ' Nothing you have written has been read at all — that is a connection problem, not a wording one.'}
            </p>
          )}
        </div>
      ) : side === 'received' ? (
        shown.map((person) => (
          <Person
            key={person.name}
            person={person}
            tasks={tasks}
            side={side}
            actions={actions}
            onNudge={setNudging}
          />
        ))
      ) : null}

      {giving && (
        <GiveSheet
          onClose={() => setGiving(false)}
          onSaved={() => { setGiving(false); load(); onChanged?.(); }}
          onError={onError}
        />
      )}

      {nudging && (
        <NudgeSheet
          task={nudging}
          onClose={() => setNudging(null)}
          onSent={() => { setSent(nudging.assigned_to); setNudging(null); load(); }}
          onError={onError}
          onChanged={() => { load(); onChanged?.(); }}
        />
      )}
    </div>
  );
}
