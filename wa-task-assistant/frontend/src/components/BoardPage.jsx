import { useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';
import { dueLabel, isDone, isOverdue } from '../lib/task.js';

/**
 * The businesses, laid out two ways.
 *
 * Horizontal is for comparing — five side by side, read across in one glance.
 * Vertical is for working: one open at a time, everything else folded down to
 * a name and a number, so the business you are actually on has the screen.
 *
 * Both draw the same column and the same rows; only the layout differs. That
 * is the whole point of the pair — nothing gains or loses a feature by
 * switching, so the choice is about how you want to look, never about what you
 * can do.
 */
const VIEW_STORE = 'wa.board.view';
const OPEN_STORE = 'wa.board.open';

const readView = () => {
  try {
    return localStorage.getItem(VIEW_STORE) === 'vertical' ? 'vertical' : 'horizontal';
  } catch {
    return 'horizontal';
  }
};

const readOpen = () => {
  try {
    const raw = Number(localStorage.getItem(OPEN_STORE));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  } catch {
    return null;
  }
};

const remember = (key, value) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch { /* private window */ }
};

/**
 * One line, one task, filed where you typed it.
 *
 * Adding a task and then moving it into the business you were already looking
 * at is two steps for one intention. A title is all it asks for — everything
 * else is in the drawer, and most of it is a guess at this point anyway.
 */
function AddTask({ groupId, onAdded, onError }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async (event) => {
    event.preventDefault();
    const clean = title.trim();
    if (!clean) return;
    setBusy(true);
    try {
      await api.createTask({ title: clean, group_id: groupId ?? null });
      setTitle('');
      onAdded();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="board-add" onClick={() => setOpen(true)}>
        <Icon name="plus" size={14} /> Add a task
      </button>
    );
  }

  return (
    <form className="board-add-form" onSubmit={add}>
      <input
        value={title}
        autoFocus
        placeholder="What needs doing?"
        aria-label="New task title"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && (setOpen(false), setTitle(''))}
      />
      <div className="board-add-foot">
        <button type="submit" className="btn small" disabled={busy || !title.trim()}>Add</button>
        <button type="button" className="link" onClick={() => { setOpen(false); setTitle(''); }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** A business made from the board, without going to Manage groups for a name. */
function NewBusiness({ onAdded, onError }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async (event) => {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    setBusy(true);
    try {
      const { group } = await api.createGroup({ name: clean });
      // The same catch-up a group made in Settings gets: work already on the
      // list that matches its name moves in, rather than only future tasks.
      await api.applyGroup(group.id);
      setName('');
      setOpen(false);
      onAdded();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="board-col board-new">
      {open ? (
        <form className="board-add-form" onSubmit={add}>
          <input
            value={name}
            autoFocus
            placeholder="Business name"
            aria-label="New business name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (setOpen(false), setName(''))}
          />
          <p className="board-note">
            Tasks that mention it move in on their own. Add other words it goes by
            in <b>Manage groups</b>.
          </p>
          <div className="board-add-foot">
            <button type="submit" className="btn small" disabled={busy || !name.trim()}>Create</button>
            <button type="button" className="link" onClick={() => { setOpen(false); setName(''); }}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="board-add big" onClick={() => setOpen(true)}>
          <Icon name="plus" size={15} /> New business
        </button>
      )}
    </section>
  );
}

/** The tasks inside one business — identical in both layouts. */
function Tasks({ items, onOpen, onToggle }) {
  if (!items.length) return <p className="board-empty">Nothing open.</p>;

  return (
    <ul className="board-list">
      {items.map((task) => {
        const due = dueLabel(task.due_date);
        return (
          <li key={task.id} className={isOverdue(task) ? 'late' : ''}>
            <input
              type="checkbox"
              checked={false}
              onChange={() => onToggle(task)}
              aria-label={`Mark done: ${task.title}`}
            />
            <button className="board-task" onClick={() => onOpen(task)}>
              <span className="board-title">{task.title}</span>
              {(due || task.stage) && (
                <span className="board-meta">
                  {/* dueLabel carries its own tone, so late reads late here
                      exactly as it does in the main list. */}
                  {due && <span className={due.tone ? `${due.tone}-text` : ''}>{due.text}</span>}
                  {task.stage && <span className="board-stage">{task.stage}</span>}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default function BoardPage({
  tasks, groups, onOpen, onToggle, onPickGroup, onShowUnfiled, onChanged, onError,
}) {
  const [view, setView] = useState(readView);
  // Which business is open in the vertical view. One id, not a set — that IS
  // the accordion: opening the next one closes the last by definition rather
  // than by remembering to.
  const [openId, setOpenId] = useState(readOpen);

  const open = tasks.filter((t) => !isDone(t));

  /*
   * Businesses only.
   *
   * There was a "No business" column here, and on a real board it was the
   * page: fifty-one unfiled tasks beside businesses holding three or four, so
   * the thing you came to compare was pushed off the side by the thing you
   * did not. What belongs here is what was put here — moved in from the list,
   * or typed into a column. The unfiled are every other view's job, and the
   * line under the board says how many there are rather than hiding them.
   */
  const unfiled = open.filter((t) => !t.group_id).length;

  const columns = groups.map((g) => ({
    ...g,
    items: open
      .filter((t) => t.group_id === g.id)
      .sort((a, b) => {
        // Dated work first, soonest at the top; undated below it, newest first.
        const ad = a.due_date || '';
        const bd = b.due_date || '';
        if (ad && bd && ad !== bd) return ad < bd ? -1 : 1;
        if (ad && !bd) return -1;
        if (!ad && bd) return 1;
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      }),
  }));

  /*
   * Horizontal drops the empty businesses to the end; vertical leaves the
   * order alone.
   *
   * Side by side, an empty column first meant swiping past "Nothing open" on a
   * phone to reach any work. Folded down to one line each, an empty business
   * costs nothing and is worth seeing where you put it — the order you set is
   * more use than the tidying.
   */
  const shown = view === 'horizontal'
    ? [...columns].sort((a, b) => (a.items.length ? 0 : 1) - (b.items.length ? 0 : 1))
    : columns;

  const pickView = (next) => { setView(next); remember(VIEW_STORE, next); };
  const pickOpen = (id) => {
    const next = openId === id ? null : id;
    setOpenId(next);
    remember(OPEN_STORE, next);
  };


  const controls = (
    <div className="board-views" role="group" aria-label="How to show the businesses">
      <button
        type="button"
        className={view === 'horizontal' ? 'on' : ''}
        aria-pressed={view === 'horizontal'}
        title="Horizontal"
        aria-label="Horizontal view"
        onClick={() => pickView('horizontal')}
      >
        <Icon name="board" size={16} />
      </button>
      <button
        type="button"
        className={view === 'vertical' ? 'on' : ''}
        aria-pressed={view === 'vertical'}
        title="Vertical"
        aria-label="Vertical view"
        onClick={() => pickView('vertical')}
      >
        <Icon name="list" size={16} />
      </button>
      {/* Only where it does something: horizontal has nothing folded, and a
          button that does nothing when pressed is worse than one that is not
          there. */}
      {view === 'vertical' && openId !== null && (
        <button
          type="button"
          title="Collapse all"
          aria-label="Collapse all"
          onClick={() => pickOpen(null)}
        >
          <Icon name="collapse" size={16} />
        </button>
      )}
    </div>
  );

  if (!groups.length) {
    return (
      <div className="board">
        <div className="empty board-col">
          <strong>No businesses yet.</strong>
          <p>Make one and every task that mentions it lands in its own column here.</p>
        </div>
        <NewBusiness onAdded={onChanged} onError={onError} />
      </div>
    );
  }

  const footer = unfiled > 0 && (
    <p className="board-unfiled">
      {unfiled} {unfiled === 1 ? 'task is' : 'tasks are'} not in any business yet.{' '}
      <button className="link" onClick={onShowUnfiled}>See them</button>
      {' '}— move one in from its ⋮ menu, or add it to a column here.
    </p>
  );

  if (view === 'vertical') {
    return (
      <>
        {controls}
        <div className="board-stack">
          {shown.map((col) => {
            const isOpen = openId === col.id;
            const late = col.items.filter(isOverdue).length;
            return (
              <section className={`board-row ${isOpen ? 'open' : ''}`} key={col.id}>
                <button
                  type="button"
                  className="board-row-head"
                  aria-expanded={isOpen}
                  onClick={() => pickOpen(col.id)}
                >
                  <Icon name="chevronDown" size={15} className={`board-chevron ${isOpen ? '' : 'shut'}`} />
                  <span className={`board-dot c-${col.colour || 'slate'}`} aria-hidden="true" />
                  <span className="board-row-name">{col.name}</span>
                  {late > 0 && <span className="board-row-late">{late} late</span>}
                  <span className="board-count">{col.items.length}</span>
                </button>

                {isOpen && (
                  <div className="board-row-body">
                    {col.separate && <p className="board-note">Kept out of the main list</p>}
                    <Tasks items={col.items} onOpen={onOpen} onToggle={onToggle} />
                    <AddTask groupId={col.id} onAdded={onChanged} onError={onError} />
                    <button className="link board-row-only" onClick={() => onPickGroup(col.id)}>
                      Open {col.name} on its own
                    </button>
                  </div>
                )}
              </section>
            );
          })}
          <NewBusiness onAdded={onChanged} onError={onError} />
        </div>
        {footer}
      </>
    );
  }

  return (
    <>
      {controls}
      <div className="board" role="list">
        {shown.map((col) => {
          const late = col.items.filter(isOverdue).length;
          return (
            <section className="board-col" role="listitem" key={col.id}>
              <header className="board-head">
                <span className={`board-dot c-${col.colour || 'slate'}`} aria-hidden="true" />
                <button className="board-name" onClick={() => onPickGroup(col.id)}>
                  {col.name}
                </button>
                <span className="board-count">{col.items.length}</span>
              </header>

              {/* Only when there is something wrong: a column of zeros is a
                  column of noise, and "0 late" is not news. */}
              {late > 0 && <p className="board-late">{late} past its deadline</p>}
              {col.separate && <p className="board-note">Kept out of the main list</p>}

              <Tasks items={col.items} onOpen={onOpen} onToggle={onToggle} />
              <AddTask groupId={col.id} onAdded={onChanged} onError={onError} />
            </section>
          );
        })}

        <NewBusiness onAdded={onChanged} onError={onError} />
      </div>
      {footer}
    </>
  );
}
