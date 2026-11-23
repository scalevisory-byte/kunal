import { useState } from 'react';
import { WEEKDAYS, monthWeeks } from '../../../shared/monthGrid.js';
import { formatDuration } from '../../../shared/timesheet.js';
import { punchTimes } from '../../../shared/punchLog.js';
import { ATTENDANCE_CODES } from '../../../shared/calc.js';
import { MONTHS, isSunday, weekday } from '../format.js';

/**
 * ONE PERSON'S MONTH AS A CALENDAR — every date on one screen.
 *
 * Dinesh: *"calcndr bana do usme sari date k dikh ajyenge"*, after
 * *"sare log aane chiaye jitni bar andar gya jitni bar bahar se aaya"*.
 *
 * WHAT A CALENDAR IS GOOD AT and the table beside it is not: thirty days in
 * one glance, with the weeks lined up, so a pattern shows — every Tuesday
 * late, the whole second week short, a run of absences.
 *
 * WHAT IT IS BAD AT, and this is why the table stays: a day here is six to
 * twelve door openings, and twelve times in a calendar square is unreadable.
 * So the square carries the day's ANSWER — the mark, in and out, the hours
 * and the ± — and **clicking it opens every punch of that day underneath**.
 * Nothing is hidden; it is one click away instead of on the page at once.
 *
 * IT ASSEMBLES, IT DOES NOT CALCULATE. `judge` and `entryOf` are handed in
 * from the Time tab, which is the same pair the table and the save path use,
 * so the calendar, the grid and the payslip cannot give three answers about
 * a day. There is no second reading of the clock here.
 *
 * A day with no clock time reads as a dash, never as nought hours — *not
 * known* is not *they did nothing*, the same rule as everywhere else.
 */
export default function TimeCalendar({
  period,
  person,
  judge,
  entryOf,
  punches = null,
  onOpenDay = null,
}) {
  const [pick, setPick] = useState(null);

  if (!person) return <p className="muted small">Nobody chosen.</p>;

  const dayOf = (d) => {
    const entry = entryOf(person, d);
    const read = judge(person, d);
    return {
      day: d,
      entry,
      code: String(entry.code || '').toUpperCase(),
      in_time: entry.in_time || '',
      out_time: entry.out_time || '',
      /* `worked` is null when nothing was clocked - a dash, not a zero. */
      worked: read.worked ?? null,
      /* "no out time", "still in", "one punch only" - what the clock itself
         could not settle. Shown on the day, not guessed around. */
      warning: read.warning || '',
      minutes: Number(read.minutes || 0),
      sunday: isSunday(period.year, period.month, d),
      punches: punches?.days?.[d] || [],
    };
  };

  const weeks = monthWeeks({
    year: period.year,
    month: period.month,
    cells: Array.from(
      { length: new Date(Date.UTC(period.year, period.month, 0)).getUTCDate() },
      (_, i) => dayOf(i + 1)
    ),
  });

  const all = weeks.flat().filter(Boolean);
  const marked = all.filter((d) => d.code);
  const clocked = all.filter((d) => d.in_time || d.out_time);
  const short = all.filter((d) => d.minutes < 0);
  const over = all.filter((d) => d.minutes > 0);
  const punched = all.reduce((t, d) => t + d.punches.length, 0);

  const chosen = pick ? all.find((d) => d.day === pick) : null;

  return (
    <div className="stack">
      <p className="muted small">
        <strong>{person.employee_name}</strong> — {MONTHS[period.month - 1]} {period.year}.{' '}
        {marked.length} {marked.length === 1 ? 'day' : 'days'} marked, {clocked.length} clocked,{' '}
        {short.length} short, {over.length} over.{' '}
        {punched ? (
          <>
            {punched} {punched === 1 ? 'punch' : 'punches'} on the readers —{' '}
            <strong>click a day for every one of them</strong>.
          </>
        ) : punches && !punches.matched_on ? (
          <>No punch ID on this person, so no reader can reach them — nothing has been looked for.</>
        ) : (
          <>No punches have come in for this month.</>
        )}
      </p>

      {/*
        * THE DAY'S DETAIL SITS ABOVE THE GRID, and that was measured, not
        * guessed: below it, clicking the 2nd put the answer at 1,286px in a
        * 1,200px window - the one thing the click was for, under the fold.
        * Same mistake as the day picker's clock block, which is above its
        * fourteen buttons for the same reason.
        */}
      {chosen ? (
        <div className="card">
          <div className="late-head">
            <h3 style={{ margin: 0 }}>
              {weekday(period.year, period.month, chosen.day)} {chosen.day}{' '}
              {MONTHS[period.month - 1]}
              {chosen.code ? ` — ${ATTENDANCE_CODES[chosen.code]?.label || chosen.code}` : ''}
            </h3>
            <button className="ghost" onClick={() => setPick(null)}>
              Close
            </button>
          </div>
          <div className="late-figs">
            <span>
              <b>{chosen.in_time || '—'}</b>
              <em>in</em>
            </span>
            <span>
              <b>{chosen.out_time || '—'}</b>
              <em>out</em>
            </span>
            <span>
              <b>{chosen.worked === null ? '—' : formatDuration(chosen.worked)}</b>
              <em>worked</em>
            </span>
            <span>
              <b>
                {chosen.minutes
                  ? `${chosen.minutes < 0 ? '−' : '+'}${formatDuration(Math.abs(chosen.minutes))}`
                  : '—'}
              </b>
              <em>counted on the sheet</em>
            </span>
          </div>
          {chosen.warning ? <p className="small tc-warn-line">{chosen.warning}</p> : null}
          {chosen.punches.length ? (
            <p className="small">
              <strong>Every punch that day:</strong> {punchTimes(chosen.punches)}
              <br />
              <span className="muted">
                The first is the arrival and the last is the departure — that is what the hours are
                worked out from. The ones between are the door opening.
              </span>
            </p>
          ) : (
            <p className="muted small">
              {punches && !punches.matched_on
                ? 'This person has no punch ID, so the readers have never been asked about them.'
                : 'No punches on the readers for this day.'}
            </p>
          )}
          {onOpenDay ? (
            <button className="ghost" onClick={() => onOpenDay(chosen.day)}>
              Open this day on the table
            </button>
          ) : null}
        </div>
      ) : (
        <p className="muted small">Click any date for its punches.</p>
      )}
      <div className="lc-grid tc-grid">
        {WEEKDAYS.map((d) => (
          <div className="lc-head" key={d}>
            {d}
          </div>
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
                d.sunday ? 'off' : '',
                pick === d.day ? 'on' : '',
                !d.code && !d.in_time ? 'blank' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setPick(pick === d.day ? null : d.day)}
              title={ATTENDANCE_CODES[d.code]?.label || ''}
            >
              <span className="lc-date">{d.day}</span>
              {/* `code-XX` is the established mark tint from the attendance grid -
                  a second colour scheme for the same thirteen marks is how two
                  screens come to disagree about what green means. */}
              {d.code ? <span className={`tc-mark code-${d.code}`}>{d.code}</span> : null}
              {d.in_time || d.out_time ? (
                <span className="tc-time">
                  {d.in_time || '—'} → {d.out_time || '—'}
                </span>
              ) : null}
              {d.worked !== null && (d.in_time || d.out_time) ? (
                <span className="tc-worked">{formatDuration(d.worked)}</span>
              ) : null}
              {d.minutes ? (
                <span className={`tc-mins ${d.minutes < 0 ? 'bad' : 'good'}`}>
                  {d.minutes < 0 ? '−' : '+'}
                  {formatDuration(Math.abs(d.minutes))}
                </span>
              ) : null}
              {d.punches.length > 2 ? (
                <span className="tc-punches">{d.punches.length} punches</span>
              ) : null}
              {d.warning ? <span className="tc-warn">{d.warning}</span> : null}
            </button>
          )
        )}
      </div>

    </div>
  );
}
