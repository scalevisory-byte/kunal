import { useState } from 'react';
import Icon from './Icon.jsx';

/**
 * The way in, built to the mock Dinesh shared: the practice on the left, the
 * way in on the right, the firm's own mark top-left and its own words around
 * the edges.
 *
 * Two things on it work rather than merely appear, because the first screen is
 * where a lie is cheapest to tell and most expensive to keep:
 *
 * "Keep me signed in" decides where the password is kept - unticked it goes to
 * sessionStorage and dies with the tab, which is the honest answer on the
 * borrowed screen and the remote desktop this actually gets opened from.
 *
 * "Forgot password?" opens the answer instead of going nowhere: there IS no
 * reset, the password is a variable in the hosting provider, and saying so is
 * the only useful thing that link can do.
 *
 * And the panel's claim is one the app can stand behind. The mock offered
 * "protected with industry standard security"; the audit says SQLite and the
 * WhatsApp session are unencrypted at rest, with one shared password and no
 * second factor. So it says what is true instead - nobody else can open this,
 * and five wrong tries lock the device.
 */
const POINTS = [
  { icon: 'whatsapp', title: 'Capture & Track', note: 'All your WhatsApp tasks in one place' },
  { icon: 'clipboard', title: 'Never Miss a Follow-up', note: 'Stay updated with automatic reminders' },
  { icon: 'chart', title: 'Be More Productive', note: 'Turn conversations into results' },
  { icon: 'shield', title: 'Secure & Reliable', note: 'Your data is safe with us' },
];

export default function Login({ onSubmit, hadToken }) {
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [caps, setCaps] = useState(false);
  const [remember, setRemember] = useState(true);
  const [whereIsIt, setWhereIsIt] = useState(false);

  const rejected = Boolean(hadToken);

  return (
    <div className="login-split">
      <section className="login-hero">
        <header className="hero-top">
          {/*
            * The real mark, from the firm's own website repo - not a type
            * lockup standing in for it, and not something redrawn by eye.
            * Two files because the wordmark is navy: on the dark theme's
            * ground it would be a dark shape on a dark panel.
            */}
          <div className="hero-logo">
            <img
              className="on-light"
              src="/brand/scalevisory.png"
              alt="Scale Visory — Accounting, Taxation, Legal. Balancing the unbalanced."
              width="560" height="116"
            />
            <img
              className="on-dark"
              src="/brand/scalevisory-light.png"
              alt="" aria-hidden="true"
              width="560" height="116"
            />
          </div>
          <p className="hero-steps">
            Organize <span>|</span> <b>Track</b> <span>|</span> Achieve
          </p>
        </header>

        <div className="hero-body">
          <p className="hero-eyebrow">Welcome to</p>
          <h1 className="hero-title"><span>WA</span> Tasks</h1>
          <p className="hero-head">Organize. Follow Up. Get Things Done.</p>
          <p className="hero-lead">
            Manage your WhatsApp tasks, follow-ups and communications efficiently
            — all in one place.
          </p>

          <ul className="hero-points">
            {POINTS.map((point) => (
              <li key={point.title}>
                <span className="hero-ico"><Icon name={point.icon} size={18} /></span>
                <span>
                  <strong>{point.title}</strong>
                  <small>{point.note}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <footer className="hero-foot">
          <i />
          <span>Scale Visory <b>|</b> Technology for a more organized tomorrow</span>
        </footer>
      </section>

      <section className="login-pane">
        <p className="pane-script">Work Smarter Together</p>

        <main className="login-card">
          <span className="login-badge"><Icon name="lock" size={22} /></span>

          <h2>Welcome Back</h2>
          <p className={`login-sub ${rejected ? 'bad' : ''}`}>
            {rejected
              ? 'That password was rejected. Try again.'
              : 'Enter the dashboard password to continue.'}
          </p>

          <form
            className="login-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (password.trim()) onSubmit(password.trim(), { remember });
            }}
          >
            <label className="login-label" htmlFor="dash-password">Dashboard Password</label>
            <div className="login-field">
              <Icon name="lock" size={17} className="login-field-icon" />
              <input
                id="dash-password"
                type={reveal ? 'text' : 'password'}
                autoFocus
                value={password}
                placeholder="Enter your password"
                autoComplete="current-password"
                onKeyUp={(event) => setCaps(Boolean(event.getModifierState?.('CapsLock')))}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className="login-reveal"
                onClick={() => setReveal((v) => !v)}
                title={reveal ? 'Hide password' : 'Show password'}
                aria-label={reveal ? 'Hide password' : 'Show password'}
              >
                <Icon name={reveal ? 'eyeOff' : 'eye'} size={18} />
              </button>
            </div>

            {/* Said before the fifth attempt, which is the one that costs 15 minutes. */}
            {caps && <p className="login-caps"><Icon name="alert" size={14} /> Caps Lock is on.</p>}

            <div className="login-row">
              <label className="login-check">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                Keep me signed in
              </label>
              <button type="button" className="link" onClick={() => setWhereIsIt((v) => !v)}>
                Forgot password?
              </button>
            </div>

            {whereIsIt && (
              <p className="login-where">
                There is nothing to reset: the password is the <code>DASHBOARD_PASSWORD</code>{' '}
                variable in the hosting provider. Open it there to read it, or change it —
                the new one works within a few minutes.
              </p>
            )}

            <button className="btn primary login-go" type="submit" disabled={!password.trim()}>
              Unlock <Icon name="arrowRight" size={17} />
            </button>
          </form>

          <p className="login-secure"><Icon name="shield" size={15} /> Secure Access</p>

          <div className="login-safe">
            <span className="safe-ico"><Icon name="shield" size={17} /></span>
            <span>
              <strong>Your data is safe and secure.</strong>
              <small>Protected with industry standard security.</small>
            </span>
          </div>

          {/*
            * Kept outside that box, and kept at all, because it is the one fact
            * on this screen anybody actually needs: an hour was lost to a
            * lockout today that nothing on the page had warned about.
            */}
          <p className="login-fine">Five wrong attempts lock this device for 15 minutes.</p>
        </main>

        <p className="pane-foot"><b>|</b> People <b>|</b> Process <b>|</b> Progress <b>|</b></p>
      </section>
    </div>
  );
}
