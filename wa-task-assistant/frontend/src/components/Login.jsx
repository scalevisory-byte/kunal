import { useState } from 'react';
import Icon from './Icon.jsx';

/**
 * The way in.
 *
 * It was a heading and a field in the corner of a blank page; then a centred
 * card; now the whole page, because this is the one screen that is seen before
 * anything else and it carries the practice's name.
 *
 * Two things on it deliberately do NOT follow the mock this was built from:
 *
 * "Keep me signed in" is real - unticked, the password lives in sessionStorage
 * and dies with the tab, which is the honest answer on the borrowed screen and
 * the remote desktop this actually gets opened from. A checkbox that changed
 * nothing would be worse than no checkbox.
 *
 * And there is no "Forgot password?", because there is no reset: the password
 * is a variable in the hosting provider. Saying where it lives is useful; a
 * link that goes nowhere is a lie told on the first screen.
 */
const POINTS = [
  { icon: 'whatsapp', title: 'Capture & track', note: 'Every WhatsApp task in one place' },
  { icon: 'clock', title: 'Never miss a follow-up', note: 'Reminders that keep asking until it is done' },
  { icon: 'chart', title: 'Get more done', note: 'Conversations turned into work you can see' },
  { icon: 'shield', title: 'Yours alone', note: 'One password, and nothing is sent to anybody else' },
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
          <div className="hero-brand">
            <strong>SCALE VISORY</strong>
            <span>Accounting · Taxation · Legal</span>
            <em>Balancing the unbalanced</em>
          </div>
          <p className="hero-steps"><b>Organise</b> · Track · Achieve</p>
        </header>

        <div className="hero-body">
          <p className="hero-eyebrow">Welcome to</p>
          <h1 className="hero-title"><span>WA</span> Tasks</h1>
          <p className="hero-lead">
            Your WhatsApp tasks, follow-ups and deadlines — read, sorted and chased
            for you.
          </p>

          <ul className="hero-points">
            {POINTS.map((point) => (
              <li key={point.title}>
                <span className="hero-ico"><Icon name={point.icon} size={19} /></span>
                <span>
                  <strong>{point.title}</strong>
                  <small>{point.note}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <footer className="hero-foot">
          Scale Visory · Vadodara &amp; Surat
        </footer>
      </section>

      <section className="login-pane">
        <main className="login-card">
          <span className="login-badge"><Icon name="lock" size={22} /></span>

          <h2>Welcome back</h2>
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
            <label className="login-label" htmlFor="dash-password">Dashboard password</label>
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
                Forgotten it?
              </button>
            </div>

            {whereIsIt && (
              <p className="login-where">
                There is no reset link, because there is nothing to reset: the password is
                the <code>DASHBOARD_PASSWORD</code> variable in the hosting provider.
                Open it there to read it, or change it — the new one works within a
                few minutes.
              </p>
            )}

            <button className="btn primary login-go" type="submit" disabled={!password.trim()}>
              Unlock <Icon name="arrowRight" size={17} />
            </button>
          </form>

          <p className="login-note">
            <Icon name="shield" size={17} />
            <span>
              This password is the only way in. Five wrong attempts lock the device
              for fifteen minutes.
            </span>
          </p>
        </main>
      </section>
    </div>
  );
}
