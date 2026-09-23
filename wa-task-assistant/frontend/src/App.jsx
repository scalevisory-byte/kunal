import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken, setToken, UnauthorizedError, LockedOutError } from './api.js';
import { enablePush, pushAlreadyEnabled, pushSupported } from './push.js';
import TaskList from './components/TaskList.jsx';
import TaskTable from './components/TaskTable.jsx';
import AddTaskForm from './components/AddTaskForm.jsx';
import QuickAdd from './components/QuickAdd.jsx';
import StatusBar from './components/StatusBar.jsx';
import Login from './components/Login.jsx';
import StatBoard from './components/StatBoard.jsx';
import DashboardHome from './components/DashboardHome.jsx';
import BlockedChats from './components/BlockedChats.jsx';
import ListedChats from './components/ListedChats.jsx';
import CaptureSettings from './components/CaptureSettings.jsx';
import TidyTitles from './components/TidyTitles.jsx';
import MessagesRead from './components/MessagesRead.jsx';
import GroupNames from './components/GroupNames.jsx';
import Backups from './components/Backups.jsx';
import Toolbar from './components/Toolbar.jsx';
import DayBar from './components/DayBar.jsx';
import FolderStrip from './components/FolderStrip.jsx';
import MonthStrip from './components/MonthStrip.jsx';
import TaskDetail from './components/TaskDetail.jsx';
import Header from './components/Header.jsx';
import QuickActions from './components/QuickActions.jsx';
import MonthCalendar from './components/MonthCalendar.jsx';
import MobileNav from './components/MobileNav.jsx';
import Sidebar from './components/Sidebar.jsx';
import Icon from './components/Icon.jsx';
import FocusToday from './components/FocusToday.jsx';
import UsagePage from './components/UsagePage.jsx';
import WorkHistory from './components/WorkHistory.jsx';
import NotificationCentre from './components/NotificationCentre.jsx';
import SchedulingSettings from './components/SchedulingSettings.jsx';
import LawDigest from './components/LawDigest.jsx';
import LegalUpdates from './components/LegalUpdates.jsx';
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
import LeadsPage from './components/LeadsPage.jsx';
import Delegation from './components/Delegation.jsx';
import { useInstall } from './lib/install.js';
import { isAllotted, isDone, isOverdue, isoDay, matchesQuery, taskChat, taskMonth, todayIso } from './lib/task.js';
import { getTheme, setTheme } from './lib/theme.js';
import { chatCounts, greeting, onDay, summarise } from './lib/derive.js';
import { needsAttention } from './lib/schedule.js';

/*
 * `attention` is gone from here with the panel and the page it fed.
 *
 * Asked as "need attention no need hata do", after reading what the two
 * actually were: Focus today is today's work, Needs attention was the same
 * overdue rows plus the ones the engine had given up chasing - a second
 * arrangement of a list already on screen, and the one thing it alone said is
 * on the row itself as "Stopped asking". The engine's flag stays exactly as it
 * was: after three follow-ups the app still stops asking. Only the second
 * place to read that went.
 */
const EMPTY_FILTERS = { status: [], priority: [], origin: [], chat: null, group: null, month: null };

/*
 * Work that is out with somebody and not finished yet.
 *
 * Only the unfinished half leaves the board. The reason for taking it off is
 * that it is not his to do today - and that reason stops applying the moment it
 * is done, when it is simply finished work and belongs in Completed with the
 * rest. Keeping it that way also makes the count above the list exact: what it
 * says is hidden is precisely what is hidden, and it is the same number the
 * sidebar badges beside Task allotted.
 */
const withSomebody = (task) => isAllotted(task) && !isDone(task);

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
    lede: 'Finished work, newest first, grouped by the day it was closed.',
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
  law: {
    title: 'Tax & compliance updates',
    lede: 'GST, Income Tax, PF/ESI/PT, ROC and the case law that changes how something is filed.',
    settings: true,
  },
  legal: {
    title: 'Legal & court updates',
    lede: 'Judgments, orders, Acts and amendments — the courts rather than the compliance calendar.',
    settings: true,
  },
  leads: {
    title: 'Leads',
    lede: 'People who might buy something, and where each of them has got to. The app reminds you to speak to them — it never messages them itself.',
    leads: true,
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

/**
 * What "still syncing" means once it has gone on too long.
 *
 * The first minutes are normal - a busy account takes a while and sits at 99%
 * for most of it. Past a quarter of an hour it is not normal, and saying
 * "still syncing" in the same flat words for three hours told him nothing and
 * was, in his case, not even true: tasks were arriving the whole time. So the
 * message carries how long it has been, and past the threshold says what that
 * probably means and what to do about it.
 */
function syncingFor(since) {
  const at = since ? new Date(since) : null;
  const mins = at && !Number.isNaN(at.getTime())
    ? Math.floor((Date.now() - at.getTime()) / 60000)
    : null;

  if (mins === null || mins < 15) {
    return 'WhatsApp is logged in and syncing your chats. This takes a few minutes on a busy account.';
  }
  const spent = mins < 90 ? `${mins} minutes` : `${Math.floor(mins / 60)} hours`;
  return `WhatsApp has been syncing for ${spent}, which is longer than it should take. `
    + 'Tasks may still be arriving normally — check whether new ones are appearing. '
    + 'If they are not, restart the service in Railway; the login is saved and will not need scanning again.';
}

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
  /*
   * Who work has been given to before. Named once and then it is a press:
   * the second task for Meera should not need her name typed again.
   */
  const [people, setPeople] = useState([]);
  /*
   * Which day of finished work is on screen.
   *
   * null is everything. Separate from `selectedDate`, which is about
   * deadlines: "finished on the 8th" and "due on the 8th" are different
   * questions and sharing one piece of state made each answer the other.
   */
  const [doneDay, setDoneDay] = useState(null);
  // While stored messages are being put through the extractor, so the button
  // cannot be pressed twice into the same run.
  const [rerunning, setRerunning] = useState(false);
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
  /*
   * Picking several rows at once, and what was picked.
   *
   * Ids rather than tasks: the list is refetched every thirty seconds and a
   * held task object would go stale, while an id is still the same row.
   */
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  /*
   * All Tasks as sections or as a table - his drawing is a table.
   *
   * Remembered, because it is a way of reading rather than a filter: a filter
   * left on weeks ago silently shrinks the list, a layout left on only changes
   * its shape. A phone starts on the list, since eight columns on 390px is a
   * table you read sideways; either can be picked on either.
   */
  const [layout, setLayout] = useState(() => {
    try {
      const saved = localStorage.getItem('layout');
      if (saved === 'list' || saved === 'table') return saved;
    } catch { /* private window: fall through to the default */ }
    return window.matchMedia?.('(min-width: 900px)').matches ? 'table' : 'list';
  });
  const pickLayout = (next) => {
    setLayout(next);
    try { localStorage.setItem('layout', next); } catch { /* not remembered, still applied */ }
  };
  // Whether the picker bar is asking who the picked rows go to.
  const [giving, setGiving] = useState(false);
  const [status, setStatus] = useState(null);
  /*
   * How the board is split into sections. Not remembered between visits: a
   * grouping chosen once for one page used to follow you to every other one,
   * including the dashboard, and there was nothing on screen saying why the
   * overview had turned into a list of chats. Each section sets its own on
   * arrival; the toolbar overrides it while you are there.
   */
  const [groupBy, setGroupBy] = useState('date');
  /*
   * Whether work already given to somebody is on the board.
   *
   * Off on arrival, every time, and deliberately not remembered: the reason it
   * is off is that the list is meant to be what he still has to do, and a
   * setting left on weeks ago is exactly how that quietly stops being true.
   */
  const [showAllotted, setShowAllotted] = useState(false);
  const [error, setError] = useState('');
  // Asked once, unauthenticated: the app should be able to tell you it is
  // unprotected rather than leaving you to test it from an incognito window.
  const [authOpen, setAuthOpen] = useState(false);
  /*
   * Whether a password is set at all - which decides whether Lock is offered.
   *
   * Not `!authOpen`: that starts false and only becomes true once the server
   * answers, so an unprotected dashboard would show a Lock button for the
   * first half second and a protected one would not. Both are read from the
   * same answer instead, so they can never disagree.
   */
  const [authRequired, setAuthRequired] = useState(false);
  /* What the server says it is running - shown on the way in, see server.js. */
  const [build, setBuild] = useState(null);
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
    api.authState()
      .then((s) => {
        setAuthOpen(!s.required);
        setAuthRequired(Boolean(s.required));
        setBuild(s.build || null);
      })
      .catch(() => {});
  }, []);

  const loadUnsure = useCallback(() => {
    api.needsConfirmation().then((d) => setUnsure(d.tasks)).catch(() => {});
  }, []);

  useEffect(() => { loadUnsure(); }, [loadUnsure, tasks]);

  // Returns its promise, so a caller that has just made a folder can wait for
  // the list to catch up before using it.
  const loadGroups = useCallback(
    () => api.groups().then((d) => setGroups(d.groups)).catch(() => {}),
    []
  );

  useEffect(() => { loadGroups(); }, [loadGroups, tasks]);

  // Refreshed with the board, so finishing a delegated task drops the badge.
  useEffect(() => {
    api.delegationCounts().then(setDelegation).catch(() => {});
  }, [tasks]);

  /*
   * Leads, for the sidebar's badge. Only the two numbers that mean somebody is
   * waiting - captures nobody has read, and next contacts already gone by -
   * because a badge that counts every lead would never go away, and a badge
   * that never goes away is wallpaper.
   */
  const [leadCounts, setLeadCounts] = useState({ badge: 0, held: 0, overdue: 0, open: 0 });
  useEffect(() => {
    api.leadCounts().then(setLeadCounts).catch(() => {});
  }, [tasks, section]);

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

  const togglePicked = (task) => setPicked((current) => {
    const next = new Set(current);
    next.has(task.id) ? next.delete(task.id) : next.add(task.id);
    return next;
  });

  // A box ticked in the table is a pick, so the bar that acts on picks comes up.
  const pickRow = (task) => { setSelecting(true); togglePicked(task); };
  const pickMany = (ids, on) => {
    setSelecting(true);
    setPicked((current) => {
      const next = new Set(current);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  };

  const stopSelecting = () => { setSelecting(false); setPicked(new Set()); setGiving(false); };

  /*
   * Hand everything picked to one person.
   *
   * The board is where you notice that half of what is on it is somebody
   * else's work; one row at a time is the reason it stays that way. There is
   * no bulk route on the server for this and it does not need one - assigning
   * is a small write and a handful of them in parallel is a few milliseconds,
   * where an endpoint would be a second way to do the same thing.
   *
   * Nothing is sent to the person. Assigning records who has it; the app still
   * reminds him, never them.
   */
  const givePicked = async (rawName) => {
    const name = String(rawName || '').trim();
    const ids = [...picked];
    if (!name || !ids.length) return;
    // A person already on the list brings their WhatsApp id with them, so a
    // follow-up written later knows which chat it belongs in.
    const known = people.find((p) => p.name?.toLowerCase() === name.toLowerCase());
    try {
      await Promise.all(ids.map((id) => api.assign(id, name, known?.wid || null)));
      stopSelecting();
      await refresh({ quiet: true });
      loadPeople();
    } catch (err) {
      setError(err.message);
    }
  };

  /*
   * Archive everything picked, in one request, with one way back.
   *
   * The undo matters more here than anywhere: this is the one action that can
   * take fifty rows off the list at once, and the id list is exactly what is
   * needed to put them back.
   */
  const archivePicked = async () => {
    const ids = [...picked];
    if (!ids.length) return;
    try {
      const { archived } = await api.archiveMany(ids);
      setUndo({ kind: 'archived', ids, count: archived });
      stopSelecting();
      await refresh({ quiet: true });
    } catch (err) {
      setError(err.message);
    }
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
    await act(() => {
      if (last.kind === 'moved') return api.updateTask(last.id, { group_id: last.from });
      // A batch goes back as a batch: one request, the same ids.
      if (last.kind === 'archived') return api.restoreMany(last.ids);
      return api.restoreTask(last.id);
    });
  };
  const onEdit = (task, patch) => {
    // Keep the open panel showing what was just changed, without a round trip.
    setOpenTask((current) => (current?.id === task.id ? { ...current, ...patch } : current));
    return act(() => api.updateTask(task.id, patch));
  };
  /*
   * A deadline set from the row: a day offset, an exact date, or none at all.
   *
   * Clearing sends both halves. `due_at` is the deadline the reminder engine
   * actually counts from, so emptying only `due_date` left a task reading "No
   * deadline" on the row while still being chased on the old one.
   */
  const onQuickDate = (task, when) =>
    onEdit(task, when === null
      ? { due_date: '', due_at: '' }
      : { due_date: typeof when === 'number' ? isoDay(when) : when });
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

  /*
   * The day's work: everything except the set-aside groups and the work he has
   * already handed to somebody else.
   *
   * Both are fetched with the rest because another page needs them, and both
   * are excluded here for the same reason - Vacancies alone is a hundred and
   * ten open rows, and counted into "192 pending" it drowned the twenty-five
   * things actually owed. Allotted work does the same thing: it is still his
   * to chase, so it keeps its deadline and its reminders, but it is not what he
   * sits down to do, and Task allotted is the page that answers for it.
   *
   * So every figure, the focus list, the calendar and the rail read this, and
   * only that group's own page, the Businesses page, Task allotted and search
   * read them all. Nothing is hidden quietly: the line above the list says how
   * many are with somebody, and one press brings them back.
   */
  const dayTasks = useMemo(
    () => tasks.filter((t) => !t.group_separate && (showAllotted || !withSomebody(t))),
    [tasks, showAllotted]
  );

  /*
   * How much the line above the list is speaking for. Open only, so it agrees
   * with the badge on the sidebar's Task allotted - a delegation everybody has
   * finished with is history, not something to count.
   */
  const allottedHidden = useMemo(
    () => tasks.filter((t) => !t.group_separate && withSomebody(t)).length,
    [tasks]
  );

  const overdueCount = useMemo(() => dayTasks.filter(isOverdue).length, [dayTasks]);

  // Chats that actually have tasks, most first - the filter offers only these.
  const chats = useMemo(() => {
    const counts = new Map();
    for (const task of dayTasks) {
      const name = taskChat(task);
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [dayTasks]);

  /*
   * The notes the search box matches.
   *
   * Loaded once when a search starts rather than on every keystroke: the whole
   * set is small, it is the same data the notes page holds, and filtering it
   * here costs nothing next to a request per character.
   */
  const [allNotes, setAllNotes] = useState([]);
  const loadPeople = useCallback(() => {
    api.delegation('all').then((d) => setPeople(d.people?.allotted || [])).catch(() => {});
  }, []);

  /*
   * Refreshed with the tasks, because a task changing hands is what changes
   * who is on this list. Declared with its effect rather than beside the
   * groups' one - reaching for it up there would be reading a const before it
   * exists.
   */
  useEffect(() => { loadPeople(); }, [loadPeople, tasks]);

  const loadNotes = useCallback(() => {
    api.notes().then((d) => setAllNotes(d.notes)).catch(() => {});
  }, []);
  /*
   * Loaded when a search starts, and for the calendar, which shows the notes
   * that carry a reminder alongside the work due that day.
   */
  useEffect(() => {
    // `section` rather than the page object, which is worked out further down
    // - reading it here would be reaching for a const before it exists.
    if ((!searching && section !== 'calendar') || allNotes.length) return;
    loadNotes();
  }, [searching, section, allNotes.length, loadNotes]);

  const noteHits = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return allNotes.filter((note) =>
      [note.title, note.body, note.group_name, note.chat_name, (note.tags || []).join(' ')]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle))
    );
  }, [allNotes, query]);

  const monthPool = useMemo(() => {
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
      /*
       * Work with somebody else lives on Task allotted. Same rule as above and
       * the same escape hatches: the toggle on the line above the list, and
       * search, which looks through everything you have.
       */
      if (withSomebody(task) && !showAllotted) return false;

      if (view === 'open' && isDone(task)) return false;
      if (view === 'in_progress' && task.status !== 'in_progress') return false;
      if (view === 'overdue' && !isOverdue(task)) return false;
      if (view === 'done' && !isDone(task)) return false;
      // Completed, narrowed to one day it was actually closed on.
      if (view === 'done' && doneDay && !onDay(task.completed_at, doneDay)) return false;
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
      if (selectedDate && task.due_date !== selectedDate) return false;

      return matchesQuery(task, query);
    });
  }, [tasks, view, filters, query, selectedDate, searching, doneDay, showAllotted]);

  /*
   * The month scope is applied AFTER everything else, and the chips count what
   * comes out of the step before it.
   *
   * That ordering is the whole reason the strip can be trusted: filtered first
   * by view, folder and the rest, so a chip agrees with the list it opens -
   * and not yet by month, so picking September does not collapse every other
   * chip to zero, which is exactly what a strip must not do.
   *
   * Search ignores it entirely. If you went looking for something you want to
   * find it, whatever month it is in.
   */
  const visible = useMemo(
    () => (filters.month && !searching
      ? monthPool.filter((task) => taskMonth(task) === filters.month)
      : monthPool),
    [monthPool, filters.month, searching]
  );

  /*
   * What came in today, and how much of it this page is hiding.
   *
   * A task extracted from WhatsApp almost never carries a deadline - nobody
   * writes "PF filing, due Thursday", they write "PF filing to be done". So on
   * the Today filter, where the day is actually spent, the work that arrived
   * an hour ago is the one thing that cannot appear: it is not due today, it
   * is not due at all. Three new tasks read as none, and the honest answer
   * ("no deadline, press All") is one nobody should have to be told twice.
   *
   * So the day bar says it: how many arrived today, and how many of those are
   * not in the list underneath. Pressing it opens exactly those.
   */
  const arrivedToday = useMemo(
    () => dayTasks.filter((t) => onDay(t.created_at, todayIso())),
    [dayTasks]
  );

  const hiddenArrivals = useMemo(() => {
    /*
     * Only a day filter earns the flag. A folder page or a chat filter is a
     * scope you chose and are looking at - saying "6 new not shown" there
     * would be true and useless. A deadline filter is the one that hides work
     * you never asked it to hide, which is the whole reason for this.
     */
    if (searching || !selectedDate || !arrivedToday.length) return 0;
    const shown = new Set(visible.map((t) => t.id));
    return arrivedToday.filter((t) => !shown.has(t.id)).length;
  }, [arrivedToday, visible, searching, selectedDate]);

  /** The arrivals, on their own, newest first - nothing else filtered in. */
  const showArrivals = () => {
    setSelectedDate(null);
    setFilters(EMPTY_FILTERS);
    setQuery('');
    setGroupBy('none');
    setView('added_today');
  };

  const summary = useMemo(() => summarise(dayTasks), [dayTasks]);


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
  const tableOn = layout === 'table' && Boolean(page.tabs) && view !== 'myday';

  /*
   * The dashboard is a summary, and only a summary.
   *
   * Asked as "ye dashboard se hata do — dashboard pe sirf summary chahiye".
   * It used to render the whole board underneath the figures: the tabs, the
   * day, month and folder strips, the quick-add box and all 342 rows. So the
   * first screen of the app was the same list All Tasks holds, under a
   * summary of itself — two answers to "what should I look at", and the
   * figures pushed off the top by the list they were counting.
   *
   * Search is the one exception: Ctrl-K from the dashboard must show what it
   * found, and the results ARE the list.
   */
  const showBoard = !page.overview || searching;
  /*
   * The calendar sits in a column of its own beside the dashboard. Asked with
   * a screenshot of the empty strip running down the right of the page and
   * "calendar ko yaha dalo" - it had been filed among the figures at the
   * bottom, a screen and a half below the work it is about.
   */
  /*
   * Pressing a figure opens what it counts.
   *
   * Two of the six could not be reached from the old row at all: "Due today"
   * needs the board scoped to today's date, and "Completed today" needs the
   * done view scoped to this day's completions. Both already existed as state
   * (`selectedDate`, `doneDay`); nothing on the page could set them.
   */
  /*
   * Pressing a figure opens exactly what it counts - always, and it leaves the
   * dashboard to do it.
   *
   * Two things this went through. It first only set the view, and the
   * dashboard is a summary with no list on it, so the figure lit up and the
   * screen did not change. Then it kept the old row's toggle, which on a
   * control that navigates is worse than useless: "Open" is lit on arrival, so
   * pressing the one figure that says Open took you to a list of everything.
   *
   * A figure here is a doorway, not a filter chip. Nothing is lit, nothing
   * toggles, and `goto` runs before the scope because it clears it.
   */
  const goFigure = (key) => {
    goto('all');
    if (key === 'due_today') { setView('open'); return setSelectedDate(todayIso()); }
    if (key === 'completed_today') { setView('done'); return setDoneDay(todayIso()); }
    setView(key);
  };

  const goto = (key) => {
    setSection(key);
    setSelectedDate(null);
    setDoneDay(null);
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
    /*
     * The same page the list's tabs open, reachable from the dashboard too.
     * Three doors, one room: the sidebar, the board's tabs and this row all
     * arrive at Task allotted rather than at three arrangements of it.
     */
    if (key === 'allotted' || key === 'received') {
      setFilters(EMPTY_FILTERS);
      return goto(key);
    }
    // A section rather than a slice of the board, so it navigates.
    if (key === 'leads') return goto('leads');
    return undefined;
  };

  const activeQuick =
    view === 'myday' ? 'myday'
      /* These two are pages now, so the section says which one is open. */
      : section === 'allotted' ? 'allotted'
      : section === 'received' ? 'received'
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
        onSubmit={(password, opts) => {
          /* `remember` decides localStorage or sessionStorage - see api.js. */
          setToken(password, opts);
          setNeedsAuth(false);
          refresh();
        }}
        hadToken={Boolean(getToken())}
        build={build}
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
        leads={leadCounts}
        duplicates={stats?.duplicates || 0}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />

      <div className="main">
        <Header
          query={query}
          onQuery={setQuery}
          onRefresh={() => refresh()}
          loading={loading}
          /*
           * Lock. Asked for on the day the dashboard moved to a name anybody
           * can guess, and used from a borrowed screen - there was no way out
           * of it at all, short of clearing the browser's site data. Forgetting
           * the password is the token; dropping it puts the login screen back,
           * and nothing on the board outlives that, because the whole board
           * unmounts with it.
           */
          onLock={authRequired ? () => { setToken(null); setNeedsAuth(true); } : null}
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
          ) : section === 'legal' ? (
            <section className="settings-page">
              <div className="page-head">
                <div>
                  <h2>Legal &amp; court updates</h2>
                  <p>
                    Judgments, orders, new Acts and amendments — Supreme Court, High Courts,
                    NCLT/NCLAT and the tribunals. Kept apart from the tax digest on purpose:
                    a circular tells a client what to do by a date, a judgment tells you
                    where an argument now stands.
                  </p>
                </div>
              </div>
              <LegalUpdates onError={(err) => setError(err.message)} />
            </section>
          ) : section === 'law' ? (
            <section className="settings-page">
              <div className="page-head">
                <div>
                  <h2>Tax &amp; compliance updates</h2>
                  <p>
                    Tax and compliance: GST, Income Tax / TDS, MCA / ROC, PF-ESI-PT and the
                    case law that matters, read off the feeds each morning. The digest is
                    the day in one WhatsApp message, to your own chat and nowhere else;
                    below it is every update it was built from, kept as a record.
                  </p>
                </div>
              </div>
              <LawDigest onError={(err) => setError(err.message)} />
            </section>
          ) : section === 'duplicates' ? (
            <section className="settings-page">
              <div className="page-head">
                <div>
                  <h2>Duplicates</h2>
                  <p>
                    The same job written down more than once — usually because it was asked for
                    in two chats. Each copy carries its own reminders, so the job gets chased
                    once per copy.
                  </p>
                </div>
              </div>
              <Duplicates
                onOpen={setOpenTask}
                onChanged={() => refresh({ quiet: true })}
                onError={(err) => setError(err.message)}
                standalone
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
                onOpenSettings={() => goto('reminders')}
                onOpenTask={(id) => {
                  const found = tasks.find((t) => t.id === id);
                  if (found) setOpenTask(found);
                }}
                onChanged={() => refresh({ quiet: true })}
                onError={(err) => setError(err.message)}
              />
            </section>
          ) : page.leads ? (
            <section className="settings-page">
              <div className="page-head">
                <div>
                  <h2>{page.title}</h2>
                  <p>{page.lede}</p>
                </div>
              </div>
              <LeadsPage groups={groups} onError={(err) => setError(err.message)} />
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
                <StatusBar
                  status={status}
                  stats={stats}
                  overdueCount={overdueCount}
                  onRefresh={() => refresh({ quiet: true })}
                  onError={(err) => setError(err.message)}
                />
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

              {/* First after the connection: it decides what is read at all,
                  and the blocklist further down is only the second filter. */}
              <ListedChats mode={status?.whatsapp?.mode} onError={(err) => setError(err.message)} />
              <CaptureSettings onError={(err) => setError(err.message)} />
              <TidyTitles
                onChanged={() => refresh({ quiet: true })}
                onError={(err) => setError(err.message)}
              />
              <GroupNames onError={(err) => setError(err.message)} />
              <Backups
                state={status?.backups}
                onMake={() => api.makeBackup()}
                onDownload={(name) => api.downloadBackup(name)}
                onError={(err) => setError(err.message)}
                onRefresh={() => refresh({ quiet: true })}
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
                    <h2>
                      {greeting()}{status?.whatsapp?.meName ? `, ${String(status.whatsapp.meName).split(' ')[0]}` : ''}!{' '}
                      <span className="wave">👋</span>
                    </h2>
                    <p>Stay focused. Here&rsquo;s what&rsquo;s important today.</p>
                  </div>
                  <div className="page-head-right">
                    {/* The date, beside the one button on the page rather than
                        in a card of its own - it is one fact, not a panel. */}
                    <span className="head-date">
                      <small>{new Date().toLocaleDateString([], { weekday: 'long' })}</small>
                      <strong>{new Date().toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
                    </span>
                    <button className="btn primary lg" onClick={() => { setQuick((v) => !v); setComposing(false); }}>
                      <span aria-hidden="true">+</span> New Task
                    </button>
                  </div>
                </div>
              ) : (
                <div className="page-head">
                  <div>
                    <h2>{page.title}</h2>
                    <p>{tableOn
                      /* The lede says "grouped by when it is due", which is the
                         list's shape; the table is one order, set by a heading. */
                      ? 'Everything you have, one row each — sort by any heading.'
                      : page.lede}</p>
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
                    ? syncingFor(status.whatsapp.authenticatedAt)
                    : 'WhatsApp is not connected, so no new tasks are arriving.'}
                  <button className="link" onClick={() => goto('settings')}>Open settings</button>
                </div>
              )}

              {/*
                * Messages that came in and were never read for tasks.
                *
                * Normally zero. A number here is the answer to the question
                * that gets asked as "task add hi nahi hue" - the messages
                * arrived and are on disk, they were simply never put through
                * the extractor. So it says how many, and offers to run them,
                * rather than leaving the day looking empty for no stated
                * reason.
                */}
              {status?.whatsapp?.waitingToExtract > 0 && (
                <div className="banner warn" role="status">
                  {status.whatsapp.waitingToExtract} WhatsApp message
                  {status.whatsapp.waitingToExtract === 1 ? '' : 's'} arrived but
                  {status.whatsapp.waitingToExtract === 1 ? ' was' : ' were'} never read for
                  tasks. Nothing is lost — they are saved and can be run now.
                  <button
                    className="link"
                    disabled={rerunning}
                    onClick={async () => {
                      setRerunning(true);
                      try {
                        const out = await api.rerunExtraction();
                        await refresh({ quiet: true });
                        if (!out.ran) setError('Nothing was waiting after all.');
                      } catch (err) { setError(err.message); }
                      finally { setRerunning(false); }
                    }}
                  >
                    {rerunning ? 'Reading…' : 'Read them now'}
                  </button>
                </div>
              )}

              {/*
                * Running out of room, said where it will be seen.
                *
                * This is the failure that has actually happened: the volume
                * filled, SQLite could not write, and the process died before
                * it bound a port - so the app could not report its own
                * outage. The warning has to arrive while there is still room
                * to act, which means on the page he already has open, not in
                * a diagnostics block he opens after it breaks.
                */}
              {status?.diagnostics?.storage?.low && (
                <div className="banner error" role="alert">
                  Only {Math.round(status.diagnostics.storage.availableBytes / 1024 / 1024)} MB
                  left where the data lives. A WhatsApp sync writes hundreds of megabytes
                  here, and a full disk stops tasks being saved at all.
                  <button className="link" onClick={() => goto('settings')}>See storage</button>
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

                  {/*
                    * The dashboard, in the shape he drew: six figures, the
                    * work needing attention beside today's numbers, the whole
                    * list and the week just worked, what was finished and what
                    * arrived, and the connection at the foot.
                    *
                    * Every figure comes from `dayTasks` - not `tasks` -
                    * because delegated and set-aside work is off the board and
                    * everything on this page has to read the same list. The
                    * first render passed the raw one to half of it and put six
                    * zeroes above a bar that said two. The jump row and the
                    * duplicates notice go through as children: they are
                    * navigation and a warning, not figures.
                    */}
                  <DashboardHome
                    innerRef={railRef}
                    tasks={dayTasks}
                    summary={summary}
                    status={status}
                    chats={chats}
                    onPick={goFigure}
                    onOpen={setOpenTask}
                    onCompleted={() => { setView('done'); setDoneDay(todayIso()); }}
                    onUpcoming={showUpcoming}
                    onViewAi={() => goto('ai')}
                    focus={
                      <>
                        {stats?.duplicates > 0 && (
                          <p className="dup-note">
                            <b>{stats.duplicates}</b>{' '}
                            {stats.duplicates === 1 ? 'task looks like a copy' : 'tasks look like copies'}
                            {' '}of ones you already have.
                            <button className="link" onClick={() => goto('duplicates')}>Review them</button>
                          </p>
                        )}
                        {view !== 'done' && (
                          <FocusToday
                            tasks={dayTasks}
                            onOpen={setOpenTask}
                            onToggle={onToggle}
                            onRename={(task, title) => onEdit(task, { title })}
                            onShowAll={() => { setView('open'); setSelectedDate(todayIso()); }}
                          />
                        )}
                        <p className="dash-onward">
                          <button className="link" onClick={() => goto('all')}>Open the full list</button>
                          <span className="muted"> — every task, grouped by when it is due.</span>
                        </p>
                      </>
                    }
                    calendar={
                      <MonthCalendar
                        tasks={dayTasks}
                        selected={selectedDate}
                        onSelect={(iso) => { setSelectedDate(iso); setView('all'); }}
                      />
                    }
                  >
                    <QuickActions
                      counts={{
                        ...summary.counts,
                        leads: leadCounts.badge,
                        allotted: allottedHidden,
                        received: delegation?.received || 0,
                      }}
                      onAction={quickAction}
                      active={activeQuick}
                    />
                  </DashboardHome>
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
                  tasks={dayTasks}
                  notes={allNotes}
                  onChanged={() => { refresh({ quiet: true }); loadNotes(); }}
                  onOpenNote={(note) => { setNoteToOpen(note.id); setSection('notes'); }}
                  onError={(err) => setError(err.message)}
                  onOpen={setOpenTask}
                  onToggle={onToggle}
                  onStatus={(task, next) => onEdit(task, { status: next })}
                  onRename={(task, title) => onEdit(task, { title })}
                  onQuickDate={onQuickDate}
                  onDelete={onDelete}
                  onNotATask={onNotATask}
                />
              ) : (
                /*
                  * The dashboard keeps a column beside the board, and the
                  * calendar is the one thing in it.
                  *
                  * Asked with a screenshot of the empty strip down the right
                  * of the page and "calendar ko yaha dalo". Everywhere else
                  * is `solo` - a task list wants the whole width.
                  */
                <div className="workspace solo">
                  <main className="work">
                    {/*
                      * What is picked, and the one thing to do with it.
                      *
                      * Fixed to the bottom of the screen rather than sitting in
                      * the flow: the rows being picked are all over a long
                      * list, and a button that scrolls away is a button you
                      * cannot press at the moment you want it.
                      */}
                    {selecting && (
                      <div className="pick-bar" role="region" aria-label="Selected tasks">
                        <span className="pick-count">
                          {picked.size === 0
                            ? 'Tap the rows you want to remove or hand over'
                            : `${picked.size} selected`}
                        </span>
                        <button
                          type="button"
                          className="link"
                          onClick={() => setPicked(new Set(visible.map((t) => t.id)))}
                        >
                          Select all {visible.length}
                        </button>
                        {/*
                          * The other thing worth doing to a pile of rows at
                          * once: handing them over. Half of what clutters the
                          * board is work somebody else is doing, and naming
                          * that person is what moves it to Task allotted - one
                          * name for fifty rows rather than fifty drawers.
                          */}
                        {giving ? (
                          <form
                            className="pick-give"
                            onSubmit={(e) => { e.preventDefault(); givePicked(e.target.who.value); }}
                          >
                            <input
                              name="who"
                              autoFocus
                              list="pick-people"
                              placeholder="Who has it?"
                              aria-label="Who the selected tasks go to"
                              onKeyDown={(e) => { if (e.key === 'Escape') setGiving(false); }}
                            />
                            <datalist id="pick-people">
                              {people.map((person) => (
                                <option key={person.name} value={person.name} />
                              ))}
                            </datalist>
                            <button type="submit" className="btn">Give {picked.size}</button>
                          </form>
                        ) : (
                          <button
                            type="button"
                            className="btn ghost"
                            disabled={!picked.size}
                            onClick={() => setGiving(true)}
                          >
                            Give to…
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn danger"
                          disabled={!picked.size}
                          onClick={archivePicked}
                        >
                          Delete {picked.size || ''}
                        </button>
                        <button type="button" className="btn ghost" onClick={stopSelecting}>
                          Cancel
                        </button>
                      </div>
                    )}

                    {undo && (
                      <p className="banner ok undo-bar" role="status">
                        <span>
                          {undo.kind === 'moved' ? (
                            undo.toName
                              ? <>Moved <b>{undo.title}</b> to <b>{undo.toName}</b>.</>
                              : <>Took <b>{undo.title}</b> out of its group.</>
                          ) : undo.kind === 'archived' ? (
                            <>Took <b>{undo.count}</b> {undo.count === 1 ? 'task' : 'tasks'} off the list.
                              {' '}They are in Work History.</>
                          ) : (
                            <>Took <b>{undo.title}</b> off the list.</>
                          )}
                        </span>
                        <button className="link" onClick={undoLast}>Undo</button>
                        <button className="link" onClick={() => setUndo(null)}>Dismiss</button>
                      </p>
                    )}

                    {/*
                      * Copies, said where the copies are.
                      *
                      * There is a Duplicates page and it works, but "why
                      * duplication?" gets asked of the list on screen, not of a
                      * sidebar item nobody opened. One line, only when there is
                      * something to say, and it goes straight there.
                      */}
                    {/*
                      * Focus today belongs to My Day here. On the dashboard it
                      * is rendered by DashboardHome, in the card the drawing
                      * puts it in - one strip either way, not two.
                      */}
                    {page.focus && view !== 'done' && !searching && (
                      <FocusToday
                        tasks={dayTasks}
                        onOpen={setOpenTask}
                        onToggle={onToggle}
                        onRename={(task, title) => onEdit(task, { title })}
                        onShowAll={() => { setView('open'); setSelectedDate(todayIso()); }}
                      />
                    )}


                    {/*
                      * The controls stay put while the list scrolls.
                      *
                      * Asked for as "overdue ke upar wala part freeze ho".
                      * Over 277 tasks the tabs, the day chips and the folders
                      * are ten screens up by the time you want them, so
                      * changing what you are looking at means scrolling back
                      * to the top and then finding your place again. They are
                      * one block so they cannot drift apart, pinned under the
                      * top bar, which is sticky already.
                      *
                      * Only the controls. The greeting, the quick-add box and
                      * the notices below them are read once and would cost a
                      * third of a laptop screen for nothing.
                      */}
                    {/* Not an empty sticky band on the dashboard: the block
                        carries a bottom rule, so with nothing inside it drew a
                        line across the page under the figures. */}
                    {showBoard && (
                    <div className="board-controls">
                    {showBoard && (page.tabs || page.toolbar) && !searching && (
                      <div className="work-head">
                        {page.tabs ? (
                          <nav className="segment tabs" role="tablist" aria-label="View">
                            {[
                              { key: 'myday', label: 'My Day' },
                              { key: 'open', label: 'Open' },
                              { key: 'all', label: 'All' },
                              /*
                               * The two sides of work that is not only his.
                               *
                               * Asked for as "received and allotted, two tab
                               * only". They are views of this list, not links
                               * to the two pages: the pages group by person and
                               * stage, which is how you manage a handover, and
                               * this is how you read one — the same rows, the
                               * same sections, in the list already on screen.
                               * Allotted also needs no other way in, since
                               * those rows are otherwise off the board.
                               */
                              /*
                               * These two OPEN the page rather than filtering
                               * this list.
                               *
                               * Asked as "why both allotted tab diff — ek hi
                               * hona chahiye na", over two screens showing the
                               * same two rows. They were the same tasks, the
                               * same count, arranged two ways: the page groups
                               * by person and stage and carries Nudge, Delete,
                               * Manage staff and Give someone a task; the tab
                               * was the board with a filter and nothing of its
                               * own. Two shapes for one thing is a question
                               * about which is real, and he answered it: "page
                               * ek hi rahe, dono jagah se open hona chahiye".
                               * So the shortcut he asked for stays, and there
                               * is exactly one Allotted screen behind it.
                               */
                              { key: 'received', label: 'Received', count: delegation?.received || 0, to: 'received' },
                              { key: 'allotted', label: 'Allotted', count: allottedHidden, to: 'allotted' },
                            ].map((v) => (
                              <button
                                key={v.key}
                                role="tab"
                                aria-selected={view === v.key}
                                className={view === v.key ? 'active' : ''}
                                onClick={() => {
                                  if (v.to) return goto(v.to);
                                  setView(v.key);
                                  setSelectedDate(null);
                                  return undefined;
                                }}
                              >
                                {v.label}
                                {v.count > 0 && <span className="tab-count">{v.count}</span>}
                              </button>
                            ))}
                          </nav>
                        ) : <span />}

                        {page.toolbar && (
                          <Toolbar
                            groupBy={groupBy}
                            onGroupBy={setGroupBy}
                            filters={filters}
                            onFilters={setFilters}
                            chats={chats}
                            onClearAll={() => { setFilters(EMPTY_FILTERS); setSelectedDate(null); setQuery(''); }}
                            selecting={selecting}
                            onSelecting={(on) => (on ? setSelecting(true) : stopSelecting())}
                            /* Only on All Tasks, which is what he drew, and not on
                               My Day, whose rows are a ranked few rather than a
                               list to page through. */
                            layout={tableOn ? 'table' : 'list'}
                            onLayout={page.tabs && view !== 'myday' ? pickLayout : null}
                            onCalendar={() => goto('calendar')}
                          />
                        )}
                      </div>
                    )}

                    {/* The search term is the heading now, so the chip that
                        repeated it is only shown for a date. */}
                    {query && !searching && (
                      <div className="scope">
                        {/* The day bar above the list already says which day
                            it is showing, and says it where the change is
                            made. Only a search needs its own chip now. */}
                        {query && (
                          <span className="scope-chip">
                            “{query}”
                            <button onClick={() => setQuery('')} aria-label="Clear search">✕</button>
                          </span>
                        )}
                      </div>
                    )}

                    {/*
                      * Completed asks a different question of the same list:
                      * not what is owed but what got closed, and closed WHEN.
                      * So it gets the day control instead of the folder strip -
                      * the two never appear together, because they would be two
                      * answers to "what am I looking at".
                      *
                      * Keyed on the VIEW, not the page. "Completed" is reached
                      * three ways - the sidebar, the Done figure and the jump
                      * link - and only the first of them is its own page. Gated
                      * on the page, the day chips were missing from the two
                      * routes actually used, which is exactly how it was
                      * reported: the sections were grouped by day but there was
                      * nothing to pick a day with.
                      */}
                    {view === 'done' && !searching && (
                      <DayBar
                        mode="done"
                        day={doneDay}
                        onDay={setDoneDay}
                        count={visible.filter(isDone).length}
                      />
                    )}

                    {/*
                      * The same control, asking about deadlines.
                      *
                      * "What is due today" was reachable only through the
                      * calendar in the rail - which is a month, on a page that
                      * is a list, and not there at all on a phone. It is the
                      * question the list is most often opened with, so it is a
                      * press: Today, Tomorrow, or a date.
                      *
                      * It drives the same `selectedDate` the calendar sets, so
                      * the two agree and neither has to know about the other.
                      */}
                    {view !== 'done' && showBoard && (page.tabs || page.toolbar)
                      && !searching && (
                      <DayBar
                        day={selectedDate}
                        onDay={(iso) => { setSelectedDate(iso); if (iso) setView('all'); }}
                        count={visible.length}
                        arrived={arrivedToday.length}
                        hidden={hiddenArrivals}
                        arrivedOn={view === 'added_today'}
                        onArrived={() => (view === 'added_today' ? setView('all') : showArrivals())}
                      />
                    )}

                    {/*
                      * The businesses, small, above the list.
                      *
                      * The sidebar leaves the board to show one; this filters
                      * in place, which is the thing you actually do while
                      * reading a mixed list. Hidden while searching, where the
                      * search is the scope, and on the folder pages, which are
                      * already one folder.
                      */}
                    {showBoard && (page.tabs || page.toolbar) && !searching && (
                      <MonthStrip
                        tasks={monthPool}
                        active={filters.month}
                        onPick={(key) => setFilters((f) => ({ ...f, month: key }))}
                      />
                    )}

                    {showBoard && (page.tabs || page.toolbar) && !searching && !groupId
                      && view !== 'done' && (
                      <FolderStrip
                        groups={groups}
                        tasks={dayTasks}
                        active={filters.group}
                        onPick={(id) => setFilters((f) => ({ ...f, group: f.group === id ? null : id }))}
                        onManage={() => setSection('groups')}
                      />
                    )}
                    </div>
                    )}

                    {/*
                      * The fastest road of all: a line above the list, always
                      * there, no button to press first. Compact on purpose -
                      * the day chips are already on the panel above when that
                      * is open, and here the point is Enter.
                      */}
                    {showBoard && !searching && !page.calendar && view !== 'done' && !quick && (
                      <QuickAdd
                        compact
                        groupId={groupId}
                        groupName={activeGroup?.name || null}
                        onAdded={() => refresh({ quiet: true })}
                        onMore={(typed) => { setSeedTitle(typed); setComposing(true); }}
                        onError={(err) => setError(err.message)}
                      />
                    )}

                    {/*
                      * Where the allotted work went.
                      *
                      * It is off this list on purpose - it is with somebody
                      * else, and a hundred of those rows is what made All Tasks
                      * unreadable. But work that disappears with no explanation
                      * is worse than work in the way, so the list says how much
                      * is elsewhere, links to the page that holds it, and puts
                      * it back in one press for when he wants the whole picture.
                      */}
                    {/* The condition that used to stand this down — "not on
                        the Allotted tab" — is gone with the tab: there is one
                        Allotted screen now, and it is a page, so this line can
                        never appear over a list of the rows it is about. */}
                    {showBoard && allottedHidden > 0 && !searching && (
                      <p className="dup-note">
                        <b>{allottedHidden}</b>{' '}
                        {allottedHidden === 1 ? 'task is' : 'tasks are'} with somebody else
                        {showAllotted ? ' and shown here.' : ' and kept off this list.'}
                        <button className="link" onClick={() => goto('allotted')}>
                          Task allotted
                        </button>
                        <button className="link" onClick={() => setShowAllotted((v) => !v)}>
                          {showAllotted ? 'Hide them again' : 'Show them here'}
                        </button>
                      </p>
                    )}

                    {showBoard && tableOn && (
                      <TaskTable
                        tasks={visible}
                        loading={loading}
                        error={error && !tasks.length ? error : ''}
                        groups={groups}
                        picked={picked}
                        onPick={pickRow}
                        onPickMany={pickMany}
                        /* What starts the table again from page 1: a new
                           question, never a new poll of the same one. */
                        scope={[view, groupId, selectedDate, doneDay, query, showAllotted,
                          JSON.stringify(filters)].join('|')}
                        onRetry={() => refresh()}
                        onOpen={setOpenTask}
                        onStatus={(task, next) => onEdit(task, { status: next })}
                        onQuickDate={onQuickDate}
                        onDelete={onDelete}
                        onNotATask={onNotATask}
                        onRename={(task, title) => onEdit(task, { title })}
                        onAddUpdate={(task) => { setFocusProgress(task.id); setOpenTask(task); }}
                      />
                    )}

                    {showBoard && !tableOn && (
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
                      /* Renamed in the list itself: F2 or a double-click. A
                         title is what he reads back for weeks and is the one
                         field worth fixing without opening anything. */
                      onRename={(task, title) => onEdit(task, { title })}
                      selecting={selecting}
                      picked={picked}
                      onPick={togglePicked}
                      onQuickDate={onQuickDate}
                      onDelete={onDelete}
                      onNotATask={onNotATask}
                      groups={groups}
                      onMove={onMove}
                      onManageGroups={() => { setSection('groups'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      /*
                        * A folder made from the row it is needed on. The
                        * colour is left to the server's own rotation, so a new
                        * one is distinguishable from the others without asking
                        * him to pick from a palette mid-thought.
                        */
                      onNewGroup={async (name) => {
                        const { group } = await api.createGroup({ name });
                        await loadGroups();
                        return group;
                      }}
                      onOpenGroup={(id) => { goto(`group:${id}`); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      /*
                        * Two ways in, one handler. With a sentence, it is the
                        * row's own note box and it saves straight away; without
                        * one, it is the ⋮ menu asking for the drawer, where the
                        * whole stream of updates lives.
                        */
                      onAddUpdate={async (task, text) => {
                        if (!text) { setFocusProgress(task.id); setOpenTask(task); return; }
                        try {
                          await api.addUpdate(task.id, { body: text });
                          refresh({ quiet: true });
                        } catch (err) { setError(err.message); }
                      }}
                      people={people}
                      onAssign={async (task, name, wid) => {
                        try {
                          await api.assign(task.id, name, wid);
                          refresh({ quiet: true });
                          loadPeople();
                        } catch (err) { setError(err.message); }
                      }}
                    />
                    )}

                  </main>

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
