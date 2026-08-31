import { useEffect, useMemo, useRef, useState } from 'react';
import {
  absentDaysFromAttendance,
  countMarks,
  minutesFromAttendance,
  sundaysFromAttendance,
} from '../../../shared/calc.js';
import { days, daysInMonth, isSunday, weekday } from '../format.js';

/**
 * The day-by-day grid from the left of the sheet.
 *
 * Clicking a day opens a menu: the marks by name - Present, Absent, Paid Leave
 * and so on - and below them the short hours or overtime for that day. Minutes
 * add up across the month into the OT/LT column, where they are paid or
 * deducted at the per-minute rate.
 */

/** Preset amounts of short time, the ones that actually come up. */
const MINUTE_PRESETS = [15, 30, 40, 45, 60, 90, 120];

export default function Attendance({ period, rows, codes, onSave, locked }) {
  const [draft, setDraft] = useState({}); // "employeeId:day" -> { code, minutes }
  const [query, setQuery] = useState('');
  const [picker, setPicker] = useState(null); // { employeeId, day, name }
  const [dayMarker, setDayMarker] = useState(null); // a whole day, for many people
  const [status, setStatus] = useState('');
  const saveTimer = useRef(null);

  const total = daysInMonth(period.year, period.month);
  const monthName = new Date(period.year, period.month - 1, 1).toLocaleString('en-IN', { month: 'long' });
  const dayList = useMemo(() => Array.from({ length: total }, (_, i) => i + 1), [total]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.employee_name.toLowerCase().includes(q) || (r.company_name || '').toLowerCase().includes(q)
    );
  }, [rows, query]);

  const entryOf = (row, day) => {
    const key = `${row.employee_id}:${day}`;
    if (key in draft) return draft[key];
    const stored = row.attendance?.[day];
    if (!stored) return { code: '', minutes: 0 };
    // The server sends { code, minutes }; a bare code is still understood.
    return typeof stored === 'object' ? stored : { code: stored, minutes: 0 };
  };

  /** Marks as they stand including unsaved edits, for the live counts. */
  const effectiveAttendance = (row) => {
    const merged = {};
    for (const day of dayList) {
      const entry = entryOf(row, day);
      if (entry.code || entry.minutes) merged[day] = entry;
    }
    return merged;
  };

  const queueSave = (next) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const entries = Object.entries(next).map(([key, entry]) => {
        const [employee_id, day] = key.split(':');
        return { employee_id: Number(employee_id), day: Number(day), ...entry };
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

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  useEffect(() => {
    if (!picker) return undefined;
    const onKey = (e) => e.key === 'Escape' && setPicker(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picker]);

  const setEntry = (employeeId, day, patch) => {
    if (locked) return;
    const key = `${employeeId}:${day}`;
    const row = rows.find((r) => r.employee_id === employeeId);
    const current = row ? entryOf(row, day) : { code: '', minutes: 0 };
    const entry = { ...current, ...patch };
    entry.code = String(entry.code || '').trim().toUpperCase();
    entry.minutes = Number(entry.minutes) || 0;
    if (entry.code && !codes[entry.code]) return; // ignore anything not in the legend
    const next = { ...draft, [key]: entry };
    setDraft(next);
    queueSave(next);
  };

  /** Mark a whole row, skipping days that already carry a mark. */
  const fillRow = (row, code) => {
    if (locked) return;
    const next = { ...draft };
    for (const day of dayList) {
      const entry = entryOf(row, day);
      if (entry.code) continue;
      if (code === 'S' && !isSunday(period.year, period.month, day)) continue;
      next[`${row.employee_id}:${day}`] = { ...entry, code };
    }
    setDraft(next);
    queueSave(next);
  };

  const clearRow = (row) => {
    if (locked) return;
    const next = { ...draft };
    for (const day of dayList) next[`${row.employee_id}:${day}`] = { code: '', minutes: 0 };
    setDraft(next);
    queueSave(next);
  };

  /**
   * One day, many people - a festival holiday that only some of the staff take,
   * a strike, a day the office shut. Unlike the row and grid fills, this one
   * can be told to replace marks that are already there, because it is usually
   * run after everybody has been marked Present.
   */
  const markDay = (day, code, employeeIds, replaceExisting) => {
    if (locked) return 0;
    const next = { ...draft };
    let changed = 0;
    for (const employeeId of employeeIds) {
      const row = rows.find((r) => r.employee_id === employeeId);
      if (!row) continue;
      const entry = entryOf(row, day);
      if (entry.code && !replaceExisting) continue;
      if (entry.code === code) continue;
      next[`${employeeId}:${day}`] = { ...entry, code };
      changed++;
    }
    if (!changed) return 0;
    setDraft(next);
    queueSave(next);
    return changed;
  };

  /**
   * Mark everybody on screen Present in one go - the usual starting point for a
   * month, where most people worked most days and only the exceptions need
   * marking afterwards. Days that already carry a mark are left alone, so this
   * is safe to press again later in the month, and Sundays are marked S rather
   * than Present. Only the employees currently listed are touched, so a search
   * narrows it.
   */
  const markEveryonePresent = () => {
    if (locked) return;
    const blanks = filtered.reduce(
      (count, row) => count + dayList.filter((day) => !entryOf(row, day).code).length,
      0
    );
    if (!blanks) {
      setStatus('Every day already has a mark');
      setTimeout(() => setStatus(''), 2500);
      return;
    }
    const scope = filtered.length === rows.length ? 'all' : 'the';
    const ok = window.confirm(
      `Mark ${blanks} blank day${blanks === 1 ? '' : 's'} across ${scope} ${filtered.length} ` +
        `employee${filtered.length === 1 ? '' : 's'} as Present?\n\n` +
        'Sundays are marked S (off). Days that already have a mark are left as they are.'
    );
    if (!ok) return;

    const next = { ...draft };
    for (const row of filtered) {
      for (const day of dayList) {
        const entry = entryOf(row, day);
        if (entry.code) continue;
        next[`${row.employee_id}:${day}`] = {
          ...entry,
          code: isSunday(period.year, period.month, day) ? 'S' : 'P',
        };
      }
    }
    setDraft(next);
    queueSave(next);
  };

  return (
    <section>
      <div className="toolbar">
        <input
          className="search"
          placeholder="Search employee"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="primary" disabled={locked} onClick={markEveryonePresent}>
          Mark everyone Present
        </button>
        <span className="muted small">Click any day to set the mark and its short hours.</span>
        <span className="grow" />
        {status && <span className="pill saving">{status}</span>}
        {locked && <span className="pill locked">Locked</span>}
      </div>

      <div className="table-wrap dense">
        <table className="sheet attendance">
          <thead>
            <tr>
              <th className="sticky-name">Employee</th>
              {dayList.map((d) => (
                <th key={d} className={isSunday(period.year, period.month, d) ? 'sunday' : undefined}>
                  <button
                    className="day-head"
                    disabled={locked}
                    title={`Mark ${d} ${monthName} for a whole group at once - a festival holiday, say`}
                    onClick={() => setDayMarker(d)}
                  >
                    <span className="dow">{weekday(period.year, period.month, d)}</span>
                    <span>{d}</span>
                  </button>
                </th>
              ))}
              <th title="Days of salary these marks cost">Absent</th>
              <th title="Paid leave taken">PL</th>
              <th title="Unpaid leave taken">UL</th>
              <th title="Sundays and holidays worked">Sun</th>
              <th title="Short hours (negative) and overtime (positive) for the month">Minutes</th>
              <th>Whole row</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const merged = effectiveAttendance(row);
              const counts = countMarks(merged);
              const minutes = minutesFromAttendance(merged);
              return (
                <tr key={row.employee_id}>
                  <td className="sticky-name" title={row.company_name}>{row.employee_name}</td>
                  {dayList.map((d) => {
                    const entry = entryOf(row, d);
                    const open = picker?.employeeId === row.employee_id && picker?.day === d;
                    return (
                      <td key={d} className={`mark${isSunday(period.year, period.month, d) ? ' sunday' : ''}`}>
                        <button
                          type="button"
                          className={`mark-cell code-${entry.code || 'none'}${open ? ' open' : ''}`}
                          disabled={locked}
                          title={
                            [
                              entry.code ? codes[entry.code]?.label : 'No mark - counted as worked',
                              entry.minutes ? `${entry.minutes > 0 ? '+' : ''}${entry.minutes} minutes` : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')
                          }
                          onClick={() =>
                            setPicker(open ? null : { employeeId: row.employee_id, day: d, name: row.employee_name })
                          }
                          onKeyDown={(e) => {
                            // Typing a code still works: "a" for Absent, "p" for Present.
                            if (!/^[a-z]$/i.test(e.key)) return;
                            const typed = e.key.toUpperCase();
                            const match = codes[typed] ? typed : Object.keys(codes).find((c) => c.startsWith(typed));
                            if (match) {
                              e.preventDefault();
                              setEntry(row.employee_id, d, { code: match });
                            }
                          }}
                        >
                          <span className="mark-code">{entry.code || '·'}</span>
                          {entry.minutes !== 0 && (
                            <span className={`mark-minutes${entry.minutes < 0 ? ' short' : ' extra'}`}>
                              {entry.minutes > 0 ? `+${entry.minutes}` : entry.minutes}
                            </span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                  <td className="num strong">{days(absentDaysFromAttendance(merged))}</td>
                  <td className="num">{counts.PL || '-'}</td>
                  <td className="num">{counts.UL || '-'}</td>
                  <td className="num">{days(sundaysFromAttendance(merged))}</td>
                  <td className={`num strong${minutes < 0 ? ' deduct' : ''}`}>
                    {minutes ? `${minutes > 0 ? '+' : ''}${minutes}` : '-'}
                  </td>
                  <td className="row-fill">
                    <select
                      value=""
                      disabled={locked}
                      onChange={(e) => {
                        if (e.target.value === '__clear') clearRow(row);
                        else if (e.target.value) fillRow(row, e.target.value);
                        e.target.value = '';
                      }}
                    >
                      <option value="">Fill blanks…</option>
                      {Object.entries(codes).map(([code, meta]) => (
                        <option key={code} value={code}>{meta.label}</option>
                      ))}
                      <option value="__clear">Clear the row</option>
                    </select>
                  </td>
                </tr>
              );
            })}
            {!filtered.length && (
              <tr>
                <td colSpan={total + 7} className="empty">No employees in this month yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {picker && (() => {
        const row = rows.find((r) => r.employee_id === picker.employeeId);
        if (!row) return null;
        return (
          <DayPicker
            codes={codes}
            picker={picker}
            period={period}
            entry={entryOf(row, picker.day)}
            perMinute={row.per_minute}
            onChange={(patch) => setEntry(picker.employeeId, picker.day, patch)}
            onClose={() => setPicker(null)}
          />
        );
      })()}

      {dayMarker && (
        <DayMarker
          codes={codes}
          day={dayMarker}
          period={period}
          rows={rows}
          entryOf={entryOf}
          onApply={markDay}
          onClose={() => setDayMarker(null)}
        />
      )}

      <div className="legend card">
        <strong>What each mark does to the salary</strong>
        <ul>
          {Object.entries(codes).map(([code, meta]) => (
            <li key={code}>
              <span className={`brush code-${code}`}>{code}</span>
              <span>{meta.label}</span>
              <em>
                {meta.absent > 0
                  ? `−${meta.absent} day${meta.absent === 1 ? '' : 's'} salary`
                  : meta.sunday > 0
                    ? "+1 day's pay"
                    : 'no change'}
              </em>
            </li>
          ))}
        </ul>
        <p className="muted small">
          A day left blank counts as worked. <strong>Paid Leave</strong> costs nothing;{' '}
          <strong>Unpaid Leave</strong> deducts a day, the same as Absent, but is counted separately.
        </p>
        <p className="muted small">
          <strong>Click a date in the header</strong> to mark that one day for a whole group at
          once — a festival holiday that only some of the staff take, for instance. Pick the mark,
          then pick who it applies to: everyone, a group, or names off a list.
        </p>
        <p className="muted small">
          <strong>Mark everyone Present</strong> fills every blank day for everybody on screen at
          once — Sundays as S, the rest as Present — so a month starts from "everyone worked" and
          only the exceptions need marking. It never overwrites a day that already has a mark, and
          a search narrows it to just those employees.
        </p>
        <p className="muted small">
          <strong>Short hours</strong> are set per day in the same menu — 30, 40, 60 minutes and so
          on. They add up over the month and come off at the per-minute rate
          (salary ÷ working days ÷ hours per day ÷ 60), so an hour short costs exactly an hour's pay.
          Overtime works the same way with a plus.
        </p>
      </div>
    </section>
  );
}

/**
 * One day, many people.
 *
 * Festival holidays are the reason this exists: Eid is a paid holiday for some
 * of the staff and an ordinary working day for the rest, so "mark everyone" is
 * the wrong tool. Pick the mark, then pick who - everyone shown, a group, or
 * names ticked off a list.
 */
function DayMarker({ codes, day, period, rows, entryOf, onApply, onClose }) {
  const [code, setCode] = useState('PH');
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [chosen, setChosen] = useState(() => new Set(rows.map((r) => r.employee_id)));
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const names = new Set();
    for (const row of rows) if (row.group_name) names.add(row.group_name);
    return [...names].sort();
  }, [rows]);

  const listed = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.employee_name.toLowerCase().includes(q) ||
        (r.company_name || '').toLowerCase().includes(q) ||
        (r.group_name || '').toLowerCase().includes(q)
    );
  }, [rows, query]);

  const toggle = (id) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  };

  const selectOnly = (ids) => setChosen(new Set(ids));

  // What pressing Apply would actually do, so it is never a surprise.
  const picked = rows.filter((r) => chosen.has(r.employee_id));
  const already = picked.filter((r) => {
    const existing = entryOf(r, day).code;
    return existing && existing !== code;
  });
  const willChange = replaceExisting
    ? picked.filter((r) => entryOf(r, day).code !== code).length
    : picked.filter((r) => !entryOf(r, day).code).length;

  const label = `${weekday(period.year, period.month, day)} ${day} ${new Date(
    period.year,
    period.month - 1,
    1
  ).toLocaleString('en-IN', { month: 'long' })}`;

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div className="picker day-marker card" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <strong>{label}</strong>
          <span className="muted small">Mark this one day for several people at once</span>
        </div>

        <label className="field">
          Mark
          <select value={code} onChange={(e) => setCode(e.target.value)}>
            {Object.entries(codes).map(([value, meta]) => (
              <option key={value} value={value}>
                {meta.label}
                {meta.absent > 0 ? ` (−${meta.absent} day${meta.absent === 1 ? '' : 's'})` : ''}
                {meta.sunday > 0 ? " (+1 day's pay)" : ''}
              </option>
            ))}
          </select>
        </label>

        <div className="who">
          <div className="who-head">
            <strong>Who</strong>
            <span className="muted small">{chosen.size} of {rows.length} chosen</span>
          </div>
          <div className="who-shortcuts">
            <button onClick={() => selectOnly(rows.map((r) => r.employee_id))}>Everyone</button>
            <button onClick={() => selectOnly([])}>Nobody</button>
            {groups.map((name) => (
              <button
                key={name}
                title={`Everyone in the ${name} group`}
                onClick={() => selectOnly(rows.filter((r) => r.group_name === name).map((r) => r.employee_id))}
              >
                {name}
              </button>
            ))}
          </div>
          <input
            className="search"
            placeholder="Search to narrow the list"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="who-list">
            {listed.map((row) => (
              <li key={row.employee_id}>
                <label>
                  <input
                    type="checkbox"
                    checked={chosen.has(row.employee_id)}
                    onChange={() => toggle(row.employee_id)}
                  />
                  <span>{row.employee_name}</span>
                  <span className="muted small">
                    {row.group_name || row.company_name}
                    {entryOf(row, day).code ? ` · now ${entryOf(row, day).code}` : ''}
                  </span>
                </label>
              </li>
            ))}
            {!listed.length && <li className="muted small">Nobody matches that.</li>}
          </ul>
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={replaceExisting}
            onChange={(e) => setReplaceExisting(e.target.checked)}
          />
          Replace marks already on this day
          {already.length > 0 && <span className="muted small"> ({already.length} would change)</span>}
        </label>

        <div className="button-row">
          <button
            className="primary"
            disabled={!willChange}
            onClick={() => {
              onApply(day, code, [...chosen], replaceExisting);
              onClose();
            }}
          >
            {willChange
              ? `Mark ${willChange} ${willChange === 1 ? 'person' : 'people'} ${codes[code]?.label}`
              : 'Nothing to change'}
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/** The menu for one day: the mark by name, then that day's short hours. */
function DayPicker({ codes, picker, period, entry, perMinute, onChange, onClose }) {
  const [custom, setCustom] = useState('');
  const date = new Date(period.year, period.month - 1, picker.day);
  const rate = Number(perMinute) || 0;
  const cost = (mins) => Math.round(Math.abs(mins) * rate);

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div className="picker card" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <strong>{picker.name}</strong>
          <span className="muted small">
            {weekday(period.year, period.month, picker.day)} {picker.day}{' '}
            {date.toLocaleString('en-IN', { month: 'long' })}
          </span>
        </div>

        <ul className="picker-list">
          {Object.entries(codes).map(([code, meta]) => (
            <li key={code}>
              <button
                type="button"
                className={entry.code === code ? 'active' : undefined}
                onClick={() => onChange({ code })}
              >
                <span className={`brush code-${code}`}>{code}</span>
                <span className="picker-label">{meta.label}</span>
                <span className="picker-effect">
                  {meta.absent > 0
                    ? `−${meta.absent} day${meta.absent === 1 ? '' : 's'}`
                    : meta.sunday > 0
                      ? '+1 day'
                      : '—'}
                </span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className={!entry.code ? 'active clear' : 'clear'}
              onClick={() => onChange({ code: '' })}
            >
              <span className="brush">✕</span>
              <span className="picker-label">No mark</span>
              <span className="picker-effect">—</span>
            </button>
          </li>
        </ul>

        <div className="picker-minutes">
          <div className="picker-minutes-head">
            <strong>Short hours this day</strong>
            {entry.minutes !== 0 && (
              <span className={entry.minutes < 0 ? 'deduct' : 'muted'}>
                {entry.minutes > 0 ? `+${entry.minutes} min overtime` : `${-entry.minutes} min short`}
                {rate > 0 && ` · ₹${cost(entry.minutes)}`}
              </span>
            )}
          </div>

          <div className="minute-presets">
            {MINUTE_PRESETS.map((mins) => (
              <button
                type="button"
                key={mins}
                className={entry.minutes === -mins ? 'active' : undefined}
                title={rate > 0 ? `Deducts about ₹${cost(mins)}` : undefined}
                onClick={() => onChange({ minutes: entry.minutes === -mins ? 0 : -mins })}
              >
                −{mins}
              </button>
            ))}
            <button
              type="button"
              className={entry.minutes === 0 ? 'active' : undefined}
              onClick={() => onChange({ minutes: 0 })}
            >
              None
            </button>
          </div>

          <div className="inline-form minute-custom">
            <label>
              Or type minutes
              <input
                inputMode="numeric"
                placeholder="e.g. 25"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  const mins = Math.abs(Number(custom));
                  if (Number.isFinite(mins) && mins > 0) {
                    onChange({ minutes: -mins });
                    setCustom('');
                  }
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                const mins = Math.abs(Number(custom));
                if (Number.isFinite(mins) && mins > 0) {
                  onChange({ minutes: -mins });
                  setCustom('');
                }
              }}
            >
              Deduct
            </button>
            <button
              type="button"
              onClick={() => {
                const mins = Math.abs(Number(custom));
                if (Number.isFinite(mins) && mins > 0) {
                  onChange({ minutes: mins });
                  setCustom('');
                }
              }}
            >
              Overtime
            </button>
          </div>

          <p className="muted small">
            {rate > 0
              ? `One minute is worth ₹${rate.toFixed(2)} for this employee.`
              : 'Set the salary first to see what a minute is worth.'}
          </p>
        </div>

        <button className="picker-done primary" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
