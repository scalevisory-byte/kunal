const LABELS = {
  starting: 'Starting…',
  qr: 'Waiting for QR scan',
  authenticated: 'Authenticated',
  ready: 'Connected',
  disconnected: 'Disconnected',
  error: 'Error',
};

export default function StatusBar({ status, stats, overdueCount }) {
  const wa = status?.whatsapp;
  const state = wa?.status || 'starting';

  return (
    <section className="status">
      <div className="status-row">
        <span className={`pill ${state}`}>
          <span className="dot" /> WhatsApp: {LABELS[state] || state}
        </span>
        {wa?.mode && <span className="pill">{wa.mode === 'manual' ? 'manual capture' : 'AI reading'}</span>}
        {wa?.bufferedCount > 0 && (
          <span className="pill">{wa.bufferedCount} message(s) queued</span>
        )}
      </div>

      {wa?.mode === 'manual' && state === 'ready' && (
        <p className="hint mode-hint">
          <strong>Manual mode</strong> — nothing is read automatically. Forward a WhatsApp
          message to your own chat, or start any message with{' '}
          <code>{status?.config?.taskTrigger || '#task'}</code>, and it becomes a task.
        </p>
      )}

      {wa?.mode === 'ai' && state === 'ready' && (
        <p className="hint mode-hint">
          <strong>AI mode</strong> — incoming chats are read automatically and actionable
          messages become tasks.
        </p>
      )}

      {state === 'qr' && wa?.qrDataUrl && (
        <div className="qr">
          <p>
            Open WhatsApp on your phone → <b>Settings → Linked devices → Link a device</b>,
            get the camera ready <em>first</em>, then scan. The code refreshes every few
            seconds — scan the one on screen right away.
          </p>
          <img src={wa.qrDataUrl} alt="WhatsApp linking QR code" width="240" height="240" />
        </div>
      )}

      {state === 'error' && wa?.lastError && <p className="hint error-text">{wa.lastError}</p>}
    </section>
  );
}
