import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { usernameBase } from '../../../../shared/username.js';
import { loginStatus } from '../../../../shared/loginStatus.js';

const when = (v) => String(v || '').replace('T', ' ').slice(0, 16);
const initials = (name) =>
  String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const PER_PAGE = 15;

/*
 * The five abilities a role is built from, in the words the matrix uses.
 * The ROLES themselves come from the server (backend/src/users.js) - this
 * only names the columns, so a role whose abilities change there changes
 * here with nothing typed twice.
 */
const ABILITY_COLUMNS = [
  ['read', 'Look', 'See the office side'],
  ['write', 'Fill in & change', 'Add and edit records'],
  ['destroy', 'Delete & clear', 'Delete, archive, write off, settle — the acts that take something away'],
  ['approve', 'Approve', 'Approve and lock a month’s payroll, approve an offer'],
  ['admin', 'Administer', 'Logins, branches, a month’s settings, backups'],
];

/**
 * Who can get in, and what they may do.
 *
 * Every role is described on the page rather than left to be guessed at —
 * because "HR" means nothing until somebody says whether HR sees salaries.
 * (It does. That was Dinesh's call.)
 *
 * THE SERVER DECIDES. Nothing here enforces anything: every change is the
 * same PATCH it always was, and the server refuses by name what a role may
 * not be (an Admin narrowed to modules, the last Admin demoted). This screen
 * only offers the choices and says what each means.
 */
export default function Users({ me, onError }) {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [areas, setAreas] = useState([]);
  const [dialog, setDialog] = useState(null); // { mode: 'add'|'edit'|'reset', user? }
  const [said, setSaid] = useState('');
  const [saidBad, setSaidBad] = useState(false);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);

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

  const tell = (text, bad = false) => {
    setSaid(text);
    setSaidBad(bad);
  };

  const patch = async (user, body) => {
    try {
      await api.patch(`/auth/users/${user.id}`, body);
      tell('');
      await load();
      return true;
    } catch (err) {
      tell(err.message, true);
      return false;
    }
  };

  const remove = async (user) => {
    if (!window.confirm(`Remove the login for ${user.name}? Their name stays on everything they did.`)) return;
    try {
      await api.del(`/auth/users/${user.id}`);
      tell(`${user.name}'s login is removed.`);
      load();
    } catch (err) {
      tell(err.message, true);
    }
  };

  const switchOnOff = async (user) => {
    if (user.active && !window.confirm(`Switch off ${user.name}'s login? It stops working at once — not when the session runs out.`)) return;
    if (await patch(user, { active: !user.active })) tell(`${user.name}'s login is ${user.active ? 'switched off' : 'switched on'}.`);
  };

  /*
   * The office logins are this screen's business; staff logins are counted
   * so the figures add up, and are managed on Staff access, where they are
   * made from the employee list.
   */
  const office = users.filter((u) => u.role !== 'employee');
  const staffCount = users.length - office.length;
  const roleLabel = (key) => roles.find((r) => r.key === key)?.label || key;
  const counts = {
    total: office.length,
    active: office.filter((u) => u.active).length,
    off: office.filter((u) => !u.active).length,
    admins: office.filter((u) => u.role === 'admin' && u.active).length,
    change: office.filter((u) => u.active && u.must_change).length,
    never: office.filter((u) => u.active && !u.last_login_at).length,
  };

  const hunt = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      office.filter(
        (u) =>
          (!hunt || u.name.toLowerCase().includes(hunt) || u.username.toLowerCase().includes(hunt)) &&
          (!roleFilter || u.role === roleFilter) &&
          (!statusFilter || loginStatus(u)[0] === statusFilter)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, hunt, roleFilter, statusFilter]
  );
  const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE));
  const at = Math.min(page, pages - 1);
  const slice = shown.slice(at * PER_PAGE, at * PER_PAGE + PER_PAGE);
  useEffect(() => setPage(0), [hunt, roleFilter, statusFilter]);

  const figure = (label, n, filter, tone = '') => (
    <button
      type="button"
      className={`ad-fig${tone ? ` ${tone}` : ''}${statusFilter === filter && filter ? ' on' : ''}`}
      onClick={() => setStatusFilter(statusFilter === filter ? '' : filter)}
      disabled={filter === null}
    >
      <span className="n">{n}</span>
      <span className="k">{label}</span>
    </button>
  );

  return (
    <section className="stack">
      <div className="ad-figs">
        {figure('office logins', counts.total, '')}
        {figure('active', counts.active, 'on', 'good')}
        {figure('switched off', counts.off, 'off', counts.off ? 'grey' : '')}
        {figure('must change password', counts.change, 'change', counts.change ? 'warn' : '')}
        {figure('never signed in', counts.never, 'never', counts.never ? 'warn' : '')}
        {figure(`active Admin${counts.admins === 1 ? '' : 's'}`, counts.admins, null)}
      </div>

      <div className="ad-toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search name or username"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Role">
          <option value="">Every role</option>
          {roles.filter((r) => r.key !== 'employee').map((r) => (
            <option key={r.key} value={r.key}>{r.label}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          <option value="on">Active</option>
          <option value="never">Never signed in</option>
          <option value="change">Must change password</option>
          <option value="off">Switched off</option>
        </select>
        {(hunt || roleFilter || statusFilter) && (
          <button className="ghost" onClick={() => { setQuery(''); setRoleFilter(''); setStatusFilter(''); }}>
            Reset
          </button>
        )}
        <span className="muted small ad-count">
          {shown.length} of {office.length}
          {staffCount ? ` · ${staffCount} staff logins are on Staff access` : ''}
        </span>
        {/*
          * The reason this screen exists, so it looks like it. It was once a
          * grey .ghost button under a table and read as a caption - asked for
          * as "admin id se user id login banane ka option do", about a screen
          * that already had it.
          */}
        <button className="primary pp-add" onClick={() => setDialog({ mode: 'add' })}>
          + Add login
        </button>
      </div>

      {/* A refusal in grey is a refusal nobody reads - and the refusals on
          this screen are the ones that matter most. */}
      {said && <p className={saidBad ? 'lic-alert warn' : 'muted small'}>{said}</p>}

      <div className="table-wrap ad-table-wrap">
        <table className="sheet ad-logins">
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Role</th>
              <th>May use</th>
              <th>Status</th>
              <th>Last signed in</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {slice.map((user) => {
              const [tone, label] = loginStatus(user);
              return (
                <tr key={user.id} className={user.active ? undefined : 'ad-off'}>
                  <td>
                    <span className="ad-person">
                      <span className="ad-avatar" aria-hidden="true">{initials(user.name)}</span>
                      <span>
                        <strong>{user.name}</strong>
                        {user.id === me?.id && <span className="muted small"> — you</span>}
                      </span>
                    </span>
                  </td>
                  <td className="muted small">{user.username}</td>
                  <td><span className={`ad-role r-${user.role}`}>{roleLabel(user.role)}</span></td>
                  <td className="small ad-areas">
                    {user.role === 'admin' ? (
                      /* No ticks against an Admin: they can open this screen
                         and untick them. A fence drawn where there is none is
                         worse than none at all. */
                      <span className="muted" title="An Admin can use every module and change any right, their own included.">
                        Everything, and every right
                      </span>
                    ) : user.areas?.length ? (
                      user.areas.map((a) => areas.find(([k]) => k === a)?.[1] || a).join(', ')
                    ) : (
                      'Everything'
                    )}
                  </td>
                  <td><span className={`ad-status s-${tone}`}>{label}</span></td>
                  <td className="muted small">{user.last_login_at ? when(user.last_login_at) : 'never'}</td>
                  <td className="ad-act">
                    <RowMenu
                      label={`Actions for ${user.name}`}
                      items={[
                        ['Edit role and modules', () => setDialog({ mode: 'edit', user })],
                        ['Reset password', () => setDialog({ mode: 'reset', user })],
                        [user.active ? 'Switch off' : 'Switch on', () => switchOnOff(user)],
                        ['Remove the login', () => remove(user), 'danger'],
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
            {!slice.length && (
              <tr>
                <td colSpan={7} className="empty">
                  {office.length ? 'Nobody matches that.' : 'No office logins yet — press + Add login.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="ad-pager">
          <button className="ghost small" disabled={at === 0} onClick={() => setPage(at - 1)}>← Previous</button>
          <span className="muted small">Page {at + 1} of {pages}</span>
          <button className="ghost small" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>Next →</button>
        </div>
      )}

      <RoleMatrix roles={roles} areas={areas} />

      <IdleRule onError={onError} />

      <p className="muted small">
        A switched-off login stops working at once, not when its session runs out. The last Admin
        cannot be demoted, switched off or removed — there would be nobody left who could make one.
      </p>

      {dialog?.mode === 'add' || dialog?.mode === 'edit' ? (
        <LoginDialog
          mode={dialog.mode}
          user={dialog.user}
          roles={roles}
          areas={areas}
          onClose={() => setDialog(null)}
          onSaved={(text) => { setDialog(null); tell(text); load(); }}
        />
      ) : null}
      {dialog?.mode === 'reset' ? (
        <ResetDialog
          user={dialog.user}
          onClose={() => setDialog(null)}
          onSaved={(text) => { setDialog(null); tell(text); load(); }}
        />
      ) : null}
    </section>
  );
}

/**
 * A row's actions behind one button.
 *
 * Positioned against the WINDOW, not the row: the table sits in a scrolling
 * frame, and a dropdown hung off the last row inside it is cut off by the
 * frame's own edge - the action you wanted is the one you cannot see.
 */
function RowMenu({ label, items }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const list = useRef(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const h = list.current?.offsetHeight || 170;
    const below = r.bottom + 4 + h <= window.innerHeight;
    setPos({ top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - h), right: Math.max(8, window.innerWidth - r.right) });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (!btn.current?.contains(e.target) && !list.current?.contains(e.target)) setOpen(false);
    };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    const close = () => setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="ad-kebab"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ⋯
      </button>
      {open && (
        <div
          ref={list}
          role="menu"
          className="ad-menu"
          style={pos ? { top: pos.top, right: pos.right } : { visibility: 'hidden' }}
        >
          {items.map(([text, act, tone]) => (
            <button
              key={text}
              role="menuitem"
              type="button"
              className={tone || undefined}
              onClick={() => {
                setOpen(false);
                act();
              }}
            >
              {text}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** Esc and a click outside close it, as every dialog in the app does. */
function Dialog({ title, onClose, children }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal ad-dialog" role="dialog" aria-label={title}>
        <div className="ad-dialog-head">
          <h3>{title}</h3>
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * A password box that can be shown or hidden.
 *
 * It starts SHOWN, deliberately: a first password is read out to somebody
 * across a desk, and a box of dots is something you then have to retype.
 * Hide it when somebody is standing behind you.
 */
function PasswordBox({ value, onChange, placeholder = 'at least 8 characters', autoFocus = false }) {
  const [shown, setShown] = useState(true);
  return (
    <span className="ad-pass">
      <input
        type={shown ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        autoComplete="new-password"
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="ghost small" onClick={() => setShown(!shown)} aria-pressed={!shown}>
        {shown ? 'Hide' : 'Show'}
      </button>
    </span>
  );
}

/** The modules a login may use. Nothing ticked means everything. */
function ModuleTicks({ value, areas, onChange }) {
  return (
    <>
      <div className="area-ticks">
        {areas.map(([key, label, what]) => (
          <label key={key} title={what}>
            <input
              type="checkbox"
              checked={value.includes(key)}
              onChange={() => onChange(value.includes(key) ? value.filter((a) => a !== key) : [...value, key])}
            />
            {label}
          </label>
        ))}
      </div>
      <p className="muted small">
        {value.length
          ? `They will see ${value.map((a) => areas.find(([k]) => k === a)?.[1] || a).join(', ')} — and nothing else.`
          : 'Nothing ticked means every module. Tick the ones they need to narrow it.'}{' '}
        Enforced on the server: a module that is not ticked cannot be reached by knowing its address either, and a
        login without <strong>Salary sheet</strong> sees no pay figure anywhere.
      </p>
    </>
  );
}

function LoginDialog({ mode, user, roles, areas, onClose, onSaved }) {
  const adding = mode === 'add';
  // Set the moment somebody types in the username box themselves, after
  // which the name no longer writes over it.
  const [ownUsername, setOwnUsername] = useState(false);
  const [draft, setDraft] = useState(
    adding
      ? { username: '', name: '', password: '', role: 'hr', areas: [] }
      : { name: user.name, role: user.role, areas: user.areas || [] }
  );
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const officeRoles = roles.filter((r) => r.key !== 'employee');
  const picked = roles.find((r) => r.key === draft.role);

  const pickRole = (key) => {
    /*
     * An Admin cannot be narrowed, so the ticks go with the choice rather
     * than being left on screen meaning nothing. A role that SUGGESTS a set
     * of modules (Accounts) ticks them to start with - visibly, and still
     * editable.
     */
    const suggested = roles.find((r) => r.key === key)?.areas;
    setDraft((d) => ({ ...d, role: key, areas: key === 'admin' ? [] : suggested || d.areas }));
  };

  const save = async () => {
    setBusy(true);
    setProblem('');
    try {
      if (adding) {
        await api.post('/auth/users', draft);
        onSaved(`${draft.name}'s login is made. Tell them the username ${draft.username.trim().toLowerCase()} and the password; they can change it once they are in.`);
      } else {
        const body = {};
        if (draft.name.trim() !== user.name) body.name = draft.name;
        if (draft.role !== user.role) body.role = draft.role;
        const before = [...(user.areas || [])].sort().join(',');
        if ([...draft.areas].sort().join(',') !== before || 'role' in body) body.areas = draft.role === 'admin' ? [] : draft.areas;
        if (!Object.keys(body).length) return onClose();
        await api.patch(`/auth/users/${user.id}`, body);
        onSaved(`${draft.name}'s login is saved.`);
      }
    } catch (err) {
      // Said beside the boxes it is about, not behind the dialog.
      setProblem(err.message);
      setBusy(false);
    }
    return undefined;
  };

  return (
    <Dialog title={adding ? 'Add a login' : `Edit ${user.name}`} onClose={onClose}>
      <div className="form-grid ad-form">
        <label>
          Name
          <input
            autoFocus
            value={draft.name}
            onChange={(e) => {
              /*
               * The username follows the name, the way Staff access already
               * makes "nidhi.shah". Still editable - the moment it is
               * touched, this stops writing over it - and the server is what
               * refuses a duplicate, by name.
               */
              const name = e.target.value;
              setDraft((was) => ({
                ...was,
                name,
                ...(adding ? { username: ownUsername ? was.username : usernameBase(name) } : {}),
              }));
            }}
          />
        </label>
        <label>
          Username
          {adding ? (
            <input
              value={draft.username}
              autoCapitalize="none"
              placeholder="hema"
              onChange={(e) => {
                setOwnUsername(true);
                setDraft({ ...draft, username: e.target.value });
              }}
            />
          ) : (
            <input value={user.username} readOnly tabIndex={-1} title="A username is not changed: it is what they sign in with." />
          )}
        </label>
        {adding && (
          <label>
            Password
            <PasswordBox value={draft.password} onChange={(password) => setDraft({ ...draft, password })} />
          </label>
        )}
        <label>
          Role
          <select value={draft.role} onChange={(e) => pickRole(e.target.value)}>
            {officeRoles.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
        </label>
      </div>
      {picked && <p className="muted small ad-role-what"><strong>{picked.label}:</strong> {picked.what}</p>}

      {/*
        * WHICH MODULES, ASKED HERE AND NOT AFTERWARDS. A login made for the
        * front desk could otherwise sign in that minute and read the whole
        * payroll, while the person who made it believed they had narrowed it.
        * Dinesh: *"sirf front desk ka rights diya he to bhi"*.
        */}
      {draft.role === 'admin' ? (
        <p className="lic-alert warn">
          <strong>An Admin can do everything, on every module</strong> — including this screen, so they can change
          any right, their own included. For somebody who should only see part of the app, choose another role and
          tick what they need.
        </p>
      ) : (
        <>
          <p className="ad-sub">Which modules</p>
          <ModuleTicks value={draft.areas} areas={areas} onChange={(next) => setDraft({ ...draft, areas: next })} />
        </>
      )}

      {problem ? <p className="lic-alert warn">{problem}</p> : null}
      <div className="ad-dialog-acts">
        <button className="ghost" onClick={onClose}>Cancel</button>
        <button
          className="primary"
          disabled={busy || !draft.name.trim() || (adding && (!draft.username.trim() || !draft.password))}
          onClick={save}
        >
          {adding ? 'Add the login' : 'Save'}
        </button>
      </div>
    </Dialog>
  );
}

function ResetDialog({ user, onClose, onSaved }) {
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setProblem('');
    try {
      await api.post(`/auth/users/${user.id}/password`, { password });
      onSaved(`${user.name}'s password is set. Tell them it — they will be asked to change it the first time they sign in.`);
    } catch (err) {
      setProblem(err.message);
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Reset ${user.name}'s password`} onClose={onClose}>
      <label className="ad-reset">
        New password
        <PasswordBox value={password} onChange={setPassword} autoFocus />
      </label>
      <p className="muted small">
        It works once: they are made to choose their own the first time they sign in with it, and this one is then
        refused.
      </p>
      {problem ? <p className="lic-alert warn">{problem}</p> : null}
      <div className="ad-dialog-acts">
        <button className="ghost" onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy || !password} onClick={save}>Set the password</button>
      </div>
    </Dialog>
  );
}

/**
 * What each role may do, as a grid - read from the server's own role list.
 *
 * A role is a KIND of action; which modules a login reaches is the ticks on
 * that login, which is why modules are not a column here.
 */
function RoleMatrix({ roles, areas }) {
  if (!roles.length) return null;
  return (
    <div className="card ad-matrix-card">
      <h3>What each role may do</h3>
      <div className="table-wrap">
        <table className="sheet ad-matrix">
          <thead>
            <tr>
              <th>Role</th>
              {ABILITY_COLUMNS.map(([key, label, what]) => (
                <th key={key} title={what}>{label}</th>
              ))}
              <th>In a sentence</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.key}>
                <td><span className={`ad-role r-${role.key}`}>{role.label}</span></td>
                {role.staff ? (
                  <td colSpan={ABILITY_COLUMNS.length} className="muted small ad-own">their own record only — none of the office side</td>
                ) : (
                  ABILITY_COLUMNS.map(([key]) => (
                    <td key={key} className={`ad-tick${role.abilities.includes(key) ? ' yes' : ''}`}>
                      {role.abilities.includes(key) ? '✓' : '—'}
                    </td>
                  ))
                )}
                <td className="small ad-what">{role.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        On top of the role, each login can be narrowed to some of the {areas.length} modules — that is the
        <strong> May use</strong> column above. Enforced on the server, not by hiding buttons: somebody who knows the
        address still cannot do what their role and modules do not carry.
      </p>
    </div>
  );
}

/**
 * Signed out after doing nothing for a while.
 *
 * Dinesh: *"agar ek bar login kiya hua to kabhi logout nahi hota auto"*. One
 * figure, stated in words, with "never" said out loud rather than hidden
 * behind a nought — because a setting that cannot admit it is off gets worked
 * around by nobody ever signing out.
 *
 * The rule lives on the server. This box only tells it what the rule is.
 */
function IdleRule({ onError }) {
  const [minutes, setMinutes] = useState(null);
  const [draft, setDraft] = useState('');
  const [said, setSaid] = useState('');

  useEffect(() => {
    api
      .get('/auth/session-rule')
      .then(({ idle_minutes: m }) => {
        setMinutes(m);
        setDraft(String(m));
      })
      .catch(onError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (value) => {
    try {
      const { idle_minutes: m } = await api.put('/auth/session-rule', { idle_minutes: value });
      setMinutes(m);
      setDraft(String(m));
      setSaid(m === 0 ? 'Nobody is signed out for sitting idle.' : `Saved — ${m} minutes.`);
    } catch (err) {
      onError(err);
    }
  };

  if (minutes === null) return null;

  return (
    <div className="card">
      <h3>Signing out by itself</h3>
      <p className="muted small">
        {minutes === 0
          ? 'A login stays signed in until the browser is closed or the fortnight runs out. Nothing signs it out for sitting idle.'
          : `A login that does nothing for ${minutes} minutes is signed out. Clicking anything inside that time starts the clock again.`}
      </p>
      <div className="toolbar">
        <label className="inline">
          Sign out after
          <select value={draft} onChange={(e) => save(Number(e.target.value))}>
            <option value="0">never — stay signed in</option>
            {[5, 15, 30, 60, 120, 240, 480].map((n) => (
              <option key={n} value={n}>
                {n} minutes of doing nothing
              </option>
            ))}
          </select>
        </label>
        {said && <span className="muted small">{said}</span>}
      </div>
      <p className="muted small">
        Enforced on the server, so closing the laptop lid does not keep a session alive. The front
        desk is the machine strangers stand in front of — a shorter figure is worth more there than
        anywhere else in the building.
      </p>
    </div>
  );
}
