import { useEffect, useState } from 'react';
import { api } from '../../api.js';

const when = (v) => String(v || '').replace('T', ' ').slice(0, 16);

const ENTITY_LABEL = {
  attendance: 'Attendance',
  payroll_rows: 'Salary sheet',
  periods: 'Month',
  employee_notes: 'On the record',
  appraisals: 'Appraisal',
  assets: 'Asset',
  expense_claims: 'Claim',
  employee_exits: 'Leaving',
};

/**
 * Who changed what, and when.
 *
 * `who` is now the signed-in login, read off the session and beating anything
 * the request body claims. It used to be a name typed on a form, and the page
 * said so; that caveat now only appears for somebody reaching the app with the
 * API key instead of a login, because for them it is still true.
 *
 * What it records and what it does not is the useful part. A corrected
 * attendance mark is here; a blank day being filled in is not — so "Mark
 * everyone Present" and the biometric import stay out of it, while an absence
 * turned into sick leave after the fact is exactly what somebody comes looking
 * for. The same for the salary sheet: a figure typed over a formula is here,
 * and typing the same figure again is not a change.
 */
export default function Trail({ me, onError }) {
  const [entries, setEntries] = useState([]);
  const [entity, setEntity] = useState('');
  const [who, setWho] = useState('');
  // Since logins exist, "who" is somebody the server checked. The caveat only
  // belongs on an installation still being reached by the API key, or one
  // running with nothing guarding it at all.
  const checked = me?.via === 'session';

  useEffect(() => {
    const load = async () => {
      const query = new URLSearchParams();
      if (entity) query.set('entity', entity);
      if (who.trim()) query.set('who', who.trim());
      query.set('limit', '300');
      try {
        const { entries: list } = await api.get(`/people/audit?${query}`);
        setEntries(list);
      } catch (err) {
        onError(err);
      }
    };
    const timer = setTimeout(load, who ? 250 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, who]);

  return (
    <section className="stack">
      <div className="toolbar">
        <label>
          What
          <select value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">Everything</option>
            {Object.entries(ENTITY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Who
          <input type="text" value={who} placeholder="a name" onChange={(e) => setWho(e.target.value)} />
        </label>
      </div>

      <p className="muted small">
        {checked ? (
          <>
            &ldquo;Who&rdquo; is the login that made the change, taken from the session rather
            than from anything the browser claimed.
          </>
        ) : (
          <>
            You are here on the dashboard password rather than a login, so changes you make are
            recorded as <em>the API key</em>. Sign in with a login and your own name goes on them.
          </>
        )}
      </p>

      {!entries.length ? (
        <p className="muted small">Nothing recorded yet.</p>
      ) : (
        <table className="sheet trail">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Did what</th>
              <th>To</th>
              <th>Field</th>
              <th>From</th>
              <th>To</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="muted small">{when(entry.at)}</td>
                <td>{entry.who || <span className="muted">—</span>}</td>
                <td>
                  {entry.action}
                  <div className="muted small">{ENTITY_LABEL[entry.entity] || entry.entity}</div>
                </td>
                <td>
                  {entry.label || '—'}
                  {entry.note && <div className="muted small">{entry.note}</div>}
                </td>
                <td className="muted small">{entry.field || '—'}</td>
                <td className="val">{entry.from_value ?? '—'}</td>
                <td className="val">{entry.to_value ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
