import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import {
  addedLabel, agoLabel, dateTimeLabel, dueLabel, isDone, isOverdue, looksLikeWid, taskSource,
  timeLabel,
} from '../lib/task.js';

const PRIORITY = { high: 'High', medium: 'Medium', low: 'Low' };

/** "10 Sep · 6:00 PM" - short enough for a list line. */
const stamp = (iso) =>
  iso
    ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : null;

/**
 * Whose job it is, chosen on the row.
 *
 * It was inside the ⋮ menu, which is right for the things you do occasionally
 * and wrong for this: going down a list deciding what is yours and what is
 * somebody else's is the reading, not an aside from it, and a decision behind
 * a menu is one that does not get made. So the name is out in the open, and it
 * is the button - the same control shows who has it and changes who has it.
 */
function AssignButton({ task, people = [], onAssign }) {
  /*
   * A number is not a person, so it is not shown as one.
   *
   * The extractor once read a chat's linked-identity id back as the person a
   * task had been given to, and the button then said "206218677239001" — which
   * tells you nothing and cannot be nudged. Cleared at the source and in the
   * database now; this is the last guard, so a row can never claim work is
   * with somebody it cannot name.
   */
  const held = task.assigned_to && !looksLikeWid(task.assigned_to) ? task.assigned_to : null;
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !wrap.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const give = (who, wid = null) => {
    setOpen(false);
    setNaming(false);
    setName('');
    onAssign(task, who, wid);
  };

  return (
    <div className="assign" ref={wrap}>
      <button
        type="button"
        className={`assign-btn ${held ? 'on' : ''}`}
        aria-expanded={open}
        title={held ? `With ${held} — press to change` : 'Give this to somebody'}
        aria-label={held ? `With ${held}` : `Give ${task.title} to somebody`}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="person" size={13} />
        <span>{held || 'Staff'}</span>
      </button>

      {open && (
        <div className="menu assign-menu" role="menu">
          <div className="menu-head">Give it to</div>
          {held && (
            <button role="menuitem" className="here" onClick={() => give('')}>
              <Icon name="person" size={15} /> {held}
              <span className="menu-note">take it back</span>
            </button>
          )}
          <div className="menu-scroll">
            {people
              .filter((p) => p.name && p.name !== held)
              .slice(0, 10)
              .map((p) => (
                <button key={p.name} role="menuitem" onClick={() => give(p.name, p.wid)}>
                  <Icon name="person" size={15} /> {p.name}
                  {p.open > 0 && <span className="menu-note">{p.open}</span>}
                </button>
              ))}
          </div>
          {naming ? (
            <form
              className="menu-name"
              onSubmit={(e) => { e.preventDefault(); if (name.trim()) give(name.trim()); }}
            >
              <input
                value={name}
                autoFocus
                placeholder="Name"
                aria-label="Give this task to"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setNaming(false)}
              />
              <button type="submit" className="btn small" disabled={!name.trim()}>Give</button>
            </form>
          ) : (
            <button role="menuitem" onClick={() => setNaming(true)}>
              <Icon name="plus" size={15} /> Somebody else…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Which folder it belongs in, chosen on the row.
 *
 * The twin of the staff button, for the same reason: filing is what you do
 * while reading down a list of mixed work, and a decision behind a menu is one
 * that does not get made. The same control says where a task is filed and
 * moves it.
 */
function GroupButton({ task, groups = [], onMove, onManageGroups }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !wrap.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const put = (id) => { setOpen(false); onMove(task, id); };

  return (
    <div className="assign" ref={wrap}>
      <button
        type="button"
        className={`assign-btn folder ${task.group_id ? 'on' : ''}`}
        aria-expanded={open}
        title={task.group_name ? `In ${task.group_name} — press to move it` : 'Put this in a folder'}
        aria-label={task.group_name ? `In ${task.group_name}` : `File ${task.title}`}
        onClick={() => setOpen((v) => !v)}
      >
        {task.group_id
          ? <span className={`group-dot c-${task.group_colour || 'teal'}`} aria-hidden="true" />
          : <Icon name="inbox" size={13} />}
        <span>{task.group_name || 'Folder'}</span>
      </button>

      {open && (
        <div className="menu assign-menu" role="menu">
          <div className="menu-head">Move to</div>
          {groups.length > 0 ? (
            <>
              <div className="menu-scroll">
                {groups.map((g) => {
                  const here = task.group_id === g.id;
                  return (
                    <button
                      key={g.id}
                      role="menuitemradio"
                      aria-checked={here}
                      className={here ? 'here' : ''}
                      onClick={() => !here && put(g.id)}
                    >
                      <span className={`menu-dot c-${g.colour || 'teal'}`} />
                      {g.name}
                      {here && <Icon name="check" size={14} className="menu-tick" />}
                    </button>
                  );
                })}
              </div>
              {task.group_id ? (
                <button role="menuitem" onClick={() => put(null)}>
                  <span className="menu-dot none" /> Out of the folder
                </button>
              ) : null}
            </>
          ) : (
            <button role="menuitem" onClick={() => { setOpen(false); onManageGroups(); }}>
              <Icon name="inbox" size={15} /> Make a folder to file this in
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Everything you can do to a task without opening it, behind one control. */
function RowMenu({ task, onOpen, onStatus, onQuickDate, onDelete, onAddUpdate }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !wrap.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (fn) => () => { setOpen(false); fn(); };

  return (
    <div className="row-menu" ref={wrap}>
      <button
        className="row-menu-btn"
        aria-label={`Actions for ${task.title}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="more" size={17} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {task.status !== 'in_progress' && !isDone(task) && (
            <button role="menuitem" onClick={run(() => onStatus(task, 'in_progress'))}>
              <Icon name="play" size={15} /> Start
            </button>
          )}
          {task.status === 'in_progress' && (
            <button role="menuitem" onClick={run(() => onStatus(task, 'open'))}>
              <Icon name="circle" size={15} /> Back to open
            </button>
          )}
          <button role="menuitem" onClick={run(() => onQuickDate(task, 0))}>
            <Icon name="sun" size={15} /> Due today
          </button>
          <button role="menuitem" onClick={run(() => onQuickDate(task, 1))}>
            <Icon name="calendar" size={15} /> Due tomorrow
          </button>
          {!isDone(task) && (
            <button role="menuitem" onClick={run(() => onAddUpdate(task))}>
              <Icon name="chat" size={15} /> {task.update_count ? 'Add an update' : 'What is happening?'}
            </button>
          )}
          <button role="menuitem" onClick={run(() => onOpen(task))}>
            <Icon name="clipboard" size={15} /> Details
          </button>
          <button className="danger" role="menuitem" onClick={run(() => onDelete(task))}>
            <Icon name="trash" size={15} /> Delete
          </button>

        </div>
      )}
    </div>
  );
}

/**
 * Writing down what is happening, from the row.
 *
 * The place a thought about a task arrives is while reading the list - "spoke
 * to Meera, waiting on the invoice" - and until now that meant opening the
 * drawer, finding the box, typing, closing it. Four steps for one sentence, so
 * the sentence mostly did not get written, and a week later nobody could say
 * what had happened to a task.
 *
 * So the row takes it. One press opens a line under the title, Enter saves it,
 * Escape abandons it, and the note appears on the row where it was written -
 * the same update the drawer keeps, in the same place, just reachable from
 * where the thought occurred.
 */
function NoteButton({ task, open, onOpen }) {
  return (
    <button
      className={`assign-btn note ${task.update_count ? 'on' : ''}`}
      aria-expanded={open}
      title={task.update_count ? `${task.update_count} written down — add another` : 'Write down what is happening'}
      aria-label={`Add a note to ${task.title}`}
      onClick={() => onOpen(!open)}
    >
      <Icon name="chat" size={13} />
      <span>{task.update_count || 'Note'}</span>
    </button>
  );
}

/** The line the note is typed on, under the row it belongs to. */
function NoteBox({ task, onAddUpdate, onClose }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef(null);

  useEffect(() => { box.current?.focus(); }, []);

  const save = async (event) => {
    event?.preventDefault?.();
    const clean = text.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      await onAddUpdate(task, clean);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="rownote" onSubmit={save}>
      <input
        ref={box}
        value={text}
        placeholder="What is happening?"
        aria-label={`Note on ${task.title}`}
        maxLength={1000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      />
      <button type="submit" className="btn small" disabled={busy || !text.trim()}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      <button type="button" className="link" onClick={onClose}>Cancel</button>
    </form>
  );
}

export default function TaskItem({
  task, groups = [], people = [], onAssign, onToggle, onOpen, onStatus, onQuickDate, onDelete, onNotATask,
  onMove, onManageGroups, onAddUpdate,
  // One optional control, for a page where a task needs an action the board
  // does not have - the Nudge button on work given to somebody else. It sits
  // in the row rather than beside it, so the row stays one row.
  extra = null,
}) {
  const done = isDone(task);
  const due = dueLabel(task.due_date);
  const source = taskSource(task);
  /*
   * When the task was added — created_at, and said so.
   *
   * This was the message's own time, unlabelled, which is a different fact and
   * read as the deadline as often as not. The message's time still exists and
   * still matters; it lives with the message, in the drawer.
   */
  const added = addedLabel(task.created_at);
  /*
   * Held here rather than inside the button, because the note takes a whole
   * line and the row has to be told to wrap for it - which is a property of
   * the row, not of the button that opened it.
   */
  const [noting, setNoting] = useState(false);

  /*
   * The whole row opens the task, not just its title.
   *
   * The title was the only thing that opened the drawer, so a press on the
   * deadline, the meta line or the empty half of the row did nothing at all -
   * and the row is what you are aiming at. Every control in it keeps its own
   * job: the checkbox, the folder and staff buttons, the menu and the dismiss
   * all stop here. The title button stays a button, because it is what the
   * keyboard tabs to; this is a second way in for a mouse and a thumb, not a
   * replacement for it.
   */
  const openFromRow = (event) => {
    // The containers too, not only their controls: an open menu has padding
    // between its buttons, and a press there must not open the drawer behind
    // it.
    if (event.target.closest('button, input, a, label, select, textarea, .assign, .row-menu, .rownote')) return;
    onOpen(task);
  };

  return (
    <li
      className={`task ${done ? 'done' : ''} s-${task.status} ${isOverdue(task) ? 'late' : ''} ${noting ? 'noting' : ''}`}
      onClick={openFromRow}
    >
      <input
        type="checkbox"
        checked={done}
        onChange={() => onToggle(task)}
        aria-label={done ? `Reopen ${task.title}` : `Mark done: ${task.title}`}
      />

      {/*
        * One line per task.
        *
        * Three lines each meant ten tasks filled the screen and the list had to
        * be scrolled to be read at all. Everything still shown is here; what
        * moved is only the labelling - a clock instead of the word "Deadline",
        * an icon instead of "AI-created" - and the follow-up time, which now
        * appears only while a task is actually late, which is the only moment
        * it tells you anything. The drawer still has all of it.
        */}
      <div className="t-main">
        <button type="button" className="t-title" onClick={() => onOpen(task)}>
          {task.title}
        </button>

        {/*
          * Where the work has got to, and what was last said about it.
          *
          * Both on the row rather than in the drawer, because the question
          * "what is pending and what stage is it at" is asked of the list, not
          * of one task — opening twenty tasks to answer it is the same as not
          * having written any of it down. The stage is a chip because it is a
          * state; the update is quoted because they are somebody's words. It
          * is one line and it truncates: the drawer holds the whole stream.
          */}
        {!done && (task.stage || task.latest_update) && (
          <span className="t-progress">
            {task.stage && <span className="stage-chip small">{task.stage}</span>}
            {task.latest_update?.body && (
              <span className="t-update" title={task.latest_update.body}>
                {task.latest_update.body}
              </span>
            )}
            {task.latest_update && (
              <span className="t-update-when">{agoLabel(task.latest_update.created_at)}</span>
            )}
          </span>
        )}

        <span className="t-line">
          {task.blocked_by?.length > 0 && !done && (
            <span className="m-item warn-text" title={`Waiting on ${task.blocked_by.map((b) => b.title).join(', ')}`}>
              <Icon name="alert" size={12} />
              {task.blocked_by.length === 1 ? task.blocked_by[0].title : `${task.blocked_by.length} blockers`}
            </span>
          )}

          {task.needs_attention && !done && (
            <span className="state-chip attention" title="Asked the maximum number of times">
              Stopped asking
            </span>
          )}

          {task.subtask_progress?.total > 0 && (
            <span className="m-item" title="Checklist">
              <Icon name="check" size={12} />
              {task.subtask_progress.done}/{task.subtask_progress.total}
            </span>
          )}

          {task.attachment_count > 0 && (
            <span className="m-item" title={`${task.attachment_count} file(s)`}>
              <Icon name="clipboard" size={12} /> {task.attachment_count}
            </span>
          )}


          {source && (
            <span className="m-item t-chat" title={source.label}>
              {/* In a group: who wrote it, then where. The sender is the half
                  that says what the request actually is. */}
              <Icon name="chat" size={12} /> {source.label}
            </span>
          )}

          {/*
            * When it arrived, on every task rather than only undated ones.
            *
            * The message's own time when there is one, because "when did this
            * come in" is a question about the message, not about the moment the
            * extractor got round to it - and the two differ by however long the
            * batch waited.
            */}
          {added && (
            <span className="m-item quiet" title={dateTimeLabel(task.created_at)}>
              {/* An inbox, not a clock: the clock belongs to the deadline, and
                  wearing the same icon the two read as one fact stated twice. */}
              <Icon name="inbox" size={12} /> {added}
            </span>
          )}
          {/*
            * Where the task came from, in a word.
            *
            * This was the icon alone, on the reasoning that a robot needs no
            * caption. It does: a small grey figure said nothing at all about a
            * task somebody typed, so only the AI ones read as having a source
            * and the hand-written ones looked like they were missing something.
            * Two words, one each, and the pair is legible at a glance.
            */}
          <span
            className={`m-item origin ${task.origin === 'ai' ? 'by-ai' : 'by-hand'}`}
            title={task.origin === 'ai' ? 'Claude read this out of a chat' : 'You typed this in'}
          >
            <Icon name={task.origin === 'ai' ? 'robot' : 'person'} size={12} />
            {task.origin === 'ai' ? 'AI' : 'By hand'}
          </span>

          {task.due_at && !done && (
            <span className={`m-item ${isOverdue(task) ? 'danger-text' : ''}`} title={`Deadline ${stamp(task.due_at)}`}>
              <Icon name="clock" size={12} /> {stamp(task.due_at)}
            </span>
          )}

          {/* Only while it is late: before that, the next follow-up is a time
              nothing is going to happen at. */}
          {task.next_follow_up_at && isOverdue(task) && !done && (
            <span className="m-item" title={`Next follow-up ${stamp(task.next_follow_up_at)}`}>
              <Icon name="refresh" size={12} /> {stamp(task.next_follow_up_at)}
            </span>
          )}

          {/* High and low only. Medium is the default and most of the list is
              medium, so a dot on every row marked nothing — it just spent a
              colour that then had nothing left to say. */}
          {task.priority !== 'medium' && (
            <span className={`pri p-${task.priority}`} title={`${PRIORITY[task.priority]} priority`}>
              <span className="pri-dot" />
            </span>
          )}

          {task.status === 'in_progress' && <span className="state-chip">In progress</span>}
          {task.status === 'waiting' && (
            <span className="state-chip waiting">
              Waiting{task.waiting_for ? ` · ${task.waiting_for}` : ''}
            </span>
          )}
          {done && task.completed_at && (
            <span className="m-item">Done {dateTimeLabel(task.completed_at)}</span>
          )}
        </span>
      </div>

      {/* One time per row: the arrival is in the meta line above, on every
          task, so this column stays about the deadline alone. Two different
          times on one row read as a contradiction. */}
      {/* The deadline column, and it says so when there is none — "No date"
          beside an "Added …" stamp read as the task having no dates at all. */}
      <span className={`due ${due?.tone || 'none'}`}>{due ? due.text : 'No deadline'}</span>

      {extra}

      {/*
        * Throwing one out is one press, in the row.
        *
        * It was in the ⋮ menu, which is right for something you do occasionally
        * and wrong for this: reading all the chats produces a steady stream of
        * near-misses, and clearing forty of them a menu at a time is work
        * nobody does. So the list grows instead.
        *
        * Safe to have out in the open because it archives rather than deletes,
        * and because one press puts it back — see the undo banner in App.jsx.
        * Permanent deletion stays in the menu, where a rare and final thing
        * belongs.
        */}
      {onNotATask && (
        <button
          className="row-dismiss"
          title={`Not a task — take "${task.title}" off the list`}
          aria-label={`Not a task: ${task.title}`}
          onClick={() => onNotATask(task)}
        >
          ✕
        </button>
      )}

      {onAddUpdate && !done && (
        <NoteButton task={task} open={noting} onOpen={setNoting} />
      )}

      {onMove && (
        <GroupButton
          task={task}
          groups={groups}
          onMove={onMove}
          onManageGroups={onManageGroups}
        />
      )}

      {onAssign && <AssignButton task={task} people={people} onAssign={onAssign} />}

      <RowMenu
        task={task}
        onOpen={onOpen}
        onStatus={onStatus}
        onQuickDate={onQuickDate}
        onDelete={onDelete}
        onAddUpdate={onAddUpdate}
      />

      {noting && (
        <NoteBox task={task} onAddUpdate={onAddUpdate} onClose={() => setNoting(false)} />
      )}
    </li>
  );
}
