import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { KYC_KINDS, documentState, kindLabel } from '../../../../shared/documents.js';
import { UPLOADABLE_KINDS } from '../../../../shared/selfRecord.js';

/**
 * THEIR OWN PAPERS — what the office holds, and sending in what it does not.
 *
 * Dinesh: *"uske documnet bhi khud upload karde"*. Until this release the
 * page was a read-only list that ended with a sentence saying downloading
 * was not built and uploading was not possible, so the only way a PAN card
 * reached a record was somebody in the office photographing it.
 *
 * The file goes into the SAME store the office uploads to — one set of
 * documents, one register, one KYC count — and lands UNCHECKED. `verified`
 * is three-state: null is "nobody has looked", which is not "rejected".
 * Somebody in the office still has to open the Aadhaar card and say it is
 * the right one, and that was true of a document the office filed itself.
 *
 * Nothing here can reach anybody else's papers: the employee id is read off
 * the LOGIN and never appears in a URL on this page.
 */

const label = kindLabel;
const when = (v) => String(v || '').replace('T', ' ').slice(0, 10);

export default function MyDocuments({ onError }) {
  const [docs, setDocs] = useState(null);
  const [kind, setKind] = useState('aadhaar');
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState('');
  const file = useRef(null);

  const load = async () => {
    try {
      const { documents } = await api.get('/me/documents');
      setDocs(documents || []);
    } catch (err) {
      setDocs([]);
      onError?.(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (docs === null) return <p className="muted small">Loading…</p>;

  const have = new Set(docs.map((d) => d.kind));
  const missing = KYC_KINDS.filter((k) => !have.has(k));

  const send = async () => {
    const chosen = file.current?.files?.[0];
    if (!chosen) {
      onError?.(new Error('Choose a file first.'));
      return;
    }
    setBusy('Sending…');
    try {
      const form = new FormData();
      form.set('document', chosen);
      form.set('kind', kind);
      if (number.trim()) form.set('number', number.trim());
      await api.upload('/me/documents', form);
      if (file.current) file.current.value = '';
      setNumber('');
      await load();
      setBusy('Sent. The office will check it.');
      window.setTimeout(() => setBusy(''), 3000);
    } catch (err) {
      setBusy('');
      onError?.(err);
    }
  };

  const takeBack = async (doc) => {
    if (!window.confirm(`Remove the ${label(doc.kind)} you sent in?`)) return;
    try {
      await api.del(`/me/documents/${doc.id}`);
      await load();
    } catch (err) {
      onError?.(err);
    }
  };

  return (
    <div className="stack">
      <div className="card">
        <h3>Send in a document</h3>
        <p className="muted small">
          A photograph or a scan of your own papers — PDF, JPG or PNG. An offer letter and an
          appointment letter are not on the list: those are issued by the office.
        </p>
        <div className="toolbar">
          <label>
            What it is
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {UPLOADABLE_KINDS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Number on it <span className="muted small">(if it has one)</span>
            <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="optional" />
          </label>
          <input type="file" ref={file} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" />
          <button className="primary" onClick={send} disabled={Boolean(busy) && busy === 'Sending…'}>
            Send it in
          </button>
        </div>
        {busy && <p className="muted small">{busy}</p>}
      </div>

      <div className="card">
        <div className="row">
          <h3>On file for you</h3>
          <span className="grow" />
          <span className="muted small">{docs.length} on file</span>
        </div>

        {docs.length ? (
          <table className="sheet">
            <thead>
              <tr>
                <th className="grow">What it is</th>
                <th>Number</th>
                <th>Checked</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const state = documentState(d);
                return (
                  <tr key={d.id}>
                    <td>
                      <strong>{label(d.kind)}</strong>
                      {d.note ? <span className="muted small"> · {d.note}</span> : null}
                    </td>
                    <td className="val">{d.number || '—'}</td>
                    {/* Not checked is a third thing, never a refusal. */}
                    <td className={state.tone === 'bad' ? 'warn' : 'muted small'}>{state.label}</td>
                    <td className="muted small">{when(d.uploaded_at)}</td>
                    <td className="right">
                      <a className="linkish small" href={`/api/me/documents/${d.id}/file`} download>
                        Download
                      </a>{' '}
                      {state.key === 'unchecked' && (
                        <button className="ghost small" onClick={() => takeBack(d)}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="empty fo-empty">Nothing on file for you yet.</p>
        )}

        {missing.length > 0 && (
          <p className="muted small">
            <strong>Still wanted:</strong> {missing.map(label).join(', ')}. The PF return and the
            bank transfer both need them — send them in above.
          </p>
        )}
      </div>
    </div>
  );
}
