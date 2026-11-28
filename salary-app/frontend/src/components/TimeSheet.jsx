import { useEffect, useMemo, useRef, useState } from 'react';
import { ATTENDANCE_CODES, STANDARD_WORKING_DAYS } from '../../../shared/calc.js';
import {
  dayNotFinished,
  dayGrace,
  formatDuration,
  formatTime,
  hasTimes,
  minutesForMark,
  monthTotals,
  parseTime,
  readTimes,
  TIME_FIELDS,
  TIME_LABELS,
  timesToDay,
} from '../../../shared/timesheet.js';
import { MONTHS, days, daysInMonth, isSunday, rupees, weekday } from '../format.js';
import { shiftOfMonth, writeStandardTimes } from '../standardTimes.js';
import LatePolicy from './LatePolicy.jsx';
import MonthlyHours from './MonthlyHours.jsx';
import { fillTimesFor, hasOwnShift, hoursForEmployee, shiftLengthProblem } from '../../../shared/lateEarly.js';
import { OFF_DAY_MAY_BECOME, SUNDAY_MARKS, offDayVerdict, ownWeeklyOff } from '../../../shared/sundayDuty.js';
import TimeCalendar from './TimeCalendar.jsx';
import { punchTimes, showPunches } from '../../../shared/punchLog.js';
import ScrollFrame from './ScrollFrame.jsx';
import PunchImport from './PunchImport.jsx';
import { STANDALONE, api } from '../api.js';
import { usualFillDays } from '../../../shared/usualFill.js';

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

export default function TimeSheet({ period, rows, onSave, onPatchPeriod, locked, onReload, openAt = null, onOpened = null }) {
  const total = daysInMonth(period.year, period.month);
  const today = new Date();
  const isThisMonth = today.getFullYear() === period.year && today.getMonth() + 1 === period.month;

  const [view, setView] = useState('day'); // 'day' = everybody today, 'month' = one person
  const [day, setDay] = useState(isThisMonth ? today.getDate() : 1);
  const [personId, setPersonId] = useState(rows[0]?.employee_id || null);

  /*
   * One press from a name on the day view to that person's whole month. It
   * sets the SAME two pieces of state the toggle and the select above set,
   * rather than growing a third way of saying which person is on screen.
   */
  const openPerson = (id) => {
    setPersonId(id);
    setView('month');
  };

  /*
   * ARRIVING FROM THE MISSING PUNCH REPORT, at one person on one day.
   *
   * Dinesh: *"kisi ka punch missing he to manually kaise log hoga"*. That
   * report names the person and the day and then left you to remember both,
   * switch tab and find them again. It opens their MONTH, not the day view,
   * because the day it is about is one row of it and the rest of the month
   * is the context for judging the time - including that day's punches.
   *
   * It calls `openPerson`, the same two pieces of state everything else on
   * this screen sets, and then clears the request so an ordinary visit to
   * the tab does not jump anywhere.
   */
  useEffect(() => {
    if (!openAt?.employee_id) return;
    openPerson(openAt.employee_id);
    if (openAt.day) setDay(Number(openAt.day));
    onOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAt?.employee_id, openAt?.day]);
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
  // The own-shift and lunch notes under the strip, folded by default.
  const [showNotes, setShowNotes] = useState(false);
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

  /* Judged against THEIR day, not the office's: the length of their own
     shift where they have one. The same rule the server writes the minutes
     with, so this screen and the payslip cannot disagree. */
  const hoursOf = (row) => hoursForEmployee(row, { period });

  /*
   * THE MONTH'S OWN ANSWER ON WHETHER THE BREAK COMES OFF THE DAY.
   *
   * This screen never asked. `timesToDay` and `minutesForMark` both default
   * to deducting, so on a month with "Lunch is inside the day" ticked - which
   * is how this office runs - the Time tab showed 8h 20m and -40m for a
   * nine-hour day, AND SAVED IT: the tab sends `minutes`, and a caller that
   * names minutes beats the server's own figure.
   *
   * `calc.js`, `db.js` and `localStore.js` all read `period.lunch_paid`
   * already. This screen was the one that did not, and it is the one people
   * type into.
   */
  const deductLunch = !period.lunch_paid;
  /*
   * How many minutes a day may be out before the + / - column counts it.
   * Held per month, so a figure changed now never rewrites a month already
   * paid. Dinesh, looking at a column of dashes: *"kuch logo me +- minutes
   * kyu nahi aa rahi he"* - every one of those days was inside this.
   */
  const grace = dayGrace(period);

  /*
   * THE SCREEN MUST SHOW WHAT THE SHEET CHARGES, not what the clock says on
   * its own. `timesToDay` knows the hours; only `minutesForMark` knows what
   * the day's MARK does with them - a shortfall on a Sunday, on leave or on a
   * holiday is not charged, and a day under half is already paid at half.
   *
   * Reading it without the mark showed ALIFAYA CHIKHALIWALA -219m against a
   * Sunday the payslip took nothing for. The same call now answers here, in
   * db.js, in localStore.js and in the import preview, so the four cannot
   * disagree.
   */
  const judge = (row, d) => {
    const entry = entryOf(row, d);
    const day = timesToDay(entry, { hoursPerDay: hoursOf(row), deductLunch, rules: { graceMinutes: grace } });
    return {
      ...day,
      minutes: minutesForMark(entry, {
        hoursPerDay: hoursOf(row),
        code: entry.code || day.code,
        deductLunch,
        graceMinutes: grace,
      }),
    };
  };

  const readDay = (row, d) => judge(row, d);

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
        const worked = timesToDay(merged, {
          hoursPerDay: hoursOf(row || {}),
          deductLunch,
          rules: { graceMinutes: grace },
        });
        const current = String(row?.attendance?.[d]?.code || '').toUpperCase();
        // Only a mark that says nothing in particular gives way to the clock.
        /* Their own weekly off is judged as one: six hours on it is a Sunday
           worked (SP, on the Sunday register), anything less is still the day
           off. Typed here it used to come out P or HF like any Tuesday - and
           HF docks half a day from somebody who came in on their day off. */
        const onOwnOff =
          !!row && !!merged.in_time && OFF_DAY_MAY_BECOME.has(current) && ownWeeklyOff(row, period, d);
        const code = onOwnOff
          ? offDayVerdict(merged, period).code
          : worked.code && AUTO_MARKS.has(current)
            ? worked.code
            : current;
        return {
          employee_id: employeeId,
          day: d,
          code,
          /* Judged by the MARK the day ends up with, not by the clock alone.
             Typing a time onto a Sunday used to write the shortfall against a
             nine-hour day - a deduction the import itself refuses to write. */
          minutes:
            worked.worked === null
              ? Number(row?.attendance?.[d]?.minutes) || 0
              : minutesForMark(merged, {
                  hoursPerDay: hoursOf(row || {}),
                  code,
                  deductLunch,
                  graceMinutes: grace,
                }),
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
  /*
   * "FILL THE USUAL TIMINGS" IS GONE (v2.37.0).
   *
   * Dinesh pressed it by mistake on a Saturday morning and every person not
   * yet punched read 09:30 -> 18:30, nine hours of a day nobody had worked:
   * *"need to revoke / remove this option also / no useful"*. Times come from
   * the punches, or are typed day by day. What it wrote can be taken back
   * below (usualFillDays) - the times only; the mark is left as it is.
   */

  const clearDay = (row, d) => setTimes(row.employee_id, d, Object.fromEntries(TIME_FIELDS.map((f) => [f, ''])));


  const person = rows.find((r) => r.employee_id === personId);

  /*
   * EVERY PUNCH OF THE DAY, HERE TOO.
   *
   * Dinesh, after the same thing was added to the attendance day menu: *"yaha
   * pe bhi sare log dekhne ka option do"*. The readers are door locks, so In
   * and Out are only the first and the last of six or eight openings, and this
   * is the screen the hours are read off.
   *
   * It is NOT a second opinion about the hours - those still come from the
   * first punch and the last, which is what the sheet is paid from.
   *
   * One person down the month is ONE request, so it is fetched as soon as the
   * tab opens. One day across eighty people would be eighty, so there it is
   * fetched per person when somebody asks.
   */
  const [punchBook, setPunchBook] = useState({});
  const wantPunches = async (employeeId) => {
    if (STANDALONE || !employeeId || punchBook[employeeId] !== undefined) return;
    setPunchBook((b) => ({ ...b, [employeeId]: null }));
    try {
      const got = await api.get(`/employees/${employeeId}/punches?period_id=${period.id}`);
      setPunchBook((b) => ({ ...b, [employeeId]: got }));
    } catch {
      setPunchBook((b) => ({ ...b, [employeeId]: { days: {}, matched_on: '', error: true } }));
    }
  };
  useEffect(() => {
    if (view !== 'day' && person?.employee_id) wantPunches(person.employee_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, person?.employee_id, period.id]);


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

  /*
   * WHAT "FILL THE USUAL TIMINGS" WROTE, and taking it back (v2.37.0).
   * The month's punch record decides it: times exactly the person's usual
   * ones with no punch behind them. Nothing is offered until the record has
   * answered, so a real 09:30 arrival is never cleared on a guess.
   */
  const [punchRecord, setPunchRecord] = useState(STANDALONE ? { known: false } : null);
  useEffect(() => {
    if (STANDALONE) return undefined;
    let alive = true;
    const month = `${period.year}-${String(period.month).padStart(2, '0')}`;
    api
      .get(`/punches/month?month=${month}`)
      .then((got) => alive && setPunchRecord({ known: true, punches: got?.punches || {} }))
      .catch(() => alive && setPunchRecord({ known: false }));
    return () => {
      alive = false;
    };
  }, [period.id, period.year, period.month]);
  const usualFilled = useMemo(
    () =>
      punchRecord
        ? usualFillDays(lines.map(({ row, day: d }) => ({ row, day: d })), {
            standard,
            entryOf,
            punches: punchRecord.known ? punchRecord.punches : null,
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, standard, punchRecord, draft]
  );
  const undoUsualFill = () => {
    if (locked || !usualFilled.length) return;
    const names = usualFilled
      .slice(0, 10)
      .map(({ row, day: d }) => (view === 'day' ? row.employee_name : `${d} ${MONTHS[period.month - 1]}`))
      .join(', ');
    const ok = window.confirm(
      `Clear the usual timings from ${usualFilled.length} day${usualFilled.length === 1 ? '' : 's'}?\n\n` +
        `${names}${usualFilled.length > 10 ? ` and ${usualFilled.length - 10} more` : ''}\n\n` +
        'Only the in, lunch and out times are cleared. The mark on the day (P, A…) is left as it is, ' +
        'and real punches arriving later fill the times in again.'
    );
    if (!ok) return;
    const blank = Object.fromEntries(TIME_FIELDS.map((f) => [f, '']));
    const next = { ...draft };
    for (const { row, day: d } of usualFilled) next[`${row.employee_id}:${d}`] = { ...blank };
    setDraft(next);
    queueSave(next);
  };

  /*
   * DAYS ALREADY STORED WITH ONE PUNCH IN BOTH COLUMNS.
   *
   * The importers stopped writing these, but a fix to the write path does
   * not reach back: whatever is on a day stays there until that day is saved
   * again. Dinesh: *"why in time and outtime same coming"* - because they
   * were written before, and clearing eighty of them one `clear` at a time
   * is why nobody would.
   *
   * It clears only the OUT time, naming it as '' so the per-field merge takes
   * it, and leaves the arrival, the mark and everything else alone. Nothing
   * is guessed: the departure is simply not known.
   */
  const onePunchDays = useMemo(() => {
    const found = [];
    for (const { row, day: d } of lines) {
      const at = entryOf(row, d);
      const inAt = String(at.in_time || '').trim();
      if (inAt && String(at.out_time || '').trim() === inAt) found.push({ row, day: d });
    }
    return found;
  }, [lines, draft]);

  const clearOnePunchOuts = async () => {
    if (!onePunchDays.length) return;
    const who = [...new Set(onePunchDays.map(({ row }) => row.employee_name))];
    if (
      !window.confirm(
        `${onePunchDays.length} day${onePunchDays.length === 1 ? '' : 's'} have the same minute ` +
          `in BOTH the in and the out column — one punch, not a day — for ${who.length} ` +
          `${who.length === 1 ? 'person' : 'people'}: ${who.slice(0, 4).join(', ')}` +
          `${who.length > 4 ? ' and others' : ''}.\n\n` +
          `Clear the OUT time on those days? The arrival, the mark and the hours already ` +
          `worked out stay as they are — the departure is simply not known, and the day ` +
          `lands on Reports → Missing punch to be typed in.`
      )
    )
      return;
    setStatus('Clearing…');
    try {
      await onSave(
        onePunchDays.map(({ row, day: d }) => ({ employee_id: row.employee_id, day: d, out_time: '' }))
      );
      setStatus('Cleared');
    } catch (err) {
      setStatus(err.message || 'could not be saved');
    }
  };

  /*
   * DAYS THE MONTH'S GRACE IS STILL FORGIVING.
   *
   * Dinesh, looking at a Time tab where every + / - read a dash: *"kuch logo
   * me +- minutes kyu nahi aa rahi he"*, then *"dikhavo"*. A month opened
   * from now counts every minute; a month already open keeps the quarter of
   * an hour it was run on, because nothing in this app rewrites a stored
   * value by itself.
   *
   * And a changed rule does not reach back: whatever is on a day stays until
   * that day is saved again — the one-punch lesson of v1.99.0 and the half
   * day of v2.2.0. So this sweeps the WHOLE MONTH, not the view: that tab
   * shows one day across everybody or one person down the month, and the
   * days are scattered through both.
   */
  const graceDays = useMemo(() => {
    if (grace === 0) return [];
    const found = [];
    for (const row of rows) {
      const att = row.attendance || {};
      for (let d = 1; d <= total; d += 1) {
        const entry = att[d];
        if (!entry || !hasTimes(entry)) continue;
        const code = String(entry.code || '').trim().toUpperCase();
        const now = Number(entry.minutes) || 0;
        const every = minutesForMark(entry, {
          hoursPerDay: hoursOf(row),
          code,
          deductLunch,
          graceMinutes: 0,
        });
        if (every !== now) found.push({ row, day: d, from: now, to: every });
      }
    }
    return found;
  }, [rows, total, grace, deductLunch, period]);

  const countEveryMinute = async () => {
    if (!graceDays.length) return;
    const who = new Set(graceDays.map(({ row }) => row.employee_name));
    const net = graceDays.reduce((t, g) => t + (g.to - g.from), 0);
    /*
     * What it costs, said plainly and differently per rule - because on the
     * month's own hours rule these minutes were ALREADY counted (that rule
     * reads the clock, not this column), so the screen changes and the pay
     * does not. Claiming otherwise either way would be the worse mistake.
     */
    const policy = String(period.late_policy || '').toLowerCase();
    const effect =
      policy === 'none'
        ? 'Nothing anybody is paid changes: this month pays from the days alone.'
        : policy === 'monthly' || policy === 'monthly_late'
          ? 'Nothing anybody is paid changes: this month is judged on its own total of ' +
            'hours, which has always counted every minute. Only the column changes.'
          : 'This month charges each day on its own, so these minutes WILL move the pay.';
    if (
      !window.confirm(
        `Count every minute on ${period.label}?\n\n` +
          `${graceDays.length} day${graceDays.length === 1 ? '' : 's'} across ${who.size} ` +
          `${who.size === 1 ? 'person' : 'people'} are inside the ${grace}-minute grace and ` +
          `read as a dash. Showing them comes to ${net > 0 ? '+' : ''}${net} minutes in all.\n\n` +
          `${effect}\n\nThe grace for this month goes to 0 and those days are worked out again.`
      )
    )
      return;
    setStatus('Counting…');
    try {
      await onPatchPeriod?.({ day_grace_minutes: 0 });
      await onSave(
        graceDays.map(({ row, day: d, to }) => ({ employee_id: row.employee_id, day: d, minutes: to }))
      );
      setStatus('Counted');
      onReload?.();
    } catch (err) {
      setStatus(err.message || 'could not be saved');
    }
  };

  /*
   * DAYS MARKED HALF A DAY WITH NO DEPARTURE ON THEM.
   *
   * The importer used to decide the mark from a last punch that was really
   * the return from lunch, then refuse to write that punch as an out time -
   * so a day still running came out HF. That is fixed where days are WRITTEN,
   * and a fix to the write path never reaches back: whatever is already on
   * the grid stays until the day is saved again.
   *
   * The condition is narrow on purpose. An arrival, no departure, and HF: a
   * half day somebody TYPED normally carries either both times or neither,
   * and this one has exactly the shape the old rule produced.
   */
  const halfDayNoOut = useMemo(() => {
    const found = [];
    /*
     * THE WHOLE MONTH, not just what is on screen.
     *
     * This tab shows one day across everybody, or one person down the month -
     * never both. The days the old rule spoiled are scattered through the
     * month and across the staff, and half a day's pay each is not something
     * to go hunting for one date at a time. So it scans every visible
     * person's whole month; the company filter still narrows who is counted,
     * because `filtered` is what it reads.
     */
    for (const row of filtered) {
      for (const d of dayList) {
        const at = entryOf(row, d);
        if (String(at.code || '').trim().toUpperCase() !== 'HF') continue;
        if (!String(at.in_time || '').trim()) continue;
        if (String(at.out_time || '').trim()) continue;
        found.push({ row, day: d });
      }
    }
    return found;
  }, [filtered, dayList, draft]);

  const clearHalfDayNoOut = async () => {
    if (!halfDayNoOut.length) return;
    const who = [...new Set(halfDayNoOut.map(({ row }) => row.employee_name))];
    if (
      !window.confirm(
        `${halfDayNoOut.length} day${halfDayNoOut.length === 1 ? '' : 's'} are marked HALF DAY ` +
          `with an arrival and no departure, for ${who.length} ` +
          `${who.length === 1 ? 'person' : 'people'}: ${who.slice(0, 4).join(', ')}` +
          `${who.length > 4 ? ' and others' : ''}.\n\n` +
          `Half a day cannot be worked out from hours nobody knows — that mark came from ` +
          `reading a return from lunch as a departure.\n\n` +
          `Mark those days PRESENT? THIS PAYS A FULL DAY where half was being paid. The ` +
          `times are left exactly as they are, and the days stay on Reports → Missing punch ` +
          `so the real departure can be typed in.`
      )
    )
      return;
    setStatus('Marking…');
    try {
      /* Only the mark. `setAttendance` merges per field, so the arrival, the
         lunch and the stored minutes are untouched. */
      await onSave(
        halfDayNoOut.map(({ row, day: d }) => ({ employee_id: row.employee_id, day: d, code: 'P' }))
      );
      setStatus('Marked present');
    } catch (err) {
      setStatus(err.message || 'could not be saved');
    }
  };

  /* How long the lunch break is, so "finish later" can add it back on. */
  const lunchMinutes = Math.max(
    0,
    (parseTime(standard.lunch_in) ?? 0) - (parseTime(standard.lunch_out) ?? 0),
  );

  /* What the usual timings come to against the day the month is paid on. */
  const usual = timesToDay(standard, {
    hoursPerDay: period.hours_per_day,
    deductLunch,
    rules: { graceMinutes: grace },
  });
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


  /*
   * How many of the people on screen work hours of their own. The Fill
   * button writes THEIR shift, not the office's, and a button that quietly
   * does two different things has to say so before it is pressed.
   *
   * DECLARED AFTER `lines`, which it reads. Putting it above crashed the
   * whole tab with "Cannot access 'M' before initialization" - the same
   * temporal-dead-zone trap `gapCost` hit, and the dashboard before that.
   */
  const ownShifts = useMemo(
    () =>
      new Set(
        lines.filter(({ row }) => hasOwnShift(row, standard)).map(({ row }) => row.employee_id)
      ).size,
    [lines, standard]
  );

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
        <>
          <LatePolicy period={period} rows={rows} onPatch={onPatchPeriod} locked={locked} />
          <MonthlyHours period={period} rows={rows} onPatch={onPatchPeriod} locked={locked} />
        </>
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
          {/*
            * THE CALENDAR, asked for by name: *"calcndr bana do usme sari
            * date k dikh ajyenge"*. Same person, same month, same figures -
            * laid out as weeks so thirty days are on one screen and a
            * pattern shows. The table stays, because twelve punches do not
            * fit in a calendar square; there they are one click away.
            */}
          <button
            role="tab"
            aria-selected={view === 'calendar'}
            className={view === 'calendar' ? 'on' : undefined}
            onClick={() => setView('calendar')}
          >
            One person, calendar
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

        {/* The undo for the button that used to be here. Only while there
            is something it wrote, on the days on screen. */}
        {usualFilled.length > 0 && !locked ? (
          <div className="ts-block">
            <button className="danger" onClick={undoUsualFill}>
              Undo the usual timings — {usualFilled.length} day{usualFilled.length === 1 ? '' : 's'}
            </button>
            <span className="muted small">
              times exactly the usual ones
              {punchRecord?.known ? ' with no punch behind them' : ' (no punch record here, so check the list)'}
            </span>
          </div>
        ) : null}

        {/* Its own block: dropped between the Fill button and its caption, it
            read as though "onto the days that have nothing on them" belonged
            to this one. Measured on screen. */}
        {onePunchDays.length > 0 && !locked ? (
          <div className="ts-block">
            <button className="ghost" onClick={clearOnePunchOuts}>
              Clear {onePunchDays.length} one-punch out time{onePunchDays.length === 1 ? '' : 's'}
            </button>
            <span className="muted small">
              in and out at the same minute — one punch, not a day
            </span>
          </div>
        ) : null}

        {graceDays.length > 0 && !locked ? (
          <div className="ts-block">
            <button className="ghost" onClick={countEveryMinute}>
              Count every minute &mdash; {graceDays.length} day
              {graceDays.length === 1 ? '' : 's'}
            </button>
            <span className="muted small">
              inside this month&rsquo;s {grace}-minute grace, so the + / &minus; column reads a
              dash on them
            </span>
          </div>
        ) : null}

        {halfDayNoOut.length > 0 && !locked ? (
          <div className="ts-block">
            <button className="ghost" onClick={clearHalfDayNoOut}>
              Mark {halfDayNoOut.length} half day{halfDayNoOut.length === 1 ? '' : 's'} present
              {halfDayNoOut.length === 1 ? '' : ''}
            </button>
            <span className="muted small">
              anywhere this month: marked HF with no out time — half a day off hours nobody knows
            </span>
          </div>
        ) : null}

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
          {(ownShifts > 0 || lunchEffect.days > 0) && usual.minutes === 0 ? (
            <button className="ghost tiny" onClick={() => setShowNotes((v) => !v)}>
              {showNotes ? 'hide how this works' : 'how this works'}
            </button>
          ) : null}
        </div>
      </div>

      {/*
        * The consequences, under the strip and not through it. The first of
        * these is the one that cost money: the shipped default was 45
        * minutes short of the nine-hour day, so one click docked every
        * person 45 minutes for a full day they had worked - invisible,
        * because nothing on screen ever added the timings up.
        */}
      {/*
        * SAYS SOMETHING, OR SAYS NOTHING.
        *
        * Dinesh: *"ye part bahut space kha raha he"*. On a month where
        * everything is in order this paragraph only repeated the strip
        * directly above it - the strip already shows `= 9h 00m` in green and
        * whether lunch comes off. So the agreeable case is now silent and the
        * paragraph does not render at all.
        *
        * WHAT IT MUST NEVER STOP SAYING is the disagreeing case: timings
        * short of the day the month is paid on docked every person every day,
        * about 1.66 lakh a month across 114 people, out of a mismatch nothing
        * on screen had ever stated.
        */}
      {/*
        * Second pass, same complaint (*"ye part bhaut jyada space kha rah a
        * he"*): the own-shift and lunch lines are information, not a warning,
        * so they live behind "how this works" now. Only the mismatch - which
        * costs money - still prints on its own.
        */}
      {(usual.minutes !== 0 || (showNotes && (ownShifts > 0 || lunchEffect.days > 0))) && (
        <p className="time-notes muted small">
          {ownShifts > 0 ? (
            <>
              <strong>{ownShifts}</strong> of the {lines.length} on screen have their own shift times
              on their record, so they are judged late, early and short against <em>their</em>
              hours and everybody else against the office day.{' '}
            </>
          ) : null}
          {usual.minutes !== 0 ? (
            <>
              <span className="warn-text">
                {usual.minutes < 0
                  ? `These timings are ${formatDuration(-usual.minutes)} SHORT of the ${formatDuration(usual.expected)} day, so a day worked on exactly these timings is docked ${formatDuration(-usual.minutes)}.`
                  : `These timings are ${formatDuration(usual.minutes)} OVER the ${formatDuration(usual.expected)} day, so a day worked on exactly these timings is paid that as overtime.`}
              </span>{' '}
              {lunchPaid
                ? 'Lunch times are recorded and NOT taken off the hours \u2014 the break sits inside the day.'
                : 'Lunch times are taken off the hours worked.'}{' '}
            </>
          ) : null}
          {lunchEffect.days
            ? `${lunchEffect.days} ${lunchEffect.days === 1 ? 'day' : 'days'} this month ${lunchEffect.days === 1 ? 'carries' : 'carry'} a lunch break, ${formatDuration(lunchEffect.minutes)} in all${lunchPaid ? ', which is inside the paid day' : ', taken off the hours'}.`
            : null}
        </p>
      )}

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
            month is paid on a <strong>{formatDuration(usual.expected)}</strong> day — so a day
            worked on exactly these timings is{' '}
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
              {/* A clock to pick from (v2.37.0). The office's day is stored as
                  HH:MM, which is what a time picker reads and writes. */}
              <input
                type="time"
                value={standard[field] || ''}
                onChange={(e) => setStandard({ ...standard, [field]: e.target.value })}
                onBlur={(e) => setStandard(writeStandardTimes({ ...standard, [field]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      )}

      {view === 'calendar' ? (
        <TimeCalendar
          period={period}
          person={person}
          judge={judge}
          entryOf={entryOf}
          punches={person ? punchBook[person.employee_id] : null}
          onOpenDay={(d) => {
            setDay(d);
            setView('day');
          }}
        />
      ) : (
      <ScrollFrame>
        <table className="sheet timesheet">
          <thead>
            <tr>
              {/*
                * THE DATE LIVES IN THE HEADER TOO.
                *
                * Dinesh compared a row off this tab with a row off the
                * attendance grid and asked how one person had two different
                * out times - they were two different days, and the date
                * picker had scrolled off the top of the screen. The table
                * header is sticky, so this is the one place the day cannot
                * scroll away from the rows it labels.
                *
                * Mirrored in the month view: there the first column IS the
                * day, so the useful thing to name is WHOSE month it is.
                */}
              <th className="sticky-name">
                {view === 'day' ? 'Employee' : 'Day'}
                <span className="hint">
                  {view === 'day'
                    ? `${weekday(period.year, period.month, day)} ${day} ${MONTHS[period.month - 1]}`
                    : person?.employee_name || ''}
                </span>
              </th>
              <th title="The day's attendance mark">Mark</th>
              {TIME_FIELDS.map((field) => (
                <th key={field}>{TIME_LABELS[field]}</th>
              ))}
              <th title={deductLunch ? 'Out − in, less the lunch break' : 'Out − in; the break sits inside the paid day'}>
                Worked
              </th>
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
                punches={punchBook[line.row.employee_id]}
                onWantPunches={() => wantPunches(line.row.employee_id)}
                onOpenPerson={view === 'day' ? () => openPerson(line.row.employee_id) : null}
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
      )}

      <p className="muted small">
        {/* It said "less the lunch break" on every month, including the ones
            that pay the break - contradicting the line at the top of the same
            screen. */}
        Worked hours are{' '}
        <strong>
          {deductLunch ? 'out − in, less the lunch break' : 'out − in; the break sits inside the paid day'}
        </strong>
        . Anything more or less than
        the day's {days(period.hours_per_day)} hours goes into that day's OT/LT minutes, which the
        salary sheet pays or deducts at the per-minute rate — a few minutes either way is ignored.{' '}
        {/* A JSX comment between two text lines swallows the whitespace, so
            this read "is ignored.A day under". The explicit space is the fix. */}
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

function TimeRow({
  line, period, view, locked, entry, read, onSet, onClear, punches, onWantPunches, onOpenPerson,
}) {
  const mark = String(entry.code || '').toUpperCase();
  const monthly = useMemo(() => {
    if (view !== 'day') return null;
    const stored = line.row.attendance || {};
    return monthTotals(Object.values(stored), {
      hoursPerDay: hoursForEmployee(line.row, { period }),
      deductLunch: !period.lunch_paid,
    });
  }, [line.row, period, view]);

  /*
   * A DAY SOMEBODY STARTED AND DID NOT FINISH.
   *
   * In at 09:30 and no out time is not an empty day and not a complete one -
   * it is the row that has to be gone back to. It was indistinguishable from
   * a blank row, so it got missed until the hours came out wrong.
   */
  const halfTyped = !!(entry.in_time && !entry.out_time);

  /* One person down the month arrives already loaded; one day across eighty
     people is fetched when somebody asks, so eighty rows are not eighty
     requests nobody wanted. */
  const dayPunches = punches?.days?.[line.day] || [];
  const askedFor = punches !== undefined;

  /*
   * STILL IN, not "no out".
   *
   * A day that cannot have finished yet has no departure on purpose - the
   * importer refuses to call a mid-day punch one. Reading that as "no out
   * time" puts everybody currently at work on the list of days to chase, and
   * a list of things to check that is mostly fine stops being read.
   *
   * The read side cannot tell on its own: the out column is simply empty.
   * This screen can, because it knows the day, the month and their shift.
   */
  const stillIn =
    !!entry.in_time &&
    !entry.out_time &&
    dayNotFinished({
      year: period.year,
      month: period.month,
      day: line.day,
      arrival: entry.in_time,
      hoursPerDay: hoursForEmployee(line.row, { period }),
      lunchMinutes: read.lunch,
      deductLunch: !period.lunch_paid,
    });

  return (
    <tr
      className={[line.sunday ? 'sunday-row' : '', halfTyped ? 'part-row' : '']
        .filter(Boolean)
        .join(' ') || undefined}
    >
      <td className="sticky-name">
        {/*
          * THE NAME IS THE WAY INTO THAT PERSON'S WHOLE MONTH.
          *
          * Dinesh: *"yaha pe name pe click kare to pure month ka in out
          * report dikhe wese karo"*. The view already existed - "One person,
          * whole month" is the toggle at the top - but reaching it meant
          * going back up and picking the name out of a select of eighty-five.
          * Thirteenth time for that shape: a feature you can only reach from
          * a control that does not look like one.
          *
          * Only in the day view: in the month view the label is a DATE, and
          * a date that opened somebody's month would be nonsense.
          */}
        {onOpenPerson ? (
          <button
            type="button"
            className="link"
            title={`${line.label} — every in and out this month`}
            onClick={onOpenPerson}
          >
            {line.label}
          </button>
        ) : (
          line.label
        )}
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
          {/*
            * HOW LONG THE BREAK WAS, under the minute they came back.
            *
            * Dinesh: *"lunch ka time bhi dikhavo kitni minute liya o"*. The
            * two clock times were there and the length was not, so reading it
            * meant subtracting in your head, eighty-six times.
            *
            * It says whether it comes OFF the hours, because that is the
            * whole of what it costs and it is the month's own setting: on a
            * month where the break sits inside the paid day the figure is a
            * record and nothing else.
            */}
          {field === 'lunch_in' && read.lunch > 0 ? (
            <span className="ts-lunch-len" title={read.lunchDeducted ? 'taken off the hours worked' : 'inside the paid day - not deducted'}>
              {formatDuration(read.lunch)}
              {read.lunchDeducted ? ' off' : ''}
            </span>
          ) : null}
          {/*
            * EVERY PUNCH, under the out time - the same place the attendance
            * statement and the employee's own page put it. Shown only where
            * In and Out do not between them account for them all, by the one
            * rule all three screens share.
            */}
          {field === 'out_time' && showPunches(entry, dayPunches) ? (
            <span className="ts-lunch-len punches" title="every punch the reader recorded - only the first and the last count towards the hours">
              {punchTimes(dayPunches)}
            </span>
          ) : null}
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
        {stillIn ? (
          <span className="pill warn-pill" title="Their day has not run its length yet, so the last punch is not a departure. The evening's pull writes the real one; nothing is charged meanwhile.">
            still in
          </span>
        ) : read.warning ? (
          <span
            className={`pill ${/^no (in|out) time$|^one punch|^back from lunch/.test(read.warning) ? 'warn-pill' : 'error-pill'}`}
            title={read.warning}
          >
            {read.warning.startsWith('back from lunch')
              ? 'still in'
              : read.warning.startsWith('one punch')
              ? 'one punch'
              : read.warning === 'no out time'
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
        {/* The way in, in the day view - where the whole month is not already
            loaded. It reads, it changes nothing. */}
        {view === 'day' && !askedFor && !STANDALONE && onWantPunches ? (
          <button className="ghost tiny" title="Show every punch the reader recorded that day" onClick={onWantPunches}>
            log
          </button>
        ) : null}
        {view === 'day' && askedFor && punches && !punches.matched_on ? (
          <span className="pill warn-pill" title="No punch ID on this employee, so no reader punch can reach them">
            no punch id
          </span>
        ) : null}
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
export function TimeInput({ value, disabled, label, onCommit }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  /*
   * A CLOCK TO PICK FROM, beside the box (v2.37.0, Dinesh: "give option for
   * select time, jaha pe bhi time dalna he"). Typing 930 stays - it is the
   * fastest way down eighty rows - and the clock opens the browser's own time
   * picker for anybody who would rather choose. Both end in the same commit,
   * so a picked time and a typed one are stored identically.
   */
  const picker = useRef(null);
  const parsedValue = parseTime(value);
  const openPicker = () => {
    const el = picker.current;
    if (!el || disabled) return;
    try {
      if (typeof el.showPicker === 'function') el.showPicker();
      else el.focus();
    } catch {
      el.focus();
    }
  };

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
    <span className="time-pick">
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
    <input
      ref={picker}
      type="time"
      className="time-pick-native"
      tabIndex={-1}
      aria-hidden="true"
      disabled={disabled}
      value={parsedValue === null ? '' : formatTime(parsedValue)}
      onChange={(e) => {
        const picked = e.target.value;
        if (!picked) return;
        setDraft(picked);
        if (picked !== (value || '')) onCommit(picked);
      }}
    />
    <button
      type="button"
      className="time-pick-btn"
      disabled={disabled}
      title={`Pick ${String(label || 'the time').toLowerCase()} from a clock`}
      aria-label={`Pick ${label || 'time'} from a clock`}
      onClick={openPicker}
    >
      {'\u{1F552}'}
    </button>
    </span>
  );
}
