import { useState } from 'react';
import TaskItem from './TaskItem.jsx';
import Icon from './Icon.jsx';
import { isDone, isOverdue, isoDay, taskChat, todayIso } from '../lib/task.js';

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
      label: 'No date',
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
  tasks, loading, error, groupBy, view, query, groups = [],
  onRetry, onToggle, onOpen, onStatus, onQuickDate, onDelete, onNotATask,
  onMove, onManageGroups, onAddUpdate,
}) {
  /*
   * Grouped by chat, the sections start shut.
   *
   * One busy chat can hold a dozen tasks, and expanded they push every other
   * chat off the screen - which defeats the point of grouping by chat at all.
   * Shut, the page is the list of chats and how much each is carrying, and you
   * open the one you mean. Grouped by date they stay open: those sections are
   * the day, and a closed "Today" is just a heading.
   *
   * A section the user has opened or shut themselves is remembered for as long
   * as the page is; only the starting state differs.
   */
  const [collapsed, setCollapsed] = useState({});
  const [touched, setTouched] = useState({});
  const shutByDefault = groupBy === 'chat' && view !== 'myday';
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
  if (view === 'myday') sections = myDay(open, done);
  else if (groupBy === 'reason') sections = byReason(open);
  else if (groupBy === 'chat') sections = byChat(open);
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
                onAddUpdate={onAddUpdate}
              />
            ))}
          </ul>
        </section>
      </div>
    );
  }
  else sections = byDate(open);

  sections = sections.filter((s) => s.items.length);
  if (view !== 'myday' && done.length) {
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
              <span className="section-count">{count(section.items.length)}</span>
              {/* What this section means, where the heading alone is not enough
                  to act on — "Stopped asking" says nothing about what to do. */}
              {section.note && <span className="section-note">{section.note}</span>}
              <Icon name="chevronDown" size={17} className={`section-chevron ${shut ? '' : 'up'}`} />
            </button>
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
                    onAddUpdate={onAddUpdate}
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
