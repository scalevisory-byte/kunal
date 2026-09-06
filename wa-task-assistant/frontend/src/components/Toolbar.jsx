import { useEffect, useRef, useState } from 'react';
import { PRIORITIES, STATUSES } from '../lib/task.js';

const SOURCES = [
  { key: 'ai', label: '🤖 AI-created' },
  { key: 'manual', label: '✋ Added by hand' },
];

/** Search, grouping, and a filter popover that stays out of the way until asked. */
export default function Toolbar({ query, onQuery, groupBy, onGroupBy, filters, onFilters, chats }) {
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
      <div className="search">
        <input
          type="search"
          value={query}
          placeholder="Search tasks…"
          aria-label="Search tasks"
          onChange={(event) => onQuery(event.target.value)}
        />
      </div>

      <div className="toolbar-right" ref={popover}>
        <div className="segment small">
          {[{ key: 'date', label: 'By date' }, { key: 'chat', label: 'By chat' }].map((g) => (
            <button
              key={g.key}
              className={groupBy === g.key ? 'active' : ''}
              onClick={() => onGroupBy(g.key)}
            >
              {g.label}
            </button>
          ))}
        </div>

        <button
          className={`btn ghost ${active ? 'on' : ''}`}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
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
              options={PRIORITIES.map((p) => ({ key: p.key, label: `${p.dot} ${p.label}` }))}
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

            {active > 0 && (
              <button
                className="link"
                onClick={() => onFilters({ status: [], priority: [], origin: [], chat: null })}
              >
                Clear all filters
              </button>
            )}
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
