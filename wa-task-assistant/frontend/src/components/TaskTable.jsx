import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { RowMenu, AssignButton, GroupButton } from './TaskItem.jsx';
import { useRename } from '../rename.js';
import { sortRows, pageOf, pageList, PAGE_SIZES } from '../lib/table.js';
import {
  isDone, dueLabel, taskSource, timeLabel, receivedStamp,
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

function NotePanel({ task, onAddUpdate, onLoadNotes, onClose }) {
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
            return <li key={u.id}><span>{u.body}</span>{at && <small>{at.day} · {at.clock}</small>}</li>;
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

function Row({ task, num, folder, picked, onPick, onOpen, onStatus, onQuickDate, onDelete, onNotATask, onDone, onAddUpdate, onLoadNotes, onRename, people, onAssign, groups, onMove, onManageGroups, onNewGroup }) {
  const done = isDone(task);
  // A finished task is not late: it is done, and when it was done is the fact.
  const due = done ? null : dueLabel(task.due_date);
  const finished = done ? receivedStamp(task.completed_at) : null;
  const received = receivedStamp(task.created_at);
  const source = taskSource(task);
  // One rename per row, shared by the title and the menu: the menu's Rename
  // is the same edit for a thumb, which has neither F2 nor a double-click.
  const rename = useRename(task, onRename, { canEdit: !isDone(task) });
  const [noting, setNoting] = useState(false);
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
          {onAddUpdate && onLoadNotes && <NoteMark task={task} open={noting} onPress={() => setNoting((v) => !v)} />}
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
          onAddUpdate={() => setNoting(true)}
          onRename={rename.enabled ? rename.start : undefined}
        />
      </td>
    </tr>
    {noting && (
      <tr className="tt-note-row">
        <td colSpan={HEAD.length + 3}>
          <NotePanel task={task} onAddUpdate={onAddUpdate} onLoadNotes={onLoadNotes} onClose={() => setNoting(false)} />
        </td>
      </tr>
    )}
    </>
  );
}

export default function TaskTable({
  tasks, loading, error, groups = [], picked, onPick, onPickMany, scope = '',
  onRetry, onOpen, onStatus, onQuickDate, onDelete, onNotATask, onDone, onAddUpdate, onLoadNotes, onRename,
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
