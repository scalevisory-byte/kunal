import { useState } from 'react';
import { STANDALONE, api } from '../api.js';
import { ATTENDANCE_CODES } from '../../../shared/calc.js';

/**
 * The machine's **Monthly Status** report, which is a different animal from
 * the punch export the tab above handles: a month-wide grid, one sheet per
 * company, carrying the machine's own verdict for each day. Nothing to map -
 * the shape is read off the file's own header.
 *
 * Always a dry run first. The thing worth looking at in the dry run is the
 * list of days the machine had nothing for: on the October export every one of
 * 114 people reads "A" from the 23rd, because the device stopped syncing on
 * the 22nd. Writing that through costs each of them eight days' pay, so those
 * days are left alone unless they are asked for.
 */
export default function MonthlyStatusImport({ period, onReload }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [includeEmptyDays, setIncludeEmptyDays] = useState(false);
  const [onlyBlank, setOnlyBlank] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const send = async (chosen, { dryRun }) => {
    if (!chosen) return;
    setBusy(dryRun ? 'Reading the file…' : 'Writing the marks…');
    setError('');
    setDone('');
    try {
      const form = new FormData();
      form.append('file', chosen);
      form.append('dry_run', String(dryRun));
      form.append('include_empty_days', String(includeEmptyDays));
      form.append('only_blank', String(onlyBlank));
      const result = await api.upload(`/periods/${period.id}/monthly-status`, form);
      setPreview(result);
      if (!dryRun) {
        setDone(`${result.written} marks written.`);
        onReload();
      }
    } catch (err) {
      setError(err.message);
      setPreview(null);
    } finally {
      setBusy('');
    }
  };

  const pick = (chosen) => {
    setFile(chosen);
    setPreview(null);
    setDone('');
    setError('');
    if (chosen) send(chosen, { dryRun: true });
  };

  const monthMismatch = preview?.months?.filter(
    (m) => m.month && m.year && (m.month !== preview.period.month || m.year !== preview.period.year)
  );

  return (
    <section className="card">
      <h2>Monthly status from the attendance machine</h2>
      <p className="muted small">
        The month-wide report, one sheet per company — not the punch log.{' '}
        {STANDALONE ? (
          <>
            This single file reads <code>.xlsx</code> only; the old <code>.xls</code> these
            machines export has to be re-saved in Excel first, or imported on the server version.
          </>
        ) : (
          <>
            It opens the old <code>.xls</code> these machines export as well as <code>.xlsx</code>.
          </>
        )}{' '}
        Nothing is written until you say so.
      </p>

      <div className="row">
        <input
          type="file"
          accept=".xls,.xlsx,.xlsm"
          onChange={(e) => pick(e.target.files?.[0] || null)}
        />
        {busy ? <span className="muted small">{busy}</span> : null}
      </div>

      {error ? <p className="banner bad">{error}</p> : null}
      {done ? <p className="banner good">{done}</p> : null}

      {preview ? (
        <>
          {preview.skippedDays?.length ? (
            <div className="banner bad">
              <strong>
                The machine has no record for{' '}
                {preview.skippedDays.length === 1
                  ? `the ${preview.skippedDays[0]}`
                  : `${preview.skippedDays.length} days: ${preview.skippedDays.join(', ')}`}
                .
              </strong>{' '}
              Nobody at all is marked present on{' '}
              {preview.skippedDays.length === 1 ? 'it' : 'them'}, which normally means the device
              stopped syncing rather than that the whole company stayed home. Those days are being
              left alone.
            </div>
          ) : null}

          {monthMismatch?.length ? (
            <div className="banner bad">
              {monthMismatch.length} sheet{monthMismatch.length === 1 ? ' is' : 's are'} for another
              month and {monthMismatch.length === 1 ? 'was' : 'were'} skipped. This report is for{' '}
              {monthMismatch.map((m) => `${m.month}/${m.year}`).join(', ')}; the open month is{' '}
              {preview.period.month}/{preview.period.year}.
            </div>
          ) : null}

          <div className="figures" style={{ marginTop: '0.6rem' }}>
            <Fig n={preview.matched?.length || 0} k="People matched" />
            <Fig n={preview.counted || 0} k="Marks to write" />
            <Fig n={preview.unmatched?.length || 0} k="Not on your list" />
            <Fig n={preview.skippedDays?.length || 0} k="Days skipped" />
          </div>

          {Object.keys(preview.tally || {}).length ? (
            <p className="small" style={{ marginTop: '0.5rem' }}>
              {Object.entries(preview.tally)
                .sort((a, b) => b[1] - a[1])
                .map(([code, n]) => `${n} × ${ATTENDANCE_CODES[code]?.label || code}`)
                .join(' · ')}
            </p>
          ) : null}

          {preview.companies?.length ? (
            <p className="muted small">
              {preview.companies.map((c) => `${c.company || c.sheet} (${c.people})`).join(' · ')}
            </p>
          ) : null}

          {preview.neverPresent?.length ? (
            <div className="banner">
              <strong>
                {preview.neverPresent.length} {preview.neverPresent.length === 1 ? 'person is' : 'people are'}{' '}
                absent on every day the machine does have.
              </strong>{' '}
              Usually that means they were never enrolled on the device, or they have left — so
              their absences are probably not real. Check before writing:{' '}
              {preview.neverPresent.slice(0, 8).map((p) => p.name).join(', ')}
              {preview.neverPresent.length > 8 ? ` and ${preview.neverPresent.length - 8} more` : ''}.
            </div>
          ) : null}

          {preview.unmatched?.length ? (
            <p className="muted small">
              Not on your employee list:{' '}
              {preview.unmatched.slice(0, 10).map((u) => `${u.name}${u.code ? ` (${u.code})` : ''}`).join(', ')}
              {preview.unmatched.length > 10 ? ` and ${preview.unmatched.length - 10} more` : ''}.
            </p>
          ) : null}

          {preview.unknownMarks?.length ? (
            <p className="muted small">
              Marks this app does not know, left alone:{' '}
              {preview.unknownMarks.map((m) => `${m.mark} (${m.rows})`).join(', ')}.
            </p>
          ) : null}

          {preview.skippedExisting ? (
            <p className="muted small">
              {preview.skippedExisting} day{preview.skippedExisting === 1 ? '' : 's'} already marked
              by hand, left alone.
            </p>
          ) : null}

          <div className="row" style={{ marginTop: '0.8rem' }}>
            <label className="small">
              <input
                type="checkbox"
                checked={onlyBlank}
                onChange={(e) => {
                  setOnlyBlank(e.target.checked);
                  send(file, { dryRun: true });
                }}
              />{' '}
              Only fill days that are still blank
            </label>
            {preview.skippedDays?.length ? (
              <label className="small">
                <input
                  type="checkbox"
                  checked={includeEmptyDays}
                  onChange={(e) => {
                    setIncludeEmptyDays(e.target.checked);
                    send(file, { dryRun: true });
                  }}
                />{' '}
                Write the days with no record anyway
              </label>
            ) : null}
          </div>

          <div className="row" style={{ marginTop: '0.6rem' }}>
            <button
              className="primary"
              disabled={!!busy || !preview.counted}
              onClick={() => send(file, { dryRun: false })}
            >
              Write {preview.counted} marks
            </button>
            <button onClick={() => pick(null)}>Cancel</button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function Fig({ n, k }) {
  return (
    <div className="figure">
      <span className="n">{n}</span>
      <span className="k">{k}</span>
    </div>
  );
}
