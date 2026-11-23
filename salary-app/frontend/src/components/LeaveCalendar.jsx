import { useEffect, useMemo, useState } from 'react';
import { WEEKDAYS, monthWeeks } from '../../../shared/monthGrid.js';
import { api } from '../api.js';
import { ATTENDANCE_CODES } from '../../../shared/calc.js';

/**
 * A MONTH OF LEAVE, AS A CALENDAR.
 *
 * Dinesh's brief asks for one. What it exists to answer is "who is off on
 * the 18th" and "how many people are off that week", which a register of
 * balances cannot say at all.
 *
 * APPROVED AND PENDING ARE DIFFERENT COLOURS AND DIFFERENT WORDS. A pending
 * application has moved nobody's attendance and nobody's pay; showing it as
 * a day off is how somebody plans a shift around leave that was never
 * granted.
 */
export default function LeaveCalendar({ period, companyId, onGo, onError }) {
  const [data, setData] = useState(null);
  const [pick, setPick] = useState(null);

  useEffect(() => {
    if (!period?.id) return;
    setData(null);
    api
      .get(`/leave/calendar/${period.id}${companyId ? `?company_id=${companyId}` : ''}`)
      .then(setData)
      .catch((err) => onError?.(err.message));
  }, [period?.id, companyId]);

  /* The month's layout comes from `shared/monthGrid.js`, which the Time
     tab's calendar reads too - two calendars working out for themselves
     which square the 1st sits in is how they come to disagree. */
  const weeks = useMemo(
    () =>
      data
        ? monthWeeks({ year: data.period.year, month: data.period.month, cells: data.days })
        : [],
    [data]
  );

  if (!period) return <p className="muted small">No month is open.</p>;
  if (!data) return <p className="muted small">Loading…</p>;

  const s = data.summary;

  return (
    <div className="stack">
      <div className="stat-row">
        <Fig label="Days of leave" value={s.leave_days} />
        <Fig label="People who took it" value={s.people} />
        <Fig label="Waiting on a decision" value={s.pending_days} warn={s.pending_days > 0} />
        <Fig label="Holidays" value={s.holidays} />
        <Fig
          label="Busiest day"
          value={s.busiest && s.busiest.on_leave.length ? `${s.busiest.day} ${data.period.label.split(' ')[0]}` : '—'}
          small
        />
      </div>

      <div className="lc-grid">
        {WEEKDAYS.map((d) => (
          <div className="lc-head" key={d}>{d}</div>
        ))}
        {weeks.flat().map((day, i) =>
          !day ? (
            <div className="lc-cell empty" key={`b${i}`} />
          ) : (
            <button
              type="button"
              key={day.day}
              className={[
                'lc-cell',
                day.holiday ? 'holiday' : '',
                day.everybody_off ? 'off' : '',
                pick === day.day ? 'on' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setPick(pick === day.day ? null : day.day)}
            >
              <span className="lc-date">{day.day}</span>
              {day.holiday ? <span className="lc-holiday">{day.holiday}</span> : null}
              {day.on_leave.length ? (
                <span className="lc-count approved">{day.on_leave.length} on leave</span>
              ) : null}
              {day.pending.length ? (
                <span className="lc-count pending">{day.pending.length} waiting</span>
              ) : null}
            </button>
          )
        )}
      </div>

      <div className="lc-key">
        <span><i className="approved" /> On leave — marked and paid as such</span>
        <span><i className="pending" /> Waiting on a decision — <strong>not</strong> a day off yet</span>
        <span><i className="holiday" /> Holiday</span>
      </div>

      {pick ? (
        <div className="card">
          <h3>
            {pick} {data.period.label}
          </h3>
          {(() => {
            const day = data.days.find((d) => d.day === pick);
            if (!day) return null;
            return (
              <>
                {day.holiday ? <p><strong>{day.holiday}</strong></p> : null}
                <h4>On leave</h4>
                {day.on_leave.length ? (
                  <ul className="plain-list">
                    {day.on_leave.map((p) => (
                      <li key={p.employee_id} className="small">
                        <button className="link" onClick={() => onGo?.('employees', p.employee_id)}>
                          {p.name}
                        </button>
                        <span className="muted"> · {ATTENDANCE_CODES[p.code]?.label || p.code}</span>
                        {p.department ? <span className="muted"> · {p.department}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">Nobody.</p>
                )}
                <h4>Waiting on a decision</h4>
                {day.pending.length ? (
                  <>
                    <ul className="plain-list">
                      {day.pending.map((p, i) => (
                        <li key={`${p.request_id}-${i}`} className="small">
                          {p.name}
                          <span className="muted">
                            {' '}· {ATTENDANCE_CODES[p.code]?.label || p.kind}
                            {p.status === 'recommended' ? ' · backed by their manager' : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="muted small">
                      <strong>Not a day off yet.</strong> A request pays nobody and marks nothing
                      until it is approved, in{' '}
                      <button className="link" onClick={() => onGo?.('reports', 'approvals')}>
                        Reports → Attendance corrections and approvals
                      </button>
                      .
                    </p>
                  </>
                ) : (
                  <p className="muted small">Nothing waiting.</p>
                )}
                {day.weekly_off ? (
                  <p className="muted small">
                    {day.everybody_off ? 'Everybody' : `${day.weekly_off} people`} ha{day.everybody_off ? 's' : 've'} this
                    as their weekly off anyway.
                  </p>
                ) : null}
              </>
            );
          })()}
        </div>
      ) : (
        <p className="muted small">Click a day to see who is off.</p>
      )}
    </div>
  );
}

function Fig({ label, value, warn, small }) {
  return (
    <div className="stat plain">
      <span
        className="value"
        style={{ color: warn ? 'var(--warn)' : undefined, fontSize: small ? '1rem' : undefined }}
      >
        {value}
      </span>
      <span className="label">{label}</span>
    </div>
  );
}
