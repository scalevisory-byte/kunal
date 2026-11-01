import { useEffect, useState } from 'react';
import { clearToken, setToken } from '../api.js';

/**
 * Getting in.
 *
 * Three states, decided by the server rather than guessed at:
 *
 *   **Nothing set up yet** — there are no logins at all, so this offers to make
 *   the first admin. That door closes the moment it is used.
 *
 *   **Sign in** — a username and a password. A wrong name and a wrong password
 *   give the same answer, deliberately: anything else tells a stranger which
 *   logins exist.
 *
 *   **The old dashboard password** — kept as a way in for an installation that
 *   has an `APP_PASSWORD` and no logins yet, so nobody is locked out of their
 *   own app by this change. It is a key for machines, and the screen says so.
 */
export default function Login({ onSignedIn, onError }) {
  const [state, setState] = useState(null);
  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({ username: '', password: '', name: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/state', { credentials: 'same-origin' });
        const body = await res.json();
        setState(body);
        setMode(body.needs_setup ? 'setup' : 'signin');
        if (body.signed_in) onSignedIn(body.signed_in);
      } catch (err) {
        setProblem(err.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (patch) => setForm({ ...form, ...patch });

  const submit = async (e) => {
    e.preventDefault();
    setProblem('');
    setBusy(true);
    try {
      if (mode === 'key') {
        // The legacy route: a Bearer token, which is what this app has always
        // used and what anything on a schedule still uses.
        setToken(form.password);
        const res = await fetch('/api/auth/state', {
          credentials: 'same-origin',
          headers: { authorization: `Bearer ${form.password}` },
        });
        const body = await res.json();
        if (!body.signed_in) throw new Error('That is not the dashboard password.');
        onSignedIn(body.signed_in);
        return;
      }

      if (mode === 'setup' && form.password !== form.confirm) {
        throw new Error('The two passwords do not match.');
      }

      const res = await fetch(mode === 'setup' ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          mode === 'setup'
            ? { username: form.username, name: form.name, password: form.password }
            : { username: form.username, password: form.password }
        ),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'That did not work.');
      // Signed in with a login, so any dashboard password left in this browser
      // from before is not what identifies them any more.
      clearToken();
      onSignedIn(body.user);
    } catch (err) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!state) return <div className="loading">Loading…</div>;

  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <h1>Salary Sheet</h1>

        {mode === 'setup' && (
          <>
            <p className="muted small">
              Nobody has a login yet. Make the first one — it will be an <strong>Admin</strong>,
              which can add everybody else. This screen closes as soon as it is used.
            </p>
            <label className="block">
              Your name
              <input
                value={form.name}
                autoFocus
                placeholder="Dinesh Parmar"
                onChange={(e) => set({ name: e.target.value })}
              />
            </label>
          </>
        )}

        {mode === 'signin' && <p className="muted small">Sign in to continue.</p>}

        {mode === 'key' && (
          <p className="muted small">
            The old dashboard password, from <code>APP_PASSWORD</code>. It still works and gives
            full access — it is the key anything on a schedule uses. Once you have made a login
            above, use that instead: it leaves your name on what you change.
          </p>
        )}

        {mode !== 'key' && (
          <label className="block">
            Username
            <input
              value={form.username}
              autoFocus={mode === 'signin'}
              autoCapitalize="none"
              autoCorrect="off"
              placeholder={mode === 'setup' ? 'dinesh' : ''}
              onChange={(e) => set({ username: e.target.value })}
            />
          </label>
        )}

        <label className="block">
          Password
          <input
            type="password"
            value={form.password}
            autoFocus={mode === 'key'}
            onChange={(e) => set({ password: e.target.value })}
          />
        </label>

        {mode === 'setup' && (
          <label className="block">
            And again
            <input
              type="password"
              value={form.confirm}
              onChange={(e) => set({ confirm: e.target.value })}
            />
          </label>
        )}

        {problem && <p className="error">{problem}</p>}

        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Just a moment…' : mode === 'setup' ? 'Create the first login' : 'Sign in'}
        </button>

        <div className="login-switch">
          {mode === 'setup' && (
            <button type="button" className="link" onClick={() => setMode('key')}>
              I have the dashboard password instead
            </button>
          )}
          {mode === 'key' && (
            <button
              type="button"
              className="link"
              onClick={() => setMode(state.needs_setup ? 'setup' : 'signin')}
            >
              Back
            </button>
          )}
          {mode === 'signin' && state.open && (
            <span className="muted small">
              This app is running with nothing guarding it. Make a login to close that.
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
