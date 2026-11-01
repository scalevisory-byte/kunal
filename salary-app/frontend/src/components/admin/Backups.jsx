import { useEffect, useState } from 'react';
import { api, getToken } from '../../api.js';

const when = (v) => String(v || '').replace('T', ' ').slice(0, 16);
const mb = (bytes) => `${(Number(bytes || 0) / 1024 / 1024).toFixed(1)} MB`;

/**
 * Backups.
 *
 * There were none on the server at all. One full copy a day now, kept for a
 * fortnight, in a folder on the same volume the database lives on.
 *
 * The page says the thing a backup page usually does not: a copy on the same
 * volume survives a bad deploy, a dropped table and a wrong delete, and it does
 * **not** survive losing the volume. That is what the download button is for.
 */
export default function Backups({ onError }) {
  const [backups, setBackups] = useState([]);
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');

  const load = async () => {
    try {
      const body = await api.get('/auth/backups');
      setBackups(body.backups);
      setFolder(body.folder);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const takeOne = async () => {
    setBusy(true);
    setSaid('');
    try {
      const { backup } = await api.post('/auth/backups', {});
      setSaid(`Took a copy: ${backup.name}, ${mb(backup.size)}.`);
      load();
    } catch (err) {
      setSaid(err.message);
    } finally {
      setBusy(false);
    }
  };

  const download = async (name) => {
    try {
      const token = getToken();
      const res = await fetch(`/api/auth/backups/${encodeURIComponent(name)}`, {
        credentials: 'same-origin',
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`Could not download that (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setSaid(err.message);
    }
  };

  return (
    <section className="stack">
      <div className="card">
        <div className="late-head">
          <div>
            <h3>Backups</h3>
            <p className="muted small">
              One complete copy a day, kept for a fortnight. Written with SQLite&rsquo;s own
              <code> VACUUM INTO</code>, so it is a whole, consistent file even while the app is
              being used.
            </p>
          </div>
          <button onClick={takeOne} disabled={busy}>
            {busy ? 'Copying…' : 'Take one now'}
          </button>
        </div>
        {said && <p className="muted small">{said}</p>}
      </div>

      <div className="card">
        <h4>Where this protects you, and where it does not</h4>
        <ul className="alerts">
          <li>
            <strong>A bad deploy, a dropped table, a wrong delete</strong> — covered. The copies
            sit in <code>{folder || 'DATA_DIR/backups'}</code> and you can restore from one.
          </li>
          <li>
            <strong>Losing the volume itself</strong> — <em>not</em> covered, because the copies
            are on it. Download one now and again and keep it somewhere else. That is what the
            button below each one is for.
          </li>
        </ul>
      </div>

      {!backups.length ? (
        <p className="muted small">No copies yet. The first runs a minute after the app starts.</p>
      ) : (
        <table className="sheet">
          <thead>
            <tr>
              <th>File</th>
              <th>Taken</th>
              <th className="num">Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.name}>
                <td className="sticky-name">{b.name}</td>
                <td className="muted small">{when(b.at)}</td>
                <td className="num">{mb(b.size)}</td>
                <td>
                  <button className="ghost small" onClick={() => download(b.name)}>
                    download
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="card">
        <h4>Restoring one</h4>
        <p className="muted small">
          There is no button for this on purpose — restoring replaces everything, and it should
          take a deliberate minute at a terminal rather than one mis-click. Stop the app, put the
          chosen file in place of <code>salary.db</code> in the data folder, remove the
          <code> salary.db-wal</code> and <code>salary.db-shm</code> files beside it if they are
          there, and start it again. The full steps are in the README under
          &ldquo;Restoring a backup&rdquo;.
        </p>
      </div>
    </section>
  );
}
