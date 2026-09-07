import Icon from './Icon.jsx';

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
  if (!tasks?.length) return null;

  return (
    <section className="confirm-panel">
      <header>
        <h3>
          <Icon name="robot" size={16} />
          Is this a task?
        </h3>
        <span>{tasks.length} waiting</span>
      </header>

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
    </section>
  );
}
