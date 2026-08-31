import { useState } from 'react';
import { MONTHS } from '../format.js';

/** Month picker plus the settings that month calculates with. */
export default function PeriodBar({ periods, period, onSelect, onCreate, onPatch, onSync, onDelete }) {
  const [open, setOpen] = useState(false);
  const now = new Date();
  const [form, setForm] = useState({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    working_days: 26,
    hours_per_day: 9,
  });
  const [error, setError] = useState('');

  const create = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await onCreate({
        year: Number(form.year),
        month: Number(form.month),
        working_days: Number(form.working_days) || 26,
        hours_per_day: Number(form.hours_per_day) || 9,
      });
      setOpen(false);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="period-bar">
      <select
        value={period?.id || ''}
        onChange={(e) => onSelect(Number(e.target.value))}
        disabled={!periods.length}
      >
        {!periods.length && <option value="">No months yet</option>}
        {periods.map((p) => (
          <option key={p.id} value={p.id}>{p.label}{p.locked ? ' (locked)' : ''}</option>
        ))}
      </select>

      <button onClick={() => setOpen((v) => !v)}>{open ? 'Cancel' : 'New month'}</button>

      {period && (
        <>
          <label className="inline-num" title="The divisor behind the day rate - 26 in the sheet">
            Working days
            <input
              inputMode="decimal"
              defaultValue={period.working_days}
              disabled={!!period.locked}
              onBlur={(e) =>
                Number(e.target.value) !== period.working_days &&
                onPatch({ working_days: Number(e.target.value) || 26 })
              }
            />
          </label>
          <label className="inline-num" title="Hours in a working day - used for the overtime rate">
            Hours/day
            <input
              inputMode="decimal"
              defaultValue={period.hours_per_day}
              disabled={!!period.locked}
              onBlur={(e) =>
                Number(e.target.value) !== period.hours_per_day &&
                onPatch({ hours_per_day: Number(e.target.value) || 9 })
              }
            />
          </label>
          <label className="inline-num" title="Professional tax charged above this gross">
            PT above
            <input
              inputMode="decimal"
              defaultValue={period.pt_threshold}
              disabled={!!period.locked}
              onBlur={(e) =>
                Number(e.target.value) !== period.pt_threshold &&
                onPatch({ pt_threshold: Number(e.target.value) })
              }
            />
          </label>
          <label className="inline-num" title="How much professional tax">
            PT ₹
            <input
              inputMode="decimal"
              defaultValue={period.pt_amount}
              disabled={!!period.locked}
              onBlur={(e) =>
                Number(e.target.value) !== period.pt_amount && onPatch({ pt_amount: Number(e.target.value) })
              }
            />
          </label>

          <button onClick={onSync} disabled={!!period.locked} title="Pull in employees added since this month was opened">
            Refresh staff
          </button>
          <label className="check" title="A locked month cannot be edited">
            <input
              type="checkbox"
              checked={!!period.locked}
              onChange={(e) => onPatch({ locked: e.target.checked ? 1 : 0 })}
            />
            Lock
          </label>
          <button
            className="danger tiny"
            onClick={() => {
              if (window.confirm(`Delete ${period.label} and everything entered in it?`)) onDelete();
            }}
          >
            Delete month
          </button>
        </>
      )}

      {open && (
        <form className="new-period card" onSubmit={create}>
          <label>
            Month
            <select value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })}>
              {MONTHS.map((name, i) => (
                <option key={name} value={i + 1}>{name}</option>
              ))}
            </select>
          </label>
          <label>
            Year
            <input value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
          </label>
          <label>
            Working days
            <input value={form.working_days} onChange={(e) => setForm({ ...form, working_days: e.target.value })} />
          </label>
          <label>
            Hours/day
            <input value={form.hours_per_day} onChange={(e) => setForm({ ...form, hours_per_day: e.target.value })} />
          </label>
          <button className="primary" type="submit">Open month</button>
          {error && <p className="error">{error}</p>}
        </form>
      )}
    </div>
  );
}
