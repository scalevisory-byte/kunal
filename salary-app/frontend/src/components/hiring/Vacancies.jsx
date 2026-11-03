import { useEffect, useState } from 'react';
import VacancyForm from './VacancyForm.jsx';

/**
 * The openings our own companies have. Created as a draft and published on
 * purpose, because publishing is what makes the apply link live.
 */
export default function Vacancies({
  vacancies, companies, companyId, onCreate, onPatch, onOpen, onDelete, askNew = 0,
}) {
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');

  /*
   * "+ New vacancy" from the tab bar lands here. A counter rather than a flag:
   * pressing it again after closing the form has to open it again, and a
   * boolean that is already true changes nothing. Zero is the first render,
   * where the form stays shut.
   */
  useEffect(() => {
    if (askNew) setAdding(true);
  }, [askNew]);

  const shown = vacancies.filter((v) => (filter ? v.status === filter : true));

  /*
   * One call, two buttons. The form says which it was; a draft is simply a
   * vacancy whose status nobody has moved yet, which is what it has always
   * been - publishing is still the thing that makes the apply link live.
   */
  const save = async (body, { publish }) => {
    setSaving(true);
    try {
      await onCreate({ ...body, status: publish ? 'published' : 'draft' });
      setAdding(false);
    } finally {
      setSaving(false);
    }
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
        {/* While the form is open it owns the buttons - a second Cancel above
            it, in navy, competing with Publish, is one button too many. */}
        {adding ? null : (
          <button className="primary" onClick={() => setAdding(true)}>
            + New vacancy
          </button>
        )}
      </div>

      {adding ? (
        <VacancyForm
          companies={companies}
          companyId={companyId}
          onSave={save}
          onCancel={() => setAdding(false)}
          busy={saving}
        />
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
        {!shown.length ? <p className="empty">No vacancies here yet.</p> : null}
      </div>
    </>
  );
}


