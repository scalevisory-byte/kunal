import { useState } from 'react';
import TaskItem from './TaskItem.jsx';
import Icon from './Icon.jsx';
import { isDone, isOverdue, isoDay, taskChat, todayIso } from '../lib/task.js';
import { parseStamp } from '../lib/derive.js';

/*
 * Within a day, earliest first.
 *
 * The list arrives ordered by priority, which is right across the whole board
 * and wrong inside one day: a medium task at 11:30 was appearing under a high
 * one at 6pm, so "Today" did not read in the order the day actually happens.
 * Priority still decides between two things due at the same moment, and a task
 * with no time on it sits after the ones that have one - it is owed that day,
 * not at a point in it.
 */
function byClock(a, b) {
  const at = a.due_at || null;
  const bt = b.due_at || null;
  if (at && bt && at !== bt) return at < bt ? -1 : 1;
  if (at && !bt) return -1;
  if (!at && bt) return 1;

  /*
   * Neither has a deadline, so there is no hour to sort by - and "No date" is
   * where most of the list ends up. What separates them is when they arrived:
   * newest first, so what came in this morning is at the top rather than buried
   * under a fortnight of older captures. Priority only breaks a genuine tie.
   */
  const added = (t) => String(t.created_at || '');
  if (added(a) !== added(b)) return added(a) < added(b) ? 1 : -1;
  const rank = (t) => (t.priority === 'high' ? 0 : t.priority === 'medium' ? 1 : 2);
  return rank(a) - rank(b) || b.id - a.id;
}

/** Sections by day: what is late, what is today, what is next. */
function byDate(open) {
  const today = todayIso();
  const tomorrow = isoDay(1);
  const weekEnd = isoDay(7);

  return [
    { key: 'overdue', label: 'Overdue', tone: 'danger', icon: 'alert', match: (t) => t.due_date && t.due_date < today },
    { key: 'today', label: 'Today', tone: 'warn', icon: 'sun', match: (t) => t.due_date === today },
    { key: 'tomorrow', label: 'Tomorrow', tone: 'info', icon: 'calendar', match: (t) => t.due_date === tomorrow },
    {
      key: 'week',
      label: 'This week',
      tone: 'plain',
      icon: 'calendar',
      match: (t) => t.due_date > tomorrow && t.due_date <= weekEnd,
    },
    { key: 'later', label: 'Later', tone: 'plain', icon: 'calendar', match: (t) => t.due_date > weekEnd },
    {
      key: 'undated',
      label: 'No deadline',
      tone: 'plain',
      icon: 'circle',
      /*
       * Said here because this is where it is asked.
       *
       * "No date" was read as a missing timestamp rather than as a deadline
       * nobody has set — and the consequence is not obvious from the words: a
       * task with no deadline has nothing for the ladder to count from, so it
       * is never chased. It still reaches the twice-daily WhatsApp list, which
       * is why this says what it does and not "these are ignored".
       */
      note: 'No deadline set, so the reminder ladder has nothing to count from — these are not chased. They still appear in the twice-daily WhatsApp list. Give one from the ⋮ menu.',
      match: (t) => !t.due_date,
    },
  ].map((c) => ({ ...c, items: open.filter(c.match).sort(byClock) }));
}

/**
 * Sections by why a task is on the Needs Attention page.
 *
 * The page gathers three different problems — the app has given up chasing it,
 * the deadline has passed, it is owed today — and listed them flat they were
 * indistinguishable from any other list: the same rows, in the same order,
 * under a heading that said "Today". Nothing on the screen answered the only
 * question the page exists to answer, which is *why is this one here*.
 *
 * So the reason is the section. Worst first, and each task appears once under
 * the most serious thing true about it: a task the app stopped chasing is not
 * also filed under "overdue", because what to do about it is different.
 */
function byReason(open) {
  const today = todayIso();
  const taken = new Set();
  const claim = (match) => (t) => {
    if (taken.has(t.id) || !match(t)) return false;
    taken.add(t.id);
    return true;
  };

  return [
    {
      key: 'stopped',
      label: 'Stopped asking',
      note: 'Reminded the maximum number of times. The app will not ask again — this one is yours to decide.',
      tone: 'warn',
      icon: 'alert',
      match: claim((t) => t.needs_attention),
    },
    {
      key: 'overdue',
      label: 'Past its deadline',
      note: 'The deadline has gone. Finish it, or give it a new one.',
      tone: 'danger',
      icon: 'alert',
      match: claim((t) => isOverdue(t) || t.state === 'overdue'),
    },
    {
      key: 'today',
      label: 'Owed today',
      note: 'Due before the day is out.',
      tone: 'warn',
      icon: 'sun',
      match: claim((t) => t.due_date === today || t.state === 'due'),
    },
  ].map((c) => ({ ...c, items: open.filter(c.match).sort(byClock) }));
}

/** Sections by conversation, for working through one person or group at a time. */
function byChat(open) {
  const groups = new Map();
  for (const task of open) {
    const name = taskChat(task) || 'Added by hand';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(task);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([name, items]) => ({ key: name, label: name, tone: 'info', icon: 'chat', items }));
}

/**
 * One section per folder, and one for everything not in a folder yet.
 *
 * The businesses are the shape the work actually has - "what is outstanding
 * for Book N Fly" is a question the date view cannot answer at all - and the
 * unfiled sit at the end rather than being hidden, because that pile is the
 * one worth clearing.
 */
function byFolder(open, groups) {
  /*
   * Set-aside folders have no section here.
   *
   * Their work is deliberately not on the board, so a heading saying
   * "Vacancies · 110 tasks" above an empty section was counting it back in -
   * which is the one thing setting a folder aside is for. It is reached from
   * the sidebar and the Businesses page instead.
   */
  const sections = groups.filter((g) => !g.separate).map((g) => {
    const items = open.filter((t) => t.group_id === g.id);
    return {
      key: `g${g.id}`,
      label: g.name,
      tone: 'info',
      dot: g.colour || 'teal',
      items,
      total: items.length,
      keep: true,
      groupId: g.id,
      note: items.length ? undefined : 'Nothing open in here.',
      empty: items.length ? undefined : 'Move work in with the folder button on any row.',
    };
  });

  const loose = open.filter((t) => !t.group_id);
  sections.push({
    key: 'nofolder',
    label: 'Not in a folder',
    tone: 'plain',
    icon: 'inbox',
    items: loose,
    total: loose.length,
    keep: true,
    note: loose.length ? 'Put one away with the folder button on its row.' : undefined,
    empty: 'Everything is filed.',
  });
  return sections;
}

/**
 * Finished work, one section per day it was closed on.
 *
 * "What did I actually get done today?" is the question this page is opened
 * with, and a single list of everything ever finished cannot answer it - by
 * the second week the day you want is a hundred rows down. Today and Yesterday
 * are named, because that is how they are asked for; older days carry their
 * date. A task finished with no completion time recorded gets its own section
 * rather than being dated with a guess.
 */
function byCompleted(done) {
  const today = todayIso();
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');

  const days = new Map();
  const undated = [];
  for (const task of done) {
    /*
     * `parseStamp`, not `new Date`.
     *
     * SQLite writes "YYYY-MM-DD HH:MM:SS" in UTC with no marker, and Date
     * reads a string like that as LOCAL time - five and a half hours out
     * here. The sections would then file a task finished after 6pm UTC under
     * the previous day while the day filter, which parses it correctly, put
     * it under the right one: the heading and the chip disagreeing about the
     * same task.
     */
    const at = parseStamp(task.completed_at);
    const day = at ? at.toLocaleDateString('en-CA') : null;
    if (!day) { undated.push(task); continue; }
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(task);
  }

  const label = (iso) => {
    if (iso === today) return 'Today';
    if (iso === yesterday) return 'Yesterday';
    return new Date(`${iso}T00:00:00`).toLocaleDateString([], {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    });
  };

  const sections = [...days.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([iso, items]) => ({
      key: `d${iso}`,
      label: label(iso),
      tone: 'ok',
      icon: 'check',
      items: items.sort((a, b) =>
        (parseStamp(b.completed_at)?.getTime() || 0) - (parseStamp(a.completed_at)?.getTime() || 0)),
    }));

  if (undated.length) {
    sections.push({
      key: 'nodate',
      label: 'No date recorded',
      tone: 'plain',
      icon: 'check',
      items: undated,
      note: 'Finished before the app started keeping the time.',
    });
  }
  return sections;
}

/**
 * My day is the answer to "what now": late work first, then what is already
 * underway, then what is urgent or due today, and finally what was finished.
 */
function myDay(open, done) {
  const today = todayIso();
  const completedToday = done.filter((t) => (t.completed_at || '').slice(0, 10) === today);

  return [
    { key: 'overdue', label: 'Overdue', tone: 'danger', icon: 'alert', items: open.filter(isOverdue) },
    {
      key: 'today',
      label: 'Due today',
      tone: 'warn',
      icon: 'sun',
      items: open.filter((t) => t.due_date === today && !isOverdue(t)),
    },
    {
      key: 'doing',
      label: 'In progress',
      tone: 'info',
      icon: 'play',
      items: open.filter((t) => t.status === 'in_progress' && t.due_date !== today && !isOverdue(t)),
    },
    {
      key: 'high',
      label: 'High priority',
      tone: 'danger',
      icon: 'flag',
      items: open.filter(
        (t) => t.priority === 'high' && t.status !== 'in_progress' && t.due_date !== today && !isOverdue(t)
      ),
    },
    { key: 'donetoday', label: 'Completed today', tone: 'ok', icon: 'check', items: completedToday },
  ];
}

const count = (n) => `${n} ${n === 1 ? 'task' : 'tasks'}`;

export default function TaskList({
  tasks, loading, error, groupBy, view, query, groups = [], people = [],
  onRetry, onToggle, onOpen, onStatus, onQuickDate, onDelete, onNotATask,
  onMove, onManageGroups, onNewGroup, onAddUpdate, onAssign, onOpenGroup,
}) {
  /*
   * Grouped by chat or by folder, the sections start shut.
   *
   * One busy chat holds a dozen tasks and one business holds a hundred;
   * expanded, the first section pushes every other off the screen, which
   * defeats the point of grouping at all. A section the user has opened or
   * shut themselves is remembered for as long as the page is; only the
   * starting state differs.
   */
  const [collapsed, setCollapsed] = useState({});
  const [touched, setTouched] = useState({});
  /*
   * By chat and by folder, the sections start shut.
   *
   * Open, "by folder" was the same list of tasks with headings dropped into
   * it - the folders were there but you had to scroll past a hundred rows to
   * see the second one. Shut, the page is the folders and what each is
   * carrying, and you open the one you mean; the tasks are one press away and
   * a section you open yourself stays open. Grouped by date they stay open:
   * those sections are the day, and a closed "Today" is just a heading.
   */
  const shutByDefault = ['chat', 'folder'].includes(groupBy) && view !== 'myday';
  if (error) {
    return (
      <div className="empty error-state">
        <strong>Unable to load tasks</strong>
        <p>Check your connection, then try again.</p>
        <button className="btn ghost" onClick={onRetry}>Try again</button>
      </div>
    );
  }

  if (loading && !tasks.length) {
    return (
      <div className="empty" aria-busy="true">
        <strong>Loading tasks…</strong>
        <p>One moment.</p>
      </div>
    );
  }

  const open = tasks.filter((t) => !isDone(t));
  const done = tasks.filter(isDone);

  let sections;
  /*
   * Completed is its own shape: it groups by the day work was closed, not by
   * when it was due. Everything on this page is already done, so the trailing
   * "Completed" section below would be the whole page repeated.
   */
  if (view === 'done') sections = byCompleted(done);
  else if (view === 'myday') sections = myDay(open, done);
  else if (groupBy === 'reason') sections = byReason(open);
  else if (groupBy === 'chat') sections = byChat(open);
  else if (groupBy === 'folder') sections = byFolder(open, groups);
  /*
   * Recent asks a different question from every other view: not what is most
   * pressing, but what has just arrived. Grouping it by deadline would answer
   * the old question again, so it is one list in the order things came in.
   */
  else if (groupBy === 'none') {
    const arrived = [...tasks].sort((a, b) =>
      String(b.created_at || '').localeCompare(String(a.created_at || '')));
    return (
      <div className="sections">
        <section className="section tone-plain">
          <ul className="task-list">
            {arrived.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                onToggle={onToggle}
                onOpen={onOpen}
                onStatus={onStatus}
                onQuickDate={onQuickDate}
                onDelete={onDelete}
                onNotATask={onNotATask}
                groups={groups}
                onMove={onMove}
                onManageGroups={onManageGroups}
                onNewGroup={onNewGroup}
                onAddUpdate={onAddUpdate}
                people={people}
                onAssign={onAssign}
              />
            ))}
          </ul>
        </section>
      </div>
    );
  }
  else sections = byDate(open);

  // A folder with nothing in it is still a folder: the by-folder view is
  // meant to be the list of them, so those sections stay and say so.
  sections = sections.filter((s) => s.items.length || s.keep);
  if (view !== 'myday' && view !== 'done' && done.length) {
    sections.push({ key: 'done', label: 'Completed', tone: 'ok', icon: 'check', items: done });
  }

  if (!sections.length) {
    return (
      <div className="empty">
        <strong>{query ? 'No tasks match your search.' : "You're all caught up."}</strong>
        <p>
          {query
            ? 'Try a different word, or clear the filters.'
            : view === 'all'
              ? 'Tasks from WhatsApp appear here on their own.'
              : 'No pending tasks for this period.'}
        </p>
      </div>
    );
  }

  return (
    <div className="sections">
      {sections.map((section) => {
        const shut = touched[section.key] ? collapsed[section.key] : shutByDefault;
        return (
          <section
            className={`section s-${section.key} ${section.cls || ''} tone-${section.tone || 'plain'}`}
            key={section.key}
          >
            <button
              className="section-head"
              aria-expanded={!shut}
              onClick={() => {
                setTouched((t) => ({ ...t, [section.key]: true }));
                setCollapsed((c) => ({ ...c, [section.key]: !shut }));
              }}
            >
              {section.dot
                ? <span className={`board-dot c-${section.dot}`} aria-hidden="true" />
                : <Icon name={section.icon || 'circle'} size={17} className="section-icon" />}
              <h3>{section.label}</h3>
              <span className="section-count">{count(section.total ?? section.items.length)}</span>
              {/* What this section means, where the heading alone is not enough
                  to act on — "Stopped asking" says nothing about what to do. */}
              {section.note && <span className="section-note">{section.note}</span>}
              <Icon name="chevronDown" size={17} className={`section-chevron ${shut ? '' : 'up'}`} />
            </button>
            {!shut && !section.items.length && (section.empty || section.groupId) && (
              <p className="section-empty">
                {section.empty}
                {section.groupId && onOpenGroup && (
                  <button className="linky" onClick={() => onOpenGroup(section.groupId)}>
                    Open {section.label}
                  </button>
                )}
              </p>
            )}
            {!shut && (
              <ul className="task-list">
                {section.items.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    onToggle={onToggle}
                    onOpen={onOpen}
                    onStatus={onStatus}
                    onQuickDate={onQuickDate}
                    onDelete={onDelete}
                    onNotATask={onNotATask}
                    groups={groups}
                    onMove={onMove}
                    onManageGroups={onManageGroups}
                    onNewGroup={onNewGroup}
                onNewGroup={onNewGroup}
                    onAddUpdate={onAddUpdate}
                    people={people}
                    onAssign={onAssign}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
