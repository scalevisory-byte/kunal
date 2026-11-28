import { useMemo, useState } from 'react';
import { rupees } from '../../format.js';
import { todayIso } from '../../../../shared/today.js';
import { WARRANTY_BUCKETS, warrantySummary } from '../../../../shared/warrantyBuckets.js';

/**
 * WARRANTY & AMC (v2.39.0) - one screen for "what runs out, and when".
 *
 * Read off the dates already on each asset; nothing is typed here. A row opens
 * the asset, where the dates are changed. An asset with no warranty date is
 * its own pile, never counted as covered.
 */
const fmt = (iso) =>
  iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const leftText = (n) =>
  n === null || n === undefined ? '' : n < 0 ? `${-n} days ago` : n === 0 ? 'today' : `in ${n} days`;

export default function WarrantyAmc({ assets = [], onOpen }) {
  const [pile, setPile] = useState('soon');
  const [query, setQuery] = useState('');
  const today = todayIso();
  const sum = useMemo(() => warrantySummary(assets, today), [assets, today]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sum.rows
      .filter((r) =>
        pile === 'all'
          ? true
          : pile === 'soon'
            ? ['d30', 'd60', 'd90'].includes(r.warranty_bucket)
            : pile === 'amc'
              ? r.has_amc
              : r.warranty_bucket === pile
      )
      .filter(
        (r) =>
          !q ||
          [r.code, r.label, r.kind, r.brand, r.model, r.identifier, r.vendor, r.warranty_provider, r.amc_vendor, r.employee_name]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q))
      )
      .sort((a, b) => {
        const x = pile === 'amc' ? a.amc_days_left : a.warranty_days_left;
        const y = pile === 'amc' ? b.amc_days_left : b.warranty_days_left;
        return (x ?? 1e9) - (y ?? 1e9);
      });
  }, [sum, pile, query]);

  const soon = sum.counts.d30 + sum.counts.d60 + sum.counts.d90;

  return (
    <div className="stack">
      <div className="wa-cards">
        {[
          ['active', 'Active warranty', sum.counts.active + soon, 'good'],
          ['d30', 'Expiring in 30 days', sum.counts.d30, 'bad'],
          ['d60', 'In 31–60 days', sum.counts.d60, 'warn'],
          ['d90', 'In 61–90 days', sum.counts.d90, 'warn'],
          ['expired', 'Expired', sum.counts.expired, 'bad'],
          ['none', 'No warranty information', sum.counts.none, 'muted'],
          ['amc', 'Under AMC', sum.amc, 'info'],
        ].map(([key, label, n, tone]) => (
          <button
            key={key}
            type="button"
            className={`wa-card tone-${tone}${pile === key || (key === 'active' && pile === 'all') ? ' active' : ''}`}
            onClick={() => setPile(key === 'active' ? 'all' : key)}
          >
            <b>{n}</b>
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="card">
        <div className="toolbar pr-filters">
          {[
            ['soon', `Expiring soon ${soon}`],
            ['all', `All ${sum.total}`],
            ['active', 'Active'],
            ['expired', 'Expired'],
            ['none', 'No date'],
            ['amc', `AMC ${sum.amc}`],
          ].map(([key, label]) => (
            <button key={key} className={`chip${pile === key ? ' active' : ''}`} onClick={() => setPile(key)}>
              {label}
            </button>
          ))}
          <input className="search" placeholder="Search code, item, vendor, holder" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        <div className="table-wrap unboxed">
          <table className="sheet wa-table">
            <thead>
              {pile === 'amc' ? (
                <tr>
                  <th>Asset code</th><th>Asset</th><th>AMC provider</th><th className="num">AMC cost</th>
                  <th>AMC ends</th><th>Renewal</th><th>With</th>
                </tr>
              ) : (
                <tr>
                  <th>Asset code</th><th>Asset</th><th>Vendor</th><th>Warranty provider</th>
                  <th>Starts</th><th>Ends</th><th>Status</th><th>With</th>
                </tr>
              )}
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button type="button" className="link name-link" onClick={() => onOpen?.(r)}>{r.code || `#${r.id}`}</button>
                  </td>
                  <td>
                    {r.label}
                    <div className="muted small">{[r.kind, r.brand, r.model].filter(Boolean).join(' · ')}</div>
                  </td>
                  {pile === 'amc' ? (
                    <>
                      <td>{r.amc_vendor || '—'}</td>
                      <td className="num">{r.amc_cost ? rupees(r.amc_cost) : '—'}</td>
                      <td>{fmt(r.amc_until)}<div className="muted small">{leftText(r.amc_days_left)}</div></td>
                      <td>
                        {r.amc_days_left === null ? (
                          <span className="pill pr-muted">no end date</span>
                        ) : r.amc_days_left < 0 ? (
                          <span className="pill pr-bad">lapsed — renew</span>
                        ) : r.amc_days_left <= 30 ? (
                          <span className="pill pr-warn">renew soon</span>
                        ) : (
                          <span className="pill pr-good">running</span>
                        )}
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{r.vendor || '—'}</td>
                      <td>{r.warranty_provider || '—'}</td>
                      <td>{fmt(r.warranty_from)}</td>
                      <td>{fmt(r.warranty_until)}<div className="muted small">{leftText(r.warranty_days_left)}</div></td>
                      <td>
                        <span className={`pill pr-${WARRANTY_BUCKETS.find((b) => b.key === r.warranty_bucket)?.tone}`}>
                          {WARRANTY_BUCKETS.find((b) => b.key === r.warranty_bucket)?.label}
                        </span>
                      </td>
                    </>
                  )}
                  <td>{r.employee_name || <span className="muted">In the office</span>}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={8} className="empty">Nothing in this pile.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Dates come from each asset's own record — open one to change them. The reminders on the
          dashboard and the Overview fire at 90, 30 and 7 days before an end date, on the day, and
          after it.
        </p>
      </div>
    </div>
  );
}
