import { useEffect, useState } from 'react';
import { api } from '../../api.js';

const today = () => new Date().toISOString().slice(0, 10);

const KIND_LABEL = { warning: 'Warning', appreciation: 'Appreciation', note: 'Note' };

/**
 * Warnings and appreciations, on one list.
 *
 * They are the same record with opposite signs, and a person's file should read
 * in one order whichever kind it is - a page of warnings with the good work on
 * another tab is not a record of anybody.
 *
 * A warning carries how formal it was (verbal, written, final) and when it was
 * acknowledged, because a warning the person never saw is not much of a warning.
 */
export default function Records({ employees, onError }) {
  const [notes, setNotes] = useState([]);
  const [kind, setKind] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    employee_id: '',
    kind: 'warning',
    severity: 'verbal',
    dated: today(),
    subject: '',
    detail: '',
    issued_by: '',
  });

  const load = async (filter = kind) => {
    try {
      const { notes: list } = await api.get(`/people/notes${filter ? `?kind=${filter}` : ''}`);
      setNotes(list);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load(kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const save = async () => {
    if (!draft.employee_id || !draft.subject.trim()) return;
    try {
      await api.post('/people/notes', draft);
      setDraft({ ...draft, subject: '', detail: '' });
      setAdding(false);
      load();
    } catch (err) {
      onError(err);
    }
  };

  const acknowledge = async (note) => {
    try {
      await api.patch(`/people/notes/${note.id}`, { acknowledged_on: today() });
      load();
    } catch (err) {
      onError(err);
    }
  };

  const remove = async (note) => {
    if (!window.confirm(`Remove this ${KIND_LABEL[note.kind].toLowerCase()} for ${note.employee_name}?`)) return;
    try {
      await api.del(`/people/notes/${note.id}`);
      load();
    } catch (err) {
      onError(err);
    }
  };

  return (
    <section className="stack">
      <div className="toolbar">
        <div className="sub-tabs toolbar">
          {[['', 'Everything'], ['warning', 'Warnings'], ['appreciation', 'Appreciations'], ['note', 'Notes']].map(
            ([value, label]) => (
              <button key={value} className={kind === value ? 'active' : undefined} onClick={() => setKind(value)}>
                {label}
              </button>
            )
          )}
        </div>
        <button className="ghost" onClick={() => setAdding(!adding)}>
          {adding ? 'Cancel' : 'Put something on the record'}
        </button>
      </div>

      {adding && (
        <div className="card">
          <div className="form-grid">
            <label>
              Who
              <select
                value={draft.employee_id}
                onChange={(e) => setDraft({ ...draft, employee_id: e.target.value })}
              >
                <option value="">Pick somebody</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.company_name ? ` — ${e.company_name}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              What kind
              <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                <option value="warning">Warning</option>
                <option value="appreciation">Appreciation</option>
                <option value="note">Note</option>
              </select>
            </label>
            {draft.kind === 'warning' && (
              <label>
                How formal
                <select value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value })}>
                  <option value="verbal">Verbal</option>
                  <option value="written">Written</option>
                  <option value="final">Final</option>
                </select>
              </label>
            )}
            <label>
              Dated
              <input type="date" value={draft.dated} onChange={(e) => setDraft({ ...draft, dated: e.target.value })} />
            </label>
            <label>
              Issued by
              <input
                type="text"
                value={draft.issued_by}
                placeholder="who gave it"
                onChange={(e) => setDraft({ ...draft, issued_by: e.target.value })}
              />
            </label>
          </div>
          <label className="block">
            In a line
            <input
              type="text"
              value={draft.subject}
              placeholder={draft.kind === 'warning' ? 'Late on eleven days in July' : 'Closed the Surat audit a week early'}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            />
          </label>
          <label className="block">
            Anything more
            <textarea
              rows="3"
              value={draft.detail}
              onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
            />
          </label>
          <button onClick={save} disabled={!draft.employee_id || !draft.subject.trim()}>
            Put it on the record
          </button>
        </div>
      )}

      {!notes.length ? (
        <p className="muted small">Nothing on the record yet.</p>
      ) : (
        <table className="sheet">
          <thead>
            <tr>
              <th>Dated</th>
              <th>Who</th>
              <th>What</th>
              <th>Said</th>
              <th>By</th>
              <th>Seen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {notes.map((note) => (
              <tr key={note.id}>
                <td>{note.dated}</td>
                <td className="sticky-name">{note.employee_name}</td>
                <td>
                  <span className={`pill ${note.kind}`}>
                    {KIND_LABEL[note.kind]}
                    {note.severity ? ` · ${note.severity}` : ''}
                  </span>
                </td>
                <td>
                  {note.subject}
                  {note.detail && <div className="muted small">{note.detail}</div>}
                </td>
                <td className="muted small">{note.issued_by || '—'}</td>
                <td>
                  {note.acknowledged_on ? (
                    <span className="muted small">{note.acknowledged_on}</span>
                  ) : note.kind === 'warning' ? (
                    <button className="ghost small" onClick={() => acknowledge(note)}>
                      mark seen
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  <button className="ghost small" onClick={() => remove(note)}>
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
