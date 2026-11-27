import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';

/**
 * What staff say they are holding, waiting for the office.
 *
 * An employee can tell the office about a laptop or a SIM from their own
 * login. That is a STATEMENT, not a register entry: nothing here has moved
 * until one of the three buttons is pressed.
 *
 *   It is this one   - the thing is already on the register; it goes out in
 *                      their name, on the handover log like any other issue
 *   Add it           - it is not on the register yet; it is added, in their name
 *   Not ours         - turned down, with a reason they will read
 *
 * Shown only while something is waiting. A panel that is always there and
 * usually empty is a panel nobody reads on the day it is not.
 */
export default function AssetClaims({ assets = [], companies = [], onDone }) {
  const [claims, setClaims] = useState([]);
  const [open, setOpen] = useState(null);
  const [pickCode, setPickCode] = useState('');
  const [why, setWhy] = useState('');
  const [said, setSaid] = useState('');

  const load = () =>
    api
      .get('/people/assets/claims?status=pending')
      .then((got) => setClaims(got.claims || []))
      .catch(() => setClaims([]));

  useEffect(() => {
    load();
  }, []);

  /* For "it is this one": what is free, or already theirs. Typed, not scrolled. */
  const byCode = useMemo(() => {
    const map = new Map();
    for (const a of assets) if (a.code && !a.written_off_on) map.set(String(a.code).toUpperCase(), a);
    return map;
  }, [assets]);

  const decide = async (claim, body) => {
    try {
      await api.post(`/people/assets/claims/${claim.id}/decide`, body);
      setSaid('');
      setOpen(null);
      setPickCode('');
      setWhy('');
      await load();
      onDone?.();
    } catch (err) {
      setSaid(err.message);
    }
  };

  if (!claims.length) return null;

  return (
    <div className="card asset-claims">
      <h3>
        {claims.length} thing{claims.length === 1 ? '' : 's'} staff say they are holding
      </h3>
      <p className="muted small">
        Told to the office from their own login. Nothing is on the register until you decide — tie it to an
        asset already here, add it as a new one, or turn it down.
      </p>
      {said && <p className="error">{said}</p>}
      <table className="sheet">
        <thead>
          <tr>
            <th>Who</th>
            <th>What they say</th>
            <th>Serial</th>
            <th>Note</th>
            <th>Told on</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {claims.map((claim) => {
            /* A serial that is already on the register answers the question. */
            const twin = claim.identifier
              ? assets.find(
                  (a) => String(a.identifier || '').trim().toLowerCase() === String(claim.identifier).trim().toLowerCase()
                )
              : null;
            const picked = byCode.get(pickCode.trim().toUpperCase());
            return (
              <tr key={claim.id}>
                <td>
                  {claim.employee_name}
                  <div className="muted small">{claim.company_name || ''}</div>
                </td>
                <td>
                  {claim.label}
                  <div className="muted small">{claim.kind}</div>
                </td>
                <td>{claim.identifier || '—'}</td>
                <td>{claim.note || '—'}</td>
                <td>{String(claim.created_at || '').slice(0, 10)}</td>
                <td className="claim-decide">
                  {open === claim.id ? (
                    <div className="stack-tight">
                      <div className="toolbar">
                        <input
                          list="asset-claim-codes"
                          value={pickCode}
                          placeholder="Asset code it is"
                          onChange={(e) => setPickCode(e.target.value)}
                        />
                        <button
                          disabled={!picked}
                          onClick={() => decide(claim, { action: 'match', asset_id: picked.id })}
                          title={picked ? `${picked.code} — ${picked.label}` : 'Type the code on its sticker'}
                        >
                          It is this one
                        </button>
                      </div>
                      {picked ? (
                        <span className="muted small">
                          {picked.code} — {picked.label}
                          {picked.employee_name && !picked.returned_on ? ` · now with ${picked.employee_name}` : ' · in the office'}
                        </span>
                      ) : null}
                      <div className="toolbar">
                        <input value={why} placeholder="Why it is turned down" onChange={(e) => setWhy(e.target.value)} />
                        <button className="ghost" disabled={!why.trim()} onClick={() => decide(claim, { action: 'dismiss', note: why })}>
                          Not ours
                        </button>
                        <button className="link" onClick={() => setOpen(null)}>cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {twin ? (
                        <button onClick={() => decide(claim, { action: 'match', asset_id: twin.id })} title={`Same serial as ${twin.code || twin.label}`}>
                          It is {twin.code || 'this one'}
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            const company =
                              companies.find((c) => Number(c.id) === Number(claim.employee_company_id))?.name || 'their company';
                            if (
                              window.confirm(
                                `Add “${claim.label}” to the register under ${company}, in ${claim.employee_name}’s name?\n\n` +
                                  'It gets the next asset code and is logged as handed to them today.'
                              )
                            )
                              decide(claim, { action: 'add' });
                          }}
                        >
                          Add it
                        </button>
                      )}{' '}
                      <button className="ghost" onClick={() => { setOpen(claim.id); setSaid(''); }}>
                        Other…
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <datalist id="asset-claim-codes">
        {assets.filter((a) => a.code && !a.written_off_on).slice(0, 2000).map((a) => (
          <option key={a.id} value={a.code}>{a.label}</option>
        ))}
      </datalist>
    </div>
  );
}
