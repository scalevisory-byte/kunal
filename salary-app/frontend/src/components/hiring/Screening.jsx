import { useEffect, useState } from 'react';
import { testInvite, waLink } from '../../../../shared/hiringMessages.js';
import QuestionBank from './QuestionBank.jsx';
import TestResult from './TestResult.jsx';
import TestResults from './TestResults.jsx';
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

export default function Screening({ companyId, config, refresh = 0, onOpen, onOpenCandidate, onError, onToast }) {
  const [queue, setQueue] = useState([]);
  const [summary, setSummary] = useState(null);
  const [open, setOpen] = useState(null);
  const [ready, setReady] = useState([]);
  const [showBank, setShowBank] = useState(false);
  const [openSheet, setOpenSheet] = useState(null);

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
  }, [companyId, refresh]);

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
            {/* `.figure` or the number and its label run together — "0waiting". */}
            <div className="figure">
              <span className="n">{summary.waiting}</span>
              <span className="k">waiting to be screened</span>
            </div>
            {summary.verdicts.map((v) => (
              <div className="figure" key={v.verdict}>
                <span className="n">{v.n}</span>
                <span className="k">{v.verdict.toLowerCase()}</span>
              </div>
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
      {ready.length ? (
        <div className="card">
          <h3>The test, and who is ready for interview</h3>
          <p className="muted small">
            Everybody screened in, in the order the day goes: no paper yet, paper sent, qualified,
            not qualified, interview booked. The link stays here until they have sat it — sending
            a second paper would let somebody read the questions, close it and start again.
          </p>
          <p className="muted small">
            <strong>The score decides nothing.</strong> “Qualified” only means the paper reached
            its pass mark; anybody on this card can be called for interview, and nobody is called
            by the app. Turning somebody down is still a decision taken on their application.
          </p>
          {/*
            * THE ORDER OF THE DAY: screened in, paper, result, interview.
            *
            * Dinesh: *"screening me pass hone ke baad interview kiya jayega"*.
            * That is the flow, and the list could not show it - "Done" held
            * everybody who had sat a paper, so somebody who passed, somebody
            * who did not and somebody already called for interview were one
            * undifferentiated heap, and the list of people to ring was being
            * kept in somebody's head.
            *
            * THE SPLIT DECIDES NOTHING. A paper not passed is not a
            * rejection, and the Schedule button is on that group too - the
            * office calls who it wants to call. The headings only say what
            * the records already say.
            */}
          {['not_sent', 'sent', 'passed', 'failed', 'booked'].map((state) => {
            const group = ready.filter((r) => {
              if (state === 'not_sent' || state === 'sent') return r.state === state;
              if (r.state !== 'sat') return false;
              if (r.interview) return state === 'booked';
              return state === (r.attempt?.passed ? 'passed' : 'failed');
            });
            if (!group.length) return null;
            return (
              <div key={state}>
                <p className="ask">
                  {/*
                    * "Sent" was a claim the app cannot make.
                    *
                    * Dinesh: "bina generate kiye copy link kyu aa raha he".
                    * The link was there because a paper had been DRAWN for
                    * him earlier - but the app called that "Sent", and it
                    * has no idea whether anybody actually sent it. Drawing
                    * the paper and handing it over are two different acts,
                    * and only the first one happens in here.
                    */}
                  {state === 'not_sent'
                    ? `No paper yet (${group.length})`
                    : state === 'sent'
                      ? `Paper ready — not sat yet (${group.length})`
                      : state === 'passed'
                        ? `Qualified — ready for interview (${group.length})`
                        : state === 'failed'
                          ? `Not qualified (${group.length})`
                          : `Interview booked (${group.length})`}
                </p>
                {group.map((row) => (
                  <SendTest
                    key={row.application_id}
                    row={row}
                    config={config}
                    onDone={load}
                    onError={onError}
                    onToast={onToast}
                    onOpen={onOpen}
                    onSheet={setOpenSheet}
                  />
                ))}
              </div>
            );
          })}
        </div>
      ) : null}

      {/*
        * Every result, whoever they are.
        *
        * Dinesh, with a finished test on his screen: "result kahan dikhayega
        * bhai". It WAS on the card above - under his own name, where it
        * belongs while you are working one opening, and nowhere near where
        * somebody looks for "the results". This is that place, and it keeps
        * a score after the person has moved on.
        */}
      <TestResults
        companyId={companyId}
        onSheet={setOpenSheet}
        onOpen={onOpen}
        onOpenCandidate={onOpenCandidate}
        onError={onError}
      />

      {/*
        * The questions and papers, folded in.
        *
        * Dinesh: *"test ko screening k andar dal do"*. It is setup rather
        * than daily work, so it sits LAST and closed: the queue above is what
        * somebody opens this page for. Folded with useState and not a
        * <details> — the page reloads itself after every verdict, and a
        * <details> shuts under the person's hands when React redraws it.
        */}
      <div className="card">
        <div className="row">
          <h3 style={{ margin: 0 }}>Questions and papers</h3>
          <span className="spacer" />
          <button onClick={() => setShowBank(!showBank)}>
            {showBank ? 'hide' : 'open'}
          </button>
        </div>
        {showBank ? (
          <div style={{ marginTop: '0.7rem' }}>
            <QuestionBank companies={[]} onError={onError} onToast={onToast} />
          </div>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            The question bank and the papers drawn from it. Open it to add questions, change a
            paper, or load the ready-made ones.
          </p>
        )}
      </div>

      {openSheet ? (
        <TestResult attemptId={openSheet} onClose={() => setOpenSheet(null)} onError={onError} />
      ) : null}

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
function SendTest({ row, config, onDone, onError, onToast, onOpen, onSheet }) {
  const [papers, setPapers] = useState([]);
  const [paperId, setPaperId] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawn, setDrawn] = useState('');

  const sent = row.state !== 'not_sent';

  useEffect(() => {
    /* The picker is needed when nothing has been sent AND when offering
     * another paper after one has been sat. */
    if (row.state === 'sent') return;
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

  /*
   * The link, worked out the same way wherever it is shown.
   *
   * The server answers an absolute URL only once the public address is set.
   * Without it the link came back as "/sit/TST-…", which looks fine in a box
   * and is dead the moment it is pasted into WhatsApp.
   */
  const linkFor = (token) =>
    `${config?.public_url || window.location.origin}/sit/${token}`;
  const link = drawn || (row.attempt?.token ? linkFor(row.attempt.token) : '');

  const send = async () => {
    setBusy(true);
    try {
      const out = await api.post(`/hiring/papers/${paperId}/assign`, {
        candidate_id: row.candidate_id,
        application_id: row.application_id,
      });
      setDrawn(
        out.link?.startsWith('http') ? out.link : `${window.location.origin}${out.link}`
      );
      onToast('Paper drawn — now send them the link');
      /* The list reloads, so this row comes back as "sent" with the new
       * attempt on it. Without this it would keep showing the old score. */
      onDone?.();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const share = link ? (
    <>
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
    </>
  ) : null;

  return (
    <div className="scr-row">
      <div className="scr-who">
        <button className="link-like" onClick={() => onOpen(row.application_id)}>
          <strong>{row.name}</strong>
        </button>
        <span className="muted small">
          {' '}· {row.ref_no} · {row.phone} · {row.job_title}, {row.company_name}
        </span>
        {row.attempt ? (
          <div className="muted small">
            {row.attempt.paper_name}
            {row.attempt.submitted_at
              /* ?? 0, not the bare column: an attempt saved before these
                 counts existed has nulls on it, and "19 right, null wrong"
                 is how a perfectly good paper reads as broken. */
              ? ` · sat ${String(row.attempt.submitted_at).replace('T', ' ').slice(0, 16)} · ${
                  row.attempt.right_count ?? 0
                } right, ${row.attempt.wrong_count ?? 0} wrong${
                  row.attempt.skipped_count ? `, ${row.attempt.skipped_count} blank` : ''
                }`
              : ` · paper drawn ${String(row.attempt.assigned_at).slice(0, 10)}${
                  row.attempt.assigned_by ? ` by ${row.attempt.assigned_by}` : ''
                } · not sat yet`}
          </div>
        ) : null}
      </div>

      {row.state === 'sat' ? (
        <div className="row">
          <strong className={row.attempt.passed ? 'age fresh' : 'muted'}>
            {row.attempt.percentage}%
          </strong>
          <button onClick={() => onSheet(row.attempt.id)}>Answer sheet</button>
          {/*
            * The next step, on the row where the result is read.
            *
            * The booking itself is on the application - when, round, mode,
            * interviewer, where - so this opens it rather than pretending to
            * book from a queue. Once something is booked the button stops
            * asking and says what is booked instead; a second "Schedule" on
            * a person already called is how two interviews get booked for
            * one afternoon.
            */}
          {row.interview ? (
            <span className="muted small">
              Interview {String(row.interview.at).replace('T', ' ').slice(0, 16)}
              {row.interview.round > 1 ? ` · round ${row.interview.round}` : ''} ·{' '}
              {row.interview.status}
            </span>
          ) : (
            <button className="primary" onClick={() => onOpen(row.application_id)}>
              Schedule interview
            </button>
          )}
          {/*
            * Another paper, when something went wrong rather than badly.
            *
            * A link opened by accident and left in a tab used to spend the
            * whole paper — that cannot happen any more, but a phone can die
            * mid-test and somebody deserves a second go. It is a DELIBERATE
            * button with a confirm, never automatic: the old attempt and its
            * answer sheet stay exactly where they are, and the new paper is
            * a fresh draw, so this is not a way to see the questions twice.
            */}
          <button
            onClick={async () => {
              if (
                !window.confirm(
                  `Give ${row.name} another paper? The one they have already sat stays on record. ` +
                    'The new paper draws different questions.'
                )
              )
                return;
              await send();
            }}
          >
            Another paper
          </button>
        </div>
      ) : sent || drawn ? (
        /*
         * The link, kept where the work is.
         *
         * The first version of this list dropped somebody the moment a paper
         * was drawn, which took the link with them — and the link is the
         * whole point. It is the SAME attempt every time it is sent again,
         * never a fresh draw.
         */
        <div className="row">
          {share}
          <span className="muted small">this link, again — never a new paper</span>
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
          No papers yet — open “Questions and papers” below and make one.
        </span>
      )}
    </div>
  );
}
