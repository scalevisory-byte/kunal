import { useState } from 'react';

export default function Login({ onSubmit, error }) {
  const [password, setPassword] = useState('');

  return (
    <div className="login">
      <form
        className="card login-card"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(password);
        }}
      >
        <h1>Salary Sheet</h1>
        <p className="muted">Enter the dashboard password to continue.</p>
        <input
          type="password"
          value={password}
          autoFocus
          placeholder="Password"
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary">Open</button>
      </form>
    </div>
  );
}
