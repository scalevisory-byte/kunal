import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { rupees, rupees2, days } from '../format.js';
import { ATTENDANCE_CODES } from '../../../shared/calc.js';
import { describeMinutes } from '../../../shared/attendanceRequests.js';
import Payslip from './Payslip.jsx';
import ChangePassword from './ChangePassword.jsx';
import { Avatar } from './EmployeePhoto.jsx';

/*
 * What an employee sees when they sign in.
 *
 * A different app, not the office one with the tabs hidden: a staff login
 * reaches exactly one router on the server, so there is nothing of the office
 * to hide. Four things, which is what Dinesh asked for - my pay, my
 * attendance, my leave, my details - and the first of them answers the
 * question people actually have, which is not "what did I get" but "why is it
 * this much".
 *
 * Everything here comes from /api/me, which reads the employee id off the
 * LOGIN. There is no id in any URL on this page, so there is nothing to
 * tamper with.
 */

const TABS = [
  ['pay', 'My pay'],
  ['attendance', 'My attendance'],
  ['leave', 'Leave'],
  ['me', 'My details'],
];

export default function MyPage({ me, onError, onSignOut }) {
  const [tab, setTab] = useState('pay');
  const [employee, setEmployee] = useState(null);
  const [months, setMonths] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const [who, mine] = await Promise.all([api.get('/me'), api.get('/me/months')]);
        setEmployee(who.employee);
        setMonths(mine.months);
      } catch (err) {
        onError(err);
      }
    })();
  }, []);

  return (
    <div className="my-page">
      <header className="my-head">
        {/* Their own face, from /api/me/photo - the same picture the office
            has on their record, never anybody else's. */}
        <Avatar employee={{ name: employee?.name || me?.name }} size="lg" src="/api/me/photo" />
        <div>
          <h1>{employee?.name || me?.name}</h1>
          <p className="muted small">
            {[employee?.designation, employee?.department, employee?.company_name]
              .filter(Boolean)
              .join(' · ') || 'Your record'}
          </p>
        </div>
        <button className="ghost" onClick={onSignOut}>Sign out</button>
      </header>

      <nav className="tabs sub-tabs">
        {TABS.map(([key, label]) => (
          <button key={key} className={tab === key ? 'active' : undefined} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'pay' && <MyPay months={months} onError={onError} />}
      {tab === 'attendance' && <MyAttendance months={months} onError={onError} />}
      {tab === 'leave' && <MyLeave onError={onError} />}
      {tab === 'me' && <MyDetails employee={employee} onSaved={setEmployee} onError={onError} />}
    </div>
  );
}

/* ---------------- my pay ---------------- */

/**
 * The payslip, and under it the working.
 *
 * "How was this calculated" is laid out as a sum you can follow down the page
 * rather than a table of figures: start from the salary, take off the days
 * not worked, add the overtime, then every deduction by name. Each line says
 * where it came from, because a payslip nobody can check is a payslip
 * everybody argues about.
 */
function MyPay({ months, onError }) {
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [slip, setSlip] = useState(null);

  useEffect(() => {
    if (!openId && months.length) setOpenId(months[0].period_id);
  }, [months]);

  useEffect(() => {
    if (!openId) return;
    setDetail(null);
    api
      .get(`/me/months/${openId}`)
      .then(setDetail)
      .catch(onError);
  }, [openId]);

  if (!months.length) {
    return (
      <div className="card">
        <p className="muted small">
          No month has been run for you yet. Once a month is paid it appears here, with the
          working behind it.
        </p>
      </div>
    );
  }

  const row = detail?.row;

  return (
    <div className="stack">
      {slip ? <Payslip period={slip.period} row={slip.row} onClose={() => setSlip(null)} /> : null}
      <div className="card">
        <label className="field inline">
          Month
          <select value={openId || ''} onChange={(e) => setOpenId(Number(e.target.value))}>
            {months.map((m) => (
              <option key={m.period_id} value={m.period_id}>
                {m.label}
                {m.paid ? '' : ' — not paid yet'}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!row ? (
        <p className="loading">Reading your month…</p>
      ) : (
        <>
          <div className="card my-net">
            <span className="k">Net pay for {detail.period.label}</span>
            <strong className="n">{rupees(row.net_salary)}</strong>
            <span className="muted small">
              {row.status === 'paid' ? 'Paid' : 'Not marked paid yet'} ·{' '}
              {row.payment_mode || 'Bank'}
            </span>
            {/*
             * The SAME slip the office prints - `Payslip.jsx`, not a second
             * one built for this page. A payslip an employee downloads and a
             * payslip the office hands over have to be the same document, and
             * two components would drift the first time a line was added.
             */}
            <button className="primary" onClick={() => setSlip(detail)}>
              Salary slip — print or save as PDF
            </button>
          </div>

          <div className="card">
            <h3>How it was worked out</h3>
            <table className="sheet my-sum">
              <tbody>
                <Line what="Monthly salary" note="what you are on" amount={row.salary} />
                <Line
                  what={`Day rate — ${rupees2(row.per_day)} × ${days(row.present_days)} days paid`}
                  note={`the month is paid on ${row.working_days} working days, whatever the calendar says`}
                  amount={row.gross_after_absent}
                  strong
                />
                {row.absent_salary ? (
                  <Line
                    what={`Days not worked — ${days(row.absent_days)}`}
                    note="already taken off the figure above"
                    amount={-Math.abs(row.absent_salary)}
                    muted
                  />
                ) : null}
                {row.ot_salary ? (
                  <Line
                    what={`Overtime — ${row.ot_minutes} minutes`}
                    note={`at ${rupees2(row.per_hour)} an hour`}
                    amount={row.ot_salary}
                  />
                ) : null}
                {row.late_salary ? (
                  <Line
                    what="Late in and early out"
                    note="beyond the month's free minutes"
                    amount={-Math.abs(row.late_salary)}
                  />
                ) : null}
                {row.addition ? (
                  <Line what="Added" note={row.adjustment_note || 'an extra this month'} amount={row.addition} />
                ) : null}
                {row.deduction ? (
                  <Line
                    what="Deducted"
                    note={row.adjustment_note || 'taken off this month'}
                    amount={-Math.abs(row.deduction)}
                  />
                ) : null}
                <Line what="Gross" amount={row.gross_salary} strong />
                {row.pf ? <Line what="PF" note="your share" amount={-row.pf} /> : null}
                {row.esi ? <Line what="ESI" note="your share" amount={-row.esi} /> : null}
                {row.pt ? (
                  <Line what="Professional tax" note="charged on the gross above" amount={-row.pt} />
                ) : null}
                {row.penalty_deduction ? (
                  <Line
                    what={
                      (row.penalty_notes || []).filter(Boolean).join('; ') || 'Penalty'
                    }
                    amount={-row.penalty_deduction}
                  />
                ) : null}
                {row.loan_deduction ? (
                  <Line what="Loan instalment" amount={-row.loan_deduction} />
                ) : null}
                <Line what="Net pay" amount={row.net_salary} strong />
              </tbody>
            </table>
            <p className="muted small">
              Every figure here is the one the office's own sheet was paid from — this page does
              not work anything out for itself. If something looks wrong, raise it under
              My details.
            </p>
          </div>

          {row.sunday_salary ? (
            <div className="card">
              <h3>Sunday duty</h3>
              <p className="muted small">
                {days(row.sundays_worked)} worked · {rupees(row.sunday_salary)}. Paid on its own
                register, separately from the salary above.
              </p>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Line({ what, note, amount, strong, muted }) {
  return (
    <tr className={strong ? 'my-strong' : undefined}>
      <td>
        {what}
        {note ? <div className="muted small">{note}</div> : null}
      </td>
      <td className={`num${muted ? ' muted' : ''}`}>{rupees(amount)}</td>
    </tr>
  );
}

/* ---------------- my attendance ---------------- */

function MyAttendance({ months, onError }) {
  const [openId, setOpenId] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!openId && months.length) setOpenId(months[0].period_id);
  }, [months]);

  useEffect(() => {
    if (!openId) return;
    setData(null);
    api.get(`/me/attendance/${openId}`).then(setData).catch(onError);
  }, [openId]);

  const marked = useMemo(() => Object.entries(data?.attendance || {}), [data]);

  if (!months.length) return <div className="card"><p className="muted small">Nothing yet.</p></div>;

  return (
    <div className="stack">
      <div className="card">
        <label className="field inline">
          Month
          <select value={openId || ''} onChange={(e) => setOpenId(Number(e.target.value))}>
            {months.map((m) => (
              <option key={m.period_id} value={m.period_id}>{m.label}</option>
            ))}
          </select>
        </label>
      </div>
      {!data ? (
        <p className="loading">…</p>
      ) : (
        <div className="card">
          <div className="figures">
            {Object.entries(data.marks || {})
              .filter(([, n]) => n)
              .map(([code, n]) => (
                <div className="figure" key={code}>
                  <span className="n">{n}</span>
                  <span className="k">{ATTENDANCE_CODES[code]?.label || code}</span>
                </div>
              ))}
            <div className="figure">
              <span className="n">{days(data.payable_days)}</span>
              <span className="k">Days paid</span>
            </div>
          </div>
          {!marked.length ? (
            <p className="muted small">
              Nothing has been marked for you this month yet. That is not the same as being
              absent — an unmarked day is simply a day nobody has recorded.
            </p>
          ) : (
            <div className="my-days">
              {marked
                .sort((a, b) => Number(a[0]) - Number(b[0]))
                .map(([day, entry]) => (
                  <span className="my-day" key={day} title={ATTENDANCE_CODES[entry.code]?.label || entry.code}>
                    <b>{day}</b>
                    <span>{entry.code || '·'}</span>
                  </span>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- leave ---------------- */

/*
 * Day number <-> calendar date, for the leave form only.
 *
 * `monthLength` is worked out from the month itself (day 0 of the next one),
 * so February is 28 or 29 without a table.
 */
const pad = (n) => String(n).padStart(2, '0');
const monthLength = (m) => (m ? new Date(m.year, m.month, 0).getDate() : 31);
const dayDate = (m, day) => (m && day ? `${m.year}-${pad(m.month)}-${pad(day)}` : '');
const dayOf = (value) => (value ? String(Number(value.slice(8, 10))) : '');

function MyLeave({ onError }) {
  const [leave, setLeave] = useState(null);
  const [requests, setRequests] = useState([]);
  const [months, setMonths] = useState([]);
  /*
   * `code` doubles as which kind of time off this is: a leave code, or HOURS.
   *
   * Dinesh asked for a few hours off to be askable and deductible. It is not a
   * leave code - the day stays Present and only the hours move - so it rides
   * in the same picker where somebody is already choosing what to ask for,
   * rather than as a second form they have to find.
   */
  const [form, setForm] = useState({
    period_id: '',
    day: '',
    to_day: '',
    code: 'CL',
    minutes: 120,
    reason: '',
  });
  const hours = form.code === 'HOURS';
  /*
   * Working from home is not time OFF, so it spends no quota and docks
   * nothing - the WH mark is paid in full. It rides on this same form because
   * this is where somebody already goes to say "I will not be at my desk on
   * Tuesday", which is the thought they are actually having.
   */
  const remote = form.code === 'WH';
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');

  const load = async () => {
    try {
      const [l, r, m] = await Promise.all([
        api.get('/me/leave'),
        api.get('/me/requests'),
        api.get('/me/months'),
      ]);
      setLeave(l);
      setRequests(r.requests || []);
      setMonths(m.months || []);
      // Default to the month that is still open, which is the one anybody is
      // applying for.
      setForm((f) => ({ ...f, period_id: f.period_id || m.months.find((x) => !x.locked)?.period_id || '' }));
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const chosen = months.find((m) => String(m.period_id) === String(form.period_id)) || null;

  const apply = async () => {
    setSaid('');
    setBusy(true);
    try {
      await api.post('/me/requests', {
        period_id: Number(form.period_id),
        day: Number(form.day),
        ...(hours
          ? { kind: 'short_leave', minutes: Number(form.minutes) }
          : remote
            ? {
                // No `code`: the mark is a property of the kind, so a
                // work-from-home request can only ever mark the day WH.
                kind: 'remote',
                to_day: form.to_day ? Number(form.to_day) : undefined,
              }
            : {
                kind: 'leave',
                code: form.code,
                to_day: form.to_day ? Number(form.to_day) : undefined,
              }),
        reason: form.reason,
      });
      setForm({ ...form, day: '', to_day: '', reason: '' });
      setSaid('Sent. It changes nothing until the office approves it.');
      await load();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="card">
        <h3>What you have left this year</h3>
        {!leave ? (
          <p className="loading">…</p>
        ) : (
          <div className="figures">
            {['CL', 'SL', 'PL'].map((code) => {
              const quota = leave.quotas?.[code] || 0;
              const taken = leave.taken?.[code] || 0;
              return (
                <div className="figure" key={code}>
                  <span className="n">{days(Math.max(quota - taken, 0))}</span>
                  <span className="k">
                    {ATTENDANCE_CODES[code]?.label || code} left
                    <span className="muted"> of {days(quota)}</span>
                  </span>
                </div>
              );
            })}
            {leave.taken?.UL ? (
              <div className="figure">
                <span className="n">{days(leave.taken.UL)}</span>
                <span className="k">Unpaid leave taken</span>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Apply for leave, or to work from home</h3>
        <div className="vf-grid">
          <label className="vf-field">
            <span className="vf-label">Month</span>
            <select value={form.period_id} onChange={(e) => setForm({ ...form, period_id: e.target.value })}>
              <option value="">Choose…</option>
              {months.filter((m) => !m.locked).map((m) => (
                <option key={m.period_id} value={m.period_id}>{m.label}</option>
              ))}
            </select>
          </label>
          <label className="vf-field">
            <span className="vf-label">Which kind</span>
            <select value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}>
              {['CL', 'SL', 'PL', 'UL'].map((c) => (
                <option key={c} value={c}>{ATTENDANCE_CODES[c]?.label || c}</option>
              ))}
              <option value="HOURS">A few hours off</option>
              <option value="WH">Work from home</option>
            </select>
          </label>
          {/*
            * A real date picker, bounded to the month chosen above.
            *
            * The request itself still travels as a DAY NUMBER, because that is
            * what the grid and the approval write - this only spares somebody
            * on a phone working out that "the 8th" is typed as 8.
            */}
          <label className="vf-field">
            <span className="vf-label">From</span>
            <input
              type="date"
              min={dayDate(chosen, 1)}
              max={dayDate(chosen, monthLength(chosen))}
              value={dayDate(chosen, form.day)}
              disabled={!chosen}
              onChange={(e) => setForm({ ...form, day: dayOf(e.target.value) })}
            />
          </label>
          {hours ? (
            <label className="vf-field">
              <span className="vf-label">How long</span>
              <select
                value={form.minutes}
                onChange={(e) => setForm({ ...form, minutes: e.target.value })}
              >
                {[30, 60, 90, 120, 180, 240, 300].map((m) => (
                  <option key={m} value={m}>{describeMinutes(m)}</option>
                ))}
              </select>
              <span className="vf-hint">
                It comes off that day's hours — a whole day is a leave application
              </span>
            </label>
          ) : (
            <label className="vf-field">
              <span className="vf-label">To</span>
              <input
                type="date"
                min={dayDate(chosen, form.day || 1)}
                max={dayDate(chosen, monthLength(chosen))}
                value={dayDate(chosen, form.to_day)}
                disabled={!chosen}
                onChange={(e) => setForm({ ...form, to_day: dayOf(e.target.value) })}
              />
              <span className="vf-hint">
                {remote
                  ? 'Leave empty for one day. Working from home is paid in full and uses no leave.'
                  : 'Leave empty for one day'}
              </span>
            </label>
          )}
          <label className="vf-field wide">
            <span className="vf-label">Why</span>
            <input
              value={form.reason}
              placeholder={remote ? 'Internet work, at home all day' : 'Family function in Surat'}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </label>
        </div>
        <div className="row" style={{ marginTop: '0.6rem' }}>
          <button
            className="primary"
            disabled={busy || !form.period_id || !form.day || !form.reason.trim()}
            onClick={apply}
          >
            Send it
          </button>
          <span className="muted small">
            {said ||
              (remote
                ? 'Asking to work from home changes nothing by itself — the office decides.'
                : 'A leave application changes nothing by itself — the office decides.')}
          </span>
        </div>
      </div>

      <div className="card">
        <h3>What you have asked for</h3>
        {!requests.length ? (
          <p className="muted small">Nothing asked yet.</p>
        ) : (
          <div className="lines">
            {requests.map((r) => (
              <div key={r.id}>
                <span className="what">
                  {r.kind === 'short_leave'
                    ? `${describeMinutes(r.minutes)} off`
                    : ATTENDANCE_CODES[r.code]?.label || r.kind}{' '}
                  · {r.to_day ? `${r.day}–${r.to_day}` : r.day}
                  <span className="muted small"> {r.reason}</span>
                </span>
                <span className={`pf-status ${r.status === 'approved' ? '' : r.status}`}>{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- my details ---------------- */

/**
 * The two things they can change, and everything they cannot.
 *
 * Bank details and a phone number are the ones the office chases people for,
 * and the person who knows them is the person on this screen. Everything else
 * is shown so it can be CHECKED - a wrong UAN is found by the person it
 * belongs to, not by the office - with a line saying who to tell.
 */
const MINE_TO_CHANGE = [
  ['bank_name', 'Bank'],
  ['bank_account', 'Account number'],
  ['ifsc', 'IFSC'],
  ['phone', 'Phone'],
  ['email', 'Email'],
  ['address', 'Address'],
];

const THEIRS = [
  ['code', 'Employee ID'],
  ['designation', 'Designation'],
  ['department', 'Department'],
  ['joined_on', 'Joined on'],
  ['monthly_salary', 'Monthly salary'],
  ['pan', 'PAN'],
  ['uan', 'UAN'],
  ['esic_no', 'ESIC number'],
];

function MyDetails({ employee, onSaved, onError }) {
  const [said, setSaid] = useState('');
  const [changing, setChanging] = useState(false);

  if (!employee) return <p className="loading">…</p>;

  const save = async (key, value) => {
    if ((employee[key] ?? '') === value) return;
    try {
      const { employee: updated } = await api.patch('/me', { [key]: value });
      onSaved(updated);
      setSaid('Saved.');
      window.setTimeout(() => setSaid(''), 2000);
    } catch (err) {
      onError(err);
    }
  };

  return (
    <div className="stack">
      <div className="card">
        <h3>Yours to keep right</h3>
        <div className="vf-grid">
          {MINE_TO_CHANGE.map(([key, label]) => (
            <label className="vf-field" key={key}>
              <span className="vf-label">{label}</span>
              <input
                key={`${key}-${employee[key] ?? ''}`}
                defaultValue={employee[key] ?? ''}
                onBlur={(e) => save(key, e.target.value)}
              />
            </label>
          ))}
        </div>
        <p className="muted small">
          {said || 'Saved as you leave each box. Your bank details decide where the money goes, so a change here is recorded with the date.'}
        </p>
      </div>

      <div className="card">
        <h3>On your record</h3>
        <dl className="pf-facts">
          {THEIRS.map(([key, label]) => (
            <div className="pf-fact" key={key}>
              <dt>{label}</dt>
              <dd>
                {key === 'monthly_salary'
                  ? rupees(employee[key])
                  : employee[key] || <span className="muted">—</span>}
              </dd>
            </div>
          ))}
        </dl>
        <p className="muted small">
          These are the office's to change. If one is wrong — a PAN, a UAN, your joining date —
          tell them and it is corrected on your record, not here.
        </p>
      </div>

      {/* Changing it whenever they like, not only when forced to. */}
      {changing ? (
        <ChangePassword
          employee={employee}
          onDone={async () => {
            setChanging(false);
            setSaid('Password changed.');
          }}
          onCancel={() => setChanging(false)}
        />
      ) : (
        <div className="card">
          <h3>Your password</h3>
          <p className="muted small">
            Only you know it. Change it whenever you like — if it is forgotten the office makes a
            new one and you are asked to pick your own again.
          </p>
          <button onClick={() => setChanging(true)}>Change my password</button>
        </div>
      )}
    </div>
  );
}
