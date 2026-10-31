import { useState } from 'react';

const BLANK = {
  name: '',
  phone: '',
  email: '',
  location: '',
  preferred_location: '',
  education: '',
  experience: '',
  current_company: '',
  current_salary: '',
  expected_salary: '',
  notice_period: '',
  role: '',
  skills: '',
  industry: '',
  referred_by: '',
};

/** The agency's real asset: everybody it has ever spoken to. */
export default function Candidates({ candidates, total, query, onQuery, onCreate, onOpen, onExport }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const [error, setError] = useState('');

  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await onCreate(draft);
      setDraft(BLANK);
      setAdding(false);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <div className="row" style={{ marginBottom: '0.8rem' }}>
        <input
          value={query}
          placeholder="Search name, number, skill, place…"
          style={{ minWidth: '16rem' }}
          onChange={(e) => onQuery(e.target.value)}
        />
        <span className="muted small">
          {candidates.length} of {total} shown
        </span>
        <span className="spacer" />
        <button onClick={onExport}>Export CSV</button>
        <button className="primary" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : 'Add candidate'}
        </button>
      </div>

      {adding ? (
        <form className="card" onSubmit={save}>
          <h2>Add a candidate</h2>
          {error ? <div className="banner bad">{error}</div> : null}
          <div className="grid">
            {[
              ['name', 'Name'],
              ['phone', 'Mobile'],
              ['email', 'Email'],
              ['location', 'Lives in'],
              ['preferred_location', 'Will work in'],
              ['education', 'Qualification'],
              ['experience', 'Experience'],
              ['role', 'Last / wanted role'],
              ['current_company', 'Current company'],
              ['current_salary', 'Current salary'],
              ['expected_salary', 'Expected salary'],
              ['notice_period', 'Notice period'],
              ['skills', 'Skills'],
              ['industry', 'Industry'],
              ['referred_by', 'Referred by'],
            ].map(([key, label]) => (
              <label className="field" key={key}>
                {label}
                <input
                  value={draft[key]}
                  required={key === 'name' || key === 'phone'}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <div className="row" style={{ marginTop: '0.7rem' }}>
            <button className="primary" type="submit">
              Save
            </button>
            <span className="muted small">
              The mobile number is the identity — the same number is always the same person.
            </span>
          </div>
        </form>
      ) : null}

      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Ref</th>
              <th>Name</th>
              <th>Mobile</th>
              <th>Experience</th>
              <th>Place</th>
              <th>Skills</th>
              <th className="num">Applied</th>
              <th>CV</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.id}>
                <td className="num small muted">{c.ref_no}</td>
                <td className="name-cell">
                  <button onClick={() => onOpen(c.id)}>{c.name}</button>
                  <div className="muted small">{c.role || c.industry || ''}</div>
                </td>
                <td className="num small">{c.phone}</td>
                <td className="small">{c.experience || '—'}</td>
                <td className="small">{c.location || '—'}</td>
                <td className="small" style={{ maxWidth: '14rem' }}>
                  {c.skills || '—'}
                </td>
                <td className="num">{c.applications ?? 0}</td>
                <td className="small">{c.resume_path ? 'yes' : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!candidates.length ? (
          <p className="empty">
            Nobody yet. Candidates arrive on their own once a vacancy is published and the link
            is shared — or add one by hand.
          </p>
        ) : null}
      </div>
    </>
  );
}
