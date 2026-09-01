import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import {
  festivalNames,
  fixedFestivalsIn,
  matchFestival,
  religionsToTick,
} from '../../../shared/festivals.js';
import { daysInMonth, weekday } from '../format.js';

/**
 * Festivals and shutdowns for the month.
 *
 * A festival is rarely a holiday for everybody: Eid is paid leave for the
 * Muslim staff and an ordinary working day for the rest, Diwali the other way
 * round. So each one carries the religions it covers, and applying it writes
 * Paid Holiday onto that day for exactly those people. Leave the religions
 * empty and it covers the whole office - a shutdown, a strike, a wedding.
 *
 * They are kept as a list rather than being marked and forgotten, so the month
 * carries a record of why those days are paid, and so a festival can be
 * re-applied after somebody joins.
 */
/** "Hindu, Jain and Sikh" rather than "Hindu and Jain and Sikh". */
const listOut = (items, last = 'and') =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ${last} ${items.at(-1)}`;

export default function Festivals({ period, codes, employees, locked, onApplied }) {
  const [holidays, setHolidays] = useState([]);
  const [name, setName] = useState('');
  const [day, setDay] = useState('');
  const [code, setCode] = useState('PH');
  const [chosen, setChosen] = useState(() => new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const total = daysInMonth(period.year, period.month);
  const monthName = new Date(period.year, period.month - 1, 1).toLocaleString('en-IN', { month: 'long' });

  /** Every religion on the staff list, with how many people carry it. */
  const religions = useMemo(() => {
    const counts = new Map();
    for (const emp of employees) {
      if (!emp.active || !emp.religion) continue;
      counts.set(emp.religion, (counts.get(emp.religion) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [employees]);

  const withoutReligion = employees.filter((e) => e.active && !e.religion).length;

  /**
   * What the name typed into the box turns out to be. The app cannot know that
   * Bakri Eid is Muslim on its own, so shared/festivals.js says so, and the
   * ticks follow the name - they can still be changed afterwards.
   */
  const known = useMemo(() => matchFestival(name), [name]);
  const suggested = useMemo(
    () => religionsToTick(known, religions.map(([r]) => r)),
    [known, religions]
  );

  /**
   * Setting the name also sets the ticks, and the date where the festival has
   * one that does not move. Every other date is left blank on purpose: these
   * follow the moon and shift by a fortnight between years, and a guessed date
   * here would cost somebody a day's pay.
   */
  const pickName = (value) => {
    setName(value);
    const festival = matchFestival(value);
    if (!festival) return;
    setChosen(new Set(religionsToTick(festival, religions.map(([r]) => r)).tick));
    if (festival.fixed?.month === period.month) setDay(String(festival.fixed.day));
  };

  /** The ones falling in this month whose date is genuinely fixed. */
  const thisMonth = useMemo(
    () => fixedFestivalsIn(period.month).filter((f) => !holidays.some((h) => h.day === f.fixed.day)),
    [period.month, holidays]
  );

  const load = async () => {
    try {
      const { holidays: list } = await api.get(`/periods/${period.id}/holidays`);
      setHolidays(list);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
    // Reloading whenever the month changes is the whole dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.id]);

  const covers = (holiday) =>
    employees.filter(
      (e) => e.active && (!holiday.religions.length || holiday.religions.includes(e.religion))
    ).length;

  const add = async (e) => {
    e.preventDefault();
    setError('');
    setBusy('add');
    try {
      await api.post(`/periods/${period.id}/holidays`, {
        name,
        day: Number(day),
        code,
        religions: [...chosen],
      });
      setName('');
      setDay('');
      setChosen(new Set());
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const apply = async (holiday) => {
    setError('');
    setBusy(`apply-${holiday.id}`);
    try {
      const { marked } = await api.post(`/periods/${period.id}/holidays/${holiday.id}/apply`);
      await load();
      await onApplied();
      setBusy('');
      setError('');
      window.alert(
        `${holiday.name}: ${marked} ${marked === 1 ? 'person' : 'people'} marked ` +
          `${codes[holiday.code]?.label || holiday.code} on ${holiday.day} ${monthName}.`
      );
    } catch (err) {
      setError(err.message);
      setBusy('');
    }
  };

  const remove = async (holiday) => {
    if (!window.confirm(`Remove "${holiday.name}" from the list?\n\nMarks already on the grid stay as they are.`)) return;
    try {
      await api.del(`/periods/${period.id}/holidays/${holiday.id}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggle = (religion) => {
    const next = new Set(chosen);
    if (next.has(religion)) next.delete(religion);
    else next.add(religion);
    setChosen(next);
  };

  return (
    <div className="card">
      <h2>Festivals & holidays — {period.label}</h2>
      <p className="muted small">
        A festival is not a holiday for everyone. Type the name and the religions it covers are
        ticked for you — Diwali is Hindu, Bakri Eid is Muslim, Christmas is Christian — then
        press <strong>Apply</strong> and those people get the day paid while the rest work as
        normal. Change the ticks if your office does it differently, and leave them all off for
        a day that covers everybody.
      </p>
      <p className="muted small">
        <strong>The date is yours to set.</strong> Almost every festival follows the moon and
        moves by a fortnight or more between years, so it is never guessed here. Only the ones
        with a genuinely fixed date — the national holidays, Uttarayan, Christmas — fill it in
        by themselves.
      </p>

      {!religions.length && (
        <p className="error">
          Nobody has a religion set yet, so a festival can only be applied to everybody. Set it
          under <strong>Employees</strong> first — tick the list and use “Set religion to”.
        </p>
      )}

      <datalist id="festival-names">
        {festivalNames().map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      {thisMonth.length > 0 && (
        <p className="name-list small">
          <span className="muted">Falls in {monthName}</span>
          {thisMonth.map((festival) => (
            <button
              key={festival.name}
              type="button"
              className="ghost tiny name-item"
              onClick={() => pickName(festival.name)}
            >
              {festival.name} <span className="muted">{festival.fixed.day} {monthName}</span>
            </button>
          ))}
        </p>
      )}

      <form className="festival-form" onSubmit={add}>
        <label>
          Festival
          <input
            required
            list="festival-names"
            placeholder="e.g. Eid, Diwali, Christmas"
            value={name}
            onChange={(e) => pickName(e.target.value)}
          />
        </label>
        <label>
          Date
          <select required value={day} onChange={(e) => setDay(e.target.value)}>
            <option value="">…</option>
            {Array.from({ length: total }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d} {monthName} ({weekday(period.year, period.month, d)})
              </option>
            ))}
          </select>
        </label>
        <label>
          Mark as
          <select value={code} onChange={(e) => setCode(e.target.value)}>
            {Object.entries(codes).map(([value, meta]) => (
              <option key={value} value={value}>{meta.label}</option>
            ))}
          </select>
        </label>
        <div className="religion-picks">
          <span className="muted small">For whom</span>
          {religions.map(([religion, count]) => (
            <button
              type="button"
              key={religion}
              className={chosen.has(religion) ? 'active' : undefined}
              onClick={() => toggle(religion)}
            >
              {religion} <span className="muted">{count}</span>
            </button>
          ))}
          {!chosen.size && <span className="muted small">nothing ticked = everybody</span>}
        </div>
        {known && (
          <p className="festival-hint small">
            {known.religions.length ? (
              <>
                <strong>{known.name}</strong> is a {listOut(known.religions)} festival — ticked
                for you. Change it if your office does it differently.
              </>
            ) : (
              <>
                <strong>{known.name}</strong> is a holiday for everybody, so nothing is ticked.
              </>
            )}
            {suggested.missing.length > 0 && (
              <span className="muted">
                {' '}Nobody on the list is marked {listOut(suggested.missing, 'or')}, so that
                part covers nobody.
              </span>
            )}
            {known.fixed ? (
              known.fixed.month === period.month ? (
                <span className="muted"> The date is fixed at {known.fixed.day} {monthName}.</span>
              ) : (
                <span className="muted"> It falls outside {monthName}.</span>
              )
            ) : (
              <span className="muted">
                {' '}The date moves every year, so it is not guessed — pick it yourself.
              </span>
            )}
          </p>
        )}
        <button className="primary" type="submit" disabled={locked || busy === 'add'}>
          Add festival
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {holidays.length > 0 && (
        <div className="table-wrap">
          <table className="sheet">
            <thead>
              <tr>
                <th className="sticky-name">Festival</th>
                <th>Date</th>
                <th>Marks as</th>
                <th>For whom</th>
                <th>People</th>
                <th>Applied</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {holidays.map((holiday) => (
                <tr key={holiday.id}>
                  <td className="sticky-name">{holiday.name}</td>
                  <td>
                    {holiday.day} {monthName}{' '}
                    <span className="muted">({weekday(period.year, period.month, holiday.day)})</span>
                  </td>
                  <td>{codes[holiday.code]?.label || holiday.code}</td>
                  <td>{holiday.religions.length ? holiday.religions.join(', ') : 'Everybody'}</td>
                  <td className="num">{covers(holiday)}</td>
                  <td className={holiday.applied_at ? undefined : 'muted'}>
                    {holiday.applied_at ? 'yes' : 'not yet'}
                  </td>
                  <td>
                    <button
                      className="primary tiny"
                      disabled={locked || busy === `apply-${holiday.id}`}
                      onClick={() => apply(holiday)}
                    >
                      {busy === `apply-${holiday.id}` ? '…' : holiday.applied_at ? 'Apply again' : 'Apply'}
                    </button>{' '}
                    <button className="danger tiny" disabled={locked} onClick={() => remove(holiday)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted small">
        Applying writes over whatever was on that day, so run it after{' '}
        <strong>Mark everyone Present</strong>, not before. Applying twice does no harm — press
        <strong> Apply again</strong> after somebody joins to catch them up.
        {withoutReligion > 0 && (
          <>
            {' '}
            <strong>{withoutReligion}</strong>{' '}
            {withoutReligion === 1 ? 'person has' : 'people have'} no religion set, so a festival
            for a particular one will skip {withoutReligion === 1 ? 'them' : 'them'}.
          </>
        )}
      </p>
    </div>
  );
}
