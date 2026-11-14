import { useEffect, useState } from 'react';
import { STANDALONE, api } from '../../api.js';
import {
  HOLD_REASONS,
  REJECTION_REASONS,
  VERDICTS,
  checkScreening,
} from '../../../../shared/screening.js';

/**
 * Initial screening.
 *
 * The queue is everybody nobody has looked at yet, oldest first, each row
 * carrying its own report so the whole list can be worked without opening
 * anybody.
 *
 * The report is ADVICE. It is drawn so a screener can see at a glance what
 * misses, and it cannot stop them taking somebody anyway - there is no state
 * in this file where a button is disabled because of it.
 */

/** One line of the report: a tick, a cross, or a dash that means "not asked". */
export function ReportLines({ report, compact }) {
  if (!report?.lines?.length) {
    return <p className="muted small">This opening set no criteria to measure against.</p>;
  }
  return (
    <div className={compact ? 'scr-lines compact' : 'scr-lines'}>
      {report.lines.map((l) => (
        <div key={l.label} className={`scr-line ${l.ok === true ? 'ok' : l.ok === false ? 'no' : 'unknown'}`}>
          <span className="scr-mark">{l.ok === true ? '✓' : l.ok === false ? '✗' : '–'}</span>
          <span className="scr-label">{l.label}</span>
          <span className="scr-said">{l.said}</span>
          <span className="muted small">asked for {l.wanted}</span>
        </div>
      ))}
    </div>
  );
}

/** The verdict form — used in the queue and on the application panel alike. */
export function ScreeningForm({ applicationId, screening, report, onSaved, onError, onToast }) {
  const [form, setForm] = useState(
    screening || { verdict: '', remarks: '', rejection_reason: '', hold_reason: '' }
  );
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setForm(screening || { verdict: '', remarks: '', rejection_reason: '', hold_reason: '' });
  }, [screening?.id, applicationId]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const problems = checkScreening(form);
  const meta = VERDICTS.find((v) => v.key === form.verdict);

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/hiring/applications/${applicationId}/screening`, form);
      onToast?.(screening ? 'Screening updated' : 'Screened');
      onSaved?.();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scr-form">
      <div className="iv-decisions">
        {VERDICTS.map((v) => (
          <button
            key={v.key}
            className={form.verdict === v.key ? 'chip active' : 'chip'}
            onClick={() => set('verdict', v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>
      {meta ? <p className="muted small">{meta.hint}</p> : null}

      {form.verdict === 'Rejected' ? (
        <label className="field">
          Why
          <input
            list="scr-reject"
            value={form.rejection_reason ?? ''}
            placeholder="Pick one, or type your own"
            onChange={(e) => set('rejection_reason', e.target.value)}
          />
          {/*
            * A list to pick from, not a fixed set. The box takes anything -
            * the point is that six people writing "exp less", "not enough
            * experience" and "under qualified" cannot be counted, and counting
            * them is what makes a rejection report worth reading.
            */}
          <datalist id="scr-reject">
            {REJECTION_REASONS.map((r) => <option key={r} value={r} />)}
          </datalist>
        </label>
      ) : null}

      {form.verdict === 'On Hold' ? (
        <label className="field">
          Waiting for
          <input
            list="scr-hold"
            value={form.hold_reason ?? ''}
            placeholder="Pick one, or type your own"
            onChange={(e) => set('hold_reason', e.target.value)}
          />
          <datalist id="scr-hold">
            {HOLD_REASONS.map((r) => <option key={r} value={r} />)}
          </datalist>
        </label>
      ) : null}

      <label className="field">
        Remarks
        <input value={form.remarks ?? ''} onChange={(e) => set('remarks', e.target.value)} />
      </label>

      <div className="row">
        {screening ? (
          <span className="muted small">
            {screening.verdict} by {screening.reviewed_by} on {screening.screened_on}
          </span>
        ) : null}
        <span className="spacer" />
        <button className="primary" disabled={busy || problems.length} onClick={save}>
          {screening ? 'Update' : 'Save screening'}
        </button>
      </div>
      {problems.length && form.verdict ? <p className="muted small">{problems[0]}</p> : null}
    </div>
  );
}

export default function Screening({ companyId, onOpen, onError, onToast }) {
  const [queue, setQueue] = useState([]);
  const [summary, setSummary] = useState(null);
  const [open, setOpen] = useState(null);

  const load = async () => {
    try {
      const where = companyId ? `?company_id=${companyId}` : '';
      const [{ queue: rows }, sum] = await Promise.all([
        api.get(`/hiring/screening/queue${where}`),
        api.get(`/hiring/screening/summary${where}`),
      ]);
      setQueue(rows || []);
      setSummary(sum);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    if (!STANDALONE) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  if (STANDALONE) {
    return (
      <div className="card">
        <h2>Screening</h2>
        <p className="empty">Screening needs the server — it works on applications, which arrive over the internet.</p>
      </div>
    );
  }

  return (
    <>
      {summary ? (
        <div className="card">
          <h2>Screening</h2>
          <div className="figures">
            <div><strong>{summary.waiting}</strong><span>waiting to be screened</span></div>
            {summary.verdicts.map((v) => (
              <div key={v.verdict}><strong>{v.n}</strong><span>{v.verdict.toLowerCase()}</span></div>
            ))}
          </div>
          {summary.rejection_reasons.length ? (
            <p className="muted small">
              Turned down for:{' '}
              {summary.rejection_reasons.map((r) => `${r.reason} (${r.n})`).join(' · ')}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="card">
        <h3>Waiting to be screened</h3>
        <p className="muted small">
          Oldest first — a list sorted by score leaves a merely good candidate from three weeks ago
          at the bottom until they take another job. The report beside each one is advice: you can
          take somebody who misses every line of it.
        </p>
        {!queue.length ? (
          <p className="empty">Nobody waiting. Every application has been looked at.</p>
        ) : (
          queue.map((row) => (
            <div className="scr-row" key={row.application_id}>
              <div className="scr-who">
                <button className="link-like" onClick={() => onOpen(row.application_id)}>
                  <strong>{row.name}</strong>
                </button>
                <span className="muted small">
                  {' '}· {row.ref_no} · {row.phone} · {row.job_title}, {row.company_name}
                  {row.has_cv ? '' : ' · no CV'}
                </span>
                <div className="muted small">
                  waiting since {String(row.created_at).slice(0, 10)} · match {row.match_score}%
                  {row.report.misses.length ? ` · check: ${row.report.misses.join(', ')}` : ''}
                </div>
              </div>
              <ReportLines report={row.report} compact />
              <button className="tiny" onClick={() => setOpen(open === row.application_id ? null : row.application_id)}>
                {open === row.application_id ? 'Close' : 'Screen'}
              </button>
              {open === row.application_id ? (
                <ScreeningForm
                  applicationId={row.application_id}
                  screening={null}
                  report={row.report}
                  onSaved={() => { setOpen(null); load(); }}
                  onError={onError}
                  onToast={onToast}
                />
              ) : null}
            </div>
          ))
        )}
      </div>
    </>
  );
}
