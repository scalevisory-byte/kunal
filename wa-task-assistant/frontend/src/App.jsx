import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import Header from './components/Header.jsx';
import QuickActions from './components/QuickActions.jsx';
import SideRail from './components/SideRail.jsx';
import MobileNav from './components/MobileNav.jsx';
import { useInstall } from './lib/install.js';
import { isDone, isOverdue, isoDay, matchesQuery, taskChat, todayIso } from './lib/task.js';
import { activity, chatCounts, greeting, summarise } from './lib/derive.js';

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
  // A day picked in the calendar narrows the board to that date.
  const [selectedDate, setSelectedDate] = useState(null);
  const [composing, setComposing] = useState(false);
  const railRef = useRef(null);
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
  const install = useInstall();

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
      if (selectedDate && task.due_date !== selectedDate) return false;

      return matchesQuery(task, query);
    });
  }, [tasks, view, filters, query, selectedDate]);

  const summary = useMemo(() => summarise(tasks), [tasks]);
  const recent = useMemo(() => activity(tasks), [tasks]);

  /** Quick actions and rail rows drive the same state the toolbar does. */
  const quickAction = (key) => {
    setSelectedDate(null);
    if (key === 'myday') return setView('myday');
    if (key === 'done') return setView('done');
    if (key === 'chat') return setGroupBy('chat');
    if (key === 'high') {
      setView('open');
      return setFilters({ ...EMPTY_FILTERS, priority: ['high'] });
    }
    if (key === 'ai') {
      setView('open');
      return setFilters({ ...EMPTY_FILTERS, origin: ['ai'] });
    }
    return undefined;
  };

  const activeQuick =
    view === 'myday' ? 'myday'
      : view === 'done' ? 'done'
        : filters.priority.length === 1 && filters.priority[0] === 'high' ? 'high'
          : filters.origin.length === 1 && filters.origin[0] === 'ai' ? 'ai'
            : groupBy === 'chat' ? 'chat' : null;

  const showUpcoming = (key) => {
    setView('open');
    setFilters(EMPTY_FILTERS);
    setSelectedDate(key === 'tomorrow' ? isoDay(1) : null);
  };

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

  const name = status?.whatsapp?.meName?.split(' ')[0] || null;

  return (
    <div className="app">
      <Header
        query={query}
        onQuery={setQuery}
        onRefresh={() => refresh()}
        loading={loading}
        onNewTask={() => setComposing((v) => !v)}
        onEnablePush={onEnablePush}
        pushSupported={pushSupported()}
        pushOn={pushOn}
        wa={status?.whatsapp}
        install={install}
      />

      {install.iosHint && (
        <p className="ios-hint">
          To keep this on your home screen: tap <b>Share</b>, then <b>Add to Home Screen</b>.
        </p>
      )}

      <div className="greet">
        <h2>{greeting()}{name ? `, ${name}` : ''}</h2>
        <p>Here is your task overview for today.</p>
      </div>

      <StatBoard counts={summary.counts} view={view} onPick={(v) => { setView(v); setSelectedDate(null); }} />

      <QuickActions counts={summary.counts} onAction={quickAction} active={activeQuick} />

      {error && (
        <div className="banner error" role="alert">
          Something went wrong. Your tasks may be out of date.
          <button className="link" onClick={() => refresh()}>Retry</button>
        </div>
      )}

      <StatusBar status={status} stats={stats} overdueCount={overdueCount} />

      <BlockedChats mode={status?.whatsapp?.mode} onError={(err) => setError(err.message)} />

      {composing && <AddTaskForm onAdd={(task) => { onAdd(task); setComposing(false); }} />}

      <div className="workspace">
        <main className="work">
          <div className="work-head">
            <nav className="tabs" role="tablist" aria-label="View">
              {[
                { key: 'myday', label: 'My day' },
                { key: 'open', label: 'Open' },
                { key: 'all', label: 'All' },
              ].map((v) => (
                <button
                  key={v.key}
                  role="tab"
                  aria-selected={view === v.key}
                  className={`tab ${view === v.key ? 'active' : ''}`}
                  onClick={() => { setView(v.key); setSelectedDate(null); }}
                >
                  {v.label}
                </button>
              ))}
            </nav>

            <Toolbar
              groupBy={groupBy}
              onGroupBy={(g) => { setGroupBy(g); remember('wa-tasks-group', g); }}
              filters={filters}
              onFilters={setFilters}
              chats={chats}
              onClearAll={() => { setFilters(EMPTY_FILTERS); setSelectedDate(null); setQuery(''); }}
            />
          </div>

          {(selectedDate || query) && (
            <div className="scope">
              {selectedDate && (
                <span className="scope-chip">
                  Due {new Date(`${selectedDate}T00:00:00Z`).toLocaleDateString([], {
                    day: 'numeric', month: 'long', timeZone: 'UTC',
                  })}
                  <button onClick={() => setSelectedDate(null)} aria-label="Clear date">✕</button>
                </span>
              )}
              {query && (
                <span className="scope-chip">
                  “{query}”
                  <button onClick={() => setQuery('')} aria-label="Clear search">✕</button>
                </span>
              )}
            </div>
          )}

          {view === 'myday' && (
            <p className="work-intro">Here is what needs your attention today.</p>
          )}

          <TaskList
            tasks={visible}
            loading={loading}
            error={error && !tasks.length ? error : ''}
            groupBy={groupBy}
            view={view}
            query={query}
            onRetry={() => refresh()}
            onToggle={onToggle}
            onOpen={setOpenTask}
            onStatus={(task, status) => onEdit(task, { status })}
            onQuickDate={onQuickDate}
          />
        </main>

        <div ref={railRef} className="rail-wrap">
        <SideRail
          tasks={tasks}
          summary={summary}
          activity={recent}
          chats={chats}
          status={status}
          selectedDate={selectedDate}
          onSelectDate={(iso) => { setSelectedDate(iso); setView('all'); }}
          onUpcoming={showUpcoming}
          onChat={(chat) => { setView('open'); setFilters({ ...EMPTY_FILTERS, chat }); }}
        />
        </div>
      </div>

      <MobileNav
        view={view}
        onView={(v) => { setView(v); setSelectedDate(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
        onNewTask={() => { setComposing(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
        onSummary={() => railRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
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
