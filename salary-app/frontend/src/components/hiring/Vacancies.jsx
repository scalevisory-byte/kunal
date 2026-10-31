import { useState } from 'react';

const blank = (companyId) => ({
  company_id: companyId || '',
  title: '',
  department: '',
  reports_to: '',
  location: '',
  work_mode: 'On-site',
  employment_type: 'Full-time',
  experience_band: '',
  education: '',
  positions: 1,
  salary_min: '',
  salary_max: '',
  skills: '',
  needed_by: '',
  description: '',
  internal_notes: '',
});

/**
 * The openings our own companies have. Created as a draft and published on
 * purpose, because publishing is what makes the apply link live.
 */
export default function Vacancies({ vacancies, companies, companyId, onCreate, onPatch, onOpen, onDelete }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(blank(companyId));
  const [filter, setFilter] = useState('');

  const shown = vacancies.filter((v) => (filter ? v.status === filter : true));

  const save = async (e) => {
    e.preventDefault();
    if (!draft.title.trim() || !draft.company_id) return;
    await onCreate({
      ...draft,
      company_id: Number(draft.company_id),
      positions: Number(draft.positions) || 1,
    });
    setDraft(blank(companyId));
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
                className={`chip ${filter === key ? 'active' : ''}`}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            )
          )}
        </div>
        <span className="spacer" />
        <button className="primary" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : 'New opening'}
        </button>
      </div>

      {adding ? (
        <form className="card" onSubmit={save}>
          <h2>New opening</h2>
          {!companies.length ? (
            <div className="banner bad">
              There are no companies yet. Add one on the Employees tab first — an opening has to
              belong to a company, or there is nobody to put the person on the payroll of.
            </div>
          ) : null}
          <div className="grid">
            <label className="field">
              Company *
              <select
                value={draft.company_id}
                required
                onChange={(e) => setDraft({ ...draft, company_id: e.target.value })}
              >
                <option value="">Choose…</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Job title *" value={draft.title} required onChange={(v) => setDraft({ ...draft, title: v })} />
            <Field label="Department" value={draft.department} onChange={(v) => setDraft({ ...draft, department: v })} />
            <Field label="Reports to" value={draft.reports_to} onChange={(v) => setDraft({ ...draft, reports_to: v })} />
            <Field label="Location" value={draft.location} onChange={(v) => setDraft({ ...draft, location: v })} />
            <Field
              label="Experience wanted"
              value={draft.experience_band}
              placeholder="1-3 yrs"
              onChange={(v) => setDraft({ ...draft, experience_band: v })}
            />
            <Field label="Qualification" value={draft.education} placeholder="B.Com" onChange={(v) => setDraft({ ...draft, education: v })} />
            <Field label="Salary from" value={draft.salary_min} placeholder="15000" onChange={(v) => setDraft({ ...draft, salary_min: v })} />
            <Field label="Salary to" value={draft.salary_max} placeholder="22000" onChange={(v) => setDraft({ ...draft, salary_max: v })} />
            <Field
              label="Skills (comma separated)"
              value={draft.skills}
              placeholder="Tally, GST, Excel"
              onChange={(v) => setDraft({ ...draft, skills: v })}
            />
            <Field label="Openings" type="number" value={draft.positions} onChange={(v) => setDraft({ ...draft, positions: v })} />
            <Field label="Needed by" type="date" value={draft.needed_by} onChange={(v) => setDraft({ ...draft, needed_by: v })} />
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
            About the job — this is what a candidate reads
            <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </label>
          <label className="field" style={{ marginTop: '0.7rem' }}>
            Office notes — why the seat is open, who it replaces. Never shown outside.
            <textarea
              value={draft.internal_notes}
              onChange={(e) => setDraft({ ...draft, internal_notes: e.target.value })}
            />
          </label>
          <div className="row" style={{ marginTop: '0.7rem' }}>
            <button className="primary" type="submit" disabled={!companies.length}>
              Save as draft
            </button>
            <span className="muted small">It goes out to candidates only once you publish it.</span>
          </div>
        </form>
      ) : null}

      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Ref</th>
              <th>Job</th>
              <th>Company</th>
              <th>Location</th>
              <th className="num">Seats</th>
              <th className="num">Joined</th>
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
                  <div className="muted small">
                    {[v.department, v.experience_band].filter(Boolean).join(' · ') || '—'}
                  </div>
                </td>
                <td className="small">{v.company_name}</td>
                <td className="small">{v.location || '—'}</td>
                <td className="num">{v.positions}</td>
                <td className="num">{v.hired || 0}</td>
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
        {!shown.length ? <p className="empty">No openings here yet.</p> : null}
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
