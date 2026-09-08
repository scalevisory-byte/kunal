import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken, setToken, UnauthorizedError, LockedOutError } from './api.js';
import { enablePush, pushAlreadyEnabled, pushSupported } from './push.js';
import TaskList from './components/TaskList.jsx';
import AddTaskForm from './components/AddTaskForm.jsx';
import QuickAdd from './components/QuickAdd.jsx';
import StatusBar from './components/StatusBar.jsx';
import Login from './components/Login.jsx';
import StatBoard from './components/StatBoard.jsx';
import BlockedChats from './components/BlockedChats.jsx';
import CaptureSettings from './components/CaptureSettings.jsx';
import TidyTitles from './components/TidyTitles.jsx';
import MessagesRead from './components/MessagesRead.jsx';
import GroupNames from './components/GroupNames.jsx';
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
import BoardPage from './components/BoardPage.jsx';
import Groups from './components/Groups.jsx';
import EnginePage from './components/EnginePage.jsx';
import Recurring from './components/Recurring.jsx';
import DueSoonBanner from './components/DueSoonBanner.jsx';
import NotesPage from './components/NotesPage.jsx';
import Delegation from './components/Delegation.jsx';
import { useInstall } from './lib/install.js';
import { isDone, isOverdue, isoDay, matchesQuery, taskChat, todayIso } from './lib/task.js';
import { getTheme, setTheme } from './lib/theme.js';
import { activity, chatCounts, greeting, onDay, summarise } from './lib/derive.js';
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
    lede: 'Work that is late, owed today, or has been asked about as many times as the app is willing to ask. Grouped by which of those it is.',
    /* Grouped by the reason it is here, not by date: the page is about now, so
       a section headed "Today" told you nothing you had not read in the title. */
    groupBy: 'reason',
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
  notes: {
    title: 'Notes',
    lede: 'Things worth remembering, as opposed to things that have to be done. Nothing here is chased.',
    notes: true,
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
  /*
   * A note the top-bar search was clicked through to.
   *
   * Held here rather than inside the notes page because the click happens in
   * the search results, before that page is on screen; it is cleared the moment
   * the note is opened so closing it does not bring it straight back.
   */
  const [noteToOpen, setNoteToOpen] = useState(null);
  // A day picked in the calendar narrows the board to that date.
  const [selectedDate, setSelectedDate] = useState(null);
  /*
   * Writing a task down, in two depths.
   *
   * `quick` is the one line and a day, which is what nearly every task
   * actually needs. `composing` is the full form - notes, assignment, exact
   * reminder and follow-up - reached from "More details" and unchanged. The
   * New Task button opens the first; nothing has been taken away from the
   * second.
   */
  const [quick, setQuick] = useState(false);
  // Bumped every time the phone's + is pressed, so the box takes the focus
  // again even when it was already open.
  const [quickFocus, setQuickFocus] = useState(0);
  const [composing, setComposing] = useState(false);
  const [seedTitle, setSeedTitle] = useState('');
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

  /*
   * The notes the search box matches.
   *
   * Loaded once when a search starts rather than on every keystroke: the whole
   * set is small, it is the same data the notes page holds, and filtering it
   * here costs nothing next to a request per character.
   */
  const [allNotes, setAllNotes] = useState([]);
  useEffect(() => {
    if (!searching || allNotes.length) return;
    api.notes().then((d) => setAllNotes(d.notes)).catch(() => {});
  }, [searching, allNotes.length]);

  const noteHits = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return allNotes.filter((note) =>
      [note.title, note.body, note.group_name, note.chat_name, (note.tags || []).join(' ')]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle))
    );
  }, [allNotes, query]);

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
      // What came in today, whatever state it is in: the figure counts every
      // task created today, so the list it opens has to as well.
      if (view === 'added_today' && !onDay(task.created_at, today)) return false;

      if (filters.status.length && !filters.status.includes(task.status)) return false;
      if (filters.priority.length && !filters.priority.includes(task.priority)) return false;
      if (filters.origin.length && !filters.origin.includes(task.origin)) return false;
      if (filters.chat && taskChat(task) !== filters.chat) return false;
      /* 'none' is a real answer, not the absence of one: it is how the board's
         "not in any business yet" line shows you which tasks it means. */
      if (filters.group === 'none' && task.group_id) return false;
      if (filters.group && filters.group !== 'none' && task.group_id !== filters.group) return false;
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
          onNewTask={() => { setQuick((v) => !v); setComposing(false); }}
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
          ) : section === 'board' ? (
            <section className="settings-page">
              <div className="page-head">
                <div>
                  <h2>Businesses</h2>
                  <p>
                    Your businesses and the work in each. Side by side to compare them,
                    or stacked with one open at a time to work through one.
                  </p>
                </div>
              </div>
              <BoardPage
                tasks={tasks}
                groups={groups}
                onOpen={setOpenTask}
                onToggle={onToggle}
                onPickGroup={(id) => setSection(`group:${id}`)}
                onShowUnfiled={() => {
                  setSection('all');
                  setView('open');
                  setFilters({ ...EMPTY_FILTERS, group: 'none' });
                }}
                onChanged={() => { refresh({ quiet: true }); api.groups().then((d) => setGroups(d.groups)).catch(() => {}); }}
                onError={(err) => setError(err.message)}
              />
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
          ) : page.notes ? (
            <section className="settings-page">
              <div className="page-head">
                <div>
                  <h2>{page.title}</h2>
                  <p>{page.lede}</p>
                </div>
              </div>
              <NotesPage
                groups={groups}
                query={query}
                openId={noteToOpen}
                onOpened={() => setNoteToOpen(null)}
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
              {/* Given a heading like every other section on the page. It was
                  the one block with none, which made the connection state read
                  as loose debris above the settings rather than the first
                  setting. */}
              <section className="settings-block">
                <header className="settings-head">
                  <h3>WhatsApp connection</h3>
                  <span>Where tasks come from</span>
                </header>
                <StatusBar status={status} stats={stats} overdueCount={overdueCount} />
              </section>

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
              <GroupNames onError={(err) => setError(err.message)} />
              <BlockedChats mode={status?.whatsapp?.mode} onError={(err) => setError(err.message)} />
              <MessagesRead mode={status?.whatsapp?.mode} onError={(err) => setError(err.message)} />
            </section>
          ) : (
            <>
              {/* The dashboard is the overview. Every other section is one
                  focused list, so it gets its own heading and only the controls
                  that mean something there. */}
              {searching ? (
                <>
                  <div className="page-head">
                    <div>
                      <h2>
                        {visible.length} {visible.length === 1 ? 'result' : 'results'} for
                        {' '}&ldquo;{query.trim()}&rdquo;
                      </h2>
                      <p>
                        Across every task you have — finished ones and groups kept out of the
                        main list included{noteHits.length ? ', and your notes' : ''}.
                      </p>
                    </div>
                    <button className="btn ghost lg" onClick={() => setQuery('')}>
                      Clear search
                    </button>
                  </div>

                  {/*
                    * Notes, in the same results as tasks.
                    *
                    * "Search tasks, chats or notes" was the promise the box had
                    * always made, and notes are where half of what he writes
                    * down actually lives. They are a separate strip rather than
                    * mixed into the list because a note is not work: it has no
                    * deadline, and putting one in a list of tasks says it does.
                    */}
                  {noteHits.length > 0 && (
                    <section className="note-hits">
                      <h3>
                        {noteHits.length} {noteHits.length === 1 ? 'note' : 'notes'}
                      </h3>
                      <ul>
                        {noteHits.slice(0, 6).map((note) => (
                          <li key={note.id}>
                            <button onClick={() => { setNoteToOpen(note.id); setSection('notes'); }}>
                              <Icon name="note" size={14} />
                              <span className="note-hit-title">
                                {note.title || (note.body || '').slice(0, 60) || 'Untitled note'}
                              </span>
                              {note.group_name && <span className="note-hit-group">{note.group_name}</span>}
                            </button>
                          </li>
                        ))}
                      </ul>
                      {noteHits.length > 6 && (
                        <button className="link" onClick={() => setSection('notes')}>
                          See all {noteHits.length} in Notes
                        </button>
                      )}
                    </section>
                  )}
                </>
              ) : page.overview ? (
                <div className="page-head">
                  <div>
                    <h2>{greeting()} <span className="wave">👋</span></h2>
                    <p>Here&rsquo;s your task overview for today.</p>
                  </div>
                  <button className="btn primary lg" onClick={() => { setQuick((v) => !v); setComposing(false); }}>
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
                    <button className="btn primary" onClick={() => { setQuick((v) => !v); setComposing(false); }}>
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
                  />
                </>
              )}

              {quick && !composing && (
                <QuickAdd
                  autoFocus
                  focusSignal={quickFocus}
                  groupId={groupId}
                  groupName={activeGroup?.name || null}
                  onAdded={() => refresh({ quiet: true })}
                  onMore={(typed) => { setSeedTitle(typed); setQuick(false); setComposing(true); }}
                  onError={(err) => setError(err.message)}
                />
              )}

              {composing && (
                <AddTaskForm
                  initialTitle={seedTitle}
                  groupId={groupId}
                  // Straight back to the fast path, keeping whatever was typed.
                  onBack={() => { setComposing(false); setQuick(true); }}
                  onAdd={(task) => { onAdd(task); setComposing(false); setSeedTitle(''); }}
                  onClose={() => { setComposing(false); setSeedTitle(''); }}
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

                    {/*
                      * The fastest road of all: a line above the list, always
                      * there, no button to press first. Compact on purpose -
                      * the day chips are already on the panel above when that
                      * is open, and here the point is Enter.
                      */}
                    {!searching && !page.calendar && view !== 'done' && !quick && (
                      <QuickAdd
                        compact
                        groupId={groupId}
                        groupName={activeGroup?.name || null}
                        onAdded={() => refresh({ quiet: true })}
                        onMore={(typed) => { setSeedTitle(typed); setComposing(true); }}
                        onError={(err) => setError(err.message)}
                      />
                    )}

                    <TaskList
                      tasks={visible}
                      loading={loading}
                      error={error && !tasks.length ? error : ''}
                      /* A page may fix its own grouping — Needs Attention is
                         about why, not when — otherwise the toolbar decides. */
                      groupBy={searching ? 'none' : (page.groupBy || groupBy)}
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

                    {/*
                      * Below the list, not above it.
                      *
                      * Merging duplicates is tidying up, and tidying up is not
                      * the day's work — sitting above Focus today it pushed the
                      * task list, the one thing this page exists to show, off
                      * the bottom of the screen whenever there were copies to
                      * fix. Renders nothing when there is nothing to merge.
                      */}
                    {(page.overview || page.focus) && view !== 'done' && !searching && (
                      <Duplicates
                        onOpen={setOpenTask}
                        onChanged={() => refresh({ quiet: true })}
                        onError={(err) => setError(err.message)}
                      />
                    )}
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
                            onViewAll={() => {
                              setSection('all');
                              setView('open');
                              setFilters({ ...EMPTY_FILTERS, attention: true });
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
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
          onNewTask={() => {
            // The phone's + is the fastest road of all: the box opens focused,
            // the keyboard comes up with it, and the full form is still one
            // press away under "More details".
            setQuick(true);
            setComposing(false);
            setQuickFocus((n) => n + 1);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
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
