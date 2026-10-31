import { useState } from 'react';
import { api } from '../../api.js';

/** The office's own list. Scheduling an interview adds one of these by itself. */
export default function Followups({ followups, digest, onReload, onOpen, onError, onToast }) {
  const [filter, setFilter] = useState('open');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');

  const today = new Date().toISOString().slice(0, 10);
  const shown = followups.filter((f) => (filter ? f.status === filter : true));

  const add = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await api.post('/hiring/tasks', { title, due_on: due || null });
      setTitle('');
      setDue('');
      onReload();
    } catch (err) {
      onError(err);
    }
  };

  const set = async (id, body) => {
    try {
      await api.patch(`/hiring/tasks/${id}`, body);
      onReload();
    } catch (err) {
      onError(err);
    }
  };

  return (
    <>
      <div className="card">
        <form className="row" onSubmit={add}>
          <input
            value={title}
            placeholder="Ring Rohit about his notice period…"
            style={{ flex: 1, minWidth: '14rem' }}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <button className="primary" type="submit">
            Add
          </button>
        </form>
      </div>

      <div className="row" style={{ marginBottom: '0.8rem' }}>
        <div className="chips">
          {[['open', 'Open'], ['done', 'Done'], ['', 'All']].map(([key, label]) => (
            <button
              key={key || 'all'}
              className={`chip ${filter === key ? 'active' : ''}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {digest ? (
          <>
            <a className="btn" href={digest.whatsapp || '#'} target="_blank" rel="noreferrer">
              Send today&apos;s list to myself
            </a>
            <button
              onClick={async () => {
                await navigator.clipboard?.writeText(digest.text);
                onToast('Copied');
              }}
            >
              Copy it
            </button>
          </>
        ) : null}
      </div>

      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>What</th>
              <th>Due</th>
              <th>Who</th>
              <th>Priority</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((f) => (
              <tr key={f.id}>
                <td>{f.title}</td>
                <td className="num small">
                  {f.due_on ? (
                    <span style={{ color: f.due_on < today && f.status === 'open' ? 'var(--bad)' : undefined }}>
                      {f.due_on}
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="small">
                  {f.application_id ? (
                    <button className="link" onClick={() => onOpen(f.application_id)}>
                      {f.candidate_name || 'open'}
                    </button>
                  ) : (
                    f.candidate_name || <span className="muted">—</span>
                  )}
                </td>
                <td className="small">{f.priority}</td>
                <td className="right">
                  {f.status === 'open' ? (
                    <button className="tiny" onClick={() => set(f.id, { status: 'done' })}>
                      Done
                    </button>
                  ) : (
                    <button className="tiny" onClick={() => set(f.id, { status: 'open', done_at: null })}>
                      Reopen
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length ? <p className="empty">Nothing here.</p> : null}
      </div>
    </>
  );
}
