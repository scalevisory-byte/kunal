import { useEffect, useState } from 'react';
import { api } from '../../api.js';

const when = (v) => String(v || '').replace('T', ' ').slice(0, 19);

/**
 * Who signed in, when, and from where — the refusals included.
 *
 * The refusals are the point. One wrong password is somebody's thumb; ten in a
 * minute is somebody trying passwords, and that is only visible if the failures
 * are kept.
 */
export default function Logins({ onError }) {
  const [logins, setLogins] = useState([]);
  const [only, setOnly] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const query = only ? `?ok=${only === 'ok'}` : '';
        const { logins: list } = await api.get(`/auth/logins${query}`);
        setLogins(list);
      } catch (err) {
        onError(err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [only]);

  const failures = logins.filter((l) => !l.ok).length;

  return (
    <section className="stack">
      <div className="figures">
        <div className="figure">
          <span className="k">Shown</span>
          <span className="n">{logins.length}</span>
        </div>
        <div className="figure">
          <span className="k">Refused</span>
          <span className="n">{failures}</span>
        </div>
      </div>

      <div className="sub-tabs toolbar">
        {[['', 'Everything'], ['ok', 'Got in'], ['no', 'Refused']].map(([value, label]) => (
          <button key={value} className={only === value ? 'active' : undefined} onClick={() => setOnly(value)}>
            {label}
          </button>
        ))}
      </div>

      {!logins.length ? (
        <p className="muted small">Nothing recorded yet.</p>
      ) : (
        <table className="sheet trail">
          <thead>
            <tr>
              <th>When</th>
              <th>Username</th>
              <th>Result</th>
              <th>From</th>
              <th>Browser</th>
            </tr>
          </thead>
          <tbody>
            {logins.map((l) => (
              <tr key={l.id}>
                <td className="muted small">{when(l.at)}</td>
                <td>{l.username || '—'}</td>
                <td>
                  {l.ok ? (
                    <span className="muted small">signed in</span>
                  ) : (
                    <span className="pill rejected">{l.reason || 'refused'}</span>
                  )}
                </td>
                <td className="val">{l.ip || '—'}</td>
                <td className="muted small" title={l.agent || ''}>
                  {(l.agent || '—').slice(0, 40)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="muted small">
        One wrong password is somebody&rsquo;s thumb. Ten in a minute is somebody trying
        passwords — which is only visible because the refusals are kept.
      </p>
    </section>
  );
}
