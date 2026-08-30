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
        {stats && (
          <>
            <span className="pill muted">{stats.open ?? 0} open</span>
            {overdueCount > 0 && <span className="pill warn">{overdueCount} overdue</span>}
            <span className="pill muted">{stats.done ?? 0} done</span>
          </>
        )}
        {wa?.bufferedCount > 0 && (
          <span className="pill muted">{wa.bufferedCount} message(s) queued</span>
        )}
      </div>

      {state === 'qr' && wa?.qrDataUrl && (
        <div className="qr">
          <p>Open WhatsApp on your phone → Settings → Linked devices → Link a device, then scan:</p>
          <img src={wa.qrDataUrl} alt="WhatsApp linking QR code" width="240" height="240" />
        </div>
      )}

      {state === 'error' && wa?.lastError && <p className="hint error-text">{wa.lastError}</p>}
    </section>
  );
}
