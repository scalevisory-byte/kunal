import { useEffect, useState } from 'react';
import { api, download } from '../api.js';
import { rupees } from '../format.js';

/**
 * The compliance registers for a month: PF, ESI, professional tax, and the wage
 * register a labour inspector asks for.
 *
 * All four are worked out from the month that has already been calculated plus
 * the identifiers on each employee's record, so nothing is entered twice.
 * Anyone missing a UAN or an ESIC number is named, because that is what stops a
 * return being filed.
 */
const TABS = [
  ['pf', 'Provident Fund'],
  ['esi', 'ESI'],
  ['pt', 'Professional Tax'],
  ['wages', 'Wage register'],
];

/** Built from TABS, so a fifth register cannot be offered and then ignored. */
const KNOWN = new Set(TABS.map(([key]) => key));

/**
 * THE REGISTER THE OFFICE ASKED FOR IS THE ONE THAT OPENS.
 *
 * Reports lists these as four separate reports - PF register, ESI register,
 * Professional tax register, Wage register - and every one of them rendered
 * `<Statutory period={period} />`, whose own tab state started at `pf`. So
 * all four opened on Provident Fund.
 *
 * On the real data that is not merely untidy: the PF register carries only
 * the people PF is deducted for, so somebody opening the **wage register**
 * was shown seven names out of twenty and no sign that thirteen were
 * missing - and a wage register that lists a third of the staff understates
 * the wages actually paid, which is the one thing it exists to state.
 * The panel's own Download follows the tab too, so pressing it on that
 * screen handed over the PF CSV under the wage register's name.
 *
 * `show` is the register to open on; the tabs still move freely from there.
 * It is an effect and not just the initial state because React keeps this
 * component mounted when the report id changes - the element type is the
 * same - so the state would survive from the last register opened.
 */
export default function Statutory({ period, show = 'pf' }) {
  const [report, setReport] = useState(null);
  const [which, setWhich] = useState(KNOWN.has(show) ? show : 'pf');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setWhich(KNOWN.has(show) ? show : 'pf');
  }, [show]);

  useEffect(() => {
    if (!period) return;
    setLoading(true);
    setError('');
    api
      .get(`/periods/${period.id}/statutory`)
      .then(setReport)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [period?.id]);

  const grab = async (name) => {
    setError('');
    try {
      await download(`/periods/${period.id}/statutory/${which}.csv`, `${name}-${period.label}.csv`);
    } catch (err) {
      setError(err.message);
    }
  };

  if (!period) return <p className="card muted">Open a month first.</p>;
  if (loading) return <p className="card muted">Working out the registers…</p>;
  if (error) return <p className="card error">{error}</p>;
  if (!report) return null;

  return (
    <div className="card">
      <h2>Statutory registers — {period.label}</h2>

      <nav className="tabs sub-tabs">
        {TABS.map(([key, label]) => (
          <button key={key} className={which === key ? 'active' : undefined} onClick={() => setWhich(key)}>
            {label}
          </button>
        ))}
        <span className="grow" />
        <button onClick={() => grab(TABS.find(([k]) => k === which)[1])}>
          Download the {TABS.find(([k]) => k === which)[1].toLowerCase()} CSV
        </button>
      </nav>

      {which === 'pf' && (
        <>
          <div className="stat-row">
            <Stat label="Members" value={report.pf.rows.length} plain />
            <Stat label="Employee share" value={report.pf.total_employee} />
            <Stat label="Employer share" value={report.pf.total_employer} />
            <Stat label="Total" value={report.pf.total_employee + report.pf.total_employer} strong />
          </div>
          {report.pf.missing > 0 && (
            <p className="error">
              {report.pf.missing} {report.pf.missing === 1 ? 'member has' : 'members have'} no UAN.
              The return cannot go up without one — add it on their record under Employees.
            </p>
          )}
          <Table
            columns={['UAN', 'Member', 'Gross wages', 'EPF wages', 'Employee', 'Pension', 'Employer', 'NCP days']}
            rows={report.pf.rows.map((r) => [
              r.uan || <em key="x" className="deduct">missing</em>,
              r.name, rupees(r.gross_wages), rupees(r.epf_wages),
              rupees(r.employee_share), rupees(r.pension_share), rupees(r.employer_share), r.ncp_days,
            ])}
            empty="Nobody has PF this month."
          />
        </>
      )}

      {which === 'esi' && (
        <>
          <div className="stat-row">
            <Stat label="Insured" value={report.esi.rows.length} plain />
            <Stat label="Employee share" value={report.esi.total_employee} />
            <Stat label="Employer share" value={report.esi.total_employer} />
            <Stat label="Total" value={report.esi.total_employee + report.esi.total_employer} strong />
          </div>
          {report.esi.missing > 0 && (
            <p className="error">{report.esi.missing} without an ESIC number — add it under Employees.</p>
          )}
          {report.esi.overLimit > 0 && (
            <p className="muted small">
              {report.esi.overLimit} above the ₹21,000 wage limit. ESI stops applying above it, so
              check whether they should still be on the return.
            </p>
          )}
          <Table
            columns={['IP number', 'Name', 'Days paid', 'Wages', 'Employee', 'Employer']}
            rows={report.esi.rows.map((r) => [
              r.ip_number || <em key="x" className="deduct">missing</em>,
              r.name, r.days_paid, rupees(r.wages), rupees(r.employee_share), rupees(r.employer_share),
            ])}
            empty="Nobody is on ESI this month."
          />
        </>
      )}

      {which === 'pt' && (
        <>
          <div className="stat-row">
            <Stat label="Paying" value={report.pt.rows.length} plain />
            <Stat label="Below the slab" value={report.pt.exempt} plain />
            <Stat label="Total PT" value={report.pt.total} strong />
          </div>
          <Table
            columns={['Company', 'Employees', 'Amount']}
            rows={report.pt.byCompany.map((c) => [c.company, c.count, rupees(c.amount)])}
            empty="Nobody is over the slab this month."
          />
          <p className="muted small">
            The CSV lists each person; the table above is the company-by-company summary a challan
            is filled from.
          </p>
        </>
      )}

      {which === 'wages' && (
        <Table
          columns={['Sr', 'Employee', 'Company', 'Days', 'Gross', 'Deductions', 'Net payable']}
          rows={report.wages.map((r) => [
            r.sr, r.name, r.company, `${r.present_days}/${r.working_days}`,
            rupees(r.gross), rupees(r.deductions), rupees(r.payable),
          ])}
          empty="No wages this month."
        />
      )}

      <p className="muted small">
        These are worked out from the month and from each employee's record — there is nothing to
        keep in step by hand. <strong>The EPFO and ESIC upload formats change from time to time</strong>,
        so check a file against the portal's own template before uploading it rather than trusting
        it blind. PF wages are capped at ₹15,000 and the employee's share is whatever was actually
        deducted, so a fixed ₹1,800 stays ₹1,800.
      </p>
    </div>
  );
}

function Table({ columns, rows, empty }) {
  return (
    <div className="table-wrap">
      <table className="sheet">
        <thead>
          <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((cell, j) => (
                <td key={j} className={j === 0 ? 'sticky-name' : typeof cell === 'number' || /^[\d,]+$/.test(String(cell)) ? 'num' : undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={columns.length} className="empty">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, strong, plain }) {
  return (
    <div className={`stat${strong ? ' strong' : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{plain ? value : rupees(value)}</span>
    </div>
  );
}
