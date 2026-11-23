import { useEffect, useState } from 'react';
import { STANDALONE, api } from '../api.js';
import { LUNCH_RULES } from '../../../shared/lunchGap.js';
import { formatDuration } from '../../../shared/timesheet.js';

/**
 * Attendance straight off the Bizcompass Sync Tool's punch spool.
 *
 * That tool already pulls the punches off the readers every ten minutes and
 * spools them as small text files on this same server before uploading them to
 * its own cloud. Reading those files needs no Access, no export and no second
 * copy of anything, and it is current to the last ten minutes.
 *
 * Two things this screen exists to say before anything is written:
 * which days the spool actually holds, and which reader numbers nobody on the
 * staff list carries. The file has no names in it at all, so an unmatched
 * number cannot be guessed at - somebody has to put it on a record.
 */
export default function BizcompassImport({ period, onReload, onGo }) {
  const [status, setStatus] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    if (STANDALONE) return;
    api.get('/bizcompass/status').then(setStatus).catch(() => setStatus(null));
  }, []);

  const run = async (dryRun) => {
    setBusy(dryRun ? 'Reading the spool…' : 'Writing the marks…');
    setError('');
    setDone('');
    try {
      const form = new FormData();
      form.append('dry_run', String(dryRun));
      const result = await api.upload(`/periods/${period.id}/bizcompass`, form);
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

  if (STANDALONE) {
    return (
      <section className="card">
        <h2>Punches from the Bizcompass spool</h2>
        <p className="muted small">
          This reads a folder on the server, so it needs the server version. In this single file
          there is no folder to read.
        </p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Punches from the Bizcompass spool</h2>
      <p className="muted small">
        The Bizcompass Sync Tool pulls the punches off the readers every ten minutes and leaves
        them as small files on this machine. This reads those files &mdash; no export, nothing
        opened in eTimeTrackLite, and <strong>nothing in that folder is changed</strong>.
      </p>

      {status && !status.configured ? (
        <p className="banner">
          <strong>No folder is set yet.</strong> Set <code>BIZCOMPASS_DIR</code> to the Sync
          Tool&rsquo;s <code>logdata</code> folder on this server, then restart the service.
        </p>
      ) : null}
      {status && status.configured && !status.readable ? (
        <p className="banner bad">
          <code>{status.dir}</code> &mdash; {status.reason}.
        </p>
      ) : null}
      {status && status.readable ? (
        <p className="muted small">
          Reading <code>{status.dir}</code>
          {status.hasFiles ? '' : ' — no punch files found in it yet'}
        </p>
      ) : null}

      {/*
        * WHETHER IT RUNS BY ITSELF, and what it last did.
        *
        * "Automatic" that silently stopped is worse than no automatic at all,
        * so the last run is on the screen with its figures — including the
        * punch IDs nobody carries, because those people's attendance is not
        * arriving however often this runs.
        */}
      {status && status.readable ? (
        status.autoMinutes ? (
          <p className="muted small">
            Reading it by itself <strong>every {status.autoMinutes} minutes</strong>.{' '}
            {status.lastRun ? (
              status.lastRun.ok ? (
                <>
                  Last run {new Date(status.lastRun.at).toLocaleString('en-IN')}:{' '}
                  {status.lastRun.written} marks over {status.lastRun.days} days for{' '}
                  {status.lastRun.people} people
                  {status.lastRun.keptMarks
                    ? `, ${status.lastRun.keptMarks} days left as they were marked`
                    : ''}
                  {status.lastRun.unknownIds
                    ? `, ${status.lastRun.unknownIds} punch IDs nobody carries`
                    : ''}
                  .
                </>
              ) : (
                <span className="bad">
                  Last run {new Date(status.lastRun.at).toLocaleString('en-IN')} did nothing:{' '}
                  {status.lastRun.why}.
                </span>
              )
            ) : (
              'It has not run yet since the service started.'
            )}
          </p>
        ) : (
          <p className="muted small">
            It runs only when you press the button. To have it read by itself, set{' '}
            <code>BIZCOMPASS_AUTO_MINUTES=30</code> beside <code>BIZCOMPASS_DIR</code> and restart.
            It will still never open a month, never write into a locked one, and never overrule a
            mark you set.
          </p>
        )
      ) : null}

      <div className="row">
        <button className="primary" disabled={!!busy} onClick={() => run(true)}>
          {busy || 'See what it would do'}
        </button>
      </div>

      {error ? <p className="banner bad">{error}</p> : null}
      {done ? <p className="banner good">{done}</p> : null}

      {preview ? (
        <>
          <p className="muted small">
            {preview.spool.punches.toLocaleString('en-IN')} punches in{' '}
            {preview.spool.files.toLocaleString('en-IN')} files, {preview.spool.readers} reader
            {preview.spool.readers === 1 ? '' : 's'}
            {preview.spool.skippedLines
              ? `, ${preview.spool.skippedLines} part-written lines skipped`
              : ''}
            .
          </p>

          <div className="late-figs">
            <div><b>{preview.matchedPeople}</b><span>people matched</span></div>
            <div><b>{preview.coverage.days.length}</b><span>days in this month</span></div>
            <div><b>{preview.summary.present}</b><span>present</span></div>
            <div><b>{preview.summary.halfDay}</b><span>half days</span></div>
          </div>

          {/*
            * THE ONE THING THAT CANNOT BE GUESSED. The spool has no names in
            * it, only the reader's own user number, so a number nobody
            * carries is a person whose attendance is simply not arriving.
            */}
          {preview.unknownIds?.length ? (
            <div className="banner bad">
              <strong>
                {preview.unknownIds.length} punch ID
                {preview.unknownIds.length === 1 ? '' : 's'} nobody on the staff list carries
              </strong>{' '}
              &mdash; their attendance is not coming through at all. Put the number in the{' '}
              <strong>Punch ID</strong> column on Employees.
              <div className="muted small" style={{ marginTop: '0.4rem' }}>
                {preview.unknownIds
                  .slice(0, 12)
                  .map((u) => `${u.id} (${u.punches})`)
                  .join(', ')}
                {preview.unknownIds.length > 12 ? ' …' : ''}
              </div>
              {onGo ? (
                <div className="row" style={{ marginTop: '0.5rem' }}>
                  <button className="ghost" onClick={() => onGo('employees')}>
                    Open Employees
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {/*
            * A day the tool was stopped on is simply NOT HERE - it produces
            * no entry and the grid keeps whatever it had. That is why this
            * source cannot book the absences a printed report would.
            */}
          <p className="muted small">
            Days in the spool for this month:{' '}
            {preview.coverage.days.map((d) => `${d.day} (${d.people})`).join(', ') || 'none'}.
            A day the tool was not running on is simply absent from the list &mdash; it writes
            nothing for that day rather than marking anybody absent.
            {preview.keptMarks ? (
              <>
                {' '}
                <strong>{preview.keptMarks} days keep the mark you set</strong> (leave, a holiday,
                a day at home) &mdash; only their hours are updated.
              </>
            ) : null}
          </p>

          {/*
            * THE LUNCH BREAK, FOUND IN THE DAY'S OWN PUNCHES.
            *
            * It has to say whether it costs anything BEFORE the Write button,
            * because on a month where lunch comes off the hours it really
            * does - and on Dinesh's, where the break sits inside the paid
            * day, it cannot move a rupee. Saying "35 lunches found" without
            * saying which of those two it is would be half an answer.
            */}
          {preview.summary.lunchFound ? (
            <p className="muted small">
              <strong>{preview.summary.lunchFound} lunch break
              {preview.summary.lunchFound === 1 ? '' : 's'} found</strong> in the punches &mdash;
              a gap of {LUNCH_RULES.minMinutes}&ndash;{LUNCH_RULES.maxMinutes} minutes in the
              middle of the day, the longest one if there are several.{' '}
              {period?.lunch_paid === 1 ? (
                <>
                  This month has the break <strong>inside the paid day</strong>, so these are
                  recorded and <strong>nothing is deducted</strong>.
                </>
              ) : (
                <>
                  This month <strong>takes the break off the hours</strong>, so these{' '}
                  {formatDuration(preview.summary.lunchMinutes || 0)} come out of the figures
                  above. Change it in Settings if that is not what you want.
                </>
              )}{' '}
              A lunch somebody typed is never replaced
              {preview.lunchKept ? ` — ${preview.lunchKept} kept` : ''}.
            </p>
          ) : null}

          <div className="row">
            <button className="primary" disabled={!!busy} onClick={() => run(false)}>
              Write {preview.days.length} day{preview.days.length === 1 ? '' : 's'}
            </button>
            <button className="ghost" disabled={!!busy} onClick={() => setPreview(null)}>
              Cancel
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
