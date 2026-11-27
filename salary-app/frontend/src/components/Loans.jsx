import { useEffect, useMemo, useState } from 'react';
import { col, num, printReport } from '../printReport.js';
import { api } from '../api.js';
import { rupees } from '../format.js';
import { onStaff } from '../onStaff.js';

/**
 * Loans and salary advances.
 *
 * A loan takes its instalment automatically, but never silently: opening a
 * month writes one repayment row per active loan, which is then a thing you can
 * see and change. Somebody who cannot pay this month gets that month set to
 * zero, and the loan simply runs a month longer - the outstanding balance is
 * always the amount less what has actually been repaid, never a projection.
 */
const BLANK = { employee_id: '', amount: '', instalment: '', given_on: '', reason: '' };

export default function Loans({ period, employees, onReload }) {
  const [loans, setLoans] = useState([]);
  const [repayments, setRepayments] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [query, setQuery] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError('');
    try {
      const data = await api.get(`/loans${period ? `?period_id=${period.id}` : ''}`);
      setLoans(data.loans);
      setRepayments(data.repayments);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period?.id]);

  const thisMonth = useMemo(() => {
    const map = new Map();
    for (const r of repayments) map.set(r.loan_id, r.amount);
    return map;
  }, [repayments]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return loans.filter(
      (l) =>
        (showClosed || l.outstanding > 0) &&
        (!q ||
          (l.employee_name || '').toLowerCase().includes(q) ||
          (l.reason || '').toLowerCase().includes(q))
    );
  }, [loans, query, showClosed]);

  const totals = filtered.reduce(
    (acc, l) => ({
      given: acc.given + l.amount,
      outstanding: acc.outstanding + l.outstanding,
      thisMonth: acc.thisMonth + (thisMonth.get(l.id) || 0),
    }),
    { given: 0, outstanding: 0, thisMonth: 0 }
  );

  /**
   * LOANS AND ADVANCES AS A REGISTER.
   *
   * Every figure is the one on screen — `repaid` and `outstanding` are the
   * server's, and "this month" is the instalment actually posted against
   * this month's row, not the standing instalment. Those two differ the
   * moment a month is skipped, which is the whole reason a month can be
   * skipped without losing the debt.
   */
  const printIt = () => {
    const narrowed = [
      query.trim() && `matching “${query.trim()}”`,
      showClosed ? 'including loans already repaid' : 'still running',
    ].filter(Boolean);
    const names = [...new Set(filtered.map((l) => l.company_name).filter(Boolean))];
    printReport({
      title: 'Loans and advances',
      subtitle: [names.length === 1 ? names[0] : 'All companies', ...narrowed].join(' · '),
      meta: [
        `${filtered.length} ${filtered.length === 1 ? 'loan' : 'loans'}`,
        `${rupees(totals.outstanding)} outstanding of ${rupees(totals.given)} given`,
        period ? `${rupees(totals.thisMonth)} coming off in ${period.label}` : 'no month open',
      ],
      landscape: true,
      columns: [
        col('#', (_l, i) => i + 1, '3%'),
        col('Employee', (l) => l.employee_name),
        col('Given on', (l) => l.given_on || ''),
        col('What for', (l) => l.reason || ''),
        num('Amount', (l) => rupees(l.amount)),
        num('Per month', (l) => rupees(l.instalment)),
        num('Repaid', (l) => rupees(l.repaid)),
        num('Outstanding', (l) => (l.outstanding > 0 ? rupees(l.outstanding) : 'repaid')),
        num(period ? `In ${period.label}` : 'This month', (l) =>
          period ? rupees(thisMonth.get(l.id) || 0) : '—'
        ),
        col('Status', (l) => (l.outstanding <= 0 ? 'Repaid' : l.status === 'held' ? 'On hold' : 'Running')),
      ],
      rows: filtered,
      totals: {
        label: `Total (${filtered.length})`,
        Amount: rupees(totals.given),
        /* What a full month would take if every one of these ran. */
        'Per month': rupees(
          filtered
            .filter((l) => l.outstanding > 0 && l.status !== 'held')
            .reduce((sum, l) => sum + (Number(l.instalment) || 0), 0)
        ),
        Repaid: rupees(filtered.reduce((sum, l) => sum + (Number(l.repaid) || 0), 0)),
        Outstanding: rupees(totals.outstanding),
        [period ? `In ${period.label}` : 'This month']: period ? rupees(totals.thisMonth) : '—',
      },
      /*
       * Both halves of the rule the module was built on, said on the paper:
       * a month can be skipped without the debt going anywhere, and nothing
       * here deducts by itself.
       */
      footer:
        'The instalment is what comes off a month when the month is opened; a month set to zero or a loan on hold simply takes nothing that month, and the outstanding stays. Nothing here deducts by itself — the figure in the month column is what the salary sheet is actually taking.',
    });
  };

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/loans', {
        employee_id: Number(form.employee_id),
        amount: Number(form.amount),
        instalment: Number(form.instalment) || 0,
        given_on: form.given_on || null,
        reason: form.reason || null,
      });
      setForm({ ...BLANK, employee_id: form.employee_id });
      await load();
      if (period) await api.post(`/loans/post/${period.id}`);
      await load();
      await onReload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const patch = async (loan, body) => {
    try {
      await api.patch(`/loans/${loan.id}`, body);
      await load();
      await onReload();
    } catch (err) {
      setError(err.message);
    }
  };

  const setThisMonth = async (loan, amount) => {
    if (!period) return;
    try {
      await api.put(`/loans/${loan.id}/repayment/${period.id}`, { amount });
      await load();
      await onReload();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (loan) => {
    if (!window.confirm(
      `Delete this ${rupees(loan.amount)} loan for ${loan.employee_name}?\n\n` +
        'Every instalment already taken against it goes too, which will change months that are already done.'
    )) return;
    try {
      await api.del(`/loans/${loan.id}`);
      await load();
      await onReload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="stack">
      <div className="card">
        <h2>Give a loan or advance</h2>
        <form className="form-grid" onSubmit={add}>
          <label>
            Employee
            <select
              required
              value={form.employee_id}
              onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
            >
              <option value="">Select…</option>
              {onStaff(employees).map((e) => (
                <option key={e.id} value={e.id}>{e.name} — {e.company_name}</option>
              ))}
            </select>
          </label>
          <label>
            Amount
            <input
              required
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </label>
          <label title="What comes off the salary each month. Leave it zero to take nothing until you say so.">
            Per month
            <input
              inputMode="decimal"
              value={form.instalment}
              onChange={(e) => setForm({ ...form, instalment: e.target.value })}
            />
          </label>
          <label>
            Given on
            <input
              type="date"
              value={form.given_on}
              onChange={(e) => setForm({ ...form, given_on: e.target.value })}
            />
          </label>
          <label>
            Reason
            <input
              placeholder="optional"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </label>
          <button className="primary" type="submit" disabled={busy}>Add</button>
        </form>
        {error && <p className="error">{error}</p>}
        <p className="muted small">
          The instalment starts coming off {period ? period.label : 'the open month'} and keeps going
          until the loan is repaid. Nothing is projected — the balance is the amount less what has
          actually been taken.
        </p>
      </div>

      <div className="card">
        <div className="toolbar">
          <input
            className="search"
            placeholder="Search employee or reason"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="check">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            Show repaid
          </label>
          {/*
            * The ledger the office files, not the screen it is typed on.
            * Two instalment boxes and a status picker are controls; what
            * somebody signs off at month end is a list.
            */}
          <button className="ghost" onClick={printIt} disabled={!filtered.length}>
            Print {filtered.length}
          </button>
          <span className="grow" />
          <span className="muted small">
            {rupees(totals.outstanding)} outstanding
            {period && ` · ${rupees(totals.thisMonth)} coming off in ${period.label}`}
          </span>
        </div>

        <div className="table-wrap">
          <table className="sheet loans-table">
            <thead>
              <tr>
                <th className="sticky-name">Employee</th>
                <th>Given</th>
                <th>Reason</th>
                <th>Amount</th>
                <th>Per month</th>
                <th>Repaid</th>
                <th>Outstanding</th>
                <th title={period ? `Coming off in ${period.label}` : 'Open a month first'}>
                  This month
                </th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((loan) => (
                <tr key={loan.id} className={loan.outstanding <= 0 ? 'paid' : undefined}>
                  <td className="sticky-name">{loan.employee_name}</td>
                  <td className="muted">{loan.given_on || '-'}</td>
                  <td className="muted">{loan.reason || '-'}</td>
                  <td className="num">{rupees(loan.amount)}</td>
                  <td className="num">
                    <input
                      key={`inst-${loan.id}-${loan.instalment}`}
                      className="cell-input"
                      inputMode="decimal"
                      defaultValue={loan.instalment}
                      onBlur={(e) =>
                        Number(e.target.value) !== loan.instalment &&
                        patch(loan, { instalment: Number(e.target.value) || 0 })
                      }
                    />
                  </td>
                  <td className="num muted">{rupees(loan.repaid)}</td>
                  <td className={`num strong${loan.outstanding > 0 ? '' : ' muted'}`}>
                    {loan.outstanding > 0 ? rupees(loan.outstanding) : 'repaid'}
                  </td>
                  <td className="num">
                    {period ? (
                      <input
                        key={`rep-${loan.id}-${thisMonth.get(loan.id) ?? ''}`}
                        className="cell-input"
                        inputMode="decimal"
                        defaultValue={thisMonth.get(loan.id) ?? 0}
                        onBlur={(e) => {
                          const value = Number(e.target.value) || 0;
                          if (value !== (thisMonth.get(loan.id) ?? 0)) setThisMonth(loan, value);
                        }}
                      />
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                  <td>
                    <select value={loan.status} onChange={(e) => patch(loan, { status: e.target.value })}>
                      <option value="active">Running</option>
                      <option value="held">On hold</option>
                    </select>
                  </td>
                  <td>
                    <button className="danger tiny" onClick={() => remove(loan)}>Delete</button>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={10} className="empty">
                    {showClosed ? 'No loans yet.' : 'Nothing outstanding. Tick “Show repaid” for the history.'}
                  </td>
                </tr>
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr>
                  <td className="sticky-name">Total ({filtered.length})</td>
                  <td colSpan={2} />
                  <td className="num">{rupees(totals.given)}</td>
                  <td colSpan={2} />
                  <td className="num grand">{rupees(totals.outstanding)}</td>
                  <td className="num">{rupees(totals.thisMonth)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <p className="muted small">
          <strong>This month</strong> is what actually comes off the salary — change it to nothing
          for somebody who cannot pay, and the loan just runs a month longer.{' '}
          <strong>On hold</strong> stops future months without touching what has already been taken.
        </p>
      </div>
    </section>
  );
}
