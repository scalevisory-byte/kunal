import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { KYC_KINDS, kindLabel } from '../../../../shared/documents.js';

/**
 * WHAT THE OFFICE HOLDS ON FILE FOR THIS PERSON, and what is still wanted.
 *
 * The list comes from `/api/me/documents`, which strips the file path before
 * it leaves the server - the same rule the office route follows. Nothing
 * here can reach anybody else's papers: the employee id is read off the
 * LOGIN and never appears in a URL on this page.
 */

/* The same names the office record uses, from the one list - so a document
   is not called two different things on two screens. */
const label = kindLabel;

const when = (v) => String(v || '').replace('T', ' ').slice(0, 10);

export default function MyDocuments({ onError }) {
  const [docs, setDocs] = useState(null);

  useEffect(() => {
    api
      .get('/me/documents')
      .then(({ documents }) => setDocs(documents || []))
      .catch((err) => { setDocs([]); onError?.(err); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (docs === null) return <p className="muted small">Loading…</p>;

  const have = new Set(docs.map((d) => d.kind));
  const missing = KYC_KINDS.filter((k) => !have.has(k));

  return (
    <div className="stack">
      <div className="card">
        <div className="row">
          <h3>My documents</h3>
          <span className="grow" />
          <span className="muted small">{docs.length} on file</span>
        </div>

        {docs.length ? (
          <table className="sheet">
            <thead>
              <tr>
                <th className="grow">What it is</th>
                <th>Number</th>
                <th>Expires</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td><strong>{label(d.kind)}</strong>{d.note ? <span className="muted small"> · {d.note}</span> : null}</td>
                  <td className="val">{d.number || '—'}</td>
                  <td className="val">{d.expires_on || '—'}</td>
                  <td className="muted small">{when(d.uploaded_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty fo-empty">Nothing on file for you yet.</p>
        )}

        {missing.length > 0 && (
          <p className="muted small">
            <strong>Still wanted:</strong> {missing.map(label).join(', ')}. Give them to the office
            — the PF return and the bank transfer both need them.
          </p>
        )}
      </div>

      <p className="muted small">
        {/*
          * Said plainly rather than offering a download button that cannot
          * work: the files are served to the office behind a signed link,
          * and there is no route that hands an employee their own back yet.
          */}
        This is the <strong>list</strong> of what the office holds. Downloading the files
        themselves is not built on this portal yet — ask the office for a copy.
      </p>
    </div>
  );
}
