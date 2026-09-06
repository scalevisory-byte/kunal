import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';
import { dateTimeLabel } from '../lib/task.js';

const DATE_RANGES = [
  { key: '', label: 'All time' },
  { key: 'today', label: 'Today', days: 0 },
  { key: 'week', label: 'This week', days: 7 },
  { key: 'month', label: 'This month', days: 30 },
  { key: 'year', label: 'This year', days: 365 },
];

const isoDaysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

const stamp = (iso) => (iso ? dateTimeLabel(iso) : '—');
const dayOnly = (iso) =>
  iso ? new Date(String(iso).replace(' ', 'T') + (iso.includes('T') ? '' : 'Z'))
    .toLocaleDateString([], { day: 'numeric', month: 'short' }) : '—';

/** One finished task's whole story, in the order it happened. */
function Timeline({ task, onClose }) {
  const [showMessage, setShowMessage] = useState(false);

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <aside className="sheet" role="dialog" aria-modal="true" aria-label={task.title}
        onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>{task.title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="sheet-body">
          <dl className="facts">
            <div><dt>Result</dt>
              <dd className={task.on_time === 'late' ? 's-danger' : task.on_time === 'on time' ? 's-ok' : ''}>
                {task.status === 'done'
                  ? task.on_time === 'no deadline' ? 'Completed' : `Completed ${task.on_time}`
                  : 'Archived'}
              </dd>
            </div>
            <div><dt>Created</dt><dd>{stamp(task.created_at)}</dd></div>
            {task.original_due_at && (
              <div><dt>Original deadline</dt><dd>{stamp(task.original_due_at)}</dd></div>
            )}
            {task.due_at && task.due_at !== task.original_due_at && (
              <div><dt>Final deadline</dt><dd>{stamp(task.due_at)}</dd></div>
            )}
            {task.completed_at && <div><dt>Completed</dt><dd>{stamp(task.completed_at)}</dd></div>}
            <div><dt>Source</dt><dd>{task.origin === 'ai' ? '🤖 AI-created' : '✋ Added by hand'}</dd></div>
            {task.chat_name && <div><dt>WhatsApp chat</dt><dd>💬 {task.chat_name}</dd></div>}
            {task.counts && (
              <div>
                <dt>Reminders / follow-ups</dt>
                <dd>{task.counts.reminders} / {task.counts.follow_ups}</dd>
              </div>
            )}
            {task.counts?.reschedules > 0 && (
              <div><dt>Rescheduled</dt><dd>{task.counts.reschedules} time(s)</dd></div>
            )}
          </dl>

          {task.notes && (
            <div className="field">
              <label>Notes</label>
              <p className="field-note">{task.notes}</p>
            </div>
          )}

          <div className="field">
            <label>What happened</label>
            {task.events?.length ? (
              <ol className="timeline">
                {task.events.map((e) => (
                  <li key={e.id} className={`k-${e.kind.replace(/\s+/g, '-')}`}>
                    <span className="tl-dot" />
                    <span className="tl-at">{stamp(e.at)}</span>
                    <span className="tl-what">
                      {e.kind}
                      {e.detail && <small>{e.detail}</small>}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="field-note">
                Nothing was recorded for this task — it predates the activity log.
              </p>
            )}
          </div>

          {task.source_message && (
            <div className="field">
              <button className="link" onClick={() => setShowMessage((v) => !v)}>
                {showMessage ? 'Hide original message' : 'Show original message'}
              </button>
              {showMessage && <blockquote className="quote">{task.source_message}</blockquote>}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

/**
 * The permanent record. Completed shows what is recently done; this is what a
 * person searches six months later, so nothing ages out of it.
 */
export default function WorkHistory({ chats, onError }) {
  const [data, setData] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ range: '', source: '', priority: '', chat: '', timing: '' });
  const [exporting, setExporting] = useState(false);

  // Built once and used for both the list and the CSV, so the file that
  // downloads is exactly the rows on screen rather than an approximation.
  const params = useMemo(() => {
    const next = {
      q: query || undefined,
      source: filters.source || undefined,
      priority: filters.priority || undefined,
      chat: filters.chat || undefined,
      timing: filters.timing || undefined,
    };
    const range = DATE_RANGES.find((r) => r.key === filters.range);
    if (range?.days !== undefined) next.from = isoDaysAgo(range.days);
    return next;
  }, [query, filters]);

  const load = useCallback(async () => {
    setLoading(true);
    try {

      const [rows, totals] = await Promise.all([api.history(params), api.historySummary()]);
      setData(rows);
      setSummary(totals);
    } catch (err) {
      onError(err);
    } finally {
      setLoading(false);
    }
  }, [params, onError]);

  useEffect(() => {
    const id = setTimeout(load, query ? 250 : 0); // debounce typing, not filters
    return () => clearTimeout(id);
  }, [load, query]);

  const openTask = async (id) => {
    try {
      setOpen(await api.historyTask(id));
    } catch (err) {
      onError(err);
    }
  };

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const stats = data?.stats;

  const cells = useMemo(() => summary ? [
    { key: 'week', label: 'This week', value: summary.week, note: 'tasks completed' },
    { key: 'month', label: 'This month', value: summary.month, note: 'tasks completed' },
    { key: 'year', label: 'This year', value: summary.year, note: 'tasks completed' },
    {
      key: 'late',
      label: 'Finished late',
      value: summary.late,
      note: summary.onTime + summary.late > 0
        ? `${summary.onTime} beat their deadline`
        : 'no deadlines to measure',
      tone: summary.late > 0 ? 'danger' : '',
    },
  ] : [], [summary]);

  return (
    <div className="history">
      <section className="kpis">
        {cells.map((c) => (
          <div key={c.key} className={`kpi static ${c.tone === 'danger' ? 't-danger' : ''}`}>
            <span className="kpi-top"><span className="kpi-label">{c.label}</span></span>
            <span className="kpi-num">{c.value}</span>
            <span className="kpi-note">{c.note}</span>
          </div>
        ))}
      </section>

      <div className="hist-controls">
        <input
          type="search"
          value={query}
          placeholder="Search history…"
          aria-label="Search history"
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={filters.range} onChange={set('range')} aria-label="Date range">
          {DATE_RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <select value={filters.source} onChange={set('source')} aria-label="Source">
          <option value="">Any source</option>
          <option value="ai">AI-created</option>
          <option value="manual">Added by hand</option>
        </select>
        <select value={filters.timing} onChange={set('timing')} aria-label="Timing">
          <option value="">On time or late</option>
          <option value="on time">On time</option>
          <option value="late">Late</option>
          <option value="no deadline">No deadline</option>
        </select>
        <select value={filters.priority} onChange={set('priority')} aria-label="Priority">
          <option value="">Any priority</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        {chats.length > 0 && (
          <select value={filters.chat} onChange={set('chat')} aria-label="Chat">
            <option value="">Any chat</option>
            {chats.map(([name]) => <option key={name} value={name}>{name}</option>)}
          </select>
        )}
        <button
          type="button"
          className="btn ghost"
          disabled={exporting || !data?.tasks?.length}
          onClick={async () => {
            setExporting(true);
            try {
              await api.exportHistory(params);
            } catch (err) {
              onError(err);
            } finally {
              setExporting(false);
            }
          }}
        >
          {exporting ? 'Preparing…' : 'Export CSV'}
        </button>
      </div>

      {stats && stats.total > 0 && (
        <p className="hist-summary">
          {stats.total} record{stats.total === 1 ? '' : 's'} · {stats.onTime} on time · {stats.late} late
          {stats.averageDays !== null && ` · ${stats.averageDays} days average to finish`}
        </p>
      )}

      {loading && !data ? (
        <div className="empty" aria-busy="true"><strong>Loading history…</strong></div>
      ) : !data?.tasks.length ? (
        <div className="empty">
          <strong>{query || filters.range ? 'Nothing matches that.' : 'No finished work yet.'}</strong>
          <p>Completed and archived tasks are kept here permanently.</p>
        </div>
      ) : (
        <div className="hist-table" role="table">
          <div className="hist-head" role="row">
            <span>Completed</span><span>Task</span><span>Deadline</span><span>Result</span><span>Source</span>
          </div>
          {data.tasks.map((task) => (
            <button key={task.id} className="hist-row" role="row" onClick={() => openTask(task.id)}>
              <span className="h-date">{dayOnly(task.completed_at || task.archived_at)}</span>
              <span className="h-title">
                {task.title}
                {task.chat_name && <small>💬 {task.chat_name}</small>}
              </span>
              <span className="h-due">{task.due_at_resolved ? dayOnly(task.due_at_resolved) : '—'}</span>
              <span className={`h-result ${task.on_time === 'late' ? 'danger-text' : task.on_time === 'on time' ? 'ok-text' : ''}`}>
                {task.archived ? 'Archived' : task.on_time === 'no deadline' ? 'Completed' : task.on_time}
              </span>
              <span className="h-source">{task.origin === 'ai' ? '🤖 AI' : '✋ Manual'}</span>
            </button>
          ))}
        </div>
      )}

      {open && <Timeline task={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
