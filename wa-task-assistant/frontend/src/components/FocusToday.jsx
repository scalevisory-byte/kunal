import Icon from './Icon.jsx';
import { dueLabel, isOverdue, taskSource, todayIso } from '../lib/task.js';

const PRIORITY = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' };

/*
 * Everything owed today, plus whatever is already late.
 *
 * This used to be "the three things most worth doing now" - a fixed slice of
 * three. With eleven things due today it showed three of them and said "3 tasks
 * need your attention", which is not a summary, it is a wrong number: the other
 * eight were due today too and simply vanished from a strip called Focus today.
 *
 * So the rule is now the plain one. Late and due-today are the work; all of it
 * is shown. Undated high-priority work and anything in progress are filler,
 * used only to keep the strip from being empty on a quiet day - they are not
 * due today, so they never take a place from something that is.
 */
const FILLER_TO = 3;
const SHOW_MAX = 12;

export function focusTasks(tasks, { max = SHOW_MAX } = {}) {
  const today = todayIso();
  const live = tasks.filter((t) => t.status !== 'done');
  const byPriority = (a, b) => {
    const rank = (t) => (t.priority === 'high' ? 0 : t.priority === 'medium' ? 1 : 2);
    return rank(a) - rank(b) || (a.due_at || a.due_date || '').localeCompare(b.due_at || b.due_date || '');
  };

  const late = live.filter(isOverdue).sort(byPriority);
  const today_ = live.filter((t) => !isOverdue(t) && t.due_date === today).sort(byPriority);
  const owed = [...late, ...today_];

  // Only when barely anything is owed does anything else earn a place.
  const filler = owed.length >= FILLER_TO
    ? []
    : live
        .filter((t) => !owed.includes(t) && (t.priority === 'high' || t.status === 'in_progress'))
        .sort(byPriority)
        .slice(0, FILLER_TO - owed.length);

  const all = [...owed, ...filler];
  // The count is what is owed, whether or not every row fits on the strip.
  return { tasks: all.slice(0, max), total: all.length, owed: owed.length };
}

export default function FocusToday({ tasks, onOpen, onToggle, onShowAll }) {
  const { tasks: focus, total, owed } = focusTasks(tasks);
  const hidden = total - focus.length;

  return (
    <section className="focus" aria-label="Focus today">
      <header className="focus-head">
        <h3>Focus today</h3>
        <span>
          {total === 0
            ? 'Nothing needs attention'
            : `${total} ${total === 1 ? 'task needs' : 'tasks need'} your attention`}
        </span>
      </header>

      {focus.length === 0 ? (
        <p className="focus-empty">
          <Icon name="check" size={16} /> You&rsquo;re on top of today.
        </p>
      ) : (
        <ul className="focus-list">
          {focus.map((task) => {
            const due = dueLabel(task.due_date);
            const source = taskSource(task);
            return (
              <li key={task.id} className={isOverdue(task) ? 'late' : ''}>
                <button
                  className="focus-tick"
                  aria-label={`Mark done: ${task.title}`}
                  onClick={() => onToggle(task)}
                />
                <button className="focus-body" onClick={() => onOpen(task)}>
                  <strong>{task.title}</strong>
                  <small>
                    {due ? due.text : 'No date'} · {PRIORITY[task.priority]}
                    {source ? ` · ${source.label}` : ''} · {task.origin === 'ai' ? 'AI-created' : 'Manual'}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Nothing is dropped silently: a strip too long to show says how much of
          it is not on screen, and takes you to the rest. */}
      {hidden > 0 && (
        <button className="link focus-more" onClick={onShowAll}>
          {hidden} more due today
        </button>
      )}
    </section>
  );
}
