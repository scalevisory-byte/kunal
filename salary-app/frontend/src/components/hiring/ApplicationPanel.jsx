import { useEffect, useState } from 'react';
import { STANDALONE, api } from '../../api.js';
import { ALL_STAGES, STAGES, aging, matchBand, stageMeta } from '../../../../shared/stages.js';
import { waLink } from '../../../../shared/hiringMessages.js';
import { readAnswers, spell } from '../../../../shared/testAnswers.js';
import { ReportLines, ScreeningForm } from './Screening.jsx';
import Offer from './Offer.jsx';

/**
 * One person against one job: why they scored what they scored, where they are,
 * and the next move. The move and the message are side by side because they go
 * together - telling somebody is the other half of deciding.
 */
/**
 * One sitting, question by question, with how long each took.
 *
 * The point of it is the question somebody SAT ON: a candidate who answers
 * nine questions in ten seconds each and spends four minutes on the tenth has
 * told you something a percentage cannot.
 *
 * Two things it refuses to do: a question with no time recorded shows a dash
 * rather than 0s, and a question the test system did not mark shows nothing
 * rather than a cross - silence is not a wrong answer.
 */
function QuestionTimes({ detail }) {
  if (detail.problem) return <p className="error small" style={{ margin: '0.5rem' }}>{detail.problem}</p>;
  const slowest = detail.slowest?.n;
  return (
    <div style={{ padding: '0.5rem 0.6rem' }}>
      <div className="figures">
        <div className="figure">
          <span className="n">{spell(detail.total_seconds)}</span>
          <span className="k">Time taken</span>
        </div>
        <div className="figure">
          <span className="n">{spell(detail.average_seconds)}</span>
          <span className="k">Per question</span>
        </div>
        <div className="figure">
          <span className="n">{detail.slowest ? spell(detail.slowest.seconds) : '—'}</span>
          <span className="k">Longest{detail.slowest ? ` — Q${detail.slowest.n}` : ''}</span>
        </div>
        {/* Only shown where a limit was actually set. With none, there is
            nothing to be over, and a column of noughts would imply there was. */}
        {detail.limit_seconds ? (
          <div className="figure">
            <span className={`n ${detail.over_limit ? 'over' : ''}`}>{detail.over_limit}</span>
            <span className="k">Over {detail.limit_seconds}s</span>
          </div>
        ) : null}
      </div>
      {detail.untimed > 0 && (
        <p className="muted small">
          {detail.untimed} of {detail.items.length}{' '}
          {detail.items.length === 1 ? 'question' : 'questions'}{' '}
          {detail.untimed === 1 ? 'carries' : 'carry'} no timing, so the total is of the rest.
        </p>
      )}
      <div className="table-wrap">
        <table className="sheet qa">
          <thead>
            <tr>
              <th>#</th>
              {/* Took comes early on purpose: it is the reason this list
                  exists, and a panel is narrow enough that the last column
                  is the one nobody scrolls to. */}
              <th className="num">Took</th>
              <th>Question</th>
              <th>Answered</th>
            </tr>
          </thead>
          <tbody>
            {detail.items.map((q) => (
              <tr key={q.n} className={q.n === slowest ? 'slowest' : undefined}>
                <td className="num">{q.n}</td>
                <td className={`num${q.over ? ' over' : ''}`}>
                  {spell(q.seconds)}
                  {q.over ? <div className="small">over</div> : null}
                </td>
                <td className="wraps q">{q.question || <span className="muted">—</span>}</td>
                <td className="wraps a">
                  {q.given || <span className="muted">not answered</span>}
                  {/* Right or wrong rides with the answer rather than taking a
                      fifth column. "not marked" is said, never left blank -
                      silence from the test system is not a wrong answer. */}
                  <div
                    className={`small ${q.correct === true ? 'good' : q.correct === false ? 'warn' : 'muted'}`}
                  >
                    {q.correct === true
                      ? 'right'
                      : q.correct === false
                        ? `wrong${q.expected ? ` — should be ${q.expected}` : ''}`
                        : 'not marked'}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ApplicationPanel({ applicationId, config, onClose, onChanged, onToast, onError, abilities = [] }) {
  const [data, setData] = useState(null);
  // Which sitting is opened out, question by question.
  const [openTest, setOpenTest] = useState(null);
  const [notify, setNotify] = useState(null);
  const [papers, setPapers] = useState([]);
  const [paperId, setPaperId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [sentLink, setSentLink] = useState('');
  const [screening, setScreening] = useState(null);
  const loadScreening = () => {
    if (STANDALONE) return;
    api
      .get(`/hiring/applications/${applicationId}/screening`)
      .then(setScreening)
      .catch(() => setScreening(null));
  };
  const fullLink =
    sentLink && !sentLink.startsWith('http')
      ? `${window.location.origin}${sentLink}`
      : sentLink;
  const [test, setTest] = useState({ score: '', max_score: '', type: 'skills' });
  const [interview, setInterview] = useState({ at: '', mode: 'in-person', location_or_link: '', round: 1 });

  const load = async () => {
    try {
      setData(await api.get(`/hiring/applications/${applicationId}`));
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    loadScreening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  useEffect(() => {
    if (STANDALONE) return;
    api.get('/hiring/papers').then(({ papers: rows }) => setPapers(rows || [])).catch(() => setPapers([]));
  }, []);

  useEffect(() => {
    load();
    setNotify(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  const save = async (body) => {
    try {
      await api.patch(`/hiring/applications/${applicationId}`, body);
      await load();
      onChanged?.();
    } catch (err) {
      onError(err);
    }
  };

  /*
   * Drawing the paper happens NOW, not when they open the link: the office can
   * see what somebody was asked before they sit down, and a refresh cannot
   * deal a fresh, easier hand.
   */
  const assignTest = async () => {
    setAssigning(true);
    try {
      const res = await api.post(`/hiring/papers/${paperId}/assign`, {
        candidate_id: application.candidate_id,
        application_id: applicationId,
      });
      setSentLink(res.link);
      onToast('Paper drawn — send them the link');
    } catch (err) {
      onError(err);
    } finally {
      setAssigning(false);
    }
  };

  const move = async (stage) => {
    try {
      const res = await api.post(`/hiring/applications/${applicationId}/stage`, { stage });
      setNotify(res.notify);
      await load();
      onChanged?.();
    } catch (err) {
      onError(err);
    }
  };

  const saveTest = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/hiring/applications/${applicationId}/test`, {
        type: test.type,
        score: Number(test.score),
        max_score: Number(test.max_score),
        source: 'typed in',
      });
      setTest({ score: '', max_score: '', type: 'skills' });
      onToast('Test recorded — nobody was moved');
      await load();
      onChanged?.();
    } catch (err) {
      onError(err);
    }
  };

  const schedule = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('/hiring/interviews', { ...interview, application_id: applicationId });
      setNotify(res.notify);
      setInterview({ at: '', mode: 'in-person', location_or_link: '', round: 1 });
      onToast('Interview scheduled and put on your follow-up list');
      await load();
      onChanged?.();
    } catch (err) {
      onError(err);
    }
  };

  if (!data) return null;
  const { application, match, interviews, resume, tests } = data;
  const age = aging(application.stage_changed_at);
  const here = STAGES.findIndex((s) => s.key === application.stage);
  const next = here >= 0 && here < STAGES.length - 1 ? STAGES[here + 1] : null;

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel">
        <header>
          <div>
            <h1>{application.candidate_name}</h1>
            <p className="muted small">
              {application.job_title} · {application.company_name} · {application.vacancy_ref} ·{' '}
              {application.phone}
            </p>
          </div>
          <button className="close" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="card">
          <div className="figures">
            <div className="figure">
              <span className={`n band ${matchBand(application.match_score)}`}>
                {application.match_score}%
              </span>
              <span className="k">Match</span>
            </div>
            <div className="figure">
              <span className="n">{application.test_score == null ? '—' : `${application.test_score}%`}</span>
              <span className="k">Test</span>
            </div>
            <div className="figure">
              <span className="n" style={{ fontSize: '1rem' }}>
                {application.stage}
              </span>
              <span className={`k age ${age.tone}`}>here {age.label}</span>
            </div>
          </div>
          <p className="muted small">{stageMeta(application.stage)?.hint}</p>
        </div>

        <div className="card">
          <h3>Move</h3>
          <div className="row">
            {next ? (
              <button className="primary" onClick={() => move(next.key)}>
                → {next.label}
              </button>
            ) : null}
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) move(e.target.value);
              }}
            >
              <option value="">Somewhere else…</option>
              {ALL_STAGES.filter((s) => s !== application.stage).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {resume ? (
              <a className="btn" href={resume.url} target="_blank" rel="noreferrer">
                CV
              </a>
            ) : (
              <span className="muted small">no CV on file</span>
            )}
          </div>

          {notify ? (
            <>
              <label className="field" style={{ marginTop: '0.7rem' }}>
                Message to send
                <textarea className="copy-box" readOnly value={notify.text} />
              </label>
              <div className="row">
                <a className="btn primary" href={notify.whatsapp} target="_blank" rel="noreferrer">
                  Send on WhatsApp
                </a>
                <button
                  onClick={async () => {
                    await navigator.clipboard?.writeText(notify.text);
                    onToast('Copied');
                  }}
                >
                  Copy
                </button>
                <button className="link" onClick={() => setNotify(null)}>
                  dismiss
                </button>
              </div>
              <p className="muted small">
                Nothing is sent automatically — this app has no WhatsApp session. You send it
                from your own number.
              </p>
            </>
          ) : null}
        </div>

        {/*
          * The Offer card that used to live here is gone.
          *
          * It held offer_salary and joining_date on the application, and the
          * new offer record holds its own - two numbers for one fact, which is
          * exactly how a letter and a payslip come to disagree. The offer is
          * now the single place the figure is typed, and approving it writes
          * that figure back onto the application, which is what hireApplication
          * and the WhatsApp offer message have always read.
          */}
        {/*
          * Screening, where somebody is already looking at this one person.
          *
          * Dinesh asked, standing on the candidate list, how to move somebody
          * forward - "if selected aage ki process k liye jayega, on hold or
          * rejected". This card is the answer, and it is on the application
          * because that is the thing being decided about: the same person can
          * be right for one opening and wrong for another.
          */}
        {!STANDALONE && screening ? (
          <div className="card">
            <h3>Screening</h3>
            <p className="muted small">
              How they measure against what this opening asked for. It is advice — you can take
              somebody who misses every line of it.
            </p>
            <ReportLines report={screening.report} />
            <ScreeningForm
              applicationId={applicationId}
              screening={screening.screening}
              report={screening.report}
              onSaved={() => { loadScreening(); load(); }}
              onError={onError}
              onToast={onToast}
            />
          </div>
        ) : null}

        <div className="card">
          <h3>Interviews</h3>
          {interviews.length ? (
            <div className="lines">
              {interviews.map((i) => (
                <div key={i.id}>
                  <span className="what">
                    Round {i.round} · {i.mode}
                    {i.location_or_link ? <span className="muted small"> · {i.location_or_link}</span> : null}
                  </span>
                  <span className="small num">{String(i.at).replace('T', ' ').slice(0, 16)}</span>
                  <span className="small muted">{i.status}</span>
                </div>
              ))}
            </div>
          ) : null}
          <form className="grid" style={{ marginTop: '0.6rem' }} onSubmit={schedule}>
            <label className="field">
              When
              <input
                type="datetime-local"
                value={interview.at}
                required
                onChange={(e) => setInterview({ ...interview, at: e.target.value })}
              />
            </label>
            <label className="field">
              Mode
              <select
                value={interview.mode}
                onChange={(e) => setInterview({ ...interview, mode: e.target.value })}
              >
                {['in-person', 'telephonic', 'video'].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Where / link
              <input
                value={interview.location_or_link}
                onChange={(e) => setInterview({ ...interview, location_or_link: e.target.value })}
              />
            </label>
            <label className="field">
              Round
              <input
                type="number"
                min="1"
                value={interview.round}
                onChange={(e) => setInterview({ ...interview, round: Number(e.target.value) })}
              />
            </label>
            <div style={{ alignSelf: 'end' }}>
              <button className="primary" type="submit">
                Schedule
              </button>
            </div>
          </form>
        </div>

        <Offer
          applicationId={applicationId}
          abilities={abilities}
          onChanged={load}
          onError={onError}
          onToast={onToast}
        />

        {/*
          * Sending an in-house paper.
          *
          * This is where somebody is deciding about ONE person, so this is
          * where the button goes. A paper that could only be assigned from the
          * Tests tab - a screen about papers, not about people - is the shape
          * of bug this codebase has now learnt seven times.
          */}
        {!STANDALONE ? (
          <div className="card">
            <h3>Send an in-house test</h3>
            {sentLink ? (
              <>
                <p className="muted small">
                  Their own link. Every candidate gets a different selection of questions, so this
                  one is theirs — it opens one test and nothing else.
                </p>
                {/*
                  * The server answers an absolute link only when the public
                  * address is set up. Without it the link came back as
                  * "/sit/TST-…", which looks fine in the box and is dead the
                  * moment it is pasted into WhatsApp. So it is made absolute
                  * here against whatever address the office is using, and the
                  * guess is admitted rather than hidden.
                  */}
                <div className="row">
                  <input readOnly value={fullLink} onFocus={(e) => e.target.select()} />
                  <button onClick={() => navigator.clipboard?.writeText(fullLink)}>Copy</button>
                </div>
                {!sentLink.startsWith('http') ? (
                  <p className="muted small">
                    The public web address is not set, so this link uses the one you are on. If
                    that is not the address candidates can reach, set it under Vacancies → Careers
                    page first.
                  </p>
                ) : null}
              </>
            ) : papers.length ? (
              <div className="row">
                <select value={paperId} onChange={(e) => setPaperId(e.target.value)}>
                  <option value="">Choose a paper…</option>
                  {papers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.questions} questions, {p.duration_minutes} min
                    </option>
                  ))}
                </select>
                <button className="primary" disabled={!paperId || assigning} onClick={assignTest}>
                  {assigning ? 'Drawing…' : 'Draw their paper'}
                </button>
              </div>
            ) : (
              <p className="muted small">
                No papers yet — make one under Hiring → Tests, and it draws from the questions you
                type in there.
              </p>
            )}
          </div>
        ) : null}

        <div className="card">
          <h3>Payroll</h3>
          {application.employee_id ? (
            <p className="small">
              On the payroll of <strong>{application.company_name}</strong> since{' '}
              {application.joining_date || 'their joining date'}. They are on the salary sheet and
              the attendance grid now — nothing else to do here.
            </p>
          ) : (
            <>
              <p className="muted small">
                Adds {application.candidate_name} to <strong>{application.company_name}</strong> as
                an employee, carrying across the phone, email and date of birth already on file.
                The company comes from the vacancy, not from a form.
              </p>
              <div className="row">
                <button
                  className="primary"
                  disabled={!application.offer_salary}
                  onClick={async () => {
                    if (!window.confirm(
                      `Add ${application.candidate_name} to ${application.company_name} at ₹${Number(
                        application.offer_salary
                      ).toLocaleString('en-IN')} a month?`
                    )) return;
                    try {
                      await api.post(`/hiring/applications/${applicationId}/hire`, {});
                      onToast('Added to the payroll');
                      await load();
                      onChanged?.();
                    } catch (err) {
                      onError(err);
                    }
                  }}
                >
                  Add to payroll
                </button>
                {!application.offer_salary ? (
                  <span className="muted small">Fill in the monthly salary first.</span>
                ) : null}
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h3>Why this score</h3>
          {Object.entries(match.factors).map(([name, f]) => (
            <div className="factor" key={name}>
              <span className="f-name">{name}</span>
              <span className="bar">
                <i style={{ width: `${f.of ? (f.score / f.of) * 100 : 0}%` }} />
              </span>
              <span className="f-note">{f.note}</span>
            </div>
          ))}
          {match.missing?.length ? (
            <p className="muted small" style={{ marginTop: '0.5rem' }}>
              Does not have: {match.missing.join(', ')}
            </p>
          ) : null}
          <p className="muted small">
            A number for ordering a queue. It is not a decision and it never moves anybody.
          </p>
        </div>

        <div className="card">
          <h3>Record a test</h3>
          {data.test?.source ? (
            <p className="muted small">
              This vacancy uses{' '}
              {data.test.source === 'opening' ? 'its own test' : 'the app-wide test'}, pass mark{' '}
              {data.test.pass_percent}%
              {data.test.seconds_per_question
                ? `, ${data.test.seconds_per_question}s a question`
                : ', no time limit per question'}
              , so a score can come back on its own. Type one in here when the test was taken
              elsewhere.
            </p>
          ) : (
            <p className="muted small">
              No test is set up for this vacancy. Put a link on it under Vacancies, or type the
              score in by hand.
            </p>
          )}
          {data.test?.problem && <p className="error small">{data.test.problem}</p>}
          <form className="row" onSubmit={saveTest}>
            <input
              placeholder="Type"
              value={test.type}
              style={{ width: '7rem' }}
              onChange={(e) => setTest({ ...test, type: e.target.value })}
            />
            <input
              type="number"
              placeholder="Score"
              value={test.score}
              required
              style={{ width: '5.5rem' }}
              onChange={(e) => setTest({ ...test, score: e.target.value })}
            />
            <span className="muted">out of</span>
            <input
              type="number"
              placeholder="Max"
              value={test.max_score}
              required
              style={{ width: '5.5rem' }}
              onChange={(e) => setTest({ ...test, max_score: e.target.value })}
            />
            <button type="submit">Save</button>
          </form>

          {/*
            * Every sitting, newest first.
            *
            * The figure at the top of this panel is the LATEST result against
            * this opening; these are the workings behind it. The server sends
            * them by candidate, so somebody who also sat a test for another
            * job shows that here too - it is still their result, and it is
            * labelled rather than hidden or quietly counted as this one.
            */}
          {tests?.length ? (
            /* Wrapped, or the last column runs off the side of the panel -
               a panel is narrower than a page and a sheet does not reflow. */
            <div className="table-wrap" style={{ marginTop: '0.6rem' }}>
            <table className="sheet">
              <thead>
                <tr>
                  <th>Taken</th>
                  <th>Test</th>
                  <th className="num">Score</th>
                  <th className="num">%</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {tests.flatMap((t) => {
                  const detail = readAnswers(t.answers, { limitSeconds: t.seconds_per_question });
                  const open = openTest === t.id;
                  return [
                  <tr
                    key={t.id}
                    onClick={() => detail.items.length && setOpenTest(open ? null : t.id)}
                    style={detail.items.length ? { cursor: 'pointer' } : undefined}
                    title={detail.items.length ? 'Question by question' : undefined}
                  >
                    <td>{String(t.taken_at).replace('T', ' ').slice(0, 16)}</td>
                    <td>
                      {t.type}
                      {/* Where it came from rides along with the test name:
                          a sixth column makes this scroll sideways inside a
                          drawer, and a table you have to scroll is one nobody
                          reads the end of. */}
                      <div className="muted small">
                        {t.source || 'typed in'}
                        {t.application_id !== application.id && ' · for another vacancy'}
                      </div>
                    </td>
                    <td className="num">
                      {t.max_score ? `${t.score} / ${t.max_score}` : <span className="muted">—</span>}
                    </td>
                    <td className="num">{Math.round(t.percentage)}%</td>
                    <td className={t.passed ? 'good' : 'warn'}>
                      {t.passed ? 'Passed' : 'Below the bar'}
                      {/* The bar it was judged against, because "passed" with
                          no bar cannot be explained later, and an opening's
                          pass mark can be edited afterwards. */}
                      {t.pass_percent ? (
                        <span className="muted small"> (needed {t.pass_percent}%)</span>
                      ) : null}
                      {detail.items.length ? (
                        <div className="muted small">
                          {detail.total_seconds !== null
                            ? `${spell(detail.total_seconds)} in all`
                            : 'no timings'}{' '}
                          · {open ? 'hide' : `${detail.items.length} questions`}
                        </div>
                      ) : null}
                    </td>
                  </tr>,
                  open ? (
                    <tr key={`${t.id}-detail`}>
                      <td colSpan={5} style={{ padding: 0 }}>
                        <QuestionTimes detail={detail} />
                      </td>
                    </tr>
                  ) : null,
                  ];
                })}
              </tbody>
            </table>
            </div>
          ) : (
            <p className="muted small" style={{ marginTop: '0.5rem' }}>
              No test taken yet. A score is one more thing to weigh — it moves nobody on its
              own.
            </p>
          )}
        </div>

        <div className="card">
          <h3>What happened</h3>
          <ul className="timeline">
            {application.stage_log.map((step, i) => (
              <li key={i}>
                <strong>{step.stage}</strong>{' '}
                <span className="muted">
                  {String(step.on).replace('T', ' ').slice(0, 16)} · {step.by}
                </span>
                {step.note ? <div className="muted small">{step.note}</div> : null}
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <h3>Notes</h3>
          <textarea
            key={`n-${application.id}-${application.notes ?? ''}`}
            defaultValue={application.notes ?? ''}
            onBlur={async (e) => {
              if (e.target.value !== (application.notes ?? '')) {
                await api.patch(`/hiring/applications/${applicationId}`, { notes: e.target.value });
                load();
              }
            }}
          />
        </div>

        <p className="muted small">
          {application.candidate_name} applied {String(application.created_at).slice(0, 10)} ·{' '}
          {waLink(application.phone, '') ? (
            <a href={waLink(application.phone, '')} target="_blank" rel="noreferrer">
              message on WhatsApp
            </a>
          ) : null}
        </p>
      </div>
    </div>
  );
}
