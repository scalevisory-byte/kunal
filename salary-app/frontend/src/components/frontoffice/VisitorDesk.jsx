import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { onStaff } from '../../onStaff.js';
import { loadCompanyLogos, logoFor } from '../../companyLogos.js';
import {
  VISITOR_TYPES, cleanMobile, duration, isMobile, visitorKpis,
} from '../../../../shared/frontOffice.js';
import { visitorPassHtml } from '../../../../shared/visitorPass.js';
import { col, printReport } from '../../printReport.js';

/**
 * THE VISITOR REGISTER.
 *
 * The desk does three things here and they are in that order on the screen:
 * sign somebody in, see who is in the building, sign somebody out.
 *
 * Two rules the whole screen rests on:
 *
 *   **A PASS NUMBER IS HANDED OUT BY THE SERVER**, never typed. VIS-2026-0001
 *   in a series that never repeats, so the card in somebody's hand and the
 *   row in the book are the same record.
 *
 *   **"INSIDE" IS NOT STORED.** It is whether there is an out time. One fact,
 *   one place, so a register cannot say somebody is inside and show the time
 *   they left in the next column.
 */

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const BLANK = { visitor_type: 'Business Visitor' };

export default function VisitorDesk({ day, employees = [], companyId, onError, onToast, onCount }) {
  const [form, setForm] = useState(BLANK);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [bucket, setBucket] = useState('all');
  const [query, setQuery] = useState('');
  const [meetFilter, setMeetFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(null);
  const nameBox = useRef(null);

  const PER_PAGE = 50;

  const load = async () => {
    const q = new URLSearchParams({ day, limit: String(PER_PAGE), offset: String(page * PER_PAGE) });
    if (query.trim()) q.set('q', query.trim());
    if (meetFilter) q.set('employee_id', meetFilter);
    if (typeFilter) q.set('visitor_type', typeFilter);
    if (bucket !== 'all') q.set('status', bucket === 'inside' ? 'inside' : 'out');
    if (companyId) q.set('company_id', companyId);
    try {
      const got = await api.get(`/front-office/visitors?${q}`);
      setRows(got.rows || []);
      setTotal(got.total || 0);
      onCount?.(got.total || 0);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, bucket, query, meetFilter, typeFilter, page, companyId]);

  /* The letterheads, for the pass. Nothing waits on them. */
  useEffect(() => { loadCompanyLogos(); }, []);

  const kpis = useMemo(() => visitorKpis(rows, { today: todayISO() }), [rows]);
  const staff = useMemo(() => onStaff(employees), [employees]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const problems = [];
  if (!String(form.name || '').trim()) problems.push('a name');
  if (!String(form.purpose || '').trim()) problems.push('the purpose');
  /* Optional - but a number that IS typed has to be a real one. Blank says
     "not taken"; a wrong number says something false. */
  if (String(form.mobile || '').trim() && !isMobile(form.mobile)) {
    problems.push('a 10-digit mobile (or leave it blank)');
  }

  const signIn = async () => {
    setBusy(true);
    try {
      const saved = await api.post('/front-office/visitors', { ...form, day });
      setForm(BLANK);
      nameBox.current?.focus();
      onToast(`${saved.name} signed in — pass ${saved.pass_no}`);
      await load();
    } catch (err) {
      /*
       * The duplicate refusal carries the visitor it clashed with, so the
       * desk is told WHO is already signed in rather than just "no".
       */
      onError(err.visitor ? new Error(`${err.message}`) : err);
    } finally {
      setBusy(false);
    }
  };

  const act = async (run, said) => {
    setBusy(true);
    try {
      await run();
      await load();
      if (said) onToast(said);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  /**
   * The pass, printed.
   *
   * Built from the stored row by the shared module, in an iframe - the same
   * shape as the offer letter, and for the same reasons: it is a whole
   * document with its own stylesheet, and an iframe is never eaten by a
   * pop-up blocker.
   */
  const printPass = async (visitor) => {
    const { default: qr } = await import('qrcode-generator');
    const html = visitorPassHtml(visitor, {
      qr,
      logo: logoFor(visitor.company_id) || logoFor(visitor.company_name),
      office: visitor.company_name || 'BOOKNFLY',
    });
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('title', 'Visitor pass');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    frame.srcdoc = html;
    frame.onload = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      window.setTimeout(() => frame.remove(), 1000);
    };
    document.body.appendChild(frame);
  };

  const COLUMNS = [
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

  const printRegister = () =>
    printReport({
      title: 'Visitor register',
      subtitle: day,
      meta: [
        `${kpis.total} visitor(s) · ${kpis.inside} still inside`,
        bucket === 'all' ? 'everybody' : bucket === 'inside' ? 'currently inside' : 'checked out',
      ],
      landscape: true,
      columns: [col('#', (_v, i) => i + 1, '3%'), ...COLUMNS],
      rows,
      empty: 'Nobody signed in.',
      footer:
        'No out time means nobody recorded one — it is not a time anybody left. This page carries visitors’ names and mobile numbers.',
    });

  return (
    <>
      <div className="card">
        <h3>Sign a visitor in</h3>
        <div className="iv-grid">
          <label className="field">
            Name *
            <input ref={nameBox} value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label className="field">
            Company / organisation
            <input value={form.company ?? ''} onChange={(e) => set('company', e.target.value)} />
          </label>
          <label className="field">
            Visitor type
            <select value={form.visitor_type ?? ''} onChange={(e) => set('visitor_type', e.target.value)}>
              {VISITOR_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="field">
            Purpose *
            <input value={form.purpose ?? ''} onChange={(e) => set('purpose', e.target.value)} />
          </label>
          <label className="field">
            Here to meet
            <select
              value={form.meet_employee_id ?? ''}
              onChange={(e) => set('meet_employee_id', e.target.value)}
            >
              <option value="">— somebody —</option>
              {staff.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}{e.department ? ` · ${e.department}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Mobile
            <input
              inputMode="numeric"
              placeholder="optional"
              value={form.mobile ?? ''}
              onChange={(e) => set('mobile', e.target.value)}
              onBlur={(e) => set('mobile', cleanMobile(e.target.value))}
            />
          </label>
          <label className="field wide">
            Remarks
            <input value={form.remark ?? ''} onChange={(e) => set('remark', e.target.value)} />
          </label>
        </div>
        <div className="row">
          <span className="muted small">
            {problems.length
              ? `Still needed: ${problems.join(', ')}.`
              : 'The pass number and the time in are filled in by the system.'}
          </span>
          <span className="grow" />
          <button className="primary" disabled={busy || problems.length > 0} onClick={signIn}>
            Add visitor
          </button>
        </div>
      </div>

      <div className="card">
        {/*
          * Four figures, and the fourth is not a second name for the second:
          * somebody who walked in ten minutes ago is INSIDE; somebody signed
          * in yesterday and never signed out is a row nobody closed.
          */}
        <div className="fo-figures">
          <div><b>{kpis.total}</b><span>visitors</span></div>
          <div className={kpis.inside ? 'bad' : undefined}><b>{kpis.inside}</b><span>inside now</span></div>
          <div><b>{kpis.checked_out}</b><span>checked out</span></div>
          <div className={kpis.pending_checkout ? 'bad' : undefined}>
            <b>{kpis.pending_checkout}</b><span>never signed out</span>
          </div>
        </div>

        <div className="toolbar">
          <div className="chips">
            {[['all', 'All'], ['inside', 'Currently inside'], ['out', 'Checked out']].map(([key, label]) => (
              <button
                key={key}
                className={`chip ${bucket === key ? 'active' : ''}`}
                onClick={() => { setBucket(key); setPage(0); }}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            className="search"
            placeholder="Name, mobile or pass number"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
          />
          <select value={meetFilter} onChange={(e) => { setMeetFilter(e.target.value); setPage(0); }}>
            <option value="">Anybody met</option>
            {staff.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}>
            <option value="">Any type</option>
            {VISITOR_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <span className="grow" />
          <button className="ghost" onClick={printRegister} disabled={!rows.length}>
            Print the register
          </button>
        </div>

        <div className="scroll">
          <table className="sheet numbered fo-table">
            <thead>
              <tr>
                <th className="row-no">#</th>
                <th>In</th><th>Pass</th><th className="grow">Name</th><th>Company</th>
                <th>Type</th><th>To meet</th><th>Purpose</th><th>Mobile</th>
                <th>Out</th><th>Inside for</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((v, i) => (
                <tr key={v.id} className={v.status === 'Inside' ? 'fo-in' : undefined}>
                  <td className="row-no">{page * PER_PAGE + i + 1}</td>
                  <td className="fo-tel">{v.in_time}</td>
                  <td className="fo-tel small">
                    <button className="link" onClick={() => setOpen(v)}>{v.pass_no}</button>
                  </td>
                  <td>{v.name}</td>
                  <td className="small">{v.company}</td>
                  <td className="small">{v.visitor_type}</td>
                  <td className="small">{v.meeting}</td>
                  <td className="small">{v.purpose}</td>
                  <td className="small fo-tel">{v.mobile}</td>
                  <td className="fo-tel">
                    {v.out_time || (
                      <button
                        className="tiny ghost"
                        disabled={busy}
                        onClick={() => act(
                          () => api.post(`/front-office/visitors/${v.id}/checkout`, {}),
                          `${v.name} checked out`
                        )}
                      >
                        Out now
                      </button>
                    )}
                  </td>
                  <td className="small fo-tel">{duration(v.minutes)}</td>
                  <td className="right nowrap">
                    <button className="tiny" onClick={() => printPass(v)} title="Print the pass">Pass</button>{' '}
                    <button className="icon-x" title="Open" onClick={() => setOpen(v)}>⋯</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length ? <p className="empty fo-empty">Nobody matches.</p> : null}
        </div>

        {total > PER_PAGE && (
          <div className="row">
            <button className="ghost tiny" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ back</button>
            <span className="muted small">
              {page * PER_PAGE + 1}–{Math.min((page + 1) * PER_PAGE, total)} of {total}
            </span>
            <button
              className="ghost tiny"
              disabled={(page + 1) * PER_PAGE >= total}
              onClick={() => setPage(page + 1)}
            >
              next ›
            </button>
          </div>
        )}
      </div>

      {open && (
        <VisitorPanel
          visitor={open}
          staff={staff}
          busy={busy}
          onClose={() => setOpen(null)}
          onPrint={() => printPass(open)}
          onPatch={(patch) =>
            act(async () => {
              const saved = await api.patch(`/front-office/visitors/${open.id}`, patch);
              setOpen(saved);
            }, 'Corrected')
          }
          onCheckOut={(time) =>
            act(async () => {
              const saved = await api.post(`/front-office/visitors/${open.id}/checkout`, { time });
              setOpen(saved);
            }, 'Checked out')
          }
          onUndo={() =>
            act(async () => {
              const saved = await api.del(`/front-office/visitors/${open.id}/checkout`);
              setOpen(saved);
            }, 'Check-out taken back')
          }
          onArchive={() => {
            if (!window.confirm(
              `Archive ${open.name}'s visit?\n\nIt leaves the register and stays on the record — nothing is deleted.`
            )) return;
            act(async () => {
              await api.del(`/front-office/visitors/${open.id}`);
              setOpen(null);
            }, 'Archived');
          }}
        />
      )}
    </>
  );
}

/** One visitor, everything about them, and the three things you can do. */
function VisitorPanel({ visitor, staff, busy, onClose, onPrint, onPatch, onCheckOut, onUndo, onArchive }) {
  const [time, setTime] = useState(visitor.out_time || '');
  useEffect(() => setTime(visitor.out_time || ''), [visitor.id, visitor.out_time]);

  const line = (label, value) =>
    value ? (
      <div className="scr-line unknown">
        <span className="scr-mark">·</span>
        <span className="scr-label">{label}</span>
        <span className="scr-said">{value}</span>
      </div>
    ) : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="payslip-head">
          <div>
            <h2>{visitor.name}</h2>
            <p className="muted">
              {visitor.pass_no} · {visitor.status}
              {visitor.company ? ` · ${visitor.company}` : ''}
            </p>
          </div>
          <div className="no-print">
            <button onClick={onPrint}>Print the pass</button>
            <button onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="scr-lines">
          {line('Type', visitor.visitor_type)}
          {line('To meet', visitor.meeting)}
          {line('Purpose', visitor.purpose)}
          {line('Mobile', visitor.mobile)}
          {line('Date', visitor.day)}
          {line('In', visitor.in_time)}
          {line('Out', visitor.out_time)}
          {line('Inside for', duration(visitor.minutes))}
          {line('Signed in by', visitor.logged_by)}
          {line('Signed out by', visitor.out_by)}
          {line('Remarks', visitor.remark)}
        </div>

        <div className="row" style={{ marginTop: '0.6rem' }}>
          <label className="field">
            Out time
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <button className="primary" disabled={busy} onClick={() => onCheckOut(time || undefined)}>
            {visitor.out_time ? 'Correct the check-out' : 'Check out'}
          </button>
          {visitor.out_time ? (
            <button disabled={busy} onClick={onUndo}>Take it back</button>
          ) : null}
          <span className="grow" />
          <button className="ghost danger" disabled={busy} onClick={onArchive}>Archive</button>
        </div>

        <p className="muted small">
          A correction keeps the arrival exactly as it was and goes on the audit trail with who
          made it. Nothing here is ever deleted — archiving takes the visit off the register and
          leaves it on the record.
        </p>

        <details className="card fold" style={{ marginTop: '0.6rem' }}>
          <summary>Correct the details</summary>
          <div className="iv-grid">
            {[['name', 'Name'], ['company', 'Company'], ['purpose', 'Purpose'], ['mobile', 'Mobile'],
              ['remark', 'Remarks']].map(([key, label]) => (
              <label className="field" key={key}>
                {label}
                <input
                  key={`${key}-${visitor[key] || ''}`}
                  defaultValue={visitor[key] || ''}
                  onBlur={(e) => {
                    if (e.target.value === (visitor[key] || '')) return;
                    onPatch({ [key]: e.target.value });
                  }}
                />
              </label>
            ))}
            <label className="field">
              Here to meet
              <select
                value={visitor.meet_employee_id || ''}
                onChange={(e) => onPatch({ meet_employee_id: e.target.value || null })}
              >
                <option value="">— somebody —</option>
                {staff.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
          </div>
        </details>
      </div>
    </div>
  );
}
