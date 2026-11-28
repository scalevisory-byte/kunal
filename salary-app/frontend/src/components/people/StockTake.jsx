import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import ScrollFrame from '../ScrollFrame.jsx';
import { rupees } from '../../format.js';
import { SCOPE_FIELDS, inScope, roundFigures, scopeChoices, unplaced } from '../../../../shared/stockTake.js';

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
  // Which part of the register this walk is about. Narrowing changes what is
  // COUNTED, never a verdict - and is remembered for the round being walked.
  const [scope, setScope] = useState({ location: '', department: '', company_id: '' });

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

  const choices = useMemo(() => scopeChoices(assets), [assets]);
  const narrowed = SCOPE_FIELDS.some(([k]) => scope[k]);
  const scoped = useMemo(() => assets.filter((a) => inScope(a, scope)), [assets, scope]);
  const outside = useMemo(() => unplaced(assets, scope), [assets, scope]);
  // The whole register comes from the server; a narrowed walk is counted here
  // with the SAME function the server uses, so the two cannot disagree.
  const figures = narrowed ? roundFigures(scoped) : progress;
  const scopeWords = SCOPE_FIELDS.filter(([k]) => scope[k])
    .map(([k]) => (k === 'company_id' ? choices.company_id.find(([id]) => id === String(scope.company_id))?.[1] : scope[k]))
    .join(' · ');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter((a) =>
      [a.code, a.label, a.employee_name].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [scoped, query]);

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

      <div className="card st-scope">
        <span className="st-scope-k">Walking</span>
        {SCOPE_FIELDS.map(([key, label]) => (
          <label key={key}>
            {label}
            <select value={scope[key]} onChange={(e) => setScope({ ...scope, [key]: e.target.value })}>
              <option value="">{key === 'company_id' ? 'Every company' : `Every ${label.toLowerCase()}`}</option>
              {key === 'company_id'
                ? choices.company_id.map(([id, name]) => <option key={id} value={id}>{name}</option>)
                : choices[key].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        ))}
        {narrowed && (
          <button className="ghost small" onClick={() => setScope({ location: '', department: '', company_id: '' })}>
            The whole register
          </button>
        )}
        <p className="muted small">
          {narrowed
            ? `Counting only ${scopeWords}: ${scoped.length} of ${assets.length} assets. Verdicts already given anywhere still stand — this only changes what is counted.`
            : `Counting the whole register: ${assets.length} assets. Pick a location to walk one floor or one office without the rest showing as not checked.`}
          {narrowed && outside.length > 0 && (
            <>
              {' '}
              <strong>{outside.length} {outside.length === 1 ? 'asset has' : 'assets have'}</strong> nothing recorded for
              what you narrowed by, so {outside.length === 1 ? 'it is' : 'they are'} in no such count — set it on the
              register: {outside.slice(0, 5).map((a) => a.code || a.label).join(', ')}
              {outside.length > 5 ? ` and ${outside.length - 5} more` : ''}.
            </>
          )}
        </p>
      </div>

      {figures && (
        <div className="figures">
          <div className="figure">
            <span className="k">Found</span>
            <span className="n">{figures.found}</span>
          </div>
          <div className="figure">
            <span className="k">Not found</span>
            <span className="n">{figures.missing}</span>
          </div>
          <div className="figure">
            <span className="k">Not checked yet</span>
            <span className="n">{figures.not_checked}</span>
          </div>
          <div className="figure">
            <span className="k">Worth, not found</span>
            <span className="n">{rupees(figures.missing_value || 0)}</span>
          </div>
        </div>
      )}

      <input
        className="search"
        placeholder="Narrow the list"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {/* Nine columns of register on a 390px phone pushed the PAGE 268px
          sideways; inside the frame the table scrolls and the page does not. */}
      <ScrollFrame>
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
              <td className="muted small">
                {asset.employee_name || 'the office'}
                {asset.location ? <span> · {asset.location}</span> : null}
              </td>
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
      </ScrollFrame>

      {figures?.missing_assets?.length > 0 && (
        <div className="card">
          <h4>Not found in {round}{narrowed ? ` — ${scopeWords}` : ''}</h4>
          <ScrollFrame>
          <table className="sheet">
            <tbody>
              {figures.missing_assets.map((a) => (
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
          </ScrollFrame>
          <p className="muted small">
            Worth {rupees(figures.missing_value)}. Nothing is deducted from anybody on the
            strength of this — if an asset is genuinely lost, that is a conversation, and the
            exit settlement names an unreturned asset without ever docking it.
          </p>
        </div>
      )}
    </section>
  );
}
