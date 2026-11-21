import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { SETTLEMENT_COLUMNS } from '../../../shared/loanSettlement.js';
import { rupees } from '../format.js';
import { col, num, printReport } from '../printReport.js';
import { saveCsv } from '../saveCsv.js';

/**
 * Loans closed over a year, and what is still being recovered.
 *
 * Closure is worked out from the repayments, never stored — a loan is
 * finished when what has been repaid reaches what was advanced, and the
 * month it finished in is the month of the repayment that got it there.
 */
export default function LoanSettlement({ period }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState('running');
  const year = period?.year;

  useEffect(() => {
    setError('');
    setData(null);
    api
      .get(`/loans/settlement${year ? `?year=${year}` : ''}`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [year]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted small">Loading…</p>;

  const t = data.totals;
  const rows = view === 'closed' ? data.closed : data.running;

  const print = () =>
    printReport({
      title: view === 'closed' ? `Loans closed in ${year || 'all years'}` : 'Loans still running',
      subtitle: period?.label,
      meta:
        view === 'closed'
          ? [`${t.closed} loan(s) finished · ${rupees(t.closed_amount)} advanced and recovered in full`]
          : [
              `${t.running} running · ${rupees(t.outstanding)} still to come back of ${rupees(t.advanced)} advanced`,
              t.held
                ? `${t.held} of them are on hold (${rupees(t.held_outstanding)}) and take nothing this month.`
                : null,
            ].filter(Boolean),
      columns: [
        col('Name', (r) => r.name),
        col('Company', (r) => r.company_name, '14%'),
        num('Advanced', (r) => rupees(r.amount), '10%'),
        col('Given on', (r) => r.given_on, '10%'),
        col('Reason', (r) => r.reason, '14%'),
        num('Instalments', (r) => r.instalments_paid, '8%'),
        num('Repaid', (r) => rupees(r.repaid), '10%'),
        ...(view === 'closed'
          ? [col('Closed in', (r) => r.closed_on, '12%')]
          : [
              num('Outstanding', (r) => rupees(r.outstanding), '10%'),
              num('Months left', (r) => (r.months_left == null ? '—' : r.months_left), '8%'),
            ]),
      ],
      rows,
      totals:
        view === 'closed'
          ? { label: `${t.closed} loans`, Advanced: rupees(t.closed_amount), Repaid: rupees(t.closed_amount) }
          : {
              label: `${t.running} loans`,
              Advanced: rupees(t.advanced),
              Repaid: rupees(t.recovered),
              Outstanding: rupees(t.outstanding),
            },
      empty: view === 'closed' ? 'No loan finished in this year.' : 'Nothing is being recovered.',
      footer:
        'Closure is worked out from the repayments posted against each loan, not from a status somebody set.',
    });

  return (
    <div className="card">
      <div className="late-head">
        <div>
          <h2>{view === 'closed' ? `Loans closed in ${year}` : 'Loans still running'}</h2>
          <p className="muted small">
            A loan is <strong>finished when what has been repaid reaches what was advanced</strong>,
            and the month it finished in is the month of the repayment that got it there — worked
            out from the repayments, never from a status somebody set, so it cannot drift from
            what actually came out of people&rsquo;s pay.
          </p>
        </div>
        <span className="grow" />
        <button onClick={print}>Print</button>
        <button
          className="ghost"
          onClick={() =>
            saveCsv(
              view === 'closed' ? `Loans-closed-${year}.csv` : 'Loans-running.csv',
              SETTLEMENT_COLUMNS,
              rows
            )
          }
        >
          CSV
        </button>
      </div>

      <div className="stat-row">
        <Fig label="Still running" value={t.running} />
        <Money label="Outstanding" value={t.outstanding} strong />
        <Fig label={`Closed in ${year || '—'}`} value={t.closed} />
        <Money label="Closed, advanced" value={t.closed_amount} />
        {t.held ? <Fig label="On hold" value={t.held} /> : null}
      </div>

      <div className="chips">
        <button
          className={`chip ${view === 'running' ? 'active' : ''}`}
          onClick={() => setView('running')}
        >
          Still running <span className="muted">{data.running.length}</span>
        </button>
        <button
          className={`chip ${view === 'closed' ? 'active' : ''}`}
          onClick={() => setView('closed')}
        >
          Closed in {year} <span className="muted">{data.closed.length}</span>
        </button>
      </div>

      <table className="sheet">
        <thead>
          <tr>
            <th>Name</th>
            <th className="num">Advanced</th>
            <th>Given on</th>
            <th>Reason</th>
            <th className="num">Instalments</th>
            <th className="num">Repaid</th>
            {view === 'closed' ? (
              <th>Closed in</th>
            ) : (
              <>
                <th className="num">Outstanding</th>
                <th className="num">Months left</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.loan_id}>
              <td>
                {l.name}
                <div className="muted small">{l.company_name}</div>
              </td>
              <td className="num">{rupees(l.amount)}</td>
              <td className="small">{l.given_on}</td>
              <td className="small">{l.reason}</td>
              <td className="num">{l.instalments_paid}</td>
              <td className="num">{rupees(l.repaid)}</td>
              {view === 'closed' ? (
                <td className="small">{l.closed_on}</td>
              ) : (
                <>
                  <td className="num strong">{rupees(l.outstanding)}</td>
                  <td className="num">
                    {/* Never a guess: no instalment set means it is not known
                        when this finishes, which is not "next month". */}
                    {l.months_left == null ? (
                      <span className="muted" title="No instalment set">—</span>
                    ) : (
                      l.months_left
                    )}
                    {l.status === 'held' ? (
                      <div className="muted small">on hold</div>
                    ) : null}
                  </td>
                </>
              )}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={view === 'closed' ? 7 : 8} className="empty">
                {view === 'closed'
                  ? `No loan finished in ${year}.`
                  : 'Nothing is being recovered.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {view === 'running' && t.held ? (
        <p className="muted small">
          {t.held} of these are <strong>on hold</strong> ({rupees(t.held_outstanding)}) and take
          nothing this month — the debt stands, but none of that figure is coming back until
          they are resumed.
        </p>
      ) : null}
      {t.over_recovered ? (
        <p className="warn small">
          {rupees(t.over_recovered)} has been recovered beyond what was advanced. That is money
          owed back — shown rather than quietly rounded to zero.
        </p>
      ) : null}
    </div>
  );
}

function Fig({ label, value, strong }) {
  return (
    <div className="stat plain">
      <span className={`value${strong ? ' strong' : ''}`}>{value}</span>
      <span className="label">{label}</span>
    </div>
  );
}

function Money({ label, value, strong }) {
  return (
    <div className="stat plain">
      <span className={`value${strong ? ' strong' : ''}`}>{rupees(value)}</span>
      <span className="label">{label}</span>
    </div>
  );
}
