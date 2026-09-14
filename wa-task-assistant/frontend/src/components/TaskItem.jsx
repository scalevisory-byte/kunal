import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { useRename } from '../rename.js';
import {
  agoLabel, dateTimeLabel, dueLabel, isDone, isOverdue, looksLikeWid, receivedStamp, taskSource,
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
export function AssignButton({ task, people = [], onAssign }) {
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
  const [name, setName] = useState('');
  const wrap = useRef(null);

  // A shut menu forgets what was half-typed into it.
  useEffect(() => { if (!open) setName(''); }, [open]);

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

  /*
   * Handing it over always names somebody.
   *
   * Asked for as "allot kisko karna he wo bhi karna padega, compulsory rakho".
   * There is deliberately no way through this menu that moves a task to Task
   * allotted without a person on it - an unnamed delegation is a task off the
   * board that nobody has been asked to do, which is worse than leaving it
   * where it was. Passing an empty name is the one exception and it means the
   * opposite: take it back.
   */
  const give = (who, wid = null) => {
    setOpen(false);
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
          {/*
            * The field is here on opening, not behind a "Somebody else…" step.
            *
            * That step cost a press before a single letter could be typed, and
            * on the first few days - when nobody is on the list yet - it was
            * the only way through, so handing a task over was four actions
            * deep. Now the row's Staff button is the one press: type a name and
            * Enter, or take a name above in a second press. Give stays disabled
            * until there is a name, because that is the part that must happen.
            */}
          <form
            className="menu-name"
            onSubmit={(e) => { e.preventDefault(); if (name.trim()) give(name.trim()); }}
          >
            <input
              value={name}
              autoFocus
              placeholder="Type a name"
              aria-label="Give this task to"
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="btn small" disabled={!name.trim()}>Give</button>
          </form>
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
function GroupButton({ task, groups = [], onMove, onManageGroups, onNewGroup }) {
  const [open, setOpen] = useState(false);
  /*
   * Making the folder from here, rather than going to Manage groups first.
   *
   * The moment you learn a folder is missing is the moment you try to file
   * something into it - and being sent to another page to make it means
   * coming back, finding the row again, and opening this menu a second time.
   * So the menu makes it, and puts the task straight in.
   */
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const box = useRef(null);
  const wrap = useRef(null);

  useEffect(() => { if (naming) box.current?.focus(); }, [naming]);
  // A shut menu forgets what was half-typed into it.
  useEffect(() => { if (!open) { setNaming(false); setName(''); setFailed(''); } }, [open]);

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

  const make = async (event) => {
    event?.preventDefault?.();
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    setFailed('');
    try {
      const group = await onNewGroup(clean);
      // Made and filed in one press: the folder existing but the task still
      // loose would be half the job.
      if (group?.id) put(group.id);
    } catch (err) {
      setFailed(err?.message || 'Could not make that folder');
    } finally {
      setBusy(false);
    }
  };

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
          ) : null}

          {onNewGroup && (naming ? (
            <form className="menu-new" onSubmit={make}>
              <input
                ref={box}
                value={name}
                placeholder="Folder name"
                aria-label="New folder name"
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setNaming(false); } }}
              />
              <button type="submit" className="btn small" disabled={busy || !name.trim()}>
                {busy ? 'Making…' : 'Make and file'}
              </button>
              {failed && <p className="menu-note error-text">{failed}</p>}
            </form>
          ) : (
            <button role="menuitem" onClick={() => setNaming(true)}>
              <Icon name="plus" size={15} /> New folder
            </button>
          ))}

          {!groups.length && !onNewGroup && (
            <button role="menuitem" onClick={() => { setOpen(false); onManageGroups(); }}>
              <Icon name="inbox" size={15} /> Make a folder to file this in
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The deadline, and changing it, in the same place.
 *
 * The row already prints "No deadline" or "Sep 28" - and that word is where
 * you look when you want to change it, so that is what opens the menu. A
 * hundred and thirteen tasks with no deadline is not a filing problem, it is
 * that giving one meant opening the drawer or hunting the ⋮ menu for the two
 * offsets it offered.
 *
 * Today and Tomorrow cover most of it; the picker covers the rest; and "No
 * deadline" takes one back off, which nothing on the row could do before.
 */
function DueButton({ task, due, onQuickDate }) {
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

  const set = (when) => { setOpen(false); onQuickDate(task, when); };

  return (
    <span className="due-wrap" ref={wrap}>
      <button
        type="button"
        className={`due ${due?.tone || 'none'}`}
        aria-expanded={open}
        title={due ? 'Change the deadline' : 'Give this a deadline'}
        onClick={() => setOpen((v) => !v)}
      >
        {due ? due.text : 'No deadline'}
      </button>

      {open && (
        <div className="menu due-menu" role="menu">
          <div className="menu-head">Due</div>
          <button role="menuitem" onClick={() => set(0)}>
            <Icon name="sun" size={15} /> Today
          </button>
          <button role="menuitem" onClick={() => set(1)}>
            <Icon name="calendar" size={15} /> Tomorrow
          </button>
          <label className="menu-date">
            <Icon name="calendar" size={15} />
            <span className="sr-only">Pick a date</span>
            <input
              type="date"
              value={task.due_date || ''}
              onChange={(e) => e.target.value && set(e.target.value)}
            />
          </label>
          {task.due_date && (
            <button role="menuitem" onClick={() => set(null)}>
              <span className="menu-dot none" /> No deadline
            </button>
          )}
        </div>
      )}
    </span>
  );
}

/** Everything you can do to a task without opening it, behind one control. */
function RowMenu({ task, onOpen, onStatus, onQuickDate, onDelete, onAddUpdate, onRename }) {
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
          {/*
            * The same rename, for a thumb. A phone has no double-click and no
            * F2, so without this the fix is only available on a desktop - and
            * the phone is where the list is actually read.
            */}
          {onRename && !isDone(task) && (
            <button role="menuitem" onClick={run(onRename)}>
              <Icon name="edit" size={15} /> Rename
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
  onMove, onManageGroups, onNewGroup, onAddUpdate,
  /*
   * Renaming without leaving the list.
   *
   * A title is the one field that is wrong often enough to be worth fixing in
   * passing - "Talk with Vikas Gupta" needs three words added, not a drawer
   * opened, a field found, a change saved and the drawer closed. Asked for in
   * exactly those terms: like F2 in Excel.
   *
   * Optional: where it is not passed the title stays what it was, a button
   * that opens the task.
   */
  onRename = null,
  // One optional control, for a page where a task needs an action the board
  // does not have - the Nudge button on work given to somebody else. It sits
  // in the row rather than beside it, so the row stays one row.
  extra = null,
  /*
   * Picking several rows at once.
   *
   * While this is on the leading tick means "chosen", not "done" - the same
   * control, because a row with two checkboxes on it is a row nobody reads
   * correctly. Everything else about the row keeps working.
   */
  selecting = false,
  picked = false,
  onPick = null,
}) {
  const done = isDone(task);
  const due = dueLabel(task.due_date);
  const source = taskSource(task);
  /*
   * When the task came in — created_at, at the head of the row.
   *
   * This was the message's own time, unlabelled, which is a different fact and
   * read as the deadline as often as not. The message's time still exists and
   * still matters; it lives with the message, in the drawer.
   */
  const received = receivedStamp(task.created_at);
  /*
   * Held here rather than inside the button, because the note takes a whole
   * line and the row has to be told to wrap for it - which is a property of
   * the row, not of the button that opened it.
   */
  const [noting, setNoting] = useState(false);

  // The rules live in one place; three lists show a title and a rule that
  // differed between them would be worse than no rule.
  const rename = useRename(task, onRename, { canEdit: !done });


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
    if (event.target.closest('button, input, a, label, select, textarea, .assign, .row-menu, .rownote, .due-wrap')) return;
    // While picking, the whole row is the target: reaching for a small tick
    // fifty times is the thing this is supposed to replace.
    if (selecting && onPick) return onPick(task);
    onOpen(task);
  };

  return (
    <li
      className={`task ${done ? 'done' : ''} s-${task.status} ${isOverdue(task) ? 'late' : ''} ${noting ? 'noting' : ''}`
        + `${selecting ? ' picking' : ''}${picked ? ' picked' : ''}`}
      onClick={openFromRow}
    >
      <input
        type="checkbox"
        className={selecting ? 'pick' : ''}
        checked={selecting ? picked : done}
        onChange={() => (selecting && onPick ? onPick(task) : onToggle(task))}
        aria-label={
          selecting
            ? `${picked ? 'Unpick' : 'Pick'} ${task.title}`
            : done ? `Reopen ${task.title}` : `Mark done: ${task.title}`
        }
      />

      {/*
        * When it came in, at the front of the row.
        *
        * Every row's date in the same column, so a week of arrivals is read by
        * running an eye down it rather than by finding the fourth item along
        * six different meta lines. Two pieces because they answer different
        * questions - which day this has been waiting since, and, on today's,
        * how long ago - and the time is the quieter of the two.
        */}
      {received && (
        <span className="t-recv" title={`Received ${dateTimeLabel(task.created_at)}`}>
          <b>{received.day}</b>
          <i>{received.clock}</i>
        </span>
      )}

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
        {rename.editing ? (
          <input {...rename.fieldProps} />
        ) : (
          <span className="t-title-wrap">
            <button
              type="button"
              className="t-title"
              onClick={() => rename.openLater(() => onOpen(task))}
              onDoubleClick={rename.start}
              onKeyDown={(e) => { if (e.key === 'F2') { e.preventDefault(); rename.start(); } }}
              title={rename.enabled ? 'Double-click or press F2 to rename' : undefined}
            >
              {task.title}
            </button>
            {/*
              * A visible way in.
              *
              * Double-click is invisible: it works and nobody finds it, which
              * is the same as it not working. The pencil appears on hover and
              * stays put on a touch screen, like the ⋮ beside it.
              */}
            {rename.enabled && (
              <button
                type="button"
                className="t-rename"
                aria-label={`Rename ${task.title}`}
                title="Rename"
                onClick={rename.start}
              >
                <Icon name="edit" size={14} />
              </button>
            )}
          </span>
        )}

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
            <span
              className={`m-item t-chat ${source.unnamed ? 'unnamed' : ''}`}
              title={source.unnamed
                ? `WhatsApp has not given this chat a name yet${source.id ? ` (${source.id})` : ''}. The app asks again each time it reconnects.`
                : source.label}
            >
              {/* In a group: who wrote it, then where. The sender is the half
                  that says what the request actually is. */}
              <Icon name="chat" size={12} /> {source.label}
            </span>
          )}

          {/* When it arrived used to be said here, fourth along a line of
              six. It is at the head of the row now; saying it twice would
              only cost the line the room something else needs. */}
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
      {onQuickDate
        ? <DueButton task={task} due={due} onQuickDate={onQuickDate} />
        : <span className={`due ${due?.tone || 'none'}`}>{due ? due.text : 'No deadline'}</span>}

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
          onNewGroup={onNewGroup}
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
        onRename={rename.enabled ? rename.start : null}
      />

      {noting && (
        <NoteBox task={task} onAddUpdate={onAddUpdate} onClose={() => setNoting(false)} />
      )}
    </li>
  );
}
