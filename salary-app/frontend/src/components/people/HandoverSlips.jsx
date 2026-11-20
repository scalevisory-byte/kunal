import { useEffect, useMemo, useState } from 'react';
import { col, num, printReport } from '../../printReport.js';
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

  const reload = async () => {
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
  };

  useEffect(() => {
    reload();
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
        onOpenEmployee={(who) => who && setLedger(who)}
        onError={onError}
        /* Taking something back changes this list, so it is re-read rather
           than left showing what the person held a minute ago. */
        onReload={reload}
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

  /**
   * THE HANDOVER REGISTER — every movement in the log, not who holds what.
   *
   * The list on screen answers "who has what NOW" and is built from the
   * REGISTER, which is why somebody holding an imported asset with no slip
   * is on it. This prints the other thing: the LOG — every issue and every
   * return, signed or not — which is what an auditor asks for and what
   * somebody chasing a signature works down.
   *
   * The two cannot be the same list, and the paper says which one it is.
   */
  const printRegister = async () => {
    try {
      const { handovers } = await api.get('/people/assets/handovers');
      const open = handovers.filter((h) => !h.returned_on);
      printReport({
        title: 'Asset handover register',
        subtitle: 'every issue and return in the log',
        meta: [
          `${handovers.length} ${handovers.length === 1 ? 'handover' : 'handovers'}`,
          `${open.length} still out · ${open.filter((h) => !h.acknowledged_on).length} of those not signed for`,
        ],
        landscape: true,
        columns: [
          col('#', (_h, i) => i + 1, '3%'),
          col('Issued on', (h) => h.issued_on || ''),
          col('To', (h) => h.employee_name || ''),
          col('Code', (h) => h.code || ''),
          col('Asset', (h) => `${h.kind || ''} ${h.label || ''}`.trim()),
          col('Serial', (h) => h.identifier || ''),
          num('Cost to buy', (h) => (Number(h.purchase_cost) ? rupees(h.purchase_cost) : '—')),
          col('Issued by', (h) => h.issued_by || ''),
          col('Condition out', (h) => h.condition_out || ''),
          col('Returned on', (h) => h.returned_on || 'still out'),
          col('Taken back by', (h) => h.returned_by || ''),
          col('Condition back', (h) => h.condition_in || ''),
          col('Signed', (h) => (h.acknowledged_on ? h.acknowledged_on : 'not signed')),
        ],
        rows: handovers,
        /*
         * Said on the paper, because the two lists answer different
         * questions and a register that looked like the other one would be
         * read as a shorter truth.
         */
        footer:
          'This is the handover LOG — every issue and return, including assets since given back. Who holds something now comes from the asset register instead, which is why somebody holding an imported asset with no slip is on that list and not on this one. Nothing is deleted here: a transfer closes one handover and opens the next.',
      });
    } catch (err) {
      onError(err);
    }
  };

  return (
    <section className="stack">
      {/* The slip is one person's to sign; this is the whole log. */}
      <div className="toolbar">
        <button className="ghost" onClick={printRegister}>
          Print the handover register
        </button>
        <span className="muted small">
          Every issue and return in the log. The list below is who holds something <strong>now</strong>.
        </span>
      </div>
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
                {/*
                  * THE NAME IS THE WAY IN, as Dinesh asked: clicking a person
                  * opens their ledger. It was a button at the far end of the
                  * row called "ledger", which nobody reads as "click the
                  * name". Sixth time in this app that a way in had to be
                  * moved to where the person is already looking.
                  */}
                <td className="sticky-name">
                  <button className="link open-name" onClick={() => setLedger(person)}>
                    {person.name}
                  </button>
                </td>
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
