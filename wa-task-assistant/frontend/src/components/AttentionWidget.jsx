import Icon from './Icon.jsx';
import { SNOOZE_OPTIONS, clock, dueLabel, needsAttention } from '../lib/schedule.js';

/**
 * The tasks the app is currently chasing the user about. Every figure comes
 * from the loaded tasks; with nothing outstanding it says so rather than
 * showing a zero.
 */
/*
 * How many fit before the card becomes the page.
 *
 * Three, and then it says how many there are — a card that quietly stops at
 * three leaves you believing three is all there is, which is the one thing a
 * count like this must never do.
 */
const SHOWN = 3;

export default function AttentionWidget({ tasks, onDone, onSnooze, onOpen, onViewAll }) {
  const chasing = needsAttention(tasks);
  const overdue = chasing.filter((t) => t.state === 'overdue' || t.needs_attention).length;
  const due = chasing.filter((t) => t.state === 'due').length;

  return (
    <section className="rail-card">
      <h3 className="rail-title">Needs attention</h3>

      {chasing.length === 0 ? (
        <p className="rail-state on">
          <span className="state-dot" />
          Nothing is overdue
        </p>
      ) : (
        <>
          <p className="fu-counts">
            {overdue > 0 && <span className="danger-text">{overdue} overdue</span>}
            {overdue > 0 && due > 0 && <span className="sep">·</span>}
            {due > 0 && <span className="warn-text">{due} due</span>}
          </p>

          <ul className="attn-list">
            {chasing.slice(0, SHOWN).map((task) => (
              <li key={task.id}>
                <button className="attn-title" onClick={() => onOpen(task)}>{task.title}</button>
                <span className={`attn-when ${task.state === 'overdue' ? 'danger-text' : 'warn-text'}`}>
                  {dueLabel(task.due_at)}
                  {task.follow_up_count > 0 && (
                    // Past the cap the counter keeps climbing internally, and
                    // "follow-up 4 of 3" is not a thing anyone can read. The
                    // same wording the engine page uses.
                    task.follow_up_count >= task.follow_up_max
                      ? ` · all ${task.follow_up_max} follow-ups spent`
                      : ` · follow-up ${task.follow_up_count} of ${task.follow_up_max}`
                  )}
                </span>
                {task.needs_attention && (
                  <span className="attn-flag"><Icon name="alert" size={12} /> No more reminders</span>
                )}
                <div className="attn-tools">
                  <button className="tool" onClick={() => onDone(task)}>Done</button>
                  <button className="tool" onClick={() => onSnooze(task, SNOOZE_OPTIONS[1].minutes)}>+1h</button>
                  <button className="tool" onClick={() => onOpen(task)}>Reschedule</button>
                </div>
              </li>
            ))}
          </ul>

          {chasing.length > SHOWN && (
            <button className="link attn-more" onClick={onViewAll}>
              Showing {SHOWN} of {chasing.length} — view all
            </button>
          )}
        </>
      )}
    </section>
  );
}
