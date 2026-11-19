import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import ScrollFrame from '../ScrollFrame.jsx';
import { rupees } from '../../format.js';
import AssetLedger from './AssetLedger.jsx';

/**
 * Who holds what, and a slip to print and have signed.
 *
 * The slip lists only what somebody **still** has — a returned laptop has no
 * business on a document they are putting their name to — and it carries the
 * undertaking above the signature, because the point of signing is agreeing to
 * something specific.
 */
export default function HandoverSlips({ onError }) {
  const [out, setOut] = useState([]);
  const [signed, setSigned] = useState(new Set());
  const [slip, setSlip] = useState(null);
  const [ledger, setLedger] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        /*
         * WHO HAS IT NOW COMES FROM THE REGISTER, not from the handover log.
         *
         * This list used to be built from open handovers, so anybody holding
         * something with no slip - a thousand imported rows carry a holder
         * and no handover row - was simply not on it. "Who holds what" was
         * quietly answering "who holds what AND signed for it", which is a
         * different question and the smaller half of it.
         *
         * The log is still fetched, to say which of them are signed for.
         */
        const [{ assets }, { handovers }] = await Promise.all([
          api.get('/people/assets?out=true'),
          api.get('/people/assets/handovers?open=true'),
        ]);
        setOut(assets || []);
        setSigned(new Set((handovers || []).map((h) => Number(h.asset_id))));
      } catch (err) {
        onError(err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const people = useMemo(() => {
    const by = new Map();
    for (const a of out) {
      if (!a.employee_id) continue;
      if (!by.has(a.employee_id)) {
        by.set(a.employee_id, { id: a.employee_id, name: a.employee_name, items: [], worth: 0, unsigned: 0 });
      }
      const row = by.get(a.employee_id);
      row.items.push(a);
      row.worth += Number(a.purchase_cost) || 0;
      if (!signed.has(Number(a.id))) row.unsigned += 1;
    }
    return [...by.values()].sort((a, b) => b.worth - a.worth);
  }, [out, signed]);

  const open = async (person) => {
    try {
      setSlip(await api.get(`/people/assets/slip/${person.id}`));
    } catch (err) {
      onError(err);
    }
  };

  if (ledger) {
    return (
      <AssetLedger
        employeeId={ledger.id}
        name={ledger.name}
        onClose={() => setLedger(null)}
        onError={onError}
      />
    );
  }

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
              <th>Signed for</th>
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
                <td className="small">
                  {person.unsigned ? (
                    <span className="pill due-soon" title="On the register against them with no handover slip">
                      {person.unsigned} with no slip
                    </span>
                  ) : (
                    <span className="muted">all signed</span>
                  )}
                </td>
                <td>
                  <button className="ghost small" onClick={() => setLedger(person)}>
                    ledger
                  </button>{' '}
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
        <strong>Ledger</strong> is everything that person has ever been given — what they still have,
        what came back and when, and anything standing against them with no slip on file.{' '}
        <strong>Slip</strong> is the document to print and have signed: only what they still have, with
        the undertaking above the signature, because the point of signing is agreeing to something
        specific.
      </p>
    </section>
  );
}
