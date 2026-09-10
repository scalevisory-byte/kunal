import { useCallback, useState } from 'react';
import Icon from './Icon.jsx';

/** Grouped so the list reads as three short lists rather than one long one. */
const NAV = [
  {
    label: 'Workspace',
    items: [
      { key: 'myday', label: 'My Day', icon: 'sun' },
      { key: 'all', label: 'All Tasks', icon: 'list' },
      { key: 'board', label: 'Businesses', icon: 'board' },
      { key: 'notes', label: 'Notes', icon: 'note' },
      { key: 'calendar', label: 'Calendar', icon: 'calendar' },
    ],
  },
  {
    label: 'Organise',
    items: [
      { key: 'recent', label: 'Recent', icon: 'clock' },
      { key: 'chat', label: 'By Chat', icon: 'chat' },
      { key: 'ai', label: 'AI Tasks', icon: 'robot' },
      { key: 'done', label: 'Completed', icon: 'check' },
      { key: 'history', label: 'Work History', icon: 'clipboard' },
      /* Tidying up, not the day's work: it has a page rather than a block on
         the dashboard, where a run of twenty near-identical jobs buried the
         task list the page exists to show. */
      { key: 'duplicates', label: 'Duplicates', icon: 'archive' },
    ],
  },
  {
    /*
     * Work with somebody else's name on it, both ways round. It is its own
     * group because "who owes this" is a different question from "when is it
     * due", and answering it by filtering the main list meant never asking it.
     */
    label: 'People',
    items: [
      { key: 'leads', label: 'Leads', icon: 'flag', count: 'leads' },
      { key: 'received', label: 'Task received', icon: 'inbox', count: 'received' },
      { key: 'allotted', label: 'Task allotted', icon: 'outbox', count: 'allotted' },
    ],
  },
  {
    label: 'Automation',
    items: [
      { key: 'reminders', label: 'Reminders & follow-ups', icon: 'bell' },
      { key: 'monthly', label: 'Monthly deadlines', icon: 'calendar' },
      /*
       * Two lists, named for what they are. "Law updates" was one thing when
       * there was one; with judgments beside circulars the reader has to be
       * told which door leads where before they open it.
       */
      { key: 'law', label: 'Tax & compliance', icon: 'clipboard' },
      { key: 'legal', label: 'Legal & court', icon: 'flag' },
      { key: 'templates', label: 'Templates', icon: 'flag' },
      { key: 'groups', label: 'Manage groups', icon: 'settings' },
    ],
  },
  {
    label: 'System',
    afterBusinesses: true,
    items: [
      { key: 'usage', label: 'AI Usage', icon: 'clipboard' },
      { key: 'settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

/*
 * The one item that is never behind a fold.
 *
 * Every group here collapses, so with them all shut the first thing on the
 * screen was a heading rather than a way in. The dashboard is where you start,
 * so it sits outside the groups and above them.
 */
const PINNED = { key: 'dashboard', label: 'Dashboard', icon: 'dashboard' };

/*
 * Which groups are open.
 *
 * Shut is the starting state: twenty-two items is a wall to read past every
 * time, and six headings is a map. What is open is remembered, because a
 * person opens the two groups they actually live in and wants them there
 * tomorrow.
 */
const STORE = 'wa.sidebar.open';

const readOpen = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
};

const writeOpen = (set) => {
  try { localStorage.setItem(STORE, JSON.stringify([...set])); } catch { /* private window */ }
};

/**
 * One group of the nav.
 *
 * Shut, it still shows the item you are currently on — so the sidebar folds
 * down to the headings plus your own position, rather than to headings and no
 * idea where you are. And the badges add up onto the heading, because a count
 * you cannot see is the one thing collapsing must not cost.
 */
function NavGroup({ label, items, section, open, onToggle, onPick }) {
  const total = items.reduce((sum, item) => sum + (item.aside ? 0 : item.badge || 0), 0);
  const here = items.some((item) => item.key === section);
  const shown = open ? items : items.filter((item) => item.key === section);

  return (
    <div className={`side-group ${open ? 'open' : 'shut'}`}>
      <button
        type="button"
        className={`side-group-label ${here ? 'here' : ''}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <Icon name="chevronDown" size={13} className={`side-chevron ${open ? '' : 'shut'}`} />
        <span className="side-group-name">{label}</span>
        {!open && total > 0 && <span className="side-count">{total}</span>}
      </button>

      {shown.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`side-item ${section === item.key ? 'on' : ''}`}
          aria-current={section === item.key ? 'page' : undefined}
          onClick={() => onPick(item.key)}
        >
          {item.dot
            ? <span className={`group-dot c-${item.dot}`} aria-hidden="true" />
            : <Icon name={item.icon} size={17} />}
          <span className="side-item-name">{item.label}</span>
          {item.badge > 0 && (
            <span className={`side-count ${item.aside ? 'aside' : ''}`}>{item.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** The application's spine: where you are, and the one fact that matters below. */
export default function Sidebar({
  section, onSection, connected, open, onClose, groups = [], delegation = null, leads = null,
}) {
  const [openGroups, setOpenGroups] = useState(readOpen);

  const toggle = useCallback((label) => {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      writeOpen(next);
      return next;
    });
  }, []);

  const pick = (key) => { onSection(key); onClose(); };

  // The businesses sit with the work, above the housekeeping. Built here so
  // they are one more group like any other rather than a special case inside
  // the render.
  const businesses = groups.length
    ? [{
        label: 'Businesses',
        items: groups.map((g) => ({
          key: `group:${g.id}`,
          label: g.name,
          dot: g.colour,
          badge: g.counts?.open || 0,
          /*
           * A set-aside folder's count is about that folder, not about the
           * day, so it is not added into the heading's total. Vacancies alone
           * put 110 on "Businesses" and made the whole section read as work
           * owed - which is the opposite of setting it aside.
           */
          aside: Boolean(g.separate),
        })),
      }]
    : [];

  const sections = [];
  for (const group of NAV) {
    if (group.afterBusinesses) sections.push(...businesses);
    sections.push({
      label: group.label,
      items: group.items.map((item) => ({
        ...item,
        /*
         * Only what is still outstanding is worth a badge; a count of finished
         * delegations is history, not a nudge. Leads count the same way: what
         * is waiting to be read, plus who has been left too long.
         */
        badge: item.count === 'leads'
          ? (leads?.badge || 0)
          : item.count ? (delegation?.[item.count] || 0) : 0,
      })),
    });
  }

  return (
    <>
      <div className={`scrim ${open ? 'on' : ''}`} onClick={onClose} role="presentation" />
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Sections">
        <div className="side-brand">
          <span className="side-mark"><Icon name="whatsapp" size={20} /></span>
          <span className="side-name">
            <strong>WA Tasks</strong>
            <small>Task management</small>
          </span>
        </div>

        <nav className="side-nav">
          <div className="side-group side-pinned">
            <button
              type="button"
              className={`side-item ${section === PINNED.key ? 'on' : ''}`}
              aria-current={section === PINNED.key ? 'page' : undefined}
              onClick={() => pick(PINNED.key)}
            >
              <Icon name={PINNED.icon} size={17} />
              <span className="side-item-name">{PINNED.label}</span>
            </button>
          </div>

          {sections.map((group) => (
            <NavGroup
              key={group.label}
              label={group.label}
              items={group.items}
              section={section}
              open={openGroups.has(group.label)}
              onToggle={() => toggle(group.label)}
              onPick={pick}
            />
          ))}
        </nav>

        <div className="side-foot">
          <p className="side-motto">Stay organised<br />Do more</p>
          <p className={`side-state ${connected ? 'on' : 'off'}`}>
            <span className="state-dot" />
            {connected ? 'Connected via WhatsApp' : 'WhatsApp not connected'}
          </p>
        </div>
      </aside>
    </>
  );
}
