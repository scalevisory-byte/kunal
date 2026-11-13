import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import ScrollFrame from '../ScrollFrame.jsx';
import { rupees } from '../../format.js';

/**
 * Who holds what, and a slip to print and have signed.
 *
 * The slip lists only what somebody **still** has — a returned laptop has no
 * business on a document they are putting their name to — and it carries the
 * undertaking above the signature, because the point of signing is agreeing to
 * something specific.
 */
export default function HandoverSlips({ onError }) {
  const [handovers, setHandovers] = useState([]);
  const [slip, setSlip] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { handovers: list } = await api.get('/people/assets/handovers?open=true');
        setHandovers(list);
      } catch (err) {
        onError(err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const people = useMemo(() => {
    const by = new Map();
    for (const h of handovers) {
      if (!h.employee_id) continue;
      if (!by.has(h.employee_id)) {
        by.set(h.employee_id, { id: h.employee_id, name: h.employee_name, items: [], worth: 0 });
      }
      const row = by.get(h.employee_id);
      row.items.push(h);
      row.worth += Number(h.purchase_cost) || 0;
    }
    return [...by.values()].sort((a, b) => b.worth - a.worth);
  }, [handovers]);

  const open = async (person) => {
    try {
      setSlip(await api.get(`/people/assets/slip/${person.id}`));
    } catch (err) {
      onError(err);
    }
  };

  if (slip) {
    return (
      <section className="stack">
        <div className="toolbar no-print">
          <button className="ghost" onClick={() => setSlip(null)}>
            Back
          </button>
          <button onClick={() => window.print()}>Print it</button>
        </div>

        <div className="card slip">
          <h2>{slip.title}</h2>
          <p className="muted small">
            {slip.company} · {slip.dated}
          </p>
          <p>
            <strong>{slip.employee}</strong>
            {slip.code ? ` (${slip.code})` : ''}
          </p>

          {!slip.items.length ? (
            <p className="muted small">They are not holding anything.</p>
          ) : (
            <ScrollFrame>
              <table className="sheet">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>What</th>
                  <th>Serial</th>
                  <th>Since</th>
                  <th>Condition</th>
                </tr>
              </thead>
              <tbody>
                {slip.items.map((item) => (
                  <tr key={item.code}>
                    <td>{item.code}</td>
                    <td className="sticky-name">{item.what}</td>
                    <td className="muted small">{item.serial || '—'}</td>
                    <td>{item.issued_on}</td>
                    <td className="muted small">{item.condition || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
              </ScrollFrame>
          )}

          <p className="undertaking">{slip.undertaking}</p>
          <div className="signatures">
            <div>
              <div className="rule" />
              {slip.employee}
            </div>
            <div>
              <div className="rule" />
              For {slip.company || 'the company'}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="stack">
      {!people.length ? (
        <p className="muted small">Nothing is out with anybody.</p>
      ) : (
        <ScrollFrame>
              <table className="sheet">
          <thead>
            <tr>
              <th>Who</th>
              <th className="num">Things</th>
              <th className="num">Worth</th>
              <th>What</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.id}>
                <td className="sticky-name">{person.name}</td>
                <td className="num">{person.items.length}</td>
                <td className="num">{rupees(person.worth)}</td>
                <td className="muted small wrap">
                  {person.items.map((i) => `${i.code} ${i.label}`).join('; ')}
                </td>
                <td>
                  <button className="ghost small" onClick={() => open(person)}>
                    slip
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
              </ScrollFrame>
      )}
      <p className="muted small">
        A slip lists only what that person still has, and carries the undertaking above the
        signature — the point of signing is agreeing to something specific.
      </p>
    </section>
  );
}
