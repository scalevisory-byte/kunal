import { useState } from 'react';
import { api } from '../api.js';

/**
 * Bringing a biometric machine's export into the attendance grid.
 *
 * eSSL, ZKTeco and the rest each lay their reports out differently, so rather
 * than guessing, the file is read first and the columns are pointed at by hand.
 * Then a dry run says exactly what it would do, and only then is anything
 * written.
 */
const BLANK_MAPPING = { employee: '', date: '', inTime: '', outTime: '', matchBy: 'name' };

const DEFAULT_RULES = {
  halfDayHours: 4.5,
  graceMinutes: 15,
  countShortHours: true,
};

export default function PunchImport({ period, onReload }) {
  const [file, setFile] = useState(null);
  const [read, setRead] = useState(null);
  const [sheet, setSheet] = useState('');
  const [mapping, setMapping] = useState(BLANK_MAPPING);
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const reset = () => {
    setRead(null);
    setPreview(null);
    setMapping(BLANK_MAPPING);
    setError('');
  };

  /** Guesses the mapping from the column names, to save the obvious clicks. */
  const guess = (headers) => {
    const find = (...words) =>
      headers.find((h) => words.some((w) => h.label.toLowerCase().includes(w)))?.index || '';
    return {
      employee: find('employee name', 'name', 'person', 'employee'),
      date: find('date', 'day'),
      inTime: find('in time', 'intime', 'check-in', 'checkin', 'in'),
      outTime: find('out time', 'outtime', 'check-out', 'checkout', 'out'),
      matchBy: 'name',
    };
  };

  const pickFile = async (chosen, sheetName) => {
    setFile(chosen);
    reset();
    if (!chosen) return;
    setBusy('Reading the file…');
    try {
      const form = new FormData();
      form.append('file', chosen);
      if (sheetName) form.append('sheet', sheetName);
      const result = await api.upload('/punches/read', form);
      setRead(result);
      setSheet(result.sheet);
      setMapping(guess(result.headers));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const run = async (dryRun) => {
    if (!file) return;
    setBusy(dryRun ? 'Working it out…' : 'Writing the marks…');
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('sheet', sheet);
      form.append('mapping', JSON.stringify(mapping));
      form.append('rules', JSON.stringify(rules));
      form.append('dry_run', String(dryRun));
      const result = await api.upload(`/periods/${period.id}/punches`, form);
      setPreview(result);
      if (!dryRun) await onReload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const columnPicker = (field, label, hint) => (
    <label>
      {label}
      <select
        value={mapping[field]}
        onChange={(e) => setMapping({ ...mapping, [field]: Number(e.target.value) || '' })}
      >
        <option value="">{hint || 'not in this file'}</option>
        {read.headers.map((h) => (
          <option key={h.index} value={h.index}>{h.label}</option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="card">
      <h2>Attendance machine — import punches</h2>
      <p className="muted small">
        Take the attendance report out of the machine's software (eSSL eTimeTrackLite, SmartOffice
        and the like all export to Excel) and bring it in here. Whoever punched in gets{' '}
        <strong>P</strong>, whoever did not gets <strong>A</strong>, a short day becomes{' '}
        <strong>HF</strong>, and time worked under the day's hours goes in as short-hours minutes.
      </p>

      <input type="file" accept=".xlsx,.xlsm,.csv" onChange={(e) => pickFile(e.target.files?.[0] || null)} />

      {read && (
        <>
          {read.sheets.length > 1 && (
            <div className="inline-form">
              <label>
                Sheet
                <select
                  value={sheet}
                  onChange={(e) => {
                    setSheet(e.target.value);
                    pickFile(file, e.target.value);
                  }}
                >
                  {read.sheets.map((s) => (
                    <option key={s.name} value={s.name}>{s.name} ({s.rows} rows)</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <p className="muted small">
            {read.rowCount} rows, header on row {read.headerRow}. Point the columns out below —
            the guesses are only guesses.
          </p>

          <div className="form-grid">
            {columnPicker('employee', 'Employee column', 'pick one')}
            <label>
              Matched on
              <select
                value={mapping.matchBy}
                onChange={(e) => setMapping({ ...mapping, matchBy: e.target.value })}
              >
                <option value="name">Employee name</option>
                <option value="code">Employee code</option>
              </select>
            </label>
            {columnPicker('date', 'Date column', 'pick one')}
            {columnPicker('inTime', 'In time')}
            {columnPicker('outTime', 'Out time')}
          </div>

          <div className="form-grid">
            <label title="Anything under this counts as a half day">
              Half day under (hours)
              <input
                inputMode="decimal"
                value={rules.halfDayHours}
                onChange={(e) => setRules({ ...rules, halfDayHours: Number(e.target.value) || 0 })}
              />
            </label>
            <label title="Short hours are only recorded once they pass this">
              Grace (minutes)
              <input
                inputMode="numeric"
                value={rules.graceMinutes}
                onChange={(e) => setRules({ ...rules, graceMinutes: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={rules.countShortHours}
                onChange={(e) => setRules({ ...rules, countShortHours: e.target.checked })}
              />
              Deduct short hours
            </label>
          </div>

          <div className="button-row">
            <button disabled={!!busy || !mapping.employee || !mapping.date} onClick={() => run(true)}>
              Check first
            </button>
            <button
              className="primary"
              disabled={!!busy || !preview || !preview.dryRun}
              onClick={() => run(false)}
              title={preview?.dryRun ? undefined : 'Run the check first'}
            >
              Write {preview?.dryRun ? `${preview.entries.length} marks` : 'the marks'}
            </button>
          </div>

          <table className="sheet sample">
            <thead>
              <tr>
                {read.headers.filter((h) => !h.label.startsWith('Column ')).slice(0, 8).map((h) => (
                  <th key={h.index}>{h.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {read.sampleRows.slice(0, 4).map((row, i) => (
                <tr key={i}>
                  {read.headers.filter((h) => !h.label.startsWith('Column ')).slice(0, 8).map((h) => (
                    <td key={h.index}>{String(row[h.index] ?? '').slice(0, 20)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {busy && <p className="muted">{busy}</p>}
      {error && <p className="error">{error}</p>}

      {preview && (
        <div className="result">
          <p>
            {preview.dryRun ? 'Would mark' : 'Marked'} <strong>{preview.entries.length}</strong>{' '}
            employee-days across {preview.days.length} dates —{' '}
            {preview.summary.present} present, {preview.summary.halfDay} half days,{' '}
            {preview.summary.absent} absent, {preview.summary.shortHours} with short hours,{' '}
            {preview.summary.overtime} with overtime.
            {preview.dryRun && ' Nothing has been written yet.'}
          </p>
          {preview.unreadableDates > 0 && (
            <p className="error">
              {preview.unreadableDates} rows had a date this month could not use — check the date
              column, and that the file really is for {period.label}.
            </p>
          )}
          {preview.unmatched.length > 0 && (
            <>
              <p className="skipped">
                {preview.unmatched.length} names in the file are not on the staff list, and were
                skipped:
              </p>
              <ul className="skipped">
                {preview.unmatched.slice(0, 12).map((u) => (
                  <li key={u.name}>{u.name} ({u.count} rows)</li>
                ))}
                {preview.unmatched.length > 12 && <li>…and {preview.unmatched.length - 12} more</li>}
              </ul>
              <p className="muted small">
                Names have to match the staff list exactly, give or take spacing and capitals. Fix
                them under <strong>Employees</strong>, or put the machine's code into each
                employee's Code and match on that instead.
              </p>
            </>
          )}
        </div>
      )}

      <p className="muted small">
        This writes over whatever is on those days, so run it before hand-marking exceptions, not
        after. Days the file says nothing about are left alone.
      </p>
    </div>
  );
}
