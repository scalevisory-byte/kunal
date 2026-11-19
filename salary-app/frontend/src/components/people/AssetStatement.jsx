import { useEffect, useState } from 'react';
import { STANDALONE, api, download } from '../../api.js';
import { rupees } from '../../format.js';

/**
 * THE WHOLE REGISTER AS ONE DOCUMENT — "total asset ka register".
 *
 * The Register tab is for working on: filters, a search box, cells you type
 * in. This is the other job — the page you print for the accountant, where
 * every asset sits under its company, each block adds up, and the foot carries
 * one figure for everything the business owns.
 *
 * Two things it says out loud, because a printed page cannot be asked
 * questions afterwards:
 *
 *   **Every figure is what it cost to buy.** There is no depreciation in this
 *   app, so this is a register at cost and not a book value. A made-up rate
 *   would price every line wrongly while looking authoritative.
 *
 *   **Written-off assets are below the total, never inside it** — they keep
 *   their row and their code, and counting them would overstate what is held.
 */
export default function AssetStatement({ companies = [], onError }) {
  const [statement, setStatement] = useState(null);
  const [by, setBy] = useState('company');
  const [companyId, setCompanyId] = useState('');
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (STANDALONE) return;
    let alive = true;
    const query = [`by=${by}`, companyId ? `company_id=${companyId}` : ''].filter(Boolean).join('&');
    api
      .get(`/people/assets/statement?${query}`)
      .then((data) => alive && setStatement(data.statement))
      .catch((err) => onError?.(err));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [by, companyId]);

  if (STANDALONE) {
    return (
      <div className="card">
        <h3>The register, as a statement</h3>
        <p className="muted small">This one reads the whole register from the server.</p>
      </div>
    );
  }

  if (!statement) return <p className="muted small">Adding up the register…</p>;

  const { blocks, totals, written_off: gone, missing } = statement;

  return (
    <section className="stack">
      <div className="toolbar no-print">
        <div className="sub-tabs toolbar">
          <button className={by === 'company' ? 'active' : undefined} onClick={() => setBy('company')}>
            By company
          </button>
          <button className={by === 'group' ? 'active' : undefined} onClick={() => setBy('group')}>
            By group
          </button>
          {/* Staff-wise: asked for by name, looking at 367 rows. */}
          <button className={by === 'person' ? 'active' : undefined} onClick={() => setBy('person')}>
            By person
          </button>
        </div>
        {companies.length > 1 && (
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">All companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <label className="check">
          <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />
          List every asset
        </label>
        <span className="push-right">
          <button className="ghost" onClick={() => window.print()}>
            Print
          </button>
          <button
            className="ghost"
            onClick={() =>
              download(
                `/people/assets/statement.csv?by=${by}${companyId ? `&company_id=${companyId}` : ''}`,
                'asset-register-statement.csv'
              ).catch((err) => onError?.(err))
            }
          >
            CSV
          </button>
        </span>
      </div>

      <div className="card">
        <h3>Asset register{companyId ? ` — ${companies.find((c) => String(c.id) === String(companyId))?.name || ''}` : ''}</h3>
        <p className="muted small">
          {new Date().toISOString().slice(0, 10)} · every figure is <strong>what it cost to buy</strong>.
          There is no depreciation in this app, so this is a register at cost and not a book value.
        </p>

        <div className="figures">
          <div className="figure">
            <span className="k">Assets held</span>
            <span className="n">{totals.count}</span>
          </div>
          <div className="figure">
            <span className="k">Cost to buy, in all</span>
            <span className="n">{rupees(totals.cost)}</span>
          </div>
          <div className="figure">
            <span className="k">Out with staff</span>
            <span className="n">{totals.out}</span>
          </div>
          <div className="figure">
            <span className="k">In the office</span>
            <span className="n">{totals.in_office}</span>
          </div>
        </div>

        {blocks.map((block) => (
          <div key={block.name} style={{ marginTop: '1rem' }}>
            <h4>
              {block.name}{' '}
              <span className="muted small">
                {block.count} {block.count === 1 ? 'asset' : 'assets'} · {rupees(block.cost)}
                {block.out ? ` · ${block.out} out with staff` : ''}
              </span>
            </h4>

            <div className="table-wrap">
              <table className="sheet">
                <thead>
                  <tr>
                    {full ? (
                      <>
                        <th>Code</th>
                        <th>What</th>
                        <th>Serial</th>
                        <th>{by === 'group' ? 'Company' : by === 'person' ? 'Group' : 'Group'}</th>
                        {/* Staff-wise, the holder is the heading above - so
                            this column carries where the thing actually sits. */}
                        <th>{by === 'person' ? 'Where' : 'Where it is'}</th>
                        <th>Bought</th>
                        <th className="num">Cost</th>
                      </>
                    ) : (
                      <>
                        <th>{by === 'group' ? 'Company' : 'Group'}</th>
                        <th className="num">Assets</th>
                        <th className="num">Cost to buy</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {full
                    ? block.rows.map((row) => (
                        <tr key={row.id}>
                          <td>{row.code || <span className="muted">no code</span>}</td>
                          <td className="sticky-name">
                            {row.kind} — {row.label}
                          </td>
                          <td className="muted small">{row.identifier || '—'}</td>
                          <td className="small">{by === 'group' ? row.company_name : row.group}</td>
                          <td className="small">
                            {by === 'person' ? (
                              row.location || <span className="muted">—</span>
                            ) : (
                              <>
                                {row.holder ? (
                                  <strong>{row.holder}</strong>
                                ) : (
                                  <span className="muted">in the office</span>
                                )}
                                {row.location ? <div className="muted small">{row.location}</div> : null}
                              </>
                            )}
                          </td>
                          <td className="small">{row.purchase_date || <span className="muted">—</span>}</td>
                          <td className="num">{row.cost ? rupees(row.cost) : <span className="muted">—</span>}</td>
                        </tr>
                      ))
                    : block.groups.map((g) => (
                        <tr key={g.name}>
                          <td>{g.name}</td>
                          <td className="num">{g.count}</td>
                          <td className="num">{rupees(g.cost)}</td>
                        </tr>
                      ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={full ? 6 : 2}>
                      <strong>{block.name} total</strong>
                    </td>
                    <td className="num">
                      <strong>{rupees(block.cost)}</strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ))}

        <p className="lic-alert" style={{ marginTop: '1rem', borderLeftColor: 'var(--brand)' }}>
          <strong>
            {totals.count} assets · {rupees(totals.cost)}
          </strong>{' '}
          — what the business holds, at cost.
        </p>

        {gone.count > 0 && (
          <>
            <h4>
              Written off <span className="muted small">{gone.count} · {rupees(gone.cost)} — not in the total above</span>
            </h4>
            <div className="table-wrap">
              <table className="sheet">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>What</th>
                    <th>Written off</th>
                    <th>Why</th>
                    <th className="num">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {gone.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.code || <span className="muted">—</span>}</td>
                      <td className="sticky-name">{row.label}</td>
                      <td className="small">{row.written_off_on}</td>
                      <td className="small">{row.why || <span className="muted">—</span>}</td>
                      <td className="num">{row.cost ? rupees(row.cost) : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {(missing.no_cost || missing.no_code || missing.no_company || missing.no_purchase_date) > 0 && (
          <p className="muted small" style={{ marginTop: '0.8rem' }}>
            Worth knowing before this goes to anybody:{' '}
            {[
              missing.no_cost && `${missing.no_cost} with no cost recorded`,
              missing.no_code && `${missing.no_code} with no code`,
              missing.no_company && `${missing.no_company} against no company`,
              missing.no_purchase_date && `${missing.no_purchase_date} with no purchase date`,
            ]
              .filter(Boolean)
              .join(', ')}
            . They are counted in the figures above exactly as they stand — nothing is estimated.
          </p>
        )}
      </div>
    </section>
  );
}
