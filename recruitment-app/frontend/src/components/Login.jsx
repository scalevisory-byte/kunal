import { useState } from 'react';

export default function Login({ onSubmit, error, brand }) {
  const [password, setPassword] = useState('');

  return (
    <div className="login">
      <h1>{brand || 'Recruitment'}</h1>
      <p className="muted small">The recruiter side. Candidates never see this.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(password);
        }}
      >
        <input
          type="password"
          value={password}
          autoFocus
          placeholder="Password"
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="primary" type="submit">
          Open
        </button>
        {error ? <p className="small" style={{ color: 'var(--bad)' }}>{error}</p> : null}
      </form>
    </div>
  );
}
