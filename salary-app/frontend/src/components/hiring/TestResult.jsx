import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { answerRows, minutesTaken, sheetSummary } from '../../../../shared/testSheet.js';

/**
 * One test, laid out question by question.
 *
 * Dinesh: *"Test ka result show ho / And uski puri answer sheet bhi show ho"*.
 * A percentage says somebody got 70%; it does not say they got every accounts
 * question right and lost the three English ones, which is what decides
 * whether to call them back.
 *
 * It builds from answerRows(), the same function the printed sheet uses, so
 * the screen and the printout cannot disagree about who answered what.
 *
 * THIS IS THE OFFICE'S SIDE OF THE LINE. It shows the right answers, which is
 * why it is only ever reached from behind the login and never from the
 * candidate's own page.
 */
const WORD = { right: 'right', wrong: 'wrong', skipped: 'not answered' };

export default function TestResult({ attemptId, onClose, onError }) {
  const [data, setData] = useState(null);
  const [only, setOnly] = useState('all');

  useEffect(() => {
    let alive = true;
    api
      .get(`/hiring/attempts/${attemptId}`)
      .then((d) => alive && setData(d))
      .catch(onError);
    return () => {
      alive = false;
    };
  }, [attemptId]);

  if (!data) return null;
  const { attempt, candidate, paper } = data;
  const rows = answerRows(attempt);
  const sum = sheetSummary(attempt);
  const took = minutesTaken(attempt);
  const shown = only === 'all' ? rows : rows.filter((r) => r.verdict === only);

  const download = () => {
    const a = document.createElement('a');
    a.href = `${window.location.origin}/api/hiring/attempts/${attemptId}/sheet/print`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel wide">
        <header>
          <div>
            <h1>{candidate?.name}</h1>
            <p className="muted small">
              {paper?.name}
              {attempt.submitted_at
                ? ` · sat ${String(attempt.submitted_at).replace('T', ' ').slice(0, 16)}`
                : ' · not sat yet'}
            </p>
          </div>
          <button className="close" onClick={onClose}>
            Close
          </button>
        </header>

        {!attempt.submitted_at ? (
          <div className="card">
            <p className="empty">
              They have not sent it yet. The link was given
              {attempt.assigned_at ? ` on ${String(attempt.assigned_at).slice(0, 10)}` : ''} — there
              is nothing to show until they sit it.
            </p>
          </div>
        ) : (
          <>
            <div className="card">
              <div className="figures">
                <div className="figure">
                  <span className="n">{attempt.percentage}%</span>
                  <span className="k">Score</span>
                </div>
                <div className="figure">
                  <span className="n">
                    {attempt.score} / {attempt.max_score}
                  </span>
                  <span className="k">Marks</span>
                </div>
                <div className="figure">
                  <span className="n">{sum.right}</span>
                  <span className="k">Right</span>
                </div>
                <div className="figure">
                  <span className="n">{sum.wrong}</span>
                  <span className="k">Wrong</span>
                </div>
                <div className="figure">
                  <span className="n">{sum.skipped}</span>
                  <span className="k">Not answered</span>
                </div>
                <div className="figure">
                  <span className="n">
                    {took === null
                      ? '—'
                      : `${took}m${attempt.duration_minutes ? ` / ${attempt.duration_minutes}m` : ''}`}
                  </span>
                  <span className="k">Time taken</span>
                </div>
              </div>
              <p className="muted small" style={{ marginTop: '0.5rem' }}>
                {attempt.pass_percent == null
                  ? null
                  : `Pass mark ${attempt.pass_percent}% — they are ${
                      attempt.passed ? 'above it' : 'below it'
                    }. `}
                {attempt.auto_submitted ? 'The time ran out and it sent itself. ' : ''}
                A score is one more thing to weigh. Nothing here moves anybody by itself.
              </p>
            </div>

            {sum.by_category.filter((g) => g.category).length ? (
              <div className="card">
                <h3>By topic</h3>
                <table className="sheet">
                  <thead>
                    <tr>
                      <th>Topic</th>
                      <th className="num">Asked</th>
                      <th className="num">Right</th>
                      <th className="num">Wrong</th>
                      <th className="num">Not answered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sum.by_category
                      .filter((g) => g.category)
                      .map((g) => (
                        <tr key={g.category}>
                          <td>{g.category}</td>
                          <td className="num">{g.asked}</td>
                          <td className="num">{g.right}</td>
                          <td className="num">{g.wrong}</td>
                          <td className="num">{g.skipped || '—'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="card">
              <div className="row" style={{ marginBottom: '0.5rem' }}>
                <h3 style={{ margin: 0 }}>Answer sheet</h3>
                <span className="spacer" />
                <button onClick={download}>Print or save as PDF</button>
              </div>
              <div className="chips" style={{ marginBottom: '0.6rem' }}>
                {[
                  ['all', `Everything (${rows.length})`],
                  ['right', `Right (${sum.right})`],
                  ['wrong', `Wrong (${sum.wrong})`],
                  ['skipped', `Not answered (${sum.skipped})`],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    className={only === key ? 'chip active' : 'chip'}
                    onClick={() => setOnly(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {shown.map((r) => (
                <div key={r.id} className={`ans ans-${r.verdict}`}>
                  <div className="q">
                    <span className="n">{r.n}.</span> {r.question}
                    <span className="tag">{WORD[r.verdict]}</span>
                    {r.category ? <span className="muted small"> · {r.category}</span> : null}
                  </div>
                  {r.options.map((o) => (
                    <div
                      key={o.key}
                      className={`opt${o.correct ? ' is-correct' : ''}${o.chosen ? ' is-chosen' : ''}`}
                    >
                      {o.chosen ? '●' : '○'} {o.text}
                      {o.correct ? <span className="muted"> — the right answer</span> : null}
                    </div>
                  ))}
                </div>
              ))}
              {!shown.length ? <p className="empty">Nothing in this one.</p> : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
