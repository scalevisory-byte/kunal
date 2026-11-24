import { useMemo, useState } from 'react';
import { api } from '../../api.js';
import { rupees } from '../../format.js';
import { col, num, printReport } from '../../printReport.js';
import { todayIso } from '../../../../shared/today.js';

/**
 * WHO HAS BEEN PAID, AND WHAT WITH.
 *
 * `status` has always been pending / paid / hold — a claim with nothing
 * behind it. This adds the two things that make "paid" checkable: the date
 * the money went and the UTR or cheque number it went as. The exception
 * report names any row marked paid without them.
 *
 * NOTHING HERE TOUCHES A FIGURE. Net payable is the sheet's own number; this
 * screen only records what happened to it.
 */

const STATUSES = [
  ['pending', 'Pending'],
  ['processing', 'Processing'],
  ['paid', 'Paid'],
  ['failed', 'Failed'],
  /* `hold` has been in the data since the first month and means something
     different from failed: the office is not paying this one yet. */
  ['hold', 'Hold'],
];

const today = () => todayIso();

export default function PaymentTracking({ period, rows, locked, onError, onChanged, onOpenEmployee }) {
  const [bucket, setBucket] = useState('all');
  const [mode, setMode] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(0);

  const shown = useMemo(
    () =>
      rows.filter((r) => {
        if (bucket !== 'all' && (r.status || 'pending') !== bucket) return false;
        if (mode && (r.payment_mode || '') !== mode) return false;
        const q = query.trim().toLowerCase();
        if (q && !`${r.employee_name} ${r.employee_code || ''} ${r.payment_ref || ''}`.toLowerCase().includes(q)) {
          return false;
        }
        return true;
      }),
    [rows, bucket, mode, query]
  );

  const totals = useMemo(() => {
    const sum = (list) => list.reduce((t, r) => t + (Number(r.net_salary) || 0), 0);
    const paid = rows.filter((r) => r.status === 'paid');
    return {
      all: sum(rows),
      paid: sum(paid),
      left: sum(rows.filter((r) => r.status !== 'paid')),
      paidCount: paid.length,
    };
  }, [rows]);

  const patch = async (row, body) => {
    setBusy(row.id);
    try {
      /* `/rows/:id`, which is the route the sheet has always patched through
         - `/payroll/:id` 404s, as a drive of this screen found. */
      await api.patch(`/periods/${period.id}/rows/${row.id}`, body);
      onChanged?.();
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy(0);
    }
  };

  /*
   * Marking somebody paid fills in today's date if nothing is there, because
   * the date is the whole point and an empty one gets left empty. It is a
   * suggestion, not a fact: it can be typed over, and the exception report
   * still asks for a reference.
   */
  const setStatus = (row, status) =>
    patch(row, status === 'paid' && !row.payment_date ? { status, payment_date: today() } : { status });

  const COLUMNS = [
    col('Employee', (r) => r.employee_name),
    col('Code', (r) => r.employee_code || ''),
    col('Company', (r) => r.company_name || ''),
    num('Net payable', (r) => rupees(r.net_salary)),
    col('Mode', (r) => r.payment_mode || ''),
    col('Status', (r) => r.status || 'pending'),
    col('Paid on', (r) => r.payment_date || ''),
    col('Reference', (r) => r.payment_ref || ''),
    col('Remark', (r) => r.remark || ''),
  ];

  const printIt = (list, title) =>
    printReport({
      title,
      subtitle: period.label,
      meta: [
        `${list.length} employee(s)`,
        `${rupees(list.reduce((t, r) => t + (Number(r.net_salary) || 0), 0))} in total`,
      ],
      landscape: true,
      columns: [col('#', (_r, i) => i + 1, '3%'), ...COLUMNS],
      rows: list,
      totals: {
        label: `Total (${list.length})`,
        'Net payable': rupees(list.reduce((t, r) => t + (Number(r.net_salary) || 0), 0)),
      },
      empty: 'Nobody here.',
      footer:
        'Net payable is the salary sheet’s own figure. A row counts as paid only because somebody marked it paid — the date and the reference are what make that checkable.',
    });

  return (
    <>
      <div className="card">
        <div className="fo-figures">
          <div><b>{rows.length}</b><span>employees</span></div>
          <div><b>{rupees(totals.all)}</b><span>net payable</span></div>
          <div className="good"><b>{rupees(totals.paid)}</b><span>paid ({totals.paidCount})</span></div>
          <div className={totals.left ? 'bad' : undefined}><b>{rupees(totals.left)}</b><span>still to pay</span></div>
        </div>

        <div className="toolbar">
          <div className="chips">
            <button className={`chip ${bucket === 'all' ? 'active' : ''}`} onClick={() => setBucket('all')}>
              All ({rows.length})
            </button>
            {STATUSES.map(([key, label]) => {
              const n = rows.filter((r) => (r.status || 'pending') === key).length;
              return n ? (
                <button key={key} className={`chip ${bucket === key ? 'active' : ''}`} onClick={() => setBucket(key)}>
                  {label} ({n})
                </button>
              ) : null;
            })}
          </div>
          <input
            className="search"
            placeholder="Name, code or reference"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">Any mode</option>
            {[...new Set(rows.map((r) => r.payment_mode).filter(Boolean))].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <span className="grow" />
          <button className="ghost" onClick={() => printIt(shown, 'Payment report')} disabled={!shown.length}>
            Print
          </button>
          <button
            className="ghost"
            onClick={() => printIt(rows.filter((r) => r.status !== 'paid'), 'Pending payment report')}
          >
            Pending report
          </button>
          <button
            className="ghost"
            onClick={() => printIt(rows.filter((r) => r.status === 'paid'), 'Paid salary report')}
          >
            Paid report
          </button>
        </div>
      </div>

      <div className="card scroll">
        <table className="sheet numbered fo-table">
          <thead>
            <tr>
              <th className="row-no">#</th>
              <th className="grow">Employee</th><th>Company</th><th className="num">Net payable</th>
              <th>Mode</th><th>Status</th><th>Paid on</th><th>Reference</th><th>Remark</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.id} className={r.status === 'paid' ? 'paid' : undefined}>
                <td className="row-no">{i + 1}</td>
                <td>
                  <button className="link" onClick={() => onOpenEmployee?.(r.employee_id)}>
                    {r.employee_name}
                  </button>
                </td>
                <td className="small">{r.company_name}</td>
                <td className="num strong">{rupees(r.net_salary)}</td>
                <td>
                  <select
                    value={r.payment_mode || ''}
                    disabled={locked || busy === r.id}
                    onChange={(e) => patch(r, { payment_mode: e.target.value })}
                  >
                    <option value="">—</option>
                    {['Bank', 'Cash', 'Gpay', 'Cheque'].map((m) => <option key={m}>{m}</option>)}
                  </select>
                </td>
                <td>
                  <select
                    className={`pay-${r.status || 'pending'}`}
                    value={r.status || 'pending'}
                    disabled={locked || busy === r.id}
                    onChange={(e) => setStatus(r, e.target.value)}
                  >
                    {STATUSES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </td>
                <td>
                  <input
                    type="date"
                    className="cell-input date"
                    key={`d-${r.id}-${r.payment_date || ''}`}
                    defaultValue={r.payment_date || ''}
                    disabled={locked || busy === r.id}
                    onBlur={(e) => {
                      if (e.target.value === (r.payment_date || '')) return;
                      patch(r, { payment_date: e.target.value });
                    }}
                  />
                </td>
                <td>
                  <input
                    className="cell-input"
                    placeholder="UTR / cheque no."
                    key={`r-${r.id}-${r.payment_ref || ''}`}
                    defaultValue={r.payment_ref || ''}
                    disabled={locked || busy === r.id}
                    onBlur={(e) => {
                      if (e.target.value === (r.payment_ref || '')) return;
                      patch(r, { payment_ref: e.target.value });
                    }}
                  />
                </td>
                <td className="small">{r.remark}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length ? <p className="empty fo-empty">Nobody matches.</p> : null}
        <p className="muted small">
          Marking somebody paid fills in today’s date if there is none — change it to the day the
          money actually went. <strong>Net payable is the sheet’s own figure and is not touched
          here.</strong>
        </p>
      </div>
    </>
  );
}
