import { QuickVerdict } from './Screening.jsx';
import { useState } from 'react';
import { api } from '../../api.js';

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
/*
 * The stages a candidate can be at. Taken from the pipeline so the filter and
 * the board cannot come to mean different things by "Selected".
 */
const STAGES = ['Applied', 'Shortlisted', 'Interview', 'Selected', 'Offered', 'Joined', 'Rejected'];

export default function Candidates({
  candidates, total, query, onQuery, stage, onStage, archived, onArchived,
  onCreate, onOpen, onOpenCv, onExport, onOpenApplication, onReload, onError, onToast,
}) {
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
        <select value={stage} onChange={(e) => onStage(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Wherever they are</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {/*
          * The archive is a PLACE, and the button says which one you are
          * standing in. A tick labelled "include archived" would mix
          * somebody hired last year into this week's hiring, which is the
          * thing archiving them was for.
          */}
        <button className={archived ? 'primary' : ''} onClick={() => onArchived(!archived)}>
          {archived ? '← Back to the list' : 'Archive'}
        </button>
        <span className="muted small">
          {candidates.length} of {total} shown
          {archived ? ' · archived' : ''}
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
              <th>Screening</th>
              <th>CV</th>
              <th>Added</th>
              <th />
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
                {/*
                  * The verdict, on the row. Dinesh asked for these buttons
                  * "front me bhi" - on the list, without opening anybody.
                  */}
                <td className="small" onClick={(e) => e.stopPropagation()}>
                  {c.latest_application_id ? (
                    <QuickVerdict
                      applicationId={c.latest_application_id}
                      screening={c.screening_verdict ? { verdict: c.screening_verdict } : null}
                      onSaved={onReload}
                      onError={onError}
                      onToast={onToast}
                    />
                  ) : (
                    <span className="muted">not on an opening</span>
                  )}
                </td>
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
                {/*
                  * Where the hiring ENDS, on the row somebody is already
                  * looking at. "Add to payroll" lived only on the pipeline
                  * card, which is a different screen reached a different
                  * way - the fifth time a feature has been reported missing
                  * because the only way in was somewhere nobody stands.
                  */}
                <td className="small nowrap" onClick={(e) => e.stopPropagation()}>
                  {archived ? (
                    <button
                      className="tiny"
                      onClick={async () => {
                        try {
                          await api.del(`/hiring/candidates/${c.id}/archive`);
                          onToast('Back on the list.');
                          onReload();
                        } catch (err) {
                          onError(err);
                        }
                      }}
                    >
                      Restore
                    </button>
                  ) : (
                    <>
                      {c.latest_application_id && c.latest_stage !== 'Joined' ? (
                        <button
                          className="tiny primary"
                          title="Put them on the salary sheet — and take them off this list"
                          onClick={() => onOpenApplication(c.latest_application_id)}
                        >
                          Add to payroll
                        </button>
                      ) : null}
                      <button
                        className="tiny"
                        onClick={async () => {
                          if (
                            !window.confirm(
                              `Archive ${c.name}? Nothing is deleted — their whole file stays, ` +
                                'and Restore brings them back in one press.'
                            )
                          )
                            return;
                          try {
                            await api.post(`/hiring/candidates/${c.id}/archive`, {});
                            onToast('Archived.');
                            onReload();
                          } catch (err) {
                            onError(err);
                          }
                        }}
                      >
                        Archive
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!candidates.length ? (
          <p className="empty">
            {archived
              ? 'Nothing archived. People land here when they are put on the payroll, or when somebody archives them by hand.'
              : stage || query
                ? 'Nobody matches that.'
                : 'Nobody yet. Candidates arrive on their own once a vacancy is published and the link is shared — or add one by hand.'}
          </p>
        ) : null}
      </div>
    </>
  );
}
