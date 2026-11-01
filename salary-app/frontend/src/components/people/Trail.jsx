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
 * Deliberately plain, and deliberately honest about one thing: `who` is a name
 * typed on the form, not somebody the app authenticated. This build has one
 * shared password and no user accounts, so a trail that implied otherwise would
 * be worse than no trail.
 *
 * What it records and what it does not is the useful part. A corrected
 * attendance mark is here; a blank day being filled in is not — so "Mark
 * everyone Present" and the biometric import stay out of it, while an absence
 * turned into sick leave after the fact is exactly what somebody comes looking
 * for. The same for the salary sheet: a figure typed over a formula is here,
 * and typing the same figure again is not a change.
 */
export default function Trail({ onError }) {
  const [entries, setEntries] = useState([]);
  const [entity, setEntity] = useState('');
  const [who, setWho] = useState('');

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
        &ldquo;Who&rdquo; is whatever name was typed when the change was made — this app has one
        shared password and no logins, so it is a record of what was said, not of who was signed in.
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
