import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, UnauthorizedError } from './api.js';
import { enablePush, pushAlreadyEnabled, pushSupported } from './push.js';
import TaskList from './components/TaskList.jsx';
import AddTaskForm from './components/AddTaskForm.jsx';
import StatusBar from './components/StatusBar.jsx';
import Login from './components/Login.jsx';
import StatBoard from './components/StatBoard.jsx';
import BlockedChats from './components/BlockedChats.jsx';
import Toolbar from './components/Toolbar.jsx';
import TaskDetail from './components/TaskDetail.jsx';
import { isDone, isOverdue, isoDay, matchesQuery, taskChat, todayIso } from './lib/task.js';

const EMPTY_FILTERS = { status: [], priority: [], origin: [], chat: null };

const remember = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch { /* private window, or site data blocked */ }
};

const POLL_MS = 30_000;
// WhatsApp rotates the linking QR about every 20s, so a 30s poll shows an
// already-dead code. While one is on screen, refresh fast enough to stay ahead.
const QR_POLL_MS = 5_000;
export default function App() {
  // Which slice of work is on screen. Driven by the dashboard cells.
  const [view, setView] = useState('open');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [openTask, setOpenTask] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState(null);
  // How the board is split into columns. Remembered per browser.
  const [groupBy, setGroupBy] = useState(() => {
    try {
      return localStorage.getItem('wa-tasks-group') || 'date';
    } catch {
      return 'date'; // private window, or site data blocked
    }
  });
  const [error, setError] = useState('');
  const [needsAuth, setNeedsAuth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pushOn, setPushOn] = useState(false);

  const refresh = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setLoading(true);
      try {
        const [taskData, statusData] = await Promise.all([api.listTasks('all'), api.status()]);
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
    []
  );

  // Poll so tasks Claude extracts from WhatsApp show up without a manual reload.
  const waitingForScan = status?.whatsapp?.status === 'qr';
  useEffect(() => {
    refresh();
    const id = setInterval(
      () => refresh({ quiet: true }),
      waitingForScan ? QR_POLL_MS : POLL_MS
    );
    return () => clearInterval(id);
  }, [refresh, waitingForScan]);

  useEffect(() => {
    pushAlreadyEnabled().then(setPushOn).catch(() => {});
  }, []);

  useEffect(() => {
    setOpenTask((current) => (current ? tasks.find((t) => t.id === current.id) || null : null));
  }, [tasks]);

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
  const onDelete = (task) => {
    setOpenTask(null);
    return act(() => api.deleteTask(task.id));
  };
  const onEdit = (task, patch) => {
    // Keep the open panel showing what was just changed, without a round trip.
    setOpenTask((current) => (current?.id === task.id ? { ...current, ...patch } : current));
    return act(() => api.updateTask(task.id, patch));
  };
  const onQuickDate = (task, offset) => onEdit(task, { due_date: isoDay(offset) });

  const onEnablePush = async () => {
    try {
      await enablePush();
      setPushOn(true);
    } catch (err) {
      setError(err.message);
    }
  };

  const overdueCount = useMemo(() => tasks.filter(isOverdue).length, [tasks]);

  // Chats that actually have tasks, most first - the filter offers only these.
  const chats = useMemo(() => {
    const counts = new Map();
    for (const task of tasks) {
      const name = taskChat(task);
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [tasks]);

  const visible = useMemo(() => {
    const today = todayIso();
    return tasks.filter((task) => {
      if (view === 'open' && isDone(task)) return false;
      if (view === 'in_progress' && task.status !== 'in_progress') return false;
      if (view === 'overdue' && !isOverdue(task)) return false;
      if (view === 'done' && !isDone(task)) return false;
      if (view === 'myday' && isDone(task)) return false;

      if (filters.status.length && !filters.status.includes(task.status)) return false;
      if (filters.priority.length && !filters.priority.includes(task.priority)) return false;
      if (filters.origin.length && !filters.origin.includes(task.origin)) return false;
      if (filters.chat && taskChat(task) !== filters.chat) return false;

      return matchesQuery(task, query);
    });
  }, [tasks, view, filters, query]);

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
        <h1>WA Tasks</h1>
        <div className="header-actions">
          {pushSupported() && !pushOn && (
            <button className="btn ghost" onClick={onEnablePush}>
              Notifications
            </button>
          )}
          <button className="btn ghost" onClick={() => refresh()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <StatBoard stats={stats} overdueCount={overdueCount} view={view} onPick={setView} />

      <StatusBar status={status} stats={stats} overdueCount={overdueCount} />

      {error && (
        <div className="banner error" role="alert">
          {error}
          <button className="link" onClick={() => setError('')}>
            dismiss
          </button>
        </div>
      )}

      <BlockedChats
        mode={status?.whatsapp?.mode}
        onError={(err) => setError(err.message)}
      />

      <AddTaskForm onAdd={onAdd} />

      <div className="views">
        {[
          { key: 'myday', label: 'My day' },
          { key: 'open', label: 'Open' },
          { key: 'all', label: 'All' },
        ].map((v) => (
          <button
            key={v.key}
            className={`filter ${view === v.key ? 'active' : ''}`}
            aria-pressed={view === v.key}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>

      <Toolbar
        query={query}
        onQuery={setQuery}
        groupBy={groupBy}
        onGroupBy={(g) => {
          setGroupBy(g);
          remember('wa-tasks-group', g);
        }}
        filters={filters}
        onFilters={setFilters}
        chats={chats}
      />

      <TaskList
        tasks={visible}
        loading={loading}
        error={error && !tasks.length ? error : ''}
        groupBy={groupBy}
        view={view}
        onRetry={() => refresh()}
        onToggle={onToggle}
        onOpen={setOpenTask}
        onQuickDate={onQuickDate}
      />

      {openTask && (
        <TaskDetail
          task={openTask}
          onClose={() => setOpenTask(null)}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}

    </div>
  );
}
