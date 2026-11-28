import { useEffect, useMemo, useState } from 'react';
import { STANDALONE, api, download } from '../../api.js';
import { col, printReport } from '../../printReport.js';
import { rupees } from '../../format.js';
import Glyph from '../../icons.jsx';
import { onStaff } from '../../onStaff.js';
import { todayIso } from '../../../../shared/today.js';
import { LICENSE_KINDS, LICENSE_TERMS, fieldWords } from '../../../../shared/licenses.js';
import {
  CATEGORIES,
  calendarEvents,
  categoryOf,
  costOf,
  costSummary,
  financialYear,
  renewalStatus,
  stepLabel,
} from '../../../../shared/renewals.js';
import { monthWeeks } from '../../../../shared/monthGrid.js';
import { LicencePage } from './Licenses.jsx';

/**
 * RENEWAL MANAGEMENT (v2.40.0) - the License tab, redesigned.
 *
 * Licences, rent agreements and insurance policies have lived on one table
 * since v2.35.0; this gives each its own register and puts an Overview,
 * a calendar, cost reports and the reminder settings around them. Every
 * figure is worked out from the register (shared/renewals.js) - there is no
 * second store to disagree with it. A record opens the existing record page,
 * which now carries the renewal workflow.
 */
const SECTIONS = [
  ['overview', 'Overview'],
  ['software', 'Licenses & Subscriptions'],
  ['rent', 'Rent Agreements'],
  ['insurance', 'Insurance Policies'],
  ['calendar', 'Renewal Calendar'],
  ['reports', 'Reports'],
  ['settings', 'Settings'],
];

const fmt = (iso) =>
  iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const cycle = (m) => (!m ? '—' : Number(m) === 1 ? 'Monthly' : Number(m) === 3 ? 'Quarterly' : Number(m) === 6 ? 'Half-yearly' : Number(m) === 12 ? 'Yearly' : `Every ${m} months`);
const payLabel = { paid: 'Paid', pending: 'Pending', overdue: 'Overdue' };

function Status({ row }) {
  const s = renewalStatus(row);
  return <span className={`pill pr-${s.tone}`}>{s.label}</span>;
}

/* ---------------------------- the columns ---------------------------- */

const COLUMNS = {
  software: [
    ['name', 'Name', (r) => r.name, (r) => r.name],
    ['kind', 'Category', (r) => r.kind || '—'],
    ['vendor', 'Vendor', (r) => r.vendor || r.publisher || '—'],
    ['company', 'Company', (r) => r.company_name || '—'],
    ['starts', 'Start', (r) => fmt(r.starts_on || r.purchased_on), (r) => r.starts_on || r.purchased_on || ''],
    ['expires', 'Expiry / renewal', (r) => fmt(r.expires_on), (r) => r.expires_on || ''],
    ['amount', 'Amount', (r) => (r.cost ? rupees(r.cost) : '—'), (r) => Number(r.cost) || 0, 'num'],
    ['cycle', 'Billing cycle', (r) => (r.term === 'perpetual' ? 'One-time' : cycle(r.renew_every_months))],
    ['seats', 'Seats used / bought', (r) => (r.seat_use?.counted ? `${r.seat_use.used} / ${r.seat_use.seats}` : '—'), null, 'num'],
    ['auto', 'Renewal type', (r) => (Number(r.auto_renew) === 1 ? 'Auto' : 'Manual')],
    ['payment', 'Payment', (r) => payLabel[r.payment_status] || '—'],
    ['documents', 'Documents', (r) => (Number(r.documents) ? `📎 ${r.documents}` : '—'), (r) => Number(r.documents) || 0, 'num'],
    ['responsible', 'Responsible', (r) => r.responsible_name || '—'],
    ['documents', 'Documents', (r) => (Number(r.documents) ? `📎 ${r.documents}` : '—'), (r) => Number(r.documents) || 0, 'num'],
  ],
  rent: [
    ['name', 'Agreement / premises', (r) => r.name, (r) => r.name],
    ['company', 'Company', (r) => r.company_name || '—'],
    ['address', 'Property address', (r) => r.property_address || '—'],
    ['landlord', 'Landlord', (r) => r.publisher || '—'],
    ['starts', 'Start', (r) => fmt(r.starts_on || r.purchased_on), (r) => r.starts_on || r.purchased_on || ''],
    ['expires', 'End', (r) => fmt(r.expires_on), (r) => r.expires_on || ''],
    ['amount', 'Monthly rent', (r) => (r.cost ? rupees(r.cost) : '—'), (r) => Number(r.cost) || 0, 'num'],
    ['deposit', 'Deposit', (r) => (r.security_deposit ? rupees(r.security_deposit) : '—'), (r) => Number(r.security_deposit) || 0, 'num'],
    ['lockin', 'Lock-in', (r) => (r.lock_in_months ? `${r.lock_in_months} mo` : '—')],
    ['notice', 'Notice', (r) => (r.notice_days ? `${r.notice_days} d` : '—')],
    ['escalation', 'Escalation', (r) => (r.escalation_pct ? `${r.escalation_pct}%` : '—')],
    ['responsible', 'Responsible', (r) => r.responsible_name || '—'],
    ['documents', 'Documents', (r) => (Number(r.documents) ? `📎 ${r.documents}` : '—'), (r) => Number(r.documents) || 0, 'num'],
  ],
  insurance: [
    ['name', 'Policy', (r) => r.name, (r) => r.name],
    ['number', 'Policy no.', (r) => r.invoice_no || '—'],
    ['insurer', 'Insurer', (r) => r.publisher || '—'],
    ['company', 'Company', (r) => r.company_name || '—'],
    ['type', 'Policy type', (r) => r.policy_type || '—'],
    ['insured', 'Insured property / asset', (r) => r.insured_item || '—'],
    ['coverage', 'Coverage', (r) => (r.coverage_amount ? rupees(r.coverage_amount) : '—'), (r) => Number(r.coverage_amount) || 0, 'num'],
    ['amount', 'Premium', (r) => (r.cost ? rupees(r.cost) : '—'), (r) => Number(r.cost) || 0, 'num'],
    ['starts', 'Start', (r) => fmt(r.starts_on || r.purchased_on), (r) => r.starts_on || r.purchased_on || ''],
    ['expires', 'Expiry', (r) => fmt(r.expires_on), (r) => r.expires_on || ''],
    ['payment', 'Payment', (r) => payLabel[r.payment_status] || '—'],
    ['responsible', 'Responsible', (r) => r.responsible_name || '—'],
  ],
};

const DEFAULT_HIDDEN = { software: ['starts', 'company'], rent: ['starts', 'lockin', 'notice'], insurance: ['starts', 'company'] };

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function saveCsv(name, columns, rows) {
  const lines = [
    ['#', ...columns.map((c) => c[1]), 'Status'].map(csvCell).join(','),
    ...rows.map((r, i) => [i + 1, ...columns.map((c) => c[2](r)), renewalStatus(r).label].map(csvCell).join(',')),
  ];
  const blob = new Blob([`﻿${lines.join('\n')}\n`], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ----------------------------- the module ----------------------------- */

export default function Renewals({ employees = [], companies = [], companyId, onError }) {
  // A record being copied into a new one (Copy as new on its page).
  const [copyFrom, setCopyFrom] = useState(null);
  const [section, setSection] = useState('overview');
  const [rows, setRows] = useState(null);
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(null);

  const load = async () => {
    try {
      const q = companyId ? `?company_id=${companyId}` : '';
      const [reg, over] = await Promise.all([api.get(`/people/licenses${q}`), api.get(`/people/licenses/overview${q}`)]);
      setRows(reg.licenses || []);
      setData(over);
    } catch (err) {
      onError(err);
    }
  };
  useEffect(() => {
    if (!STANDALONE) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  if (STANDALONE) {
    return (
      <div className="card">
        <p className="ask">This one needs the server.</p>
        <p className="muted small">
          A licence key is the most sensitive thing in this app; on the server it is never sent to a screen. In a single
          file on a laptop anyone holding the file would hold every key in it.
        </p>
      </div>
    );
  }

  return (
    <section className="stack rn">
      <div className="sub-tabs toolbar rn-sections">
        {SECTIONS.map(([key, label]) => (
          <button key={key} className={section === key ? 'active' : undefined} onClick={() => setSection(key)}>
            {label}
            {key !== 'overview' && rows && CATEGORIES.some((c) => c.key === key) ? (
              <span className="rn-count">{rows.filter((r) => !r.cancelled_on && categoryOf(r) === key).length}</span>
            ) : null}
          </button>
        ))}
        <span className="push-right">
          <button className="primary" onClick={() => setAdding(CATEGORIES.some((c) => c.key === section) ? section : 'software')}>
            + Add {CATEGORIES.find((c) => c.key === section)?.noun || 'record'}
          </button>
        </span>
      </div>

      {!rows || !data ? (
        <p className="loading">Loading…</p>
      ) : !rows.length ? (
        <EmptyState onAdd={setAdding} />
      ) : section === 'overview' ? (
        <Overview data={data} rows={rows} onOpen={setOpen} onSection={setSection} />
      ) : CATEGORIES.some((c) => c.key === section) ? (
        <Register
          key={section}
          category={section}
          rows={rows.filter((r) => categoryOf(r) === section)}
          employees={employees}
          onOpen={setOpen}
          onAdd={() => setAdding(section)}
          onReload={load}
          onError={onError}
        />
      ) : section === 'calendar' ? (
        <Calendar rows={rows} onOpen={setOpen} />
      ) : section === 'reports' ? (
        <Reports rows={rows} onOpen={setOpen} />
      ) : (
        <Settings onError={onError} />
      )}

      {adding ? (
        <AddRecord
          category={adding}
          from={copyFrom}
          companies={companies}
          employees={employees}
          companyId={companyId}
          onClose={() => { setAdding(null); setCopyFrom(null); }}
          onSaved={async (made) => {
            setAdding(null);
            setCopyFrom(null);
            await load();
            setOpen(made.id);
          }}
          onError={onError}
        />
      ) : null}

      {open ? (
        <LicencePage
          id={open}
          employees={employees}
          companies={companies}
          canApprove={Boolean(data?.can_approve)}
          onClose={() => setOpen(null)}
          onChanged={load}
          onError={onError}
          onCopy={(record) => {
            setOpen(null);
            setCopyFrom(record);
            setAdding(categoryOf(record));
          }}
        />
      ) : null}
    </section>
  );
}

/* ---------------------------- empty state ---------------------------- */

function EmptyState({ onAdd }) {
  return (
    <div className="card rn-empty">
      <span className="rn-empty-icon"><Glyph name="license" size={34} /></span>
      <h3>Nothing to renew yet</h3>
      <p className="muted">
        Put your software licences, office rent agreements and insurance policies here, and the Overview will tell you
        what runs out next — 90, 60, 30 and 7 days ahead — what it will cost, and who is seeing to it.
      </p>
      <div className="row rn-empty-actions">
        <button className="primary" onClick={() => onAdd('software')}>Add a licence</button>
        <button onClick={() => onAdd('rent')}>Add a rent agreement</button>
        <button onClick={() => onAdd('insurance')}>Add an insurance policy</button>
      </div>
      <p className="muted small">Bringing a list from Excel? Add the first one here; a spreadsheet import can be added if the list is long.</p>
    </div>
  );
}

/* ------------------------------ overview ------------------------------ */

function MiniList({ title, rows, empty, onOpen, right }) {
  return (
    <div className="card ao-list">
      <h4>{title}</h4>
      {!rows.length ? (
        <p className="muted small">{empty}</p>
      ) : (
        <ul>
          {rows.slice(0, 6).map((r) => (
            <li key={r.id}>
              <span className={`rn-dot cat-${categoryOf(r)}`} />
              <button type="button" className="link ao-list-what" onClick={() => onOpen(r.id)}>{r.name}</button>
              <span className="ao-list-right">{right(r)}</span>
            </li>
          ))}
          {rows.length > 6 ? <li className="muted small">and {rows.length - 6} more</li> : null}
        </ul>
      )}
    </div>
  );
}

const leftText = (d) => (d === null || d === undefined ? '' : d < 0 ? `${-d}d overdue` : d === 0 ? 'today' : `in ${d}d`);

function Overview({ data, rows, onOpen, onSection }) {
  const o = data.overview;
  const cost = o.cost;
  const today = todayIso();
  const [y, m] = today.split('-').map(Number);
  const events = calendarEvents(rows, y, m);
  const kpis = [
    ['license', 'Active contracts', o.active, 'licences, rent and insurance', 'navy', () => onSection('software')],
    ['bell', 'Due in 30 days', o.due30, 'renewal or expiry', 'orange', () => onSection('calendar')],
    ['calendar', 'Due in 60 days', o.due60, 'including the 30', 'blue', () => onSection('calendar')],
    ['alert', 'Expired', o.expired, 'past their date, not cancelled', 'red', () => onSection('software')],
    ['rupee', 'Pending payments', o.pending_payments, rupees(cost.pending_payment), 'orange', () => onSection('reports')],
    ['bars', 'Annual cost', rupees(cost.yearly), `${rupees(cost.monthly)} a month`, 'navy', () => onSection('reports')],
  ];
  const alerts = [
    ['Due within 7 days', o.urgent, 'bad'],
    ['Due within 30 days', o.upcoming.filter((r) => r.days_left <= 30), 'warn'],
    ['Expired', o.expired_rows, 'bad'],
    ['Waiting for approval', o.pending_approval_rows, 'warn'],
    ['Waiting for payment', o.pending_payment_rows, 'warn'],
    ['Auto-renewing within 30 days', o.auto_soon, 'info'],
  ].filter(([, list]) => list.length);
  const maxCat = Math.max(1, ...CATEGORIES.map((c) => cost.by_category[c.key].yearly));
  return (
    <>
      <div className="ao-kpis rn-kpis">
        {kpis.map(([icon, label, n, hint, tone, go]) => (
          <button key={label} type="button" className={`ao-kpi tone-${tone}`} onClick={go}>
            <span className="ao-kpi-icon"><Glyph name={icon} size={18} /></span>
            <span className="ao-kpi-text">
              <span className="k">{label}</span>
              <span className="n">{n}</span>
              <span className="h">{hint}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="card rn-alerts">
        <div className="row-between">
          <h4>Alerts</h4>
          {data.fresh_reminders ? <span className="pill pr-warn">{data.fresh_reminders} new reminder{data.fresh_reminders === 1 ? '' : 's'}</span> : null}
        </div>
        {!alerts.length ? (
          <p className="muted small">Nothing needs doing — nothing due within 30 days, nothing expired, nothing waiting.</p>
        ) : (
          <ul className="rn-alert-list">
            {alerts.map(([label, list, tone]) => (
              <li key={label}>
                <span className={`pill pr-${tone}`}>{list.length}</span> <strong>{label}</strong>{' '}
                <span className="muted small">
                  {list.slice(0, 4).map((r, i) => (
                    <span key={r.id}>
                      {i ? ', ' : '— '}
                      <button type="button" className="link" onClick={() => onOpen(r.id)}>{r.name}</button>
                    </span>
                  ))}
                  {list.length > 4 ? ` and ${list.length - 4} more` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="ao-grid lists">
        <MiniList title="Urgent — within 7 days" rows={o.urgent} empty="Nothing due this week." onOpen={onOpen}
          right={(r) => <span className="pill pr-bad">{leftText(r.days_left)}</span>} />
        <MiniList title="Upcoming renewals" rows={o.upcoming} empty="Nothing due in the next 60 days." onOpen={onOpen}
          right={(r) => <span className={`pill ${r.days_left <= 30 ? 'pr-warn' : 'pr-info'}`}>{fmt(r.expires_on)} · {leftText(r.days_left)}</span>} />
        <MiniList title="Expired" rows={o.expired_rows} empty="Nothing has run out." onOpen={onOpen}
          right={(r) => <span className="pill pr-bad">{leftText(r.days_left)}</span>} />
        <MiniList title="Pending payments" rows={o.pending_payment_rows} empty="Nothing waiting to be paid." onOpen={onOpen}
          right={(r) => <span className="small">{rupees(r.proposed_cost || r.cost || 0)}</span>} />
        <div className="card ao-chart">
          <h4>Annual cost by category</h4>
          <ul className="ao-bars">
            {CATEGORIES.map((c) => (
              <li key={c.key}>
                <button type="button" className="ao-bar-row" onClick={() => onSection(c.key)}>
                  <span className="ao-bar-label">{c.label}</span>
                  <span className="ao-bar-track"><i className={`cat-${c.key}`} style={{ width: `${(cost.by_category[c.key].yearly / maxCat) * 100}%` }} /></span>
                  <span className="ao-bar-n">{rupees(cost.by_category[c.key].yearly)}</span>
                </button>
              </li>
            ))}
          </ul>
          {cost.unknown ? <p className="muted small">{cost.unknown} without a cost or a billing cycle are not counted.</p> : null}
        </div>
        <div className="card ao-chart">
          <h4>Renewals by category</h4>
          <ul className="ao-legend">
            {o.by_category.map((c) => (
              <li key={c.key}>
                <b className={`cat-${c.key}`} />
                {c.label} <strong>{c.n}</strong> <span className="muted">· {c.due} due in 60 days</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card ao-list">
          <div className="row-between">
            <h4>This month</h4>
            <button className="link" onClick={() => onSection('calendar')}>Calendar →</button>
          </div>
          {!events.length ? (
            <p className="muted small">Nothing falls due this month.</p>
          ) : (
            <ul>
              {events.slice(0, 7).map((e, i) => (
                <li key={`${e.id}-${i}`}>
                  <span className={`rn-ev-day tone-${e.tone}`}>{e.day}</span>
                  <button type="button" className="link ao-list-what" onClick={() => onOpen(e.id)}>{e.name}</button>
                  <span className="ao-list-right muted small">{e.what}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card ao-list">
          <h4>Recent activity</h4>
          {!data.activity.length ? (
            <p className="muted small">Nothing yet.</p>
          ) : (
            <ul className="rn-activity">
              {data.activity.map((a) => (
                <li key={a.id}>
                  <span className="ao-list-what">
                    <button type="button" className="link" onClick={() => onOpen(a.entity_id)}>{a.label}</button>{' '}
                    <span className="muted small">
                      {a.action}{a.field ? ` ${a.field}` : ''}{a.to_value ? ` → ${a.to_value}` : ''}
                    </span>
                  </span>
                  <span className="ao-list-right muted small">{a.who || 'office'} · {String(a.at || a.created_at || '').slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

/* ------------------------------ register ------------------------------ */

function Register({ category, rows, employees, onOpen, onAdd, onReload, onError }) {
  const columns = COLUMNS[category];
  const [query, setQuery] = useState('');
  const [f, setF] = useState({ status: '', vendor: '', auto: '', payment: '', responsible: '', kind: '' });
  const [sort, setSort] = useState({ key: 'expires', dir: 1 });
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [ticked, setTicked] = useState(() => new Set());
  const storeKey = `salary-app-renewal-cols-${category}`;
  const [hidden, setHidden] = useState(() => {
    try {
      const saved = localStorage.getItem(storeKey);
      // Nothing chosen yet: start with the start date hidden, so the register
      // fits a laptop without scrolling sideways. One tick brings it back.
      return new Set(saved ? JSON.parse(saved) : DEFAULT_HIDDEN[category] || []);
    } catch {
      return new Set(DEFAULT_HIDDEN[category] || []);
    }
  });
  const toggle = (key) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHidden(next);
    try {
      localStorage.setItem(storeKey, JSON.stringify([...next]));
    } catch {
      /* private window */
    }
  };
  const visible = columns.filter((c) => c[0] === 'name' || !hidden.has(c[0]));
  const vendors = useMemo(() => [...new Set(rows.map((r) => r.vendor || r.publisher).filter(Boolean))].sort(), [rows]);
  const kinds = useMemo(() => [...new Set(rows.map((r) => r.kind).filter(Boolean))].sort(), [rows]);
  const people = useMemo(() => [...new Map(rows.filter((r) => r.responsible_id).map((r) => [r.responsible_id, r.responsible_name])).entries()], [rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => (f.status === 'cancelled' ? Boolean(r.cancelled_on) : !r.cancelled_on))
      .filter((r) => !f.status || f.status === 'cancelled' || renewalStatus(r).key === f.status)
      .filter((r) => !f.vendor || (r.vendor || r.publisher) === f.vendor)
      .filter((r) => !f.kind || r.kind === f.kind)
      .filter((r) => !f.auto || String(Number(r.auto_renew) === 1 ? 1 : 0) === f.auto)
      .filter((r) => !f.payment || (r.payment_status || 'none') === f.payment)
      .filter((r) => !f.responsible || String(r.responsible_id) === f.responsible)
      .filter(
        (r) =>
          !q ||
          [r.name, r.kind, r.vendor, r.publisher, r.company_name, r.responsible_name, r.invoice_no, r.key_tail, r.property_address, r.insured_item, r.account_email]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q))
      );
  }, [rows, query, f]);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c[0] === sort.key);
    const value = col?.[3] || col?.[2] || ((r) => r.name);
    return [...shown].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      if (x === y) return a.id - b.id;
      if (x === '' || x === null) return 1;
      if (y === '' || y === null) return -1;
      return (x > y ? 1 : -1) * sort.dir;
    });
  }, [shown, sort, columns]);
  useEffect(() => setPage(1), [query, f, size]);
  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const at = Math.min(page, pages);
  const paged = sorted.slice((at - 1) * size, at * size);
  const active = Object.entries(f).filter(([, v]) => v);

  /* The same PATCH the record page sends, one record at a time, for every
     ticked row - so no rule is skipped by doing several at once. */
  const bulk = async (body, question) => {
    if (!window.confirm(question)) return;
    try {
      for (const id of ticked) await api.patch(`/people/licenses/${id}`, body);
      setTicked(new Set());
      await onReload();
    } catch (err) {
      onError(err);
    }
  };
  const markPaid = () => bulk({ payment_status: 'paid' }, `Mark ${ticked.size} as paid?`);
  const [importing, setImporting] = useState(false);
  const printIt = () =>
    printReport({
      title: `${CATEGORIES.find((c) => c.key === category)?.label || 'Register'}`,
      subtitle: [
        query ? `matching “${query}”` : '',
        ...Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
      ].filter(Boolean).join(' · ') || 'everything on the register',
      meta: [`${sorted.length} ${sorted.length === 1 ? 'record' : 'records'}`],
      landscape: true,
      compact: true,
      columns: [col('#', (_r, i) => i + 1, '3%'), ...visible.map((c) => col(c[1], (r) => c[2](r))), col('Status', (r) => renewalStatus(r).label)],
      rows: sorted,
      footer: 'A blank end date means not known — never expired. Cancelled records are not on this list unless the status filter asks for them.',
    });

  const label = CATEGORIES.find((c) => c.key === category);
  return (
    <div className="card rn-register">
      <div className="toolbar rn-filterbar">
        <input className="search" placeholder="Search name, vendor, key ending, person, company…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="upcoming">Upcoming (60 days)</option>
          <option value="review">Review required</option>
          <option value="pending_approval">Pending approval</option>
          <option value="pending_payment">Pending payment</option>
          <option value="expired">Expired</option>
          <option value="no_date">No end date</option>
          <option value="cancelled">Cancelled</option>
        </select>
        {category === 'software' ? (
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="Category">
            <option value="">Any category</option>
            {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        ) : null}
        <select value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} aria-label="Vendor">
          <option value="">{category === 'rent' ? 'Any landlord' : category === 'insurance' ? 'Any insurer' : 'Any vendor'}</option>
          {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={f.payment} onChange={(e) => setF({ ...f, payment: e.target.value })} aria-label="Payment">
          <option value="">Any payment</option>
          <option value="paid">Paid</option>
          <option value="pending">Pending</option>
          <option value="overdue">Overdue</option>
          <option value="none">Not said</option>
        </select>
        <select value={f.auto} onChange={(e) => setF({ ...f, auto: e.target.value })} aria-label="Renewal type">
          <option value="">Auto or manual</option>
          <option value="1">Auto-renews</option>
          <option value="0">Manual</option>
        </select>
        <select value={f.responsible} onChange={(e) => setF({ ...f, responsible: e.target.value })} aria-label="Responsible">
          <option value="">Anybody responsible</option>
          {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        {active.length ? <button className="ghost small" onClick={() => setF({ status: '', vendor: '', auto: '', payment: '', responsible: '', kind: '' })}>Reset filters</button> : null}
      </div>

      <div className="row-between rn-under">
        <span className="muted small">{shown.length} of {rows.filter((r) => !r.cancelled_on).length} {label.label.toLowerCase()}</span>
        <span className="row">
          {ticked.size ? (
            <>
              <button className="small" onClick={markPaid}>Mark {ticked.size} paid</button>
              <button className="ghost small" onClick={() => bulk({ payment_status: 'pending' }, `Mark ${ticked.size} as payment pending?`)}>Payment pending</button>
              <select
                className="rn-bulk-who"
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  const person = employees.find((x) => String(x.id) === e.target.value);
                  bulk({ responsible_id: Number(e.target.value) }, `Make ${person?.name || 'them'} responsible for ${ticked.size}?`);
                }}
                aria-label="Set who is responsible for the ticked records"
              >
                <option value="">Set responsible…</option>
                {onStaff(employees).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </>
          ) : null}
          <button className="ghost small" onClick={() => saveCsv(`${category}-register.csv`, visible, sorted)} disabled={!sorted.length}>Export CSV</button>
          <button className="ghost small" onClick={printIt} disabled={!sorted.length}>Print</button>
          {!STANDALONE && <button className="ghost small" onClick={() => setImporting(true)}>Import from Excel</button>}
          <details className="menu-more">
            <summary className="ghost">Columns ▾</summary>
            <div className="menu-more-list">
              {columns.filter((c) => c[0] !== 'name').map((c) => (
                <label key={c[0]} className="check">
                  <input type="checkbox" checked={!hidden.has(c[0])} onChange={() => toggle(c[0])} /> {c[1]}
                </label>
              ))}
            </div>
          </details>
        </span>
      </div>

      {!rows.length ? (
        <div className="rn-empty small-empty">
          <span className="rn-empty-icon"><Glyph name="license" size={26} /></span>
          <p><strong>No {label.noun}s yet.</strong> Add the first one and its renewal is tracked from today.</p>
          <button className="primary" onClick={onAdd}>Add a {label.noun}</button>
        </div>
      ) : !shown.length ? (
        <p className="muted small">Nothing matches. <button className="link" onClick={() => { setQuery(''); setF({ status: '', vendor: '', auto: '', payment: '', responsible: '', kind: '' }); }}>Clear the search and filters</button></p>
      ) : (
        <div className="table-wrap">
          <table className="sheet rn-table">
            <thead>
              <tr>
                <th className="rn-tick">
                  <input type="checkbox" checked={shown.every((r) => ticked.has(r.id))} onChange={(e) => setTicked(e.target.checked ? new Set(shown.map((r) => r.id)) : new Set())} aria-label="Tick all" />
                </th>
                {visible.map((c) => (
                  <th key={c[0]} className={c[4] === 'num' ? 'num' : undefined} aria-sort={sort.key === c[0] ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="th-sort" onClick={() => setSort((s) => ({ key: c[0], dir: s.key === c[0] ? -s.dir : 1 }))}>
                      {c[1]}<span className="th-arrow">{sort.key === c[0] ? (sort.dir > 0 ? '▲' : '▼') : '↕'}</span>
                    </button>
                  </th>
                ))}
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {paged.map((r) => (
                <tr key={r.id}>
                  <td className="rn-tick">
                    <input type="checkbox" checked={ticked.has(r.id)} onChange={(e) => {
                      const next = new Set(ticked);
                      if (e.target.checked) next.add(r.id);
                      else next.delete(r.id);
                      setTicked(next);
                    }} />
                  </td>
                  {visible.map((c) => (
                    <td key={c[0]} className={c[4] === 'num' ? 'num' : undefined}>
                      {c[0] === 'name' ? (
                        <button type="button" className="link name-link" onClick={() => onOpen(r.id)}>{r.name}</button>
                      ) : (
                        c[2](r)
                      )}
                    </td>
                  ))}
                  <td><Status row={r} /></td>
                  <td><button className="ghost small" onClick={() => onOpen(r.id)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shown.length > 0 ? (
        <div className="asset-pager">
          <span className="muted small">Showing {(at - 1) * size + 1}–{Math.min(at * size, sorted.length)} of {sorted.length}</span>
          <span className="grow" />
          <button className="ghost small" disabled={at <= 1} onClick={() => setPage(at - 1)}>‹</button>
          <span className="small">Page {at} of {pages}</span>
          <button className="ghost small" disabled={at >= pages} onClick={() => setPage(at + 1)}>›</button>
          <select value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Rows per page">
            {[25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
        </div>
      ) : null}
      <p className="muted small">
        Open a record to edit it, renew it (review → approval → payment → renewed), cancel it, attach its documents, copy
        it as a new one, or see its history. Cancelling keeps the record; renewing keeps the old term in the history.
      </p>
      {importing && (
        <ImportDialog
          category={category}
          onClose={() => setImporting(false)}
          onDone={async () => {
            setImporting(false);
            await onReload();
          }}
        />
      )}
    </div>
  );
}

/**
 * Bring a register in from Excel or CSV (v2.47.0). Look first, then write -
 * the second press sends the same file again, so the plan approved is the
 * plan that runs. Licence keys are never read from a sheet.
 */
function ImportDialog({ category, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [plan, setPlan] = useState(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [alsoSimilar, setAlsoSimilar] = useState(false);
  const label = CATEGORIES.find((c) => c.key === category);
  const send = async (write) => {
    if (!file) return;
    setBusy(true);
    setProblem('');
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('as', category);
      form.set('write', String(write));
      form.set('include_similar', String(alsoSimilar));
      const got = await api.upload('/people/licenses/import', form);
      if (write) {
        window.alert(`${got.wrote} ${got.wrote === 1 ? 'record' : 'records'} added.`);
        await onDone();
        return;
      }
      setPlan(got);
    } catch (err) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide rn-import" onClick={(e) => e.stopPropagation()}>
        <div className="late-head">
          <div>
            <h3>Import {label?.label?.toLowerCase() || 'records'} from Excel</h3>
            <p className="muted small">
              An .xlsx or .csv. Columns are matched on what they are called — Name / Software / Policy, Expiry, Cost,
              Company, Vendor and the rest. Nothing is written until you have seen what would be.
            </p>
          </div>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
        <div className="row">
          <input type="file" accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] || null); setPlan(null); }} />
          <button disabled={!file || busy} onClick={() => send(false)}>{busy && !plan ? 'Reading…' : 'Look first'}</button>
          <button className="ghost small" onClick={() => download('/people/licenses/import-template.csv', 'licence-import-template.csv')}>
            Download a blank template
          </button>
        </div>
        <p className="muted small">
          <strong>Licence keys are not imported</strong>, even if the sheet has a key column — a key is typed on the record,
          so it is never shown on a screen like this one.
        </p>
        {problem && <p className="lic-alert warn">{problem}</p>}
        {plan && (
          <>
            <p>
              <strong>{plan.create.length}</strong> to add
              {plan.skipped.length ? <>, <strong>{plan.skipped.length}</strong> left out (named below)</> : ''}. Header found on
              row {plan.header_row}{plan.sheet ? ` of “${plan.sheet}”` : ''}.
            </p>
            {plan.notes.map((n) => <p key={n} className="lic-alert warn">{n}</p>)}
            {plan.create.length > 0 && (
              <div className="table-wrap rn-import-list">
                <table className="sheet">
                  <thead>
                    <tr><th>Row</th><th>Name</th><th>Type</th><th>Company</th><th>Ends</th><th className="num">Cost</th></tr>
                  </thead>
                  <tbody>
                    {plan.create.slice(0, 200).map((r) => (
                      <tr key={r.line}>
                        <td className="muted small">{r.line}</td>
                        <td>{r.name}</td>
                        <td className="small">{r.kind}</td>
                        <td className="small">{r.company_name || '—'}</td>
                        <td className="small">{r.expires_on || 'no date'}</td>
                        <td className="num">{r.cost !== null ? rupees(r.cost) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {plan.similar?.length > 0 && (
              <div className="lic-alert warn">
                <strong>{plan.similar.length} look like a record already on the register</strong> — same name and company,
                a different end date. That is usually the same licence a term later: renew the existing record rather than
                adding a second one.
                <ul className="small rn-import-skips">
                  {plan.similar.map((r) => (
                    <li key={r.line}>Row {r.line} — {r.name}: ends {r.expires_on || 'no date'}; the one here ends {r.existing_expires_on || 'no date'}</li>
                  ))}
                </ul>
                <label className="check"><input type="checkbox" checked={alsoSimilar} onChange={(e) => setAlsoSimilar(e.target.checked)} /> Add these as separate records anyway</label>
              </div>
            )}
            {plan.skipped.length > 0 && (
              <ul className="small rn-import-skips">
                {plan.skipped.map((x) => <li key={x.line}>Row {x.line}{x.name ? ` — ${x.name}` : ''}: {x.why}</li>)}
              </ul>
            )}
            <button className="primary" disabled={busy || !(plan.create.length + (alsoSimilar ? plan.similar?.length || 0 : 0))} onClick={() => send(true)}>
              {busy ? 'Adding…' : `Add ${plan.create.length + (alsoSimilar ? plan.similar?.length || 0 : 0)}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ add a record ------------------------------ */

function AddRecord({ category, from = null, companies, employees, companyId, onClose, onSaved, onError }) {
  const kind = category === 'rent' ? 'Rent agreement' : category === 'insurance' ? 'Insurance policy' : 'Accounting software';
  const [d, setD] = useState({
    kind,
    name: '',
    publisher: '',
    company_id: companyId || '',
    term: 'subscription',
    starts_on: todayIso(),
    purchased_on: todayIso(),
    expires_on: '',
    cost: '',
    renew_every_months: category === 'rent' ? 11 : 12,
    vendor: '',
    invoice_no: '',
    responsible_id: '',
    auto_renew: 0,
    payment_status: '',
    seats: '',
    key: '',
    property_address: '',
    security_deposit: '',
    lock_in_months: '',
    notice_days: '',
    escalation_pct: '',
    policy_type: '',
    insured_item: '',
    coverage_amount: '',
    note: '',
    /*
     * COPY AS NEW: the same thing again - next year's policy, the same rent
     * for another branch. What carries over is what is still true; what does
     * not is what belongs to the old term: no key, no invoice, no end date,
     * no payment, and it starts the day the old one ended.
     */
    ...(from
      ? (() => {
          const keep = {};
          for (const k of ['kind', 'name', 'publisher', 'company_id', 'term', 'cost', 'renew_every_months', 'vendor',
            'responsible_id', 'auto_renew', 'seats', 'property_address', 'security_deposit', 'lock_in_months',
            'notice_days', 'escalation_pct', 'policy_type', 'insured_item', 'coverage_amount']) {
            if (from[k] !== null && from[k] !== undefined) keep[k] = from[k];
          }
          const start = from.expires_on || todayIso();
          return { ...keep, starts_on: start, purchased_on: start, note: `Copied from ${from.name}${from.expires_on ? `, which ended ${from.expires_on}` : ''}.` };
        })()
      : {}),
  });
  const [busy, setBusy] = useState(false);
  const words = fieldWords(d.kind);
  const set = (k) => (e) => setD({ ...d, [k]: e.target.value });
  const box = (k, label, props = {}) => (
    <label className="vf-field" key={k}>
      <span className="vf-label">{label}</span>
      <input value={d[k]} onChange={set(k)} {...props} />
    </label>
  );
  const save = async () => {
    setBusy(true);
    try {
      const made = await api.post('/people/licenses', { ...d, purchased_on: d.starts_on || d.purchased_on });
      await onSaved(made);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal pr-modal" role="dialog" onClick={(e) => e.stopPropagation()}>
        <header className="rr-head">
          <h3>{from ? `New ${CATEGORIES.find((c) => c.key === category)?.noun}, copied from ${from.name}` : `Add ${CATEGORIES.find((c) => c.key === category)?.noun}`}</h3>
          <button className="ghost" onClick={onClose}>×</button>
        </header>
        <div className="vf-grid">
          {box('name', `${words.name} *`, { placeholder: words.namePlaceholder })}
          {category === 'software' ? (
            <label className="vf-field">
              <span className="vf-label">Category</span>
              <select value={d.kind} onChange={set('kind')}>
                {LICENSE_KINDS.filter((k) => k !== 'Rent agreement' && k !== 'Insurance policy').map((k) => <option key={k}>{k}</option>)}
              </select>
            </label>
          ) : null}
          {box('publisher', words.publisher, { placeholder: words.publisherPlaceholder })}
          <label className="vf-field">
            <span className="vf-label">Company</span>
            <select value={d.company_id} onChange={set('company_id')}>
              <option value="">—</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {category === 'software' ? (
            <label className="vf-field">
              <span className="vf-label">Held as</span>
              <select value={d.term} onChange={set('term')}>
                {LICENSE_TERMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          ) : null}
          {box('starts_on', 'Start date', { type: 'date' })}
          {box('expires_on', words.expires, { type: 'date' })}
          {box('cost', `${words.cost} (₹)`, { inputMode: 'decimal' })}
          {category !== 'rent' ? (
            <label className="vf-field">
              <span className="vf-label">Billing cycle</span>
              <select value={d.renew_every_months} onChange={set('renew_every_months')}>
                {[[1, 'Monthly'], [3, 'Quarterly'], [6, 'Half-yearly'], [12, 'Yearly'], [24, 'Every 2 years'], [36, 'Every 3 years']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          ) : box('renew_every_months', 'Agreement length (months)', { inputMode: 'numeric' })}
          {box('invoice_no', words.invoice)}
          {box('vendor', words.vendor)}
          {category === 'software' ? box('seats', 'Seats bought', { inputMode: 'numeric', placeholder: 'blank = not counted' }) : null}
          {category === 'software' ? box('key', 'Licence key', { autoComplete: 'off' }) : null}
          {category === 'rent' ? (
            <>
              {box('property_address', 'Property address')}
              {box('security_deposit', 'Security deposit (₹)', { inputMode: 'decimal' })}
              {box('lock_in_months', 'Lock-in (months)', { inputMode: 'numeric' })}
              {box('notice_days', 'Notice period (days)', { inputMode: 'numeric' })}
              {box('escalation_pct', 'Rent escalation (%)', { inputMode: 'decimal' })}
            </>
          ) : null}
          {category === 'insurance' ? (
            <>
              <label className="vf-field">
                <span className="vf-label">Policy type</span>
                <select value={d.policy_type} onChange={set('policy_type')}>
                  <option value="">—</option>
                  {['Fire', 'Office package', 'Group health', 'Group term life', 'Vehicle', 'Electronic equipment', 'Public liability', 'Marine / transit', 'Other'].map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>
              {box('insured_item', 'Insured property / asset')}
              {box('coverage_amount', 'Coverage (₹)', { inputMode: 'decimal' })}
            </>
          ) : null}
          <label className="vf-field">
            <span className="vf-label">Responsible person</span>
            <select value={d.responsible_id} onChange={set('responsible_id')}>
              <option value="">—</option>
              {onStaff(employees).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label className="vf-field">
            <span className="vf-label">Renewal type</span>
            <select value={d.auto_renew} onChange={set('auto_renew')}>
              <option value={0}>Manual</option>
              <option value={1}>Auto-renews</option>
            </select>
          </label>
          <label className="vf-field">
            <span className="vf-label">Payment</span>
            <select value={d.payment_status} onChange={set('payment_status')}>
              <option value="">Not said</option>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
            </select>
          </label>
        </div>
        <label className="vf-field">
          <span className="vf-label">Remarks</span>
          <input value={d.note} onChange={set('note')} />
        </label>
        <div className="rr-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !d.name.trim()} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ calendar ------------------------------ */

function Calendar({ rows, onOpen }) {
  const now = todayIso();
  const [ym, setYm] = useState(() => ({ y: Number(now.slice(0, 4)), m: Number(now.slice(5, 7)) }));
  const [view, setView] = useState('month');
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date(`${now}T00:00:00`);
    d.setDate(d.getDate() - d.getDay());
    return d;
  });
  const events = useMemo(() => calendarEvents(rows, ym.y, ym.m), [rows, ym]);
  const step = (n) => setYm(({ y, m }) => {
    const t = m + n;
    return { y: y + Math.floor((t - 1) / 12), m: ((t - 1 + 120) % 12) + 1 };
  });
  const title = new Date(ym.y, ym.m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const grid = monthWeeks({ year: ym.y, month: ym.m });
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const weekEvents = useMemo(() => {
    const out = new Map();
    const months = new Set(weekDays.map((d) => `${d.getFullYear()}-${d.getMonth() + 1}`));
    for (const key of months) {
      const [y, m] = key.split('-').map(Number);
      for (const e of calendarEvents(rows, y, m)) (out.get(e.date) || out.set(e.date, []).get(e.date)).push(e);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, weekStart]);
  const Ev = ({ e }) => (
    <button type="button" className={`rn-ev tone-${e.tone}`} onClick={() => onOpen(e.id)} title={`${e.what}: ${e.name}`}>
      {e.name}
    </button>
  );
  return (
    <div className="card rn-cal">
      <div className="row-between">
        <div className="row">
          {view === 'week' ? (
            <>
              <button className="ghost small" onClick={() => setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; })}>‹</button>
              <strong>Week of {weekDays[0].toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</strong>
              <button className="ghost small" onClick={() => setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; })}>›</button>
            </>
          ) : (
            <>
              <button className="ghost small" onClick={() => step(-1)}>‹</button>
              <strong>{title}</strong>
              <button className="ghost small" onClick={() => step(1)}>›</button>
            </>
          )}
        </div>
        <div className="sub-tabs toolbar">
          {['month', 'week', 'list'].map((v) => (
            <button key={v} className={view === v ? 'active' : undefined} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>
          ))}
        </div>
      </div>
      <p className="rn-legend small">
        <span className="rn-ev tone-upcoming">Upcoming</span>
        <span className="rn-ev tone-soon">Due within 30 days</span>
        <span className="rn-ev tone-overdue">Overdue</span>
        <span className="rn-ev tone-pending">In a renewal</span>
      </p>
      {view === 'month' ? (
        <div className="rn-month">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="rn-dow">{d}</div>)}
          {grid.flat().map((day, i) => (
            <div key={i} className={`rn-day${day ? '' : ' blank'}${day && `${ym.y}-${String(ym.m).padStart(2, '0')}-${String(day).padStart(2, '0')}` === now ? ' today' : ''}`}>
              {day ? <span className="rn-date">{day}</span> : null}
              {day ? events.filter((e) => e.day === day).map((e, k) => <Ev key={k} e={e} />) : null}
            </div>
          ))}
        </div>
      ) : view === 'week' ? (
        <div className="rn-week">
          {weekDays.map((d) => (
            <div key={iso(d)} className={`rn-day${iso(d) === now ? ' today' : ''}`}>
              <span className="rn-date">{d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })}</span>
              {(weekEvents.get(iso(d)) || []).map((e, k) => <Ev key={k} e={e} />)}
            </div>
          ))}
        </div>
      ) : (
        <table className="sheet rn-table">
          <thead><tr><th>Date</th><th>What</th><th>Record</th></tr></thead>
          <tbody>
            {events.map((e, i) => (
              <tr key={i}>
                <td>{fmt(e.date)}</td>
                <td><span className={`rn-ev tone-${e.tone}`}>{e.what}</span></td>
                <td><button type="button" className="link" onClick={() => onOpen(e.id)}>{e.name}</button></td>
              </tr>
            ))}
            {!events.length ? <tr><td colSpan={3} className="empty">Nothing falls due in {title}.</td></tr> : null}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ------------------------------- reports ------------------------------- */

function Reports({ rows, onOpen }) {
  const years = useMemo(() => [...new Set(rows.map((r) => financialYear(r.expires_on)).filter(Boolean))].sort().reverse(), [rows]);
  const [fy, setFy] = useState('');
  const scoped = fy ? rows.filter((r) => financialYear(r.expires_on) === fy) : rows;
  const c = costSummary(scoped);
  const Table = ({ title, lines }) => (
    <div className="card ao-chart">
      <h4>{title}</h4>
      <table className="sheet rn-table">
        <thead><tr><th>Name</th><th className="num">Records</th><th className="num">A year</th></tr></thead>
        <tbody>
          {lines.slice(0, 12).map((l) => (
            <tr key={l.key}><td>{l.key === '—' ? 'Not said' : l.key}</td><td className="num">{l.n}</td><td className="num">{rupees(l.yearly)}</td></tr>
          ))}
          {!lines.length ? <tr><td colSpan={3} className="empty">Nothing.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="stack">
      <div className="toolbar">
        <label className="inline-num">
          Financial year (by expiry)
          <select value={fy} onChange={(e) => setFy(e.target.value)}>
            <option value="">All</option>
            {years.map((y) => <option key={y}>{y}</option>)}
          </select>
        </label>
        <span className="push-right row">
          {CATEGORIES.map((cat) => (
            <button key={cat.key} className="ghost small" onClick={() => saveCsv(`${cat.key}-register.csv`, COLUMNS[cat.key], scoped.filter((r) => categoryOf(r) === cat.key))}>
              {cat.label} (CSV)
            </button>
          ))}
        </span>
      </div>
      <div className="ao-kpis rn-kpis">
        {[
          ['Monthly recurring', rupees(c.monthly)],
          ['Annual recurring', rupees(c.yearly)],
          ['Rent, a year', rupees(c.by_category.rent.yearly)],
          ['Software, a year', rupees(c.by_category.software.yearly)],
          ['Insurance, a year', rupees(c.by_category.insurance.yearly)],
          ['Renewals in the next 90 days', rupees(c.upcoming_cost)],
          ['Pending payments', rupees(c.pending_payment)],
        ].map(([k, n]) => (
          <div key={k} className="ao-kpi tone-navy static">
            <span className="ao-kpi-text"><span className="k">{k}</span><span className="n">{n}</span></span>
          </div>
        ))}
      </div>
      {c.unknown ? <p className="muted small">{c.unknown} record{c.unknown === 1 ? ' has' : 's have'} no cost or billing cycle and {c.unknown === 1 ? 'is' : 'are'} not in these figures.</p> : null}
      <div className="ao-grid">
        <Table title="By vendor / landlord / insurer" lines={c.by_vendor} />
        <Table title="By company" lines={c.by_company} />
        <div className="card ao-chart">
          <h4>Each record, a year</h4>
          <table className="sheet rn-table">
            <thead><tr><th>Record</th><th className="num">A month</th><th className="num">A year</th></tr></thead>
            <tbody>
              {scoped.filter((r) => !r.cancelled_on).sort((a, b) => costOf(b).yearly - costOf(a).yearly).slice(0, 15).map((r) => (
                <tr key={r.id}>
                  <td><button type="button" className="link" onClick={() => onOpen(r.id)}>{r.name}</button></td>
                  <td className="num">{costOf(r).known ? rupees(costOf(r).monthly) : '—'}</td>
                  <td className="num">{costOf(r).known ? rupees(costOf(r).yearly) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="muted small">
        A month and a year are worked out from each record's billing cycle: a quarterly ₹3,000 is ₹1,000 a month and
        ₹12,000 a year. A rent agreement's amount is its monthly rent. Something bought outright counts only its AMC.
      </p>
    </div>
  );
}

/* ------------------------------- settings ------------------------------- */

function Settings({ onError }) {
  const [rule, setRule] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = () =>
    api
      .get('/people/licenses/reminders')
      .then((g) => {
        setRule(g.rule);
        setHistory(g.history || []);
      })
      .catch(onError);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!rule) return <p className="loading">Loading…</p>;
  const choices = [90, 60, 45, 30, 15, 7, 3, 1, 0, -1, -7];
  const toggle = async (n) => {
    const next = rule.steps.includes(n) ? rule.steps.filter((x) => x !== n) : [...rule.steps, n];
    setBusy(true);
    try {
      const got = await api.put('/people/licenses/reminders', { steps: next });
      setRule(got.rule);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <div className="card">
        <h3>When to remind</h3>
        <p className="muted small">
          A reminder comes up on the Overview's alerts and the dashboard's reminders when a record reaches each ticked
          point. Each one is recorded once, so it never shows as new twice; renewing a record starts its reminders
          afresh. Changing these needs a Manager or an Admin.
        </p>
        <div className="row rn-steps">
          {choices.map((n) => (
            <label key={n} className="check">
              <input type="checkbox" disabled={busy} checked={rule.steps.includes(n)} onChange={() => toggle(n)} /> {stepLabel(n)}
            </label>
          ))}
        </div>
        <p className="muted small">
          Reminders are shown inside the HRMS — to HR and Admin on the Overview and the dashboard, and the responsible person
          is named beside each. Nothing is emailed or sent on WhatsApp: the app has no channel to do that, and does not
          pretend to.
        </p>
      </div>
      <div className="card">
        <h3>Reminder history</h3>
        {!history.length ? (
          <p className="muted small">No reminder has come due yet.</p>
        ) : (
          <table className="sheet rn-table">
            <thead><tr><th>Shown</th><th>Record</th><th>Reminder</th><th>For the expiry on</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="small">{String(h.shown_at).slice(0, 10)}</td>
                  <td>{h.name}</td>
                  <td>{stepLabel(h.step)}</td>
                  <td>{fmt(h.expires_on)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
