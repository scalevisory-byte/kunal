import { useRef, useState } from 'react';
import { AuthError, STANDALONE, download, getToken } from '../api.js';
import { ATTENDANCE_CODES } from '../../../shared/calc.js';

/**
 * The month's register, out to Excel and back.
 *
 * Dinesh asked for "attendance ka simple excel" - the two importers beside
 * it read what a biometric machine produces, in the machine's shape. This is
 * for an office that keeps the register on paper, or in its own sheet, and
 * types it up.
 *
 * One file both ways, like the staff list: the names already down the page,
 * the days already numbered across the top with the weekday under each, and
 * whatever is already marked in place.
 */
export default function AttendanceSheet({ period, locked, onReload, onError }) {
  const file = useRef(null);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState('');

  const grab = async (blank) => {
    setBusy('Making the file…');
    try {
      await download(
        `/periods/${period.id}/attendance-sheet${blank ? '?blank=true' : ''}`,
        `Attendance-${period.label || period.id}.xlsx`.replace(/\s+/g, '-'),
      );
    } catch (err) {
      onError?.(err instanceof AuthError ? 'Sign in again' : err.message);
    } finally {
      setBusy('');
    }
  };

  const post = async (dryRun) => {
    const chosen = file.current?.files?.[0];
    if (!chosen) return;
    setBusy(dryRun ? 'Reading the file…' : 'Writing…');
    setDone('');
    try {
      const form = new FormData();
      form.append('file', chosen);
      form.append('dry_run', String(dryRun));
      const res = await fetch(`/api/periods/${period.id}/attendance-sheet`, {
        method: 'POST',
        headers: getToken() ? { authorization: `Bearer ${getToken()}` } : {},
        body: form,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'that file could not be read');
      if (dryRun) {
        setPlan(body);
      } else {
        setPlan(null);
        if (file.current) file.current.value = '';
        setDone(`${body.written} marks written.`);
        onReload?.();
      }
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy('');
    }
  };

  if (STANDALONE) {
    return (
      <div className="card">
        <h2>The month in Excel</h2>
        <p className="muted small">Reading and writing a workbook needs the server.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>The month in Excel — fill in a register and bring it back</h2>
      <p className="muted small">
        Everybody down the page, the days across the top with the weekday under each. Fill it in,
        send it back. <strong>A blank cell leaves that day alone</strong> — it does not clear a mark
        that is already there. Every mark and what it costs is on the second sheet.
      </p>

      <div className="button-row">
        <button className="primary" disabled={!!busy} onClick={() => grab(false)}>
          Download {period.label}
        </button>
        <button disabled={!!busy} onClick={() => grab(true)}>
          Empty grid
        </button>
      </div>

      <div className="inline-form" style={{ marginTop: '0.6rem' }}>
        <input
          ref={file}
          type="file"
          accept=".xlsx,.xlsm,.xls"
          disabled={locked}
          onChange={() => {
            setPlan(null);
            setDone('');
          }}
        />
        <button disabled={!!busy || locked} onClick={() => post(true)}>
          Check it first
        </button>
      </div>

      {busy ? <p className="muted small">{busy}</p> : null}
      {done ? <p className="banner good">{done}</p> : null}
      {locked ? <p className="muted small">This month is locked.</p> : null}

      {plan ? (
        <>
          <div className="figures" style={{ marginTop: '0.6rem' }}>
            <Fig n={plan.counts.matched} k="People matched" />
            <Fig n={plan.counts.fills} k="Blank days filled" />
            <Fig n={plan.counts.changes} k="Marks changed" />
            <Fig n={plan.counts.unmatched} k="Not on your list" />
          </div>

          {/*
            * Filling a blank is typing up the register. CHANGING a mark that
            * is already there is somebody's pay moving, and it must not
            * arrive as one row among two thousand.
            */}
          {plan.changes?.length ? (
            <div className="banner bad">
              <strong>
                {plan.changes.length} {plan.changes.length === 1 ? 'day already has' : 'days already have'} a
                different mark.
              </strong>{' '}
              {plan.changes
                .slice(0, 8)
                .map((c) => `${c.name} day ${c.day}: ${c.from} → ${c.to}`)
                .join(' · ')}
              {plan.changes.length > 8 ? ` and ${plan.changes.length - 8} more` : ''}.
            </div>
          ) : null}

          {Object.keys(plan.tally || {}).length ? (
            <p className="small" style={{ marginTop: '0.5rem' }}>
              {Object.entries(plan.tally)
                .sort((a, b) => b[1] - a[1])
                .map(([code, n]) => `${n} × ${ATTENDANCE_CODES[code]?.label || code}`)
                .join(' · ')}
            </p>
          ) : null}

          {plan.unknownMarks?.length ? (
            <p className="muted small">
              Marks this app does not know, skipped:{' '}
              {plan.unknownMarks.map((m) => `${m.mark} (${m.rows})`).join(', ')}. The second sheet of
              the file lists the ones it does.
            </p>
          ) : null}

          {plan.unmatched?.length ? (
            <p className="muted small">
              Not on your employee list:{' '}
              {plan.unmatched.slice(0, 10).map((u) => u.name).join(', ')}
              {plan.unmatched.length > 10 ? ` and ${plan.unmatched.length - 10} more` : ''}.
            </p>
          ) : null}

          <div className="button-row" style={{ marginTop: '0.6rem' }}>
            <button className="primary" disabled={!!busy || !plan.counts.marks} onClick={() => post(false)}>
              {plan.counts.marks ? `Write ${plan.counts.marks} marks` : 'Nothing to write'}
            </button>
            <button className="ghost" onClick={() => setPlan(null)}>
              Cancel
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Fig({ n, k }) {
  return (
    <div className="fig">
      <strong>{n}</strong>
      <span>{k}</span>
    </div>
  );
}
