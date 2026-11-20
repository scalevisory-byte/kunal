import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { onStaff } from '../../onStaff.js';
import {
  VISITOR_BREAKDOWNS, VISITOR_TYPES, averageMinutes, breakdown, duration, visitorKpis,
} from '../../../../shared/frontOffice.js';
import { col, num, printReport } from '../../printReport.js';

/**
 * THE VISITOR REPORTS — one day, or a whole month six ways.
 *
 * It ASSEMBLES, it does not recalculate: every figure is counted off the
 * same rows the register shows, through the same shared module, so the
 * report and the book cannot disagree about how many people came.
 *
 * Six breakdowns out of one function, because they are one question asked
 * six ways — and a sixth copy of "group, count, average" is a sixth chance
 * for one of them to count differently.
 */

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const monthOf = (iso) => String(iso).slice(0, 7);
const lastDay = (month) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};

const escapeCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV with a BOM, so Excel opens it with the rupee signs and names intact. */
function download(name, columns, rows) {
  const lines = [columns.map((c) => escapeCell(c.head)).join(',')];
  rows.forEach((row, i) => lines.push(columns.map((c) => escapeCell(c.get(row, i))).join(',')));
  const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const REGISTER_COLUMNS = [
  col('Date', (v) => v.day),
  col('In', (v) => v.in_time || ''),
  col('Pass', (v) => v.pass_no || ''),
  col('Name', (v) => v.name || ''),
  col('Company', (v) => v.company || ''),
  col('Type', (v) => v.visitor_type || ''),
  col('To meet', (v) => v.meeting || ''),
  col('Purpose', (v) => v.purpose || ''),
  col('Mobile', (v) => v.mobile || ''),
  col('Out', (v) => v.out_time || ''),
  col('Inside for', (v) => duration(v.minutes)),
  col('Status', (v) => v.status || ''),
];

export default function VisitorReports({ mode, day, employees = [], companyId, onError, onGoEmployee }) {
  const monthly = mode === 'month';
  const [month, setMonth] = useState(() => monthOf(day || todayISO()));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [by, setBy] = useState('day');
  const [type, setType] = useState('');
  const [who, setWho] = useState('');
  const [status, setStatus] = useState('');
  const [person, setPerson] = useState(null);

  const staff = useMemo(() => onStaff(employees), [employees]);

  useEffect(() => { if (!monthly) setMonth(monthOf(day)); }, [day, monthly]);

  useEffect(() => {
    setLoading(true);
    const q = new URLSearchParams({ limit: '500' });
    if (monthly) {
      q.set('from', `${month}-01`);
      q.set('to', lastDay(month));
    } else {
      q.set('day', day);
    }
    if (type) q.set('visitor_type', type);
    if (who) q.set('employee_id', who);
    if (status) q.set('status', status);
    if (companyId) q.set('company_id', companyId);
    api
      .get(`/front-office/visitors?${q}`)
      .then(({ rows: got }) => setRows(got || []))
      .catch(onError)
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthly, month, day, type, who, status, companyId]);

  const kpis = useMemo(() => visitorKpis(rows, { today: todayISO() }), [rows]);
  const average = useMemo(() => averageMinutes(rows), [rows]);
  const groups = useMemo(() => breakdown(rows, by), [rows, by]);
  const label = monthly ? month : day;
  const narrowed = [
    type || 'every type',
    who ? staff.find((e) => String(e.id) === String(who))?.name : 'anybody met',
    status === 'inside' ? 'currently inside' : status === 'out' ? 'checked out' : 'any status',
  ].join(' · ');

  const printRegister = () =>
    printReport({
      title: monthly ? 'Visitor register — the month' : 'Daily visitor report',
      subtitle: `${label} · ${narrowed}`,
      meta: [
        `${kpis.total} visitor(s) · ${kpis.inside} inside · ${kpis.checked_out} checked out`,
        average === null ? 'no completed visit to average' : `average visit ${duration(average)}`,
      ],
      landscape: true,
      columns: [col('#', (_v, i) => i + 1, '3%'), ...REGISTER_COLUMNS],
      rows,
      empty: 'Nobody came.',
      footer:
        'Counted off the visitor register itself — nothing here is worked out a second time. “Never signed out” is a row nobody closed, not a visitor still in the building.',
    });

  const BREAKDOWN_COLUMNS = [
    col(VISITOR_BREAKDOWNS.find(([k]) => k === by)?.[1] || 'Group', (r) => r.name),
    num('Visitors', (r) => r.visitors),
    num('Checked out', (r) => r.checked_out),
    num('Inside', (r) => r.inside),
    col('Average visit', (r) => duration(r.average_minutes)),
  ];

  const printBreakdown = () =>
    printReport({
      title: `Visitors by ${(VISITOR_BREAKDOWNS.find(([k]) => k === by)?.[1] || '').toLowerCase()}`,
      subtitle: `${label} · ${narrowed}`,
      meta: [`${kpis.total} visitor(s) across ${groups.length} group(s)`],
      columns: [col('#', (_r, i) => i + 1, '4%'), ...BREAKDOWN_COLUMNS],
      rows: groups,
      totals: {
        label: `Total (${groups.length})`,
        Visitors: kpis.total,
        'Checked out': kpis.checked_out,
        Inside: kpis.inside,
      },
      empty: 'Nothing to group.',
      footer:
        'A visitor with nothing recorded in that column is grouped under “(not recorded)” rather than left out, so every breakdown adds up to the same total.',
    });

  return (
    <>
      <div className="toolbar">
        {monthly ? (
          <label className="field">
            Month
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
        ) : (
          <span className="muted small">{day}</span>
        )}
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Any visitor type</option>
          {VISITOR_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Anybody met</option>
          {staff.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          <option value="inside">Currently inside</option>
          <option value="out">Checked out</option>
        </select>
        <span className="grow" />
        <button className="ghost" onClick={printRegister} disabled={!rows.length}>Print</button>
        <button
          onClick={() => download(`Visitors-${label}.csv`, REGISTER_COLUMNS, rows)}
          disabled={!rows.length}
        >
          Export (Excel)
        </button>
      </div>

      <div className="card">
        <div className="fo-figures">
          <div><b>{kpis.total}</b><span>visitors</span></div>
          <div className={kpis.inside ? 'bad' : undefined}><b>{kpis.inside}</b><span>inside now</span></div>
          <div><b>{kpis.checked_out}</b><span>checked out</span></div>
          <div className={kpis.pending_checkout ? 'bad' : undefined}>
            <b>{kpis.pending_checkout}</b><span>never signed out</span>
          </div>
          {monthly && (
            <div><b>{average === null ? '—' : duration(average)}</b><span>average visit</span></div>
          )}
        </div>
        <p className="muted small">
          {loading ? 'Reading…' : `Counted off the register itself — ${rows.length} row(s) read.`}{' '}
          <strong>Never signed out</strong> is a row from an earlier day that nobody closed, not
          somebody still in the building.
        </p>
      </div>

      {monthly && (
        <div className="card">
          <div className="toolbar">
            <div className="chips">
              {VISITOR_BREAKDOWNS.map(([key, name]) => (
                <button
                  key={key}
                  className={`chip ${by === key ? 'active' : ''}`}
                  onClick={() => setBy(key)}
                >
                  {name}
                </button>
              ))}
            </div>
            <span className="grow" />
            <button className="ghost" onClick={printBreakdown} disabled={!groups.length}>Print</button>
            <button
              onClick={() => download(`Visitors-by-${by}-${month}.csv`, BREAKDOWN_COLUMNS, groups)}
              disabled={!groups.length}
            >
              Export (Excel)
            </button>
          </div>

          <table className="sheet numbered fo-table">
            <thead>
              <tr>
                <th className="row-no">#</th>
                <th className="grow">{VISITOR_BREAKDOWNS.find(([k]) => k === by)?.[1]}</th>
                <th className="num">Visitors</th>
                <th className="num">Checked out</th>
                <th className="num">Inside</th>
                <th>Average visit</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => (
                <tr key={g.name}>
                  <td className="row-no">{i + 1}</td>
                  <td>
                    {by === 'employee' && g.employee_id ? (
                      <button className="link" onClick={() => setPerson(g)}>{g.name}</button>
                    ) : (
                      g.name
                    )}
                  </td>
                  <td className="num">{g.visitors}</td>
                  <td className="num">{g.checked_out}</td>
                  <td className="num">{g.inside}</td>
                  <td className="small fo-tel">{duration(g.average_minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!groups.length ? <p className="empty fo-empty">Nobody came this month.</p> : null}
        </div>
      )}

      <div className="card scroll">
        <div className="row">
          <h3>{monthly ? 'Every visitor this month' : 'The day’s register'}</h3>
          <span className="grow" />
          <span className="muted small">{rows.length} row(s)</span>
        </div>
        <table className="sheet numbered fo-table">
          <thead>
            <tr>
              <th className="row-no">#</th>
              {REGISTER_COLUMNS.map((c) => (
                <th key={c.head} className={c.head === 'Name' ? 'grow' : undefined}>{c.head}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((v, i) => (
              <tr key={v.id} className={v.status === 'Inside' ? 'fo-in' : undefined}>
                <td className="row-no">{i + 1}</td>
                {REGISTER_COLUMNS.map((c) => (
                  <td key={c.head} className="small">{c.get(v, i)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && !loading ? <p className="empty fo-empty">Nobody came.</p> : null}
      </div>

      {person && (
        <div className="modal-backdrop" onClick={() => setPerson(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="payslip-head">
              <div>
                <h2>{person.name}</h2>
                <p className="muted">
                  {person.visitors} visitor(s) this month · average {duration(person.average_minutes) || '—'}
                </p>
              </div>
              <div className="no-print"><button onClick={() => setPerson(null)}>Close</button></div>
            </div>
            <table className="sheet fo-table">
              <thead>
                <tr><th>Date</th><th>In</th><th className="grow">Visitor</th><th>Company</th><th>Purpose</th><th>Out</th></tr>
              </thead>
              <tbody>
                {rows
                  .filter((v) => (v.meeting || '') === person.name)
                  .map((v) => (
                    <tr key={v.id}>
                      <td className="fo-tel">{v.day}</td>
                      <td className="fo-tel">{v.in_time}</td>
                      <td>{v.name}</td>
                      <td className="small">{v.company}</td>
                      <td className="small">{v.purpose}</td>
                      <td className="fo-tel">{v.out_time}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {onGoEmployee && person.employee_id ? (
              <div className="row">
                <span className="grow" />
                <button className="ghost tiny" onClick={() => onGoEmployee(person.employee_id)}>
                  open their record
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
