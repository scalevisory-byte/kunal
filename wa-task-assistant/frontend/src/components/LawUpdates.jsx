import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

/* Offered before the first fetch answers; the server's list is authoritative. */
const RULING_TYPES = [
  'new precedent', 'precedent reaffirmed', 'position changed / overruled',
  'referred to larger bench', 'interim order', 'final judgment',
  'amendment / legislative change',
];

/**
 * The updates behind the digest, as a list you can work through.
 *
 * The digest is one message a day and is written to be read in thirty seconds.
 * This is the other half: everything that message was built from, kept as
 * records - searchable by notification number, filterable by what kind of thing
 * it is, and markable, so a team can divide the reading rather than each person
 * re-reading the same five lines.
 *
 * Nothing here is per-client. An update says who it *generally* applies to,
 * because that is what the article says; deciding whether it touches a
 * particular client is a professional judgement and is left to a person.
 */

const PRIORITY = {
  critical: { dot: '🔴', label: 'Critical' },
  important: { dot: '🟠', label: 'Important' },
  general: { dot: '🟢', label: 'General' },
};

const WHEN = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: null, label: 'All' },
];

const dayText = (iso) => {
  if (!iso) return '';
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? String(iso)
    : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

/**
 * The two modules differ in three places and are otherwise the same list, so
 * they are the same component: which endpoints to call, what a row's meta line
 * says, and which recorded facts an open row shows.
 */
const MODULES = {
  tax: {
    list: (f) => api.lawUpdates(f),
    mark: (id, patch) => api.markLawUpdate(id, patch),
    message: (id, channel) => api.lawUpdateMessage(id, channel),
    addWatch: (body) => api.addLawWatch(body),
    removeWatch: (id) => api.removeLawWatch(id),
    watchHint: 'e.g. Section 43B, 194R, GSTR-9',
    empty: 'Press Fetch now above to read the feeds — the updates it finds are listed here.',
  },
  legal: {
    list: (f) => api.legalUpdates(f),
    mark: (id, patch) => api.markLegalUpdate(id, patch),
    message: (id, channel) => api.legalUpdateMessage(id, channel),
    addWatch: (body) => api.addLegalWatch(body),
    removeWatch: (id) => api.removeLegalWatch(id),
    watchHint: 'e.g. section 138, cheque dishonour',
    empty: 'Press Fetch judgments above — what it finds is listed here.',
  },
};

export default function LawUpdates({ onError, module: mod = 'tax' }) {
  const endpoints = MODULES[mod] || MODULES.tax;
  const [filters, setFilters] = useState({ when: 'week' });
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [watchError, setWatchError] = useState('');

  /*
   * The search waits for a pause rather than firing per keystroke: this is a
   * server query over every field, and "GNL" on the way to "GNL-1" is three
   * queries nobody wanted.
   */
  const [typed, setTyped] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await endpoints.list({ ...filters, q: query || undefined }));
    } catch (err) {
      onError?.(err);
    } finally {
      setLoading(false);
    }
  }, [filters, query, onError, endpoints]);

  useEffect(() => { load(); }, [load]);

  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));

  const groups = data?.groups?.filter((g) => g.count > 0) ?? [];
  const counts = data?.counts ?? {};
  const updates = data?.updates ?? [];
  const watches = data?.watches ?? [];

  /*
   * Adding or removing a watch reloads the list, because the watch chips and
   * their counts arrive with it - there is no second copy to keep in step.
   */
  const saveWatch = async (label, terms) => {
    setWatchError('');
    try {
      await endpoints.addWatch({ label, terms });
      setAdding(false);
      await load();
    } catch (err) {
      setWatchError(String(err?.message || err));
    }
  };

  const dropWatch = async (watch) => {
    setWatchError('');
    try {
      await endpoints.removeWatch(watch.id);
      if (filters.watch === watch.id) set({ watch: null });
      else await load();
    } catch (err) {
      setWatchError(String(err?.message || err));
    }
  };

  const active = useMemo(
    () => Object.entries(filters).filter(([k, v]) => v && k !== 'when' && k !== 'watch').length
      + (query ? 1 : 0),
    [filters, query]
  );

  return (
    <section className="lawupd">
      <header className="section-head static">
        <h3>Updates</h3>
        <span className="section-count">
          {counts.today || 0} today · {counts.unreviewed || 0} unreviewed
          {counts.critical ? ` · ${counts.critical} critical` : ''}
        </span>
      </header>

      <div className="lu-watches">
        <span className="lu-watch-label">Watching</span>
        <div className="chip-row">
          {watches.map((w) => (
            <span key={w.id} className={`lu-watch ${filters.watch === w.id ? 'on' : ''}`}>
              <button
                type="button"
                className="lu-watch-pick"
                aria-pressed={filters.watch === w.id}
                title={w.termList?.join(', ')}
                onClick={() => set({ watch: filters.watch === w.id ? null : w.id })}
              >
                {w.label}
                {/* When everything it caught is unread, one figure says both. */}
                {w.count > 0 && w.unreviewed === w.count ? (
                  <span className="lu-watch-new">{w.count} new</span>
                ) : (
                  <>
                    <span className="chip-count">{w.count}</span>
                    {w.unreviewed ? <span className="lu-watch-new">{w.unreviewed} new</span> : null}
                  </>
                )}
              </button>
              <button
                type="button"
                className="lu-watch-drop"
                title={`Stop watching ${w.label}`}
                onClick={() => dropWatch(w)}
              >
                ×
              </button>
            </span>
          ))}

          {adding ? (
            <WatchForm hint={endpoints.watchHint} onSave={saveWatch} onCancel={() => { setAdding(false); setWatchError(''); }} />
          ) : (
            <button type="button" className="chip ghost" onClick={() => setAdding(true)}>
              ＋ Watch a section
            </button>
          )}
        </div>
        <p className="lu-watch-note">
          {watchError
            ? watchError
            : 'A watch is a saved search, matched on the recorded text — so it flags exactly what typing the words would have found, and what it catches is called out in the daily digest by name.'}
        </p>
      </div>

      <div className="lu-controls">
        <div className="chip-row">
          {WHEN.map((w) => (
            <button
              key={w.label}
              type="button"
              className={`chip ${(filters.when ?? null) === w.key ? 'on' : ''}`}
              aria-pressed={(filters.when ?? null) === w.key}
              onClick={() => set({ when: w.key })}
            >
              {w.label}
            </button>
          ))}
        </div>

        <label className="lu-search">
          <span className="sr-only">Search updates</span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Search a notification number, a section, a form, a word…"
          />
        </label>
      </div>

      <div className="lu-controls second">
        <div className="chip-row">
          <button
            type="button"
            className={`chip ${!filters.group ? 'on' : ''}`}
            onClick={() => set({ group: null, category: null })}
          >
            All areas
          </button>
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              className={`chip ${filters.group === g.key ? 'on' : ''}`}
              onClick={() => set({ group: filters.group === g.key ? null : g.key, category: null })}
            >
              {g.label} <span className="chip-count">{g.count}</span>
            </button>
          ))}
        </div>

        <div className="lu-selects">
          <select value={filters.priority || ''} onChange={(e) => set({ priority: e.target.value || null })}>
            <option value="">Any priority</option>
            <option value="critical">🔴 Critical</option>
            <option value="important">🟠 Important</option>
            <option value="general">🟢 General</option>
          </select>

          <select value={filters.source || ''} onChange={(e) => set({ source: e.target.value || null })}>
            <option value="">Any source</option>
            <option value="official">Official only</option>
            <option value="secondary">Secondary only</option>
          </select>

          {mod === 'legal' ? (
            <select value={filters.rulingType || ''} onChange={(e) => set({ rulingType: e.target.value || null })}>
              <option value="">Any ruling</option>
              {(data?.rulingTypes || RULING_TYPES).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          ) : (
            <select value={filters.docType || ''} onChange={(e) => set({ docType: e.target.value || null })}>
              <option value="">Any kind</option>
              <option value="notification">Notifications</option>
              <option value="circular">Circulars</option>
              <option value="order">Orders</option>
              <option value="judgment">Case law</option>
            </select>
          )}

          <select value={filters.status || ''} onChange={(e) => set({ status: e.target.value || null })}>
            <option value="">New &amp; reviewed</option>
            <option value="new">Unreviewed</option>
            <option value="reviewed">Reviewed</option>
            <option value="archived">Archived ({counts.archived || 0})</option>
          </select>

          <button
            type="button"
            className={`chip ${filters.important ? 'on' : ''}`}
            onClick={() => set({ important: filters.important ? null : true })}
          >
            ★ Important
          </button>

          {mod === 'tax' && (
            <button
              type="button"
              className={`chip ${filters.deadlines ? 'on' : ''}`}
              onClick={() => set({ deadlines: filters.deadlines ? null : true })}
            >
              📅 Deadlines
            </button>
          )}

          {active > 0 && (
            <button
              type="button"
              className="chip ghost"
              onClick={() => { setFilters({ when: filters.when }); setTyped(''); }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {loading && !data ? (
        <div className="empty" aria-busy="true"><strong>Loading updates…</strong></div>
      ) : updates.length === 0 ? (
        <div className="empty">
          <strong>Nothing here yet.</strong>
          <p>
            {counts.all
              ? 'No update matches these filters. Clear them, or widen the date range.'
              : endpoints.empty}
          </p>
        </div>
      ) : (
        <ul className="lu-list">
          {updates.map((u) => (
            <UpdateRow
              key={u.id}
              update={u}
              endpoints={endpoints}
              open={openId === u.id}
              onToggle={() => setOpenId(openId === u.id ? null : u.id)}
              onChanged={load}
              onError={onError}
            />
          ))}
        </ul>
      )}

      {data && data.total > updates.length && (
        <p className="hint">Showing {updates.length} of {data.total}. Narrow the filters to see the rest.</p>
      )}
    </section>
  );
}

/** One update: a line to scan, and everything recorded about it underneath. */
function UpdateRow({ update: u, endpoints, open, onToggle, onChanged, onError }) {
  const legal = u.module === 'legal';
  /*
   * An Act is not a judgment, and the labels have to know it.
   *
   * The legal module carries legislation as well as case law - a notified
   * amendment has an authority and a date, not a bench and a holding - and
   * "What the court decided" over the text of a rule is exactly the sort of
   * small wrongness that makes a reader distrust the rest of the page.
   */
  const statute = legal
    && (u.group_key === 'legislation' || u.ruling_type === 'amendment / legislative change');
  const words = statute
    ? { court: 'Authority', date: 'Notified on', decision: 'What it provides', principle: 'Effect' }
    : { court: 'Court / authority', date: 'Judgment / order date', decision: 'What the court decided', principle: 'Key legal principle' };
  const [message, setMessage] = useState(null);
  const [copied, setCopied] = useState('');
  const priority = PRIORITY[u.priority] || PRIORITY.general;

  const mark = async (patch) => {
    try {
      await endpoints.mark(u.id, patch);
      onChanged();
    } catch (err) {
      onError?.(err);
    }
  };

  const generate = async (channel) => {
    try {
      const out = await endpoints.message(u.id, channel);
      setMessage({ channel, text: out.text });
      setCopied('');
    } catch (err) {
      onError?.(err);
    }
  };

  const copy = async () => {
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied('Copied.');
    } catch {
      // Clipboard access is refused in plenty of ordinary situations - an
      // insecure origin, a browser setting. Saying so beats a button that
      // silently does nothing.
      setCopied('Could not copy — select the text and copy it by hand.');
    }
  };

  return (
    <li className={`lu-item ${open ? 'open' : ''} ${u.status}`}>
      <button type="button" className="lu-head" onClick={onToggle} aria-expanded={open}>
        <span className="lu-dot" title={priority.label}>{priority.dot}</span>
        <span className="lu-main">
          <span className="lu-title">
            {u.important ? <span className="lu-star" aria-label="Important">★</span> : null}
            {legal && u.case_name ? u.case_name : u.title}
          </span>
          <span className="lu-meta">
            <span className="lu-cat">{legal ? (u.court || u.category) : u.category}</span>
            {legal && u.case_number && <span className="lu-doc">{u.case_number}</span>}
            {legal && u.ruling_type && <span className="lu-ruling">{u.ruling_type}</span>}
            <span className={`lu-src ${u.source_kind}`}>
              {u.source_kind === 'official' ? 'Official source' : 'Secondary source'}
              {u.source_authority ? ` · ${u.source_authority}` : ''}
            </span>
            {!legal && u.doc_number && <span className="lu-doc">{u.doc_number}</span>}
            <span className="lu-day">{dayText(u.day)}</span>
            {u.status === 'reviewed' && <span className="lu-state">Reviewed</span>}
            {u.status === 'archived' && <span className="lu-state">Archived</span>}
          </span>
        </span>
        {u.deadline && (
          <span className={`lu-deadline ${u.deadline_confirmed ? '' : 'unconfirmed'}`}>
            📅 {dayText(u.deadline)}
            {!u.deadline_confirmed && <small>not confirmed</small>}
          </span>
        )}
      </button>

      {open && (
        <div className="lu-body">
          {u.summary && <p className="lu-summary">{u.summary}</p>}

          <dl className="lu-facts">
            {legal && <Fact label={words.court} value={u.court} />}
            {legal && <Fact label="Case" value={u.case_name} />}
            {legal && <Fact label="Case number" value={u.case_number} />}
            {legal && <Fact label={words.date} value={u.judgment_date && dayText(u.judgment_date)} />}
            {legal && <Fact label="Bench" value={u.bench} />}
            {legal && <Fact label="Parties" value={[u.petitioner, u.respondent].filter(Boolean).join(' v ')} />}
            {legal && <Fact label="Area of law" value={u.legal_area} />}
            {legal && <Fact label="Relevant Act / section" value={u.act_section} />}
            {legal && <Fact label="Key issue" value={u.key_issue} />}
            {legal && <Fact label={words.decision} value={u.decision} />}
            {legal && <Fact label={words.principle} value={u.principle} />}
            {legal && <Fact label="Practical implication" value={u.implication} />}
            {legal && <Fact label="Ruling" value={u.ruling_type} />}
            <Fact label="What changed" value={u.what_changed} />
            <Fact label="Previous position" value={u.previous_position} />
            <Fact label="New position" value={u.new_position} />
            <Fact label="Generally applies to" value={u.applies_to} />
            <Fact label="Action required" value={u.action_required} />
            <Fact label="Effective from" value={u.effective_date && dayText(u.effective_date)} />
            <Fact
              label="Deadline"
              value={u.deadline
                ? `${dayText(u.deadline)}${u.deadline_confirmed ? '' : ' — not confirmed by the source'}`
                : null}
            />
            {!legal && (
              <Fact label="Document" value={[u.doc_type, u.doc_number].filter(Boolean).join(' · ')} />
            )}
          </dl>

          {u.ai_explanation && (
            <details className="lu-ai">
              <summary>Plain-language explanation</summary>
              <pre>{u.ai_explanation}</pre>
              <small>
                Written by the AI from the article above. It is a reading aid, not a legal
                opinion — check the source before acting on it.
              </small>
            </details>
          )}

          <div className="lu-actions">
            {u.source_url && (
              <a className="btn ghost" href={u.source_url} target="_blank" rel="noopener noreferrer">
                {statute ? 'Open notification ↗' : legal ? 'View judgment ↗' : 'Open source ↗'}
              </a>
            )}
            <button type="button" className="btn ghost"
              onClick={() => mark({ status: u.status === 'reviewed' ? 'new' : 'reviewed' })}>
              {u.status === 'reviewed' ? 'Mark unreviewed' : 'Mark reviewed'}
            </button>
            <button type="button" className="btn ghost" onClick={() => mark({ important: !u.important })}>
              {u.important ? 'Unstar' : 'Star'}
            </button>
            <button type="button" className="btn ghost"
              onClick={() => mark({ status: u.status === 'archived' ? 'new' : 'archived' })}>
              {u.status === 'archived' ? 'Unarchive' : 'Archive'}
            </button>
            <button type="button" className="btn ghost" onClick={() => generate('whatsapp')}>
              WhatsApp message
            </button>
            <button type="button" className="btn ghost" onClick={() => generate('email')}>
              Email
            </button>
          </div>

          {u.reviewed_by && (
            <p className="lu-review">
              Reviewed by {u.reviewed_by}
              {u.reviewed_at ? ` · ${new Date(`${u.reviewed_at}Z`).toLocaleString([], {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
              })}` : ''}
            </p>
          )}

          {message && (
            <div className="lu-message">
              <div className="lu-message-head">
                <strong>{message.channel === 'email' ? 'Email' : 'WhatsApp message'}</strong>
                <span>Nothing is sent from here — copy it and send it yourself.</span>
              </div>
              <pre>{message.text}</pre>
              <div className="lu-message-foot">
                <button type="button" className="btn ghost" onClick={copy}>Copy</button>
                <button type="button" className="btn ghost" onClick={() => setMessage(null)}>Close</button>
                {copied && <small>{copied}</small>}
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** A recorded fact, or nothing at all - an empty field is never invented over. */
const Fact = ({ label, value }) =>
  value ? (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  ) : null;


/**
 * Naming a watch and the words to look for.
 *
 * Terms are typed as a comma-separated list rather than one phrase, because the
 * same thing is reported three ways - "section 138", "cheque dishonour",
 * "Negotiable Instruments Act" - and a watch on only one spelling quietly
 * misses the other two. The server refuses a term under three characters, and
 * says so here rather than accepting a watch that would flag everything.
 */
function WatchForm({ hint, onSave, onCancel }) {
  const [label, setLabel] = useState('');
  const [terms, setTerms] = useState('');

  return (
    <form
      className="lu-watch-form"
      onSubmit={(e) => { e.preventDefault(); onSave(label.trim(), terms.trim()); }}
    >
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Name it"
        aria-label="Watch name"
        autoFocus
      />
      <input
        value={terms}
        onChange={(e) => setTerms(e.target.value)}
        placeholder={`Words to look for — ${hint}`}
        aria-label="Words to look for, comma separated"
      />
      <button type="submit" className="chip on" disabled={!label.trim() || !terms.trim()}>Watch</button>
      <button type="button" className="chip ghost" onClick={onCancel}>Cancel</button>
    </form>
  );
}
