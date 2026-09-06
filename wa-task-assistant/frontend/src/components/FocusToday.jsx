import Icon from './Icon.jsx';
import { dueLabel, isOverdue, taskChat, todayIso } from '../lib/task.js';

const PRIORITY = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' };

/**
 * The three things most worth doing now, in the order they earn attention:
 * late first, then urgent, then today's work, then what is already underway.
 * Ranked from the real list - if nothing qualifies, the strip says so.
 */
export function focusTasks(tasks, limit = 3) {
  const today = todayIso();
  const rank = (t) => {
    if (isOverdue(t)) return 0;
    if (t.priority === 'high') return 1;
    if (t.due_date === today) return 2;
    if (t.status === 'in_progress') return 3;
    return 9;
  };
  return tasks
    .filter((t) => t.status !== 'done' && rank(t) < 9)
    .sort((a, b) => rank(a) - rank(b) || (a.due_date || '9999').localeCompare(b.due_date || '9999'))
    .slice(0, limit);
}

export default function FocusToday({ tasks, onOpen, onToggle }) {
  const focus = focusTasks(tasks);

  return (
    <section className="focus" aria-label="Focus today">
      <header className="focus-head">
        <h3>Focus today</h3>
        <span>
          {focus.length === 0
            ? 'Nothing needs attention'
            : `${focus.length} ${focus.length === 1 ? 'task needs' : 'tasks need'} your attention`}
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
            const chat = taskChat(task);
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
                    {chat ? ` · ${chat}` : ''} · {task.origin === 'ai' ? 'AI-created' : 'Manual'}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
