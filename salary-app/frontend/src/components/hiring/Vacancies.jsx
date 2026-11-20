import { useEffect, useState } from 'react';
import { col, num, printReport } from '../../printReport.js';
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

  /**
   * WHAT IS OPEN, AND HOW IT IS GOING.
   *
   * Openings against people hired, and applications against both — the
   * three figures somebody actually asks about. It prints the chip you are
   * standing on, because "All" and "Open" are different documents.
   *
   * A draft is a vacancy nobody has published: the apply link is not live
   * and nothing can come in against it. That is on the paper, because a
   * printed list of openings reads as a list of live ones.
   */
  const printIt = () => {
    const names = [...new Set(shown.map((v) => v.company_name).filter(Boolean))];
    const sum = (pick) => shown.reduce((t, v) => t + (Number(pick(v)) || 0), 0);
    printReport({
      title: 'Vacancies',
      subtitle: [
        names.length === 1 ? names[0] : 'All companies',
        { draft: 'drafts', published: 'open', 'on hold': 'on hold', closed: 'closed' }[filter] || 'every vacancy',
      ].join(' · '),
      meta: [
        `${shown.length} ${shown.length === 1 ? 'vacancy' : 'vacancies'}`,
        `${sum((v) => v.positions)} openings · ${sum((v) => v.hired)} hired · ${sum((v) => v.applications)} applications`,
      ],
      landscape: true,
      columns: [
        col('#', (_v, i) => i + 1, '3%'),
        col('Ref', (v) => v.ref_no || ''),
        col('Title', (v) => v.title || ''),
        col('Company', (v) => v.company_name || ''),
        col('Department', (v) => v.department || ''),
        col('Where', (v) => v.location || ''),
        col('Experience', (v) => v.experience_band || ''),
        num('Openings', (v) => v.positions ?? ''),
        num('Hired', (v) => v.hired ?? 0),
        num('Applications', (v) => v.applications ?? 0),
        /*
         * "Open", not "published" - the chip above the list says Open and the
         * paper has to use the office's word for it. The rest are capitalised
         * rather than left as the stored key.
         */
        col('Status', (v) => ({ published: 'Open', draft: 'Draft', 'on hold': 'On hold', closed: 'Closed' }[v.status] || v.status || '')),
      ],
      rows: shown,
      totals: {
        label: `Total (${shown.length})`,
        Openings: sum((v) => v.positions),
        Hired: sum((v) => v.hired),
        Applications: sum((v) => v.applications),
      },
      footer:
        'A draft is not an opening anybody can apply to: its apply link is not live until it is published. “Hired” counts the people actually taken on against that opening, not the ones offered.',
    });
  };

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
        <button onClick={printIt} disabled={!shown.length}>
          Print {shown.length}
        </button>
        <span className="spacer" />
        {/*
          * No "+ New vacancy" here.
          *
          * The tab bar carries one on EVERY screen of this tab, so on this
          * screen there were two of them, a few centimetres apart, in the same
          * navy. Two buttons that do one thing read as two different things.
          */}
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
        <table className="sheet hiring-table">
          <thead>
            <tr>
              <th>Ref</th>
              <th className="grow">Job</th>
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


