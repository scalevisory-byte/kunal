import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { usernameBase } from '../../../../shared/username.js';

const when = (v) => String(v || '').replace('T', ' ').slice(0, 16);

/**
 * Who can get in, and what they may do.
 *
 * Three roles, each described on the page rather than left to be guessed at —
 * because "HR" means nothing until somebody says whether HR sees salaries.
 * (It does. That was Dinesh's call.)
 */
export default function Users({ me, onError }) {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [areas, setAreas] = useState([]);
  const [adding, setAdding] = useState(false);
  // Set the moment somebody types in the username box themselves, after
  // which the name no longer writes over it.
  const [ownUsername, setOwnUsername] = useState(false);
  const [draft, setDraft] = useState({ username: '', name: '', password: '', role: 'hr', areas: [] });
  const [said, setSaid] = useState('');
  const [saidBad, setSaidBad] = useState(false);

  const load = async () => {
    try {
      const { users: list, roles: kinds, areas: parts } = await api.get('/auth/users');
      setUsers(list);
      setRoles(kinds);
      setAreas(parts || []);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = async () => {
    try {
      await api.post('/auth/users', draft);
      setSaidBad(false);
      setDraft({ username: '', name: '', password: '', role: 'hr', areas: [] });
      setAdding(false);
      setSaid('');
      load();
    } catch (err) {
      setSaidBad(true);
      setSaid(err.message);
    }
  };

  const patch = async (user, body) => {
    try {
      await api.patch(`/auth/users/${user.id}`, body);
      setSaidBad(false);
      setSaid('');
      load();
    } catch (err) {
      setSaidBad(true);
      setSaid(err.message);
    }
  };

  const reset = async (user) => {
    const password = window.prompt(
      `A new password for ${user.name}. They will be asked to change it the first time they sign in.`,
      ''
    );
    if (!password) return;
    try {
      await api.post(`/auth/users/${user.id}/password`, { password });
      setSaidBad(false);
      setSaid(`${user.name}'s password is set. Tell them it, and they will be asked to change it.`);
      load();
    } catch (err) {
      setSaidBad(true);
      setSaid(err.message);
    }
  };

  const remove = async (user) => {
    if (!window.confirm(`Remove the login for ${user.name}? Their name stays on everything they did.`)) return;
    try {
      await api.del(`/auth/users/${user.id}`);
      load();
    } catch (err) {
      setSaidBad(true);
      setSaid(err.message);
    }
  };

  return (
    <section className="stack">
      {/*
        * The reason this screen exists, so it looks like it.
        *
        * It was a .ghost button - muted grey, no border, no fill - sitting
        * under a full-width table of role descriptions. On a page whose only
        * other thing is a list, "Add a login" in grey text reads as a caption
        * for the list rather than as the way to make one. Asked for as
        * "admin id se user id login banane ka option do", about a screen that
        * already had it.
        */}
      <div className="toolbar">
        <button
          className={adding ? undefined : 'primary'}
          onClick={() => {
            setOwnUsername(false);
            setAdding(!adding);
          }}
        >
          {adding ? 'Cancel' : '+ Add a login'}
        </button>
      </div>

      {adding && (
        <div className="card">
          <div className="form-grid">
            <label>
              Name
              <input
                value={draft.name}
                onChange={(e) => {
                  /*
                   * The username follows the name, the way the Staff logins
                   * screen already makes "nidhi.shah" for itself. Typing the
                   * name and then being refused until you invent a username
                   * by hand is the sort of friction nobody reports, they just
                   * stop making logins. Still editable - the moment it is
                   * touched, this stops writing over it - and the server is
                   * what refuses a duplicate, by name.
                   */
                  const name = e.target.value;
                  setDraft((was) => ({
                    ...was,
                    name,
                    username: ownUsername ? was.username : usernameBase(name),
                  }));
                }}
              />
            </label>
            <label>
              Username
              <input
                value={draft.username}
                autoCapitalize="none"
                placeholder="hema"
                onChange={(e) => {
                  setOwnUsername(true);
                  setDraft({ ...draft, username: e.target.value });
                }}
              />
            </label>
            <label>
              Password
              <input
                type="text"
                value={draft.password}
                placeholder="at least 8 characters"
                onChange={(e) => setDraft({ ...draft, password: e.target.value })}
              />
            </label>
            <label>
              Role
              <select
                value={draft.role}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    role: e.target.value,
                    // An Admin cannot be narrowed, so the ticks go with the
                    // choice rather than being left on screen meaning nothing.
                    areas: e.target.value === 'admin' ? [] : draft.areas,
                  })
                }
              >
                {roles.filter((r) => r.key !== 'employee').map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/*
            * WHICH MODULES, ASKED HERE AND NOT AFTERWARDS.
            *
            * This was a second job on the row once the login already
            * existed - so a login made for the front desk could sign in that
            * minute and read the whole payroll, and the person who made it
            * believed they had narrowed it. Dinesh: *"sirf front desk ka
            * rights diya he to bhi"*.
            */}
          {draft.role === 'admin' ? (
            <p className="lic-alert warn">
              <strong>An Admin can do everything, on every module</strong> — including this
              screen, so they can change any right, their own included. For somebody who should
              only see part of the app, choose <strong>HR</strong> or <strong>Viewer</strong> and
              tick what they need.
            </p>
          ) : (
            <>
              <p className="muted small" style={{ marginBottom: '0.3rem' }}>
                Which modules — <strong>nothing ticked means every one of them</strong>.
              </p>
              <div className="area-ticks">
                {areas.map(([key, label, what]) => (
                  <label key={key} title={what}>
                    <input
                      type="checkbox"
                      checked={draft.areas.includes(key)}
                      onChange={() =>
                        setDraft({
                          ...draft,
                          areas: draft.areas.includes(key)
                            ? draft.areas.filter((a) => a !== key)
                            : [...draft.areas, key],
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="muted small">
                {draft.areas.length
                  ? `They will see ${draft.areas
                      .map((a) => areas.find(([k]) => k === a)?.[1] || a)
                      .join(', ')} — and nothing else.`
                  : 'They will see every module. Tick the ones they need to narrow it.'}
              </p>
            </>
          )}

          <p className="muted small">
            The password is shown rather than hidden, because you have to read it out to them.
            They can change it themselves once they are in.
          </p>
          <button onClick={add} disabled={!draft.username.trim() || !draft.name.trim() || !draft.password}>
            Add it
          </button>
        </div>
      )}

      {/* A refusal in grey is a refusal nobody reads - and the refusals on
          this screen are the ones that matter most. */}
      {said && <p className={saidBad ? 'lic-alert warn' : 'muted small'}>{said}</p>}

      <table className="sheet">
        <thead>
          <tr>
            <th>Name</th>
            <th>Username</th>
            <th>Role</th>
            <th>May use</th>
            <th>Last signed in</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td className="sticky-name">
                {user.name}
                {user.id === me?.id && <span className="muted small"> — you</span>}
                {user.must_change && <span className="pill pending"> must change password</span>}
              </td>
              <td className="muted small">{user.username}</td>
              <td>
                <select value={user.role} onChange={(e) => patch(user, { role: e.target.value })}>
                  {roles.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </td>
              {/*
                * WHICH TABS, beside what kind of action.
                *
                * Dinesh, with four people all Admin: "rights me aur option
                * do". Nothing ticked means everything, which is what every
                * login already is - so this appearing changes nobody, and
                * narrowing is a thing somebody chooses, one at a time.
                *
                * A staff login carries none of these: its whole authority is
                * its own payslip, and a tick here would mean nothing.
                */}
              <td className="small">
                {user.role === 'employee' ? (
                  <span className="muted">their own record only</span>
                ) : user.role === 'admin' ? (
                  /* No ticks against an Admin: they can open this screen and
                     untick them. A fence drawn where there is none is worse
                     than none at all. */
                  <span className="muted" title="An Admin can use every module and change any right, their own included.">
                    Everything, and every right
                  </span>
                ) : (
                  <AreaTicks user={user} areas={areas} onPatch={patch} />
                )}
              </td>
              <td className="muted small">{user.last_login_at ? when(user.last_login_at) : 'never'}</td>
              <td>
                <button className="ghost small" onClick={() => reset(user)}>
                  reset password
                </button>{' '}
                <button className="ghost small" onClick={() => patch(user, { active: !user.active })}>
                  {user.active ? 'switch off' : 'switch on'}
                </button>{' '}
                <button className="ghost small" onClick={() => remove(user)}>
                  remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="card">
        <h3>What each role may do</h3>
        <table className="sheet">
          <tbody>
            {roles.map((role) => (
              <tr key={role.key}>
                <td className="sticky-name">
                  <strong>{role.label}</strong>
                </td>
                <td>{role.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          Enforced on the server, not by hiding buttons — somebody who knows the address still
          cannot do what their role does not carry.
        </p>
      </div>

      <p className="muted small">
        A switched-off login stops working at once, not when its session runs out. The last Admin
        cannot be demoted, switched off or removed — there would be nobody left who could make one.
      </p>
    </section>
  );
}

/**
 * The areas one login may use.
 *
 * Shown as "Everything" until somebody narrows it, because that is what an
 * empty list MEANS - not "nothing". Unticking the last box puts it back to
 * everything rather than locking the person out of an app they then have to
 * be talked through unlocking.
 */
function AreaTicks({ user, areas, onPatch }) {
  const [open, setOpen] = useState(false);
  const has = user.areas || [];
  const narrowed = has.length > 0;

  const toggle = (key) => {
    const next = has.includes(key) ? has.filter((a) => a !== key) : [...has, key];
    onPatch(user, { areas: next });
  };

  return (
    <>
      <button className="link" onClick={() => setOpen(!open)}>
        {narrowed
          ? has.map((a) => areas.find(([k]) => k === a)?.[1] || a).join(', ')
          : 'Everything'}
      </button>
      {open && (
        <div className="area-ticks">
          {areas.map(([key, label, what]) => (
            <label key={key} title={what}>
              <input
                type="checkbox"
                checked={has.includes(key)}
                onChange={() => toggle(key)}
              />
              {label}
            </label>
          ))}
          <p className="muted small" style={{ margin: '0.4rem 0 0' }}>
            Nothing ticked means <strong>everything</strong>. Enforced on the server — a tab that
            is not ticked cannot be reached by knowing its address either, and a login without
            <strong> Salary sheet</strong> sees no pay figure anywhere.
          </p>
        </div>
      )}
    </>
  );
}
