import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';

/*
 * Giving staff their own login.
 *
 * A staff login sees its own payslip, attendance and leave, and nothing about
 * anybody else - that is enforced on the server by the role carrying no
 * `read` at all, not by hiding screens here.
 *
 * The password is shown ONCE, on this screen, after it is made. There is
 * nowhere else it can come from: it is stored as a scrypt hash like every
 * other. So the list of what was just created stays on screen until it is
 * dismissed, and says plainly that it will not be shown again.
 */

export default function StaffLogins({ onError }) {
  const [staff, setStaff] = useState([]);
  const [query, setQuery] = useState('');
  const [ticked, setTicked] = useState(() => new Set());
  const [made, setMade] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const { staff: list } = await api.get('/auth/staff');
      setStaff(list);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return staff.filter(
      (s) =>
        !needle ||
        [s.name, s.code, s.username, s.company_name, s.department]
          .some((f) => String(f || '').toLowerCase().includes(needle))
    );
  }, [staff, query]);

  const without = shown.filter((s) => !s.has_login && s.active);
  const allTicked = without.length > 0 && without.every((s) => ticked.has(s.employee_id));

  const toggle = (id) =>
    setTicked((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const create = async () => {
    const ids = [...ticked];
    if (!ids.length) return;
    setBusy(true);
    try {
      const { made: fresh, refused } = await api.post('/auth/staff', { employee_ids: ids });
      setMade(fresh);
      setTicked(new Set());
      await load();
      // A refusal for one person must not look like a failure for all of them.
      if (refused?.length) {
        onError(new Error(`${refused.length} not made: ${refused[0].error}`));
      }
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const copyAll = async () => {
    const text = made.map((m) => `${m.name}\t${m.username}\t${m.password}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // A browser that refuses the clipboard is not worth a banner: the list
      // is on screen and selectable.
    }
  };

  return (
    <div className="stack">
      <div className="card">
        <h3>Staff logins</h3>
        <p className="muted small">
          A staff login shows that one person their own payslips, their attendance, their leave
          balance and how their salary was worked out — and lets them apply for leave and fix
          their own bank details. It cannot see anybody else, any total, or anything about the
          company.
        </p>
      </div>

      {made.length > 0 && (
        <div className="card banner-card">
          <h3>Hand these over now</h3>
          <p className="muted small">
            These passwords are not stored anywhere readable, so this is the only time they can
            be shown. Each one has to be changed on first use.
          </p>
          <table className="sheet">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>First password</th>
              </tr>
            </thead>
            <tbody>
              {made.map((m) => (
                <tr key={m.employee_id}>
                  <td>{m.name}</td>
                  <td className="num">{m.username}</td>
                  <td className="num">{m.password}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: '0.6rem' }}>
            <button className="primary" onClick={copyAll}>Copy all</button>
            <button onClick={() => setMade([])}>I have them</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="pf-find-row">
          <input
            className="search"
            value={query}
            placeholder="Find somebody"
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            onClick={() =>
              setTicked(allTicked ? new Set() : new Set(without.map((s) => s.employee_id)))
            }
            disabled={!without.length}
          >
            {allTicked ? 'Untick all' : `Tick all ${without.length} without one`}
          </button>
          <button className="primary" disabled={busy || !ticked.size} onClick={create}>
            {busy ? 'Making…' : `Make ${ticked.size || ''} login${ticked.size === 1 ? '' : 's'}`}
          </button>
        </div>

        <div className="table-wrap">
          <table className="sheet">
            <thead>
              <tr>
                <th />
                <th>Name</th>
                <th>Company</th>
                <th>Username</th>
                <th>Last signed in</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.employee_id} className={s.active ? undefined : 'muted'}>
                  <td>
                    {s.has_login || !s.active ? null : (
                      <input
                        type="checkbox"
                        checked={ticked.has(s.employee_id)}
                        onChange={() => toggle(s.employee_id)}
                      />
                    )}
                  </td>
                  <td>
                    {s.name}
                    <div className="muted small">
                      {[s.code, s.designation].filter(Boolean).join(' · ')}
                      {s.active ? '' : ' · left'}
                    </div>
                  </td>
                  <td className="small">{s.company_name || '—'}</td>
                  <td className="small num">
                    {s.has_login ? (
                      <>
                        {s.username}
                        {s.login_active === false ? (
                          <span className="muted"> · switched off</span>
                        ) : s.must_change ? (
                          <span className="muted"> · first password not changed</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="muted">none</span>
                    )}
                  </td>
                  <td className="small num muted">
                    {s.last_login_at ? String(s.last_login_at).slice(0, 10) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!shown.length ? <p className="empty">Nobody matches.</p> : null}
        <p className="muted small">
          Somebody who has left keeps no login here — switch theirs off under Logins rather than
          deleting it, so the sign-in record stays readable.
        </p>
      </div>
    </div>
  );
}
