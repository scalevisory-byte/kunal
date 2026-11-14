import { useEffect, useRef, useState } from 'react';
import { STANDALONE, api } from '../../api.js';
import { matchBand } from '../../../../shared/stages.js';
import { resumeRequest, waLink } from '../../../../shared/hiringMessages.js';

const FIELDS = [
  ['name', 'Name'],
  ['phone', 'Mobile'],
  ['email', 'Email'],
  ['location', 'Lives in'],
  ['preferred_location', 'Will work in'],
  ['education', 'Qualification'],
  ['experience', 'Experience'],
  ['role', 'Role'],
  ['current_company', 'Current company'],
  ['current_salary', 'Current salary'],
  ['expected_salary', 'Expected salary'],
  ['notice_period', 'Notice period'],
  ['skills', 'Skills'],
  ['industry', 'Industry'],
  ['referred_by', 'Referred by'],
];

export default function CandidatePanel({ candidateId, config, onClose, onChanged, onOpenApplication, onToast, onError }) {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [openings, setOpenings] = useState([]);
  const [picked, setPicked] = useState('');
  const [sending, setSending] = useState(false);
  const file = useRef(null);

  const load = async () => {
    try {
      setData(await api.get(`/hiring/candidates/${candidateId}`));
      if (!STANDALONE) {
        const { history: rows } = await api.get(`/hiring/candidates/${candidateId}/interviews`);
        setHistory(rows || []);
      }
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId]);

  /*
   * The openings somebody could be put forward for.
   *
   * A CLOSED one is left out - putting somebody on a seat that is already
   * filled is never what was meant. A draft is offered, because an opening
   * often exists before anybody gets round to publishing it, and its status
   * is shown so nobody thinks the advert is live.
   */
  useEffect(() => {
    if (STANDALONE) return;
    api
      .get('/hiring/vacancies')
      .then(({ vacancies }) => setOpenings((vacancies || []).filter((v) => v.status !== 'closed')))
      .catch(() => setOpenings([]));
  }, []);

  const putForward = async () => {
    if (!picked) return;
    setSending(true);
    try {
      // The route answers { application, created } - `created` is false when
      // they were already on this opening, which the filter above should make
      // impossible, but a stale list is a stale list.
      const { application, created } = await api.post('/hiring/applications', {
        vacancy_id: Number(picked),
        candidate_id: candidateId,
      });
      setPicked('');
      await load();
      onChanged?.();
      onToast(created ? 'Put forward - shortlist or interview from here' : 'Already on that opening');
      onOpenApplication?.(application.id);
    } catch (err) {
      onError(err);
    } finally {
      setSending(false);
    }
  };

  const patch = async (body) => {
    try {
      await api.patch(`/hiring/candidates/${candidateId}`, body);
      await load();
      onChanged?.();
    } catch (err) {
      onError(err);
    }
  };

  const upload = async (chosen) => {
    if (!chosen) return;
    const form = new FormData();
    form.set('resume', chosen);
    try {
      await api.upload(`/hiring/candidates/${candidateId}/resume`, form);
      onToast('CV attached');
      await load();
      onChanged?.();
    } catch (err) {
      onError(err);
    }
  };

  if (!data) return null;
  const { candidate, applications, tests, resume } = data;
  const alreadyOn = new Set(applications.map((a) => a.vacancy_id));
  const spare = openings.filter((v) => !alreadyOn.has(v.id));
  const chase = resumeRequest({
    candidate,
    vacancy: applications[0]
      ? {
          title: applications[0].job_title,
          ref_no: applications[0].vacancy_ref,
          company_name: applications[0].company_name,
        }
      : null,
    baseUrl: config?.public_url,
  });

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel">
        <header>
          <div>
            <h1>{candidate.name}</h1>
            <p className="muted small">
              {candidate.ref_no} · {candidate.phone}
              {candidate.email ? ` · ${candidate.email}` : ''} · added{' '}
              {String(candidate.created_at).slice(0, 10)}
            </p>
          </div>
          <button className="close" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="card">
          <h3>CV</h3>
          {resume ? (
            <div className="row">
              <a className="btn" href={resume.url} target="_blank" rel="noreferrer">
                Open {resume.filename}
              </a>
              <span className="muted small">
                The link expires in a few minutes — reopen this panel for a fresh one.
              </span>
            </div>
          ) : (
            <div className="row">
              <span className="muted small">Nothing on file.</span>
              <a
                className="btn"
                target="_blank"
                rel="noreferrer"
                href={waLink(candidate.phone, chase) || '#'}
              >
                Ask for it on WhatsApp
              </a>
            </div>
          )}
          {/*
            * A file picker that cannot keep the file is worse than none: it
            * takes the CV, appears to work, and loses it. So offline it says
            * so instead, and the WhatsApp chase above still works.
            */}
          {STANDALONE ? (
            <p className="muted small" style={{ marginTop: '0.5rem' }}>
              Keeping a CV needs the server version — a file cannot live inside this
              single HTML file. Ask for it on WhatsApp and keep it in a folder for now.
            </p>
          ) : (
            <div className="row" style={{ marginTop: '0.5rem' }}>
              <input
                ref={file}
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                onChange={(e) => upload(e.target.files?.[0])}
              />
            </div>
          )}
        </div>

        <div className="card">
          <h3>Details</h3>
          <div className="grid">
            {FIELDS.map(([key, label]) => (
              <label className="field" key={key}>
                {label}
                <input
                  key={`${key}-${candidate[key] ?? ''}`}
                  defaultValue={candidate[key] ?? ''}
                  onBlur={(e) => {
                    if (String(e.target.value) !== String(candidate[key] ?? '')) {
                      patch({ [key]: e.target.value });
                    }
                  }}
                />
              </label>
            ))}
          </div>
          <label className="field" style={{ marginTop: '0.7rem' }}>
            Notes
            <textarea
              key={`notes-${candidate.updated_at}`}
              defaultValue={candidate.notes ?? ''}
              onBlur={(e) => {
                if (e.target.value !== (candidate.notes ?? '')) patch({ notes: e.target.value });
              }}
            />
          </label>
        </div>

        <div className="card">
          <h3>Put forward for</h3>
          {applications.length ? (
            <div className="lines">
              {applications.map((a) => (
                <div key={a.id}>
                  <span className="what">
                    {/*
                      * `link` renders as plain text here, which is the same
                      * bug the candidate's own name had: the one way into the
                      * application did not look like a way in. `opens` is the
                      * class that says "this is a door".
                      */}
                    <button className="opens" onClick={() => onOpenApplication(a.id)}>
                      {a.job_title}
                    </button>
                    <span className="muted small"> · {a.company_name}</span>
                  </span>
                  <span className={`band ${matchBand(a.match_score)}`}>{a.match_score}%</span>
                  <span className="small">{a.stage}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small">Not on any vacancy yet.</p>
          )}

          {/*
            * The way in.
            *
            * This card used to only LIST the openings somebody was already on,
            * so from the candidate list - where anybody looking at a person is
            * actually standing - there was no way to put them forward at all.
            * The only route was Vacancies, open the opening, "On file". That is
            * a feature nobody can find.
            *
            * Openings the candidate is already on are left out: the vacancy and
            * candidate pair is unique, so offering it again can only produce an
            * error message.
            */}
          {!STANDALONE ? (
            spare.length ? (
              <div className="put-forward">
                <select value={picked} onChange={(e) => setPicked(e.target.value)}>
                  <option value="">Put forward for an opening…</option>
                  {spare.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.ref_no} · {v.title} · {v.company_name}
                      {v.status === 'published' ? '' : ` (${v.status})`}
                    </option>
                  ))}
                </select>
                <button className="primary" disabled={!picked || sending} onClick={putForward}>
                  {sending ? 'Adding…' : 'Put forward'}
                </button>
              </div>
            ) : (
              <p className="muted small">
                {openings.length
                  ? 'Already on every open vacancy.'
                  : 'No open vacancy to put them forward for - make one on the Vacancies tab.'}
              </p>
            )
          ) : null}
        </div>

        {/*
          * Every round they have sat, newest first.
          *
          * One row per interview carrying BOTH records, because each round has
          * its own form and its own evaluation and neither is ever merged into
          * the next. A round nobody has written up yet says so rather than
          * showing the previous round's verdict.
          */}
        {history.length ? (
          <div className="card">
            <h3>Interview history</h3>
            <div className="lines">
              {history.map((h) => (
                <div key={h.interview_id}>
                  <span className="what">
                    <strong>
                      {h.round_name ? `Round ${h.round} — ${h.round_name}` : `Round ${h.round}`}
                    </strong>
                    <span className="muted small">
                      {' '}· {String(h.at).replace('T', ' ').slice(0, 16)}
                      {h.interviewer ? ` · ${h.interviewer}` : ''} · {h.job_title}
                    </span>
                    <div className="muted small">
                      {h.form_id
                        ? `Form: ${h.decision || 'no decision yet'}${
                            h.rejection_reason ? ` — ${h.rejection_reason}` : ''
                          }`
                        : 'Form: not filled in'}
                      {' · '}
                      {h.evaluation_id
                        ? `Evaluation: ${h.recommendation || 'no recommendation yet'}${
                            h.summary.average !== null ? ` (avg ${h.summary.average})` : ''
                          } — ${h.evaluation_status}`
                        : 'Evaluation: none'}
                      {h.approved_by ? ` · decided by ${h.approved_by}` : ''}
                    </div>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {tests.length ? (
          <div className="card">
            <h3>Tests</h3>
            <div className="lines">
              {tests.map((t) => (
                <div key={t.id}>
                  <span className="what">
                    {t.type}
                    <span className="muted small"> · {String(t.taken_at).slice(0, 10)}</span>
                  </span>
                  <span className="num">{t.percentage}%</span>
                  <span className={`small ${t.passed ? 'age fresh' : 'muted'}`}>
                    {t.passed ? 'passed' : 'below threshold'}
                  </span>
                </div>
              ))}
            </div>
            <p className="muted small" style={{ marginTop: '0.5rem' }}>
              A score is one more thing to weigh. Nothing here moves anybody by itself.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
