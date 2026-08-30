import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, UnauthorizedError } from './api.js';
import { enablePush, pushAlreadyEnabled, pushSupported } from './push.js';
import TaskList from './components/TaskList.jsx';
import AddTaskForm from './components/AddTaskForm.jsx';
import StatusBar from './components/StatusBar.jsx';
import Login from './components/Login.jsx';

const POLL_MS = 30_000;
const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'done', label: 'Done' },
  { key: 'all', label: 'All' },
];

export default function App() {
  const [filter, setFilter] = useState('open');
  const [tasks, setTasks] = useState([]);
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [needsAuth, setNeedsAuth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pushOn, setPushOn] = useState(false);

  const refresh = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setLoading(true);
      try {
        const [taskData, statusData] = await Promise.all([api.listTasks(filter), api.status()]);
        setTasks(taskData.tasks);
        setStats(taskData.stats);
        setStatus(statusData);
        setNeedsAuth(false);
        setError('');
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          setNeedsAuth(true);
        } else {
          setError(err.message);
        }
      } finally {
        setLoading(false);
      }
    },
    [filter]
  );

  // Poll so tasks Claude extracts from WhatsApp show up without a manual reload.
  useEffect(() => {
    refresh();
    const id = setInterval(() => refresh({ quiet: true }), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    pushAlreadyEnabled().then(setPushOn).catch(() => {});
  }, []);

  const act = useCallback(
    async (fn) => {
      try {
        await fn();
        await refresh({ quiet: true });
      } catch (err) {
        if (err instanceof UnauthorizedError) setNeedsAuth(true);
        else setError(err.message);
      }
    },
    [refresh]
  );

  const onAdd = (task) => act(() => api.createTask(task));
  const onToggle = (task) =>
    act(() => api.updateTask(task.id, { status: task.status === 'done' ? 'open' : 'done' }));
  const onDelete = (task) => act(() => api.deleteTask(task.id));
  const onEdit = (task, patch) => act(() => api.updateTask(task.id, patch));

  const onEnablePush = async () => {
    try {
      await enablePush();
      setPushOn(true);
    } catch (err) {
      setError(err.message);
    }
  };

  const overdueCount = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return tasks.filter((t) => t.status === 'open' && t.due_date && t.due_date < today).length;
  }, [tasks]);

  if (needsAuth) {
    return (
      <Login
        onSubmit={(password) => {
          setToken(password);
          setNeedsAuth(false);
          refresh();
        }}
        hadToken={Boolean(getToken())}
      />
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>WA Tasks</h1>
          <p className="subtitle">Tasks picked up from your WhatsApp, with reminders.</p>
        </div>
        <div className="header-actions">
          {pushSupported() && !pushOn && (
            <button className="btn ghost" onClick={onEnablePush}>
              Enable notifications
            </button>
          )}
          <button className="btn ghost" onClick={() => refresh()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <StatusBar status={status} stats={stats} overdueCount={overdueCount} />

      {error && (
        <div className="banner error" role="alert">
          {error}
          <button className="link" onClick={() => setError('')}>
            dismiss
          </button>
        </div>
      )}

      <AddTaskForm onAdd={onAdd} />

      <nav className="filters" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            className={`filter ${filter === f.key ? 'active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </nav>

      <TaskList
        tasks={tasks}
        loading={loading}
        onToggle={onToggle}
        onDelete={onDelete}
        onEdit={onEdit}
      />
    </div>
  );
}
