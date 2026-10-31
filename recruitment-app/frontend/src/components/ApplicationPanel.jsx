import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ALL_STAGES, STAGES, aging, matchBand, stageMeta } from '../../../shared/stages.js';
import { waLink } from '../../../shared/messages.js';

/**
 * One person against one job: why they scored what they scored, where they are,
 * and the next move. The move and the message are side by side because they go
 * together - telling somebody is the other half of deciding.
 */
export default function ApplicationPanel({ applicationId, config, onClose, onChanged, onToast, onError }) {
  const [data, setData] = useState(null);
  const [notify, setNotify] = useState(null);
  const [test, setTest] = useState({ score: '', max_score: '', type: 'skills' });
  const [interview, setInterview] = useState({ at: '', mode: 'in-person', location_or_link: '', round: 1 });

  const load = async () => {
    try {
      setData(await api.get(`/applications/${applicationId}`));
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load();
    setNotify(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  const move = async (stage) => {
    try {
      const res = await api.post(`/applications/${applicationId}/stage`, { stage });
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
      await api.post(`/applications/${applicationId}/test`, {
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
      const res = await api.post('/interviews', { ...interview, application_id: applicationId });
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
  const { application, match, interviews, resume } = data;
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
              {application.job_title} · {application.vacancy_ref} · {application.phone}
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

        <div className="card">
          <h3>Record a test</h3>
          {config?.test_configured ? (
            <p className="muted small">
              Your own test system is linked, so a score can also come back on its own. Type one
              in here when the test was taken elsewhere.
            </p>
          ) : (
            <p className="muted small">
              No test system is linked yet (TEST_EMBED_URL). Type the score in by hand.
            </p>
          )}
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
                await api.patch(`/applications/${applicationId}`, { notes: e.target.value });
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
