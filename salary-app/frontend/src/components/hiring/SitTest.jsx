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

export default function SitTest({ token }) {
  const [paper, setPaper] = useState(null);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState({});
  const [left, setLeft] = useState(null);
  const [done, setDone] = useState(null);
  const [sending, setSending] = useState(false);
  /* One at a time: which question is on screen, and its own clock. */
  const [at, setAt] = useState(0);
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
          setLeft(got.seconds_left);
        }
      })
      .catch((err) => setError(err.message || 'This test link does not work.'));
  }, [token]);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

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
    } catch (err) {
      sent.current = false;
      setError(err.message || 'That did not send. Try again.');
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
