import Icon from './Icon.jsx';
import { useRename } from '../rename.js';
import { dueLabel, isOverdue, taskSource, timeLabel, todayIso } from '../lib/task.js';

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

export default function FocusToday({ tasks, onOpen, onToggle, onShowAll, onRename }) {
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
          {focus.map((task) => (
            <FocusRow
              key={task.id}
              task={task}
              onOpen={onOpen}
              onToggle={onToggle}
              onRename={onRename}
            />
          ))}
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

/**
 * One line of the strip.
 *
 * Its own component now because it renames in place like every other list -
 * and this is the strip at the top of the page, so it is where a wrong title
 * is seen first and where "double-click to fix it" has to work.
 */
function FocusRow({ task, onOpen, onToggle, onRename }) {
  const due = dueLabel(task.due_date);
  const source = taskSource(task);
  const rename = useRename(task, onRename);

  return (
    <li className={isOverdue(task) ? 'late' : ''}>
      <button
        className="focus-tick"
        aria-label={`Mark done: ${task.title}`}
        onClick={() => onToggle(task)}
      />
      {rename.editing ? (
        <span className="focus-body editing">
          <input {...rename.fieldProps} />
        </span>
      ) : (
        <button
          className="focus-body"
          onClick={() => rename.openLater(() => onOpen(task))}
          onDoubleClick={rename.start}
          onKeyDown={(e) => { if (e.key === 'F2') { e.preventDefault(); rename.start(); } }}
          title={rename.enabled ? 'Double-click or press F2 to rename' : undefined}
        >
          <strong>{task.title}</strong>
          {/*
            * Where it came from and how urgent, then when - two lines, not
            * four. The business was missing here while every other list carried
            * it, and "Today" without the hour is the one thing you cannot act
            * on: it is the difference between a deadline at 11:30 and one at
            * six.
            */}
          <small>
            {task.group_name ? `${task.group_name} · ` : ''}
            {PRIORITY[task.priority]}
            {source ? ` · ${source.label}` : ''} · {task.origin === 'ai' ? 'AI' : 'By hand'}
          </small>
        </button>
      )}
      {rename.enabled && !rename.editing && (
        <button
          type="button"
          className="t-rename focus-rename"
          aria-label={`Rename ${task.title}`}
          title="Rename"
          onClick={rename.start}
        >
          <Icon name="edit" size={14} />
        </button>
      )}
      <span className="focus-when">
        <span className={due?.tone ? `${due.tone}-text` : ''}>
          {due ? due.text : 'No date'}
          {task.due_at ? ` · ${timeLabel(task.due_at)}` : ''}
        </span>
        {/* Only while it is actually late: before that, the next follow-up is a
            time nothing is going to happen at. */}
        {task.next_follow_up_at && isOverdue(task) && (
          <span className="focus-follow">
            <Icon name="refresh" size={11} /> {timeLabel(task.next_follow_up_at)}
          </span>
        )}
      </span>
    </li>
  );
}
