import { useState } from 'react';

const BLANK = {
  title: '',
  client_company: '',
  public_company: '',
  industry: '',
  category: '',
  location: '',
  work_mode: 'On-site',
  employment_type: 'Full-time',
  experience_band: '',
  education: '',
  gender_pref: 'Any',
  positions: 1,
  salary_min: '',
  salary_max: '',
  skills: '',
  description: '',
  responsibilities: '',
  requirements: '',
  benefits: '',
};

/**
 * Step 1 of the flow. A vacancy is created as a draft and published on
 * purpose, because publishing is what makes the apply link live.
 */
export default function Vacancies({ vacancies, onCreate, onPatch, onOpen, onDelete }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const [filter, setFilter] = useState('');

  const shown = vacancies.filter((v) =>
    filter ? v.status === filter : true
  );

  const save = async (e) => {
    e.preventDefault();
    if (!draft.title.trim()) return;
    await onCreate({ ...draft, positions: Number(draft.positions) || 1 });
    setDraft(BLANK);
    setAdding(false);
  };

  return (
    <>
      <div className="row" style={{ marginBottom: '0.8rem' }}>
        <div className="chips">
          {[['', 'All'], ['draft', 'Drafts'], ['published', 'Open'], ['on hold', 'On hold'], ['closed', 'Closed']].map(
            ([key, label]) => (
              <button
                key={key || 'all'}
                className={`chip ${filter === key ? 'on' : ''}`}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            )
          )}
        </div>
        <span className="spacer" />
        <button className="primary" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : 'New vacancy'}
        </button>
      </div>

      {adding ? (
        <form className="card" onSubmit={save}>
          <h2>New vacancy</h2>
          <div className="grid">
            <Field label="Job title" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} required />
            <Field
              label="Client company (never shown publicly)"
              value={draft.client_company}
              onChange={(v) => setDraft({ ...draft, client_company: v })}
            />
            <Field
              label="Shown publicly instead"
              value={draft.public_company}
              placeholder="A textile manufacturer"
              onChange={(v) => setDraft({ ...draft, public_company: v })}
            />
            <Field label="Industry" value={draft.industry} onChange={(v) => setDraft({ ...draft, industry: v })} />
            <Field label="Location" value={draft.location} onChange={(v) => setDraft({ ...draft, location: v })} />
            <Field
              label="Experience wanted"
              value={draft.experience_band}
              placeholder="1-3 yrs"
              onChange={(v) => setDraft({ ...draft, experience_band: v })}
            />
            <Field
              label="Qualification"
              value={draft.education}
              placeholder="B.Com"
              onChange={(v) => setDraft({ ...draft, education: v })}
            />
            <Field
              label="Salary from"
              value={draft.salary_min}
              placeholder="15000"
              onChange={(v) => setDraft({ ...draft, salary_min: v })}
            />
            <Field
              label="Salary to"
              value={draft.salary_max}
              placeholder="22000"
              onChange={(v) => setDraft({ ...draft, salary_max: v })}
            />
            <Field
              label="Skills (comma separated)"
              value={draft.skills}
              placeholder="Tally, GST, Excel"
              onChange={(v) => setDraft({ ...draft, skills: v })}
            />
            <Field
              label="Openings"
              type="number"
              value={draft.positions}
              onChange={(v) => setDraft({ ...draft, positions: v })}
            />
            <Select
              label="Type"
              value={draft.employment_type}
              options={['Full-time', 'Part-time', 'Contract', 'Internship']}
              onChange={(v) => setDraft({ ...draft, employment_type: v })}
            />
            <Select
              label="Mode"
              value={draft.work_mode}
              options={['On-site', 'Hybrid', 'Remote']}
              onChange={(v) => setDraft({ ...draft, work_mode: v })}
            />
          </div>
          <label className="field" style={{ marginTop: '0.7rem' }}>
            About the job (this is what a candidate reads)
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>
          <div className="row" style={{ marginTop: '0.7rem' }}>
            <button className="primary" type="submit">
              Save as draft
            </button>
            <span className="muted small">
              It goes out to candidates only once you publish it.
            </span>
          </div>
        </form>
      ) : null}

      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Ref</th>
              <th>Job</th>
              <th>Client</th>
              <th>Location</th>
              <th className="num">Open</th>
              <th className="num">Applied</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((v) => (
              <tr key={v.id}>
                <td className="num small muted">{v.ref_no}</td>
                <td className="name-cell">
                  <button onClick={() => onOpen(v.id)}>{v.title}</button>
                  <div className="muted small">{v.experience_band || '—'}</div>
                </td>
                <td className="small">{v.client_company || '—'}</td>
                <td className="small">{v.location || '—'}</td>
                <td className="num">{v.positions}</td>
                <td className="num">{v.applications ?? 0}</td>
                <td>
                  <span className={`tag ${String(v.status).replace(' ', '-')}`}>{v.status}</span>
                </td>
                <td className="right">
                  {v.status === 'published' ? (
                    <button className="tiny" onClick={() => onPatch(v.id, { status: 'closed' })}>
                      Close
                    </button>
                  ) : (
                    <button className="tiny primary" onClick={() => onPatch(v.id, { status: 'published' })}>
                      Publish
                    </button>
                  )}{' '}
                  <button
                    className="tiny danger"
                    onClick={() => {
                      if (window.confirm(`Delete ${v.title}? Its applications go with it.`)) onDelete(v.id);
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length ? <p className="empty">No vacancies here yet.</p> : null}
      </div>
    </>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder, required }) {
  return (
    <label className="field">
      {label}
      <input
        type={type}
        value={value ?? ''}
        placeholder={placeholder}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Select({ label, value, options, onChange }) {
  return (
    <label className="field">
      {label}
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
