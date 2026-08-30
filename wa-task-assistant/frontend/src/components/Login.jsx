import { useState } from 'react';

export default function Login({ onSubmit, hadToken }) {
  const [password, setPassword] = useState('');

  return (
    <div className="app login">
      <h1>WA Tasks</h1>
      <p className="subtitle">
        {hadToken ? 'That password was rejected. Try again.' : 'Enter the dashboard password.'}
      </p>
      <form
        className="login-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (password.trim()) onSubmit(password.trim());
        }}
      >
        <input
          type="password"
          autoFocus
          value={password}
          placeholder="Dashboard password"
          onChange={(event) => setPassword(event.target.value)}
        />
        <button className="btn primary" type="submit">
          Unlock
        </button>
      </form>
    </div>
  );
}
