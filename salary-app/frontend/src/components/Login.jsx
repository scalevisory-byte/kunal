import { useEffect, useRef, useState } from 'react';
import { clearToken, setToken } from '../api.js';
import logoUrl from '../assets/booknfly.png';

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
 *
 * The screen around all that is a brand panel and a card. NOTHING below talks
 * to a different endpoint, sends a different body, or reads a different
 * answer than it did when this was one plain card: the three fetches are the
 * three that were always here. A login screen is the one place where a
 * redesign that quietly changed behaviour would be hardest to notice and
 * worst to get wrong.
 *
 * Two things the brief asked for work differently from the obvious reading,
 * and both are deliberate:
 *
 *   **Remember me remembers the USERNAME, not the session.** This app's
 *   session is one 14-day signed HttpOnly cookie, the same one whether a box
 *   is ticked or not; there is no short session for it to extend. A tick that
 *   claimed to keep you signed in longer would be decoration over a thing
 *   that already happens. So it does the real, useful half - your username is
 *   filled in next time on this device - and the line under it says exactly
 *   that. A password is never stored.
 *
 *   **Forgot password tells the truth.** There is no self-service reset in
 *   this app: an admin resets a password in Admin -> Logins and the new one
 *   forces a change on first use. So the link opens that sentence rather than
 *   an email box that would go nowhere.
 */

/** Where the username is kept when "remember me" is ticked. Never a password. */
const REMEMBER_KEY = 'bnf-hrms-remember-username';

const readRemembered = () => {
  try {
    return localStorage.getItem(REMEMBER_KEY) || '';
  } catch {
    // Private windows and locked-down browsers throw on even reading this.
    // A login screen must not fall over because a convenience is unavailable.
    return '';
  }
};

const writeRemembered = (username) => {
  try {
    if (username) localStorage.setItem(REMEMBER_KEY, username);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* same again: nice to have, never required */
  }
};

/* ---------- the small drawings ---------- */

const Icon = ({ d, filled = false }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d={d}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const FEATURES = [
  {
    title: 'Smart Attendance',
    note: 'Hours and short time, counted once.',
    d: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18ZM12 7v5l3.2 2',
  },
  {
    title: 'Leave Management',
    note: 'Applied, approved, then on the sheet.',
    d: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4M9 15.5l2 2 4-4',
  },
  {
    title: 'HR Compliance',
    note: 'PF, ESI and PT worked out, not guessed.',
    d: 'M12 3l7 3v5.5c0 4.3-2.9 7.7-7 9.5-4.1-1.8-7-5.2-7-9.5V6l7-3ZM9 12l2 2 4-4',
  },
  {
    title: 'People Analytics',
    note: 'Who is in, who is short, month by month.',
    d: 'M4 20V10M10 20V4M16 20v-7M22 20H3',
  },
];

/**
 * The server's own wording, made presentable. It deliberately answers a wrong
 * username and a wrong password with one lower-case sentence so neither can be
 * told apart; capitalising it for display changes how it reads, not what it
 * says, and the one message stays one message.
 */
const readable = (message) => {
  const text = String(message || '').trim();
  if (!text) return 'That did not work. Try again.';
  const capped = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
};

/** The brand half: logo, promise, and four things this does. */
function BrandPanel() {
  return (
    <section className="signin-brand">
      {/*
       * Drawn, not photographed. An aviation background off the internet would
       * be a request this app makes to somewhere else every time the login
       * screen opens, which is both a dependency and a thing to go wrong on a
       * server behind a tunnel. This is a few paths and costs nothing.
       */}
      <svg className="signin-sky" viewBox="0 0 600 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="bnfSky" x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0%" stopColor="#123F73" />
            <stop offset="100%" stopColor="#082B57" />
          </linearGradient>
        </defs>
        <rect width="600" height="700" fill="url(#bnfSky)" />
        {/* The decorative curve, navy over navy with one gold edge. */}
        <path d="M-60 622 Q 210 496 640 560 L 640 700 L -60 700 Z" fill="#06224a" opacity="0.55" />
        <path d="M-60 622 Q 210 496 640 560" fill="none" stroke="#E5AA32" strokeWidth="1.5" opacity="0.5" />
        <path d="M-60 667 Q 230 548 640 606" fill="none" stroke="#E5AA32" strokeWidth="0.75" opacity="0.22" />
        {/*
         * The flight path and the aircraft stay in the top-right corner, above
         * and to the right of where the wording sits. The first version drew a
         * long diagonal across the whole panel and parked a large aeroplane on
         * top of "FLY BEYOND" - decoration reading as a collision.
         */}
        <path
          d="M250 158 Q 360 136 452 100"
          fill="none"
          stroke="#ffffff"
          strokeWidth="1"
          strokeDasharray="5 9"
          opacity="0.16"
        />
        <g transform="translate(486 88) rotate(-22) scale(0.72)" opacity="0.3">
          <path
            d="M46 0 L22 -6 L14 -6 L-10 -30 L-18 -30 L-4 -5 L-24 -4 L-34 -15 L-40 -15 L-36 0 L-40 15 L-34 15 L-24 4 L-4 5 L-18 30 L-10 30 L14 6 L22 6 Z"
            fill="#ffffff"
          />
        </g>
      </svg>

      <div className="signin-brand-body">
        <div className="signin-mark">
          <span className="signin-plate">
            <img src={logoUrl} alt="Booknfly" />
          </span>
          <span className="signin-tagline">Fly Beyond</span>
        </div>

        <div className="signin-pitch">
          <h1>BOOKNFLY HRMS</h1>
          <p className="signin-kicker">People &middot; Performance &middot; Progress</p>
          <p className="signin-promise">Empowering Our People, Building a Better Tomorrow.</p>
        </div>

        <ul className="signin-features">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <span className="signin-feature-icon">
                <Icon d={f.d} />
              </span>
              <span className="signin-feature-text">
                <strong>{f.title}</strong>
                <span>{f.note}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default function Login({ onSignedIn, onError }) {
  const [state, setState] = useState(null);
  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({ username: '', password: '', name: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const usernameRef = useRef(null);
  const passwordRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/state', { credentials: 'same-origin' });
        const body = await res.json();
        setState(body);
        setMode(body.needs_setup ? 'setup' : 'signin');
        if (body.signed_in) onSignedIn(body.signed_in);
        else {
          const saved = readRemembered();
          if (saved && !body.needs_setup) {
            setRemember(true);
            setForm((f) => ({ ...f, username: saved }));
          }
        }
      } catch (err) {
        setProblem(err.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * A revealed password must not survive a change of screen - switching to the
   * dashboard-key screen with the characters still showing is how one gets
   * read over a shoulder.
   */
  useEffect(() => {
    setShowPassword(false);
    setProblem('');
    setHelpOpen(false);
  }, [mode]);

  const set = (patch) => setForm({ ...form, ...patch });

  const submit = async (e) => {
    e.preventDefault();
    setProblem('');

    /*
     * Say what is missing here rather than sending an empty username to the
     * server and showing its (deliberately vague) "those do not match". That
     * answer is right for a wrong password and unhelpful for an empty box.
     */
    if (mode !== 'key' && !form.username.trim()) {
      setProblem('Enter your username.');
      usernameRef.current?.focus();
      return;
    }
    if (!form.password) {
      setProblem(mode === 'key' ? 'Enter the dashboard password.' : 'Enter your password.');
      passwordRef.current?.focus();
      return;
    }
    if (mode === 'setup' && !form.name.trim()) {
      setProblem('Enter your name.');
      return;
    }

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
      // Only once it worked, and only ever the username.
      writeRemembered(remember ? form.username.trim() : '');
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

  if (!state) {
    return (
      <div className="signin signin-waiting">
        <div className="loading">Loading…</div>
      </div>
    );
  }

  const title =
    mode === 'setup' ? 'Set up BOOKNFLY HRMS' : mode === 'key' ? 'Dashboard password' : 'BOOKNFLY HRMS';
  const subtitle =
    mode === 'setup'
      ? 'Make the first login.'
      : mode === 'key'
        ? 'The key for machines.'
        : 'Sign in to continue';

  return (
    <div className="signin">
      <BrandPanel />

      <section className="signin-panel">
        <div className="signin-panel-inner">
          {/* The compact branding for a phone, where the panel above is hidden. */}
          <div className="signin-compact">
            <span className="signin-plate">
              <img src={logoUrl} alt="Booknfly" />
            </span>
            <span className="signin-compact-text">
              <strong>BOOKNFLY HRMS</strong>
              <span>Fly Beyond</span>
            </span>
          </div>

          <form className="signin-card" onSubmit={submit} noValidate>
            <span className="signin-badge" aria-hidden="true">
              <Icon d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0" />
            </span>

            <h1>{title}</h1>
            <p className="signin-sub">{subtitle}</p>

            {mode === 'setup' && (
              <p className="signin-note">
                Nobody has a login yet. Make the first one — it will be an <strong>Admin</strong>,
                which can add everybody else. This screen closes as soon as it is used.
              </p>
            )}

            {mode === 'key' && (
              <p className="signin-note">
                The old dashboard password, from <code>APP_PASSWORD</code>. It still works and
                gives full access — it is the key anything on a schedule uses. Once you have made
                a login, use that instead: it leaves your name on what you change.
              </p>
            )}

            {mode === 'setup' && (
              <label className="signin-field">
                <span>Your name</span>
                <input
                  value={form.name}
                  autoFocus
                  placeholder="Dinesh Parmar"
                  autoComplete="name"
                  onChange={(e) => set({ name: e.target.value })}
                />
              </label>
            )}

            {mode !== 'key' && (
              <label className="signin-field">
                <span>{mode === 'setup' ? 'Username' : 'Username / Employee code'}</span>
                <input
                  ref={usernameRef}
                  value={form.username}
                  autoFocus={mode === 'signin'}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck="false"
                  autoComplete="username"
                  placeholder={mode === 'setup' ? 'dinesh' : ''}
                  onChange={(e) => set({ username: e.target.value })}
                />
              </label>
            )}

            <label className="signin-field">
              <span>Password</span>
              <span className="signin-password">
                <input
                  ref={passwordRef}
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  autoFocus={mode === 'key'}
                  autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                  onChange={(e) => set({ password: e.target.value })}
                />
                <button
                  type="button"
                  className="signin-peek"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-pressed={showPassword}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <Icon d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.8 2.8M6.2 6.3A10.9 10.9 0 0 0 2 12s3.6 6.5 10 6.5a10 10 0 0 0 4.2-.9M9.9 5.6A10.6 10.6 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a18.4 18.4 0 0 1-3.1 4" />
                  ) : (
                    <Icon d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12ZM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
                  )}
                </button>
              </span>
            </label>

            {mode === 'setup' && (
              <label className="signin-field">
                <span>And again</span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={form.confirm}
                  autoComplete="new-password"
                  onChange={(e) => set({ confirm: e.target.value })}
                />
              </label>
            )}

            {mode === 'signin' && (
              <>
                <div className="signin-row">
                  <label className="signin-remember">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => {
                        setRemember(e.target.checked);
                        if (!e.target.checked) writeRemembered('');
                      }}
                    />
                    <span>Remember me</span>
                  </label>
                  <button
                    type="button"
                    className="signin-link"
                    onClick={() => setHelpOpen(!helpOpen)}
                    aria-expanded={helpOpen}
                  >
                    Forgot password?
                  </button>
                </div>
                {/* The question anybody ticking this actually has. */}
                <p className="signin-aside">
                  Fills in your username on this device. Your password is never stored.
                </p>
              </>
            )}

            {helpOpen && (
              <p className="signin-help">
                There is no self-service reset in this app, so nothing is emailed anywhere. Ask an
                admin to reset it in <strong>Admin → Logins</strong>: they get a one-time password
                to hand you, and you will be asked to choose your own the moment you sign in.
              </p>
            )}

            {problem && (
              <p className="signin-error" role="alert">
                <Icon d="M12 8v5M12 16.5v.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                <span>{readable(problem)}</span>
              </p>
            )}

            <button type="submit" className="signin-submit" disabled={busy}>
              {busy && <span className="signin-spinner" aria-hidden="true" />}
              {busy
                ? mode === 'setup'
                  ? 'Creating…'
                  : 'Signing in…'
                : mode === 'setup'
                  ? 'Create the first login'
                  : 'Sign In'}
            </button>

            <div className="signin-switch">
              {mode === 'setup' && (
                <button type="button" className="signin-link" onClick={() => setMode('key')}>
                  I have the dashboard password instead
                </button>
              )}
              {mode === 'key' && (
                <button
                  type="button"
                  className="signin-link"
                  onClick={() => setMode(state.needs_setup ? 'setup' : 'signin')}
                >
                  Back
                </button>
              )}
              {mode === 'signin' && state.open && (
                <span className="signin-open">
                  This app is running with nothing guarding it. Make a login to close that.
                </span>
              )}
            </div>
          </form>

          <footer className="signin-foot">
            <span>Booknfly Group &nbsp;|&nbsp; HRMS v1.0</span>
            <span>Together Towards Excellence</span>
          </footer>
        </div>
      </section>
    </div>
  );
}
