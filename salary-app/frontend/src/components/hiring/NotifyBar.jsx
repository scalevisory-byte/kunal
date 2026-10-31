/**
 * A stage move usually means somebody has to be told. Dragging a card on the
 * board puts the message here rather than opening the whole card: the point is
 * one tap to send, not a detour.
 *
 * Nothing is sent by the app. There is no WhatsApp session behind this - the
 * link opens WhatsApp on Dinesh's own number, and he presses send.
 */
export default function NotifyBar({ notify, onDismiss, onCopy }) {
  if (!notify) return null;
  return (
    <div className="notify-bar">
      <div className="who">
        <strong>{notify.who}</strong> → {notify.stage}
      </div>
      <p className="preview">{notify.text.replace(/\n+/g, ' ').slice(0, 110)}…</p>
      <div className="row">
        <a className="btn primary" href={notify.whatsapp} target="_blank" rel="noreferrer">
          Send on WhatsApp
        </a>
        <button onClick={() => onCopy(notify.text)}>Copy</button>
        <button className="link" onClick={onDismiss}>
          not now
        </button>
      </div>
    </div>
  );
}
