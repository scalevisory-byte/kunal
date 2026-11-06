import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { rupees } from '../../format.js';

/*
 * Fines, losses and damage recovered from somebody's salary.
 *
 * Dinesh: *"haan bana do penalty wala / salary me se decut hoga / and uska
 * reporting bhi / kyu kata he kis chiz ka kata he uska note dalne ka option
 * bhi dena"*.
 *
 * The Deduct box on the salary sheet already took money out perfectly well.
 * What it could not do is remember: what broke, when, who decided, whether the
 * person was ever told, and whether ₹5,000 was meant to come out in one month
 * or five. This panel is that memory — and the deduction still happens through
 * one call that names the month it comes out of.
 *
 * Two things it will not do: record a penalty with no reason, and take money
 * out without first saying what it would do to that month's pay.
 */

const today = () => new Date().toISOString().slice(0, 10);

const BLANK = {
  employee_id: '',
  kind: 'damage',
  amount: '',
  what: '',
  note: '',
  happened_on: today(),
  told_on: '',
  acknowledged_on: '',
  months: 1,
};

export default function Penalties({ employees, period, onError, onReload }) {
  const [rows, setRows] = useState([]);
  const [kinds, setKinds] = useState([]);
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState('');
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null); // the one being recovered
  const [preview, setPreview] = useState(null);
  const [take, setTake] = useState('');

  const load = async () => {
    try {
      const { penalties, kinds: list, report: made } = await api.get(
        `/people/penalties${status ? `?status=${status}` : ''}`
      );
      setRows(penalties);
      setKinds(list);
      setReport(made);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const kindOf = (key) => kinds.find((k) => k.key === key) || null;
  const needsThing = kindOf(form.kind)?.needsThing;

  const add = async () => {
    setBusy(true);
    try {
      await api.post('/people/penalties', { ...form, amount: Number(form.amount) });
      setForm({ ...BLANK, kind: form.kind });
      await load();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  /* What it would do, before it does it. */
  const lookAt = async (penalty) => {
    setOpen(penalty);
    setPreview(null);
    setTake('');
    if (!period) return;
    try {
      setPreview(
        await api.get(`/people/penalties/${penalty.id}/preview?period_id=${period.id}`)
      );
    } catch (err) {
      onError(err);
    }
  };

  const recover = async () => {
    if (!open || !period) return;
    setBusy(true);
    try {
      await api.post(`/people/penalties/${open.id}/recover`, {
        period_id: period.id,
        amount: take ? Number(take) : undefined,
      });
      setOpen(null);
      setPreview(null);
      await load();
      await onReload?.();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const waive = async (penalty) => {
    const note = window.prompt(
      `Stop collecting ${rupees(penalty.outstanding)} from ${penalty.employee_name}?\n\n` +
        'The record stays and what has already come out is not handed back.\n\nWhy?'
    );
    if (!note) return;
    try {
      await api.post(`/people/penalties/${penalty.id}/waive`, { note });
      await load();
    } catch (err) {
      onError(err);
    }
  };

  const remove = async (penalty) => {
    if (!window.confirm(`Delete this ${penalty.kind_label.toLowerCase()} entirely?`)) return;
    try {
      await api.del(`/people/penalties/${penalty.id}`);
      await load();
    } catch (err) {
      onError(err);
    }
  };

  const csv = useMemo(() => {
    const head = [
      'Employee', 'Code', 'Company', 'Kind', 'What', 'Why', 'Happened on',
      'Told on', 'Acknowledged', 'Amount', 'Recovered', 'Outstanding', 'Over months', 'Status',
    ];
    const lines = [head, ...rows.map((r) => [
      r.employee_name, r.employee_code || '', r.company_name || '', r.kind_label,
      r.what || '', r.note, r.happened_on || '', r.told_on || '', r.acknowledged_on || '',
      r.amount, r.recovered, r.outstanding, r.months, r.status,
    ])];
    return lines
      .map((line) => line.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
  }, [rows]);

  const download = () => {
    // A BOM, like every other export here, so Excel reads the rupee names.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'penalties.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="stack">
      <div className="card">
        <h3>Deduct a penalty, a loss or damage</h3>
        <p className="muted small">
          Recording one takes <strong>nothing</strong> out. It is recovered from a month you
          name, below — and the reason you type here goes onto that payslip.
        </p>
        <div className="vf-grid">
          <label className="vf-field">
            <span className="vf-label">Who</span>
            <select
              value={form.employee_id}
              onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
            >
              <option value="">Choose…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </label>
          <label className="vf-field">
            <span className="vf-label">What kind</span>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {kinds.map((k) => (
                <option key={k.key} value={k.key}>{k.label}</option>
              ))}
            </select>
            <span className="vf-hint">{kindOf(form.kind)?.why}</span>
          </label>
          <label className="vf-field">
            <span className="vf-label">How much</span>
            <input
              inputMode="numeric"
              value={form.amount}
              placeholder="5000"
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </label>
          <label className="vf-field">
            <span className="vf-label">Over how many months</span>
            <select value={form.months} onChange={(e) => setForm({ ...form, months: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6, 10, 12].map((m) => (
                <option key={m} value={m}>{m === 1 ? 'all at once' : `${m} months`}</option>
              ))}
            </select>
          </label>
          {needsThing ? (
            <label className="vf-field">
              <span className="vf-label">What was it</span>
              <input
                value={form.what}
                placeholder="BPL-LAP-014 Dell Latitude"
                onChange={(e) => setForm({ ...form, what: e.target.value })}
              />
            </label>
          ) : null}
          <label className="vf-field">
            <span className="vf-label">When it happened</span>
            <input
              type="date"
              value={form.happened_on}
              onChange={(e) => setForm({ ...form, happened_on: e.target.value })}
            />
          </label>
          <label className="vf-field">
            <span className="vf-label">Told them on</span>
            <input
              type="date"
              value={form.told_on}
              onChange={(e) => setForm({ ...form, told_on: e.target.value })}
            />
            <span className="vf-hint">blank = not yet, which is not the same as refused</span>
          </label>
          <label className="vf-field">
            <span className="vf-label">They accepted on</span>
            <input
              type="date"
              value={form.acknowledged_on}
              onChange={(e) => setForm({ ...form, acknowledged_on: e.target.value })}
            />
          </label>
          <label className="vf-field wide">
            <span className="vf-label">Why — what is being deducted and for what</span>
            <input
              value={form.note}
              placeholder="Dropped the laptop in the cab, screen replaced"
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
            <span className="vf-hint">
              This goes on the payslip. Without it nothing is recorded.
            </span>
          </label>
        </div>
        <div className="row" style={{ marginTop: '0.6rem' }}>
          <button
            className="primary"
            disabled={busy || !form.employee_id || !form.amount || !form.note.trim()}
            onClick={add}
          >
            Record it
          </button>
          <span className="muted small">
            The law caps a damage or loss deduction at the actual loss, and the month's total
            deductions at half the wages. The app says when a recovery crosses that — it does
            not refuse.
          </span>
        </div>
      </div>

      {report ? (
        <div className="card">
          <div className="pf-find-row">
            <h3 style={{ margin: 0 }}>The register</h3>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Everything</option>
              <option value="open">Still coming out</option>
              <option value="recovered">Recovered in full</option>
              <option value="waived">Waived</option>
            </select>
            <button onClick={download} disabled={!rows.length}>CSV</button>
          </div>
          <div className="figures">
            <div className="figure">
              <span className="n">{report.totals.count}</span>
              <span className="k">penalties</span>
            </div>
            <div className="figure">
              <span className="n">{rupees(report.totals.amount)}</span>
              <span className="k">in all</span>
            </div>
            <div className="figure">
              <span className="n">{rupees(report.totals.recovered)}</span>
              <span className="k">recovered</span>
            </div>
            <div className="figure">
              <span className="n">{rupees(report.totals.outstanding)}</span>
              <span className="k">still to come</span>
            </div>
            {report.totals.waived ? (
              <div className="figure">
                <span className="n">{rupees(report.totals.waived)}</span>
                <span className="k">waived</span>
              </div>
            ) : null}
          </div>
          {report.by_kind.length > 1 ? (
            <p className="muted small">
              {report.by_kind.map((k) => `${k.label} ${rupees(k.amount)}`).join(' · ')}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="card">
        {!rows.length ? (
          <p className="muted small">Nothing here.</p>
        ) : (
          <div className="table-wrap">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Who</th>
                  <th>What for</th>
                  <th className="num">Amount</th>
                  <th className="num">Recovered</th>
                  <th className="num">Left</th>
                  <th>Told</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.status === 'waived' ? 'muted' : undefined}>
                    <td className="sticky-name">
                      {r.employee_name}
                      <div className="muted small">{r.company_name}</div>
                    </td>
                    <td>
                      <strong>{r.kind_label}</strong>
                      {r.what ? <span className="muted"> · {r.what}</span> : null}
                      <div className="muted small">{r.note}</div>
                      <div className="muted small">
                        {r.happened_on}
                        {r.months > 1 ? ` · over ${r.months} months` : ''}
                        {r.status === 'waived' ? ` · waived: ${r.waived_note || ''}` : ''}
                      </div>
                    </td>
                    <td className="num">{rupees(r.amount)}</td>
                    <td className="num">{r.recovered ? rupees(r.recovered) : '—'}</td>
                    <td className="num">
                      {r.status === 'waived' ? (
                        <span className="muted">waived</span>
                      ) : r.outstanding > 0 ? (
                        rupees(r.outstanding)
                      ) : (
                        <span className="muted">done</span>
                      )}
                    </td>
                    <td className="small">
                      {/* Three states, like everything else here: blank is
                          "not yet", never "they refused". */}
                      {r.acknowledged_on ? (
                        <span title={`accepted ${r.acknowledged_on}`}>accepted</span>
                      ) : r.told_on ? (
                        <span className="muted" title={`told ${r.told_on}`}>told</span>
                      ) : (
                        <span className="muted">not yet</span>
                      )}
                    </td>
                    <td>
                      {r.status === 'open' && r.outstanding > 0 ? (
                        <>
                          <button className="ghost small" onClick={() => lookAt(r)}>
                            take it from {period?.label || 'a month'}
                          </button>{' '}
                          <button className="ghost small" onClick={() => waive(r)}>waive</button>{' '}
                        </>
                      ) : null}
                      {r.recovered > 0 ? null : (
                        <button className="ghost small" onClick={() => remove(r)}>delete</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* What it would do, before it does it. */}
      {open ? (
        <div className="picker-backdrop" onClick={() => setOpen(null)}>
          <div className="picker card" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <strong>
                {open.kind_label} — {open.employee_name}
              </strong>
              <span className="muted small">{open.note}</span>
            </div>
            {!preview ? (
              <p className="loading">Working out what this would do…</p>
            ) : !preview.has_row ? (
              <p className="muted small">
                {open.employee_name} has no row in {preview.period.label}, so there is nothing to
                take it from. Open that month first.
              </p>
            ) : (
              <>
                <table className="sheet my-sum">
                  <tbody>
                    <tr>
                      <td>Gross for {preview.period.label}</td>
                      <td className="num">{rupees(preview.gross)}</td>
                    </tr>
                    <tr>
                      <td>Already coming out (PT, PF, ESI, loan, other)</td>
                      <td className="num">{rupees(preview.other_deductions)}</td>
                    </tr>
                    <tr className="my-strong">
                      <td>This penalty</td>
                      <td className="num">−{rupees(preview.amount)}</td>
                    </tr>
                    <tr>
                      <td>Net now</td>
                      <td className="num">{rupees(preview.net_now)}</td>
                    </tr>
                    <tr className="my-strong">
                      <td>Net after</td>
                      <td className="num">{rupees(preview.net_after)}</td>
                    </tr>
                  </tbody>
                </table>

                {preview.warnings?.length ? (
                  <div className="banner bad" style={{ marginTop: '0.5rem' }}>
                    {preview.warnings.map((w) => (
                      <p key={w.rule} className="small" style={{ margin: '0.2rem 0' }}>
                        <strong>{w.rule}:</strong> {w.says}
                      </p>
                    ))}
                    <p className="muted small" style={{ margin: '0.2rem 0' }}>
                      Said, not refused — it is your call, and it is on the trail either way.
                    </p>
                  </div>
                ) : null}

                <div className="row" style={{ marginTop: '0.6rem' }}>
                  <label className="field inline">
                    Take
                    <input
                      inputMode="numeric"
                      value={take}
                      placeholder={String(Math.round(preview.amount))}
                      onChange={(e) => setTake(e.target.value)}
                    />
                  </label>
                  <button
                    className="primary"
                    disabled={busy || preview.period.locked}
                    onClick={recover}
                  >
                    {busy ? 'Taking…' : `Take it from ${preview.period.label}`}
                  </button>
                  <button onClick={() => setOpen(null)}>Leave it</button>
                </div>
                <p className="muted small">
                  It goes on that row as a deduction, with “{open.kind_label}: {open.note}” on the
                  payslip. {open.months > 1 ? `Instalment ${open.recoveries_count + 1} of ${open.months}.` : ''}
                </p>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
