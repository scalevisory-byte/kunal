import { useEffect, useState } from 'react';
import { STANDALONE, api } from '../api.js';
import { BREAKABLE } from '../../../shared/leaveBonus.js';
import { DEFAULT_YEAR_RULE, normaliseYearRule } from '../../../shared/leaveBonusYear.js';
import { ATTENDANCE_CODES } from '../../../shared/calc.js';
import { rupees } from '../format.js';
import { col, num, printReport } from '../printReport.js';
import { saveCsv } from '../saveCsv.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];


/**
 * THE LEAVE BONUS - Leave -> Bonus (v2.49.0: the contract's yearly bonus ONLY).
 *
 * Dinesh: "Apply only leave bonus formula and make leave bonus register".
 * The monthly "no leave this month" bonus (v1.78) is off the screen; its
 * routes and ledger stay, so anything it ever paid can still be read and
 * taken back. What is here is the employment contract's Paid Leave Structure
 * and its register.
 *
 * The yearly leave bonus from the employment contract (v2.48.0): 20 days'
 * pay at salary / 30, by slabs of leaves taken in the calendar year.
 *
 * As with the monthly one: looking pays nobody, the button names the month
 * the money goes onto, and somebody with nothing marked all year is held,
 * never counted as "no leave".
 */
export default function LeaveBonus({ period, periods = [], companyId, onReload }) {
  const [year, setYear] = useState(() => period?.year || new Date().getFullYear());
  const [payInto, setPayInto] = useState(() => period?.id || '');
  const [data, setData] = useState(null);
  const [rule, setRule] = useState(null);
  const [error, setError] = useState('');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (tryRule) => {
    setError('');
    try {
      const q = [companyId ? `company_id=${companyId}` : '', tryRule ? `rule=${encodeURIComponent(JSON.stringify(tryRule))}` : '']
        .filter(Boolean)
        .join('&');
      const out = await api.get(`/leave/bonus-year/${year}${q ? `?${q}` : ''}`);
      setData(out);
      setRule((r) => r || out.saved_rule);
    } catch (err) {
      setError(err.message);
      setData(null);
    }
  };
  useEffect(() => {
    if (STANDALONE) return;
    setRule(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, companyId]);

  if (STANDALONE) {
    return <p className="muted">The yearly bonus reads a whole year of attendance and needs the server version.</p>;
  }
  if (error) return <p className="error">{error}</p>;
  if (!data || !rule) return <p className="muted small">Loading…</p>;

  const t = data.totals;
  const years = [...new Set([year, ...periods.map((p) => p.year)])].sort((a, b) => b - a);
  const payMonths = periods.filter((p) => !p.locked);
  const change = (patch) => {
    const next = normaliseYearRule({ ...rule, ...patch });
    setRule(next);
    setSaid('');
    load(next);
  };
  const setSlab = (i, key, value) => {
    const slabs = rule.slabs.map((s, at) => (at === i ? { ...s, [key]: value } : s));
    change({ slabs });
  };
  const toggleBreak = (code) => {
    const has = rule.breaks.includes(code);
    if (has && rule.breaks.length === 1) return;
    change({ breaks: has ? rule.breaks.filter((c) => c !== code) : [...rule.breaks, code] });
  };

  const saveRule = async () => {
    setBusy(true);
    try {
      await api.put('/leave/bonus-year/rule', rule);
      setSaid('Rule saved — the office’s, not this browser’s.');
      await load(rule);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toPay = data.lines.filter((l) => l.eligible && !l.already_paid);
  const pay = async () => {
    const month = periods.find((p) => Number(p.id) === Number(payInto));
    if (!month || !toPay.length) return;
    if (!window.confirm(`Pay ${rupees(t.amount)} to ${toPay.length} people as the ${year} leave bonus, added on ${month.label}?\n\nIt goes on the salary sheet as an addition and prints on the payslip. Each person is paid once for ${year}, whichever month it goes into.`)) return;
    setBusy(true);
    try {
      const out = await api.post(`/leave/bonus-year/${year}/pay`, {
        period_id: month.id,
        lines: toPay.map((l) => ({ employee_id: l.employee_id, amount: l.amount, days_off: l.leaves })),
      });
      setSaid(`${out.paid.length} paid on ${month.label}${out.skipped.length ? `; ${out.skipped.length} skipped (${out.skipped.map((s) => s.why).slice(0, 2).join('; ')})` : ''}.`);
      await load(rule);
      onReload?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const print = () => printRegister(data, year);

  const shortYear = data.months_on_record.length < 12;

  return (
    <div className="stack">
      <div className="card">
        <h3>The rule — from the employment contract</h3>
        <p className="muted small">
          “Total leave 20. Up to 20 leaves — full 20 days bonus, as per 30 days. 21–30 — 75%. 31–40 — 50%. 41 or more — no
          bonus.” The bonus is <b>{rule.base_days} days’ pay at the monthly salary ÷ {rule.divisor}</b>, in the band the
          year’s leaves fall in. Bands include their top figure, so exactly 20 is still the full bonus.
        </p>
        <div className="form-grid">
          <label>
            Bonus days
            <input inputMode="numeric" value={rule.base_days} onChange={(e) => change({ base_days: e.target.value })} />
            <span className="muted small">the contract’s 20 days</span>
          </label>
          <label>
            Day rate: salary ÷
            <input inputMode="numeric" value={rule.divisor} onChange={(e) => change({ divisor: e.target.value })} />
            <span className="muted small">“as per 30 days”</span>
          </label>
          <label>
            No bonus in the first
            <input inputMode="numeric" value={rule.min_service_months} onChange={(e) => change({ min_service_months: e.target.value })} />
            <span className="muted small">months of service (“first year, all leave unpaid”)</span>
          </label>
        </div>

        <table className="sheet lby-slabs">
          <thead>
            <tr><th>Leaves in the year</th><th className="num">Bonus</th><th /></tr>
          </thead>
          <tbody>
            {rule.slabs.map((s, i) => (
              <tr key={i}>
                <td>
                  {i ? `${rule.slabs[i - 1].upto + 1} to ` : 'up to '}
                  <input className="lby-num" inputMode="numeric" value={s.upto} onChange={(e) => setSlab(i, 'upto', e.target.value)} />
                </td>
                <td className="num">
                  <input className="lby-num" inputMode="numeric" value={s.pct} onChange={(e) => setSlab(i, 'pct', e.target.value)} />%
                </td>
                <td>
                  {rule.slabs.length > 1 && (
                    <button className="ghost tiny" onClick={() => change({ slabs: rule.slabs.filter((_, at) => at !== i) })}>remove</button>
                  )}
                </td>
              </tr>
            ))}
            <tr>
              <td>more than {rule.slabs[rule.slabs.length - 1].upto}</td>
              <td className="num">0%</td>
              <td>
                <button className="ghost tiny" onClick={() => change({ slabs: [...rule.slabs, { upto: rule.slabs[rule.slabs.length - 1].upto + 10, pct: 25 }] })}>
                  add a band
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <p className="muted small" style={{ marginTop: '0.6rem' }}>
          <strong>What counts as a leave.</strong> A half day counts half and an absence without approval (AD) counts two —
          the contract’s own “2 days for every 1 day taken”.
        </p>
        <div className="chips">
          {BREAKABLE.map((code) => (
            <button
              key={code}
              className={`chip ${rule.breaks.includes(code) ? 'active' : ''}`}
              disabled={rule.breaks.length === 1 && rule.breaks.includes(code)}
              onClick={() => toggleBreak(code)}
            >
              {ATTENDANCE_CODES[code]?.label || code}
            </button>
          ))}
        </div>
        <label className="inline" style={{ marginTop: '0.5rem' }}>
          <input type="checkbox" checked={rule.pro_rata} onChange={(e) => change({ pro_rata: e.target.checked })} /> Pro rata for
          somebody who completes their first year during the year, or leaves during it
        </label>
        <div className="row" style={{ marginTop: '0.6rem' }}>
          <button disabled={busy} onClick={saveRule}>Save this rule</button>
          <button className="ghost" disabled={busy} onClick={() => change({ ...DEFAULT_YEAR_RULE })}>Back to the contract’s figures</button>
          <span className="muted small">{said || 'Changing it re-prices the year below — nothing is saved until you press Save.'}</span>
        </div>
      </div>

      <div className="card">
        <div className="late-head">
          <div>
            <h2>Leave bonus register — {year}</h2>
            <p className="muted small">What the year <strong>would</strong> pay. Nothing is paid by looking.</p>
          </div>
          <span className="grow" />
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={print}>Print</button>
          <button className="ghost" onClick={() => registerCsv(data, year)}>CSV</button>
        </div>

        <div className="late-figs">
          <span><b>{t.eligible}</b><em>qualify</em></span>
          <span><b>{rupees(t.amount)}</b><em>to pay</em></span>
          <span><b>{t.held}</b><em>held — see why</em></span>
          {t.already_paid ? <span><b>{t.already_paid}</b><em>already paid</em></span> : null}
        </div>

        {shortYear ? (
          <p className="warn small">
            <strong>
              {data.months_on_record.length ? `Only ${data.months_on_record.length} of ${year}’s 12 months are in the app (${data.months_on_record.map((m) => MONTHS[m - 1]).join(', ')}).` : `No month of ${year} is in the app yet.`}
            </strong>{' '}
            Leaves taken in the other months are not counted, so a bonus worked out now is higher than the contract’s if
            anybody took leave then. Pay it once the year is complete, or type the missing leave onto those months first.
          </p>
        ) : null}
        {t.held ? (
          <p className="muted small">
            <strong>{t.held} held</strong> — nothing marked all year, no monthly salary, or no joining date (the first year
            cannot be checked without one). Fill the record in on Employees and they are worked out.
          </p>
        ) : null}

        <div className="row">
          <label className="inline">
            Pay into{' '}
            <select value={payInto} onChange={(e) => setPayInto(e.target.value)}>
              <option value="">— pick a month —</option>
              {payMonths.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <button className="primary" disabled={busy || !toPay.length || !payInto} onClick={pay}>
            {toPay.length ? `Pay ${rupees(t.amount)} to ${toPay.length} people` : 'Nothing left to pay'}
          </button>
        </div>

        <LeaveBonusRegister data={data} year={year} />
      </div>
    </div>
  );
}

const MONTH_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const fig = (v) => (v === null || v === undefined ? '—' : String(v));

/**
 * THE REGISTER: one line per person, their leaves month by month, the year's
 * total, the slab it falls in, the bonus, and where it was paid.
 *
 * It ASSEMBLES: every figure came off the server's yearBonusRun, which counts
 * the same attendance marks the salary sheet is paid from. A month with
 * nothing marked for somebody is a dash - not known, which is not nought
 * leaves.
 */
export function LeaveBonusRegister({ data, year }) {
  const shown = new Set(data.months_on_record || []);
  const lines = data.lines || [];
  const total = lines.reduce((t, l) => t + (l.eligible ? l.amount : 0), 0);
  /*
   * COMPACT ON PURPOSE (v2.49.1): "Why column ko wrap karo, scroll na karna
   * pade". Twelve month columns leave no room for five more, so the joining
   * salary and joining date ride under the name, the slab % under the total,
   * the paid month under the bonus, and the reason wraps. The
   * whole register fits the screen with no sideways scroll.
   */
  return (
    <div className="table-wrap lby-register">
      <table className="sheet wide">
        <thead>
          <tr>
            <th className="row-no">#</th>
            <th>Name</th>
            {MONTH_KEYS.map((m) => (
              <th key={m} className={`num lby-m${shown.has(m) ? '' : ' lby-none'}`}>{MONTHS[m - 1]}</th>
            ))}
            <th className="num lby-total">Total</th>
            <th className="num lby-bonus">Bonus</th>
            <th className="lby-why">Why</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.employee_id} className={l.held ? 'lby-held' : undefined}>
              <td className="row-no">{i + 1}</td>
              <td className="lby-name">
                {l.name}
                <div className="muted small">
                  {[l.salary ? rupees(l.salary) : 'no salary', l.department, l.joined_on ? `joined ${l.joined_on}` : 'no joining date']
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {/* On a narrow screen the reason column is dropped and the reason rides here. */}
                <div className="small lby-why-inline">{l.why}</div>
              </td>
              {MONTH_KEYS.map((m) => (
                <td key={m} className="num lby-m">{fig(l.months?.[m])}</td>
              ))}
              <td className="num" title={l.held ? '' : `${l.band} leaves`}>
                <b>{l.held && !l.leaves ? '—' : l.leaves}</b>
                {l.held ? null : <div className="muted small">{l.pct}%</div>}
              </td>
              <td className="num">
                <b>{l.amount ? rupees(l.amount) : '—'}</b>
                {l.paid_in ? <div className="muted small">paid {l.paid_in}</div> : l.eligible ? <div className="muted small">not paid yet</div> : null}
              </td>
              <td className="small lby-why">{l.why}</td>
            </tr>
          ))}
          {!lines.length && (
            <tr><td colSpan={17} className="empty">Nobody on the payroll in {year}.</td></tr>
          )}
        </tbody>
        {lines.length ? (
          <tfoot>
            <tr>
              <td />
              <td><b>{lines.filter((l) => l.eligible).length} qualify</b></td>
              {MONTH_KEYS.map((m) => <td key={m} />)}
              <td />
              <td className="num"><b>{rupees(total)}</b></td>
              <td />
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

const registerRows = (data) =>
  (data.lines || []).map((l) => {
    const row = {
      name: l.name,
      code: l.code,
      department: l.department,
      joined_on: l.joined_on || '',
      salary: l.salary || '',
      leaves: l.held && !l.leaves ? '' : l.leaves,
      band: l.held ? '' : l.band,
      pct: l.held ? '' : l.pct,
      share: l.share === null ? '' : l.share,
      amount: l.amount || 0,
      paid_in: l.paid_in || '',
      why: l.why,
    };
    for (const m of MONTH_KEYS) row[`m${m}`] = l.months?.[m] ?? '';
    return row;
  });

export function registerCsv(data, year) {
  const columns = [
    ['Name', 'name'], ['Code', 'code'], ['Department', 'department'], ['Joined', 'joined_on'], ['Monthly salary', 'salary'],
    ...MONTH_KEYS.map((m) => [MONTHS[m - 1], `m${m}`]),
    ['Leaves in year', 'leaves'], ['Slab', 'band'], ['Percent', 'pct'], ['Share of year', 'share'],
    ['Bonus', 'amount'], ['Paid in', 'paid_in'], ['Why', 'why'],
  ];
  saveCsv(`Leave-bonus-register-${year}.csv`, columns, registerRows(data));
}

export function printRegister(data, year) {
  const rule = data.rule;
  const t = data.totals;
  printReport({
    title: `Leave bonus register ${year}`,
    subtitle: `${rule.base_days} days at salary ÷ ${rule.divisor}, by leaves taken in the year`,
    meta: [
      rule.slabs.map((s, i) => `${i ? `${rule.slabs[i - 1].upto + 1}–` : 'up to '}${s.upto}: ${s.pct}%`).join(' · ') + ' · more: nothing',
      `${t.eligible} qualify · ${rupees(t.amount)} still to pay`,
      (data.months_on_record || []).length < 12
        ? `Months in the app: ${(data.months_on_record || []).map((m) => MONTHS[m - 1]).join(', ') || 'none'}`
        : null,
    ].filter(Boolean),
    landscape: true,
    compact: true,
    columns: [
      col('Name', (r) => r.name, '13%'),
      ...MONTH_KEYS.map((m) => num(MONTHS[m - 1], (r) => fig(r.months?.[m]), '3.6%')),
      num('Total', (r) => (r.held && !r.leaves ? '' : r.leaves), '5%'),
      col('Slab', (r) => (r.held ? '' : `${r.pct}%`), '5%'),
      num('Bonus', (r) => (r.amount ? rupees(r.amount) : ''), '8%'),
      col('Paid', (r) => r.paid_in || '', '9%'),
      col('Why', (r) => r.why, '16%'),
    ],
    rows: data.lines,
    totals: { label: `${t.eligible} qualify`, Bonus: rupees((data.lines || []).reduce((s, l) => s + (l.eligible ? l.amount : 0), 0)) },
    empty: 'Nobody in this year.',
    footer: 'Leaves are counted off the attendance marks the salary sheet is paid from; a half day counts half and an absence without approval counts two. A dash is a month with nothing marked.',
  });
}

/** Reports -> Leave -> Leave bonus register: the same register, to look at and print. */
export function LeaveBonusRegisterReport({ period, companyId }) {
  const [year, setYear] = useState(() => period?.year || new Date().getFullYear());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (STANDALONE) return;
    setError('');
    api
      .get(`/leave/bonus-year/${year}${companyId ? `?company_id=${companyId}` : ''}`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [year, companyId]);
  if (STANDALONE) return <p className="muted">The leave bonus register reads a whole year of attendance and needs the server version.</p>;
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted small">Loading…</p>;
  return (
    <div className="stack">
      <div className="late-head rp-head">
        <div>
          <h3>Leave bonus register — {year}</h3>
          <p className="muted small">Pay it from Leave → Bonus; this is the register to read and print.</p>
        </div>
        <span className="grow" />
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
          {[year + 1, year, year - 1].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button onClick={() => printRegister(data, year)}>Print</button>
        <button className="ghost" onClick={() => registerCsv(data, year)}>CSV</button>
      </div>
      <LeaveBonusRegister data={data} year={year} />
    </div>
  );
}
