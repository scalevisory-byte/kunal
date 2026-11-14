import { useEffect, useMemo, useState } from 'react';
import { STANDALONE, api } from '../api.js';
import { LEAVE_TYPES, calculateRow, totalRows } from '../../../shared/calc.js';
import { statutoryReport } from '../../../shared/statutory.js';
import { ATTENDANCE_CODES } from '../../../shared/calc.js';
import { attendancePercent } from '../../../shared/attendanceReport.js';
import {
  formatDuration,
  isEarlyOut,
  isLateIn,
  lateByMinutes,
  monthTotals,
  parseTime,
  readTimes,
} from '../../../shared/timesheet.js';
import { MONTHS, days, daysInMonth, isSunday, rupees, weekday } from '../format.js';
import Glyph from '../icons.jsx';
import { shiftOfMonth } from '../standardTimes.js';

/**
 * The month at a glance, on one screen.
 *
 * Nothing is entered here and nothing is calculated here that is not calculated
 * somewhere else - it reads the same rows the salary sheet does, through the
 * same engine, and puts the numbers Dinesh actually asks for in front of him:
 * what the month costs, what is still to pay, who is missing from attendance,
 * and what would stop a return from being filed.
 *
 * Every figure links to the tab it came from, so a number that looks wrong is
 * one click from the place it can be fixed.
 */
export default function Dashboard({
  period,
  periods = [],
  payroll,
  employees,
  companyId,
  companyName,
  onGo,
  onPeriod,
  onSaveAttendance,
  locked,
}) {
  const [leave, setLeave] = useState([]);
  const [history, setHistory] = useState([]); // the last few months, for the trend
  /*
   * The three things the brief asks this page for that it did not have: pending
   * approvals, an asset summary and maintenance alerts. All three are already
   * worked out elsewhere - the digest counts the queues, the maintenance engine
   * sorts the alerts - so this fetches and shows, and computes nothing itself.
   */
  const [waiting, setWaiting] = useState(null);
  const [assets, setAssets] = useState(null);
  const [day, setDay] = useState(null); // which day the roll call is showing
  const [showPresent, setShowPresent] = useState(false);
  const [showUniform, setShowUniform] = useState(false);
  // Which of the roll call's lists is on screen. 'late' is the one Dinesh
  // asked for by name; 'all' is the morning's whole list.
  const [bucket, setBucket] = useState('all');
  /* The register's own search and sort. Neither touches anything stored. */
  const [find, setFind] = useState('');
  const [sort, setSort] = useState({ by: '', dir: 1 });
  /* Which way the attendance trend is read: by day, by month, or by company. */
  const [trendBy, setTrendBy] = useState('daily');
  /* The register's own company and department narrowing, and its page. */
  const [regCompany, setRegCompany] = useState('');
  const [regDept, setRegDept] = useState('');
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!period) return undefined;
    api
      .get(`/leave?year=${period.year}`)
      .then(({ rows }) => !cancelled && setLeave(rows || []))
      // The leave register is a nice-to-have here; the rest of the page stands
      // on its own if it cannot be read.
      .catch(() => !cancelled && setLeave([]));
    return () => {
      cancelled = true;
    };
  }, [period?.id, period?.year]);

  /*
   * Both of these are nice-to-haves on this page: the standalone build has
   * neither, and if either cannot be read the rest of the dashboard stands.
   */
  useEffect(() => {
    let cancelled = false;
    if (STANDALONE) return undefined;
    api
      .get('/people/digest')
      .then((body) => !cancelled && setWaiting(body))
      .catch(() => !cancelled && setWaiting(null));
    api
      .get('/people/maintenance')
      .then((body) => !cancelled && setAssets(body))
      .catch(() => !cancelled && setAssets(null));
    return () => {
      cancelled = true;
    };
  }, [period?.id]);

  /**
   * The months either side of this one, so the trend and the comparison have
   * something to compare against. They are fetched whole and filtered here,
   * because the standalone file answers the payroll path without query
   * parameters - one code path for both builds.
   */
  useEffect(() => {
    let cancelled = false;
    if (!period || !periods.length) return undefined;
    const ordered = [...periods].sort((a, b) => a.year - b.year || a.month - b.month);
    const upto = ordered.filter((p) => p.year * 12 + p.month <= period.year * 12 + period.month);
    const wanted = upto.slice(-6);
    Promise.all(
      wanted.map((p) =>
        api
          // sync=false: this is a read of a month that may be long closed, and
          // looking at it must not pull today's new hires or loan instalments
          // back into it.
          .get(`/periods/${p.id}/payroll?sync=${p.id === period.id}`)
          .then((data) => ({ period: p, rows: data.rows || [] }))
          .catch(() => null)
      )
    ).then((got) => !cancelled && setHistory(got.filter(Boolean)));
    return () => {
      cancelled = true;
    };
  }, [period?.id, periods.length]);

  /*
   * Narrowed by the company filter, like every other tab. The roll call used
   * to read payroll.rows straight through, so choosing BOOKNFLY still listed
   * SCALE's absentees - the one screen where that filter did nothing.
   */
  const rows = useMemo(
    () =>
      (payroll?.rows || [])
        .filter((row) => !companyId || row.company_id === companyId)
        .map((row) => ({
          ...row,
          ...calculateRow(row, payroll.period, row.attendance),
        })),
    [payroll, companyId]
  );

  const totals = useMemo(() => totalRows(rows), [rows]);

  const money = useMemo(() => {
    const paid = rows.filter((r) => r.status === 'paid');
    const hold = rows.filter((r) => r.status === 'hold');
    return {
      paid: paid.reduce((s, r) => s + r.final_payable, 0),
      paidCount: paid.length,
      hold: hold.reduce((s, r) => s + r.final_payable, 0),
      holdCount: hold.length,
      pending: rows
        .filter((r) => r.status !== 'paid' && r.status !== 'hold')
        .reduce((s, r) => s + r.final_payable, 0),
      pendingCount: rows.filter((r) => r.status !== 'paid' && r.status !== 'hold').length,
      deductions:
        totals.pt +
        totals.esi +
        totals.pf +
        totals.loan_deduction +
        totals.penalty_deduction +
        totals.deduction,
    };
  }, [rows, totals]);

  const sunday = useMemo(() => {
    const worked = rows.filter((r) => r.sundays_worked > 0);
    const unpaid = worked.filter((r) => r.sunday_status !== 'paid');
    return {
      people: worked.length,
      days: worked.reduce((s, r) => s + r.sundays_worked, 0),
      unpaidCount: unpaid.length,
    };
  }, [rows]);

  const monthLength = period ? daysInMonth(period.year, period.month) : 0;

  /**
   * Which day the roll call opens on: today if the open month is this one,
   * otherwise the last day anybody was marked on, otherwise the first.
   */
  const defaultDay = useMemo(() => {
    if (!period) return 1;
    const today = new Date();
    if (today.getFullYear() === period.year && today.getMonth() + 1 === period.month) {
      return today.getDate();
    }
    let last = 0;
    for (const row of payroll?.rows || []) {
      for (const [d, entry] of Object.entries(row.attendance || {})) {
        const code = (typeof entry === 'object' ? entry?.code : entry) || '';
        if (code && Number(d) > last) last = Number(d);
      }
    }
    return last || 1;
  }, [period?.id, payroll]);

  useEffect(() => setDay(null), [period?.id]);
  const shownDay = Math.min(Math.max(day ?? defaultDay, 1), monthLength || 1);

  /**
   * The roll call for one day: who was in, who was not, who came in late and
   * who stayed on. Late needs a clock time to compare against the office's
   * usual start, so a day nobody clocked simply cannot answer it - and says so
   * rather than reporting nobody late.
   */
  const roll = useMemo(() => {
    if (!period) return null;
    const standard = shiftOfMonth(period);
    // The month's own grace, so the roll call calls somebody late exactly when
    // the payroll would charge them for it.
    const grace = standard.grace;

    const out = {
      present: [], absent: [], leave: [], halfDay: [], holiday: [], sunday: [],
        unmarked: [], late: [], early: [], overtime: [], short: [], clocked: 0,
        /* Clocked in and never clocked out: a day whose hours cannot be worked
           out at all until somebody says when they left. */
        noClockOut: [],
        /* Clock hours actually worked on this day, across everybody. */
        workedMinutes: 0,
        /*
         * The uniform check.
         *
         * `atWork` is who there is anything to check - present, a half day, or
         * in on a Sunday or a holiday. There is no uniform to inspect on
         * somebody who was not there, so an absence is never "not in uniform".
         */
        atWork: [], outOfUniform: [], uniformProper: 0, uniformChecked: 0,
      };

      for (const row of rows) {
        const entry = row.attendance?.[shownDay];
        const times = typeof entry === 'object' && entry ? entry : {};
        const code = (typeof entry === 'object' ? entry?.code : entry) || '';
        const minutes = Number(times.minutes) || 0;
        const person = {
          id: row.employee_id,
          employee_name: row.employee_name,
          company_name: row.company_name,
          code,
          minutes,
          in_time: times.in_time || '',
          out_time: times.out_time || '',
          // Why they were not at work, and whether somebody allowed it. Both
          // live on the attendance day itself. `approved` is three-state: null
          // is "nobody has decided", which is not "not approved".
          reason: times.reason || '',
          approved: times.approved === undefined ? null : times.approved,
          // Was this person in proper uniform. null is "nobody looked", which
          // is not "turned up wrong".
          uniform: times.uniform === undefined ? null : times.uniform,
          employee_code: row.employee_code || '',
          department: row.department || '',
          /* What the clock says, or null for a day nobody clocked - which is
             "not known", not "worked none of it". */
          workedMinutes: readTimes(times).worked,
        };

        if (!code) out.unmarked.push(person);
        else if (code === 'A' || code === 'AD' || code === 'UL') out.absent.push(person);
        else if (code === 'CL' || code === 'SL' || code === 'PL') out.leave.push(person);
        else if (code === 'HF') out.halfDay.push(person);
        else if (code === 'PH') out.holiday.push(person);
        else if (code === 'S') out.sunday.push(person);
        else out.present.push(person);

        if (parseTime(times.in_time) !== null) {
          out.clocked++;
          if (parseTime(times.out_time) === null) out.noClockOut.push(person);
        }
        const workedToday = readTimes(times).worked;
        if (workedToday !== null && workedToday > 0) out.workedMinutes += workedToday;
        if (judgedOnTime(code)) {
          if (isLateIn(times, { start: standard.in_time, grace })) {
            out.late.push({ ...person, lateBy: lateByMinutes(times, { start: standard.in_time }) });
          }
          if (isEarlyOut(times, { end: standard.out_time, grace })) out.early.push(person);
        }
        // Overtime and short hours are the day's own minutes, whether they came
        // off the clock or were typed straight onto the grid.
        if (minutes > 0) out.overtime.push(person);
        if (minutes < 0) out.short.push(person);

        if (code && WORKED_MARKS.has(code)) {
          out.atWork.push(person);
          if (person.uniform === true) out.uniformProper++;
          if (person.uniform !== null) out.uniformChecked++;
          if (person.uniform === false) out.outOfUniform.push(person);
        }
      }

      out.atWork.sort((a, b) =>
        String(a.employee_name || '').localeCompare(String(b.employee_name || ''))
      );
      out.late.sort((a, b) => b.lateBy - a.lateBy);
      out.overtime.sort((a, b) => b.minutes - a.minutes);
      out.short.sort((a, b) => a.minutes - b.minutes);
      /*
       * The headcount, and the day accounted for.
       *
       * Every person on the visible payroll lands in exactly one of the seven
       * buckets - the classification above is a single if/else chain - so these
       * add up by construction rather than by hope. `accounted` is asserted in
       * a test, because a bucket added later and not shown is precisely the
       * fault this is here to stop.
       */
      out.people = rows.length;
      out.accounted =
        out.present.length + out.absent.length + out.leave.length + out.halfDay.length +
        out.holiday.length + out.sunday.length + out.unmarked.length;

      /*
       * Attendance for the DAY, by the report's own rule: out of the people who
       * were expected, not out of the staff list. A weekly off and a paid
       * holiday are in neither half - nobody failed to attend them - and a half
       * day is half a day lost. A day nobody has marked is "not known", never
       * 100%.
       */
      out.rate = (() => {
        /*
         * One day's marks, counted the way a month's are - each person keeps
         * their own code, so CL/SL/PL land in paid-time-off and AD in absence,
         * rather than being folded into a bucket the rule does not know.
         */
        const counts = {};
        const add = (code) => { if (code) counts[code] = (counts[code] || 0) + 1; };
        for (const group of [out.present, out.absent, out.leave, out.halfDay, out.holiday, out.sunday]) {
          for (const p of group) add(p.code);
        }
        const pct = attendancePercent([{ mark_counts: counts }]);
        return pct === null ? '—' : `${Math.round(pct)}%`;
      })();

      return {
        ...out,
        startsAt: standard.in_time,
        endsAt: standard.out_time,
        grace,
        dayHours: Number(period.hours_per_day) || 9,
      };
    }, [rows, shownDay, period]);

    /*
     * The month, day by day.
     *
     * Counted the same way the roll call counts one day - the same marks, the
     * same `attendancePercent` - so a bar and the card under it cannot
     * disagree. Clicking one moves the roll call to that day, which is the
     * whole point of a trend on a page that also shows a single day.
     *
     * A day nobody has marked is a gap, not a zero: zero would read as "nobody
     * came in", which is a different and much more alarming thing.
     */
    const daily = useMemo(() => {
      if (!period || !rows.length) return [];
      const length = daysInMonth(period.year, period.month);
      const out = [];
      for (let day = 1; day <= length; day++) {
        const counts = {};
        let marked = 0;
        for (const row of rows) {
          const entry = row.attendance?.[day];
          const code = (typeof entry === 'object' ? entry?.code : entry) || '';
          if (!code) continue;
          counts[code] = (counts[code] || 0) + 1;
          marked++;
        }
        /*
         * Classified EXACTLY as the roll call classifies its one day, final
         * else included - anything not recognised counts as present, which is
         * what the grid shows and what the card below says. Listing the known
         * codes here instead made the two disagree on a day carrying a mark
         * from an imported sheet: the trend read "2 in" where the roll call
         * under it read 18.
         */
        const absent = (counts.A || 0) + (counts.AD || 0) + (counts.UL || 0);
        const leave = (counts.CL || 0) + (counts.SL || 0) + (counts.PL || 0);
        const halfDay = counts.HF || 0;
        const off = (counts.S || 0) + (counts.PH || 0);
        out.push({
          day,
          marked,
          present: marked - absent - leave - halfDay - off,
          absent,
          leave,
          halfDay,
          off,
          rate: marked ? attendancePercent([{ mark_counts: counts }]) : null,
          sunday: isSunday(period.year, period.month, day),
        });
      }
      return out;
    }, [rows, period]);

    /*
     * By department, beside the existing by-company split.
     *
     * `department` is already on the payroll row (the query joins it), so this
     * is a group-by and not a second source of truth. Anybody with none is
     * named "Not set" rather than dropped - a department nobody filled in is a
     * thing to fix, not a thing to hide.
     */
    const departments = useMemo(() => {
      const by = new Map();
      for (const row of rows) {
        const name = (row.department || '').trim() || 'Not set';
        if (!by.has(name)) by.set(name, { name, rows: [] });
        by.get(name).rows.push(row);
      }
      return [...by.values()]
        .map((d) => ({ ...d, count: d.rows.length, rate: presentRate(d.rows) }))
        .sort((a, b) => b.count - a.count);
    }, [rows]);

    /*
     * The one list the morning actually needs: who is not simply at work.
     *
     * Eight separate strips of names answered "who is late" and "who is absent"
     * separately, and neither answered "who do I have to ring this morning".
     * This is ONE row per person, carrying every reason that applies to them -
     * somebody can be late AND short of hours, and two chips in two strips never
     * said that was the same person.
     *
     * Present is deliberately NOT in it. It is usually everybody, and a list of
     * seventy-eight people nobody needs to do anything about buries the five who
     * matter. It stays behind "show all".
     */
    const needsLooking = useMemo(() => {
      if (!roll) return [];
      const by = new Map();
      const note = (person, rank, what, when = '', bucketKey = '') => {
        const seen = by.get(person.id) || {
          ...person,
          rank,
          reasons: [],
          // Which lists this person belongs to, so one table can be filtered
          // instead of being split back into a strip per reason.
          in: new Set(),
          in_time: person.in_time,
          out_time: person.out_time,
        };
        seen.rank = Math.min(seen.rank, rank);
        seen.reasons.push({ what, when });
        if (bucketKey) seen.in.add(bucketKey);
        by.set(person.id, seen);
      };

      // Ordered by how much somebody has to do about it, not alphabetically.
      for (const p of roll.absent) note(p, 0, ATTENDANCE_CODES[p.code]?.label || 'Absent', '', 'absent');
      for (const p of roll.late) {
        note(p, 1, `Late by ${formatDuration(p.lateBy)}`, p.in_time, 'late');
        // Kept on the row so the late list can sort by it and show the minutes.
        const seen = by.get(p.id);
        if (seen) seen.lateBy = p.lateBy;
      }
      for (const p of roll.early) note(p, 2, 'Left early', p.out_time, 'early');
      // Somebody present in the wrong uniform is not on any other list, and it
      // is exactly the sort of thing the morning is for.
      for (const p of roll.outOfUniform) note(p, 2, 'Not in proper uniform', '', 'uniform');
      for (const p of roll.halfDay) note(p, 3, 'Half day', '', 'halfDay');
      /*
       * Said against the day it fell short OF.
       *
       * Dinesh: "error where 9 hrs not completed" - "Short 50m" on its own
       * never said what the day was supposed to be, so nobody could tell
       * whether it mattered.
       */
      for (const p of roll.short) {
        note(p, 4, `Short ${formatDuration(-p.minutes)} of ${roll.dayHours}h`, '', 'short');
      }
      for (const p of roll.leave) note(p, 5, ATTENDANCE_CODES[p.code]?.label || 'On leave', '', 'leave');
      for (const p of roll.unmarked) note(p, 6, 'Not marked yet', '', 'unmarked');

      return [...by.values()].sort(
        (a, b) =>
          a.rank - b.rank ||
          String(a.employee_name || '').localeCompare(String(b.employee_name || ''))
      );
    }, [roll]);

    /*
     * One list, filtered - not eight strips of names again.
     *
     * Dinesh asked for "a list like this for late coming also", pointing at the
     * absent list. Eight separate strips were what this page HAD, and they could
     * not say that the same person was late and short of hours. So the chips
     * narrow the one table instead: "Late in 3" gives exactly the late list,
     * with the minutes and how many times this month, and every row still
     * carries every reason that applies to them.
     */
    const buckets = useMemo(
      () =>
        roll
          ? [
              ['all', 'Everyone', needsLooking.length],
              ['absent', 'Absent', roll.absent.length],
              ['late', 'Late coming', roll.late.length],
              ['early', 'Early out', roll.early.length],
              ['halfDay', 'Half day', roll.halfDay.length],
              ['leave', 'On leave', roll.leave.length],
              ['short', 'Short hours', roll.short.length],
              ['uniform', 'Out of uniform', roll.outOfUniform.length],
              ['unmarked', 'Not marked', roll.unmarked.length],
            ]
          : [],
      [roll, needsLooking]
    );

    const listed = useMemo(() => {
      let only = bucket === 'all' ? needsLooking : needsLooking.filter((p) => p.in?.has(bucket));

      if (regCompany) only = only.filter((p) => p.company_name === regCompany);
      if (regDept) only = only.filter((p) => (p.department || '') === regDept);

      // Name, code, department or company - whatever somebody has in mind.
      const q = find.trim().toLowerCase();
      if (q) {
        only = only.filter((p) =>
          [p.employee_name, p.employee_code, p.department, p.company_name]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q))
        );
      }

      /*
       * Sorted only when somebody asks. The default order is by how much has to
       * be done about each person, which is the order the morning is read in -
       * sorting by name would bury the one absence among seventy-eight names.
       */
      if (sort.by) {
        const key = (p) => {
          if (sort.by === 'name') return String(p.employee_name || '').toLowerCase();
          if (sort.by === 'mark') return String(p.code || '');
          if (sort.by === 'department') return String(p.department || '').toLowerCase();
          if (sort.by === 'company') return String(p.company_name || '').toLowerCase();
          if (sort.by === 'hours') return p.workedMinutes ?? -1;
          if (sort.by === 'lateBy') return p.lateBy || 0;
          return '';
        };
        only = [...only].sort((a, b) => {
          const x = key(a);
          const y = key(b);
          if (typeof x === 'number' && typeof y === 'number') return (x - y) * sort.dir;
          return String(x).localeCompare(String(y)) * sort.dir;
        });
      } else if (bucket === 'late') {
        // The late list reads by how late, worst first - which is the question.
        only = [...only].sort((a, b) => (b.lateBy || 0) - (a.lateBy || 0));
      }
      return only;
    }, [needsLooking, bucket, find, sort, regCompany, regDept]);

    /*
     * A page at a time. Eighteen people fit; eighty-five do not, and a table
     * that runs past the fold is one nobody scrolls to the end of.
     *
     * The page resets whenever what is listed changes - otherwise narrowing
     * to one company while on page 4 shows an empty table, which reads as
     * "nobody matched".
     */
    const PER_PAGE = 10;
    const pages = Math.max(1, Math.ceil(listed.length / PER_PAGE));
    const onPage = Math.min(page, pages);
    const shownRows = listed.slice((onPage - 1) * PER_PAGE, onPage * PER_PAGE);
    useEffect(() => {
      setPage(1);
    }, [bucket, find, sort, regCompany, regDept, shownDay]);

    /* Attendance, counted off the marks rather than the payroll columns, so an
       unmarked day shows as unmarked instead of quietly counting as present. */
    const attendance = useMemo(() => {
      if (!period) return null;
      const total = daysInMonth(period.year, period.month);
      const acc = { present: 0, absent: 0, leave: 0, holiday: 0, sunday: 0, blank: 0, expected: 0 };
      const hours = { worked: 0, expected: 0, short: 0, overtime: 0, days: 0 };
      for (const row of rows) {
        const marks = row.attendance || {};
        acc.expected += total;
        for (let d = 1; d <= total; d++) {
          const entry = marks[d];
          const code = (typeof entry === 'object' ? entry?.code : entry) || '';
          if (!code) acc.blank++;
          else if (code === 'A' || code === 'AD' || code === 'UL') acc.absent++;
          else if (code === 'CL' || code === 'SL' || code === 'PL') acc.leave++;
          else if (code === 'PH') acc.holiday++;
          else if (code === 'S') acc.sunday++;
          else acc.present++;
        }
        const month = monthTotals(Object.values(marks), { hoursPerDay: period.hours_per_day });
        hours.days += month.days;
        hours.worked += month.worked;
        hours.expected += month.expected;
        hours.short += month.short;
        hours.overtime += month.overtime;
      }
      return { ...acc, hours };
    }, [rows, period]);

    // The register sends quotas and days taken; the balance is the difference,
    // worked out the same way the Leave tab does.
    const overLeave = useMemo(
      () => leave.filter((r) => LEAVE_TYPES.some((t) => (r.taken?.[t.code] || 0) > (r.quotas?.[t.code] || 0))),
      [leave]
    );

    const statutory = useMemo(() => {
      if (!payroll) return null;
      try {
        return statutoryReport({ period: payroll.period, rows });
      } catch {
        // A register that cannot be built is not worth taking the page down for.
        return null;
      }
    }, [payroll, rows]);

    /* Grouped from the rows on screen rather than from payroll.companies, so a
       company filter narrows this table the way it narrows every other tab. */
    const companies = useMemo(() => {
      const groups = new Map();
      for (const row of rows) {
        if (!groups.has(row.company_id)) {
          groups.set(row.company_id, { id: row.company_id, name: row.company_name, rows: [] });
        }
        groups.get(row.company_id).rows.push(row);
      }
      return [...groups.values()].map((group) => ({ ...group, totals: totalRows(group.rows) }));
    }, [rows]);

    const loans = useMemo(
      () => ({
        thisMonth: totals.loan_deduction,
        people: rows.filter((r) => r.loan_deduction > 0).length,
      }),
      [rows, totals]
    );

    /* Each month in the history, narrowed to the company on screen and run back
       through the engine, so the trend is measuring the same thing the headline
       figures are. */
    const trend = useMemo(
      () =>
        history.map(({ period: p, rows: raw }) => {
          const own = companyId ? raw.filter((r) => r.company_id === companyId) : raw;
          const calculated = own.map((r) => ({ ...r, ...calculateRow(r, p, r.attendance) }));
          const t = totalRows(calculated);
          return {
            period: p,
            label: `${MONTHS[p.month - 1].slice(0, 3)} ${String(p.year).slice(2)}`,
            staff: calculated.length,
            net: t.net_salary,
            gross: t.gross_salary,
            absent: calculated.reduce((sum, r) => sum + r.absent_days, 0),
            sunday: t.sunday_salary,
          };
        }),
      [history, companyId]
    );

    /* Last month, for the "compared with" strip. Only the month immediately
       before this one counts - a gap in the history is not a comparison. */
    const previous = useMemo(() => {
      if (!period || trend.length < 2) return null;
      const before = trend[trend.length - 2];
      const gap = period.year * 12 + period.month - (before.period.year * 12 + before.period.month);
      return gap === 1 ? before : null;
    }, [trend, period]);

    const thisMonth = useMemo(
      () => ({
        staff: rows.length,
        net: totals.net_salary,
        gross: totals.gross_salary,
        absent: rows.reduce((sum, r) => sum + r.absent_days, 0),
      }),
      [rows, totals]
    );

    /* Who came, who left, and whose day it is - all off the master, so it holds
       even for a month nothing has been marked on yet. */
    const people = useMemo(() => {
      if (!period) return null;
      const on = (value) => {
        if (!value) return null;
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d;
      };
      const inMonth = (value) => {
        const d = on(value);
        return !!d && d.getFullYear() === period.year && d.getMonth() + 1 === period.month;
      };
      const sameMonth = (value) => {
        const d = on(value);
        return !!d && d.getMonth() + 1 === period.month;
      };
      const mine = companyId ? employees.filter((e) => e.company_id === companyId) : employees;
      const active = mine.filter((e) => e.active);
      const withDates = active.filter((e) => e.dob || e.joined_on).length;
      return {
        active: active.length,
        inactive: mine.length - active.length,
        withDates,
        missingDates: active.length - withDates,
        joined: active
          .filter((e) => inMonth(e.joined_on))
          .map((e) => ({ ...e, dayOfMonth: on(e.joined_on).getDate() }))
          .sort((a, b) => a.dayOfMonth - b.dayOfMonth),
        left: mine
          .filter((e) => inMonth(e.left_on))
          .map((e) => ({ ...e, dayOfMonth: on(e.left_on).getDate() }))
          .sort((a, b) => a.dayOfMonth - b.dayOfMonth),
        birthdays: active
          .filter((e) => sameMonth(e.dob))
          .map((e) => ({ ...e, dayOfMonth: on(e.dob).getDate(), turning: period.year - on(e.dob).getFullYear() }))
          .sort((a, b) => a.dayOfMonth - b.dayOfMonth),
        // A first month is a joining, not an anniversary - that is the row above.
        anniversaries: active
          .filter((e) => sameMonth(e.joined_on) && on(e.joined_on).getFullYear() < period.year)
          .map((e) => ({
            ...e,
            dayOfMonth: on(e.joined_on).getDate(),
            years: period.year - on(e.joined_on).getFullYear(),
          }))
          .sort((a, b) => a.dayOfMonth - b.dayOfMonth),
      };
    }, [employees, companyId, period]);

    /** Whose day it is on the day the roll call is showing. */
    const todaysDates = useMemo(() => {
      if (!people) return { birthdays: [], anniversaries: [], joined: [] };
      return {
        birthdays: people.birthdays.filter((e) => e.dayOfMonth === shownDay),
        anniversaries: people.anniversaries.filter((e) => e.dayOfMonth === shownDay),
        joined: people.joined.filter((e) => e.dayOfMonth === shownDay),
      };
    }, [people, shownDay]);

    /**
     * The month per person: days actually worked, days lost, hours on the clock,
     * and how often they came in after the usual start or left before the usual
     * finish. The late and early counts need clock times, so they only mean
     * anything for people whose hours are being recorded.
     */
    const monthly = useMemo(() => {
      const standard = shiftOfMonth(period);
      // The month's own grace, so the roll call calls somebody late exactly when
      // the payroll would charge them for it.
      const grace = standard.grace;

      return rows.map((row) => {
        const marks = Object.values(row.attendance || {});
        let present = 0;
        let late = 0;
        let early = 0;
        let clocked = 0;
        for (const entry of marks) {
          const code = (typeof entry === 'object' ? entry?.code : entry) || '';
          if (code === 'P' || code === 'WH' || code === 'SP' || code === 'HP') present++;
          if (code === 'HF') present += 0.5;
          const times = typeof entry === 'object' && entry ? entry : {};
          const cameAt = parseTime(times.in_time);
          const leftAt = parseTime(times.out_time);
          if (cameAt !== null || leftAt !== null) clocked++;
          if (!judgedOnTime(code)) continue;
          if (isLateIn(times, { start: standard.in_time, grace })) late++;
          if (isEarlyOut(times, { end: standard.out_time, grace })) early++;
        }
        return {
          id: row.employee_id,
          employee_name: row.employee_name,
          company_name: row.company_name,
          present,
          absent: row.absent_days,
          worked: row.worked_minutes || 0,
          clocked,
          late,
          early,
          ot: row.ot_minutes,
        };
      });
    }, [rows]);

    /** How many times each person has been late so far this month. */
    const lateThisMonth = useMemo(() => new Map(monthly.map((m) => [m.id, m.late])), [monthly]);

    /*
     * Recording why somebody was out, and whether it was allowed, FROM HERE.
     *
     * This is the screen somebody is looking at when they find out - the morning
     * roll call - so it is the screen that takes the answer. It writes through
     * the same `setAttendance` the grid uses, which only touches the columns it
     * names, so recording a reason cannot disturb a mark or an hour.
     *
     * Neither field moves a rupee. An approved absence is still an absence; paid
     * time off is CL/SL/PL, which it already was.
     */
    const saveDay = async (person, patch) => {
      if (!onSaveAttendance || locked) return;
      setSaving((n) => n + 1);
      try {
        await onSaveAttendance([{ employee_id: person.id, day: shownDay, ...patch }]);
      } finally {
        setSaving((n) => n - 1);
      }
    };

    /** The same thing for a whole floor at once - one call, one reload. */
    const saveMany = async (entries) => {
      if (!onSaveAttendance || locked || !entries.length) return;
      setSaving((n) => n + 1);
      try {
        await onSaveAttendance(entries);
      } finally {
        setSaving((n) => n - 1);
      }
    };

    /** The same month, added up across everybody. */
    const monthTotalsOf = useMemo(
      () =>
        monthly.reduce(
          (acc, m) => ({
            present: acc.present + m.present,
            absent: acc.absent + m.absent,
            worked: acc.worked + m.worked,
            late: acc.late + m.late,
            early: acc.early + m.early,
          }),
          { present: 0, absent: 0, worked: 0, late: 0, early: 0 }
        ),
      [monthly]
    );

    /* The names worth opening, each list only as long as it has entries. */
    const outliers = useMemo(() => {
      const top = (list, by, keep = (x) => true) =>
        list.filter(keep).sort(by).slice(0, 5);
      const clocked = monthly.filter((m) => m.clocked > 0);
      return {
        mostPresent: top(monthly, (a, b) => b.present - a.present, (m) => m.present > 0),
        mostAbsent: top(monthly, (a, b) => b.absent - a.absent, (m) => m.absent > 0),
        mostHours: top(clocked, (a, b) => b.worked - a.worked, (m) => m.worked > 0),
        leastHours: top(clocked, (a, b) => a.worked - b.worked, (m) => m.worked > 0),
        late: top(monthly, (a, b) => b.late - a.late, (m) => m.late > 0),
        early: top(monthly, (a, b) => b.early - a.early, (m) => m.early > 0),
        short: top(rows, (a, b) => a.ot_minutes - b.ot_minutes, (r) => r.ot_minutes < 0),
        over: top(rows, (a, b) => b.ot_minutes - a.ot_minutes, (r) => r.ot_minutes > 0),
        anyClocked: clocked.length,
      };
    }, [monthly, rows]);

    /**
     * What has to be paid over, and roughly when. The dates are the ordinary
     * ones for a Gujarat employer - PF and ESI by the 15th of the following
     * month, Gujarat PT by the 15th - and they are stated as a reminder, not as
     * advice: the note under the list says to check them.
     */
    const filings = useMemo(() => {
      if (!period) return [];
      const next = period.month === 12
        ? { year: period.year + 1, month: 1 }
        : { year: period.year, month: period.month + 1 };
      const by = (day) => `${day} ${MONTHS[next.month - 1].slice(0, 3)} ${next.year}`;
      return [
        { label: 'PF', note: 'employee + employer share', due: by(15) },
        { label: 'ESI', note: 'employee + employer share', due: by(15) },
      { label: 'Professional tax', note: 'per company', due: by(15) },
      ];
    }, [period, totals]);

  /*
   * The six figures somebody opens this page to see, each a tile of its own
   * hue. Every one is a figure already computed below - this reads them, it
   * works nothing out - and every one opens where it came from.
   *
   * `pct` is "of the staff on screen", so the six read against one
   * denominator. A month with nothing marked shows a dash rather than 0%,
   * because "nobody has filled this in" is not "nobody came in".
   */
  /*
   * Last month, for the two tiles that compare. Only the month immediately
   * before this one counts - a gap in the history is not a comparison - and
   * its attendance goes through the same `attendancePercent` as everything
   * else, so the arrow and the figure beside it cannot disagree.
   */
  const was = useMemo(() => {
    if (!previous) return null;
    const entry = history.find((h) => h.period?.id === previous.period?.id);
    if (!entry) return null;
    const own = companyId ? entry.rows.filter((r) => r.company_id === companyId) : entry.rows;
    return { staff: own.length, rate: attendancePercent(own) };
  }, [previous, history, companyId]);

  /*
   * The trend, in whichever of the three readings is asked for. One figure,
   * three ways of cutting it - never three different figures.
   */
  const trendPoints = useMemo(() => {
    if (trendBy === 'monthly') {
      return history.map((h) => {
        const own = companyId ? h.rows.filter((r) => r.company_id === companyId) : h.rows;
        return {
          label: `${MONTHS[h.period.month - 1].slice(0, 3)} ${String(h.period.year).slice(2)}`,
          value: attendancePercent(own),
          periodId: h.period.id,
          note: `${own.length} staff`,
        };
      });
    }
    if (trendBy === 'company') {
      return companies.map((c) => ({
        label: c.name.split(' ').slice(0, 2).join(' '),
        value: attendancePercent(c.rows),
        note: `${c.totals.count} staff`,
      }));
    }
    /* Daily: this month, day by day. A day nobody marked is null, which the
       chart draws as a gap rather than as a zero. */
    return daily.map((d) => ({
      label: String(d.day),
      value: d.rate,
      day: d.day,
      note: d.marked ? `${d.present} in, ${d.absent} absent` : 'nothing marked',
    }));
  }, [trendBy, daily, history, companies, companyId]);


    if (!period || !payroll) {
      return (
        <p className="card muted">
          No month is open yet. Use <strong>New month</strong> above to start one.
        </p>
      );
    }

    /** The first few names behind a count, so the line says who as well as how many. */
    const naming = (list, get = (x) => x.name) => {
      const names = list.slice(0, 3).map(get).filter(Boolean);
      if (!names.length) return '';
      const more = list.length - names.length;
      return ` — ${names.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
    };

    const unmarkedPeople = rows.filter((row) => {
      const marked = Object.values(row.attendance || {}).filter(
        (e) => ((typeof e === 'object' ? e?.code : e) || '') !== ''
      ).length;
      return marked === 0;
    });

    const alerts = [
      money.pendingCount > 0 && {
        key: 'pending',
        tone: 'warn',
        text: `${money.pendingCount} ${money.pendingCount === 1 ? 'salary' : 'salaries'} still to pay`,
        go: 'sheet',
      },
      sunday.unpaidCount > 0 && {
        key: 'sunday',
        tone: 'warn',
        text: `${sunday.unpaidCount} Sunday payments still to make`,
        go: 'attendance',
      },
      unmarkedPeople.length > 0 &&
        unmarkedPeople.length === rows.length && {
          key: 'no-attendance',
          tone: 'warn',
          text:
            'No attendance for this month yet — import the punch machine\u2019s file from Reports, ' +
            'or mark the grid by hand. Until then the salary is a full month for everybody.',
          go: 'reports',
        },
      unmarkedPeople.length > 0 &&
        unmarkedPeople.length < rows.length && {
          key: 'unmarked',
          tone: 'warn',
          text: `${unmarkedPeople.length} people have no attendance marked at all${naming(
            unmarkedPeople,
            (r) => r.employee_name
          )}`,
          go: 'attendance',
        },
      attendance?.blank > 0 &&
        unmarkedPeople.length === 0 && {
          key: 'blank',
          tone: 'warn',
          text: `${attendance.blank} days across the month have no mark`,
          go: 'attendance',
        },
      overLeave.length > 0 && {
        key: 'leave',
        tone: 'bad',
        text: `${overLeave.length} over their leave entitlement — those days should be unpaid${naming(overLeave)}`,
        go: 'leave',
      },
      statutory?.pf.missing > 0 && {
        key: 'uan',
        tone: 'bad',
        text: `${statutory.pf.missing} on PF have no UAN — the return cannot go up without one${naming(
          statutory.pf.rows.filter((r) => r.missing?.includes('UAN')),
          (r) => r.name
        )}`,
        go: 'reports',
      },
      statutory?.esi.missing > 0 && {
        key: 'esic',
        tone: 'bad',
        text: `${statutory.esi.missing} on ESI have no ESIC number${naming(
          statutory.esi.rows.filter((r) => r.missing?.length),
          (r) => r.name
        )}`,
        go: 'reports',
      },
    /*
     * Clocked in and never clocked out. The hours for that day cannot be
     * worked out at all until somebody says when they left, so it is not a
     * tidiness problem - it is a day with no pay attached to it.
     */
    roll.noClockOut.length > 0 && {
      key: 'clockout',
      tone: 'warn',
      text: `${roll.noClockOut.length} clocked in on ${shownDay} ${MONTHS[period.month - 1]} and never clocked out${naming(
        roll.noClockOut,
        (p) => p.employee_name
      )}`,
      go: 'time',
    },
    /*
     * The uniform walk, half done. Nobody looked is NOT "they turned up
     * wrong" - that is the whole reason the column is three-state - so this
     * counts the not-looked-at rather than the offenders.
     */
    roll.atWork.length > 0 && roll.uniformChecked < roll.atWork.length && {
      key: 'uniform',
      tone: 'muted',
      text: `${roll.atWork.length - roll.uniformChecked} of ${roll.atWork.length} at work on ${shownDay} ${
        MONTHS[period.month - 1]
      } have not been checked for uniform`,
      go: 'attendance',
    },
    money.holdCount > 0 && {
      key: 'hold',
      tone: 'warn',
      text: `${money.holdCount} on hold${naming(
        rows.filter((r) => r.status === 'hold'),
        (r) => r.employee_name
      )}`,
      go: 'sheet',
    },
  ].filter(Boolean);

  /*
   * Only the lines waiting on a decision. The digest also carries the month's
   * unpaid salaries and missing UANs, which the "Needs attention" list below
   * already says - and two cards repeating each other is how a dashboard stops
   * being read.
   */
  /*
   * Everything except the payroll lines, which the "Needs attention" list
   * below already says - two cards repeating each other is how a dashboard
   * stops being read.
   *
   * It used to keep ONLY `kind === 'queue'`, which silently threw away every
   * `dates` line: probation finished and nobody has confirmed it, a document
   * already expired, an appraisal past its date. All of them were computed,
   * sent to this page, and dropped on the floor.
   */
  const queues = (waiting?.items || []).filter((item) => item.kind !== 'payroll');

  const now = new Date();
  // Nothing at all on this day is a different thing from a day with a few gaps
  // in it: naming seventy-four people who have no mark is noise, and the useful
  // answer is where attendance comes from in the first place.
  const nothingMarked = rows.length > 0 && roll.unmarked.length === rows.length;
  const monthHasToday = now.getFullYear() === period.year && now.getMonth() + 1 === period.month;
  const isToday = monthHasToday && now.getDate() === shownDay;

  /*
   * The five figures somebody opens this page to see. Everything below is the
   * detail behind one of them, so they sit on their own band at the top rather
   * than being found halfway down a card.
   *
   * Each one is a figure already computed below - this reads them, it does not
   * work anything out - and each one opens where it came from.
   */
  // The same figure the By company table prints, over whatever is on screen -
  // days present out of days that carry any mark. A month with nothing marked
  // reads as a dash, never 100%.
  const attendedRate = presentRate(rows);
  const pct = (n) => (rows.length ? `${Math.round((n / rows.length) * 1000) / 10}% of the staff` : '');
  const kpis = [
    {
      key: 'staff',
      icon: 'people',
      tile: 't1',
      label: 'Total employees',
      value: rows.length,
      caption: `${companies.length} ${companies.length === 1 ? 'company' : 'companies'}`,
      delta: was ? rows.length - was.staff : null,
      to: 'employees',
    },
    {
      key: 'present',
      icon: 'check',
      tile: 't2',
      label: 'Present today',
      value: nothingMarked ? '—' : roll.present.length,
      caption: nothingMarked ? 'nothing marked for this day' : pct(roll.present.length),
      to: 'attendance',
    },
    {
      key: 'absent',
      icon: 'alert',
      tile: 't3',
      label: 'Absent today',
      value: nothingMarked ? '—' : roll.absent.length,
      caption: nothingMarked ? '' : pct(roll.absent.length),
      to: 'attendance',
    },
    {
      key: 'leave',
      icon: 'calendar',
      tile: 't4',
      label: 'On leave today',
      value: nothingMarked ? '—' : roll.leave.length,
      caption: nothingMarked ? '' : pct(roll.leave.length),
      to: 'leave',
    },
    {
      key: 'unmarked',
      icon: 'clock',
      tile: 't5',
      label: 'Attendance not marked',
      value: roll.unmarked.length,
      caption: pct(roll.unmarked.length),
      to: 'attendance',
    },
    {
      key: 'rate',
      icon: 'chart',
      tile: 't6',
      label: 'Attendance',
      value: attendedRate === '-' ? '—' : attendedRate,
      caption:
        attendedRate === '-'
          ? 'nothing marked yet'
          : `${attendance.absent} employee-days absent this month`,
      /*
       * Against the month before, in percentage POINTS - "2% better" would
       * be ambiguous between 94 to 96 and 94 to 95.9.
       */
      delta: was && was.rate !== null && attendedRate !== '-'
        ? Math.round((parseFloat(attendedRate) - was.rate) * 10) / 10
        : null,
      deltaUnit: 'pts',
      to: 'reports',
    },
  ];

  /*
   * Every card opens the tab it is about, clicked anywhere on it.
   *
   * One listener on the page rather than a handler per card, and the card
   * stays a <div>: these hold buttons, lists, a table and a set of bars, and a
   * button inside a button is invalid HTML that stops the inner one working.
   * So anything that started on a control of its own is left alone - that
   * control has its own job, usually a more specific one - and dragging out a
   * selection to copy a figure is not a click either.
   *
   * Each card also keeps its own "open" button, which is what a keyboard
   * reaches; clicking the card is the mouse shortcut on top of it.
   */
  const openCard = (e) => {
    if (e.target.closest('button, a, input, select, textarea, label')) return;
    if (window.getSelection?.()?.toString()) return;
    const card = e.target.closest('.card[data-go]');
    if (card?.dataset.go) onGo(card.dataset.go);
  };

  return (
    <section className="stack dashboard" onClick={openCard}>
      <div className="kpi-band">
        {kpis.map((k) => (
          <button key={k.key} className={`kpi ${k.tile}`} onClick={() => onGo(k.to)} title={`Open ${k.to}`}>
            <span className="kpi-head">
              <span className="kpi-icon">
                <Glyph name={k.icon} />
              </span>
              <span className="kpi-label">{k.label}</span>
            </span>
            <span className="kpi-body">
              <span className="kpi-value">{k.value}</span>
              <span className="kpi-caption">
                {k.caption}
                {/* Only when there IS a month before to compare against -
                    "0% vs last month" on a first month is a made-up zero. */}
                {k.delta !== null && k.delta !== undefined ? (
                  <span
                    className={`kpi-delta ${k.delta > 0 ? 'up' : k.delta < 0 ? 'down' : 'flat'}`}
                  >
                    {' '}
                    {k.delta > 0 ? '▲' : k.delta < 0 ? '▼' : '='} {Math.abs(k.delta)}
                    {k.deltaUnit ? ` ${k.deltaUnit}` : ''} vs last month
                  </span>
                ) : null}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="dash-3">
        <div className="pcard">
          <div className="pcard-head">
            <Glyph name="chart" size={16} />
            Attendance trend
            <span className="spacer" />
            {[['daily', 'Daily'], ['monthly', 'Monthly'], ['company', 'Company']].map(([key, label]) => (
              <button
                key={key}
                className={trendBy === key ? 'on' : undefined}
                onClick={() => setTrendBy(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="pcard-body">
            {/*
              * Three readings of one figure, never three figures. Daily is
              * this month day by day, monthly is the last few months, and
              * company is each company's own rate - all from
              * `attendancePercent`, so no two of them can disagree.
              */}
            <LineChart
              points={trendPoints}
              onPoint={(p) => {
                if (trendBy === 'daily' && p.day) setDay(p.day);
                if (trendBy === 'monthly' && p.periodId && onPeriod) onPeriod(p.periodId);
              }}
            />
          </div>
        </div>

        <div className="pcard">
          <div className="pcard-head">
            <Glyph name="people" size={16} />
            Company wise attendance
          </div>
          <div className="pcard-body">
            <Donut
              slices={companies.map((c, i) => ({
                label: c.name,
                /* Sized by HEADCOUNT, labelled with its own rate - a company
                   of four and a company of forty are not the same slice. */
                weight: c.totals.count,
                text: presentRate(c.rows),
                colour: `var(--viz-s${(i % 4) + 1})`,
              }))}
              middle={attendedRate === '-' ? '—' : attendedRate}
              caption="overall"
            />
          </div>
        </div>

        <div className="pcard">
          <div className="pcard-head">
            <Glyph name="clock" size={16} />
            Quick stats
          </div>
          <div className="pcard-body">
            {[
              ['Late coming', roll.late.length, 'var(--tile-4-ink)', 'time'],
              ['Early leaving', roll.early.length, 'var(--tile-3-ink)', 'time'],
              ['Half day', roll.halfDay.length, 'var(--tile-5-ink)', 'attendance'],
              ['Overtime', roll.overtime.length, 'var(--tile-2-ink)', 'time'],
              ['Short hours', roll.short.length, 'var(--tile-6-ink)', 'time'],
              ['Out of uniform', roll.outOfUniform.length, 'var(--tile-1-ink)', 'attendance'],
            ].map(([label, n, colour, to]) => (
              <button key={label} className="qs-row" onClick={() => onGo(to)}>
                <span className="qs-ico" style={{ background: colour }}>
                  <Glyph name="clock" size={14} />
                </span>
                <span className="qs-name">{label}</span>
                <span className="qs-num">{n}</span>
                <span className="qs-go">›</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card roll-call" data-go="attendance">
        <h2 className="roll-head">
          <button
            className="ghost"
            disabled={shownDay <= 1}
            onClick={() => setDay(shownDay - 1)}
            title="The day before"
          >
            ‹
          </button>
          <span>
            {weekday(period.year, period.month, shownDay)} {shownDay}{' '}
            {MONTHS[period.month - 1]} {period.year}
            {isToday && <span className="pill"> today</span>}
            {isSunday(period.year, period.month, shownDay) && <span className="pill"> Sunday</span>}
          </span>
          <button
            className="ghost"
            disabled={shownDay >= monthLength}
            onClick={() => setDay(shownDay + 1)}
            title="The day after"
          >
            ›
          </button>
          {day !== null && day !== defaultDay && (
            <button className="ghost tiny" onClick={() => setDay(null)}>
              {monthHasToday ? 'back to today' : 'back to the latest day'}
            </button>
          )}
          {companyName && <span className="muted small">{companyName}</span>}
          <span className="grow" />
          <button className="ghost tiny" onClick={() => onGo('attendance')}>
            mark attendance
          </button>
        </h2>

        {(todaysDates.birthdays.length ||
          todaysDates.anniversaries.length ||
          todaysDates.joined.length) > 0 && (
          <p className="celebrate">
            {todaysDates.birthdays.map((e) => (
              <span key={`b${e.id}`} className="celebrate-item">
                🎂 <strong>{e.name}</strong>
                {e.turning > 0 && <span className="muted"> turns {e.turning}</span>}
              </span>
            ))}
            {todaysDates.anniversaries.map((e) => (
              <span key={`a${e.id}`} className="celebrate-item">
                🎉 <strong>{e.name}</strong>
                <span className="muted"> {e.years} year{e.years === 1 ? '' : 's'} today</span>
              </span>
            ))}
            {todaysDates.joined.map((e) => (
              <span key={`j${e.id}`} className="celebrate-item">
                👋 <strong>{e.name}</strong>
                <span className="muted"> joined today</span>
              </span>
            ))}
          </p>
        )}

        {/*
          * On the staff, and how many of them this day accounts for.
          *
          * The seven buckets below are exhaustive and exclusive - the
          * classification is one if/else chain - so they add to the headcount
          * exactly. They did NOT all used to be here: `holiday` and `sunday`
          * were counted and shown NOWHERE, so on a Sunday or a festival every
          * figure on this card read 0 and the bar was empty, as though the day
          * had not happened. `accounted` is the arithmetic said out loud.
          */}
        {/*
          * The seven buckets are exhaustive and exclusive - the classification
          * above is one if/else chain - so they add to the headcount exactly.
          * Two of them used to be counted and shown NOWHERE: on a Sunday or a
          * festival every figure here read 0 and the bar was empty, as though
          * the day had not happened. They appear only on a day that has any,
          * so an ordinary Tuesday is not given two permanent zeroes.
          *
          * The staff count, the month's hours, the attendance rate and the
          * pending count are NOT repeated here - they are the band at the top
          * of the page, and two cards saying the same thing is how a dashboard
          * stops being read. "Hours today" is a different figure from the
          * band's month, and says so.
          */}
        {/*
          * Two rows, not thirteen figures left to wrap wherever they land.
          *
          * The first is WHO: seven buckets that are exhaustive and exclusive,
          * so they add to the headcount exactly, plus the day's attendance.
          * The second is HOW THE DAY WENT for the people who were in. One
          * row of thirteen wrapped into eleven and two, and the orphaned two
          * read as a broken grid rather than a continuation.
          *
          * `holiday` and `sunday` appear only on a day that has any - an
          * ordinary Tuesday is not given two permanent zeroes - and they used
          * to be counted and drawn NOWHERE, so a weekly off showed every
          * figure here as 0 as though the day had not happened.
          */}
        <div className="stat-row">
          <Stat label="Present" value={roll.present.length} plain strong go={onGo} to="attendance" />
          <Stat label="Absent" value={roll.absent.length} plain go={onGo} to="attendance" />
          <Stat label="On leave" value={roll.leave.length} plain go={onGo} to="leave" />
          <Stat label="Half day" value={roll.halfDay.length} plain go={onGo} to="attendance" />
          {roll.holiday.length > 0 && (
            <Stat label="Holiday" value={roll.holiday.length} plain go={onGo} to="attendance" />
          )}
          {roll.sunday.length > 0 && (
            <Stat label="Weekly off" value={roll.sunday.length} plain go={onGo} to="attendance" />
          )}
          <Stat label="Not marked" value={roll.unmarked.length} plain go={onGo} to="attendance" />
          {/*
            * Out of the people who were EXPECTED, not out of the staff list -
            * a weekly off and a paid holiday are in neither half, and a half
            * day is half a day lost. The report's own function, so this
            * figure and Reports cannot disagree.
            */}
          <Stat label="Attendance" value={roll.rate} plain go={onGo} to="reports" />
        </div>

        <div className="stat-row">
          <Stat label="Late in" value={roll.late.length} plain go={onGo} to="time" />
          <Stat label="Early out" value={roll.early.length} plain go={onGo} to="time" />
          <Stat label="On overtime" value={roll.overtime.length} plain go={onGo} to="time" />
          <Stat label="Short hours" value={roll.short.length} plain go={onGo} to="time" />
          <Stat label="Out of uniform" value={roll.outOfUniform.length} plain />
          <Stat
            label="Hours today"
            value={roll.workedMinutes ? formatDuration(roll.workedMinutes) : '—'}
            plain
            go={onGo}
            to="time"
          />
        </div>

        <SegBar
          parts={[
            { label: 'Present', value: roll.present.length, tone: 'present' },
            { label: 'Half day', value: roll.halfDay.length, tone: 'half' },
            { label: 'On leave', value: roll.leave.length, tone: 'leave' },
            { label: 'Holiday', value: roll.holiday.length, tone: 'leave' },
            { label: 'Weekly off', value: roll.sunday.length, tone: 'none' },
            { label: 'Absent', value: roll.absent.length, tone: 'absent' },
            { label: 'Not marked', value: roll.unmarked.length, tone: 'none' },
          ]}
          unit=" people"
        />

        {nothingMarked ? (
          <div className="nothing-yet">
            <p>
              <strong>No attendance has come in for this day yet.</strong> Nothing here is
              guessed — every figure above is counted off the marks and clock times against
              each person, so until one of these happens the day is simply blank.
            </p>
            <div className="button-row">
              {/* Straight to the importers, not just to the Reports tab -
                  they sit behind a fold a third of the way down it. */}
              <button className="primary" onClick={() => onGo('reports', 'import')}>
                Import the punch machine's file
              </button>
              <button onClick={() => onGo('attendance')}>Mark attendance by hand</button>
              <button onClick={() => onGo('time')}>Type in and out times</button>
            </div>
            <p className="muted small">
              <strong>Reports → Attendance machine</strong> takes the eSSL or ZKTeco export
              and turns it into present, absent, half day and short hours for every person and
              every day in it — that is the one to use for a whole month at once.{' '}
              <strong>Attendance</strong> is the grid, with <em>Mark everyone Present</em> for
              a quick start. <strong>Time</strong> is for typing in, lunch and out by hand.
            </p>
          </div>
        ) : (
          <>
        {needsLooking.length === 0 ? (
          <p className="muted small">
            Everybody on the list is at work, on time, and nobody is short of hours.
          </p>
        ) : (
          <>
            {/* One list, narrowed - "Late coming 3" IS the late list. */}
            <div className="chips roll-chips">
              {buckets.map(([key, label, count]) => (
                <button
                  key={key}
                  className={`chip ${bucket === key ? 'active' : ''}`}
                  disabled={count === 0 && key !== 'all'}
                  onClick={() => setBucket(key)}
                >
                  {label} <span className="muted">{count}</span>
                </button>
              ))}
            </div>

            <div className="roll-tools">
              <input
                className="search"
                placeholder="Name, code, department or company"
                value={find}
                onChange={(e) => setFind(e.target.value)}
              />
              <select value={regCompany} onChange={(e) => setRegCompany(e.target.value)}>
                <option value="">All companies</option>
                {[...new Set(needsLooking.map((p) => p.company_name).filter(Boolean))].sort().map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select value={regDept} onChange={(e) => setRegDept(e.target.value)}>
                <option value="">All departments</option>
                {[...new Set(needsLooking.map((p) => p.department).filter(Boolean))].sort().map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              {find ? (
                <span className="muted small">
                  {listed.length} of {needsLooking.length}{' '}
                  <button className="link" onClick={() => setFind('')}>clear</button>
                </span>
              ) : null}
              <button
                className="ghost"
                disabled={!listed.length}
                onClick={() => exportRegister(listed, period, shownDay)}
                title="Opens in Excel"
              >
                Export (CSV)
              </button>
            </div>

            <div className="table-wrap">
            <table className="sheet roll-table">
              <thead>
                <tr>
                  <Th sort={sort} setSort={setSort} by="name" className="sticky-name">Name</Th>
                  <Th sort={sort} setSort={setSort} by="mark">Status</Th>
                  <th>What</th>
                  {bucket === 'late' ? (
                    <Th sort={sort} setSort={setSort} by="lateBy" className="num">Late this month</Th>
                  ) : null}
                  <th>In</th>
                  <th>Out</th>
                  <Th sort={sort} setSort={setSort} by="hours" className="num">Hours</Th>
                  <th>Why</th>
                  <th>Allowed?</th>
                  <Th sort={sort} setSort={setSort} by="department">Department</Th>
                  <Th sort={sort} setSort={setSort} by="company">Company</Th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shownRows.map((p) => (
                  <tr key={p.id} className={`r${p.rank}`}>
                    <td className="sticky-name">
                      {p.employee_name}
                      {p.employee_code ? <div className="muted small">{p.employee_code}</div> : null}
                    </td>
                    {/*
                      * The MARK, in words. "What" beside it is why somebody is
                      * on this list, which is a different question - a person
                      * can be Present and also an hour short.
                      */}
                    <td className="small">
                      {p.code ? (
                        <span className={`mark-pill code-${p.code}`}>
                          {ATTENDANCE_CODES[p.code]?.label || p.code}
                        </span>
                      ) : (
                        <span className="muted">not marked</span>
                      )}
                    </td>
                    <td>
                      {p.reasons.map((r, i) => (
                        <span key={i} className="why">
                          {r.what}
                          {r.when ? <span className="muted"> at {r.when}</span> : null}
                        </span>
                      ))}
                    </td>
                    {bucket === 'late' ? (
                      <td className="num">
                        {lateThisMonth.get(p.id) ? (
                          <span className={lateThisMonth.get(p.id) > 3 ? 'overdue' : undefined}>
                            {lateThisMonth.get(p.id)}×
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    ) : null}
                    <td>{p.in_time || <span className="muted">—</span>}</td>
                    <td>{p.out_time || <span className="muted">—</span>}</td>
                    {/* What the clock says they actually worked. A day nobody
                        clocked is a dash, never 0h - "not known" is not
                        "stayed for none of it". */}
                    <td className="num">
                      {p.workedMinutes === null ? (
                        <span className="muted">—</span>
                      ) : (
                        formatDuration(p.workedMinutes)
                      )}
                    </td>
                    {/*
                      * Typed here, saved on blur, and kept on the attendance
                      * day itself - so it shows on the grid's day menu, on the
                      * absent/present report and on the person's own record,
                      * not only on this screen.
                      *
                      * Keyed on the stored value so a reload under a row
                      * already on screen re-renders the box instead of leaving
                      * a stale one showing - the same trap the employee table
                      * hit.
                      */}
                    <td>
                      <input
                        className="why-box"
                        key={`${p.id}-${shownDay}-${p.reason}`}
                        defaultValue={p.reason}
                        placeholder={locked ? '' : 'rang in — fever'}
                        disabled={locked}
                        onBlur={(e) => {
                          const typed = e.target.value.trim();
                          if (typed === (p.reason || '')) return;
                          saveDay(p, { reason: typed });
                        }}
                      />
                    </td>
                    <td className="small">
                      {/*
                        * Three states, not a tick box. Null is "nobody has
                        * decided", which is NOT "not approved" - a day nobody
                        * has looked at must not read as a refusal.
                        *
                        * All three on ONE line. "not decided" used to be a
                        * block under the two chips, which made every row of
                        * this table 89px tall: eighteen people came to 1,479px
                        * for a list that is read at a glance each morning.
                        * The third segment is both the state and the way to
                        * hand the decision back, which also beats "click the
                        * one already chosen", a rule nothing on screen said.
                        */}
                      <span className="yesno" role="group" aria-label="Was it allowed?">
                        <button
                          className={p.approved === true ? 'on yes' : undefined}
                          disabled={locked}
                          title="Allowed"
                          aria-pressed={p.approved === true}
                          onClick={() => saveDay(p, { approved: true })}
                        >
                          yes
                        </button>
                        <button
                          className={p.approved === false ? 'on no' : undefined}
                          disabled={locked}
                          title="Not allowed"
                          aria-pressed={p.approved === false}
                          onClick={() => saveDay(p, { approved: false })}
                        >
                          no
                        </button>
                        <button
                          className={p.approved === null || p.approved === undefined ? 'on none' : undefined}
                          disabled={locked}
                          title="Nobody has decided yet"
                          /*
                           * The dash is the label a screen reader gets too,
                           * through aria-label - NOT a visually-hidden span
                           * beside it. Such a span is position: absolute, it
                           * escapes the scrolling frame it looks like it is
                           * inside (the frame is not a positioned ancestor),
                           * and it is then laid out against the page from a
                           * static position 340px off the right-hand edge of
                           * a phone - which pushed the whole dashboard
                           * sideways. Measured, not guessed.
                           */
                          aria-label="not decided"
                          aria-pressed={p.approved === null || p.approved === undefined}
                          onClick={() => saveDay(p, { approved: null })}
                        >
                          —
                        </button>
                      </span>
                    </td>
                    <td className="muted small">
                      {p.department || <span className="muted">—</span>}
                    </td>
                    <td className="muted small">{p.company_name}</td>
                    {/*
                      * Straight to that person's record. The morning list is
                      * where somebody notices a problem; making them go to
                      * Employees and find the name again among eighty is how
                      * the noticing stops happening.
                      */}
                    <td>
                      <button className="link" onClick={() => onGo('employees', p.id)}>
                        view
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            {/* Always shown, even on one page: "Showing 1 to 10 of 85" is the
                sentence that tells somebody there IS more. */}
            <div className="pager">
              <span className="count">
                Showing {listed.length === 0 ? 0 : (onPage - 1) * PER_PAGE + 1} to{' '}
                {Math.min(onPage * PER_PAGE, listed.length)} of {listed.length}
                {listed.length === 1 ? ' person' : ' people'}
              </span>
              {pages > 1 && (
                <>
                  <button className="ghost" disabled={onPage <= 1} onClick={() => setPage(onPage - 1)}>
                    ‹
                  </button>
                  {Array.from({ length: pages }, (_, i) => i + 1)
                    /* Five at a time around where you are, so a long month
                       does not draw thirty numbered buttons. */
                    .filter((n) => Math.abs(n - onPage) <= 2 || n === 1 || n === pages)
                    .map((n, i, all) => (
                      <span key={n}>
                        {i > 0 && all[i - 1] !== n - 1 ? <span className="muted"> … </span> : null}
                        <button
                          className={n === onPage ? 'on' : 'ghost'}
                          onClick={() => setPage(n)}
                        >
                          {n}
                        </button>
                      </span>
                    ))}
                  <button className="ghost" disabled={onPage >= pages} onClick={() => setPage(onPage + 1)}>
                    ›
                  </button>
                </>
              )}
            </div>
            {/*
              * Six lines became one, the rest on the hover. The two facts that
              * MUST stay on screen: these boxes are stored on the DAY, so
              * typing here is not a note to self, and neither moves a rupee.
              */}
            <p
              className="muted small"
              title={
                "The same two boxes are in the day's menu on the Attendance grid, and an " +
                'approved leave application fills them in by itself. An allowed absence is ' +
                'still an absence; paid time off is Casual, Sick or Privilege leave.'
              }
            >
              <strong>Why</strong> and <strong>Allowed?</strong> are saved on the day itself and
              change nobody's pay.{saving > 0 ? ' Saving…' : ''}
            </p>
          </>
        )}
        {/*
          * `roll.accounted`, not five buckets added by hand - the hand-written
          * sum left out holiday and weekly off, so on a Sunday this read
          * "0 of 0 need looking at" with eighteen people on the card above it.
          */}
        <p
          className="muted small"
          title={`Late is judged against ${roll.startsAt} plus ${roll.grace} minutes and early against ${roll.endsAt}. A day with no clock time is never called late, only "not known". A full day is ${roll.dayHours} hours; anybody short of them is on the Short hours list with how far.`}
        >
          {bucket === 'all'
            ? `${needsLooking.length} of ${roll.accounted} need looking at.`
            : `${listed.length} of ${needsLooking.length} on this list.`}{' '}
          Late after {roll.startsAt} + {roll.grace}m, early before {roll.endsAt}, a full day{' '}
          {roll.dayHours}h.
        </p>

        {roll.present.length > 0 && (
          <>
            <p className="name-list small">
              <span className="muted">
                Present
                <button className="ghost tiny" onClick={() => setShowPresent((v) => !v)}>
                  {showPresent ? 'hide the names' : `show all ${roll.present.length}`}
                </button>
              </span>
            </p>
            {showPresent && (
              <NameList
                label=""
                list={roll.present}
                name={(p) => p.employee_name}
                suffix={(p) => p.in_time || undefined}
                all
              />
            )}
          </>
        )}

        {/*
          * The uniform check.
          *
          * Its own block, because it is the one thing on this page that is
          * about people who ARE at work - everything else lists whoever is
          * not. Folded away, since it is a walk round the floor and not
          * something to read every morning.
          *
          * "All of them proper" fills in only whoever has not been looked at
          * yet, exactly as "Mark everyone Present" fills only blank days. It
          * never overwrites a verdict somebody recorded, because then the
          * bulk button would quietly undo the walk.
          */}
        {roll.atWork.length > 0 && (
          <div className="uniform-fold">
            {/* A state toggle, not <details> - the same shape as the Present
                list above, and an uncontrolled <details> loses its open state
                every time the payroll reloads under it. */}
            <p className="name-list small">
              <strong>Uniform check</strong>
              <span className="muted">
                {' — '}
                {roll.uniformChecked === 0
                  ? `${roll.atWork.length} at work, none looked at yet`
                  : `${roll.uniformProper} proper · ${roll.outOfUniform.length} not · ${
                      roll.atWork.length - roll.uniformChecked
                    } not looked at`}
              </span>
              <button className="ghost tiny" onClick={() => setShowUniform((v) => !v)}>
                {showUniform ? 'hide' : `check the ${roll.atWork.length} at work`}
              </button>
            </p>
            {showUniform && (
            <>
            <div className="row" style={{ margin: '0.4rem 0' }}>
              <button
                disabled={locked || roll.uniformChecked === roll.atWork.length}
                onClick={() => {
                  const rest = roll.atWork.filter((p) => p.uniform === null);
                  if (!rest.length) return;
                  saveMany(rest.map((p) => ({ employee_id: p.id, day: shownDay, uniform: true })));
                }}
              >
                All {roll.atWork.filter((p) => p.uniform === null).length} not looked at: proper
              </button>
              <span className="muted small">
                It records what was seen — it changes nobody's pay.
              </span>
            </div>
            <div className="uniform-list">
              {roll.atWork.map((p) => (
                <span key={p.id} className={`uniform-row u${p.uniform === null ? '' : p.uniform ? 'y' : 'n'}`}>
                  <span className="who">{p.employee_name}</span>
                  <button
                    className={`chip tiny ${p.uniform === true ? 'active' : ''}`}
                    disabled={locked}
                    title="In proper uniform"
                    onClick={() => saveDay(p, { uniform: p.uniform === true ? null : true })}
                  >
                    ✓
                  </button>
                  <button
                    className={`chip tiny ${p.uniform === false ? 'active bad' : ''}`}
                    disabled={locked}
                    title="Not in proper uniform"
                    onClick={() => saveDay(p, { uniform: p.uniform === false ? null : false })}
                  >
                    ✗
                  </button>
                </span>
              ))}
            </div>
            <p className="muted small">
              Only people who were at work are here — there is no uniform to see on somebody who
              was not in, so an absence is never a uniform failure. A name with neither mark is{' '}
              <strong>not looked at</strong>, which is not the same as turning up wrong. Anybody
              marked ✗ shows on the list above and in the day's menu on the{' '}
              <strong>Attendance</strong> grid.
            </p>
            </>
            )}
          </div>
        )}

        {roll.clocked === 0 ? (
          <p className="muted small">
            Nobody clocked in on this day, so there is no way to say who was late — that
            needs an <strong>In</strong> time, either typed on the <strong>Time</strong> tab
            or imported from the punch machine under <strong>Reports</strong>. Overtime and
            short hours are still counted from the minutes marked on the grid.
          </p>
        ) : (
          <p
            className="muted small"
            title={`${roll.startsAt} is the usual start, set on the Time tab, with ${roll.grace} minutes' grace before anybody is called late.`}
          >
            {roll.clocked} of {rows.length} clocked in · late after {roll.startsAt} +{' '}
            {roll.grace}m.
          </p>
        )}
          </>
        )}
      </div>

      {/*
       * Each of these only appears when it has something to say. A card reading
       * "0 waiting" is noise, and a dashboard full of zeroes is one nobody
       * reads.
       */}
      {queues.length > 0 && (
        <div className="card" data-go="people">
          <div className="late-head">
            <div>
              <h2>Waiting on somebody</h2>
              <p className="muted small">
                Approvals, payments and answers that somebody has to decide. The month's own
                figures are under <em>Needs attention</em> below rather than repeated here.
              </p>
            </div>
            <button className="ghost tiny" onClick={() => onGo('people')}>
              open People
            </button>
          </div>
          <ul className="alerts">
            {queues.map((item) => (
              <li key={item.text}>{item.text}</li>
            ))}
          </ul>
        </div>
      )}

      {assets?.totals?.assets > 0 && (
        <div className="card" data-go="people">
          <div className="late-head">
            <div>
              <h2>Assets</h2>
              <p className="muted small">
                What is on the register, and what it has cost to buy and to keep.
              </p>
            </div>
            <button className="ghost tiny" onClick={() => onGo('people')}>
              open Assets
            </button>
          </div>
          <div className="figures">
            <div className="figure">
              <span className="k">On the register</span>
              <span className="n">{assets.totals.assets}</span>
            </div>
            <div className="figure">
              <span className="k">Serviced at least once</span>
              <span className="n">{assets.totals.serviced}</span>
            </div>
            <div className="figure">
              <span className="k">Cost to buy</span>
              <span className="n">{rupees(assets.totals.purchase)}</span>
            </div>
            <div className="figure">
              <span className="k">Cost to keep</span>
              <span className="n">{rupees(assets.totals.service)}</span>
            </div>
          </div>

          {(assets.alerts.overdue.length > 0 ||
            assets.alerts.soon.length > 0 ||
            assets.alerts.amc_gone.length > 0 ||
            assets.totals.costing_more_than_bought.length > 0) && (
            <ul className="alerts">
              {assets.alerts.overdue.length > 0 && (
                <li>
                  <strong>{assets.alerts.overdue.length} overdue a service</strong> —{' '}
                  {assets.alerts.overdue.slice(0, 4).map((a) => a.code).join(', ')}
                </li>
              )}
              {assets.alerts.soon.length > 0 && (
                <li>
                  {assets.alerts.soon.length} due within a month —{' '}
                  {assets.alerts.soon.slice(0, 4).map((a) => a.code).join(', ')}
                </li>
              )}
              {assets.alerts.amc_gone.length > 0 && (
                <li>
                  {assets.alerts.amc_gone.length} with a lapsed AMC —{' '}
                  {assets.alerts.amc_gone.slice(0, 4).map((a) => a.code).join(', ')}
                </li>
              )}
              {assets.totals.costing_more_than_bought.length > 0 && (
                <li>
                  {assets.totals.costing_more_than_bought.length} ha
                  {assets.totals.costing_more_than_bought.length === 1 ? 's' : 've'} cost more to
                  keep than to buy —{' '}
                  {assets.totals.costing_more_than_bought.slice(0, 4).map((a) => a.code).join(', ')}
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {alerts.length > 0 && (
        <div className="pcard">
          <div className="pcard-head">
            <Glyph name="alert" size={16} />
            Pending actions
            <span className="pa-num">{alerts.length + queues.length}</span>
            <span className="spacer" />
            <button onClick={() => onGo('reports')}>View all →</button>
          </div>
          <div className="pcard-body">
            {/* Each row goes somewhere different, so the whole row is the
                target rather than only a word at the end of it. */}
            {alerts.map((alert, i) => (
              <button key={alert.key} className="pa-row" onClick={() => onGo(alert.go)}>
                <span
                  className="pa-ico"
                  style={{ background: `var(--tile-${(i % 6) + 1}-ink)` }}
                >
                  <Glyph name="alert" size={13} />
                </span>
                <span className="pa-name">{alert.text}</span>
              </button>
            ))}
            {/*
              * The queues come from the digest and are server-only, so this
              * half of the list is simply absent in the single file rather
              * than showing an empty box that looks broken.
              */}
            {queues.map((item) => (
              <button key={item.text} className="pa-row" onClick={() => onGo('people')}>
                <span className="pa-ico" style={{ background: 'var(--tile-5-ink)' }}>
                  <Glyph name="people" size={13} />
                </span>
                <span className="pa-name">{item.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card dates-card" data-go="employees">
        <h2>
          New joinees, birthdays &amp; anniversaries — {MONTHS[period.month - 1]} {period.year}
          <button className="ghost tiny" onClick={() => onGo('employees')}>open Employees</button>
        </h2>
        <div className="dates-grid">
          <DateGroup
            icon="👋"
            title="Joined this month"
            list={people.joined}
            month={period.month}
            empty="Nobody new this month."
          />
          <DateGroup
            icon="🎂"
            title="Birthdays"
            list={people.birthdays}
            month={period.month}
            note={(e) => (e.turning > 0 ? `turns ${e.turning}` : '')}
            empty="No birthdays on record for this month."
          />
          <DateGroup
            icon="🎉"
            title="Work anniversaries"
            list={people.anniversaries}
            month={period.month}
            note={(e) => `${e.years} year${e.years === 1 ? '' : 's'}`}
            empty="No anniversaries this month."
          />
          <DateGroup
            icon="👋"
            title="Left this month"
            list={people.left}
            month={period.month}
            empty="Nobody left."
          />
        </div>
        {people.missingDates > 0 && (
          <p className="muted small">
            {people.missingDates} of {people.active} have no date of birth or joining date on
            record, so they can never appear here. Both are columns on the{' '}
            <button className="link" onClick={() => onGo('employees')}>Employees</button> table —
            fill them in once and this looks after itself.
          </p>
        )}
      </div>

      <div className="card" data-go="sheet">
        <h2>
          {period.label} — the month
          {companyName && <span className="muted"> · {companyName}</span>}
          {period.locked ? <span className="pill locked"> Locked</span> : null}
          <button className="ghost tiny" onClick={() => onGo('sheet')}>
            open the salary sheet
          </button>
        </h2>

        <div className="stat-row">
          <Stat label="Staff" value={rows.length} plain go={onGo} to="employees" />
          <Stat label="Salaries paid" value={`${money.paidCount} of ${rows.length}`} plain go={onGo} to="sheet" />
          <Stat label="Still to pay" value={money.pendingCount} plain go={onGo} to="sheet" />
          <Stat label="On hold" value={money.holdCount} plain go={onGo} to="sheet" />
          <Stat label="Days lost" value={days(thisMonth.absent)} plain go={onGo} to="attendance" />
        </div>

        {/* How many are settled, not what they came to. */}
        <SegBar
          parts={[
            { label: 'Paid', value: money.paidCount, tone: 'paid', text: money.paidCount },
            {
              label: 'Still to pay',
              value: money.pendingCount,
              tone: 'none',
              text: money.pendingCount,
            },
          ]}
          unit=" people"
          empty="Nobody on this month yet."
        />

        {previous ? (
          <p className="compare small">
            <span className="muted">Against {previous.label}:</span>
            <Delta label="staff" now={thisMonth.staff} was={previous.staff} />
            <Delta label="days lost" now={thisMonth.absent} was={previous.absent} invert />
          </p>
        ) : (
          <p className="muted small">
            Nothing to compare against yet — this is the first month, or the one before it was
            never opened.
          </p>
        )}
        <p className="muted small">
          What the month comes to is on the <strong>Salary sheet</strong> and in{' '}
          <strong>Reports</strong>, not here.
        </p>
      </div>

      {daily.some((d) => d.marked > 0) && (
        <div className="card" data-go="attendance">
          <h2>
            Day by day — {MONTHS[period.month - 1]} {period.year}
            <button className="ghost tiny" onClick={() => onGo('attendance')}>open</button>
          </h2>
          <DayTrend
            daily={daily}
            shown={shownDay}
            onDay={setDay}
            people={rows.length}
          />
        </div>
      )}

      {trend.length > 1 && (
        <div className="card" data-go="attendance">
          <h2>
            Days lost, last {trend.length} months
            <button className="ghost tiny" onClick={() => onGo('attendance')}>open</button>
          </h2>
          <Trend trend={trend} current={period.id} onPeriod={onPeriod} />
        </div>
      )}

      <div className="dash-grid">
        <div className="card" data-go="attendance">
          <h2>
            Attendance <button className="ghost tiny" onClick={() => onGo('attendance')}>open</button>
          </h2>
          <div className="stat-row">
            <Stat label="Present" value={attendance.present} plain />
            <Stat label="Absent" value={attendance.absent} plain />
            <Stat label="Leave" value={attendance.leave} plain />
            <Stat label="Not marked" value={attendance.blank} plain />
          </div>
          <p className="muted small">
            Day counts across all {rows.length} people for the whole month. Paid holidays{' '}
            {attendance.holiday}, Sundays off {attendance.sunday}.
          </p>
        </div>

        <div className="card" data-go="time">
          <h2>
            Hours <button className="ghost tiny" onClick={() => onGo('time')}>open</button>
          </h2>
          {attendance.hours.days ? (
            <>
              <div className="stat-row">
                <Stat label="Worked" value={formatDuration(attendance.hours.worked)} plain />
                <Stat label="Expected" value={formatDuration(attendance.hours.expected)} plain />
                <Stat label="Short" value={formatDuration(attendance.hours.short) || '-'} plain />
                <Stat label="Overtime" value={formatDuration(attendance.hours.overtime) || '-'} plain />
              </div>
              <p className="muted small">
                From {attendance.hours.days} day{attendance.hours.days === 1 ? '' : 's'} with in
                and out times, at {days(period.hours_per_day)} hours a day.
              </p>
            </>
          ) : (
            <p className="muted small">
              No in/out times yet this month. Type them on the <strong>Time</strong> tab, or import
              the punch machine's file from <strong>Reports</strong>.
            </p>
          )}
        </div>

        <div className="card" data-go="sunday">
          <h2>
            Sunday duty <button className="ghost tiny" onClick={() => onGo('attendance')}>open</button>
          </h2>
          <div className="stat-row">
            <Stat label="People" value={sunday.people} plain />
            <Stat label="Days worked" value={days(sunday.days)} plain />
            <Stat label="Still to pay" value={sunday.unpaidCount} plain />
          </div>
          <p className="muted small">
            Paid on its own register, apart from the month's salary — the amounts are there.
          </p>
        </div>

        <div className="card" data-go="reports">
          <h2>
            Statutory <button className="ghost tiny" onClick={() => onGo('reports')}>open</button>
          </h2>
          <div className="stat-row">
            <Stat label="On PF" value={statutory?.pf.rows.length || 0} plain />
            <Stat label="On ESI" value={statutory?.esi.rows.length || 0} plain />
            <Stat label="Under the PT slab" value={statutory?.pt.exempt || 0} plain />
            <Stat label="Repaying a loan" value={loans.people} plain />
          </div>
          <p className="muted small">
            How many people, not how much — the registers and the figures are under{' '}
            <strong>Reports</strong>.
          </p>
        </div>
      </div>

      <div className="dash-grid">
        <div className="card wide" data-go="attendance">
          <h2>
            Who stands out this month{' '}
            <button className="ghost tiny" onClick={() => onGo('attendance')}>open</button>
          </h2>
          <div className="stat-row">
            <Stat label="Days present" value={days(monthTotalsOf.present)} plain />
            <Stat label="Days lost" value={days(monthTotalsOf.absent)} plain />
            <Stat label="Hours worked" value={formatDuration(monthTotalsOf.worked) || '-'} plain />
            <Stat label="Late arrivals" value={monthTotalsOf.late} plain />
            <Stat label="Early finishes" value={monthTotalsOf.early} plain />
          </div>
          <NameList
            label="Most days present"
            list={outliers.mostPresent}
            name={(m) => m.employee_name}
            suffix={(m) => `${days(m.present)} day${m.present === 1 ? '' : 's'}`}
          />
          <NameList
            label="Most days lost"
            list={outliers.mostAbsent}
            name={(m) => m.employee_name}
            suffix={(m) => `${days(m.absent)} day${m.absent === 1 ? '' : 's'}`}
          />
          <NameList
            label="Most hours worked"
            list={outliers.mostHours}
            name={(m) => m.employee_name}
            suffix={(m) => `${formatDuration(m.worked)} over ${m.clocked} days`}
          />
          <NameList
            label="Fewest hours worked"
            list={outliers.leastHours}
            name={(m) => m.employee_name}
            suffix={(m) => `${formatDuration(m.worked)} over ${m.clocked} days`}
          />
          <NameList
            label="Most late arrivals"
            list={outliers.late}
            name={(m) => m.employee_name}
            suffix={(m) => `${m.late} day${m.late === 1 ? '' : 's'}`}
          />
          <NameList
            label="Most early finishes"
            list={outliers.early}
            name={(m) => m.employee_name}
            suffix={(m) => `${m.early} day${m.early === 1 ? '' : 's'}`}
          />
          <NameList
            label="Most hours short"
            list={outliers.short}
            name={(r) => r.employee_name}
            suffix={(r) => formatDuration(-r.ot_minutes)}
          />
          <NameList
            label="Most overtime"
            list={outliers.over}
            name={(r) => r.employee_name}
            suffix={(r) => formatDuration(r.ot_minutes)}
          />
          {!outliers.mostPresent.length && !outliers.mostAbsent.length && (
            <p className="muted small">
              Nothing marked this month yet, so there is nobody to rank.
            </p>
          )}
          {outliers.anyClocked === 0 && outliers.mostPresent.length > 0 && (
            <p className="muted small">
              Hours, late arrivals and early finishes need clock times — nobody's are recorded
              this month. Type them on the <strong>Time</strong> tab or import the punch
              machine's file.
            </p>
          )}
        </div>

        <div className="card" data-go="reports">
          <h2>
            Filing <button className="ghost tiny" onClick={() => onGo('reports')}>open</button>
          </h2>
          <ul className="due-list">
            {filings.map((filing) => (
              <li key={filing.label}>
                <span className="due-what">
                  {filing.label}
                  <span className="hint">{filing.note}</span>
                </span>
                <span className="muted small">by {filing.due}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">
            Usual Gujarat dates — check the portal for the year, they move.
          </p>
        </div>
      </div>

      {departments.length > 1 && (
        <div className="card" data-go="employees">
          <h2>
            By department
            <button className="ghost tiny" onClick={() => onGo('employees')}>open</button>
          </h2>
          <BarRows
            rows={departments.map((d) => ({
              label: d.name,
              value: d.count,
              text: `${d.count}`,
              rate: d.rate,
            }))}
            note={(r) => `${r.rate} attendance`}
          />
          {/* Only worth a card when there is more than one of them: a single
              "Not set" bar says nothing anybody can act on. */}
        </div>
      )}

      <div className="card" data-go="employees">
        <h2>
          By company
          <button className="ghost tiny" onClick={() => onGo('employees')}>open</button>
        </h2>
        <BarRows
          rows={companies
            .map((c) => ({
              label: c.name,
              value: c.totals.count,
              text: `${c.totals.count}`,
              rate: presentRate(c.rows),
            }))
            .sort((a, b) => b.value - a.value)}
          note={(r) => `${r.rate} present`}
        />
        <div className="table-wrap">
          <table className="sheet">
            <thead>
              <tr>
                <th className="sticky-name">Company</th>
                <th>Staff</th>
                <th title="Days marked present, out of the days that carry any mark">Present</th>
                <th>Days lost</th>
                <th>Salaries paid</th>
                <th>Still to pay</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => {
                const paid = company.rows.filter((r) => r.status === 'paid');
                const outstanding = company.rows.filter((r) => r.status !== 'paid');
                const t = company.totals;
                return (
                  <tr key={company.id}>
                    <td className="sticky-name">{company.name}</td>
                    <td className="num">{t.count}</td>
                    <td className="num">{presentRate(company.rows)}</td>
                    <td className="num">
                      {days(company.rows.reduce((sum, r) => sum + r.absent_days, 0))}
                    </td>
                    <td className="num muted">{paid.length}</td>
                    <td className="num">{outstanding.length}</td>
                  </tr>
                );
              })}
              {!companies.length && (
                <tr>
                  <td colSpan={6} className="empty">
                    No companies yet — add one under <strong>Employees</strong>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          {employees.filter((e) => e.active).length} active on the master
          {employees.length !== employees.filter((e) => e.active).length &&
            `, ${employees.length - employees.filter((e) => e.active).length} left`}
          . Working days are fixed at 26.
        </p>
      </div>
    </section>
  );
}

/**
 * Whether a day is one where coming in late or leaving early means anything.
 *
 * A half day, an approved leave, a holiday or an absence are not black marks
 * for finishing before six - they were never a full day to begin with. A day
 * with no mark at all still counts, because somebody clocked in on it.
 */
const FULL_DAY_MARKS = new Set(['', 'P', 'WH', 'SP', 'HP']);
const judgedOnTime = (code) => FULL_DAY_MARKS.has(String(code || '').toUpperCase());

/*
 * Who was actually at work, for the uniform check.
 *
 * A half day counts - they turned up, so there was a uniform to see. An
 * absence, leave, a holiday and a day off do NOT: there is nothing to inspect
 * on somebody who was not there, and an absence must never read as a uniform
 * failure. A day with no mark is left out too, because nobody has said whether
 * they were in at all.
 */
const WORKED_MARKS = new Set(['P', 'HF', 'WH', 'SP', 'HP']);

/** Days marked present out of the days that carry any mark at all. */
/*
 * Attendance, as the absent/present report works it out - not as this page
 * used to.
 *
 * It counted every marked day and called anything that was not A/AD/UL
 * "present", so a Sunday OFF and a paid holiday both read as attendance and a
 * half day read as a whole one. On an ordinary month (18 P, 2 A, 2 HF, 4 S,
 * 2 PH) this page said 93% where Reports said 87%, for the same person and
 * the same month. The rule now lives in one place and both read it.
 */
function presentRate(rows) {
  const pct = attendancePercent(rows);
  return pct === null ? '-' : `${Math.round(pct)}%`;
}

/**
 * One month against the one before it. Down is normally the bad direction, so
 * the colour follows the number - except for days lost, where it is the other
 * way round and `invert` says so.
 */
function Delta({ label, now, was, money, invert }) {
  const change = now - was;
  if (!was && !now) return null;
  if (change === 0) {
    return (
      <span className="delta">
        {label} <span className="muted">same</span>
      </span>
    );
  }
  const pct = was ? Math.round((change / Math.abs(was)) * 100) : null;
  const good = invert ? change < 0 : change > 0;
  const show = money ? rupees(Math.abs(change)) : days(Math.abs(change));
  return (
    <span className={`delta${good ? ' up' : ' down'}`}>
      {change > 0 ? '▲' : '▼'} {show}
      {pct !== null && <span className="muted"> ({Math.abs(pct)}%)</span>} {label}
    </span>
  );
}

/**
 * One kind of date for the month - joiners, birthdays, anniversaries, leavers -
 * as a short dated list rather than a row of chips, because the day it falls on
 * is the useful part.
 */
function DateGroup({ icon, title, list, month, note, empty }) {
  return (
    <div className="date-group">
      <h3>
        <span className="date-icon" aria-hidden="true">{icon}</span>
        {title}
        {list.length > 0 && <span className="count">{list.length}</span>}
      </h3>
      {list.length ? (
        <ul>
          {list.map((person) => (
            <li key={person.id}>
              <span className="date-day">
                {person.dayOfMonth} {MONTHS[month - 1].slice(0, 3)}
              </span>
              <span className="date-name">{person.name}</span>
              {note?.(person) && <span className="muted small">{note(person)}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{empty}</p>
      )}
    </div>
  );
}

/**
 * Names with something after each, or nothing at all.
 *
 * Long lists are cut short with a count, because a roll call of seventy people
 * is not a list anybody reads - except where the caller says `all`, which is
 * the roll call itself: who was absent is exactly the list you want in full.
 */
const NAME_LIMIT = 12;

function NameList({ label, list, name = (e) => e.name, suffix, all }) {
  const [expanded, setExpanded] = useState(false);
  if (!list?.length) return null;
  const limit = all && !expanded ? 30 : NAME_LIMIT;
  const shown = expanded ? list : list.slice(0, limit);
  const hidden = list.length - shown.length;
  return (
    <p className="name-list small">
      {label && (
        <span className="muted">
          {label} <span className="count">{list.length}</span>
        </span>
      )}
      {shown.map((item, i) => (
        <span key={item.id ?? item.employee_id ?? i} className="name-item">
          {name(item)}
          {suffix?.(item) && <span className="muted"> {suffix(item)}</span>}
        </span>
      ))}
      {hidden > 0 && (
        <button className="ghost tiny" onClick={() => setExpanded(true)}>
          and {hidden} more
        </button>
      )}
    </p>
  );
}

/**
 * Net payable per month as bars, drawn by hand rather than by a charting
 * library - it is one series and a handful of months, and the standalone file
 * has to stay one file.
 */
/*
 * The months behind this one. It used to draw net payable; the dashboard
 * carries no money now, so it draws days lost - the figure this page is
 * actually about, and the one worth seeing a run of.
 */
function Trend({ trend, current, onPeriod }) {
  const top = Math.max(...trend.map((t) => t.absent), 1);
  return (
    <div className="trend">
      {trend.map((month) => {
        const height = Math.max(2, Math.round((month.absent / top) * 100));
        const isNow = month.period.id === current;
        return (
          <button
            key={month.period.id}
            className={`trend-bar${isNow ? ' now' : ''}`}
            disabled={!onPeriod || isNow}
            title={`${month.period.label} — ${month.staff} staff, ${days(month.absent)} days lost`}
            onClick={() => onPeriod?.(month.period.id)}
          >
            <span className="trend-value">{days(month.absent)}</span>
            <span className="trend-track">
              <span className="trend-fill" style={{ height: `${height}%` }} />
            </span>
            <span className="trend-label">{month.label}</span>
            <span className="trend-sub muted">{month.staff}</span>
          </button>
        );
      })}
    </div>
  );
}

function Stat({ label, value, sub, strong, plain, go, to }) {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{plain ? value : rupees(value)}</span>
      {sub && <span className="stat-sub muted small">{sub}</span>}
    </>
  );
  if (go && to) {
    return (
      <button className={`stat stat-link${strong ? ' strong' : ''}`} onClick={() => go(to)}>
        {body}
      </button>
    );
  }
  return <div className={`stat${strong ? ' strong' : ''}`}>{body}</div>;
}

/*
 * ---- the two shapes this page draws ----
 *
 * No charting library: these are a handful of divs, which is the whole of what
 * either one needs and keeps the single-file build small enough to email.
 *
 * Both follow the same rules. Every segment carries its own written label and
 * figure, so colour is never the only thing saying what a piece is - which is
 * also the relief the light-mode palette needs, since two of its hues sit under
 * 3:1 against white. A 2px gap of the page's own background separates segments
 * rather than a border, hovering any piece names it, and the table underneath
 * is still the authority. Neither shape computes anything: it is handed the
 * same figures the cards above print.
 */

/** Parts of one whole, as a bar. Anything under 2% still gets a sliver. */
function SegBar({ parts, unit = '', empty }) {
  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((sum, p) => sum + p.value, 0);
  if (!total) return empty ? <p className="muted small">{empty}</p> : null;

  return (
    <div className="viz">
      <div className="viz-bar">
        {shown.map((p) => (
          <span
            key={p.label}
            className="viz-seg"
            style={{
              flexGrow: Math.max(p.value / total, 0.02),
              background: `var(--viz-${p.tone})`,
            }}
            title={`${p.label}: ${p.text || p.value}${unit} — ${Math.round((p.value / total) * 100)}%`}
          />
        ))}
      </div>
      <p className="viz-legend">
        {shown.map((p) => (
          <span key={p.label} className="viz-key">
            <i className="viz-dot" style={{ background: `var(--viz-${p.tone})` }} />
            {p.label}
            <strong>{p.text || p.value}</strong>
          </span>
        ))}
      </p>
    </div>
  );
}

/** One measure across a few named rows, longest first. */
function BarRows({ rows, note }) {
  const top = Math.max(...rows.map((r) => r.value), 0);
  if (!rows.length || top <= 0) return null;
  return (
    <div className="viz-rows">
      {rows.map((r) => (
        <div className="viz-row" key={r.label} title={`${r.label}: ${r.text}`}>
          <span className="viz-row-name">{r.label}</span>
          <span className="viz-track">
            <span className="viz-fill" style={{ width: `${(r.value / top) * 100}%` }} />
          </span>
          <span className="viz-row-value num">{r.text}</span>
          {note && <span className="viz-row-note muted small">{note(r)}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * The month, one bar a day.
 *
 * Height is attendance for that day, by the same rule as everything else on
 * this page. Three things it refuses to do:
 *
 * - a day nobody has marked is a GAP, not a zero bar. Zero would read as
 *   "nobody came in", which is a different and much more alarming thing;
 * - a weekly off is drawn faint rather than left out, so the shape of the
 *   month is still the shape of the month;
 * - and the day the roll call is on is marked, so the two are visibly the
 *   same day. Clicking a bar moves it.
 */
function DayTrend({ daily, shown, onDay, people }) {
  return (
    <div className="trend day-trend">
      {daily.map((d) => {
        const height = d.rate === null ? 0 : Math.max(2, Math.round(d.rate));
        const title =
          d.marked === 0
            ? `${d.day} — nothing marked`
            : `${d.day} — ${d.present} in, ${d.absent} absent, ${d.leave} on leave, ${d.halfDay} half, ${d.off} off` +
              (d.rate === null ? '' : ` · ${Math.round(d.rate)}%`);
        return (
          <button
            key={d.day}
            className={`trend-bar${d.day === shown ? ' now' : ''}${d.sunday ? ' off-day' : ''}`}
            title={title}
            onClick={() => onDay(d.day)}
          >
            <span className="trend-track">
              {d.marked === 0 ? (
                <span className="trend-gap" title="nothing marked" />
              ) : (
                <span className="trend-fill" style={{ height: `${height}%` }} />
              )}
            </span>
            <span className="trend-label">{d.day}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * A column header that sorts.
 *
 * Clicking cycles up, down, and back to the page's own order. The third state
 * matters: the default order is "how much has to be done about this person",
 * which is the order a morning list is read in. Sorting by name buries the
 * one absence among seventy-eight names, and without a way back somebody is
 * stuck there.
 */
function Th({ by, sort, setSort, className, children }) {
  const on = sort.by === by;
  const next = () => {
    if (!on) return { by, dir: 1 };
    if (sort.dir === 1) return { by, dir: -1 };
    return { by: '', dir: 1 };
  };
  return (
    <th className={className}>
      <button className="th-sort" onClick={() => setSort(next())}>
        {children}
        <span className="muted">{on ? (sort.dir === 1 ? ' \u25b2' : ' \u25bc') : ''}</span>
      </button>
    </th>
  );
}

/**
 * The day's register, as a file.
 *
 * CSV with a BOM - what every other export here writes, and what opens in
 * Excel without a dialogue about encoding. It writes exactly what is on
 * screen, chip and search and sort already applied, because an export that
 * quietly differs from the table above it is worse than no export.
 */
function exportRegister(listed, period, day) {
  const head = [
    'Date', 'Code', 'Name', 'Department', 'Company', 'Status', 'Why they are listed',
    'In', 'Out', 'Hours worked', 'Late by', 'Reason', 'Allowed', 'Uniform',
  ];
  const date = `${period.year}-${String(period.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const cell = (v) => {
    const text = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [head.map(cell).join(',')];
  for (const p of listed) {
    lines.push([
      date,
      p.employee_code,
      p.employee_name,
      p.department,
      p.company_name,
      p.code ? ATTENDANCE_CODES[p.code]?.label || p.code : 'Not marked',
      p.reasons.map((r) => r.what + (r.when ? ` at ${r.when}` : '')).join('; '),
      p.in_time,
      p.out_time,
      /* Blank, never 0, for a day nobody clocked. */
      p.workedMinutes === null ? '' : formatDuration(p.workedMinutes),
      p.lateBy ? formatDuration(p.lateBy) : '',
      p.reason,
      /* Three states, and the file says so rather than writing No for a day
         nobody has looked at. */
      p.approved === true ? 'Yes' : p.approved === false ? 'No' : 'Not decided',
      p.uniform === true ? 'Proper' : p.uniform === false ? 'Not proper' : 'Not checked',
    ].map(cell).join(','));
  }
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `attendance-${date}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * A line of attendance over time.
 *
 * Inline SVG, no charting library - the whole of what this needs is a
 * polyline and some text, and the single-file build has to stay small enough
 * to send on WhatsApp.
 *
 * Two rules it keeps. The scale starts at a floor rather than at zero,
 * because real attendance sits between 85 and 100 and a 0-100 axis draws a
 * flat line across the top that says nothing; the floor is LABELLED so
 * nobody reads a half-height point as 50%. And a point with nothing marked
 * is a GAP in the line, not a zero - zero would read as "nobody came in".
 */
function LineChart({ points, onPoint, height = 190 }) {
  const real = points.filter((p) => p.value !== null);
  if (real.length < 2) {
    return <p className="muted small">Not enough marked days yet to draw a line.</p>;
  }
  const lo = Math.max(0, Math.floor(Math.min(...real.map((p) => p.value)) / 5) * 5 - 5);
  const hi = 100;
  const W = 760;
  const H = height;
  const padL = 34;
  const padR = 10;
  const padT = 18;
  const padB = 26;
  const x = (i) => padL + (i * (W - padL - padR)) / Math.max(1, points.length - 1);
  const y = (v) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);

  /* Broken into runs, so a day with no marks leaves a gap rather than a line
     dropping to the floor and back. */
  const runs = [];
  let run = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (run.length > 1) runs.push(run);
      run = [];
    } else {
      run.push([x(i), y(p.value)]);
    }
  });
  if (run.length > 1) runs.push(run);

  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Attendance over time">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
          <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
            {t}%
          </text>
        </g>
      ))}
      {runs.map((r, i) => (
        <polyline
          key={i}
          points={r.map(([px, py]) => `${px},${py}`).join(' ')}
          fill="none"
          stroke="var(--tile-1-ink)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {points.map((p, i) =>
        p.value === null ? null : (
          <g key={p.label} onClick={() => onPoint?.(p)} style={{ cursor: onPoint ? 'pointer' : 'default' }}>
            <circle cx={x(i)} cy={y(p.value)} r="4" fill="var(--surface)" stroke="var(--tile-1-ink)" strokeWidth="2.5" />
            {/* A generous invisible target, because a 4px dot is not something
                anybody hits with a finger. */}
            <circle cx={x(i)} cy={y(p.value)} r="14" fill="transparent">
              <title>{`${p.label} — ${Math.round(p.value)}%${p.note ? ` · ${p.note}` : ''}`}</title>
            </circle>
            {points.length <= 14 && (
              <text x={x(i)} y={y(p.value) - 11} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--text)">
                {Math.round(p.value)}%
              </text>
            )}
          </g>
        )
      )}
      {points.map((p, i) =>
        i % Math.ceil(points.length / 10) ? null : (
          <text key={`l${p.label}`} x={x(i)} y={H - 7} textAnchor="middle" fontSize="11" fill="var(--muted)">
            {p.label}
          </text>
        )
      )}
    </svg>
  );
}

/**
 * A donut, drawn with one circle per slice and a dash offset.
 *
 * The number in the middle is the OVERALL figure, not the sum of the slices -
 * attendance across everybody, which is not the average of four company
 * percentages when the companies are different sizes. Each slice is sized by
 * headcount and labelled with its own rate, so the two readings stay apart.
 */
function Donut({ slices, middle, caption, size = 150 }) {
  const total = slices.reduce((n, s) => n + s.weight, 0);
  if (!total) return <p className="muted small">Nothing to show yet.</p>;
  const r = 54;
  const c = 2 * Math.PI * r;
  let at = 0;
  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox="0 0 140 140" role="img" aria-label={caption}>
        <g transform="rotate(-90 70 70)">
          {slices.map((s) => {
            const len = (s.weight / total) * c;
            const el = (
              <circle
                key={s.label}
                cx="70"
                cy="70"
                r={r}
                fill="none"
                stroke={s.colour}
                strokeWidth="22"
                strokeDasharray={`${Math.max(0, len - 2)} ${c}`}
                strokeDashoffset={-at}
              >
                <title>{`${s.label} — ${s.text}`}</title>
              </circle>
            );
            at += len;
            return el;
          })}
        </g>
        <text x="70" y="68" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--text)">
          {middle}
        </text>
        <text x="70" y="86" textAnchor="middle" fontSize="10" fill="var(--muted)">
          {caption}
        </text>
      </svg>
      <div className="donut-legend">
        {slices.map((s) => (
          <div key={s.label} title={`${s.label} — ${s.text}`}>
            <span className="dot" style={{ background: s.colour }} />
            <span className="ellipsis">{s.label}</span>
            <span className="v">{s.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
