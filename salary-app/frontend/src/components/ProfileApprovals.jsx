import { useEffect, useState } from 'react';
import { api } from '../api.js';

const show = (v) => (v === true ? 'Yes' : v === false ? 'No' : v === null || v === undefined || v === '' ? '—' : String(v));

/**
 * What staff filled in about themselves, waiting for HR.
 *
 * An employee fills in their own record from their login; it does not become
 * the record until somebody here lets it through. One block per person, what
 * the record says now beside what they want it to say, and one button for the
 * lot - because the usual case is a new joiner's twenty boxes, all fine.
 *
 * Shown only while something is waiting, at the TOP of the Employees tab:
 * until it is approved a UAN somebody typed is on no return.
 */
export default function ProfileApprovals({ companyId, onDone, onOpen }) {
  const [people, setPeople] = useState([]);
  const [why, setWhy] = useState({});
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .get(`/employees/profile-changes${companyId ? `?company_id=${companyId}` : ''}`)
      .then((got) => setPeople(got.people || []))
      .catch(() => setPeople([]));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const decide = async (ids, approve, note) => {
    setBusy(true);
    try {
      const done = await api.post('/employees/profile-changes/decide', { ids, approve, note });
      setSaid(
        done.held?.length
          ? done.held.map((h) => `${h.employee_name} — ${h.label}: ${h.why}`).join(' · ')
          : ''
      );
      await load();
      onDone?.();
    } catch (err) {
      setSaid(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!people.length) return null;
  const total = people.reduce((n, p) => n + p.changes.length, 0);

  return (
    <section className="card profile-approvals">
      <h3>
        {people.length} {people.length === 1 ? 'person has' : 'people have'} filled in their own record — {total}{' '}
        {total === 1 ? 'change' : 'changes'} waiting for you
      </h3>
      <p className="muted small">
        Nothing below is on anybody’s record yet. Approving writes it, with their name and yours on the
        history. Turn one down with a reason and they see it on their own page.
      </p>
      {said && <p className="warn">{said}</p>}
      {people.map((person) => (
        <details key={person.employee_id} className="fold" open={people.length <= 3}>
          <summary>
            <strong>{person.employee_name}</strong>
            <span className="muted small">
              {' '}
              {[person.employee_code, person.company_name].filter(Boolean).join(' · ')} — {person.changes.length}{' '}
              {person.changes.length === 1 ? 'change' : 'changes'}, since {String(person.since || '').slice(0, 10)}
            </span>
          </summary>
          <table className="sheet">
            <thead>
              <tr>
                <th>What</th>
                <th>On the record now</th>
                <th>They filled in</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {person.changes.map((c) => (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td className="muted">{show(c.from)}</td>
                  <td>
                    <strong>{show(c.to)}</strong>
                  </td>
                  <td className="pa-decide">
                    <input
                      value={why[c.id] || ''}
                      placeholder="why not (to turn it down)"
                      onChange={(e) => setWhy({ ...why, [c.id]: e.target.value })}
                    />
                    <button
                      className="ghost small"
                      disabled={busy || !(why[c.id] || '').trim()}
                      onClick={() => decide([c.id], false, why[c.id])}
                    >
                      Turn down
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="toolbar">
            <button disabled={busy} onClick={() => decide(person.changes.map((c) => c.id), true)}>
              Approve {person.changes.length === 1 ? 'it' : `all ${person.changes.length}`} for {person.employee_name}
            </button>
            {onOpen ? (
              <button className="link" onClick={() => onOpen(person.employee_id)}>
                open their record
              </button>
            ) : null}
          </div>
        </details>
      ))}
    </section>
  );
}
