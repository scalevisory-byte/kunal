import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
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
  const file = useRef(null);

  const load = async () => {
    try {
      setData(await api.get(`/hiring/candidates/${candidateId}`));
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId]);

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
          <div className="row" style={{ marginTop: '0.5rem' }}>
            <input
              ref={file}
              type="file"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              onChange={(e) => upload(e.target.files?.[0])}
            />
          </div>
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
                    <button className="link" onClick={() => onOpenApplication(a.id)}>
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
        </div>

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
