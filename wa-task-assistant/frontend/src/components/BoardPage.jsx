
import { dueLabel, isDone, isOverdue } from '../lib/task.js';

/**
 * Every business side by side, one column each.
 *
 * The sidebar already lets you pick one group and read its list, which answers
 * "what is outstanding for Book N Fly". It cannot answer "how do the five of
 * them compare" — for that you were opening each in turn and holding the last
 * one in your head. Columns answer it by being read across.
 *
 * Deliberately thinner than the main list: a title, and when it is due. A
 * column is a quantity you take in at a glance, and every extra field on the
 * row is one fewer row on the screen. Clicking one opens the same drawer as
 * anywhere else, which is where the detail lives.
 */
const OTHER = { id: null, name: 'No business', colour: null };

export default function BoardPage({ tasks, groups, onOpen, onToggle, onPickGroup }) {
  const open = tasks.filter((t) => !isDone(t));

  // Ordered as the sidebar orders them, with the unfiled at the end — it is
  // where work lands when nothing matched, not a business of its own.
  const columns = [...groups, OTHER].map((g) => ({
    ...g,
    items: open
      .filter((t) => (g.id === null ? !t.group_id : t.group_id === g.id))
      .sort((a, b) => {
        // Dated work first, soonest at the top; undated below it, newest first.
        const ad = a.due_date || '';
        const bd = b.due_date || '';
        if (ad && bd && ad !== bd) return ad < bd ? -1 : 1;
        if (ad && !bd) return -1;
        if (!ad && bd) return 1;
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      }),
  }))
    .filter((c) => c.items.length || c.id !== null)
    /*
     * Businesses with nothing open drop to the end.
     *
     * The order otherwise follows the sidebar, which is the order he set. But a
     * phone shows one column at a time, so an empty one first meant swiping
     * past "Nothing open" to reach any actual work. Relative order is kept
     * within each half, so the comparison you came to make is unchanged.
     */
    .sort((a, b) => (a.items.length ? 0 : 1) - (b.items.length ? 0 : 1));

  if (!groups.length) {
    return (
      <div className="empty">
        <strong>No businesses yet.</strong>
        <p>
          Make one in <b>Manage groups</b> and every task that mentions it lands in its
          own column here.
        </p>
      </div>
    );
  }

  return (
    <div className="board" role="list">
      {columns.map((col) => {
        const late = col.items.filter(isOverdue).length;
        return (
          <section className="board-col" role="listitem" key={col.id ?? 'none'}>
            <header className="board-head">
              <span className={`board-dot c-${col.colour || 'slate'}`} aria-hidden="true" />
              {col.id ? (
                <button className="board-name" onClick={() => onPickGroup(col.id)}>
                  {col.name}
                </button>
              ) : (
                <span className="board-name plain">{col.name}</span>
              )}
              <span className="board-count">{col.items.length}</span>
            </header>

            {/* Only when there is something wrong: a column of zeros is a column
                of noise, and "0 late" is not news. */}
            {late > 0 && <p className="board-late">{late} past its deadline</p>}
            {col.separate && <p className="board-note">Kept out of the main list</p>}

            {col.items.length === 0 ? (
              <p className="board-empty">Nothing open.</p>
            ) : (
              <ul className="board-list">
                {col.items.map((task) => {
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
                          {/* dueLabel carries its own tone, so late reads late
                              here exactly as it does in the main list. */}
                          {due && <span className={due.tone ? `${due.tone}-text` : ''}>{due.text}</span>}
                          {task.stage && <span className="board-stage">{task.stage}</span>}
                        </span>
                      )}
                    </button>
                  </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
