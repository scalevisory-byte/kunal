import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import {
  addedLabel, agoLabel, dateTimeLabel, dueLabel, isDone, isOverdue, taskSource, timeLabel,
} from '../lib/task.js';

const PRIORITY = { high: 'High', medium: 'Medium', low: 'Low' };

/** "10 Sep · 6:00 PM" - short enough for a list line. */
const stamp = (iso) =>
  iso
    ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : null;

/** Everything you can do to a task without opening it, behind one control. */
function RowMenu({
  task, groups, onOpen, onStatus, onQuickDate, onDelete, onNotATask, onMove, onManageGroups, onAddUpdate,
}) {
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

          {/*
            * Filing a task under the business it belongs to.
            *
            * It was already possible, but only by opening the task and finding
            * a dropdown in the drawer - which is two steps too many for the one
            * thing you do while reading down a list of mixed work. The groups
            * are listed flat rather than behind a submenu: there are as many of
            * them as there are businesses, and a submenu is another hover to
            * get wrong on a phone.
            */}
          {groups.length > 0 ? (
            <>
              <div className="menu-head">Move to</div>
              <div className="menu-scroll">
                {groups.map((g) => {
                  const here = task.group_id === g.id;
                  return (
                    <button
                      key={g.id}
                      role="menuitemradio"
                      aria-checked={here}
                      className={here ? 'here' : ''}
                      onClick={run(() => !here && onMove(task, g.id))}
                    >
                      <span className={`menu-dot c-${g.colour || 'teal'}`} />
                      {g.name}
                      {here && <Icon name="check" size={14} className="menu-tick" />}
                    </button>
                  );
                })}
                {task.group_id ? (
                  <button role="menuitem" onClick={run(() => onMove(task, null))}>
                    <span className="menu-dot none" /> No group
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <button role="menuitem" onClick={run(onManageGroups)}>
              <Icon name="inbox" size={15} /> Make a group to file this in
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function TaskItem({
  task, groups = [], onToggle, onOpen, onStatus, onQuickDate, onDelete, onNotATask,
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

  return (
    <li className={`task ${done ? 'done' : ''} s-${task.status} ${isOverdue(task) ? 'late' : ''}`}>
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

          {task.group_name && (
            <span className={`group-tag c-${task.group_colour || 'teal'}`} title={task.group_name}>
              {task.group_name}
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
          <span className="m-item" title={task.origin === 'ai' ? 'Created by Claude' : 'Added by hand'}>
            <Icon name={task.origin === 'ai' ? 'robot' : 'person'} size={12} />
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

      <RowMenu
        task={task}
        groups={groups}
        onOpen={onOpen}
        onStatus={onStatus}
        onQuickDate={onQuickDate}
        onDelete={onDelete}
        onNotATask={onNotATask}
        onMove={onMove}
        onManageGroups={onManageGroups}
        onAddUpdate={onAddUpdate}
      />
    </li>
  );
}
