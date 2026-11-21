import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { LOGIN_THROTTLE, waitInWords } from '../../../../shared/loginThrottle.js';

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
  const [slowed, setSlowed] = useState([]);
  const [only, setOnly] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const query = only ? `?ok=${only === 'ok'}` : '';
        const { logins: list, slowed: waiting } = await api.get(`/auth/logins${query}`);
        setLogins(list);
        setSlowed(waiting || []);
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

      {/*
        * Somebody is being guessed at RIGHT NOW. This is the one line on this
        * screen worth acting on, so it sits above the list rather than being
        * something to notice in a column of timestamps.
        */}
      {slowed.length > 0 && (
        <div className="bulk-bar warn-bar">
          <strong>Being answered slowly right now</strong>
          <ul className="plain-list">
            {slowed.map((row) => (
              <li key={row.username}>
                <strong>{row.username}</strong> — {row.failures} wrong passwords, next answer in{' '}
                {waitInWords(row.seconds_left)}.
              </li>
            ))}
          </ul>
          <p className="muted small">
            Nobody is locked out. The wait runs out on its own, and the right password clears it.
            If this is one of your people, they have forgotten theirs — reset it under{' '}
            <strong>Logins</strong>. If it is a username nobody here uses, somebody is guessing.
          </p>
        </div>
      )}

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
      <p className="muted small">
        The first {LOGIN_THROTTLE.free} wrong passwords cost nothing; after that each one is
        answered more slowly, up to {waitInWords(LOGIN_THROTTLE.max_wait_seconds)}, counted per
        username. <strong>It is a wait, never a lockout</strong> — an account that closed after a
        few wrong guesses could be shut by anybody who knew the username, on the day payroll had
        to go out.
      </p>
    </section>
  );
}
