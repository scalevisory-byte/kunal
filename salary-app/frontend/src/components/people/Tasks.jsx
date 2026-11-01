import { useEffect, useState } from 'react';
import { api } from '../../api.js';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Work given to somebody, with a date it is wanted by.
 *
 * Not the same thing as Dinesh's WhatsApp task assistant, which reads his own
 * messages — this is office work assigned to staff, and each person sees their
 * own on the link they punch from and can tick it off there.
 *
 * `overdue` is worked out on read rather than stored, so a list left open
 * overnight is right in the morning.
 */
export default function Tasks({ employees, onError }) {
  const [tasks, setTasks] = useState([]);
  const [status, setStatus] = useState('open');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    employee_id: '',
    title: '',
    detail: '',
    due_on: '',
    priority: 'normal',
    assigned_by: '',
  });

  const load = async (filter = status) => {
    try {
      const { tasks: list } = await api.get(`/people/tasks${filter ? `?status=${filter}` : ''}`);
      setTasks(list);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const save = async () => {
    if (!draft.title.trim()) return;
    try {
      await api.post('/people/tasks', draft);
      setDraft({ ...draft, title: '', detail: '', due_on: '' });
      setAdding(false);
      load();
    } catch (err) {
      onError(err);
    }
  };

  const setStatusOf = async (task, next, note) => {
    try {
      await api.post(`/people/tasks/${task.id}/status`, { status: next, note });
      load();
    } catch (err) {
      onError(err);
    }
  };

  const open = tasks.filter((t) => t.status === 'open');
  const overdue = open.filter((t) => t.overdue);

  return (
    <section className="stack">
      <div className="figures">
        <div className="figure">
          <span className="k">Open</span>
          <span className="n">{open.length}</span>
        </div>
        <div className="figure">
          <span className="k">Past their date</span>
          <span className="n">{overdue.length}</span>
        </div>
      </div>

      <div className="toolbar">
        <div className="sub-tabs toolbar">
          {[['open', 'Open'], ['done', 'Done'], ['dropped', 'Dropped'], ['', 'Everything']].map(
            ([value, label]) => (
              <button key={value} className={status === value ? 'active' : undefined} onClick={() => setStatus(value)}>
                {label}
              </button>
            )
          )}
        </div>
        <button className="ghost" onClick={() => setAdding(!adding)}>
          {adding ? 'Cancel' : 'Give somebody a job'}
        </button>
      </div>

      {adding && (
        <div className="card">
          <div className="form-grid">
            <label>
              Who
              <select value={draft.employee_id} onChange={(e) => setDraft({ ...draft, employee_id: e.target.value })}>
                <option value="">Nobody in particular</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Wanted by
              <input type="date" value={draft.due_on} onChange={(e) => setDraft({ ...draft, due_on: e.target.value })} />
            </label>
            <label>
              How urgent
              <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </label>
            <label>
              Given by
              <input
                type="text"
                value={draft.assigned_by}
                onChange={(e) => setDraft({ ...draft, assigned_by: e.target.value })}
              />
            </label>
          </div>
          <label className="block">
            What
            <input
              type="text"
              value={draft.title}
              placeholder="Collect the PF challan receipts for September"
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="block">
            Anything more
            <textarea rows="2" value={draft.detail} onChange={(e) => setDraft({ ...draft, detail: e.target.value })} />
          </label>
          <button onClick={save} disabled={!draft.title.trim()}>
            Give it
          </button>
        </div>
      )}

      {!tasks.length ? (
        <p className="muted small">Nothing here.</p>
      ) : (
        <table className="sheet">
          <thead>
            <tr>
              <th>Wanted by</th>
              <th>Who</th>
              <th>What</th>
              <th>Urgency</th>
              <th>Where it stands</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td className={task.overdue ? 'overdue' : undefined}>{task.due_on || '—'}</td>
                <td className="sticky-name">{task.employee_name || <span className="muted">unassigned</span>}</td>
                <td>
                  {task.title}
                  {task.detail && <div className="muted small">{task.detail}</div>}
                  {task.done_note && <div className="muted small">done: {task.done_note}</div>}
                </td>
                <td>{task.priority === 'normal' ? '' : <span className={`pill ${task.priority}`}>{task.priority}</span>}</td>
                <td>
                  <span className={`pill ${task.status}`}>{task.status}</span>
                  {task.done_on && <div className="muted small">{task.done_on}</div>}
                </td>
                <td>
                  {task.status === 'open' ? (
                    <>
                      <button onClick={() => setStatusOf(task, 'done')}>Done</button>{' '}
                      <button className="ghost small" onClick={() => setStatusOf(task, 'dropped')}>
                        drop
                      </button>
                    </>
                  ) : (
                    <button className="ghost small" onClick={() => setStatusOf(task, 'open')}>
                      put it back
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
