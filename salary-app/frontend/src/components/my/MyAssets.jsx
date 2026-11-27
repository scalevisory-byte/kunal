import { useEffect, useState } from 'react';
import { api } from '../../api.js';

const STATUS = {
  pending: ['with the office', 'warning'],
  matched: ['on the register', 'ok'],
  added: ['added to the register', 'ok'],
  dismissed: ['turned down', 'bad'],
};

/**
 * What I am holding.
 *
 * Two lists, because they are two different statements. The first is the
 * COMPANY'S record - what the asset register says is out in this person's
 * name, which is what a handover slip and a full-and-final are worked from.
 * The second is THEIRS - things they hold that the register does not show,
 * told to the office from here.
 *
 * Telling the office puts nothing on the register. The office looks, and
 * either ties it to an asset it already knows, adds it, or says why not. The
 * page says so in a sentence, because "I added my laptop" is exactly what
 * somebody will otherwise believe they did.
 */
export default function MyAssets({ onError }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({ kind: 'Laptop', label: '', identifier: '', note: '' });
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/me/assets').then(setData).catch(onError);
  useEffect(() => {
    load();
  }, []);

  const tell = async () => {
    setBusy(true);
    try {
      await api.post('/me/assets/declare', draft);
      setDraft({ ...draft, label: '', identifier: '', note: '' });
      setSaid('Sent to the office. It shows below as “with the office” until they have looked.');
      await load();
    } catch (err) {
      setSaid(err.message);
    } finally {
      setBusy(false);
    }
  };

  const takeBack = async (claim) => {
    try {
      await api.del(`/me/assets/declared/${claim.id}`);
      setSaid('');
      await load();
    } catch (err) {
      setSaid(err.message);
    }
  };

  if (!data) return <p className="loading">…</p>;
  const { assets = [], declared = [], kinds = [] } = data;

  return (
    <div className="stack">
      <div className="card">
        <h3>On the register in your name ({assets.length})</h3>
        {assets.length ? (
          <div className="table-wrap">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>What</th>
                  <th>Serial</th>
                  <th>Since</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id}>
                    <td>{a.code || '—'}</td>
                    <td>
                      {a.label}
                      <div className="muted small">{[a.kind, a.brand, a.model].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td>{a.identifier || '—'}</td>
                    <td>{String(a.issued_on || '').slice(0, 10) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">
            Nothing is out in your name. If you are holding something of the company’s, tell the office below.
          </p>
        )}
        <p className="muted small">
          This is the company’s record. If something here is wrong — you gave it back, or never had it — tell
          the office; it cannot be changed from here.
        </p>
      </div>

      <div className="card">
        <h3>Holding something that is not listed?</h3>
        <p className="muted small">
          Tell the office what it is. It is <strong>not added by this</strong> — they check it and put it on
          the register, and you will see what they decided here.
        </p>
        <div className="form-grid">
          <label>
            What kind
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
              {kinds.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Which one
            <input
              value={draft.label}
              placeholder="e.g. Dell laptop, Jio SIM"
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </label>
          <label>
            Serial / number on it
            <input
              value={draft.identifier}
              placeholder="if it has one"
              onChange={(e) => setDraft({ ...draft, identifier: e.target.value })}
            />
          </label>
          <label>
            Anything else
            <input
              value={draft.note}
              placeholder="e.g. given by Rakesh sir in June"
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
        </div>
        {said && <p className="muted small">{said}</p>}
        <button onClick={tell} disabled={busy || !draft.label.trim()}>
          Tell the office
        </button>
      </div>

      {declared.length > 0 && (
        <div className="card">
          <h3>What you have told the office</h3>
          <div className="table-wrap">
            <table className="sheet">
              <thead>
                <tr>
                  <th>What</th>
                  <th>Serial</th>
                  <th>Told on</th>
                  <th>Where it stands</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {declared.map((c) => {
                  const [text, tone] = STATUS[c.status] || [c.status, ''];
                  return (
                    <tr key={c.id}>
                      <td>
                        {c.label}
                        <div className="muted small">{c.kind}</div>
                      </td>
                      <td>{c.identifier || '—'}</td>
                      <td>{String(c.created_at || '').slice(0, 10)}</td>
                      <td>
                        <span className={`pill ${tone}`}>{text}</span>
                        {c.asset_code ? <span className="muted small"> {c.asset_code}</span> : null}
                        {c.decision_note ? <div className="muted small">{c.decision_note}</div> : null}
                      </td>
                      <td>
                        {c.status === 'pending' ? (
                          <button className="ghost small" onClick={() => takeBack(c)}>take back</button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
