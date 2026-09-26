import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import { RowMenu, AssignButton } from './TaskItem.jsx';
import { useRename } from '../rename.js';
import { sortRows, pageOf, pageList, PAGE_SIZES } from '../lib/table.js';
import {
  STATUSES, PRIORITIES, isDone, dueLabel, taskSource, timeLabel, receivedStamp,
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
 * a table has a Status column, and completing a task is that column's job.
 * One box per row, one meaning per box.
 */

const HEAD = [
  // When it came in, first - the same column the list leads with.
  { key: 'added', label: 'Received' },
  { key: 'task', label: 'Task' },
  { key: 'folder', label: 'Business / Folder' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'due', label: 'Due date' },
  { key: 'priority', label: 'Priority' },
  { key: 'status', label: 'Status' },
];

function Title({ task, onOpen, rename }) {
  if (rename.editing) return <input {...rename.fieldProps} />;
  return (
    <button
      className="tt-title"
      onClick={() => rename.openLater(() => onOpen(task))}
      onDoubleClick={rename.start}
      onKeyDown={(e) => { if (e.key === 'F2') { e.preventDefault(); rename.start(); } }}
      title={rename.enabled ? 'Open · double-click or F2 to rename' : 'Open'}
    >
      {task.title}
    </button>
  );
}

function Row({ task, folder, picked, onPick, onOpen, onStatus, onQuickDate, onDelete, onNotATask, onAddUpdate, onRename, people, onAssign }) {
  const done = isDone(task);
  // A finished task is not late: it is done, and when it was done is the fact.
  const due = done ? null : dueLabel(task.due_date);
  const finished = done ? receivedStamp(task.completed_at) : null;
  const received = receivedStamp(task.created_at);
  const source = taskSource(task);
  // One rename per row, shared by the title and the menu: the menu's Rename
  // is the same edit for a thumb, which has neither F2 nor a double-click.
  const rename = useRename(task, onRename, { canEdit: !isDone(task) });
  return (
    <tr className={`${picked ? 'picked' : ''} ${isDone(task) ? 'is-done' : ''}`}>
      <td className="tt-pick">
        <input
          type="checkbox"
          checked={picked}
          onChange={() => onPick(task)}
          aria-label={`Select ${task.title}`}
        />
      </td>
      <td className="tt-rec">
        {received ? <>{received.day}<small>{received.clock}</small></> : <span className="tt-none">—</span>}
      </td>
      <td className="tt-task">
        <Title task={task} onOpen={onOpen} rename={rename} />
        {/* Who asked. A column of titles with nobody behind them is how "ye sab
            me kisne msg kiya" was asked the first time. */}
        {source && (
          <small className={source.unnamed ? 'unnamed' : ''} title={source.id || undefined}>
            {source.label}
          </small>
        )}
      </td>
      <td className="tt-folder">
        {folder
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
          <span className="tt-none">Done{finished && <small>{finished.day}</small>}</span>
        ) : due ? (
          <>
            {due.text}
            {task.due_at && <small>{timeLabel(task.due_at)}</small>}
          </>
        ) : <span className="tt-none">No date</span>}
      </td>
      <td>
        {task.priority
          ? <span className={`tt-pri p-${task.priority}`}>{PRIORITIES.find((p) => p.key === task.priority)?.label || task.priority}</span>
          : <span className="tt-none">—</span>}
      </td>
      <td>
        {/* The one place a task is finished from, in a table. A select rather
            than a chip that cycles: four states, each named, one press. */}
        <select
          className={`tt-status s-${task.status}`}
          value={task.status}
          onChange={(e) => onStatus(task, e.target.value)}
          aria-label={`Status of ${task.title}`}
        >
          {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
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
          onAddUpdate={(t) => onAddUpdate(t)}
          onRename={rename.enabled ? rename.start : undefined}
        />
      </td>
    </tr>
  );
}

export default function TaskTable({
  tasks, loading, error, groups = [], picked, onPick, onPickMany, scope = '',
  onRetry, onOpen, onStatus, onQuickDate, onDelete, onNotATask, onAddUpdate, onRename,
  people = [], onAssign,
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
    () => sortRows(tasks, sort.key, sort.dir, { folderOf: (t) => folderOf(t)?.name }),
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
              {HEAD.map((h) => {
                const on = sort.key === h.key;
                return (
                  <th key={h.key} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
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
            {shown.rows.map((task) => (
              <Row
                key={task.id}
                task={task}
                folder={folderOf(task)}
                picked={Boolean(picked?.has(task.id))}
                onPick={onPick}
                onOpen={onOpen}
                onStatus={onStatus}
                onQuickDate={onQuickDate}
                onDelete={onDelete}
                onNotATask={onNotATask}
                onAddUpdate={onAddUpdate}
                onRename={onRename}
                people={people}
                onAssign={onAssign}
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
