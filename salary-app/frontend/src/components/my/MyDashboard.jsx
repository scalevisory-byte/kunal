import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { rupees } from '../../format.js';
import { formatDuration } from '../../../../shared/timesheet.js';
import { comingUp, leaveFor, monthFor, todayFor, trendFor } from '../../../../shared/myDashboard.js';

/**
 * WHAT ONE PERSON SEES WHEN THEY SIGN IN.
 *
 * Dinesh's brief for the self-service portal. Every figure comes from
 * `/api/me`, which reads the employee id off the LOGIN - there is no id in
 * any URL on this page, so there is nothing to tamper with and nothing of
 * anybody else's to show.
 *
 * AND IT INVENTS NOTHING. *"If some dashboard data is unavailable, display a
 * proper empty state instead of inventing values."* Where there is no answer
 * the card says so: a day nobody has marked is "not marked yet", not an
 * absence; hours with no out time are "still in", not nought.
 */

const STATES = {
  'at-work': ['At work', 'ok'],
  'on-leave': ['On leave', 'info'],
  absent: ['Absent', 'bad'],
  holiday: ['Holiday', 'info'],
  'weekly-off': ['Weekly off', 'info'],
  'not-marked': ['Not marked yet', 'muted'],
  'other-month': ['—', 'muted'],
};

export default function MyDashboard({ employee, months, onGo, onError }) {
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [leave, setLeave] = useState(null);
  const [requests, setRequests] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [pay, setPay] = useState(null);
  const [loading, setLoading] = useState(true);

  const today = new Date().toISOString().slice(0, 10);
  /*
   * `/me/months` calls it `period_id`, not `id` - the list is of a person's
   * MONTHS, and `id` on one of those rows would be ambiguous. Reading `id`
   * asked the server for `/me/attendance/undefined`, which 404s, which
   * rejected the whole batch and left the page with nothing to render.
   */
  const latest = months[0] || null;
  const latestId = latest?.period_id ?? latest?.id ?? null;

  useEffect(() => {
    if (!latestId) { setLoading(false); return; }
    (async () => {
      try {
        const want = months.slice(0, 6);
        const [mine, lv, rq, hol, slip, ...rest] = await Promise.all([
          api.get(`/me/attendance/${latestId}`),
          api.get('/me/leave').catch(() => null),
          api.get('/me/requests').catch(() => ({ requests: [] })),
          api.get('/me/holidays').catch(() => ({ holidays: [] })),
          api.get(`/me/months/${latestId}`).catch(() => null),
          ...want.slice(1).map((m) => api.get(`/me/attendance/${m.period_id ?? m.id}`).catch(() => null)),
        ]);
        setCurrent(mine);
        setLeave(lv);
        setRequests(rq?.requests || []);
        setHolidays(hol?.holidays || []);
        setPay(slip);
        setHistory([mine, ...rest.filter(Boolean)]);
      } catch (err) {
        onError?.(err);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestId]);

  const day = useMemo(
    () => (current
      ? todayFor({
          attendance: current.attendance,
          period: current.period,
          today,
          hoursPerDay: current.period?.hours_per_day,
          lunchPaid: current.period?.lunch_paid,
        })
      : null),
    [current, today]
  );
  const month = useMemo(() => (current ? monthFor(current) : null), [current]);
  const balance = useMemo(
    () => (leave
      ? leaveFor(leave, requests.filter((r) => r.status === 'pending' || r.status === 'recommended').length)
      : null),
    [leave, requests]
  );
  const trend = useMemo(
    () => trendFor([...history].reverse().map((h) => ({ period: h.period, marks: h.marks }))),
    [history]
  );
  const upcoming = useMemo(
    () => comingUp({ holidays, employee: employee || {}, today }),
    [holidays, employee, today]
  );

  if (loading) return <p className="muted small">Loading your month…</p>;

  /*
   * NOTHING ON THE BOOKS YET is a real state, and it is not an error.
   *
   * TWO ways to get here, and both are ordinary: no month has been opened at
   * all, or a month exists and this person has no row in it - somebody who
   * joined after it was prepared. The second one crashed the whole page,
   * because everything below reads `current.period`.
   */
  if (!latest || !current) {
    return (
      <div className="card my-empty">
        <h3>Nothing on your record yet</h3>
        <p className="muted small">
          {latest
            ? `You are not on ${latest.label} yet. Once the office adds you to a payroll month,
               your attendance, hours, leave and payslip all appear here.`
            : `No month has been opened for you. Once the office runs your first payroll month,
               your attendance, hours, leave and payslip will all appear here.`}
        </p>
      </div>
    );
  }

  const [stateLabel, stateTone] = STATES[day?.state] || STATES['not-marked'];
  const worked = day?.worked_minutes;

  return (
    <div className="my-dash">
      <div className="my-cards">
        <article className={`my-card tone-${stateTone}`}>
          <header><span className="my-ico">&#128203;</span><h3>Today</h3></header>
          <strong className="my-big">{stateLabel}</strong>
          <p className="muted small">
            {day?.day
              ? `${day.label || 'No mark on the grid'} · ${current.period.label}`
              : `Nothing for today in ${current.period.label}`}
          </p>
          <button className="my-link" onClick={() => onGo('attendance')}>My attendance &rarr;</button>
        </article>

        <article className="my-card">
          <header><span className="my-ico">&#128338;</span><h3>Working hours</h3></header>
          <strong className="my-big">
            {worked === null || worked === undefined ? '—' : formatDuration(worked)}
          </strong>
          <p className="muted small">
            {day?.in_time || day?.out_time
              ? `In ${day.in_time || '—'} · Out ${day.out_time || '—'}${day.still_in ? ' · still in' : ''}`
              : 'No clock times today'}
            {day?.remaining_minutes ? ` · ${formatDuration(day.remaining_minutes)} left of the day` : ''}
          </p>
          <button className="my-link" onClick={() => onGo('attendance')}>This month&rsquo;s hours &rarr;</button>
        </article>

        <article className="my-card">
          <header><span className="my-ico">&#127796;</span><h3>Leave balance</h3></header>
          <strong className="my-big">
            {balance ? balance.total_left : '—'}
            {balance ? <span className="my-of"> of {balance.total_quota}</span> : null}
          </strong>
          <p className="muted small">
            {balance
              ? `${balance.total_used} taken${balance.unpaid_taken ? ` · ${balance.unpaid_taken} unpaid` : ''}${balance.pending ? ` · ${balance.pending} waiting` : ''}`
              : 'No leave quota set on your record'}
          </p>
          <button className="my-link" onClick={() => onGo('leave')}>Apply for leave &rarr;</button>
        </article>

        <article className="my-card">
          <header><span className="my-ico">&#8377;</span><h3>My salary</h3></header>
          <strong className="my-big">{pay?.row ? rupees(pay.row.net_salary) : '—'}</strong>
          <p className="muted small">
            {pay?.row
              ? `${pay.period?.label || current.period.label} · ${pay.row.status === 'paid' ? 'paid' : pay.row.status || 'not paid yet'}`
              : 'No payslip for this month yet'}
          </p>
          <button className="my-link" onClick={() => onGo('pay')}>Payslip and working &rarr;</button>
        </article>
      </div>

      <div className="my-grid">
        <section className="card">
          <div className="row">
            <h3>My attendance</h3>
            <span className="grow" />
            <button className="ghost small" onClick={() => onGo('attendance')}>See every day</button>
          </div>
          {trend.some((t) => t.marked_days > 0) ? (
            <>
              <div className="my-trend">
                {trend.map((t) => {
                  const total = Math.max(1, t.at_work + t.on_leave + t.absent);
                  const h = (v) => `${(v / total) * 100}%`;
                  return (
                    <div
                      className="my-bar"
                      key={t.period_id}
                      title={`${t.label}: ${t.at_work} at work, ${t.on_leave} on leave, ${t.absent} absent`}
                    >
                      <div className="my-stack">
                        <span className="seg-absent" style={{ height: h(t.absent) }} />
                        <span className="seg-leave" style={{ height: h(t.on_leave) }} />
                        <span className="seg-work" style={{ height: h(t.at_work) }} />
                      </div>
                      <span className="my-bar-label">{(t.label || '').slice(0, 3)}</span>
                      <span className="my-bar-pct">{t.percent === null ? '—' : `${t.percent}%`}</span>
                    </div>
                  );
                })}
              </div>
              <div className="my-legend">
                <span><i className="seg-work" /> At work</span>
                <span><i className="seg-leave" /> On leave</span>
                <span><i className="seg-absent" /> Absent</span>
              </div>
              <p className="muted small">
                This month: <strong>{month.at_work}</strong> days at work, {month.on_leave} on leave,{' '}
                {month.absent} absent{month.half_days ? `, ${month.half_days} half` : ''}
                {month.worked_minutes ? ` · ${formatDuration(month.worked_minutes)} clocked` : ''}.
              </p>
            </>
          ) : (
            <p className="empty fo-empty">
              Nothing is marked for you yet. Once the office marks the grid or imports the
              machine&rsquo;s file, your month appears here.
            </p>
          )}
        </section>

        <section className="card">
          <h3>Quick actions</h3>
          <div className="my-actions">
            <button onClick={() => onGo('leave')}>Apply for leave</button>
            <button onClick={() => onGo('attendance')}>View attendance</button>
            <button onClick={() => onGo('pay')}>View payslip</button>
            <button onClick={() => onGo('documents')}>My documents</button>
            <button onClick={() => onGo('holidays')}>Company holidays</button>
            <button onClick={() => onGo('help')}>Contact HR</button>
          </div>
          <p className="muted small">
            Every one of these opens a page on this portal. Nothing here can see or change
            anybody else&rsquo;s record.
          </p>
        </section>

        <section className="card">
          <h3>Coming up</h3>
          {upcoming.length ? (
            <ul className="plain-list my-upcoming">
              {upcoming.map((e) => (
                <li key={`${e.kind}-${e.date}`}>
                  <span className="my-when">
                    {e.days_away === 0 ? 'today' : e.days_away === 1 ? 'tomorrow' : `in ${e.days_away} days`}
                  </span>
                  <span>
                    {e.kind === 'holiday' ? '\u{1F38A}' : e.kind === 'birthday' ? '\u{1F382}' : '\u{1F389}'} {e.title}
                    {e.note ? <span className="muted small"> · {e.note}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">
              Nothing in the next two months. Company holidays appear here once the office adds them.
            </p>
          )}
          <button className="my-link" onClick={() => onGo('holidays')}>All holidays &rarr;</button>
        </section>

        {/* Announcements: honest about what is not built rather than filled
            with something made up. There is no noticeboard in the system. */}
        <section className="card">
          <h3>Announcements</h3>
          <p className="empty fo-empty">Nothing here yet.</p>
          <p className="muted small">
            There is no announcements noticeboard in the system yet, so this shows nothing rather
            than something invented. It needs a place for the office to write them.
          </p>
        </section>

        <section className="card">
          <h3>Help &amp; support</h3>
          <p className="muted small">
            Anything about your attendance, leave or pay goes to the office. A request raised here
            is on the record with a date, which a conversation in a corridor is not.
          </p>
          <div className="my-actions">
            <button className="primary" onClick={() => onGo('help')}>Raise a request</button>
            <button onClick={() => onGo('leave')}>My requests</button>
          </div>
        </section>
      </div>
    </div>
  );
}
