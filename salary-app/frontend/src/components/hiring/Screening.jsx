import { useEffect, useState } from 'react';
import { testInvite, waLink } from '../../../../shared/hiringMessages.js';
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
  const [ready, setReady] = useState([]);

  const load = async () => {
    try {
      const where = companyId ? `?company_id=${companyId}` : '';
      const [{ queue: rows }, sum, waiting] = await Promise.all([
        api.get(`/hiring/screening/queue${where}`),
        api.get(`/hiring/screening/summary${where}`),
        /* Screened Eligible, no paper sent - his step 4's own list. */
        api.get(`/hiring/screening/awaiting-test${where}`),
      ]);
      setQueue(rows || []);
      setSummary(sum);
      setReady(waiting.rows || []);
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

      {/*
        * The step after Eligible.
        *
        * Marking somebody Eligible took them off the screening queue and out
        * of sight, so "send the eligible ones a test" meant going to find
        * them one at a time under Candidates. The list now stands where the
        * decision was made.
        */}
      {ready.length ? (
        <div className="card">
          <h3>Eligible — ready for the test</h3>
          <p className="muted small">
            Screened in, no paper sent yet. Sending one does not move anybody — it is a link and
            a score to weigh.
          </p>
          {ready.map((row) => (
            <SendTest
              key={row.application_id}
              row={row}
              onDone={load}
              onError={onError}
              onToast={onToast}
              onOpen={onOpen}
            />
          ))}
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

/**
 * The verdict, on a row.
 *
 * Dinesh asked for these buttons "front me bhi" — on the list, without opening
 * anybody. Eligible saves on the click, because it needs nothing else. On hold
 * and Not eligible open one box in the row first: both are useless without a
 * reason, and that rule is not relaxed because the control got smaller.
 */
export function QuickVerdict({ applicationId, screening, onSaved, onError, onToast }) {
  const [picked, setPicked] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (verdict, why) => {
    setBusy(true);
    try {
      await api.put(`/hiring/applications/${applicationId}/screening`, {
        verdict,
        ...(verdict === 'Rejected' ? { rejection_reason: why } : {}),
        ...(verdict === 'On Hold' ? { hold_reason: why } : {}),
      });
      onToast?.(verdict === 'Eligible' ? 'Shortlisted' : `Marked ${verdict.toLowerCase()}`);
      setPicked('');
      setReason('');
      onSaved?.();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  if (screening) {
    return (
      <span className="quick-verdict done">
        <span className={`tag ${screening.verdict === 'Eligible' ? 'published' : ''}`}>
          {screening.verdict}
        </span>
        <button className="link-like" onClick={() => setPicked('change')}>change</button>
        {picked === 'change' ? (
          <QuickButtons busy={busy} onPick={(v) => (v === 'Eligible' ? save(v) : setPicked(v))} />
        ) : null}
        {picked && picked !== 'change' ? (
          <ReasonBox verdict={picked} reason={reason} setReason={setReason} busy={busy}
            onSave={() => save(picked, reason)} onCancel={() => setPicked('')} />
        ) : null}
      </span>
    );
  }

  return (
    <span className="quick-verdict">
      {picked ? (
        <ReasonBox verdict={picked} reason={reason} setReason={setReason} busy={busy}
          onSave={() => save(picked, reason)} onCancel={() => setPicked('')} />
      ) : (
        <QuickButtons busy={busy} onPick={(v) => (v === 'Eligible' ? save(v) : setPicked(v))} />
      )}
    </span>
  );
}

const QuickButtons = ({ busy, onPick }) => (
  <>
    {VERDICTS.map((v) => (
      <button key={v.key} className="chip tiny" disabled={busy} title={v.hint}
        onClick={(e) => { e.stopPropagation(); onPick(v.key); }}>
        {v.label}
      </button>
    ))}
  </>
);

const ReasonBox = ({ verdict, reason, setReason, busy, onSave, onCancel }) => (
  <span className="quick-reason" onClick={(e) => e.stopPropagation()}>
    <input
      autoFocus
      list={verdict === 'Rejected' ? 'scr-reject' : 'scr-hold'}
      placeholder={verdict === 'Rejected' ? 'Why?' : 'Waiting for?'}
      value={reason}
      onChange={(e) => setReason(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' && reason.trim()) onSave(); if (e.key === 'Escape') onCancel(); }}
    />
    <button className="tiny primary" disabled={busy || !reason.trim()} onClick={onSave}>Save</button>
    <button className="tiny" onClick={onCancel}>Cancel</button>
    <datalist id="scr-reject">{REJECTION_REASONS.map((r) => <option key={r} value={r} />)}</datalist>
    <datalist id="scr-hold">{HOLD_REASONS.map((r) => <option key={r} value={r} />)}</datalist>
  </span>
);

/**
 * Give one shortlisted candidate a paper, and hand over the link.
 *
 * The vacancy's own paper is chosen by default where it has one - a travel
 * consultant and an accounts executive are not tested the same way, and the
 * test follows the opening.
 *
 * It assigns ONCE. The link that comes back is theirs and opens one attempt;
 * if it gets lost in a WhatsApp thread it is re-sent from the candidate's own
 * row, never drawn again - a second paper would let somebody read the
 * questions, close it, and sit a fresh one.
 */
function SendTest({ row, onDone, onError, onToast, onOpen }) {
  const [papers, setPapers] = useState([]);
  const [paperId, setPaperId] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');

  useEffect(() => {
    api
      .get('/hiring/papers')
      .then(({ papers: list }) => {
        setPapers(list || []);
        const mine = (list || []).find((p) => p.id === row.test_paper_id);
        setPaperId(String(mine?.id || list?.[0]?.id || ''));
      })
      .catch(onError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async () => {
    setBusy(true);
    try {
      const out = await api.post(`/hiring/papers/${paperId}/assign`, {
        candidate_id: row.candidate_id,
        application_id: row.application_id,
      });
      const url = out.link?.startsWith('http')
        ? out.link
        : `${window.location.origin}${out.link}`;
      setLink(url);
      onToast('Paper drawn — send them the link');
      onDone?.();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scr-row">
      <div className="scr-who">
        <button className="link-like" onClick={() => onOpen(row.application_id)}>
          <strong>{row.name}</strong>
        </button>
        <span className="muted small">
          {' '}· {row.ref_no} · {row.phone} · {row.job_title}, {row.company_name}
        </span>
      </div>
      {link ? (
        <div className="row">
          <a
            className="btn"
            target="_blank"
            rel="noreferrer"
            href={
              waLink(
                row.phone,
                testInvite({
                  candidate: { name: row.name },
                  vacancy: { title: row.job_title, company_name: row.company_name },
                  url: link,
                })
              ) || '#'
            }
          >
            Send on WhatsApp
          </a>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(link);
              onToast('Link copied');
            }}
          >
            Copy link
          </button>
        </div>
      ) : papers.length ? (
        <div className="row">
          <select value={paperId} onChange={(e) => setPaperId(e.target.value)}>
            {papers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.questions} questions, {p.duration_minutes} min
              </option>
            ))}
          </select>
          <button className="primary" disabled={!paperId || busy} onClick={send}>
            {busy ? 'Drawing…' : 'Send the test'}
          </button>
        </div>
      ) : (
        <span className="muted small">
          No papers yet — make one under Hiring → Tests.
        </span>
      )}
    </div>
  );
}
