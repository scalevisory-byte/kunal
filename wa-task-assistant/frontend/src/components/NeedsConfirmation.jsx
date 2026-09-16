import { useState } from 'react';
import Icon from './Icon.jsx';

const SHUT = 'wa-tasks-confirm-shut';

/* Remembered between visits, but never silently: see the header below. */
const wasShut = () => {
  try { return localStorage.getItem(SHUT) === '1'; } catch { return false; }
};

/**
 * Extractions the model itself said it was unsure about.
 *
 * These are not chased - no reminder, no follow-up, not in the morning
 * briefing - until a person says they are real. Being reminded about something
 * that was never a task is worse than not being reminded, because it teaches
 * you to ignore the reminders.
 *
 * The wording is careful: "unsure" is the model's own report, not a measurement
 * the app made.
 */
export default function NeedsConfirmation({ tasks, onConfirm, onReject, onOpen }) {
  /*
   * Shut, and it stays shut.
   *
   * Six of these at the top of the dashboard is the whole first screen, and
   * they are the least urgent thing on it - nothing here is being chased.
   * So the panel rolls up to its own header and remembers that.
   *
   * What it does NOT do is disappear: the count stays on the header, in the
   * same place, so a shut panel still says how many are waiting. A thing you
   * can put away and then never be told about again is how work goes missing.
   */
  const [shut, setShut] = useState(wasShut);

  if (!tasks?.length) return null;

  const toggle = () => {
    const next = !shut;
    setShut(next);
    try { localStorage.setItem(SHUT, next ? '1' : '0'); } catch { /* private window */ }
  };

  return (
    <section className={`confirm-panel ${shut ? 'shut' : ''}`}>
      <header>
        <h3>
          <Icon name="robot" size={16} />
          Is this a task?
        </h3>
        <span>{tasks.length} waiting</span>
        <button
          type="button"
          className="confirm-shut"
          onClick={toggle}
          aria-expanded={!shut}
          title={shut ? 'Show these' : 'Hide these'}
        >
          {shut ? 'Show' : 'Hide'}
          <Icon name="chevronDown" size={15} />
        </button>
      </header>

      {shut ? null : <>
      <p className="confirm-lede">
        Claude picked these out of your chats but said it was not sure about them.
        They are not being reminded about until you say.
      </p>

      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            <div className="confirm-what">
              <button type="button" className="confirm-title" onClick={() => onOpen(task)}>
                {task.title}
              </button>
              <div className="confirm-meta">
                {task.chat_name && <span><Icon name="chat" size={12} /> {task.chat_name}</span>}
                {task.due_date && <span><Icon name="clock" size={12} /> {task.due_date}</span>}
              </div>
              {task.source_message && (
                <blockquote className="confirm-source">{task.source_message}</blockquote>
              )}
            </div>
            <div className="confirm-actions">
              <button type="button" className="btn small" onClick={() => onConfirm(task)}>
                Yes, keep it
              </button>
              <button type="button" className="btn small ghost" onClick={() => onReject(task)}>
                Not a task
              </button>
            </div>
          </li>
        ))}
      </ul>
      </>}
    </section>
  );
}
