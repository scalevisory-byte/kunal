import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { PRIORITIES, STATUSES } from '../lib/task.js';

const SOURCES = [
  { key: 'ai', label: '🤖 AI-created' },
  { key: 'manual', label: '✋ Added by hand' },
];

/** Search, grouping, and a filter popover that stays out of the way until asked. */
export default function Toolbar({
  groupBy, onGroupBy, filters, onFilters, chats, onClearAll, selecting, onSelecting,
  layout = 'list', onLayout = null, onCalendar = null,
}) {
  const [open, setOpen] = useState(false);
  const popover = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (!popover.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (group, key) => {
    const current = new Set(filters[group]);
    current.has(key) ? current.delete(key) : current.add(key);
    onFilters({ ...filters, [group]: [...current] });
  };

  const active = filters.status.length + filters.priority.length + filters.origin.length
    + (filters.chat ? 1 : 0);

  return (
    <div className="toolbar">
      <div className="toolbar-right" ref={popover}>
        {/*
          * The shape of the list: sections, a table, or the month.
          *
          * From his All Tasks drawing. List and Table are two readings of the
          * same rows; Calendar is not a third reading here but the calendar
          * page, which already exists - a switch that opened a second calendar
          * would be two answers to one question.
          */}
        {onLayout && (
          <div className="segment small layout-switch" role="group" aria-label="Layout">
            {[
              { key: 'list', label: 'List', icon: 'list' },
              { key: 'table', label: 'Table', icon: 'board' },
            ].map((l) => (
              <button
                key={l.key}
                className={layout === l.key ? 'active' : ''}
                aria-pressed={layout === l.key}
                onClick={() => onLayout(l.key)}
              >
                <Icon name={l.icon} size={15} /> {l.label}
              </button>
            ))}
            {onCalendar && (
              <button onClick={onCalendar}>
                <Icon name="calendar" size={15} /> Calendar
              </button>
            )}
          </div>
        )}

        {/* Grouping is what the sections are; a table has one order, set by
            its headings, so the control would press and change nothing. */}
        {layout !== 'table' && (
        <div className="segment small">
          {/*
            * Three ways to read the same list: when it is due, which business
            * it is for, and which chat it came from. "By folder" is the one
            * the date view cannot answer at all - "what is outstanding for
            * Book N Fly" - and it is where most of the filing pays off.
            */}
          {[
            { key: 'date', label: 'By date' },
            { key: 'folder', label: 'By folder' },
            { key: 'chat', label: 'By chat' },
          ].map((g) => (
            <button
              key={g.key}
              className={groupBy === g.key ? 'active' : ''}
              onClick={() => onGroupBy(g.key)}
            >
              {g.label}
            </button>
          ))}
        </div>
        )}

        {/*
          * Picking several at once.
          *
          * A list that carries a hundred rows which were never tasks cannot be
          * cleared one row at a time - that is not tidying, it is a reason to
          * stop opening the list. This turns the done-tick into a picker for
          * as long as it is on, and nothing else about the row changes.
          */}
        {/* The table's boxes are always there, so it needs no mode for them. */}
        {onSelecting && layout !== 'table' && (
          <button
            className={`btn ghost with-icon ${selecting ? 'on' : ''}`}
            aria-pressed={Boolean(selecting)}
            onClick={() => onSelecting(!selecting)}
          >
            <Icon name="check" size={16} />
            {selecting ? 'Done selecting' : 'Select'}
          </button>
        )}

        <button
          className={`btn ghost with-icon ${active ? 'on' : ''}`}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name="filter" size={16} />
          Filter{active ? ` (${active})` : ''}
        </button>

        {open && (
          <div className="popover" role="group" aria-label="Filters">
            <FilterGroup
              title="Status"
              options={STATUSES}
              selected={filters.status}
              onToggle={(k) => toggle('status', k)}
            />
            <FilterGroup
              title="Priority"
              options={PRIORITIES.map((p) => ({
                key: p.key,
                label: <><span className={`pri-mark p-${p.key}`} aria-hidden="true" />{p.label}</>,
              }))}
              selected={filters.priority}
              onToggle={(k) => toggle('priority', k)}
            />
            <FilterGroup
              title="Source"
              options={SOURCES}
              selected={filters.origin}
              onToggle={(k) => toggle('origin', k)}
            />

            {chats.length > 0 && (
              <div className="filter-group">
                <h4>Chat</h4>
                <select
                  value={filters.chat || ''}
                  aria-label="Filter by chat"
                  onChange={(event) => onFilters({ ...filters, chat: event.target.value || null })}
                >
                  <option value="">Every chat</option>
                  {chats.map(([name, count]) => (
                    <option key={name} value={name}>{name} ({count})</option>
                  ))}
                </select>
              </div>
            )}

            <div className="popover-foot">
              <button className="link" onClick={onClearAll}>Clear all</button>
              <button className="btn small" onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterGroup({ title, options, selected, onToggle }) {
  return (
    <div className="filter-group">
      <h4>{title}</h4>
      <div className="chip-row">
        {options.map((o) => (
          <button
            key={o.key}
            className={`chip ${selected.includes(o.key) ? 'on' : ''}`}
            aria-pressed={selected.includes(o.key)}
            onClick={() => onToggle(o.key)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
