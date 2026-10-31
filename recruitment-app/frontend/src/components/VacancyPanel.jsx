import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { matchBand } from '../../../shared/stages.js';

const FIELDS = [
  ['title', 'Job title'],
  ['client_company', 'Client company (private)'],
  ['public_company', 'Shown publicly instead'],
  ['industry', 'Industry'],
  ['location', 'Location'],
  ['experience_band', 'Experience wanted'],
  ['education', 'Qualification'],
  ['salary_min', 'Salary from'],
  ['salary_max', 'Salary to'],
  ['skills', 'Skills'],
  ['positions', 'Openings'],
];

/**
 * One vacancy: its details, the share pack (step 2), the people already on the
 * books who fit it, and who has applied.
 */
export default function VacancyPanel({ vacancyId, onClose, onPatch, onOpenApplication, onToast, onError }) {
  const [data, setData] = useState(null);
  const [share, setShare] = useState(null);
  const [suggestions, setSuggestions] = useState(null);
  const [view, setView] = useState('details');

  const load = async () => {
    try {
      const [detail, sharePack] = await Promise.all([
        api.get(`/vacancies/${vacancyId}`),
        api.get(`/vacancies/${vacancyId}/share`),
      ]);
      setData(detail);
      setShare(sharePack);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vacancyId]);

  const loadSuggestions = async () => {
    try {
      const { suggestions: list } = await api.get(`/vacancies/${vacancyId}/suggestions`);
      setSuggestions(list);
    } catch (err) {
      onError(err);
    }
  };

  const patch = async (body) => {
    await onPatch(vacancyId, body);
    load();
  };

  const putForward = async (candidateId) => {
    try {
      await api.post('/applications', { vacancy_id: vacancyId, candidate_id: candidateId });
      onToast('Added to the pipeline');
      setSuggestions((list) => list.filter((s) => s.candidate.id !== candidateId));
      load();
    } catch (err) {
      onError(err);
    }
  };

  if (!data) return null;
  const { vacancy, applications } = data;

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel">
        <header>
          <div>
            <h1>{vacancy.title}</h1>
            <p className="muted small">
              {vacancy.ref_no} · {vacancy.client_company || 'no client named'} ·{' '}
              <span className={`tag ${String(vacancy.status).replace(' ', '-')}`}>{vacancy.status}</span>
            </p>
          </div>
          <button className="close" onClick={onClose}>
            Close
          </button>
        </header>

        <nav className="tabs" style={{ marginBottom: '0.8rem' }}>
          {[
            ['details', 'Details'],
            ['share', 'Share'],
            ['applicants', `Applicants (${applications.length})`],
            ['suggestions', 'On the books'],
          ].map(([key, label]) => (
            <button
              key={key}
              className={view === key ? 'on' : ''}
              onClick={() => {
                setView(key);
                if (key === 'suggestions' && !suggestions) loadSuggestions();
              }}
            >
              {label}
            </button>
          ))}
        </nav>

        {view === 'details' ? (
          <div className="card">
            <div className="grid">
              {FIELDS.map(([key, label]) => (
                <label className="field" key={key}>
                  {label}
                  <input
                    key={`${key}-${vacancy[key] ?? ''}`}
                    defaultValue={vacancy[key] ?? ''}
                    onBlur={(e) => {
                      if (String(e.target.value) !== String(vacancy[key] ?? '')) {
                        patch({ [key]: e.target.value });
                      }
                    }}
                  />
                </label>
              ))}
              <label className="field">
                Status
                <select value={vacancy.status} onChange={(e) => patch({ status: e.target.value })}>
                  {['draft', 'published', 'on hold', 'closed'].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field" style={{ marginTop: '0.7rem' }}>
              About the job
              <textarea
                key={`desc-${vacancy.updated_at}`}
                defaultValue={vacancy.description ?? ''}
                onBlur={(e) => {
                  if (e.target.value !== (vacancy.description ?? '')) patch({ description: e.target.value });
                }}
              />
            </label>
            <p className="muted small">
              Changing the skills, experience or salary re-scores everyone already on this
              vacancy — the old numbers were measured against the old requirement.
            </p>
          </div>
        ) : null}

        {view === 'share' ? (
          <div className="card">
            {!share?.published ? (
              <div className="banner">
                This is not published yet, so the apply link will not work. Publish it on the
                Details tab first.
              </div>
            ) : null}
            {share?.apply_url ? (
              <label className="field">
                Apply link
                <input readOnly value={share.apply_url} onFocus={(e) => e.target.select()} />
              </label>
            ) : (
              <div className="banner">
                PUBLIC_URL is not set on the server, so there is no apply link to share yet.
                The message below still works — candidates reply with their CV.
              </div>
            )}
            <label className="field" style={{ marginTop: '0.7rem' }}>
              The message, ready to send
              <textarea className="copy-box" readOnly value={share?.broadcast || ''} />
            </label>
            <div className="row" style={{ marginTop: '0.6rem' }}>
              <button
                onClick={async () => {
                  await navigator.clipboard?.writeText(share.broadcast);
                  onToast('Copied');
                }}
              >
                Copy
              </button>
              <a
                className="btn"
                target="_blank"
                rel="noreferrer"
                href={`https://wa.me/?text=${encodeURIComponent(share?.broadcast || '')}`}
              >
                Open in WhatsApp
              </a>
              <span className="muted small">
                The client&apos;s name is deliberately not in it.
              </span>
            </div>
          </div>
        ) : null}

        {view === 'applicants' ? (
          <div className="card scroll">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th className="num">Match</th>
                  <th className="num">Test</th>
                  <th>Stage</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((a) => (
                  <tr key={a.id}>
                    <td className="name-cell">
                      <button onClick={() => onOpenApplication(a.id)}>{a.candidate_name}</button>
                      <div className="muted small">{a.phone}</div>
                    </td>
                    <td className={`num band ${matchBand(a.match_score)}`}>{a.match_score}%</td>
                    <td className="num">{a.test_score == null ? '—' : `${a.test_score}%`}</td>
                    <td className="small">{a.stage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!applications.length ? <p className="empty">Nobody has applied yet.</p> : null}
          </div>
        ) : null}

        {view === 'suggestions' ? (
          <div className="card">
            <h3>Already on your books</h3>
            <p className="muted small">
              Ordered by fit. This is a suggestion — nothing joins the pipeline until you say so.
            </p>
            {!suggestions ? (
              <p className="loading">Looking…</p>
            ) : !suggestions.length ? (
              <p className="empty">No other candidates on file.</p>
            ) : (
              <div className="lines">
                {suggestions.map((s) => (
                  <div key={s.candidate.id}>
                    <span className="what">
                      <strong>{s.candidate.name}</strong>
                      <div className="muted small">
                        {[s.candidate.experience, s.candidate.location, s.candidate.skills]
                          .filter(Boolean)
                          .join(' · ') || 'nothing on file'}
                        {s.missing?.length ? ` · missing: ${s.missing.join(', ')}` : ''}
                      </div>
                    </span>
                    <span className={`band ${matchBand(s.match_score)}`}>{s.match_score}%</span>
                    <button className="tiny" onClick={() => putForward(s.candidate.id)}>
                      Put forward
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
