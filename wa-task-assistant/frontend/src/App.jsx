import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken, setToken, UnauthorizedError, LockedOutError } from './api.js';
import { enablePush, pushAlreadyEnabled, pushSupported } from './push.js';
import TaskList from './components/TaskList.jsx';
import AddTaskForm from './components/AddTaskForm.jsx';
import StatusBar from './components/StatusBar.jsx';
import Login from './components/Login.jsx';
import StatBoard from './components/StatBoard.jsx';
import BlockedChats from './components/BlockedChats.jsx';
import CaptureSettings from './components/CaptureSettings.jsx';
import Toolbar from './components/Toolbar.jsx';
import TaskDetail from './components/TaskDetail.jsx';
import Header from './components/Header.jsx';
import QuickActions from './components/QuickActions.jsx';
import SideRail from './components/SideRail.jsx';
import MobileNav from './components/MobileNav.jsx';
import Sidebar from './components/Sidebar.jsx';
import FocusToday from './components/FocusToday.jsx';
import UsagePage from './components/UsagePage.jsx';
import AttentionWidget from './components/AttentionWidget.jsx';
import WorkHistory from './components/WorkHistory.jsx';
import NotificationCentre from './components/NotificationCentre.jsx';
import SchedulingSettings from './components/SchedulingSettings.jsx';
import Templates from './components/Templates.jsx';
import NeedsConfirmation from './components/NeedsConfirmation.jsx';
import CalendarPage from './components/CalendarPage.jsx';
import { useInstall } from './lib/install.js';
import { isDone, isOverdue, isoDay, matchesQuery, taskChat, todayIso } from './lib/task.js';
import { activity, chatCounts, greeting, summarise } from './lib/derive.js';
import { needsAttention } from './lib/schedule.js';

const EMPTY_FILTERS = { status: [], priority: [], origin: [], chat: null, attention: false };

/**
 * What each page is, and which of the dashboard's parts belong on it.
 *
 * The dashboard is the overview: it keeps the greeting, the figures, the quick
 * actions and the summary rail. Every other section is one focused list. They
 * used to render the whole dashboard with a filter applied, which made eight
 * sidebar items look like eight copies of the same page.
 */
const PAGES = {
  dashboard: { overview: true },
  myday: {
    title: 'My Day',
    lede: 'What needs doing today, most pressing first.',
    focus: true,
  },
  all: {
    title: 'All Tasks',
    lede: 'Everything you have, grouped by when it is due.',
    tabs: true,
    toolbar: true,
  },
  attention: {
    title: 'Needs Attention',
    lede: 'Asked about the maximum number of times and still not done — the app has stopped chasing these.',
  },
  chat: {
    title: 'By Chat',
    lede: 'The same tasks, one section per WhatsApp chat.',
    toolbar: true,
  },
  ai: {
    title: 'AI Tasks',
    lede: 'Tasks Claude pulled out of your chats, rather than ones you typed.',
    toolbar: true,
  },
  done: {
    title: 'Completed',
    lede: 'Finished work, most recently closed first.',
  },
  calendar: {
    title: 'Calendar',
    lede: 'Your month, and what falls on each day.',
    calendar: true,
  },
};

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
  // Which sidebar section is showing. 'settings' swaps the workspace for setup.
  const [section, setSection] = useState('dashboard');
  const [navOpen, setNavOpen] = useState(false);
  const [notifications, setNotifications] = useState({ notifications: [], unread: 0 });
  const [notifOpen, setNotifOpen] = useState(false);

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
  // Asked once, unauthenticated: the app should be able to tell you it is
  // unprotected rather than leaving you to test it from an incognito window.
  const [authOpen, setAuthOpen] = useState(false);
  // Extractions the model itself said it was unsure about. Nothing chases
  // these until a person says they are real.
  const [unsure, setUnsure] = useState([]);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pushOn, setPushOn] = useState(false);
  const install = useInstall();

  const refresh = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setLoading(true);
      try {
        const [taskData, statusData, notifData] = await Promise.all([
          api.listTasks('all'),
          api.status(),
          api.notifications().catch(() => ({ notifications: [], unread: 0 })),
        ]);
        setTasks(taskData.tasks);
        setStats(taskData.stats);
        setStatus(statusData);
        setNotifications(notifData);
        setNeedsAuth(false);
        setError('');
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          setNeedsAuth(true);
        } else if (err instanceof LockedOutError) {
          const mins = Math.max(1, Math.ceil(err.retryAfterSeconds / 60));
          setError(`Too many wrong passwords. This device is locked out for about ${mins} minute${mins === 1 ? '' : 's'}.`);
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
    api.authState().then((s) => setAuthOpen(!s.required)).catch(() => {});
  }, []);

  const loadUnsure = useCallback(() => {
    api.needsConfirmation().then((d) => setUnsure(d.tasks)).catch(() => {});
  }, []);

  useEffect(() => { loadUnsure(); }, [loadUnsure, tasks]);

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
        else if (err instanceof LockedOutError) {
          const mins = Math.max(1, Math.ceil(err.retryAfterSeconds / 60));
          setError(`Too many wrong passwords. This device is locked out for about ${mins} minute${mins === 1 ? '' : 's'}.`);
        } else setError(err.message);
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
  /** Pushing a deadline back restarts the reminder and follow-up cycle. */
  const onSnoozeTask = (task, minutes) =>
    act(() => api.rescheduleTask(task.id, {
      due_at: new Date(Date.now() + minutes * 60000).toISOString(),
    }));

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
      if (filters.attention && !(['due', 'overdue'].includes(task.state) || task.needs_attention)) return false;
      if (selectedDate && task.due_date !== selectedDate) return false;

      return matchesQuery(task, query);
    });
  }, [tasks, view, filters, query, selectedDate]);

  const summary = useMemo(() => summarise(tasks), [tasks]);
  const recent = useMemo(() => activity(tasks), [tasks]);

  /**
   * The sidebar sets the same state everything else does; it is navigation over
   * one board, not a second application.
   */
  // Which page is showing. An unknown section falls back to the overview
  // rather than rendering a headingless blank.
  const page = PAGES[section] || PAGES.dashboard;

  const goto = (key) => {
    setSection(key);
    setSelectedDate(null);
    setQuery('');
    setFilters(EMPTY_FILTERS);
    if (key === 'myday') return setView('myday');
    if (key === 'done') return setView('done');
    if (key === 'all' || key === 'dashboard') return setView(key === 'dashboard' ? 'open' : 'all');
    if (key === 'chat') { setGroupBy('chat'); return setView('open'); }
    if (key === 'ai') { setView('open'); return setFilters({ ...EMPTY_FILTERS, origin: ['ai'] }); }
    if (key === 'calendar') { setView('all'); return setSelectedDate(todayIso()); }
    if (key === 'attention') { setView('open'); return setFilters({ ...EMPTY_FILTERS, attention: true }); }
    if (key === 'history') return undefined;
    return undefined;
  };

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

  const connected = status?.whatsapp?.status === 'ready';

  return (
    <div className="shell">
      <Sidebar
        section={section}
        onSection={goto}
        connected={connected}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />

      <div className="main">
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
          onSettings={() => goto('settings')}
          onBell={() => setNotifOpen((v) => !v)}
          onMenu={() => setNavOpen(true)}
          alerts={notifications.unread}
        />

        <div className="page">
          {install.iosHint && (
            <p className="ios-hint">
              To keep this on your home screen: tap <b>Share</b>, then <b>Add to Home Screen</b>.
            </p>
          )}

          {authOpen && (
            <div className="banner error prose" role="alert">
              <span>
                This dashboard has no password. Anyone with the link can read and change your
                tasks. Set <code>DASHBOARD_PASSWORD</code> in the hosting provider&rsquo;s
                variables and redeploy.
              </span>
            </div>
          )}

          {error && (
            <div className="banner error" role="alert">
              {/* The server's own words: "locked out for 14 minutes" is worth
                  reading, and a generic sentence hides it. */}
              {error}
              <button className="link" onClick={() => refresh()}>Retry</button>
            </div>
          )}

          {notifOpen && (
            <NotificationCentre
              items={notifications.notifications}
              onClose={() => setNotifOpen(false)}
              onReload={() => refresh({ quiet: true })}
              onOpenTask={(id) => setOpenTask(tasks.find((t) => t.id === id) || null)}
              onError={(err) => setError(err.message)}
            />
          )}

          {section === 'history' ? (
            <section className="settings-page">
              <div className="page-head">
                <div>
                  <h2>Work history</h2>
                  <p>Everything finished or archived, kept permanently.</p>
                </div>
              </div>
              <WorkHistory chats={chats} onError={(err) => setError(err.message)} />
            </section>
          ) : section === 'usage' ? (
            <section className="settings-page">
              <div className="page-head">
                <div>
                  <h2>AI usage</h2>
                  <p>What Claude has read, and what it has cost.</p>
                </div>
              </div>
              <UsagePage onError={(err) => setError(err.message)} />
            </section>
          ) : section === 'reminders' ? (
            <section className="settings-page">
              <div className="page-head">
                <div>
                  <h2>Reminders &amp; follow-ups</h2>
                  <p>
                    When you are reminded, how long the app keeps asking, and where
                    the reminders go.
                  </p>
                </div>
              </div>
              <SchedulingSettings onError={(err) => setError(err.message)} />
            </section>
          ) : section === 'templates' ? (
            <section className="settings-page">
              <div className="page-head">
                <div>
                  <h2>Templates</h2>
                  <p>Work you set up the same way each time, kept as a shape you can reuse.</p>
                </div>
              </div>
              <Templates
                onUsed={() => { refresh({ quiet: true }); goto('dashboard'); }}
                onError={(err) => setError(err.message)}
              />
            </section>
          ) : section === 'settings' ? (
            <section className="settings-page">
              <div className="page-head">
                <div>
                  <h2>Settings</h2>
                  <p>Connection, capture mode and the chats that are never read.</p>
                </div>
              </div>
              <StatusBar status={status} stats={stats} overdueCount={overdueCount} />
              <CaptureSettings onError={(err) => setError(err.message)} />
              <BlockedChats mode={status?.whatsapp?.mode} onError={(err) => setError(err.message)} />
            </section>
          ) : (
            <>
              {/* The dashboard is the overview. Every other section is one
                  focused list, so it gets its own heading and only the controls
                  that mean something there. */}
              {page.overview ? (
                <div className="page-head">
                  <div>
                    <h2>{greeting()} <span className="wave">👋</span></h2>
                    <p>Here&rsquo;s your task overview for today.</p>
                  </div>
                  <button className="btn primary lg" onClick={() => setComposing((v) => !v)}>
                    <span aria-hidden="true">+</span> New Task
                  </button>
                </div>
              ) : (
                <div className="page-head">
                  <div>
                    <h2>{page.title}</h2>
                    <p>{page.lede}</p>
                  </div>
                  <div className="page-head-right">
                    {!page.calendar && (
                      <span className="page-count">
                        {visible.length} {visible.length === 1 ? 'task' : 'tasks'}
                      </span>
                    )}
                    <button className="btn primary" onClick={() => setComposing((v) => !v)}>
                      <span aria-hidden="true">+</span> New Task
                    </button>
                  </div>
                </div>
              )}

              {!connected && (
                <div className="banner warn" role="status">
                  WhatsApp is not connected, so no new tasks are arriving.
                  <button className="link" onClick={() => goto('settings')}>Open settings</button>
                </div>
              )}

              {page.overview && (
                <>
                  <NeedsConfirmation
                    tasks={unsure}
                    onOpen={setOpenTask}
                    onConfirm={async (task) => {
                      try {
                        await api.confirmTask(task.id);
                        loadUnsure();
                        refresh({ quiet: true });
                      } catch (err) { setError(err.message); }
                    }}
                    onReject={async (task) => {
                      try {
                        await api.rejectTask(task.id);
                        loadUnsure();
                        refresh({ quiet: true });
                      } catch (err) { setError(err.message); }
                    }}
                  />

                  <StatBoard
                    counts={summary.counts}
                    view={view}
                    onPick={(v) => { setView(v); setSelectedDate(null); }}
                  />

                  <QuickActions
                    counts={summary.counts}
                    onAction={quickAction}
                    active={activeQuick}
                    onNewTask={() => setComposing(true)}
                  />
                </>
              )}

              {composing && (
                <AddTaskForm
                  onAdd={(task) => { onAdd(task); setComposing(false); }}
                  onClose={() => setComposing(false)}
                />
              )}

              {page.calendar ? (
                <CalendarPage
                  tasks={tasks}
                  onOpen={setOpenTask}
                  onToggle={onToggle}
                  onStatus={(task, next) => onEdit(task, { status: next })}
                  onQuickDate={onQuickDate}
                  onDelete={onDelete}
                />
              ) : (
                <div className={`workspace ${page.overview ? '' : 'solo'}`}>
                  <main className="work">
                    {(page.overview || page.focus) && view !== 'done' && (
                      <FocusToday tasks={tasks} onOpen={setOpenTask} onToggle={onToggle} />
                    )}

                    {(page.overview || page.tabs || page.toolbar) && (
                      <div className="work-head">
                        {(page.overview || page.tabs) ? (
                          <nav className="segment tabs" role="tablist" aria-label="View">
                            {[
                              { key: 'myday', label: 'My Day' },
                              { key: 'open', label: 'Open' },
                              { key: 'all', label: 'All' },
                            ].map((v) => (
                              <button
                                key={v.key}
                                role="tab"
                                aria-selected={view === v.key}
                                className={view === v.key ? 'active' : ''}
                                onClick={() => { setView(v.key); setSelectedDate(null); }}
                              >
                                {v.label}
                              </button>
                            ))}
                          </nav>
                        ) : <span />}

                        {(page.overview || page.toolbar) && (
                          <Toolbar
                            groupBy={groupBy}
                            onGroupBy={(g) => { setGroupBy(g); remember('wa-tasks-group', g); }}
                            filters={filters}
                            onFilters={setFilters}
                            chats={chats}
                            onClearAll={() => { setFilters(EMPTY_FILTERS); setSelectedDate(null); setQuery(''); }}
                          />
                        )}
                      </div>
                    )}

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
                      onStatus={(task, next) => onEdit(task, { status: next })}
                      onQuickDate={onQuickDate}
                      onDelete={onDelete}
                    />
                  </main>

                  {/* The rail belongs to the overview. On a focused list its
                      "today at a glance" figures are about a different scope
                      than the list beside them, which is just noise. */}
                  {page.overview && (
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
                        onViewAi={() => goto('ai')}
                        attentionWidget={
                          <AttentionWidget
                            tasks={tasks}
                            onDone={(task) => onEdit(task, { status: 'done' })}
                            onSnooze={onSnoozeTask}
                            onOpen={setOpenTask}
                          />
                        }
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <MobileNav
          view={view}
          onView={(v) => { setSection('dashboard'); setView(v); setSelectedDate(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          onNewTask={() => { setComposing(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          onSummary={() => railRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />
      </div>

      {openTask && (
        <TaskDetail
          task={openTask}
          tasks={tasks}
          onClose={() => setOpenTask(null)}
          onEdit={onEdit}
          onDelete={onDelete}
          onError={(err) => setError(err.message)}
          onChanged={() => refresh({ quiet: true })}
        />
      )}
    </div>
  );
}
