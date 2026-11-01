import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { rupees } from '../../format.js';

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')} stock take`;
};

/**
 * Checking the register against what is actually there.
 *
 * **The distinction this whole panel exists for: "not checked" is not
 * "missing".** An asset nobody has looked at yet is simply not looked at yet —
 * counting it as lost is how a stock take invents losses, and how somebody
 * ends up being asked to pay for a laptop that is in a drawer. So there are
 * three columns, never two, and the third is the one that shrinks as you work.
 *
 * Type or scan a code to tick it off: a barcode scanner is a keyboard, so the
 * box takes the scan and moves on by itself.
 */
export default function StockTake({ onError }) {
  const [round, setRound] = useState(thisMonth());
  const [rounds, setRounds] = useState([]);
  const [progress, setProgress] = useState(null);
  const [assets, setAssets] = useState([]);
  const [scan, setScan] = useState('');
  const [said, setSaid] = useState('');
  const [query, setQuery] = useState('');

  const load = async (name = round) => {
    try {
      const [p, list, r] = await Promise.all([
        api.get(`/people/rounds/${encodeURIComponent(name)}`),
        api.get(`/people/assets?round=${encodeURIComponent(name)}`),
        api.get('/people/rounds'),
      ]);
      setProgress(p);
      setAssets(list.assets);
      setRounds(r.rounds);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load(round);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);

  const verify = async (asset, found, note) => {
    try {
      await api.post(`/people/assets/${asset.id}/verify`, { round, found, note });
      setSaid(`${asset.code} — ${found ? 'found' : 'not found'}`);
      load();
    } catch (err) {
      setSaid(err.message);
    }
  };

  /** A scanner types the code and presses Enter. */
  const onScan = async (e) => {
    e.preventDefault();
    const code = scan.trim();
    if (!code) return;
    setScan('');
    try {
      const asset = await api.get(`/people/assets/by-code/${encodeURIComponent(code)}`);
      await api.post(`/people/assets/${asset.id}/verify`, { round, found: true });
      setSaid(`${asset.code} — ${asset.kind} ${asset.label} — found`);
      load();
    } catch (err) {
      setSaid(err.message);
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((a) =>
      [a.code, a.label, a.employee_name].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [assets, query]);

  return (
    <section className="stack">
      <div className="card">
        <div className="late-head">
          <div>
            <h3>Stock take</h3>
            <p className="muted small">
              Scan or type a code to tick it off. Anything nobody has looked at yet stays under
              <strong> not checked</strong> — which is not the same as missing, and is why there
              are three columns rather than two.
            </p>
          </div>
        </div>

        <div className="form-grid">
          <label>
            Round
            <input value={round} onChange={(e) => setRound(e.target.value)} />
          </label>
          {rounds.length > 0 && (
            <label>
              Or an earlier one
              <select value="" onChange={(e) => e.target.value && setRound(e.target.value)}>
                <option value="">Pick a round</option>
                {rounds.map((r) => (
                  <option key={r.round} value={r.round}>
                    {r.round} — {r.found}/{r.checked} found
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <form onSubmit={onScan}>
          <label className="block">
            Scan or type a code
            <input
              value={scan}
              autoFocus
              placeholder="BPL-LAP-014"
              onChange={(e) => setScan(e.target.value)}
            />
          </label>
          <button type="submit" disabled={!scan.trim()}>
            Found it
          </button>{' '}
          {said && <span className="muted small">{said}</span>}
        </form>
      </div>

      {progress && (
        <div className="figures">
          <div className="figure">
            <span className="k">Found</span>
            <span className="n">{progress.found}</span>
          </div>
          <div className="figure">
            <span className="k">Not found</span>
            <span className="n">{progress.missing}</span>
          </div>
          <div className="figure">
            <span className="k">Not checked yet</span>
            <span className="n">{progress.not_checked}</span>
          </div>
          <div className="figure">
            <span className="k">Worth, not found</span>
            <span className="n">{rupees(progress.missing_value || 0)}</span>
          </div>
        </div>
      )}

      <input
        className="search"
        placeholder="Narrow the list"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <table className="sheet">
        <thead>
          <tr>
            <th>Code</th>
            <th>What</th>
            <th>Where it should be</th>
            <th>This round</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {shown.map((asset) => (
            <tr key={asset.id}>
              <td>{asset.code || '—'}</td>
              <td className="sticky-name">
                {asset.kind} — {asset.label}
              </td>
              <td className="muted small">{asset.employee_name || 'the office'}</td>
              <td>
                {asset.verified_found === true && <span className="muted small">found {asset.verified_on}</span>}
                {asset.verified_found === false && <span className="pill rejected">not found</span>}
                {asset.verified_found === null && <span className="muted small">not checked</span>}
              </td>
              <td>
                <button className="ghost small" onClick={() => verify(asset, true)}>
                  found
                </button>{' '}
                <button
                  className="ghost small"
                  onClick={() => {
                    const note = window.prompt(`${asset.code} not found. Anything to note?`, '');
                    if (note === null) return;
                    verify(asset, false, note || undefined);
                  }}
                >
                  not found
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {progress?.missing_assets?.length > 0 && (
        <div className="card">
          <h4>Not found in {round}</h4>
          <table className="sheet">
            <tbody>
              {progress.missing_assets.map((a) => (
                <tr key={a.id}>
                  <td>{a.code}</td>
                  <td className="sticky-name">
                    {a.kind} — {a.label}
                  </td>
                  <td className="muted small">last with {a.employee_name || 'the office'}</td>
                  <td className="num">{rupees(a.purchase_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            Worth {rupees(progress.missing_value)}. Nothing is deducted from anybody on the
            strength of this — if an asset is genuinely lost, that is a conversation, and the
            exit settlement names an unreturned asset without ever docking it.
          </p>
        </div>
      )}
    </section>
  );
}
