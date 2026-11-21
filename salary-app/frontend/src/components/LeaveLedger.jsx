import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { LEDGER_COLUMNS, creditLabel, CREDIT_KINDS, entitlementOf } from '../../../shared/leaveLedger.js';
import { days } from '../format.js';
import { col, num, printReport } from '../printReport.js';

/**
 * ONE PERSON'S LEAVE, AS A LEDGER.
 *
 * Dinesh called this the most important thing in the leave brief: *"an
 * employee-wise Leave Ledger similar to an accounting ledger in Tally"* -
 * date, particulars, credit, debit, balance, reference, opening and closing.
 *
 * ---------------------------------------------------------------------------
 * EVERY DEBIT IS A MARK ON THE ATTENDANCE GRID.
 *
 * Nothing on this page invents a day taken. The debits are counted off the
 * same marks the salary sheet is paid from and the muster roll prints, so
 * this ledger and that grid cannot disagree - which is the only way a
 * balance is worth anything.
 *
 * The credits are the half that was missing: an opening balance, a monthly
 * accrual, a correction with a reason. Before this, a balance was quota
 * minus taken and there was nowhere to say "she carried four days in".
 * ---------------------------------------------------------------------------
 */

const BLANK = { kind: 'adjustment', days: '', on_date: '', note: '', reference: '' };

/* Encashing and lapsing have their OWN control below, which goes through
   /leave/encash and so cannot take more days than somebody has. Offering
   them here as well would be a second way in with no such check. */
const POSTABLE = CREDIT_KINDS.filter(([k]) => k !== 'annual' && k !== 'encashed');

export default function LeaveLedger({ employeeId, year, onClose }) {
  const [data, setData] = useState(null);
  const [code, setCode] = useState('CL');
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cash, setCash] = useState('');
  const [paid, setPaid] = useState('');

  const load = async () => {
    setError('');
    try {
      setData(await api.get(`/leave/ledger/${employeeId}?year=${year}`));
    } catch (err) {
      setError(err.message);
      setData(null);
    }
  };
  useEffect(() => { load(); }, [employeeId, year]);

  const ledger = useMemo(
    () => data?.ledgers.find((l) => l.code === code) || data?.ledgers[0] || null,
    [data, code]
  );

  /* The entitlement this ledger is standing in for, when nothing is posted:
     the single derived credit line the fallback produced. */
  const entitlement = entitlementOf(ledger);

  const startLedger = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post('/leave/credits', {
        employee_id: employeeId,
        code,
        kind: 'annual',
        days: entitlement,
        on_date: `${year}-01-01`,
        note: 'yearly entitlement, written onto the ledger',
      });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    if (!form.days) return setError('how many days?');
    setBusy(true);
    setError('');
    try {
      await api.post('/leave/credits', {
        employee_id: employeeId,
        code,
        kind: form.kind,
        days: Number(form.days),
        on_date: form.on_date || `${year}-01-01`,
        note: form.note,
        reference: form.reference,
      });
      setForm(BLANK);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * ENCASHING: THE DAYS COME OFF HERE, THE MONEY DOES NOT.
   *
   * The same split as a penalty and its recovery. Taking the days off the
   * ledger is this button; paying for them is an addition on a named month,
   * typed on the salary sheet where every other one-off payment is. Saying
   * so out loud is the point - a screen that took the days and went quiet
   * would read as having paid.
   */
  const encash = async () => {
    const want = Number(cash);
    if (!(want > 0)) return setError('how many days?');
    setBusy(true);
    setError('');
    setPaid('');
    try {
      const out = await api.post('/leave/encash', {
        employee_id: employeeId, code, days: want, year,
      });
      setCash('');
      setPaid(out.note);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (line) => {
    if (!line.id) return;
    if (!window.confirm('Take this entry off the ledger? The balance changes with it.')) return;
    try {
      await api.del(`/leave/credits/${line.id}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const print = () => {
    if (!ledger || !data) return;
    const s = ledger.summary;
    printReport({
      title: `${data.employee.name} — ${data.types.find((t) => t.code === ledger.code)?.label || ledger.code}`,
      subtitle: [data.employee.code, data.employee.company_name, data.employee.department]
        .filter(Boolean)
        .join(' · '),
      meta: [
        `Leave year ${ledger.year}`,
        `Opening ${days(s.opening)} · credited ${days(s.credited)} · availed ${days(s.availed)} · closing ${days(s.closing)}`,
        s.posted ? null : 'No entries have been posted — this is the yearly entitlement on their record, less what the grid shows as taken.',
      ].filter(Boolean),
      columns: [
        col('Date', (l) => l.date, '12%'),
        col('Particulars', (l) => l.particulars),
        num('Credit', (l) => (l.credit ? days(l.credit) : ''), '9%'),
        num('Debit', (l) => (l.debit ? days(l.debit) : ''), '9%'),
        num('Balance', (l) => days(l.balance), '10%'),
        col('Reference', (l) => l.reference, '14%'),
      ],
      rows: ledger.lines,
      totals: { label: 'Closing balance', Balance: days(s.closing) },
      empty: 'Nothing on this ledger for the year.',
      footer:
        'Every debit is a mark on the attendance grid — the same marks the salary sheet is paid from.',
    });
  };

  const csv = () => {
    if (!ledger) return;
    const rows = [LEDGER_COLUMNS.map(([head]) => head)];
    for (const l of ledger.lines) rows.push(LEDGER_COLUMNS.map(([, key]) => l[key] ?? ''));
    const body = `﻿${rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.employee.name.replace(/\W+/g, '-')}-${ledger.code}-${year}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (!data) {
    return (
      <div className="picker-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <p className="muted small">{error || 'Loading…'}</p>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  const s = ledger.summary;

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div className="modal ef-modal" onClick={(e) => e.stopPropagation()}>
        <header className="ef-head">
          <div>
            <h2>{data.employee.name}</h2>
            <p className="muted small">
              {[data.employee.code, data.employee.company_name, data.employee.department]
                .filter(Boolean)
                .join(' · ')}{' '}
              · leave year {year}
            </p>
          </div>
          <span className="grow" />
          <button onClick={print}>Print</button>
          <button onClick={csv}>CSV</button>
          <button className="ghost" onClick={onClose}>Close</button>
        </header>

        <div className="chips">
          {data.types.map((t) => {
            const l = data.ledgers.find((x) => x.code === t.code);
            return (
              <button
                key={t.code}
                className={`chip ${code === t.code ? 'active' : ''}`}
                onClick={() => setCode(t.code)}
              >
                {t.label} <span className="muted">{days(l?.summary.closing ?? 0)}</span>
              </button>
            );
          })}
        </div>

        <div className="stat-row">
          <Figure label="Opening" value={s.opening} />
          <Figure label="Credited" value={s.credited} />
          <Figure label="Availed" value={s.availed} />
          {s.adjusted ? <Figure label="Adjusted" value={s.adjusted} /> : null}
          {s.expired ? <Figure label="Lapsed" value={s.expired} /> : null}
          <Figure label="Closing" value={s.closing} strong over={s.closing < 0} />
        </div>

        {!s.posted ? (
          <div className="ef-dup">
            <strong>Nothing has been posted on this ledger yet.</strong>
            <p className="muted small">
              What you are seeing is the <strong>yearly entitlement on their record</strong> less
              what the attendance grid shows as taken — exactly the balance this app has always
              shown. The moment an entry is posted, <strong>the ledger takes over</strong> and
              that entitlement stops being assumed.
            </p>
            {/*
              * THE TRAP THIS BUTTON EXISTS FOR.
              *
              * Post an opening balance of 4 on its own and the balance drops
              * from 6 to 3, because the 7-day entitlement was never an entry
              * - it was an assumption, and posting anything ends it. Starting
              * the ledger properly means writing that entitlement down first.
              */}
            {entitlement > 0 ? (
              <button className="primary" disabled={busy} onClick={startLedger}>
                Start the ledger with their {days(entitlement)}-day entitlement
              </button>
            ) : (
              <p className="muted small">
                There is no yearly entitlement on their record for this type, so there is nothing
                to carry over — post an opening balance below.
              </p>
            )}
          </div>
        ) : null}

        <table className="sheet">
          <thead>
            <tr>
              <th>Date</th>
              <th>Particulars</th>
              <th className="num">Credit</th>
              <th className="num">Debit</th>
              <th className="num">Balance</th>
              <th>Reference</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ledger.lines.map((l, i) => (
              <tr key={i} className={l.kind === 'taken' ? 'r3' : undefined}>
                <td className="small">{l.date}</td>
                <td>
                  {l.particulars}
                  {l.by ? <span className="muted small"> · {l.by}</span> : null}
                </td>
                <td className="num">{l.credit ? days(l.credit) : ''}</td>
                <td className="num">{l.debit ? days(l.debit) : ''}</td>
                <td className="num strong">{days(l.balance)}</td>
                <td className="small muted">{l.reference}</td>
                <td>
                  {l.id ? (
                    <button className="ghost tiny danger" onClick={() => remove(l)}>remove</button>
                  ) : null}
                </td>
              </tr>
            ))}
            {!ledger.lines.length && (
              <tr><td colSpan={7} className="empty">Nothing on this ledger for the year.</td></tr>
            )}
          </tbody>
        </table>

        <div className="card">
          <h3>Post an entry</h3>
          <div className="form-grid">
            <label>
              What
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {POSTABLE.map(([k]) => (
                  <option key={k} value={k}>{creditLabel(k)}</option>
                ))}
              </select>
              <span className="muted small">
                {CREDIT_KINDS.find(([k]) => k === form.kind)?.[2]}
              </span>
            </label>
            <label>
              Days
              <input
                inputMode="decimal"
                value={form.days}
                onChange={(e) => setForm({ ...form, days: e.target.value })}
              />
            </label>
            <label>
              Dated
              <input
                type="date"
                value={form.on_date}
                onChange={(e) => setForm({ ...form, on_date: e.target.value })}
              />
              <span className="muted small">1 January {year} if left empty</span>
            </label>
            <label>
              Reference
              <input
                value={form.reference}
                placeholder="a letter, a circular, an approval"
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
              />
            </label>
            <label className="wide-field">
              Why
              <input
                value={form.note}
                placeholder="required on an adjustment"
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </label>
          </div>
          <div className="row">
            <button className="primary" disabled={busy} onClick={post}>
              {busy ? 'Posting…' : `Post to ${code}`}
            </button>
            {error ? <span className="error">{error}</span> : null}
          </div>
          <p className="muted small">
            A credit gives somebody leave to take. It does <strong>not</strong> mark a day and it
            changes nobody&rsquo;s pay — marking a day is the attendance grid&rsquo;s job, and an
            approval&rsquo;s.
          </p>
        </div>

        <div className="card">
          <h3>Encash days</h3>
          {!s.posted ? (
            /*
             * NOTHING CAN BE TAKEN OFF A LEDGER NOBODY HAS STARTED. The
             * balance above is an assumption until something is posted, and
             * posting the encashment would end it - 3 days off an untouched
             * 7-day ledger reads as MINUS 3. The server refuses it too; this
             * is so the screen does not offer it.
             */
            <p className="muted small">
              This ledger has not been started, so there is nothing on it to take. Post the
              entitlement first — the button above does it — and then the days can come off.
            </p>
          ) : (
            <div className="row">
              <input
                inputMode="decimal"
                style={{ maxWidth: '6rem' }}
                placeholder="days"
                value={cash}
                onChange={(e) => setCash(e.target.value)}
              />
              <button disabled={busy || !cash} onClick={encash}>
                Take {cash || '0'} day(s) of {code} off the ledger
              </button>
              <span className="muted small">{days(s.closing)} available</span>
            </div>
          )}
          {paid ? <p className="warn small">{paid}</p> : null}
          <p className="muted small">
            This takes the days off the ledger and <strong>pays nobody</strong>. Put the amount on
            the month&rsquo;s salary sheet as an addition, with a note — that is the one place
            money reaches a payslip.
          </p>
        </div>
      </div>
    </div>
  );
}

function Figure({ label, value, strong, over }) {
  return (
    <div className="stat plain">
      <span className={`value${strong ? ' strong' : ''}`} style={over ? { color: 'var(--bad)' } : undefined}>
        {days(value)}
      </span>
      <span className="label">{label}</span>
    </div>
  );
}
