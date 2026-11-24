import { useEffect, useMemo, useState } from 'react';
import { earnedSoFar } from '../../../shared/earnedSoFar.js';
import { api } from '../api.js';
import { rupees, rupees2, days, todayLong } from '../format.js';
import { punchTimes, showPunches } from '../../../shared/punchLog.js';
import { formatDuration } from '../../../shared/timesheet.js';
import { ATTENDANCE_CODES } from '../../../shared/calc.js';
import {
  STATUS_LABEL,
  describe as describeRequest,
  describeMinutes,
  isOpen,
  kindLabel,
} from '../../../shared/attendanceRequests.js';
import Payslip from './Payslip.jsx';
import ChangePassword from './ChangePassword.jsx';
import { Avatar } from './EmployeePhoto.jsx';
import Help from './Help.jsx';
import MyDashboard from './my/MyDashboard.jsx';
import { WEEKDAYS, monthWeeks } from '../../../shared/monthGrid.js';
import MyHolidays from './my/MyHolidays.jsx';
import MyDocuments from './my/MyDocuments.jsx';
import MyProfileForm from './my/MyProfileForm.jsx';
import MyRecord from './my/MyRecord.jsx';
import MyNotices from './my/MyNotices.jsx';

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

/*
 * THE PORTAL'S OWN NAVIGATION.
 *
 * Dinesh's brief names twelve entries. Nine of them are pages; the other
 * three are not sections at all and are not pretended to be:
 *
 *   My Time      is the same days as My attendance, with the clock times on
 *                them. Two entries showing one set of days would be two
 *                names for one thing, which is how two things come to
 *                disagree - so the hours are IN My attendance and the entry
 *                is not duplicated.
 *   Announcements has no noticeboard behind it anywhere in the system. It is
 *                on the dashboard as an honest empty state saying so.
 *   Help & Support and Logout are actions, so they sit at the foot of the
 *                rail rather than in the list of pages.
 *
 * `icon` is a glyph and nothing more - no icon font, no new dependency.
 */
const TABS = [
  ['dash', 'Dashboard', '\u2756'],
  ['attendance', 'My attendance', '\u2713'],
  ['leave', 'My leave', '\u2708'],
  ['pay', 'My salary', '\u20b9'],
  ['notices', 'Notices & jobs', '\u2691'],
  ['record', 'My record', '\u2605'],
  ['me', 'My profile', '\u25cf'],
  ['holidays', 'Holidays', '\u2600'],
  ['documents', 'Documents', '\u25a4'],
];

export default function MyPage({ me, onError, onSignOut }) {
  const [tab, setTab] = useState('dash');
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [employee, setEmployee] = useState(null);
  const [months, setMonths] = useState([]);
  // How many people report to them. A count, not the list - the page only has
  // to decide whether to offer the tab.
  const [manages, setManages] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [who, mine] = await Promise.all([api.get('/me'), api.get('/me/months')]);
        setEmployee(who.employee);
        setManages(who.manages || 0);
        setMonths(mine.months);
      } catch (err) {
        onError(err);
      }
    })();
  }, []);

  // The team tab exists only for somebody who actually manages people. An
  // empty "My team" on a hundred and fifteen logins is noise on all of them.
  const tabs = manages > 0 ? [...TABS, ['team', 'My team', '\u25c6']] : TABS;

  /* Going somewhere closes the drawer, so a tap on a phone does not leave
     the rail sitting over the page it just opened. */
  const go = (key) => {
    if (key === 'help') return setHelpOpen(true);
    setTab(key);
    setNavOpen(false);
    setMenuOpen(false);
  };

  const who = [employee?.designation, employee?.company_name].filter(Boolean).join('  |  ');

  return (
    <div className={`my-shell${navOpen ? ' nav-open' : ''}`}>
      {/* ---------------- the rail ---------------- */}
      <aside className="my-rail">
        <div className="my-brand">
          <strong>BOOKNFLY</strong>
          <span>My portal</span>
        </div>
        <nav>
          {tabs.map(([key, label, icon]) => (
            <button
              key={key}
              className={tab === key ? 'on' : undefined}
              aria-current={tab === key ? 'page' : undefined}
              onClick={() => go(key)}
            >
              <span className="my-nav-ico" aria-hidden="true">{icon}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="my-rail-foot">
          <button onClick={() => go('help')}>
            <span className="my-nav-ico" aria-hidden="true">?</span>
            Help &amp; support
          </button>
          <button onClick={onSignOut}>
            <span className="my-nav-ico" aria-hidden="true">&#8594;</span>
            Sign out
          </button>
        </div>
      </aside>

      {/* The drawer's backdrop on a phone. Tapping it closes the rail. */}
      {navOpen && <div className="my-scrim" onClick={() => setNavOpen(false)} />}

      <div className="my-main">
        <header className="my-top">
          <button
            className="ghost my-burger"
            onClick={() => setNavOpen(true)}
            aria-label="Menu"
          >
            &#9776;
          </button>
          <div className="my-hello">
            {/* The name, the job and the company all come off the record of
                whoever is signed in. Nothing here is typed into the page. */}
            <h1>
              Welcome, {(employee?.name || me?.name || '').split(' ')[0] || 'there'}
              <span aria-hidden="true"> &#128075;</span>
            </h1>
            <p className="muted small">{who || 'Your record'}</p>
            {/* The same date, from the same helper, as the office dashboard. */}
            <p className="today-is">{todayLong()}</p>
          </div>
          <span className="grow" />
          <div className="my-who">
            <button
              className="my-avatar-btn"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-label="Your account"
            >
              <Avatar employee={{ name: employee?.name || me?.name }} size="sm" src="/api/me/photo" />
              <span className="my-caret" aria-hidden="true">&#9662;</span>
            </button>
            {menuOpen && (
              <>
                <div className="my-menu-scrim" onClick={() => setMenuOpen(false)} />
                <div className="my-menu" role="menu">
                  <div className="my-menu-head">
                    <strong>{employee?.name || me?.name}</strong>
                    <span className="muted small">{employee?.code || me?.username || ''}</span>
                  </div>
                  <button role="menuitem" onClick={() => go('me')}>My profile</button>
                  <button role="menuitem" onClick={() => go('record')}>My record</button>
                  <button role="menuitem" onClick={() => go('documents')}>My documents</button>
                  <button
                    role="menuitem"
                    onClick={() => { setMenuOpen(false); setPasswordOpen(true); }}
                  >
                    Change password
                  </button>
                  <button role="menuitem" onClick={() => go('help')}>Help &amp; support</button>
                  <button role="menuitem" className="danger" onClick={onSignOut}>Sign out</button>
                </div>
              </>
            )}
          </div>
        </header>

        {helpOpen && <Help scope="staff" onClose={() => setHelpOpen(false)} />}
        {passwordOpen && (
          <ChangePassword
            me={me}
            onDone={() => setPasswordOpen(false)}
            onCancel={() => setPasswordOpen(false)}
          />
        )}

        <main className="my-body">
          {tab === 'dash' && (
            <MyDashboard employee={employee} months={months} onGo={go} onError={onError} />
          )}
          {tab === 'pay' && <MyPay months={months} onError={onError} />}
          {tab === 'attendance' && <MyAttendance months={months} onError={onError} />}
          {tab === 'leave' && <MyLeave onError={onError} />}
          {tab === 'me' && <MyDetails employee={employee} onError={onError} />}
          {tab === 'notices' && <MyNotices onError={onError} />}
          {tab === 'record' && <MyRecord onError={onError} />}
          {tab === 'holidays' && <MyHolidays onError={onError} />}
          {tab === 'documents' && <MyDocuments onError={onError} />}
          {tab === 'team' && <MyTeam onError={onError} />}
        </main>
      </div>
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
  /*
   * Shown by default - it is their own pay, and hiding it by default would
   * make somebody hunt for it every time. The choice is remembered per
   * device, and `localStorage` is wrapped because merely touching it throws
   * in a private window.
   */
  const [showPay, setShowPay] = useState(() => {
    try {
      return localStorage.getItem('bnf-hrms-hide-pay') !== '1';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('bnf-hrms-hide-pay', showPay ? '0' : '1');
    } catch {
      // Nothing to do: the choice just will not be remembered.
    }
  }, [showPay]);
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

  /*
   * EARNED SO FAR, for the month that is still running.
   *
   * Dinesh: *"jo date ko open kare o date tak ki earning bhi dikhavo"*.
   * Opening your own page on the 20th and seeing the whole month's net pay
   * answers a question nobody asked. A finished month needs none of this -
   * the net below IS the answer - so it is shown only while the month the
   * page is open on is the one we are living in.
   */
  const soFar = useMemo(() => {
    if (!detail?.period || !detail?.row) return null;
    const now = new Date();
    if (now.getFullYear() !== detail.period.year || now.getMonth() + 1 !== detail.period.month) {
      return null;
    }
    return earnedSoFar({
      period: detail.period,
      attendance: detail.row.attendance,
      calc: detail.row,
      upto: now.getDate(),
    });
  }, [detail]);

  const asOf = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

  /*
   * EVERY HOOK ABOVE THE FIRST `return`.
   *
   * This memo was below the "no month has been run for you yet" return, so
   * the page rendered a different NUMBER of hooks before and after the
   * months arrived, and React tore the screen down with error #310 - a
   * staff login opened on a blank white page. Found by signing in as an
   * employee and looking, which is the only way it shows.
   */
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
            {/*
              * NOT IN A HEADLINE FONT any more. Dinesh: *"employee login pe
              * front pe itne bade font me salary mat dikhavo"* - somebody
              * signing in at a counter had their pay legible across the
              * room. It reads at the size of every other figure now, and
              * there is a Hide beside it for a shared screen; what is
              * hidden is remembered on that device only.
              */}
            <span className="k">
              Net pay for {detail.period.label}
              <button className="link my-eye" onClick={() => setShowPay((v) => !v)}>
                {showPay ? 'hide' : 'show'}
              </button>
            </span>
            <strong className="n">{showPay ? rupees(row.net_salary) : '••••••'}</strong>
            <span className="muted small">
              {row.status === 'paid' ? 'Paid' : 'Not marked paid yet'} ·{' '}
              {row.payment_mode || 'Bank'}
            </span>
            {soFar ? (
              <p className="my-sofar">
                <span className="k">Earned up to {asOf}</span>{' '}
                <strong>{showPay ? rupees(soFar.amount) : '••••'}</strong>{' '}
                <span className="muted small">
                  {days(soFar.days_worked)} day{soFar.days_worked === 1 ? '' : 's'} at{' '}
                  {rupees2(soFar.per_day)}
                  {soFar.days_lost ? ` · ${days(soFar.days_lost)} not worked` : ''}
                  {soFar.days_unmarked
                    ? ` · ${soFar.days_unmarked} day${soFar.days_unmarked === 1 ? '' : 's'} not marked yet, counted as worked`
                    : ''}
                </span>
                <span className="muted small">
                  This is what the days so far add up to at your day rate —{' '}
                  <strong>before</strong> PF, ESI, professional tax, any loan instalment and
                  anything else that comes off at the end of the month. It is not a promise of
                  what will be paid.
                </span>
              </p>
            ) : null}
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
  /*
   * LIST OR CALENDAR, and the choice is remembered. Dinesh: *"employe login
   * me bhi calander wala oprtion do"*, after the office side got one.
   *
   * The list reads down the month and is right for checking one day against
   * the next; the calendar lays the weeks out so a pattern shows - every
   * Tuesday late, a whole week short. Both are drawn from the SAME
   * `statement.days`, so they cannot disagree about a day.
   */
  const [shape, setShape] = useState(() => {
    try { return localStorage.getItem('my-att-shape') || 'list'; } catch { return 'list'; }
  });
  const pickShape = (next) => {
    setShape(next);
    try { localStorage.setItem('my-att-shape', next); } catch { /* a private window throws */ }
  };

  useEffect(() => {
    if (!openId && months.length) setOpenId(months[0].period_id);
  }, [months]);

  useEffect(() => {
    if (!openId) return;
    setData(null);
    api.get(`/me/attendance/${openId}`).then(setData).catch(onError);
  }, [openId]);

  /*
   * THE DAYS THE MONTH ACTUALLY HAS SOMETHING ON.
   *
   * `statement.days` is every day of the month, blanks included - right for
   * the office, where a blank day is work to do. Here it would be a page of
   * empty rows, so a day shows when it carries a mark, a clock time, or is a
   * holiday. A plain weekly off with nothing on it is not listed; the summary
   * counts it.
   */
  const lines = useMemo(() => {
    const all = data?.statement?.days || [];
    return all.filter((d) => d.code || d.in_time || d.out_time || d.ot_minutes || d.holiday);
  }, [data]);
  const summary = data?.statement?.summary || null;
  /* Every punch of every day, keyed by day number. Empty where the person has
     no number the readers can match - nobody looked, so there is nothing. */
  const punches = data?.punches || {};

  if (!months.length) return <div className="card"><p className="muted small">Nothing yet.</p></div>;

  /* What the day was, in words - so a blank reads as "not marked" rather
     than as a row somebody forgot. */
  const what = (d) => {
    if (d.code) return d.label || d.code;
    if (d.holiday) return `${d.holiday} (not marked)`;
    if (d.weekly_off) return 'Weekly off (not marked)';
    return 'Not marked';
  };

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
        <>
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
              {/* HOURS, asked for by name. Null is "not clocked", never nought. */}
              <div className="figure">
                <span className="n">
                  {summary && summary.clocked_days ? formatDuration(summary.worked_minutes) : '—'}
                </span>
                <span className="k">
                  {summary && summary.clocked_days
                    ? `Hours worked · ${summary.clocked_days} day${summary.clocked_days === 1 ? '' : 's'} clocked`
                    : 'Hours worked'}
                </span>
              </div>
              {summary?.overtime_minutes ? (
                <div className="figure">
                  <span className="n">{formatDuration(summary.overtime_minutes)}</span>
                  <span className="k">Overtime</span>
                </div>
              ) : null}
              {summary?.short_minutes ? (
                <div className="figure">
                  <span className="n">{formatDuration(summary.short_minutes)}</span>
                  <span className="k">Short hours</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="card">
            <div className="late-head">
              <h3 style={{ margin: 0 }}>Day by day</h3>
              <div className="time-seg" role="tablist" aria-label="How to show the month">
                <button
                  role="tab"
                  aria-selected={shape === 'list'}
                  className={shape === 'list' ? 'on' : undefined}
                  onClick={() => pickShape('list')}
                >
                  List
                </button>
                <button
                  role="tab"
                  aria-selected={shape === 'calendar'}
                  className={shape === 'calendar' ? 'on' : undefined}
                  onClick={() => pickShape('calendar')}
                >
                  Calendar
                </button>
              </div>
            </div>
            {shape === 'calendar' && data?.period ? (
              <MyCalendar
                period={data.period}
                days={data.statement?.days || []}
                punches={punches}
                matched={data.punch_match}
                what={what}
              />
            ) : !lines.length ? (
              <p className="muted small">
                Nothing has been marked for you this month yet. That is not the same as being
                absent — an unmarked day is simply a day nobody has recorded.
              </p>
            ) : (
              <div className="my-att-scroll">
                <table className="sheet my-att">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Day</th>
                      <th>Mark</th>
                      <th>In</th>
                      <th>Out</th>
                      <th className="num">Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((d) => (
                      <tr key={d.day} className={d.weekly_off ? 'off' : undefined}>
                        <td className="num">{d.day}</td>
                        <td className="muted">{d.weekday}</td>
                        <td title={what(d)}>
                          <span className={`my-mark code-${d.code || 'none'}`}>{d.code || '·'}</span>
                          <span className="my-mark-label">{what(d)}</span>
                        </td>
                        {/* A lunch break shows in the title: two more columns
                            on a phone is two columns nobody can read. */}
                        <td
                          className="num"
                          title={d.lunch_out || d.lunch_in ? `Lunch ${d.lunch_out || '—'} to ${d.lunch_in || '—'}` : undefined}
                        >
                          {d.in_time || '—'}
                        </td>
                        <td className="num">
                          {d.out_time || '—'}
                          {/*
                            * THE WHOLE DAY, not just the two ends. The reader
                            * is a door lock, so a normal day is six or eight
                            * openings and In/Out are only the first and the
                            * last of them. The rest answers "I left at 6:30,
                            * that 5:45 one was tea".
                            *
                            * It is not a second opinion about the hours - the
                            * hours still come from the first and the last,
                            * which is what the salary is worked out from.
                            */}
                          {showPunches(d, punches[d.day] || []) ? (
                            <span className="my-att-punches">
                              {punchTimes(punches[d.day])}
                            </span>
                          ) : null}
                        </td>
                        <td className="num">
                          {/* NOT KNOWN is a dash. Nought hours would read as a
                              day somebody turned up for and did nothing. */}
                          {d.worked_minutes === null ? '—' : formatDuration(d.worked_minutes)}
                          {/* The overtime or shortfall rides UNDER the hours
                              rather than in a column of its own: a seventh
                              column falls off the side of a phone, and it is
                              the same number either way. */}
                          {d.ot_minutes ? (
                            <span className={`my-att-ot${d.ot_minutes < 0 ? ' deduct' : ''}`}>
                              {d.ot_minutes > 0 ? `+${d.ot_minutes}m overtime` : `${-d.ot_minutes}m short`}
                            </span>
                          ) : null}
                          {/* A day somebody started and did not finish reads
                              exactly like a day nobody clocked unless it
                              says so. Nothing is guessed - the hours stay
                              unknown. */}
                          {d.worked_minutes === null && d.time_warning ? (
                            <span className="my-att-ot warn">{d.time_warning}</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small">
              {/* The wording follows the view: there is no out COLUMN on the
                  calendar, so telling somebody to look under it is a note
                  about a screen they are not on. */}
              {Object.keys(punches).length
                ? shape === 'calendar'
                  ? 'Tap a date for every punch of that day — the reader is on the door, so stepping out for lunch and coming back shows there too. Only the first and the last count towards the hours. '
                  : 'Under the out time is every punch of that day — the reader is on the door, so stepping out for lunch and coming back shows there too. Only the first and the last count towards the hours. '
                : ''}
              {/*
                * NOT MATCHED and NOT SEEN are different problems, and only
                * one of them is theirs to raise. Somebody with no punch ID
                * has never been looked for at all, so "no punches" would
                * read to them as the machine having missed them all month.
                */}
              {/*
                * Only when NOTHING of theirs is arriving. Punching from their
                * own login needs no reader number, so somebody who does that
                * must not be told their times were all typed in by hand.
                */}
              {!data.punch_match && !Object.keys(punches).length ? (
                <>
                  The door reader has no number for you yet, so none of its punches can reach your
                  record — ask the office to add your punch ID. Any times below were typed in.{' '}
                </>
              ) : null}
              Hours come from the in and out times on the day
              {data.period?.lunch_paid ? ' (the lunch break is inside the paid day)' : ', less the lunch break'}.
              A day with no clock times shows a dash — that means the times are not known, not that
              you worked nothing. If a day looks wrong, raise it with the office; it is the same
              record your salary is worked out from.
            </p>
          </div>
        </>
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

    /**
   * ASKING FOR AN APPROVED LEAVE TO BE CALLED OFF.
   *
   * It does not cancel anything. The same rule the whole queue runs on - a
   * request never writes attendance, a decision does - so the days stay on
   * the grid until somebody in the office cancels it.
   */
  const askCancel = async (request) => {
    const reason = window.prompt('Why do you want this cancelled?');
    if (!reason || !reason.trim()) return;
    setBusy(true);
    try {
      const out = await api.post(`/me/requests/${request.id}/cancel`, { reason: reason.trim() });
      setSaid(out.note);
      await load();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
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
                  {r.cancelled_at ? (
                    <span className="muted small"> · cancelled{r.cancel_reason ? ` — ${r.cancel_reason}` : ''}</span>
                  ) : r.cancel_requested_at ? (
                    /* Asking changes NOTHING on the grid. Until the office
                       cancels it, the leave stands and the days are theirs. */
                    <span className="muted small"> · you asked to cancel this — waiting for the office</span>
                  ) : null}
                </span>
                {r.status === 'approved' && !r.cancel_requested_at ? (
                  <button className="tiny" disabled={busy} onClick={() => askCancel(r)}>
                    Ask to cancel
                  </button>
                ) : null}
                <span className={`pf-status ${r.status === 'approved' ? '' : r.status}`}>
                  {r.cancelled_at ? 'cancelled' : r.status}
                </span>
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


function MyDetails({ employee, onError }) {
  const [said, setSaid] = useState('');
  const [changing, setChanging] = useState(false);

  if (!employee) return <p className="loading">…</p>;

  return (
    <div className="stack">
      {/*
        * THE WHOLE JOINING FORM, asked of the person it is about.
        *
        * This used to be six boxes - bank, phone, email, address - and a
        * read-only list of everything else. Which is why eighty people had
        * no UAN and no ESIC number on their record: only the office could
        * ever type one, and the office had eighty of them to chase.
        */}
      <MyProfileForm onError={onError} />

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
            {said || 'Only you know it. Change it whenever you like — if it is forgotten the office makes a new one and you are asked to pick your own again.'}
          </p>
          <button onClick={() => setChanging(true)}>Change my password</button>
        </div>
      )}
    </div>
  );
}

/**
 * A manager's own team, and the decisions waiting on them.
 *
 * Dinesh asked whether leave could be approved from the employee login. HR
 * works the whole queue in Reports; this is the person who actually knows
 * whether somebody can be spared deciding it themselves, instead of
 * forwarding it to the office to type in.
 *
 * What it deliberately is NOT: a small payroll screen. A manager sees the
 * names of the people who report to them and the requests those people
 * raised. Not salaries, not payslips, not attendance, and nobody outside
 * their own team — the server sends nothing else, and there is a test for it.
 */
function MyTeam({ onError }) {
  const [team, setTeam] = useState([]);
  const [requests, setRequests] = useState([]);
  const [busy, setBusy] = useState(0);
  const [said, setSaid] = useState('');

  const load = async () => {
    try {
      const [who, queue] = await Promise.all([api.get('/me/team'), api.get('/me/team/requests')]);
      setTeam(who.team || []);
      setRequests(queue.requests || []);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const decide = async (request, approve) => {
    /*
     * Approving writes somebody's attendance, which is what their month is
     * paid from. It is worth one question before it happens - the office
     * queue asks the same one.
     */
    if (
      approve &&
      !window.confirm(
        `Approve ${request.employee_name}'s ${kindLabel(request.kind).toLowerCase()}?\n\n` +
          `${describeRequest(request)}\n\nThis sends it to the office to confirm. ` +
          `It reaches their attendance only once the office has.`
      )
    ) {
      return;
    }
    setBusy(request.id);
    setSaid('');
    try {
      await api.post(`/me/team/requests/${request.id}/decide`, { approve });
      setSaid(
        approve
          ? 'Sent to the office to confirm. Nothing is on their attendance yet.'
          : 'Rejected. Nothing was written.'
      );
      await load();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(0);
    }
  };

  /*
   * Three piles on a manager's page, not two.
   *
   * What is still theirs to answer; what they have already backed and sent to
   * the office; and what is settled. Lumping the middle one in with "waiting
   * on you" would ask them to decide the same thing twice; lumping it in with
   * "decided" would tell them it is done when it is not.
   */
  const pending = requests.filter((r) => r.status === 'pending');
  const sentOn = requests.filter((r) => r.status === 'recommended');
  const decided = requests.filter((r) => !isOpen(r));

  return (
    <div className="stack">
      <div className="card">
        <h3>Waiting on you</h3>
        {!pending.length ? (
          <p className="muted small">
            Nothing to decide. Requests from the {team.length}{' '}
            {team.length === 1 ? 'person who reports' : 'people who report'} to you arrive here.
          </p>
        ) : (
          <div className="stack">
            {pending.map((r) => (
              <div className="team-ask" key={r.id}>
                <div>
                  <strong>{r.employee_name}</strong>
                  <div className="muted small">
                    {kindLabel(r.kind)} · {describeRequest(r)}
                  </div>
                  {r.reason ? <div className="small">“{r.reason}”</div> : null}
                </div>
                <div className="row">
                  <button
                    className="primary tiny"
                    disabled={busy === r.id}
                    onClick={() => decide(r, true)}
                  >
                    Approve
                  </button>
                  <button className="tiny" disabled={busy === r.id} onClick={() => decide(r, false)}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {said ? <p className="muted small">{said}</p> : null}
        <p className="muted small">
          Approving sends it to the office to confirm. It goes onto their attendance only once
          the office has.
        </p>
      </div>

      {sentOn.length > 0 && (
        <div className="card">
          <h3>With the office</h3>
          <p className="muted small">
            You have approved these. They are waiting for the office to confirm, and nothing is
            on anybody&rsquo;s attendance yet.
          </p>
          <ul className="plain-list">
            {sentOn.map((r) => (
              <li key={r.id}>
                <strong>{r.employee_name}</strong>{' '}
                <span className="muted small">
                  {kindLabel(r.kind)} · {describeRequest(r)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h3>Your team</h3>
        {!team.length ? (
          <p className="muted small">Nobody reports to you.</p>
        ) : (
          <ul className="plain-list">
            {team.map((p) => (
              <li key={p.id}>
                <strong>{p.name}</strong>
                {p.designation || p.department ? (
                  <span className="muted small">
                    {' '}
                    — {[p.designation, p.department].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">
          You can see who reports to you and what they have asked for. Pay, payslips and records
          stay with the office.
        </p>
      </div>

      {decided.length > 0 && (
        <div className="card">
          <h3>Already decided</h3>
          <ul className="plain-list">
            {decided.slice(0, 20).map((r) => (
              <li key={r.id}>
                <strong>{r.employee_name}</strong>{' '}
                <span className="muted small">
                  {kindLabel(r.kind)} · {describeRequest(r)} ·{' '}
                  {STATUS_LABEL[r.status] || r.status}
                  {r.decided_by ? ` by ${r.decided_by}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * THEIR OWN MONTH AS A CALENDAR.
 *
 * Dinesh: *"employe login me bhi calander wala oprtion do"*, after the office
 * side got one. Same layout (`shared/monthGrid.js`), same classes, so the
 * calendar an employee sees and the one the office sees read alike.
 *
 * IT ASSEMBLES AND CALCULATES NOTHING. Every square is one entry out of
 * `statement.days` — the same array the list beside it is drawn from, which
 * the server built from the same row the payslip is printed from. There is
 * no second reading of the clock here, so the list, the calendar and the
 * payslip cannot give three answers about a day.
 *
 * A day nobody clocked shows a dash, never nought hours: *not known* is not
 * *they did nothing*. Clicking a date opens every punch of it ABOVE the
 * grid — a day is six to twelve door openings and they do not fit in a
 * square, and below the grid the answer lands under the fold, which is the
 * mistake the office calendar made first and had measured out of it.
 */
function MyCalendar({ period, days: all = [], punches = {}, matched = '', what }) {
  const [pick, setPick] = useState(null);

  const weeks = monthWeeks({ year: period.year, month: period.month, cells: all });
  const chosen = pick ? all.find((d) => d.day === pick) : null;
  const mine = (d) => punches[d.day] || [];

  return (
    <div className="stack">
      {chosen ? (
        <div className="card">
          <div className="late-head">
            <h3 style={{ margin: 0 }}>
              {chosen.weekday} {chosen.day} — {what(chosen)}
            </h3>
            <button className="ghost" onClick={() => setPick(null)}>Close</button>
          </div>
          <div className="late-figs">
            <span><b>{chosen.in_time || '—'}</b><em>in</em></span>
            <span><b>{chosen.out_time || '—'}</b><em>out</em></span>
            <span>
              <b>{chosen.worked_minutes === null ? '—' : formatDuration(chosen.worked_minutes)}</b>
              <em>worked</em>
            </span>
            <span>
              <b>
                {chosen.ot_minutes
                  ? `${chosen.ot_minutes > 0 ? '+' : '−'}${formatDuration(Math.abs(chosen.ot_minutes))}`
                  : '—'}
              </b>
              <em>{chosen.ot_minutes > 0 ? 'overtime' : 'short hours'}</em>
            </span>
          </div>
          {chosen.worked_minutes === null && chosen.time_warning ? (
            <p className="small tc-warn-line">{chosen.time_warning}</p>
          ) : null}
          {mine(chosen).length ? (
            <p className="small">
              <strong>Every punch that day:</strong> {punchTimes(mine(chosen))}
              <br />
              <span className="muted">
                The first is the arrival and the last is the departure — that is what the hours
                are worked out from. The ones between are the door opening.
              </span>
            </p>
          ) : (
            <p className="muted small">
              {matched || Object.keys(punches).length
                ? 'Nothing punched on this day.'
                : 'No punch ID is set against your record, so the readers have never been asked about you. Tell the office if you do punch.'}
            </p>
          )}
        </div>
      ) : (
        <p className="muted small">Tap any date to see that day.</p>
      )}

      <div className="lc-grid tc-grid">
        {WEEKDAYS.map((d) => (
          <div className="lc-head" key={d}>{d}</div>
        ))}
        {weeks.flat().map((d, i) =>
          !d ? (
            <div className="lc-cell empty" key={`b${i}`} />
          ) : (
            <button
              type="button"
              key={d.day}
              className={[
                'lc-cell',
                'tc-cell',
                d.weekly_off ? 'off' : '',
                pick === d.day ? 'on' : '',
                !d.code && !d.in_time ? 'blank' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setPick(pick === d.day ? null : d.day)}
              title={what(d)}
            >
              <span className="lc-date">{d.day}</span>
              {d.code ? <span className={`tc-mark code-${d.code}`}>{d.code}</span> : null}
              {d.in_time || d.out_time ? (
                <span className="tc-time">{d.in_time || '—'} → {d.out_time || '—'}</span>
              ) : null}
              {d.worked_minutes !== null && (d.in_time || d.out_time) ? (
                <span className="tc-worked">{formatDuration(d.worked_minutes)}</span>
              ) : null}
              {d.ot_minutes ? (
                <span className={`tc-mins ${d.ot_minutes < 0 ? 'bad' : 'good'}`}>
                  {d.ot_minutes > 0 ? '+' : '−'}
                  {formatDuration(Math.abs(d.ot_minutes))}
                </span>
              ) : null}
              {mine(d).length > 2 ? (
                <span className="tc-punches">{mine(d).length} punches</span>
              ) : null}
            </button>
          )
        )}
      </div>
    </div>
  );
}
