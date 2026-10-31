import { useEffect, useRef, useState } from 'react';
import { api, STANDALONE } from '../api.js';
import { DOCUMENT_KINDS, kindLabel } from '../../../shared/documents.js';

const when = (value) => String(value || '').replace('T', ' ').slice(0, 16);

/**
 * The parts of an employee record that are not fields: the paper on file, who
 * they report to, and what has changed about them over time.
 *
 * All three need the server — a document is a file, and a history is a table.
 * The single-file build says so rather than showing an empty box.
 */
export default function EmployeeRecord({ employee, employees, onPatch, onError }) {
  const [record, setRecord] = useState(null);
  const [kind, setKind] = useState('pan');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const file = useRef(null);

  const load = async () => {
    if (STANDALONE) return;
    try {
      setRecord(await api.get(`/employees/${employee.id}/record`));
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee.id]);

  if (STANDALONE) {
    return (
      <div className="structure">
        <h3 style={{ margin: '0 0 0.4rem' }}>Documents and history</h3>
        <p className="muted small">
          Keeping documents and a change history needs the server version — a PAN card is a
          file, and a file cannot live in this browser. Everything else on this record works
          here as normal.
        </p>
      </div>
    );
  }
  if (!record) return null;

  const upload = async () => {
    const chosen = file.current?.files?.[0];
    if (!chosen) return;
    setBusy('Uploading…');
    try {
      const form = new FormData();
      form.set('document', chosen);
      form.set('kind', kind);
      await api.upload(`/employees/${employee.id}/documents`, form);
      if (file.current) file.current.value = '';
      await load();
    } catch (err) {
      onError(err);
    } finally {
      setBusy('');
    }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    try {
      await api.post(`/employees/${employee.id}/history`, { note });
      setNote('');
      await load();
    } catch (err) {
      onError(err);
    }
  };

  const { documents, document_status: status, history, reports } = record;
  const managers = employees.filter((e) => e.id !== employee.id && e.active);

  return (
    <>
      <div className="structure">
        <h3 style={{ margin: '0 0 0.5rem' }}>Reporting</h3>
        <div className="form-grid">
          <label>
            Reports to
            <select
              value={employee.reports_to_id || ''}
              onChange={(e) => onPatch(employee.id, { reports_to_id: e.target.value || null })}
            >
              <option value="">Nobody</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.designation ? ` — ${m.designation}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        {reports.length ? (
          <p className="small" style={{ marginTop: '0.4rem' }}>
            <strong>{reports.length}</strong> {reports.length === 1 ? 'person reports' : 'people report'} to
            them: {reports.map((r) => r.name).join(', ')}
          </p>
        ) : (
          <p className="muted small">Nobody reports to them.</p>
        )}
      </div>

      <div className="structure">
        <div className="row" style={{ marginBottom: '0.5rem' }}>
          <h3 style={{ margin: 0 }}>Documents and KYC</h3>
          <span className="spacer" />
          <span className="muted small">
            {status.complete
              ? 'everything on file'
              : `${status.missing_kyc.length} still missing`}
          </span>
        </div>

        {documents.length ? (
          <div className="lines">
            {documents.map((doc) => (
              <div key={doc.id}>
                <span className="what">
                  <a href={doc.link?.url} target="_blank" rel="noreferrer">
                    {kindLabel(doc.kind)}
                  </a>
                  <span className="muted small">
                    {' '}
                    — {doc.file_name}
                    {doc.expires_on ? ` · expires ${doc.expires_on}` : ''}
                  </span>
                </span>
                <span className="muted small">{String(doc.uploaded_at).slice(0, 10)}</span>
                <button
                  className="tiny danger"
                  onClick={async () => {
                    if (!window.confirm(`Delete the ${kindLabel(doc.kind)}? The file goes too.`)) return;
                    try {
                      await api.del(`/employees/${employee.id}/documents/${doc.id}`);
                      await load();
                    } catch (err) {
                      onError(err);
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted small">Nothing on file yet.</p>
        )}

        {status.missing_kyc.length ? (
          <p className="muted small" style={{ marginTop: '0.4rem' }}>
            Still wanted: {status.missing_kyc_labels.join(', ')}.
          </p>
        ) : null}
        {status.expired?.length ? (
          <p className="banner bad">
            {status.expired.length} document
            {status.expired.length === 1 ? ' has' : 's have'} passed their expiry date.
          </p>
        ) : null}

        <div className="row" style={{ marginTop: '0.6rem' }}>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {DOCUMENT_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
          <input ref={file} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" />
          <button onClick={upload} disabled={!!busy}>
            {busy || 'Attach'}
          </button>
        </div>
        <p className="muted small">
          Files live on the server, never in this page, and are opened through a link that
          expires. An Aadhaar card is the one document somebody can be impersonated with.
        </p>
      </div>

      <div className="structure">
        <h3 style={{ margin: '0 0 0.5rem' }}>History</h3>
        {history.length ? (
          <ul className="timeline">
            {history.slice(0, 40).map((h) => (
              <li key={h.id}>
                {h.field === 'note' ? (
                  <span>{h.note}</span>
                ) : (
                  <span>
                    <strong>{h.label}</strong>{' '}
                    {h.from_value ? (
                      <>
                        {h.from_value} → <strong>{h.to_value || '—'}</strong>
                      </>
                    ) : (
                      <>set to <strong>{h.to_value || '—'}</strong></>
                    )}
                    {h.note ? <span className="muted"> · {h.note}</span> : null}
                  </span>
                )}
                <div className="muted small">{when(h.changed_at)}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">
            Nothing recorded yet. A salary, designation, department, manager or status change
            writes itself here from now on.
          </p>
        )}

        <div className="row" style={{ marginTop: '0.6rem' }}>
          <input
            value={note}
            placeholder="Add a note — promoted, moved office, warning issued…"
            style={{ flex: 1, minWidth: '14rem' }}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addNote()}
          />
          <button onClick={addNote} disabled={!note.trim()}>
            Add
          </button>
        </div>
      </div>
    </>
  );
}
