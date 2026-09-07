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
import TidyTitles from './components/TidyTitles.jsx';
import MessagesRead from './components/MessagesRead.jsx';
import Toolbar from './components/Toolbar.jsx';
import TaskDetail from './components/TaskDetail.jsx';
import Header from './components/Header.jsx';
import QuickActions from './components/QuickActions.jsx';
import SideRail from './components/SideRail.jsx';
import MobileNav from './components/MobileNav.jsx';
import Sidebar from './components/Sidebar.jsx';
import Icon from './components/Icon.jsx';
import FocusToday from './components/FocusToday.jsx';
import UsagePage from './components/UsagePage.jsx';
import AttentionWidget from './components/AttentionWidget.jsx';
import WorkHistory from './components/WorkHistory.jsx';
import NotificationCentre from './components/NotificationCentre.jsx';
import SchedulingSettings from './components/SchedulingSettings.jsx';
import Templates from './components/Templates.jsx';
import NeedsConfirmation from './components/NeedsConfirmation.jsx';
import Duplicates from './components/Duplicates.jsx';
import CalendarPage from './components/CalendarPage.jsx';
import Groups from './components/Groups.jsx';
import EnginePage from './components/EnginePage.jsx';
import Recurring from './components/Recurring.jsx';
import DueSoonBanner from './components/DueSoonBanner.jsx';
import Delegation from './components/Delegation.jsx';
import { useInstall } from './lib/install.js';
import { isDone, isOverdue, isoDay, matchesQuery, taskChat, todayIso } from './lib/task.js';
import { getTheme, setTheme } from './lib/theme.js';
import { activity, chatCounts, greeting, summarise } from './lib/derive.js';
import { needsAttention } from './lib/schedule.js';

const EMPTY_FILTERS = { status: [], priority: [], origin: [], chat: null, attention: false, group: null };

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
    lede: 'Everything that wants doing now: overdue, due today, or asked about so many times the app has stopped chasing it.',
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
  received: {
    title: 'Task received',
    lede: 'Work other people have asked you for, grouped by who asked.',
    delegation: 'received',
  },
  allotted: {
    title: 'Task allotted',
    lede: 'Work you have given to somebody else. Still yours to chase — the app reminds you, not them.',
    delegation: 'allotted',
  },
  recent: {
    title: 'Recent',
    lede: 'Everything newest first — what has just come in, whether or not it is due.',
    recent: true,
    toolbar: true,
  },
  monthly: {
    title: 'Monthly deadlines',
    lede: 'The dates that never move — TDS, GST, GSTR-3B. Each becomes a task before its date.',
    settings: true,
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
  const searching = query.trim().length > 0;
  /*
   * Held in state only so the icons and the segmented control re-render when it
   * changes; the theme itself lives on the root element and in localStorage,
   * applied before the first render — see lib/theme.js.
   */
  const [theme, setThemeState] = useState(getTheme);
  const chooseTheme = (next) => setThemeState(setTheme(next));
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [openTask, setOpenTask] = useState(null);
  // The task the drawer was opened on to write an update, so the box is ready
  // to type into rather than needing to be found. Held as an id rather than a
  // flag so it cannot leak onto the next task opened some other way.
  const [focusProgress, setFocusProgress] = useState(null);
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
  /*
   * How the board is split into sections. Not remembered between visits: a
   * grouping chosen once for one page used to follow you to every other one,
   * including the dashboard, and there was nothing on screen saying why the
   * overview had turned into a list of chats. Each section sets its own on
   * arrival; the toolbar overrides it while you are there.
   */
  const [groupBy, setGroupBy] = useState('date');
  const [error, setError] = useState('');
  // Asked once, unauthenticated: the app should be able to tell you it is
  // unprotected rather than leaving you to test it from an incognito window.
  const [authOpen, setAuthOpen] = useState(false);
  // Extractions the model itself said it was unsure about. Nothing chases
  // these until a person says they are real.
  const [unsure, setUnsure] = useState([]);
  const [groups, setGroups] = useState([]);
  // The two badges beside Task received / Task allotted.
  const [delegation, setDelegation] = useState(null);
  // The last task taken off the list, so one press puts it back.
  const [undo, setUndo] = useState(null);
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

  const loadGroups = useCallback(() => {
    api.groups().then((d) => setGroups(d.groups)).catch(() => {});
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups, tasks]);

  // Refreshed with the board, so finishing a delegated task drops the badge.
  useEffect(() => {
    api.delegationCounts().then(setDelegation).catch(() => {});
  }, [tasks]);

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
  /*
   * "This was never a task." Archived, not deleted: what the extractor got
   * wrong stays in Work History, and its reminders stop with it.
   */
  /*
   * "This was never a task." Archived, not deleted: what the extractor got
   * wrong stays in Work History, and its reminders stop with it.
   *
   * The undo is what makes it safe to have out in the open on every row. It
   * holds one task — the last one — because that is the mistake people actually
   * make, and a stack of undos is a second list to reason about.
   */
  const onNotATask = async (task) => {
    setOpenTask(null);
    await act(() => api.rejectTask(task.id));
    setUndo({ id: task.id, title: task.title });
  };

  /*
   * Filing a task under the business it belongs to.
   *
   * The same undo the ✕ has, for the same reason: it is one click in a list of
   * names, so picking the one above the one you meant is the mistake that will
   * actually happen, and it is silent - the task simply leaves the view you
   * were looking at.
   */
  const onMove = async (task, groupId) => {
    const from = task.group_id ?? null;
    const to = groupId ?? null;
    if (from === to) return;
    await onEdit(task, { group_id: to });
    setUndo({
      kind: 'moved',
      id: task.id,
      title: task.title,
      from,
      toName: to ? groups.find((g) => g.id === to)?.name || null : null,
    });
  };

  const undoLast = async () => {
    if (!undo) return;
    const last = undo;
    setUndo(null);
    await act(() =>
      last.kind === 'moved'
        ? api.updateTask(last.id, { group_id: last.from })
        : api.restoreTask(last.id)
    );
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
    /*
     * Searching is its own mode, not a filter on the page you were looking at.
     *
     * Typing "salary" on the dashboard used to narrow the list far below the
     * fold while the greeting, the figures, the quick actions and Focus today
     * all stayed put - so nothing appeared to happen. It now searches every
     * task you have, whatever view you were in, whether it is done, and
     * including groups kept out of the main list: if you went looking for it,
     * you want to find it.
     */
    if (searching) {
      return tasks.filter((task) => matchesQuery(task, query));
    }

    return tasks.filter((task) => {
      /*
       * Work in a set-aside group is fetched with everything else - a group's
       * own page needs it - but it is not the day's work, so it appears there
       * and nowhere else. Asking for that group by name is the only way to see
       * it, which is exactly what "kept out of the main list" means.
       */
      if (task.group_separate && filters.group !== task.group_id) return false;

      if (view === 'open' && isDone(task)) return false;
      if (view === 'in_progress' && task.status !== 'in_progress') return false;
      if (view === 'overdue' && !isOverdue(task)) return false;
      if (view === 'done' && !isDone(task)) return false;
      if (view === 'myday' && isDone(task)) return false;

      if (filters.status.length && !filters.status.includes(task.status)) return false;
      if (filters.priority.length && !filters.priority.includes(task.priority)) return false;
      if (filters.origin.length && !filters.origin.includes(task.origin)) return false;
      if (filters.chat && taskChat(task) !== filters.chat) return false;
      if (filters.group && task.group_id !== filters.group) return false;
      /*
       * "Due" is only the first hour after a deadline, so a task due at 6pm was
       * plain "open" all day and never reached this page - at nine in the
       * morning the page was empty while six things were due that evening.
       * Today's work needs attention today, which is what the page is called.
       */
      if (filters.attention) {
        const wants = ['due', 'overdue'].includes(task.state)
          || task.due_date === todayIso()
          || task.needs_attention;
        if (!wants) return false;
      }
      if (selectedDate && task.due_date !== selectedDate) return false;

      return matchesQuery(task, query);
    });
  }, [tasks, view, filters, query, selectedDate, searching]);

  const summary = useMemo(() => summarise(tasks), [tasks]);
  const recent = useMemo(() => activity(tasks), [tasks]);

  /**
   * The sidebar sets the same state everything else does; it is navigation over
   * one board, not a second application.
   */
  // Which page is showing. An unknown section falls back to the overview
  // rather than rendering a headingless blank.
  const groupId = section.startsWith('group:') ? Number(section.slice(6)) : null;
  const activeGroup = groupId ? groups.find((g) => g.id === groupId) : null;

  const page = groupId
    ? {
        title: activeGroup?.name || 'Group',
        lede: !activeGroup
          ? 'This group no longer exists.'
          : activeGroup.separate
            // The page a set-aside group is reached from is the only place its
            // work appears, so it should say that rather than leave you
            // wondering why none of it is on the dashboard.
            ? 'Kept out of the main list — this is where it lives. Not counted in the figures, and never chased: no reminders, no digest, no briefing.'
            : 'Everything for this business, whichever chat it arrived in.',
        tabs: true,
        toolbar: true,
      }
    : PAGES[section] || PAGES.dashboard;

  const goto = (key) => {
    setSection(key);
    setSelectedDate(null);
    setQuery('');
    setFilters(EMPTY_FILTERS);

    /*
     * Grouping belongs to the page, not to the app.
     *
     * It used to be one sticky setting: opening "By Chat" once left the
     * dashboard grouped by chat for good, so the overview showed "ZYNTAJOBS 7
     * tasks / MEERA 3 tasks" instead of Today and Overdue, with nothing saying
     * why. Each section now sets what it is - by chat on the By Chat page, one
     * flat list on Recent, by date everywhere else - and the toolbar still
     * overrides it for as long as you stay there.
     *
     * It has to be decided here, above the returns below: the dashboard leaves
     * this function on its own line, so anything after it never ran for the one
     * page that most needed resetting.
     */
    setGroupBy(key === 'chat' ? 'chat' : key === 'recent' ? 'none' : 'date');

    if (key === 'myday') return setView('myday');
    if (key === 'done') return setView('done');
    if (key === 'all' || key === 'dashboard') return setView(key === 'dashboard' ? 'open' : 'all');
    if (key === 'chat') return setView('open');
    if (key === 'recent') return setView('all');
    if (key === 'ai') { setView('open'); return setFilters({ ...EMPTY_FILTERS, origin: ['ai'] }); }
    if (key === 'calendar') { setView('all'); return setSelectedDate(todayIso()); }
    if (key === 'attention') { setView('open'); return setFilters({ ...EMPTY_FILTERS, attention: true }); }
    if (key === 'history') return undefined;
    if (key.startsWith('group:')) {
      setView('open');
      return setFilters({ ...EMPTY_FILTERS, group: Number(key.slice(6)) });
    }
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
        groups={groups}
        section={section}
        onSection={goto}
        connected={connected}
        delegation={delegation}
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
          onThemeChange={chooseTheme}
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
                    What the engine has lined up, what it has already sent, and the rules
                    it works to.
                  </p>
                </div>
              </div>
              <EnginePage
                onOpenTask={(taskId) => {
                  const found = tasks.find((t) => t.id === taskId);
                  if (found) setOpenTask(found);
                }}
                onError={(err) => setError(err.message)}
              />
              <SchedulingSettings onError={(err) => setError(err.message)} />
            </section>
          ) : section === 'groups' ? (
            <section className="settings-page">
              <div className="page-head">
                <div>
                  <h2>Groups</h2>
                  <p>
                    One per business. A task that mentions it goes there on its own, and each
                    group gets its own item in the sidebar.
                  </p>
                </div>
              </div>
              <Groups
                onChanged={() => { loadGroups(); refresh({ quiet: true }); }}
                onError={(err) => setError(err.message)}
              />
            </section>
          ) : section === 'monthly' ? (
            <section className="settings-page">
              <div className="page-head">
                <div>
                  <h2>Monthly deadlines</h2>
                  <p>
                    The dates that never move. Each becomes an ordinary task before its date,
                    with the usual reminder and follow-up.
                  </p>
                </div>
              </div>
              <Recurring
                groups={groups}
                onChanged={() => refresh({ quiet: true })}
                onError={(err) => setError(err.message)}
              />
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
          ) : page.delegation ? (
            <section className="settings-page">
              <div className="page-head">
                <div>
                  <h2>{page.title}</h2>
                  <p>{page.lede}</p>
                </div>
              </div>
              <Delegation
                side={page.delegation}
                wa={status?.whatsapp}
                onOpenTask={(id) => {
                  const found = tasks.find((t) => t.id === id);
                  if (found) setOpenTask(found);
                }}
                onChanged={() => refresh({ quiet: true })}
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

              {/*
                * Three states, because "match my device" is a real answer and
                * not the absence of one — a phone that goes dark in the evening
                * should take this with it unless you have said otherwise.
                */}
              <section className="settings-block">
                <header className="settings-head">
                  <h3>Appearance</h3>
                  <span>Kept in this browser</span>
                </header>
                <div className="set-row">
                  <div className="set-label">
                    <strong>Light or dark</strong>
                    <small>
                      Matching your device is the default, and a real answer rather than the
                      absence of one: a phone that goes dark in the evening takes this with
                      it. Choosing light or dark is choosing to stop following it. The
                      switch in the top bar flips straight between the two.
                    </small>
                  </div>
                  <div className="set-control">
                    <div className="segment">
                      {[
                        { key: 'light', label: 'Light', icon: 'sun' },
                        { key: 'dark', label: 'Dark', icon: 'moon' },
                        { key: 'system', label: 'My device', icon: 'settings' },
                      ].map((o) => (
                        <button
                          key={o.key}
                          className={theme === o.key ? 'active' : ''}
                          aria-pressed={theme === o.key}
                          onClick={() => chooseTheme(o.key)}
                        >
                          <Icon name={o.icon} size={14} /> {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              <CaptureSettings onError={(err) => setError(err.message)} />
              <TidyTitles
                onChanged={() => refresh({ quiet: true })}
                onError={(err) => setError(err.message)}
              />
              <BlockedChats mode={status?.whatsapp?.mode} onError={(err) => setError(err.message)} />
              <MessagesRead mode={status?.whatsapp?.mode} onError={(err) => setError(err.message)} />
            </section>
          ) : (
            <>
              {/* The dashboard is the overview. Every other section is one
                  focused list, so it gets its own heading and only the controls
                  that mean something there. */}
              {searching ? (
                <div className="page-head">
                  <div>
                    <h2>
                      {visible.length} {visible.length === 1 ? 'result' : 'results'} for
                      {' '}&ldquo;{query.trim()}&rdquo;
                    </h2>
                    <p>
                      Across every task you have — finished ones and groups kept out of the
                      main list included.
                    </p>
                  </div>
                  <button className="btn ghost lg" onClick={() => setQuery('')}>
                    Clear search
                  </button>
                </div>
              ) : page.overview ? (
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
                  {/* Logged in but still syncing is not the same problem as not
                      being logged in, and saying "not connected" for both sends
                      you looking for a QR code that is not there. */}
                  {status?.whatsapp?.status === 'authenticated'
                    ? 'WhatsApp is logged in and still syncing your chats. Until it finishes, new messages may not be picked up.'
                    : 'WhatsApp is not connected, so no new tasks are arriving.'}
                  <button className="link" onClick={() => goto('settings')}>Open settings</button>
                </div>
              )}

              {/* Results are the page while a search is on: the greeting, the
                  figures, the quick actions and Focus today all pushed the
                  matches below the fold, which is why typing appeared to do
                  nothing at all. */}
              {page.overview && !searching && (
                <>
                  <DueSoonBanner
                    onOpenTask={(taskId) => {
                      const found = tasks.find((t) => t.id === taskId);
                      if (found) setOpenTask(found);
                    }}
                  />


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
                  onNotATask={onNotATask}
                />
              ) : (
                <div className={`workspace ${page.overview && !searching ? '' : 'solo'}`}>
                  <main className="work">
                    {/*
                      * Directly above Focus today, because that is where the
                      * copies are seen: two "Process BNF salary" rows one under
                      * the other. It sat above the KPI cards before, which reads
                      * fine on an empty dashboard and is scrolled past on a busy
                      * one — the page had moved down by the time anybody noticed
                      * the duplicates it was offering to fix. Renders nothing
                      * when there is nothing to merge.
                      */}
                    {undo && (
                      <p className="banner ok undo-bar" role="status">
                        <span>
                          {undo.kind === 'moved' ? (
                            undo.toName
                              ? <>Moved <b>{undo.title}</b> to <b>{undo.toName}</b>.</>
                              : <>Took <b>{undo.title}</b> out of its group.</>
                          ) : (
                            <>Took <b>{undo.title}</b> off the list.</>
                          )}
                        </span>
                        <button className="link" onClick={undoLast}>Undo</button>
                        <button className="link" onClick={() => setUndo(null)}>Dismiss</button>
                      </p>
                    )}

                    {(page.overview || page.focus) && view !== 'done' && !searching && (
                      <Duplicates
                        onOpen={setOpenTask}
                        onChanged={() => refresh({ quiet: true })}
                        onError={(err) => setError(err.message)}
                      />
                    )}

                    {(page.overview || page.focus) && view !== 'done' && !searching && (
                      <FocusToday
                        tasks={tasks}
                        onOpen={setOpenTask}
                        onToggle={onToggle}
                        onShowAll={() => { setView('open'); setSelectedDate(todayIso()); }}
                      />
                    )}

                    {(page.overview || page.tabs || page.toolbar) && !searching && (
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
                            onGroupBy={setGroupBy}
                            filters={filters}
                            onFilters={setFilters}
                            chats={chats}
                            onClearAll={() => { setFilters(EMPTY_FILTERS); setSelectedDate(null); setQuery(''); }}
                          />
                        )}
                      </div>
                    )}

                    {/* The search term is the heading now, so the chip that
                        repeated it is only shown for a date. */}
                    {(selectedDate || (query && !searching)) && (
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
                      groupBy={searching ? 'none' : groupBy}
                      view={view}
                      query={query}
                      onRetry={() => refresh()}
                      onToggle={onToggle}
                      onOpen={setOpenTask}
                      onStatus={(task, next) => onEdit(task, { status: next })}
                      onQuickDate={onQuickDate}
                      onDelete={onDelete}
                      onNotATask={onNotATask}
                      groups={groups}
                      onMove={onMove}
                      onManageGroups={() => { setSection('groups'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      onAddUpdate={(task) => { setFocusProgress(task.id); setOpenTask(task); }}
                    />
                  </main>

                  {/* The rail belongs to the overview. On a focused list its
                      "today at a glance" figures are about a different scope
                      than the list beside them, which is just noise. */}
                  {page.overview && !searching && (
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
          groups={groups}
          focusProgress={focusProgress === openTask.id}
          onClose={() => { setOpenTask(null); setFocusProgress(null); }}
          onEdit={onEdit}
          onDelete={onDelete}
          onNotATask={onNotATask}
          onError={(err) => setError(err.message)}
          onChanged={() => refresh({ quiet: true })}
        />
      )}
    </div>
  );
}
