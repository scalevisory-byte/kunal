import { useMemo, useState } from 'react';
import { missingPunches, MISSING_PUNCH_COLUMNS, PROBLEMS } from '../../../shared/missingPunch.js';
import { col, num, printReport } from '../printReport.js';
import { saveCsv } from '../saveCsv.js';

/**
 * Days the clock cannot account for.
 *
 * The flags existed already — the punch import refuses to invent a departure
 * and the Time tab warns on the day — but there was nowhere to see them
 * together, so a fortnight's worth were only ever found one at a time.
 *
 * It counts nothing and changes nothing: every day here is already paid,
 * whatever the sheet made of it. This is a list of things to go and ask
 * about.
 *
 * AND NOW A WAY IN, which it did not have. Dinesh: *"kisi ka punch missing
 * he to manually kaise log hoga"*. This report names the person and the day
 * and then left you to remember both, switch tab, find them in a list of
 * eighty-five and count down to the date - FOURTEENTH time for that shape.
 * Clicking a row opens that person's month on the Time tab, where the four
 * boxes already are. It does NOT write anything itself: one screen owns
 * typing a clock time, and a second one would be a second answer to how the
 * day's minutes are worked out.
 */
export default function MissingPunch({ payroll, onGo = null }) {
  const [only, setOnly] = useState('');

  const { lines, totals, worst } = useMemo(
    () => (payroll ? missingPunches(payroll.rows || [], {
      hoursPerDay: payroll.period?.hours_per_day || 9,
    }) : { lines: [], totals: null, worst: [] }),
    [payroll]
  );

  if (!payroll) return null;

  const shown = only ? lines.filter((l) => l.problem === only) : lines;

  const print = () =>
    printReport({
      title: 'Missing punches',
      subtitle: payroll.period?.label,
      meta: [
        `${totals.days} day(s) across ${totals.people} people`,
        `${totals.no_out} punched in and never out · ${totals.nothing} at work with no times at all`,
        'Every one of these days is already paid, whatever the sheet made of it. Nothing here is a deduction.',
      ],
      columns: [
        col('Name', (r) => r.name),
        col('Department', (r) => r.department, '12%'),
        num('Day', (r) => r.day, '6%'),
        col('Mark', (r) => r.mark, '6%'),
        col('What is missing', (r) => r.problem_label, '16%'),
        col('In', (r) => r.in_time, '8%'),
        col('Out', (r) => r.out_time, '8%'),
        col('Worked', (r) => r.worked, '9%'),
        col('Reason', (r) => r.reason, '14%'),
      ],
      rows: shown,
      empty: 'Every day at work this month has its times.',
      footer:
        'A day nobody clocked is not the same as a day half-clocked: the first may be a job where nobody punches, the second is a record that is wrong.',
    });

  return (
    <div className="card">
      <div className="late-head">
        <div>
          <h2>Missing punches — {payroll.period?.label}</h2>
          <p className="muted small">
            Days somebody was at work and the clock cannot account for.{' '}
            <strong>Nothing here is a deduction</strong> — every one of these days is already
            paid, whatever the sheet made of it. It is a list of things to go and ask about.
          </p>
        </div>
        <span className="grow" />
        <button onClick={print}>Print</button>
        <button
          className="ghost"
          onClick={() =>
            saveCsv(`Missing-punches-${payroll.period?.label || ''}.csv`, MISSING_PUNCH_COLUMNS, shown)
          }
        >
          CSV
        </button>
      </div>

      <div className="stat-row">
        <Fig label="Days" value={totals.days} strong />
        <Fig label="People" value={totals.people} />
        <Fig label="In, never out" value={totals.no_out} />
        <Fig label="No times at all" value={totals.nothing} />
      </div>

      {lines.length ? (
        <div className="chips">
          <button className={`chip ${only ? '' : 'active'}`} onClick={() => setOnly('')}>
            Everything <span className="muted">{lines.length}</span>
          </button>
          {PROBLEMS.filter(([key]) => totals[key]).map(([key, label, why]) => (
            <button
              key={key}
              className={`chip ${only === key ? 'active' : ''}`}
              title={why}
              onClick={() => setOnly(only === key ? '' : key)}
            >
              {label} <span className="muted">{totals[key]}</span>
            </button>
          ))}
        </div>
      ) : null}

      {worst.length > 1 ? (
        <p className="muted small">
          Most days missing:{' '}
          {worst.map((w) => `${w.name} (${w.days})`).join(' · ')}
          {' — '}the same gap over and over is a finger that does not read or a door nobody
          passes, not somebody forgetting.
        </p>
      ) : null}

      <table className="sheet">
        <thead>
          <tr>
            <th>Name</th>
            <th>Department</th>
            <th className="num">Day</th>
            <th>Mark</th>
            <th>What is missing</th>
            <th>In</th>
            <th>Lunch</th>
            <th>Out</th>
            <th>Worked</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((l) => (
            <tr key={`${l.employee_id}-${l.day}`}>
              <td>
                {onGo ? (
                  <button
                    type="button"
                    className="link name-link"
                    title={`Open ${l.name}\u2019s month on the Time tab to type it in`}
                    onClick={() => onGo('time', { employee_id: l.employee_id, day: l.day })}
                  >
                    {l.name}
                  </button>
                ) : (
                  l.name
                )}
                {l.code ? <span className="muted small"> · {l.code}</span> : null}
              </td>
              <td className="small">{l.department}</td>
              <td className="num">{l.day}</td>
              <td className="small">{l.mark}</td>
              <td className="small">{l.problem_label}</td>
              <td className="small">{l.in_time || '—'}</td>
              <td className="small">
                {l.lunch_out || l.lunch_in ? `${l.lunch_out || '—'} / ${l.lunch_in || '—'}` : ''}
              </td>
              <td className="small">{l.out_time || '—'}</td>
              <td className="small">{l.worked}</td>
            </tr>
          ))}
          {!shown.length && (
            <tr>
              <td colSpan={9} className="empty">
                {lines.length
                  ? 'Nothing of that kind this month.'
                  : 'Every day at work this month has its times.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="muted small">
        <strong>To fill one in, click the name.</strong> It opens that person&rsquo;s whole month
        on the <strong>Time</strong> tab, where the in, lunch and out boxes are \u2014 type the
        time and the day works itself out. The same four boxes are in the day menu on the
        Attendance grid, if that is where you are standing.
      </p>
      <p className="muted small">
        A day <strong>nobody</strong> clocked is not the same as a day <strong>half</strong>{' '}
        clocked — the first may be a job where nobody punches, the second is a record that is
        wrong. They are counted apart for that reason.
      </p>
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
