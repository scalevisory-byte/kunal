import { useEffect, useMemo, useRef, useState } from 'react';
import { ATTENDANCE_CODES, STANDARD_WORKING_DAYS } from '../../../shared/calc.js';
import {
  TIME_FIELDS,
  TIME_LABELS,
  formatDuration,
  formatTime,
  hasTimes,
  readTimes,
  monthTotals,
  parseTime,
  timesToDay,
} from '../../../shared/timesheet.js';
import { days, daysInMonth, isSunday, rupees, weekday } from '../format.js';
import { shiftOfMonth, writeStandardTimes } from '../standardTimes.js';
import LatePolicy from './LatePolicy.jsx';
import ScrollFrame from './ScrollFrame.jsx';
import PunchImport from './PunchImport.jsx';
import { STANDALONE } from '../api.js';

/**
 * The Time tab - in, lunch out, lunch in, out, and the hours they come to.
 *
 * The attendance grid says whether somebody was here; this says for how long.
 * Two views, because the two questions are different ones: "what did everybody
 * do today" (a day, every employee) and "what did this person do this month"
 * (an employee, every day). Both write to the same place.
 *
 * Filling a day's times sets that day's short hours or overtime, which is the
 * same OT/LT column the salary sheet pays from - so hours typed here turn into
 * money without anything else being touched. The mark is only set to Present or
 * Half Day when the day has no mark of its own; a day already marked as leave,
 * a holiday or a Sunday keeps its mark and just records what was worked.
 */

/** Marks the times are allowed to overwrite - everything else is deliberate. */
const AUTO_MARKS = new Set(['', 'P', 'A', 'HF']);

export default function TimeSheet({ period, rows, onSave, onPatchPeriod, locked, onReload }) {
  const total = daysInMonth(period.year, period.month);
  const today = new Date();
  const isThisMonth = today.getFullYear() === period.year && today.getMonth() + 1 === period.month;

  const [view, setView] = useState('day'); // 'day' = everybody today, 'month' = one person
  const [day, setDay] = useState(isThisMonth ? today.getDate() : 1);
  const [personId, setPersonId] = useState(rows[0]?.employee_id || null);
  const [query, setQuery] = useState('');
  const [importing, setImporting] = useState(false);
  const [draft, setDraft] = useState({}); // "employeeId:day" -> the four times
  /*
   * The month's own usual day, falling back to this browser's. Set in Admin
   * -> Month settings, so everybody filling the month works to one day
   * rather than to whatever their PC remembers.
   */
  const [standard, setStandard] = useState(() => shiftOfMonth(period));
  const [showStandard, setShowStandard] = useState(false);
  const [status, setStatus] = useState('');
  const saveTimer = useRef(null);

  const dayList = useMemo(() => Array.from({ length: total }, (_, i) => i + 1), [total]);
  useEffect(() => {
    if (day > total) setDay(total);
  }, [day, total]);
  useEffect(() => {
    if (!rows.some((r) => r.employee_id === personId)) setPersonId(rows[0]?.employee_id || null);
  }, [rows, personId]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.employee_name.toLowerCase().includes(q) || (r.company_name || '').toLowerCase().includes(q)
    );
  }, [rows, query]);

  /** A day's stored entry, with anything typed and not yet saved on top. */
  const entryOf = (row, d) => {
    const stored = row.attendance?.[d];
    const base = typeof stored === 'object' && stored ? stored : { code: stored || '', minutes: 0 };
    const key = `${row.employee_id}:${d}`;
    return key in draft ? { ...base, ...draft[key] } : base;
  };

  const readDay = (row, d) => timesToDay(entryOf(row, d), { hoursPerDay: period.hours_per_day });

  /**
   * Saves in a batch a moment after typing stops, the way the grid does, so
   * tabbing across four boxes is one request rather than four.
   */
  const queueSave = (next) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const entries = Object.entries(next).map(([key, times]) => {
        const [employeeId, d] = key.split(':').map(Number);
        const row = rows.find((r) => r.employee_id === employeeId);
        const merged = { ...(row?.attendance?.[d] || {}), ...times };
        const worked = timesToDay(merged, { hoursPerDay: period.hours_per_day });
        const current = String(row?.attendance?.[d]?.code || '').toUpperCase();
        return {
          employee_id: employeeId,
          day: d,
          // Only a mark that says nothing in particular gives way to the clock.
          code: worked.code && AUTO_MARKS.has(current) ? worked.code : current,
          minutes: worked.worked === null ? Number(row?.attendance?.[d]?.minutes) || 0 : worked.minutes,
          ...times,
        };
      });
      if (!entries.length) return;
      setStatus('Saving…');
      try {
        await onSave(entries);
        setDraft({});
        setStatus('Saved');
        setTimeout(() => setStatus(''), 1500);
      } catch (err) {
        setStatus(err.message);
      }
    }, 700);
  };

  const setTimes = (employeeId, d, patch) => {
    if (locked) return;
    const key = `${employeeId}:${d}`;
    const next = { ...draft, [key]: { ...(draft[key] || {}), ...patch } };
    setDraft(next);
    queueSave(next);
  };

  /** The usual timings, onto every blank day on screen. */
  const fillStandard = (targets, onlyBlank = true) => {
    if (locked) return;
    const next = { ...draft };
    let filled = 0;
    for (const { row, day: d } of targets) {
      if (onlyBlank && hasTimes(entryOf(row, d))) continue;
      next[`${row.employee_id}:${d}`] = { ...standard };
      filled++;
    }
    if (!filled) {
      setStatus('Every day on screen already has times');
      setTimeout(() => setStatus(''), 2500);
      return;
    }
    setDraft(next);
    queueSave(next);
  };

  const clearDay = (row, d) => setTimes(row.employee_id, d, Object.fromEntries(TIME_FIELDS.map((f) => [f, ''])));

  const person = rows.find((r) => r.employee_id === personId);

  /* The rows on screen, whichever view is showing: one day across people, or
     one person across days. Everything below draws from this. */
  const lines =
    view === 'day'
      /*
       * No company line under the name. The company filter is at the top of
       * the page and the name column is narrow; repeating "BOOKNFLY PRIVATE
       * LIMITED" under all eighty-five of them doubled the row height and
       * told nobody anything.
       */
      ? filtered.map((row) => ({ key: row.employee_id, row, day, label: row.employee_name }))
      : person
        ? dayList.map((d) => ({
            key: d,
            row: person,
            day: d,
            label: `${weekday(period.year, period.month, d)} ${d}`,
            sunday: isSunday(period.year, period.month, d),
          }))
        : [];

  /* How long the lunch break is, so "finish later" can add it back on. */
  const lunchMinutes = Math.max(
    0,
    (parseTime(standard.lunch_in) ?? 0) - (parseTime(standard.lunch_out) ?? 0),
  );

  /* What the usual timings come to against the day the month is paid on. */
  const usual = timesToDay(standard, { hoursPerDay: period.hours_per_day });
  /*
   * The lunch break: recorded, or taken off the day?
   *
   * Dinesh asked for the times to be kept without the half hour coming out
   * of anybody's pay - "9 hrs including lunch". Deducting is what the app has
   * always done and stays the default, so no month already paid can move.
   * What a switch WOULD give back is counted here, over the whole month and
   * everybody, so the figure is on screen before the box is ticked.
   */
  const lunchPaid = !!period.lunch_paid;
  const lunchEffect = (() => {
    let days = 0;
    let minutes = 0;
    for (const row of rows) {
      for (const d of dayList) {
        const e = entryOf(row, d);
        const read = readTimes(e);
        if (!read.lunch || read.worked === null) continue;
        days += 1;
        minutes += read.lunch;
      }
    }
    return { days, minutes };
  })();

  /* What the gap is worth a month, at the per-minute rate the sheet pays on. */
  const gapCost = usual.minutes
    ? Math.round(
        lines.reduce((sum, { row }) => sum + (Number(row.per_minute) || 0), 0) *
          Math.abs(usual.minutes) *
          STANDARD_WORKING_DAYS,
      )
    : 0;


  const shown = lines.reduce(
    (acc, line) => {
      const read = readDay(line.row, line.day);
      if (read.worked === null) return acc;
      return {
        days: acc.days + 1,
        worked: acc.worked + read.worked,
        short: acc.short + (read.minutes < 0 ? -read.minutes : 0),
        overtime: acc.overtime + (read.minutes > 0 ? read.minutes : 0),
      };
    },
    { days: 0, worked: 0, short: 0, overtime: 0 }
  );

  return (
    <section className="stack">
      {onPatchPeriod && (
        <LatePolicy period={period} rows={rows} onPatch={onPatchPeriod} locked={locked} />
      )}
      {/*
        * ONE BAR, NOT FOUR.
        *
        * Dinesh: *"align all controls properly... compact filter toolbar"*.
        * The page had the mode, the day and the search on one row, the fill
        * button and a paragraph of explanation on a second, an orphaned
        * "change" on a third and the lunch toggle on a fourth - 560px of
        * chrome before the table, which is the only thing anybody came for.
        * The controls are the same controls; they are just in one place now.
        */}
      <div className="time-bar">
        <div className="time-seg" role="tablist" aria-label="What to show">
          <button
            role="tab"
            aria-selected={view === 'day'}
            className={view === 'day' ? 'on' : undefined}
            onClick={() => setView('day')}
          >
            One day, everybody
          </button>
          <button
            role="tab"
            aria-selected={view === 'month'}
            className={view === 'month' ? 'on' : undefined}
            onClick={() => setView('month')}
          >
            One person, whole month
          </button>
        </div>

        {view === 'day' ? (
          <>
            <div className="time-daystep">
              <button className="ghost" disabled={day <= 1} title="Previous day" onClick={() => setDay(day - 1)}>‹</button>
              <select value={day} onChange={(e) => setDay(Number(e.target.value))} title="Which day">
                {dayList.map((d) => (
                  <option key={d} value={d}>
                    {weekday(period.year, period.month, d)} {d}
                    {isSunday(period.year, period.month, d) ? ' · Sunday' : ''}
                  </option>
                ))}
              </select>
              <button className="ghost" disabled={day >= total} title="Next day" onClick={() => setDay(day + 1)}>›</button>
            </div>
            <input
              className="search time-search"
              placeholder="Search employee or company"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </>
        ) : (
          <select
            className="time-person"
            value={personId || ''}
            onChange={(e) => setPersonId(Number(e.target.value))}
          >
            {rows.map((r) => (
              <option key={r.employee_id} value={r.employee_id}>
                {r.employee_name} — {r.company_name}
              </option>
            ))}
          </select>
        )}

        <span className="grow" />
        <span className="muted small time-count">
          {lines.length} {view === 'day' ? (lines.length === 1 ? 'person' : 'people') : 'days'}
        </span>
        {!STANDALONE && !locked && (
          <button className={importing ? 'active' : undefined} onClick={() => setImporting((v) => !v)}>
            {importing ? 'Close' : 'Import from Excel'}
          </button>
        )}
        {status && <span className="pill saving">{status}</span>}
        {locked && <span className="pill locked">Locked</span>}
      </div>

      {/*
        * THE TIMINGS IMPORT, asked for by name — and it is the SAME importer
        * Reports uses for the attendance machine, not a second one.
        *
        * It could already read a sheet of in and out times; it simply lived
        * three tabs away under a heading about biometric devices, so nobody
        * typing hours would ever find it. A second importer would mean two
        * sets of rules about what a short day is.
        */}
      {importing && !STANDALONE && (
        <PunchImport
          period={period}
          onReload={onReload}
          title="Import timings from Excel"
          intro={
            <p className="muted small">
              Your own sheet of hours: one row per person per day, with <strong>In</strong> and{' '}
              <strong>Out</strong> columns — and <strong>Lunch out / Lunch in</strong> as well if
              you keep them. Point at the columns, see what it would do, then write it. The hours
              are judged by the same rule as a day typed here, so an imported day and a typed day
              can never disagree.
            </p>
          }
        />
      )}

      {/*
        * THE DAY'S SETTINGS, IN ONE STRIP.
        *
        * Three toolbars became one: the usual timings as a READ-OUT rather
        * than a sentence (09:30 -> 18:30, less lunch, = 9h 00m), the button
        * that writes them, and whether the break comes off the day. The long
        * explanations are kept - they carry the 45-minute trap that cost
        * real money - but they sit under the strip as one line each instead
        * of wrapping through the controls and orphaning the "change" button
        * onto a row of its own.
        */}
      <div className="time-settings">
        <div className="ts-block">
          <span className="ts-label">The usual day</span>
          <span className="ts-clock">
            <strong>{standard.in_time}</strong>
            <span className="ts-arrow">→</span>
            <strong>{standard.out_time}</strong>
          </span>
          <span className="muted small">
            {standard.lunch_out || standard.lunch_in
              ? `less lunch ${standard.lunch_out}\u2013${standard.lunch_in}`
              : 'no lunch deducted'}
          </span>
          <span className={`ts-sum${usual.minutes < 0 ? ' short' : usual.minutes > 0 ? ' over' : ''}`}>
            = {formatDuration(usual.worked || 0)}
          </span>
          <button className="ghost tiny" onClick={() => setShowStandard((v) => !v)}>
            {showStandard ? 'done' : 'change'}
          </button>
        </div>

        <div className="ts-block">
          <button
            disabled={locked || !lines.length}
            onClick={() => fillStandard(lines.map(({ row, day: d }) => ({ row, day: d })))}
          >
            Fill the usual timings
          </button>
          <span className="muted small">onto the days that have nothing on them</span>
        </div>

        <div className="ts-block">
          <label className="field inline" title="Whether the break comes off the day's hours">
            <input
              type="checkbox"
              checked={lunchPaid}
              disabled={locked || !onPatchPeriod}
              onChange={(e) => {
                const on = e.target.checked;
                if (
                  lunchEffect.days &&
                  !window.confirm(
                    on
                      ? `Stop deducting the lunch break?\n\n` +
                          `${lunchEffect.days} ${lunchEffect.days === 1 ? 'day' : 'days'} this month ` +
                          `${lunchEffect.days === 1 ? 'has' : 'have'} a lunch time on ${lunchEffect.days === 1 ? 'it' : 'them'}, ` +
                          `${formatDuration(lunchEffect.minutes)} in all. Those hours go back into ` +
                          `the month, so short hours fall and overtime rises.\n\n` +
                          'Only this month changes. The times themselves are not touched.'
                      : `Deduct the lunch break again?\n\n` +
                          `${lunchEffect.days} ${lunchEffect.days === 1 ? 'day' : 'days'} this month ` +
                          `${lunchEffect.days === 1 ? 'has' : 'have'} a lunch time on ${lunchEffect.days === 1 ? 'it' : 'them'}, ` +
                          `${formatDuration(lunchEffect.minutes)} in all, which will come off the ` +
                          'hours worked.',
                  )
                ) {
                  return;
                }
                onPatchPeriod({ lunch_paid: on ? 1 : 0 });
              }}
            />
            Lunch is inside the day
          </label>
        </div>
      </div>

      {/*
        * The consequences, under the strip and not through it. The first of
        * these is the one that cost money: the shipped default was 45
        * minutes short of the nine-hour day, so one click docked every
        * person 45 minutes for a full day they had worked - invisible,
        * because nothing on screen ever added the timings up.
        */}
      <p className="time-notes muted small">
        <span className={usual.minutes < 0 ? 'warn-text' : undefined}>
          {usual.minutes === 0
            ? `These timings come to exactly the ${formatDuration(usual.expected)} day. Come when you like \u2014 what counts is finishing it.`
            : usual.minutes < 0
              ? `These timings are ${formatDuration(-usual.minutes)} SHORT of the ${formatDuration(usual.expected)} day, so every day filled this way is docked ${formatDuration(-usual.minutes)}.`
              : `These timings are ${formatDuration(usual.minutes)} OVER the ${formatDuration(usual.expected)} day, so every day filled this way is paid that as overtime.`}
        </span>{' '}
        {lunchPaid
          ? 'Lunch times are recorded and NOT taken off the hours \u2014 the break sits inside the day.'
          : 'Lunch times are taken off the hours worked.'}{' '}
        {lunchEffect.days
          ? `${lunchEffect.days} ${lunchEffect.days === 1 ? 'day' : 'days'} this month ${lunchEffect.days === 1 ? 'carries' : 'carry'} one, ${formatDuration(lunchEffect.minutes)} in all.`
          : 'No lunch times have been entered this month.'}
      </p>

      {/*
        * The two numbers that have to agree, and do not.
        *
        * Dinesh's office is 09:30-18:30 with a thirty-minute lunch - 8h 30m
        * of work - while the month is paid on a nine-hour day. Half an hour
        * short, every person, every day: about 1.66 lakh a month across 114
        * people, out of a mismatch nothing on screen had ever stated.
        *
        * Neither side is guessed. Both fixes are one click, each says what it
        * does, and the one that moves money says how much.
        */}
      {usual.minutes !== 0 && usual.worked !== null && (
        <div className={`card ${usual.minutes < 0 ? 'bad-edge' : ''}`}>
          <strong>
            The usual timings and the paid day do not agree.
          </strong>
          <p className="small" style={{ margin: '0.35rem 0' }}>
            People work <strong>{formatDuration(usual.worked)}</strong> on these timings, and the
            month is paid on a <strong>{formatDuration(usual.expected)}</strong> day — so every day
            filled this way is{' '}
            {usual.minutes < 0
              ? `docked ${formatDuration(-usual.minutes)}`
              : `paid ${formatDuration(usual.minutes)} of overtime`}
            {gapCost ? `, about ${rupees(gapCost)} a month across the ${lines.length} on screen` : ''}.
          </p>
          <div className="button-row">
            <button
              className="primary"
              disabled={locked || !onPatchPeriod}
              onClick={() => {
                const h = Math.round((usual.worked / 60) * 100) / 100;
                if (
                  window.confirm(
                    `Pay the month on a ${formatDuration(usual.worked)} day instead of ` +
                      `${formatDuration(usual.expected)}?\n\n` +
                      'This is the figure short hours and overtime are worked out from, so a ' +
                      'minute becomes worth a little more. Nothing already marked is rewritten ' +
                      'until that day is saved again.',
                  )
                ) {
                  onPatchPeriod({ hours_per_day: h });
                }
              }}
            >
              Pay the day as {formatDuration(usual.worked)}
            </button>
            <button
              disabled={locked}
              onClick={() => {
                const out = formatTime(parseTime(standard.in_time) + usual.expected + lunchMinutes);
                setStandard(writeStandardTimes({ ...standard, out_time: out }));
              }}
            >
              Finish at {formatTime((parseTime(standard.in_time) || 0) + usual.expected + lunchMinutes)} instead
            </button>
          </div>
          <p className="muted small" style={{ marginTop: '0.4rem' }}>
            The first changes what the month pays on, so it matches the hours people really work.
            The second keeps the {formatDuration(usual.expected)} day and moves the finishing time
            these buttons write. Changing the timings alone moves nothing already saved.
          </p>
        </div>
      )}

      {showStandard && (
        <div className="card inline-form">
          {TIME_FIELDS.map((field) => (
            <label key={field}>
              {TIME_LABELS[field]}
              <input
                value={standard[field]}
                placeholder="09:30"
                onChange={(e) => setStandard({ ...standard, [field]: e.target.value })}
                onBlur={(e) => setStandard(writeStandardTimes({ ...standard, [field]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      )}

      <ScrollFrame>
        <table className="sheet timesheet">
          <thead>
            <tr>
              <th className="sticky-name">{view === 'day' ? 'Employee' : 'Day'}</th>
              <th title="The day's attendance mark">Mark</th>
              {TIME_FIELDS.map((field) => (
                <th key={field}>{TIME_LABELS[field]}</th>
              ))}
              <th title="Out − in, less the lunch break">Worked</th>
              <th title="Against the day's expected hours">+ / −</th>
              {view === 'day' && <th title="Hours worked so far this month">Month so far</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <TimeRow
                key={line.key}
                line={line}
                period={period}
                view={view}
                locked={locked}
                entry={entryOf(line.row, line.day)}
                read={readDay(line.row, line.day)}
                onSet={(patch) => setTimes(line.row.employee_id, line.day, patch)}
                onClear={() => clearDay(line.row, line.day)}
              />
            ))}
            {!lines.length && (
              <tr>
                <td colSpan={view === 'day' ? 10 : 9} className="empty">
                  Nobody to show. Add employees under <strong>Employees</strong> first.
                </td>
              </tr>
            )}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr>
                <td className="sticky-name">
                  {shown.days} day{shown.days === 1 ? '' : 's'} with times
                </td>
                <td colSpan={5} />
                <td className="num grand">{formatDuration(shown.worked)}</td>
                <td className="num">
                  {shown.short > 0 && <span className="deduct">−{formatDuration(shown.short)}</span>}
                  {shown.short > 0 && shown.overtime > 0 && ' '}
                  {shown.overtime > 0 && <span>+{formatDuration(shown.overtime)}</span>}
                  {!shown.short && !shown.overtime && '-'}
                </td>
                <td colSpan={view === 'day' ? 2 : 1} />
              </tr>
            </tfoot>
          )}
        </table>
      </ScrollFrame>

      <p className="muted small">
        Worked hours are <strong>out − in, less the lunch break</strong>. Anything more or less than
        the day's {days(period.hours_per_day)} hours goes into that day's OT/LT minutes, which the
        salary sheet pays or deducts at the per-minute rate — a few minutes either way is ignored.
        {/* Half of the month's OWN day, not a fixed 4½ - that was only right
            because the default day is nine, and the note went stale the
            moment the day changed. */}
        A day under {formatDuration(Math.round(((Number(period.hours_per_day) || 9) * 60) / 2))} is
        marked <strong>HF</strong> and paid at half, so its short hours are
        not charged again. Marks that were set on purpose — leave, a holiday, a Sunday — are left
        as they are.
      </p>
    </section>
  );
}

function TimeRow({ line, period, view, locked, entry, read, onSet, onClear }) {
  const mark = String(entry.code || '').toUpperCase();
  const monthly = useMemo(() => {
    if (view !== 'day') return null;
    const stored = line.row.attendance || {};
    return monthTotals(Object.values(stored), { hoursPerDay: period.hours_per_day });
  }, [line.row.attendance, period.hours_per_day, view]);

  /*
   * A DAY SOMEBODY STARTED AND DID NOT FINISH.
   *
   * In at 09:30 and no out time is not an empty day and not a complete one -
   * it is the row that has to be gone back to. It was indistinguishable from
   * a blank row, so it got missed until the hours came out wrong.
   */
  const halfTyped = !!(entry.in_time && !entry.out_time);

  return (
    <tr
      className={[line.sunday ? 'sunday-row' : '', halfTyped ? 'part-row' : '']
        .filter(Boolean)
        .join(' ') || undefined}
    >
      <td className="sticky-name">
        {line.label}
        {line.sub && <span className="hint">{line.sub}</span>}
      </td>
      <td className="num muted" title={ATTENDANCE_CODES[mark]?.label || 'No mark yet'}>
        {mark || '·'}
      </td>
      {TIME_FIELDS.map((field) => (
        <td key={field} className={entry[field] ? 'has-time' : undefined}>
          <TimeInput
            value={entry[field] || ''}
            disabled={locked}
            label={TIME_LABELS[field]}
            onCommit={(next) => onSet({ [field]: next })}
          />
        </td>
      ))}
      <td className="num strong">{read.worked === null ? '-' : formatDuration(read.worked)}</td>
      <td className={`num${read.minutes < 0 ? ' deduct' : ''}`}>
        {read.minutes ? `${read.minutes > 0 ? '+' : '−'}${Math.abs(read.minutes)}m` : '-'}
      </td>
      {view === 'day' && (
        <td className="num muted" title={`${monthly.days} days with times`}>
          {monthly.days ? formatDuration(monthly.worked) : '-'}
        </td>
      )}
      <td className="time-flags">
        {/*
          * SAY WHAT IS WRONG, not "check".
          *
          * The reason was already worked out and put in the tooltip, while
          * the pill said "check" on every one of them - so the whole column
          * read the same whether somebody had forgotten to clock out or had
          * typed a nineteen-hour day. Dinesh: *"improve missing-time
          * indicators"*. The full sentence stays on hover.
          */}
        {read.warning ? (
          <span
            className={`pill ${/^no (in|out) time$/.test(read.warning) ? 'warn-pill' : 'error-pill'}`}
            title={read.warning}
          >
            {read.warning === 'no out time'
              ? 'no out'
              : read.warning === 'no in time'
                ? 'no in'
                : read.warning.startsWith('only one lunch')
                  ? 'half lunch'
                  : read.warning.startsWith('the lunch break is longer')
                    ? 'long lunch'
                    : 'check'}
          </span>
        ) : (
          read.overnight && <span className="pill" title="Read as finishing after midnight">+1 day</span>
        )}
        {(read.worked !== null || entry.in_time || entry.out_time) && !locked && (
          <button className="ghost tiny" title="Clear this day's times" onClick={onClear}>
            clear
          </button>
        )}
      </td>
    </tr>
  );
}

/**
 * One clock time. Takes 9:30, 930, 9.30, 9, 6pm and 18:30, and tidies whatever
 * was typed into HH:MM when the box is left. Anything it cannot read is put
 * back rather than saved as a blank hour.
 */
function TimeInput({ value, disabled, label, onCommit }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  const commit = () => {
    setFocused(false);
    const text = draft.trim();
    if (text === (value || '')) return;
    if (text === '') return onCommit('');
    const parsed = parseTime(text);
    if (parsed === null) {
      setDraft(value);
      return;
    }
    const tidy = formatTime(parsed);
    setDraft(tidy);
    onCommit(tidy);
  };

  return (
    <input
      className="cell-input time-input"
      inputMode="numeric"
      disabled={disabled}
      placeholder="--:--"
      aria-label={label}
      title={`${label} — type 9:30, 930 or 6pm`}
      value={draft}
      onFocus={(e) => {
        setFocused(true);
        e.target.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.target.blur();
        if (e.key === 'Escape') {
          setDraft(value);
          e.target.blur();
        }
      }}
    />
  );
}
