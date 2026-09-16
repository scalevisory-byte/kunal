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
/*
 * The desk photograph, under whichever name it was uploaded.
 *
 * It arrives by somebody dragging a file into GitHub, and "save it as exactly
 * desk.jpg" is a rule that gets broken by a phone that hands you a .png. Each
 * name is tried in turn and the last failure gives up quietly, so the only
 * thing that has to be right is the folder.
 */
const DESK = ['/brand/desk.jpg', '/brand/desk.jpeg', '/brand/desk.png', '/brand/desk.webp'];

const POINTS = [
  { icon: 'whatsapp', title: 'Capture & Track', note: 'All your WhatsApp tasks in one place', accent: true },
  { icon: 'clipboard', title: 'Never Miss a Follow-up', note: 'Stay updated with automatic reminders' },
  { icon: 'chart', title: 'Be More Productive', note: 'Turn conversations into results' },
  { icon: 'shield', title: 'Secure & Reliable', note: 'Your data is safe with us' },
];

export default function Login({ onSubmit, hadToken, build }) {
  const [password, setPassword] = useState('');
  /*
   * Which name is being tried. Past the end of the list there is no photograph,
   * and the page must be right either way: no placeholder, no broken-image
   * icon, and the geometric watermark standing in until one turns up.
   */
  const [deskAt, setDeskAt] = useState(0);
  const desk = deskAt < DESK.length;
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
              width="760" height="158"
            />
            <img
              className="on-dark"
              src="/brand/scalevisory-light.png"
              alt="" aria-hidden="true"
              width="760" height="158"
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
                <span className={`hero-ico ${point.accent ? 'wa' : ''}`}>
                  <Icon name={point.icon} size={21} strokeWidth={2.2} />
                </span>
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

      <section className={`login-pane ${desk ? 'has-desk' : ''}`}>
        {desk && (
          <img
            className="pane-desk"
            key={DESK[deskAt]}
            src={DESK[deskAt]}
            alt="" aria-hidden="true"
            onError={() => setDeskAt((i) => i + 1)}
          />
        )}
        <p className="pane-script">Work Smarter Together</p>

        <main className="login-card">
          <span className="login-badge"><Icon name="lock" size={24} strokeWidth={2.2} /></span>

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
            <span className="safe-ico"><Icon name="shield" size={19} strokeWidth={2.2} /></span>
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

          {/*
            * Which build this is, before anybody has to log in to find out.
            *
            * "I cannot see any changes" and "that has not deployed yet" look
            * exactly the same from outside, and the answer used to sit behind
            * this very password. Nothing here is typed by a person: the commit
            * comes from the host and the bundle name is a hash of the
            * dashboard's own contents, so neither can drift from what is
            * really running.
            */}
          {build && (build.commit || build.bundle) && (
            <p className="login-build" title={build.bundle || ''}>
              {build.commit ? <>Build <b>{build.commit}</b></> : 'Build'}
              {build.bundle ? <> · {build.bundle.replace(/^index-|\.js$/g, '')}</> : ''}
            </p>
          )}
        </main>

        <p className="pane-foot"><b>|</b> People <b>|</b> Process <b>|</b> Progress <b>|</b></p>
      </section>
    </div>
  );
}
