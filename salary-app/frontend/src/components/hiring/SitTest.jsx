import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';

/**
 * The page a candidate sits a test on.
 *
 * No password: the token in their link is the whole of their identity, and it
 * reaches exactly one attempt. Nothing on this page sends a candidate id, a
 * paper id or a question id that the server did not give it.
 *
 * What is NOT here matters more than what is. The payload carries no right
 * answers and no per-question marks - that is enforced on the server by
 * forCandidate(), not by this page choosing not to render them. A page is not
 * a place to keep a secret.
 */

const mmss = (seconds) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/*
 * Keep the answers through a refresh.
 *
 * A phone reloads a page for its own reasons, and with one question at a time
 * the candidate had no way back: the answers lived only in memory, so a
 * hiccup put them on question one with nothing recorded while the paper's
 * clock carried on draining. They get one attempt; losing it to a reload is
 * not a judgement about them.
 *
 * sessionStorage, keyed by the token, wrapped in try/catch — a private window
 * throws on merely touching it, and a convenience must never take the test
 * down. If it comes back empty, the test simply starts from where it would
 * have anyway.
 */
const keep = (token, value) => {
  try {
    sessionStorage.setItem(`sit-${token}`, JSON.stringify(value));
  } catch {
    /* no storage — the test still works, it just cannot survive a reload */
  }
};

const recall = (token) => {
  try {
    return JSON.parse(sessionStorage.getItem(`sit-${token}`) || 'null');
  } catch {
    return null;
  }
};

export default function SitTest({ token }) {
  const [paper, setPaper] = useState(null);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState(() => recall(token)?.answers || {});
  const [left, setLeft] = useState(null);
  const [done, setDone] = useState(null);
  const [sending, setSending] = useState(false);
  /* One at a time: which question is on screen, and its own clock. */
  const [at, setAt] = useState(() => recall(token)?.at || 0);
  const [qLeft, setQLeft] = useState(null);
  // The submit has to be reachable from the timer without re-running it every
  // tick, and a double submit must be impossible even if both fire at once.
  const sent = useRef(false);
  const answersRef = useRef({});

  useEffect(() => {
    api.public
      .get(`/sit/${token}`)
      .then((got) => {
        if (got.done) setDone(got);
        else {
          setPaper(got);
          /* Not started: there is no clock yet and no questions to count. */
          if (got.started) setLeft(got.seconds_left);
        }
      })
      .catch((err) => setError(err.message || 'This test link does not work.'));
  }, [token]);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  /* Written on every change, so a reload picks up where they were. */
  useEffect(() => {
    if (!done) keep(token, { answers, at });
  }, [answers, at, done, token]);

  const submit = async (auto = false) => {
    if (sent.current) return;
    sent.current = true;
    setSending(true);
    try {
      const out = await api.public.post(`/sit/${token}`, {
        answers: answersRef.current,
        auto,
      });
      setDone({ done: true, ...out, just_finished: true, auto });
      try {
        sessionStorage.removeItem(`sit-${token}`);
      } catch {
        /* nothing to clear */
      }
    } catch (err) {
      sent.current = false;
      setError(err.message || 'That did not send. Try again.');
    } finally {
      setSending(false);
    }
  };

  /*
   * Starting is a press, not a page load.
   *
   * The clock used to begin the moment the link opened, so tapping it on a
   * bus to see what it was spent the whole paper. The questions are not even
   * sent until this call, so they cannot be read ahead of the time.
   */
  const start = async () => {
    setSending(true);
    try {
      const got = await api.public.post(`/sit/${token}/start`, {});
      setPaper(got);
      setLeft(got.seconds_left);
    } catch (err) {
      setError(err.message || 'That did not start. Try again.');
    } finally {
      setSending(false);
    }
  };

  const one = !!paper?.one_at_a_time;
  const perQuestion = Number(paper?.seconds_per_question) || 30;

  /*
   * Move to the next question, or finish.
   *
   * `atRef` carries the position into the timer without re-arming it on every
   * tick, the same reason `answersRef` exists: a setTimeout closes over the
   * value it was created with, and a stale one would park the test on one
   * question for ever.
   */
  const atRef = useRef(0);
  useEffect(() => {
    atRef.current = at;
  }, [at]);

  const next = () => {
    if (!paper) return;
    if (atRef.current + 1 >= paper.questions.length) {
      submit(false);
      return;
    }
    setAt((n) => n + 1);
    setQLeft(perQuestion);
  };

  /* The first question's clock starts once the paper is on screen. */
  useEffect(() => {
    if (one && qLeft === null) setQLeft(perQuestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [one]);

  /*
   * The per-question clock.
   *
   * IT PACES, IT DOES NOT ENFORCE. The whole paper is delivered at once and
   * this counts down in the browser, so a determined person could stop it.
   * What is actually checked is the server's own total, from its own start
   * time — stated in the office panel rather than left implied, because
   * believing in a limit nobody checks is worse than knowing its shape.
   *
   * Running out is a SKIP, never a wrong answer: an unanswered question
   * scores nought and costs nothing, which is the rule marking has always
   * followed.
   */
  useEffect(() => {
    if (!one || qLeft === null || done || sent.current) return undefined;
    if (qLeft <= 0) {
      next();
      return undefined;
    }
    const t = setTimeout(() => setQLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qLeft, one, done]);

  /*
   * The countdown, and what it is for.
   *
   * It runs off the SERVER's seconds_left, counted down locally so the number
   * moves. It does not decide anything: the server marks a late paper and
   * flags it, so a candidate whose machine clock is wrong, or who closed the
   * laptop, is not silently failed by this timer. Reaching zero submits what
   * they have rather than losing it.
   */
  useEffect(() => {
    if (left === null || done) return undefined;
    if (left <= 0) {
      submit(true);
      return undefined;
    }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, done]);

  if (error && !paper) {
    return (
      <div className="sit-page">
        <div className="sit-card">
          <h1>BOOKNFLY</h1>
          <p className="banner bad">{error}</p>
          <p className="muted small">
            If you were sent this link by our office, please tell them it is not opening.
          </p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="sit-page">
        <div className="sit-card">
          <h1>BOOKNFLY</h1>
          <h2>{done.just_finished ? 'Thank you — your test has been sent.' : 'This test is finished.'}</h2>
          {done.auto ? (
            <p className="muted small">The time ran out, so your answers were sent automatically.</p>
          ) : null}
          <p className="muted">
            Our office will be in touch. You do not need to do anything else.
          </p>
        </div>
      </div>
    );
  }

  if (!paper) return <div className="sit-page"><div className="sit-card">Loading…</div></div>;

  /*
   * The start screen.
   *
   * It says what they are about to do BEFORE the clock exists: how many
   * questions, how long, and — when it is one at a time — that there is no
   * going back, which is the thing somebody needs to know in advance rather
   * than discover on question two.
   */
  if (!paper.started) {
    return (
      <div className="sit-page">
        <div className="sit-card">
          <header className="sit-head">
            <div>
              <h1>BOOKNFLY</h1>
              <p className="muted small">
                {paper.paper} · {paper.name}
              </p>
            </div>
          </header>

          <h2 style={{ margin: '0.6rem 0 0.3rem' }}>Before you begin</h2>
          <ul className="sit-rules">
            <li>
              <strong>{paper.question_count} questions</strong> in{' '}
              <strong>{paper.duration_minutes} minutes</strong>.
            </li>
            {paper.one_at_a_time ? (
              <>
                <li>
                  One question at a time. Each gets{' '}
                  <strong>{paper.seconds_per_question} seconds</strong> — when they run out the
                  next one comes up by itself.
                </li>
                <li>
                  <strong>You cannot go back</strong> to a question once it has passed.
                </li>
              </>
            ) : (
              <li>You can change an answer until you send the test.</li>
            )}
            <li>Leaving a question blank costs you nothing extra.</li>
            <li>
              <strong>The clock starts when you press the button below</strong>, so do this when
              you have the time free. Do it in one sitting.
            </li>
          </ul>

          {paper.instructions ? <p className="sit-note">{paper.instructions}</p> : null}
          {error ? <p className="banner bad">{error}</p> : null}

          <footer className="sit-foot">
            <span className="muted small">Nothing has started yet.</span>
            <button className="primary" disabled={sending} onClick={start}>
              {sending ? 'Starting…' : 'Start the test'}
            </button>
          </footer>
        </div>
      </div>
    );
  }

  const answered = Object.keys(answers).length;
  const low = left !== null && left <= 60;

  return (
    <div className="sit-page">
      <div className="sit-card">
        <header className="sit-head">
          <div>
            <h1>BOOKNFLY</h1>
            <p className="muted small">
              {paper.paper} · {paper.name}
            </p>
          </div>
          {/*
            * In one-at-a-time the big number is THIS question's seconds —
            * that is the clock the candidate is racing. The whole-paper time
            * stays underneath, smaller, because it is still what decides
            * whether the paper came back in time.
            */}
          <div className={(one ? qLeft <= 5 : low) ? 'sit-clock low' : 'sit-clock'}>
            {one ? (qLeft === null ? '' : `${qLeft}s`) : left === null ? '' : mmss(left)}
            <span className="muted small">
              {one
                ? `${left === null ? '' : mmss(left)} left in all`
                : `${answered} of ${paper.questions.length} answered`}
            </span>
          </div>
        </header>

        {paper.instructions ? <p className="sit-note">{paper.instructions}</p> : null}

        {one ? (
          /*
            * One question at a time, each with its own clock.
            *
            * Dinesh: *"ek bar me ek question hi dikega / uska time khatm hone
            * k bad turant dusra question aa jeyaga"* — the way his ZYNTA test
            * already works.
            *
            * THERE IS NO GOING BACK, and that is the point rather than an
            * omission: the time for a question is spent once it has run, so
            * an answer changed afterwards would be an answer given in
            * somebody else's thirty seconds.
            */
          <>
            <p className="muted small">
              One question at a time. Each has {paper.seconds_per_question} seconds — when they
              run out the next one comes up by itself, so you cannot go back. Leaving a question
              blank costs you nothing extra.
            </p>

            <div className="sit-progress">
              <span style={{ width: `${((at + 1) / paper.questions.length) * 100}%` }} />
            </div>

            {(() => {
              const q = paper.questions[at];
              if (!q) return null;
              return (
                <div className="sit-q" key={q.id}>
                  <p className="sit-qtext">
                    <strong>{q.n}.</strong> {q.question}
                  </p>
                  <div className="sit-options">
                    {q.options.map((o) => (
                      <button
                        key={o.key}
                        className={answers[q.id] === o.key ? 'sit-option picked' : 'sit-option'}
                        onClick={() => {
                          setAnswers((a) => ({ ...a, [q.id]: o.key }));
                          /* Answering moves straight on, like his does. The
                           * clock for this one is over either way. */
                          next();
                        }}
                      >
                        {o.text}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {error ? <p className="banner bad">{error}</p> : null}

            <footer className="sit-foot">
              <span className="muted small">
                Question {at + 1} of {paper.questions.length}
              </span>
              <button disabled={sending} onClick={next}>
                {at + 1 >= paper.questions.length
                  ? sending
                    ? 'Sending…'
                    : 'Finish'
                  : 'Skip this one'}
              </button>
            </footer>
          </>
        ) : (
          <>
            <p className="muted small">
              Choose one answer for each question. You can change an answer until you send the
              test. Leaving a question blank costs you nothing extra.
            </p>

            {paper.questions.map((q) => (
              <div className="sit-q" key={q.id}>
                <p className="sit-qtext">
                  <strong>{q.n}.</strong> {q.question}
                </p>
                <div className="sit-options">
                  {q.options.map((o) => (
                    <button
                      key={o.key}
                      className={answers[q.id] === o.key ? 'sit-option picked' : 'sit-option'}
                      onClick={() =>
                        setAnswers((a) =>
                          // Tapping the chosen answer again clears it — a candidate
                          // who mis-tapped must be able to go back to "not answered"
                          // rather than being forced into a guess.
                          a[q.id] === o.key
                            ? Object.fromEntries(
                                Object.entries(a).filter(([k]) => k !== String(q.id))
                              )
                            : { ...a, [q.id]: o.key }
                        )
                      }
                    >
                      {o.text}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {error ? <p className="banner bad">{error}</p> : null}

            <footer className="sit-foot">
              <span className="muted small">
                {answered < paper.questions.length
                  ? `${paper.questions.length - answered} still unanswered`
                  : 'All questions answered'}
              </span>
              <button className="primary" disabled={sending} onClick={() => submit(false)}>
                {sending ? 'Sending…' : 'Send my test'}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
