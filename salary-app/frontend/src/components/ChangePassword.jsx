import { useState } from 'react';
import { api } from '../api.js';

/*
 * Choosing your own password, on first use or afterwards.
 *
 * Every login this app makes for somebody else - a staff login handed over on
 * a slip of paper, or an admin reset - is created with `must_change` set. Until
 * this screen existed that flag was stored, shown on the admin list, and never
 * acted on: the one-time password kept working for ever, while the screen that
 * handed it over said in as many words that it had to be changed on first use.
 *
 * So when `must_change` is set this stands in front of the whole app, for the
 * office and for staff alike. There is no "later": the point of a password
 * somebody else has read out is that it stops working.
 *
 * `forced` also decides what the server asks for - `setPassword` wants the
 * CURRENT password from anybody changing their own voluntarily, and cannot ask
 * for it here, because the password being replaced is the one on the slip.
 */
export default function ChangePassword({ me, forced = false, onDone, onCancel }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const save = async () => {
    setProblem('');
    if (password !== again) {
      setProblem('The two do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/password', forced ? { password } : { current, password });
      await onDone();
    } catch (err) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={forced ? 'login' : undefined}>
      <div className="card login-card">
        <h2>{forced ? 'Choose your own password' : 'Change your password'}</h2>
        {forced ? (
          <p className="muted small">
            {me?.name ? `${me.name}, the ` : 'The '}password you were given was written down and
            handed over, so it is not yours yet. Pick one only you know — it is the one you sign
            in with from now on.
          </p>
        ) : null}

        {!forced ? (
          <label className="field">
            The password you use now
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
        ) : null}
        <label className="field">
          New password
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="field">
          Type it again
          <input
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </label>

        <div className="row" style={{ marginTop: '0.6rem' }}>
          <button
            className="primary"
            disabled={busy || !password || !again || (!forced && !current)}
            onClick={save}
          >
            {busy ? 'Saving…' : 'Save it'}
          </button>
          {!forced && onCancel ? <button onClick={onCancel}>Leave it</button> : null}
          {problem ? <span className="muted small" style={{ color: 'var(--bad)' }}>{problem}</span> : null}
        </div>
        <p className="muted small">
          Nobody in the office can read it back — it is kept as a hash, not as the word you
          typed. If it is forgotten, the office makes a new one and you land back on this screen.
        </p>
      </div>
    </div>
  );
}
