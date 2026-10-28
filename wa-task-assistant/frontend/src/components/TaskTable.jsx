import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { RowMenu, AssignButton, GroupButton } from './TaskItem.jsx';
import DeadlineButton from './DeadlineButton.jsx';
import Checklist from './Checklist.jsx';
import { useRename } from '../rename.js';
import { sortRows, pageOf, pageList, PAGE_SIZES } from '../lib/table.js';
import {
  isDone, isStarted, dueLabel, taskSource, timeLabel, receivedStamp,
} from '../lib/task.js';

/*
 * All Tasks as a table.
 *
 * Drawn by him: a checkbox, the task, its business, who has it, when it is
 * due, how urgent, where it stands, and the row's actions - twenty to a page
 * with "Showing 1-20 of 439" underneath. It is the same `visible` list the
 * sections read, after every filter on the screen; nothing here fetches, so a
 * figure on this page and the list under it cannot disagree.
 *
 * The leading box is SELECTION, always, and never "done". In the section list
 * the tick is both - that is why picking there is a mode you switch on - but
 * in a table completing a task is the green ✓ in the actions column. One box
 * per row, one meaning per box.
 *
 * There is no Status column ("status hata do"): open or done is what the
 * ✓ and the struck-through row already say, and Start / Waiting are on the
 * ⋮ menu and in the drawer. The Business / Folder cell is the list's own
 * Folder button, so a task is filed from here in one press.
 */

const HEAD = [
  // When it came in, first - the same column the list leads with.
  { key: 'added', label: 'Received' },
  { key: 'task', label: 'Task' },
  // Who asked, in a column of its own rather than a second line under every
  // title: one line per row is what lets a page hold twice the rows.
  { key: 'from', label: 'From' },
  { key: 'folder', label: 'Business / Folder' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'due', label: 'Due date' },
];

/*
 * What the follow-up engine will do for this task, in a sentence - the
 * tooltip on the Due cell. The engine's rule is the deadline: none, nothing
 * is chased; one, a reminder before it and at it, then follow-ups until the
 * task is done or the follow-ups run out.
 */
function chaseNote(task) {
  if (!task.due_at && !task.due_date) {
    return 'No deadline, so nothing is chased. Pick a time: you get a reminder then, and follow-ups after it until you tick it done.';
  }
  const at = (iso) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const lines = [];
  if (task.needs_attention) {
    lines.push(`Stopped asking after ${task.follow_up_count} follow-ups. Set a new time to start again.`);
  } else {
    if (task.next_reminder_at) lines.push(`Next reminder: ${at(task.next_reminder_at)}`);
    if (task.next_follow_up_at) lines.push(`Next follow-up: ${at(task.next_follow_up_at)}`);
    if (task.follow_up_count > 0) lines.push(`Follow-up ${task.follow_up_count} of ${task.follow_up_max} sent`);
    lines.push('Follow-ups continue after the deadline until you tick it done.');
  }
  lines.push('Click to change.');
  return lines.join('\n');
}

function Title({ task, onOpen, rename }) {
  if (rename.editing) return <input {...rename.fieldProps} />;
  return (
    <span className="t-title-wrap">
      <button
        className="tt-title"
        onClick={() => rename.openLater(() => onOpen(task))}
        onDoubleClick={rename.start}
        onKeyDown={(e) => { if (e.key === 'F2') { e.preventDefault(); rename.start(); } }}
        // The title is cut to one line, so the whole of it is on the tooltip.
        title={`${task.title}\n\n${rename.enabled ? 'Open · double-click or F2 to rename' : 'Open'}`}
      >
        {task.title}
      </button>
      {/* The list's pencil: one press to rename, for anyone who never finds
          the double-click. */}
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
  );
}

/*
 * Notes on a row, the way a comment sits on a cell in Excel.
 *
 * Asked as "lead ke andar additional details add karni he to comment ya notes
 * ka option, jese excel me hota he". The table had no way in short of opening
 * the drawer. Now every title carries a Note mark: it shows a count when
 * something is written, its tooltip reads the details on hover like a cell
 * comment, and a press opens a line under the row with the details and every
 * note so far, and a box for the next one. The same updates the drawer and the
 * list keep - one stream, three doors.
 */
function NoteMark({ task, open, onPress }) {
  const count = task.update_count || 0;
  const has = count > 0 || Boolean(task.description);
  const preview = [task.description, count ? `${count} note${count === 1 ? '' : 's'}` : '']
    .filter(Boolean).join('\n\n');
  return (
    <button
      type="button"
      className={`tt-note-mark ${has ? 'on' : ''}`}
      aria-expanded={open}
      aria-label={`Notes on ${task.title}`}
      title={preview ? `${preview.slice(0, 400)}\n\nClick to read or add a note` : 'Add a note'}
      onClick={onPress}
    >
      <Icon name="chat" size={13} />
      <span>{count || (task.description ? '' : 'Note')}</span>
    </button>
  );
}

/*
 * Steps on a row, beside the notes.
 *
 * Asked as "jese notes ka option he wese option do uska bhi", over SENA's
 * notes reading "Need to check sep and oct billing", "Need to check FD
 * portal" - things still to do, written where things already done go. A note
 * is what happened; a step is what is left, ticked off one at a time. The
 * checklist already existed, two folds deep in the drawer; this is the same
 * one (`Checklist`), a press away, with its count on the row.
 */
function StepsMark({ task, open, onPress }) {
  const total = task.subtask_progress?.total || 0;
  const done = task.subtask_progress?.done || 0;
  return (
    <button
      type="button"
      className={`tt-note-mark tt-steps-mark ${total ? 'on' : ''} ${total && done === total ? 'all' : ''}`}
      aria-expanded={open}
      aria-label={`Checklist on ${task.title}`}
      title={total ? `${done} of ${total} steps done · click to tick or add` : 'Add steps still to do'}
      onClick={onPress}
    >
      <Icon name="check" size={13} />
      <span>{total ? `${done}/${total}` : 'Steps'}</span>
    </button>
  );
}

function NotePanel({ task, onAddUpdate, onLoadNotes, onToStep, onClose }) {
  const [items, setItems] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  // Handed in rather than fetched here: the table itself never asks the
  // server for anything, so its rows can only ever be the list on screen.
  const load = () => Promise.resolve(onLoadNotes(task)).then((r) => setItems(r?.updates || [])).catch(() => setItems([]));
  useEffect(() => { load(); box.current?.focus(); }, [task.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (e) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      await onAddUpdate(task, clean);
      setText('');
      await load();
    } finally { setBusy(false); }
  };

  return (
    <div className="tt-notes">
      {task.description && <p className="tt-notes-desc">{task.description}</p>}
      {items === null ? <p className="tt-none">Loading…</p> : items.length ? (
        <ul>
          {items.map((u) => {
            const at = receivedStamp(u.created_at);
            return (
              <li key={u.id}>
                <span>{u.body}</span>
                {at && <small>{at.day} · {at.clock}</small>}
                {/* A note that is really something still to do ("Need to
                    check…") moves into the checklist in one press. */}
                {onToStep && u.body && u.body.length <= 200 && (
                  <button
                    type="button"
                    className="link tt-to-step"
                    title="Move this note into the checklist as a step to tick"
                    onClick={async () => { await onToStep(task, u); await load(); }}
                  >
                    Make it a step
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : !task.description && <p className="tt-none">Nothing written yet.</p>}
      <form onSubmit={save}>
        <input
          ref={box}
          value={text}
          maxLength={1000}
          placeholder="Add a note: who you spoke to, what is pending…"
          aria-label={`New note on ${task.title}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
        />
        <button type="submit" className="btn small" disabled={busy || !text.trim()}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="link" onClick={onClose}>Close</button>
      </form>
    </div>
  );
}

function Row({ task, num, folder, picked, onPick, onOpen, onStatus, onQuickDate, onDeadline, onStepsChanged, onNoteToStep, onError, onDelete, onNotATask, onDone, onAddUpdate, onLoadNotes, onRename, people, onAssign, groups, onMove, onManageGroups, onNewGroup }) {
  const done = isDone(task);
  // A finished task is not late: it is done, and when it was done is the fact.
  const due = done ? null : dueLabel(task.due_date);
  const finished = done ? receivedStamp(task.completed_at) : null;
  const received = receivedStamp(task.created_at);
  const source = taskSource(task);
  // One rename per row, shared by the title and the menu: the menu's Rename
  // is the same edit for a thumb, which has neither F2 nor a double-click.
  const rename = useRename(task, onRename, { canEdit: !isDone(task) });
  // One panel under the row at a time: its notes, or its steps.
  const [panel, setPanel] = useState(null);
  const toggle = (which) => setPanel((now) => (now === which ? null : which));
  return (
    <>
    <tr className={`${picked ? 'picked' : ''} ${isDone(task) ? 'is-done' : ''}`}>
      <td className="tt-pick">
        <input
          type="checkbox"
          checked={picked}
          onChange={() => onPick(task)}
          aria-label={`Select ${task.title}`}
        />
      </td>
      {/* Excel's row number: where you are on the page, and a way to say
          "row 14" about a task. */}
      <td className="tt-num">{num}</td>
      <td className="tt-rec">
        {received ? <>{received.day} <small>{received.clock}</small></> : <span className="tt-none">—</span>}
      </td>
      <td className="tt-task">
        <span className="tt-title-line">
          <Title task={task} onOpen={onOpen} rename={rename} />
          {/* Where it stands, in the row: started, or done on his side and
              waiting on somebody. An untouched task carries nothing. */}
          {!done && isStarted(task) && (
            <span
              className={`state-chip tt-state ${task.status === 'waiting' ? 'waiting' : ''}`}
              title={task.status === 'waiting'
                ? `Waiting${task.waiting_for ? ` on ${task.waiting_for}` : ' on someone'} · ⋮ → Back to in progress`
                : 'Started · ⋮ → Waiting on someone'}
            >
              {task.status === 'waiting' ? 'Waiting' : 'Started'}
            </span>
          )}
          {onAddUpdate && onLoadNotes && <NoteMark task={task} open={panel === 'notes'} onPress={() => toggle('notes')} />}
          {onStepsChanged && <StepsMark task={task} open={panel === 'steps'} onPress={() => toggle('steps')} />}
        </span>
      </td>
      {/* Who asked. A column of titles with nobody behind them is how "ye sab
          me kisne msg kiya" was asked the first time. */}
      <td className={`tt-from ${source?.unnamed ? 'unnamed' : ''}`} title={source ? (source.id || source.label) : undefined}>
        {source ? source.label : <span className="tt-none">—</span>}
      </td>
      <td className="tt-folder">
        {/* The list's own Folder button: pick a folder, move it, take it out,
            or make a new one and file it there, all from the row. */}
        {onMove && !done
          ? <GroupButton task={task} groups={groups} onMove={onMove} onManageGroups={onManageGroups} onNewGroup={onNewGroup} />
          : folder
            ? <span className="tt-chip"><span className="dot" style={{ background: folder.color || 'var(--muted)' }} />{folder.name}</span>
            : <span className="tt-none">—</span>}
      </td>
      <td className="tt-who">
        {/* The list's own Staff button, so giving a task away from the table is
            the same one press, and a name is still required. */}
        {onAssign && !done
          ? <AssignButton task={task} people={people} onAssign={onAssign} />
          : task.assigned_to ? task.assigned_to : <span className="tt-none">You</span>}
      </td>
      <td className={`tt-due ${due?.tone ? `t-${due.tone}` : ''}`}>
        {done ? (
          <span className="tt-none">Done{finished && <small> {finished.day}</small>}</span>
        ) : onDeadline ? (
          /*
           * The deadline is the switch for the follow-up engine, so the cell
           * that shows it is the control that sets it: "due date and followup
           * engine kese add karna he", asked over thirty rows reading "No date"
           * that nothing could press.
           */
          <DeadlineButton
            task={task}
            onDeadline={onDeadline}
            className="tt-deadline"
            title={chaseNote(task)}
            label={due ? (
              <>
                {due.text}
                {task.due_at && <small> {timeLabel(task.due_at)}</small>}
                {task.needs_attention
                  ? <small className="tt-chase"> · stopped</small>
                  : task.follow_up_count > 0 && (
                    <small className="tt-chase"> · ↻{task.follow_up_count}/{task.follow_up_max}</small>
                  )}
              </>
            ) : 'Set date'}
          />
        ) : due ? (
          <>
            {due.text}
            {task.due_at && <small> {timeLabel(task.due_at)}</small>}
          </>
        ) : <span className="tt-none">No date</span>}
      </td>
      <td className="tt-act">
        {/*
          * Throwing one out is one press, as it is on the list.
          *
          * Asked as "yaha se direct delete karne wala option kaha gya": the
          * list has always had this ✕ on every row, and the table put delete
          * behind the ⋮ instead, which is two presses and a hunt for the one
          * thing done most often to a list read from WhatsApp. The same
          * handler as the list: it archives, and the undo bar puts it back.
          */}
        {/* Done in one press; the Undo bar takes it back. */}
        {onDone && !done && (
          <button
            type="button"
            className="tt-done"
            title={`Mark "${task.title}" done`}
            aria-label={`Mark done: ${task.title}`}
            onClick={() => onDone(task)}
          >
            <Icon name="check" size={15} />
          </button>
        )}
        {onNotATask && (
          <button
            type="button"
            className="tt-dismiss"
            title={`Not a task — take "${task.title}" off the list`}
            aria-label={`Not a task: ${task.title}`}
            onClick={() => onNotATask(task)}
          >
            ✕
          </button>
        )}
        <RowMenu
          task={task}
          onOpen={onOpen}
          onStatus={onStatus}
          onQuickDate={onQuickDate}
          onDelete={onDelete}
          onAddUpdate={() => setPanel('notes')}
          onRename={rename.enabled ? rename.start : undefined}
        />
      </td>
    </tr>
    {panel && (
      <tr className="tt-note-row">
        <td colSpan={HEAD.length + 3}>
          {panel === 'notes' ? (
            <NotePanel
              task={task}
              onAddUpdate={onAddUpdate}
              onLoadNotes={onLoadNotes}
              onToStep={onNoteToStep}
              onClose={() => setPanel(null)}
            />
          ) : (
            <div className="tt-notes tt-steps">
              <Checklist task={task} onChanged={onStepsChanged} onError={onError} />
              <button type="button" className="link" onClick={() => setPanel(null)}>Close</button>
            </div>
          )}
        </td>
      </tr>
    )}
    </>
  );
}

export default function TaskTable({
  tasks, loading, error, groups = [], picked, onPick, onPickMany, scope = '',
  onRetry, onOpen, onStatus, onQuickDate, onDeadline, onStepsChanged, onNoteToStep, onError, onDelete, onNotATask, onDone, onAddUpdate, onLoadNotes, onRename,
  people = [], onAssign, onMove, onManageGroups, onNewGroup,
}) {
  // Newest first, and finished work below all of it (sortRows does that for
  // every column): "here be only latest pending". Due date is one press away.
  const [sort, setSort] = useState({ key: 'added', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(() => {
    try { return Number(localStorage.getItem('tableSize')) || 20; } catch { return 20; }
  });

  const folders = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const folderOf = (t) => (t.group_id ? folders.get(t.group_id) : null);

  const sorted = useMemo(
    () => sortRows(tasks, sort.key, sort.dir, {
      folderOf: (t) => folderOf(t)?.name,
      sourceOf: (t) => taskSource(t)?.label,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, sort, folders],
  );
  const shown = pageOf(sorted, page, size);

  // A different question starts from its first page: a new view, filter,
  // date, search, sort or page size. NOT new data - the list is polled every
  // thirty seconds and a task finished on page 4 leaves the Open view, and
  // either of those throwing him back to page 1 mid-read is a reset, not a
  // refresh. If the list shrinks under him, `pageOf` pulls the page back to
  // the last one that exists.
  useEffect(() => { setPage(1); }, [scope, sort.key, sort.dir, size]);

  const pickSize = (n) => {
    setSize(n);
    try { localStorage.setItem('tableSize', String(n)); } catch { /* private window */ }
  };

  const press = (key) => setSort((s) => (
    s.key !== key ? { key, dir: 'asc' } : { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
  ));

  if (error) {
    return (
      <div className="empty error-state">
        <strong>Unable to load tasks</strong>
        <p>Check your connection, then try again.</p>
        <button className="btn ghost" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  if (loading && !tasks.length) {
    return <div className="empty" aria-busy="true"><strong>Loading tasks…</strong><p>One moment.</p></div>;
  }
  if (!tasks.length) {
    return <div className="empty"><strong>Nothing here</strong><p>No task matches what is on screen.</p></div>;
  }

  // The header box speaks for THIS PAGE, and says so. Ticking twenty rows
  // while the label implied four hundred is how a bulk delete takes more
  // than anybody meant; "Select all 439" is on the bar for that.
  const onPage = shown.rows.map((t) => t.id);
  const pageAll = onPage.length > 0 && onPage.every((id) => picked?.has(id));
  const pageSome = !pageAll && onPage.some((id) => picked?.has(id));

  return (
    <div className="tt">
      <div className="tt-scroll">
        <table className="tt-table">
          <thead>
            <tr>
              <th className="tt-pick">
                <input
                  type="checkbox"
                  checked={pageAll}
                  ref={(el) => { if (el) el.indeterminate = pageSome; }}
                  onChange={() => onPickMany(onPage, !pageAll)}
                  aria-label={`Select the ${onPage.length} tasks on this page`}
                  title={`The ${onPage.length} on this page`}
                />
              </th>
              <th className="tt-num" title="Row number">#</th>
              {HEAD.map((h) => {
                const on = sort.key === h.key;
                return (
                  <th key={h.key} className={`tt-h-${h.key}`} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button className={`tt-sort ${on ? 'on' : ''}`} onClick={() => press(h.key)}>
                      {h.label}
                      <Icon name="chevronDown" size={13} className={on && sort.dir === 'asc' ? 'up' : ''} />
                    </button>
                  </th>
                );
              })}
              <th className="tt-act"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.rows.map((task, i) => (
              <Row
                key={task.id}
                task={task}
                num={shown.from + i}
                folder={folderOf(task)}
                picked={Boolean(picked?.has(task.id))}
                onPick={onPick}
                onOpen={onOpen}
                onStatus={onStatus}
                onQuickDate={onQuickDate}
                onDeadline={onDeadline}
                onStepsChanged={onStepsChanged}
                onNoteToStep={onNoteToStep}
                onError={onError}
                onDelete={onDelete}
                onNotATask={onNotATask}
                onAddUpdate={onAddUpdate}
                onLoadNotes={onLoadNotes}
                onRename={onRename}
                onDone={onDone}
                people={people}
                onAssign={onAssign}
                groups={groups}
                onMove={onMove}
                onManageGroups={onManageGroups}
                onNewGroup={onNewGroup}
              />
            ))}
          </tbody>
        </table>
      </div>

      <footer className="tt-foot">
        <span className="tt-count">
          Showing <b>{shown.from}–{shown.to}</b> of <b>{shown.total}</b>
          {sort.key && <> · sorted by {HEAD.find((h) => h.key === sort.key)?.label.toLowerCase()}</>}
        </span>
        {shown.pages > 1 && (
          <nav className="tt-pages" aria-label="Pages">
            <button className="icon-btn" disabled={shown.page === 1} onClick={() => setPage(shown.page - 1)} aria-label="Previous page">‹</button>
            {pageList(shown.page, shown.pages).map((p, i) => (p === 'gap'
              ? <span key={`g${i}`} className="tt-gap">…</span>
              : (
                <button
                  key={p}
                  className={`tt-page ${p === shown.page ? 'on' : ''}`}
                  aria-current={p === shown.page ? 'page' : undefined}
                  onClick={() => setPage(p)}
                >
                  {p}
                </button>
              )))}
            <button className="icon-btn" disabled={shown.page === shown.pages} onClick={() => setPage(shown.page + 1)} aria-label="Next page">›</button>
          </nav>
        )}
        <label className="tt-size">
          <select value={size} onChange={(e) => pickSize(Number(e.target.value))}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
        </label>
      </footer>
    </div>
  );
}
