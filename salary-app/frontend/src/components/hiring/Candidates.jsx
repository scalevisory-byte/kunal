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

/** Everybody who has ever applied for anything, kept for the next opening. */
export default function Candidates({ candidates, total, query, onQuery, onCreate, onOpen, onOpenCv, onExport, onOpenApplication}) {
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
        {/*
          * The WHOLE ROW opens the candidate, not just the name.
          *
          * The name was a bare <button>, which rendered as plain bold text -
          * so the one way into everything about somebody did not look like a
          * way in, and Dinesh reported the detail view as missing when it had
          * been there all along. Fifth time for that shape of bug in this app.
          */}
        <table className="sheet hiring-table rows-open">
          <thead>
            <tr>
              <th>Ref</th>
              <th className="grow">Name</th>
              <th>Contact</th>
              <th>Experience</th>
              <th>Place</th>
              <th>Expected</th>
              <th>Skills</th>
              <th>Where they are</th>
              <th>CV</th>
              <th>Added</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.id} onClick={() => onOpen(c.id)} title="Open their record">
                <td className="num small muted">{c.ref_no}</td>
                <td className="name-cell">
                  <span className="opens">{c.name}</span>
                  <div className="muted small">{c.role || c.industry || ''}</div>
                </td>
                <td className="small">
                  {c.phone}
                  {c.email ? <div className="muted small">{c.email}</div> : null}
                </td>
                <td className="small">{c.experience || <span className="muted">—</span>}</td>
                <td className="small">
                  {c.location || <span className="muted">—</span>}
                  {c.preferred_location && c.preferred_location !== c.location ? (
                    <div className="muted small">will work in {c.preferred_location}</div>
                  ) : null}
                </td>
                <td className="small">{c.expected_salary || <span className="muted">—</span>}</td>
                <td className="small skills-cell">{c.skills || <span className="muted">—</span>}</td>
                {/*
                  * "Where they are" is the way IN, not a label.
                  *
                  * Tenth time for this shape of bug. Dinesh asked three
                  * separate times how to get a candidate to an interview,
                  * while looking at a column that said exactly where they
                  * were and could not be clicked. Opening the application is
                  * where Move, Screening, the offer and scheduling all live.
                  */}
                <td className="small">
                  {c.applications ? (
                    <>
                      <button
                        className="opens"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenApplication(c.latest_application_id);
                        }}
                        title="Open the application — move them on, screen them, book an interview"
                      >
                        {c.latest_stage || 'applied'}
                      </button>
                      {c.applications > 1 ? (
                        <div className="muted small">{c.applications} applications</div>
                      ) : null}
                    </>
                  ) : (
                    <span className="muted">on the list only</span>
                  )}
                </td>
                {/*
                  * A way to OPEN it, not the word "yes". Clicking it must not
                  * also open the row behind it.
                  */}
                <td className="small">
                  {c.has_cv ? (
                    <button
                      className="link"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenCv(c.id);
                      }}
                    >
                      download
                    </button>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="small muted nowrap">{String(c.created_at || '').slice(0, 10)}</td>
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
