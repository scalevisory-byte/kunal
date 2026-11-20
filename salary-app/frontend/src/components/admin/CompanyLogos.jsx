import { useRef, useState } from 'react';
import { api } from '../../api.js';

/**
 * The letterhead: one logo per company.
 *
 * Dinesh: *"offer letter me company ka logo bhi aana chahiye"*. These are
 * separate businesses, so there is no single app-wide picture — an offer from
 * BOOKNFLY must not go out under SCALE VISORY's mark, and the letter looks the
 * logo up from the opening's own company.
 *
 * NO LOGO IS NOT A FAULT. A company with none simply has its name set in type
 * on the letter, exactly as before there was one. So this screen says "none
 * yet", never a warning, and nothing anywhere is blocked for want of a picture.
 *
 * The picture is fetched by id behind the session rather than through a signed
 * link: it is drawn by an <img> on a page somebody may leave open, and it is
 * the one picture in this app meant to be seen outside the building anyway.
 */
export default function CompanyLogos({ companies = [], onError, onReload }) {
  const [busy, setBusy] = useState(0);
  const [said, setSaid] = useState('');
  /** Bumped after an upload so the browser fetches the new picture. */
  const [stamp, setStamp] = useState(() => Date.now());
  const pickers = useRef({});

  /** Behind the session, like the employee photographs. `v` so a replacement shows. */
  const src = (company) => `/api/companies/${company.id}/logo?v=${stamp}`;
  const [unshown, setUnshown] = useState([]);

  const send = async (company, file) => {
    if (!file) return;
    setBusy(company.id);
    setSaid('');
    try {
      const form = new FormData();
      form.append('logo', file);
      await api.upload(`/companies/${company.id}/logo`, form);
      setStamp(Date.now());
      setSaid(`${company.name}: logo saved.`);
      onReload?.();
    } catch (err) {
      // The server's own sentence says what it refused and why - the size cap,
      // or that an SVG can carry script into a letter.
      setSaid(err.message);
    } finally {
      setBusy(0);
    }
  };

  const remove = async (company) => {
    if (!window.confirm(`Remove ${company.name}'s logo? Letters will go out with the name in type.`)) return;
    setBusy(company.id);
    try {
      await api.del(`/companies/${company.id}/logo`);
      setStamp(Date.now());
      setSaid(`${company.name}: logo removed.`);
      onReload?.();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(0);
    }
  };

  return (
    <div className="card">
      <h3>Company logos</h3>
      <p className="muted small">
        Used on the papers that leave the building — the <strong>offer letter</strong> first.
        PNG, JPG, WEBP or GIF, up to 512 KB. A wide wordmark works best; it is printed at about
        54 pixels tall.
      </p>
      <p className="muted small">
        The picture travels <strong>inside</strong> the letter, so it still shows on a phone with
        no signal and nothing is fetched from this server when a candidate opens it.
        <strong> SVG is not accepted</strong>, because an SVG can carry script into a document we
        hand to strangers.
      </p>

      {said ? <p className="muted small">{said}</p> : null}

      <table className="sheet">
        <thead>
          <tr>
            <th>Company</th>
            <th>Logo</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {companies.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>
                {c.has_logo && !unshown.includes(c.id) ? (
                  <img
                    className="co-logo"
                    src={src(c)}
                    alt={`${c.name} logo`}
                    /*
                     * Signed in with the shared key rather than a login, the
                     * picture route has no session to go on. The logo IS on
                     * file and the letter still carries it - saying so beats
                     * a broken image, which reads as "it did not save".
                     */
                    onError={() => setUnshown((list) => [...list, c.id])}
                  />
                ) : c.has_logo ? (
                  <span className="muted small">on file — sign in with a login to see it here</span>
                ) : (
                  <span className="muted small">none yet — the name is printed instead</span>
                )}
              </td>
              <td className="right">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  style={{ display: 'none' }}
                  ref={(el) => { pickers.current[c.id] = el; }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    send(c, file);
                  }}
                />
                <button className="tiny" disabled={busy === c.id} onClick={() => pickers.current[c.id]?.click()}>
                  {c.has_logo ? 'Replace' : 'Upload'}
                </button>{' '}
                {c.has_logo ? (
                  <button className="tiny danger" disabled={busy === c.id} onClick={() => remove(c)}>
                    Remove
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!companies.length ? <p className="empty">No companies yet.</p> : null}
    </div>
  );
}
