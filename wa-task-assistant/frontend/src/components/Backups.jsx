import { useState } from 'react';

const mb = (n) => (n == null ? '—' : n >= 1e9
  ? `${(n / 1e9).toFixed(1)} GB`
  : `${Math.max(1, Math.round(n / 1e6))} MB`);

const ago = (iso) => {
  if (!iso) return null;
  const hours = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (hours < 1) return 'less than an hour ago';
  if (hours < 24) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

/**
 * Copies of the database, and the one thing they do not cover.
 *
 * Until this shipped there was no copy of anything anywhere: every task,
 * message and lead sat in one SQLite file on one Railway volume. A nightly
 * copy closes the likely accidents - a bad migration, a wrong delete, a
 * corrupted page.
 *
 * What it does not close is losing the volume, because every copy is on it.
 * That is why the download is the loudest control here rather than a detail at
 * the end: it is the only action on this panel that survives the failure the
 * panel exists for, and a row of green ticks that implied otherwise would be
 * worse than no panel at all.
 */
export default function Backups({ state, onMake, onDownload, onError, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState(null);

  if (!state) return null;
  const { latest, count, keep, totalBytes, freeBytes, databaseBytes, backups = [] } = state;
  const stale = latest && (Date.now() - new Date(latest.at).getTime()) > 36 * 36e5;

  const run = async (fn, mark) => {
    mark(true);
    try { await fn(); await onRefresh(); }
    catch (err) { onError(err); }
    finally { mark(false); }
  };

  return (
    <section className="settings-block">
      <header className="settings-head">
        <h3>Backups</h3>
        <span>{count ? `${count} cop${count === 1 ? 'y' : 'ies'} kept` : 'No copy yet'}</span>
      </header>

      {!latest ? (
        <p className="field-note">
          <b>There is no copy of your data yet.</b> One is taken automatically each
          night and the last {keep} are kept. You can take the first one now.
        </p>
      ) : (
        <p className="field-note">
          Last copy <b>{ago(latest.at)}</b> — <code>{latest.name}</code>, {mb(latest.bytes)}.
          A copy is taken each night and the last {keep} are kept
          ({mb(totalBytes)} in total). The database itself is {mb(databaseBytes)}
          {freeBytes != null && <>, with {mb(freeBytes)} free on the volume</>}.
        </p>
      )}

      {stale && (
        <p className="field-note warn-text">
          The last copy is more than a day old. The nightly job runs on the same
          timer as your reminders — if those are arriving, check the logs for a
          backup that was refused for space.
        </p>
      )}

      <div className="set-row" style={{ gap: 8, marginTop: 10 }}>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => run(onMake, setBusy)}
        >
          {busy ? 'Copying…' : 'Take a copy now'}
        </button>
        {latest && (
          <button
            type="button"
            className="btn primary"
            disabled={pulling === latest.name}
            onClick={() => run(() => onDownload(latest.name), (v) => setPulling(v ? latest.name : null))}
          >
            {pulling === latest.name ? 'Downloading…' : 'Download the latest'}
          </button>
        )}
      </div>

      {backups.length > 1 && (
        <ul className="plain-list" style={{ marginTop: 12 }}>
          {backups.slice(1).map((b) => (
            <li key={b.name}>
              <code>{b.name}</code> · {mb(b.bytes)} ·{' '}
              <button
                type="button"
                className="linkish"
                onClick={() => run(() => onDownload(b.name), (v) => setPulling(v ? b.name : null))}
              >
                {pulling === b.name ? 'Downloading…' : 'Download'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="field-note quiet" style={{ marginTop: 12 }}>
        <b>These copies live on the same volume as the database.</b> They cover a
        bad migration, a wrong delete or a corrupted file — not the volume itself
        being lost. For that, download one and keep it somewhere else. Once a
        month is enough to turn a disaster into an afternoon.
      </p>
    </section>
  );
}
