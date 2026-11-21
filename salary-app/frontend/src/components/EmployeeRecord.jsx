import { useEffect, useRef, useState } from 'react';
import { api, STANDALONE } from '../api.js';
import { DOCUMENT_KINDS, kindLabel } from '../../../shared/documents.js';

const when = (value) => String(value || '').replace('T', ' ').slice(0, 16);

/**
 * Who somebody reports to.
 *
 * Its own piece, and deliberately NOT behind the server: a manager is a link
 * between two rows already in memory, unlike a document (a file) or a history
 * (a table). It used to sit inside the block below and so vanished from the
 * single-file build, which could draw the chart and bulk-set the line but gave
 * no way to set one person's.
 *
 * The direct reports are counted from the list itself rather than fetched, so
 * what this says and what the chart draws come from the same place.
 */
export function Reporting({ employee, employees, onPatch }) {
  const managers = employees.filter((e) => e.id !== employee.id && e.active);
  const reports = employees.filter((e) => e.reports_to_id === employee.id);
  return (
    <div className="structure">
      <h3 style={{ margin: '0 0 0.5rem' }}>Reporting</h3>
      <div className="form-grid">
        <label>
          Reports to
          <select
            value={employee.reports_to_id || ''}
            onChange={(e) => onPatch(employee.id, { reports_to_id: Number(e.target.value) || null })}
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
          <strong>{reports.length}</strong>{' '}
          {reports.length === 1 ? 'person reports' : 'people report'} to them:{' '}
          {reports.map((r) => r.name).join(', ')}
        </p>
      ) : (
        <p className="muted small">Nobody reports to them.</p>
      )}
      <p className="muted small">
        To set this for a lot of people at once, tick them on the employee list and use
        <strong> Set their manager</strong>.
      </p>
    </div>
  );
}

/**
 * The rest of a record that is not fields: the paper on file, and what has
 * changed about them over time.
 *
 * Both need the server — a document is a file, and a history is a table. The
 * single-file build says so rather than showing an empty box.
 */
export default function EmployeeRecord({ employee, employees, onPatch, onError, refresh = 0 }) {
  const [record, setRecord] = useState(null);
  const [held, setHeld] = useState([]);
  const [kind, setKind] = useState('pan');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const file = useRef(null);

  const load = async () => {
    if (STANDALONE) return;
    try {
      setRecord(await api.get(`/employees/${employee.id}/record`));
      /*
       * What this person is holding NOW.
       *
       * `out=true` matters: an asset keeps the employee_id of whoever last had
       * it after it comes back, so that the register can still say who
       * returned it. Asking by employee_id alone listed things the person had
       * already handed in - it said ALPESH SHUKLA still had a laptop that was
       * sitting in the office.
       *
       * Read from the register rather than kept on the employee row, because
       * two places holding the same answer is how they come to disagree.
       */
      const { assets } = await api.get(`/people/assets?employee_id=${employee.id}&out=true`);
      setHeld(assets || []);
    } catch (err) {
      onError(err);
    }
  };

  /*
   * `refresh` is bumped by anything OUTSIDE this panel that changes what it
   * shows - uploading the photograph from the record's header, which posts a
   * document of kind `photo`. Without it the panel kept saying "Nothing on
   * file yet · 4 still missing" with the face already on screen above it,
   * which is how somebody uploads the same thing twice.
   */
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee.id, refresh]);

  /*
   * A rejection must say why: a document refused with no reason is one
   * nobody can put right.
   *
   * DECLARED ABOVE THE EARLY RETURN. Put below it, this landed inside the
   * `if (STANDALONE)` branch, so the buttons in the real render called a
   * function that was not in scope - every test passed and the control was
   * dead. Found by pressing it.
   */
  const verify = async (doc, verified) => {
    let note = '';
    if (verified === false) {
      note = window.prompt('What is wrong with it?') || '';
      if (!note.trim()) return;
    }
    try {
      await api.post(`/employees/${employee.id}/documents/${doc.id}/verify`, { verified, note });
      await load();
    } catch (err) {
      onError(err);
    }
  };

  if (STANDALONE) {
    return (
      <div className="structure">
        <h3 style={{ margin: '0 0 0.4rem' }}>Documents and history</h3>
        <p className="muted small">
          Keeping documents and a change history needs the server version — a PAN card is a
          file, and a file cannot live in this browser. Everything else on this record,
          the reporting line included, works here as normal.
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

  const { documents, document_status: status, history } = record;

  return (
    <>
      {/*
        * What they were handed. The asset register is the authority and this
        * only reads it, so the two cannot drift. Nothing here issues or takes
        * anything back - that belongs on the register, where the handover is
        * logged and a slip can be printed.
        */}
      <div className="structure">
        <h3 style={{ margin: '0 0 0.5rem' }}>
          What they hold{held.length ? ` — ${held.length}` : ''}
        </h3>
        {held.length ? (
          <table className="sheet">
            <thead>
              <tr>
                <th className="sticky-name">Code</th>
                <th>What</th>
                <th>Serial</th>
                <th>Since</th>
              </tr>
            </thead>
            <tbody>
              {held.map((asset) => (
                <tr key={asset.id}>
                  <td className="sticky-name">{asset.code || '—'}</td>
                  <td>
                    {asset.kind}
                    {asset.name ? ` — ${asset.name}` : ''}
                  </td>
                  <td className="muted">{asset.identifier || '—'}</td>
                  <td className="muted">{asset.issued_on || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted small">
            Nothing issued to them. Hand something over from the <strong>Assets</strong> tab.
          </p>
        )}
      </div>

      <div className="structure">
        <div className="row" style={{ marginBottom: '0.5rem' }}>
          <h3 id="sec-documents" style={{ margin: 0 }}>Documents and KYC</h3>
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
                {/*
                  * CHECKED, OR SENT BACK - three states, not a tick box.
                  *
                  * Nobody-has-looked is its own answer and is NOT a
                  * rejection: a register that read every unchecked PAN card
                  * as refused would be a page of red nobody reads twice.
                  * The same shape as the roll call's Allowed? control.
                  */}
                <span className="yesno" role="group" aria-label="Checked?">
                  <button
                    className={doc.verified === 1 ? 'on yes' : undefined}
                    title="Checked — it is what it says it is"
                    onClick={() => verify(doc, true)}
                  >
                    ok
                  </button>
                  <button
                    className={doc.verified === 0 ? 'on no' : undefined}
                    title="Rejected — say what is wrong with it"
                    onClick={() => verify(doc, false)}
                  >
                    no
                  </button>
                  <button
                    className={doc.verified === null || doc.verified === undefined ? 'on none' : undefined}
                    aria-label="nobody has checked"
                    title="Hand the decision back — nobody has checked"
                    onClick={() => verify(doc, null)}
                  >
                    —
                  </button>
                </span>
                {doc.verified === 0 && doc.verify_note ? (
                  <span className="muted small" style={{ color: 'var(--bad)' }}>{doc.verify_note}</span>
                ) : null}
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
        <h3 id="sec-history" style={{ margin: '0 0 0.5rem' }}>History</h3>
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
