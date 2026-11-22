import { useMemo, useState } from 'react';
import { CONTACT_FIELDS, contactList } from '../../../shared/contactList.js';
import { col, printReport } from '../printReport.js';
import { saveCsv } from '../saveCsv.js';

/**
 * Staff contact list — name, department, role, mobile, email.
 *
 * Everything here was already on the master; what there was no way to get
 * was the five of them together on a page you can print or hand over. The
 * employee export carries forty columns including salaries, which is not a
 * thing to send round the office.
 *
 * NO SALARY, NO PAN, NO BANK DETAILS. A contact list gets left on a desk.
 */
export default function ContactList({ employees = [], companyId, department }) {
  const [q, setQ] = useState('');
  const { lines, totals } = useMemo(
    () => contactList(employees, { company_id: companyId, department, q }),
    [employees, companyId, department, q]
  );

  const print = () =>
    printReport({
      title: 'Staff contact list',
      subtitle: `${totals.people} people · ${totals.departments} departments`,
      meta: [
        `${totals.with_mobile} have a mobile number, ${totals.with_email} an email`,
        totals.no_mobile ? `${totals.no_mobile} have no mobile number on record` : null,
        'Contact details only — no salary, no PAN and no bank details are on this page.',
      ].filter(Boolean),
      columns: [
        col('Name', (r) => r.name),
        col('Code', (r) => r.code, '9%'),
        col('Company', (r) => r.company_name, '14%'),
        col('Department', (r) => r.department, '13%'),
        col('Role', (r) => r.designation, '14%'),
        col('Mobile', (r) => r.phone, '11%'),
        col('Email', (r) => r.email, '18%'),
      ],
      rows: lines,
      empty: 'Nobody on the staff list.',
      footer:
        'Straight off the employee master — change a number on the person’s own record and it changes here.',
    });

  return (
    <div className="card">
      <div className="late-head">
        <div>
          <h2>Staff contact list</h2>
          <p className="muted small">
            Name, department, role, mobile and email, down the staff.{' '}
            <strong>No salary, no PAN and no bank details</strong> — this is the list that gets
            printed and left on a desk, so it carries only what a contact list needs.
          </p>
        </div>
        <span className="grow" />
        <button onClick={print}>Print</button>
        <button
          className="ghost"
          onClick={() => saveCsv('Staff-contact-list.csv', CONTACT_FIELDS, lines)}
        >
          CSV
        </button>
      </div>

      <div className="stat-row">
        <Fig label="People" value={totals.people} strong />
        <Fig label="Departments" value={totals.departments} />
        <Fig label="Have a mobile" value={totals.with_mobile} />
        <Fig label="Have an email" value={totals.with_email} />
      </div>

      {totals.no_mobile || totals.no_email ? (
        <p className="muted small">
          {totals.no_mobile ? <><strong>{totals.no_mobile}</strong> have no mobile number</> : null}
          {totals.no_mobile && totals.no_email ? ' and ' : null}
          {totals.no_email ? <><strong>{totals.no_email}</strong> have no email</> : null}
          {' '}on record — they are listed with the gap showing rather than left out.
        </p>
      ) : null}

      <div className="row">
        <input
          className="search"
          placeholder="Find a name, a department, a role or a number"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <table className="sheet">
        <thead>
          <tr>
            <th>Name</th>
            <th>Code</th>
            <th>Company</th>
            <th>Department</th>
            <th>Role</th>
            <th>Mobile</th>
            <th>Email</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.employee_id}>
              <td>{l.name}</td>
              <td className="small">{l.code}</td>
              <td className="small">{l.company_name}</td>
              <td className="small">{l.department || <span className="muted">—</span>}</td>
              <td className="small">{l.designation || <span className="muted">—</span>}</td>
              <td className="small">
                {l.phone ? <a href={`tel:${l.phone}`}>{l.phone}</a> : <span className="muted">—</span>}
              </td>
              <td className="small">
                {l.email ? <a href={`mailto:${l.email}`}>{l.email}</a> : <span className="muted">—</span>}
              </td>
            </tr>
          ))}
          {!lines.length && (
            <tr><td colSpan={7} className="empty">Nobody matches that.</td></tr>
          )}
        </tbody>
      </table>
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
