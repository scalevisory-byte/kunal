import { useState } from 'react';
import Icon from './Icon.jsx';

/**
 * The way in.
 *
 * It was a heading, a line of grey text and a field, pinned to the top-left
 * corner of an empty white page - the one screen somebody sees before they see
 * anything else, and the only one that looked unfinished. It is a centred card
 * now, on the same navy-and-white system as the rest of the app.
 *
 * The two controls on it are not decoration, they come straight from a real
 * hour lost: five wrong attempts locked the dashboard for fifteen minutes, and
 * every one of them was a typing mistake nobody could see. So the password can
 * be shown, and Caps Lock says so before the fifth try, not after.
 */
export default function Login({ onSubmit, hadToken }) {
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [caps, setCaps] = useState(false);

  const rejected = Boolean(hadToken);

  return (
    <div className="login-page">
      <main className="login-card">
        <div className="login-brand">
          <span className="side-mark"><Icon name="whatsapp" size={22} /></span>
          <span className="login-name">
            <strong>WA Tasks</strong>
            <small>Task management</small>
          </span>
        </div>

        <h1>Welcome back</h1>
        <p className={`login-sub ${rejected ? 'bad' : ''}`}>
          {rejected
            ? 'That password was rejected. Try again.'
            : 'Enter your dashboard password to continue.'}
        </p>

        <form
          className="login-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (password.trim()) onSubmit(password.trim());
          }}
        >
          <div className="login-field">
            <Icon name="lock" size={17} className="login-field-icon" />
            <input
              type={reveal ? 'text' : 'password'}
              autoFocus
              value={password}
              placeholder="Dashboard password"
              aria-label="Dashboard password"
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

          <button className="btn primary login-go" type="submit" disabled={!password.trim()}>
            Unlock
          </button>
        </form>

        <p className="login-foot">
          Five wrong attempts lock this device for 15 minutes.
        </p>
      </main>
    </div>
  );
}
