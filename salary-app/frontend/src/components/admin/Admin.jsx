import { useState } from 'react';
import { STANDALONE } from '../../api.js';
import Backups from './Backups.jsx';
import Branches from './Branches.jsx';
import Logins from './Logins.jsx';
import Settings from './Settings.jsx';
import Users from './Users.jsx';
import StaffLogins from './StaffLogins.jsx';

const PANELS = [
  ['users', 'Logins'],
  ['staff', 'Staff logins'],
  ['branches', 'Branches'],
  ['settings', 'Month settings'],
  ['backups', 'Backups'],
  ['logins', 'Sign-ins'],
];

/**
 * The Admin tab: who can get in, where the branches are, and the backups.
 *
 * Only shown to an Admin, but that is a convenience rather than the control —
 * the server refuses these calls by role whoever asks, so hiding the tab is the
 * second line of defence and not the first.
 */
export default function Admin({ me, companies, period, locked, onPatchPeriod, onError, onReload }) {
  const [panel, setPanel] = useState('users');

  if (STANDALONE) {
    return (
      <section className="card">
        <h2>Admin</h2>
        <p className="muted small">
          Logins, roles, branches, backups and <strong>staff logins</strong> need the server
          version. This single file has no server to sign in to and keeps its own copy of
          everything in this browser — so there is nothing for an employee to sign in TO, and
          anybody holding the file holds the whole payroll. Use Reports → Backup to take a copy
          of it.
        </p>
      </section>
    );
  }

  if (!me?.abilities?.includes('admin')) {
    return (
      <section className="card">
        <h2>Admin</h2>
        <p className="muted small">
          Your login is <strong>{me?.role || 'not an admin'}</strong>, so this is not yours to
          change. Ask an Admin.
        </p>
      </section>
    );
  }

  return (
    <section className="stack">
      <div className="sub-tabs toolbar">
        {PANELS.map(([key, label]) => (
          <button key={key} className={panel === key ? 'active' : undefined} onClick={() => setPanel(key)}>
            {label}
          </button>
        ))}
      </div>

      {panel === 'users' && <Users me={me} onError={onError} />}
      {panel === 'staff' && <StaffLogins onError={onError} />}
      {panel === 'branches' && <Branches companies={companies} onError={onError} onReload={onReload} />}
      {panel === 'settings' && <Settings period={period} locked={locked} onPatch={onPatchPeriod} />}
      {panel === 'backups' && <Backups onError={onError} />}
      {panel === 'logins' && <Logins onError={onError} />}
    </section>
  );
}
