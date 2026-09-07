import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';
import { addedLabel, agoLabel } from '../lib/task.js';

/**
 * Notes: the things worth remembering.
 *
 * Deliberately not a second task list. There is no status here, no deadline
 * pressing on anything, no follow-up — a note is information, and the only way
 * it becomes work is a person pressing "Create task", which makes an ordinary
 * task through the ordinary task system.
 *
 * The layout is a grid of small cards because that is how a page of notes is
 * actually read: you scan for the one you half-remember writing. Pinned notes
 * sit above the rest and appear once, never in both places.
 */

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pinned', label: 'Pinned' },
  { key: 'reminder', label: 'With reminder' },
  { key: 'archived', label: 'Archived' },
];

const PREVIEW = 220;

/** "Added Today · 10:30" and, when it has been touched since, when that was. */
function Stamps({ note }) {
  const added = addedLabel(note.created_at);
  const touched = note.updated_at && note.updated_at !== note.created_at
    ? agoLabel(note.updated_at)
    : null;
  return (
    <span className="note-when">
      {added}
      {touched && <> · Updated {touched}</>}
    </span>
  );
}

function Card({ note, onOpen, onPin }) {
  const body = (note.body || '').trim();
  return (
    <article className={`note-card ${note.pinned ? 'pinned' : ''}`}>
      <button className="note-open" onClick={() => onOpen(note)}>
        {note.title && <h3>{note.title}</h3>}
        {body && <p className="note-body">{body.slice(0, PREVIEW)}{body.length > PREVIEW ? '…' : ''}</p>}
        <div className="note-meta">
          {note.group_name && (
            <span className={`note-chip c-${note.group_colour || 'slate'}`}>{note.group_name}</span>
          )}
          {note.tags.map((tag) => <span className="note-tag" key={tag}>{tag}</span>)}
          {note.remind_at && (
            <span className="note-flag"><Icon name="bell" size={12} /> Reminder</span>
          )}
          {note.task_count > 0 && (
            <span className="note-flag">
              <Icon name="check" size={12} /> {note.task_count} task{note.task_count === 1 ? '' : 's'}
            </span>
          )}
          {note.source === 'whatsapp' && (
            <span className="note-flag"><Icon name="whatsapp" size={12} /> WhatsApp</span>
          )}
        </div>
        <Stamps note={note} />
      </button>
      {!note.archived && (
        <button
          type="button"
          className={`note-pin ${note.pinned ? 'on' : ''}`}
          aria-label={note.pinned ? `Unpin ${note.title || 'note'}` : `Pin ${note.title || 'note'}`}
          aria-pressed={note.pinned}
          onClick={() => onPin(note)}
        >
          <Icon name="pin" size={15} />
        </button>
      )}
    </article>
  );
}

/**
 * One note, open. The editor and the detail view are the same thing: a note is
 * short enough that a read-only screen with an Edit button on it would be two
 * screens where one will do.
 */
function Editor({ note, groups, onClose, onSaved, onError }) {
  // Archiving, pinning and deleting act at once and close - they are decisions
  // about the note, not edits to its text, and holding them until Save would
  // mean an archived note sitting open in front of you.
  const isNew = !note.id;
  const [draft, setDraft] = useState({
    title: note.title || '',
    body: note.body || '',
    group_id: note.group_id ? String(note.group_id) : '',
    tags: (note.tags || []).join(', '),
    remind_at: note.remind_at ? toLocalInput(note.remind_at) : '',
  });
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [making, setMaking] = useState(false);
  const [taskTitle, setTaskTitle] = useState(note.title || '');
  const [taskDue, setTaskDue] = useState('');

  useEffect(() => {
    if (isNew) return;
    api.note(note.id).then(setDetail).catch(() => {});
  }, [isNew, note.id]);

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  const payload = () => ({
    title: draft.title,
    body: draft.body,
    group_id: draft.group_id ? Number(draft.group_id) : null,
    tags: draft.tags.split(',').map((t) => t.trim()).filter(Boolean),
    remind_at: draft.remind_at ? new Date(draft.remind_at).toISOString() : null,
  });

  const save = async () => {
    if (!draft.title.trim() && !draft.body.trim()) { onClose(); return; }
    setBusy(true);
    try {
      if (isNew) await api.createNote(payload());
      else await api.updateNote(note.id, payload());
      onSaved();
      onClose();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  /** Run one of the decisions above, then close: the note is no longer as it was. */
  const act = async (fn) => {
    setBusy(true);
    try {
      await fn();
      onSaved();
      onClose();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const makeTask = async () => {
    setBusy(true);
    try {
      await api.noteToTask(note.id, {
        title: taskTitle.trim() || draft.title.trim(),
        due_date: taskDue || undefined,
        group_id: draft.group_id ? Number(draft.group_id) : undefined,
      });
      setMaking(false);
      const fresh = await api.note(note.id);
      setDetail(fresh);
      onSaved();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="sheet note-sheet" role="dialog" aria-label="Note" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>{isNew ? 'New note' : 'Note'}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </header>

        <div className="sheet-body">
          <div className="field">
            <label htmlFor="n-title">Title</label>
            <input id="n-title" value={draft.title} autoFocus={isNew}
              placeholder="GST work" onChange={set('title')} />
          </div>
          <div className="field">
            <label htmlFor="n-body">Note</label>
            <textarea id="n-body" rows={10} value={draft.body}
              placeholder="What is worth remembering about this…" onChange={set('body')} />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="n-group">Business</label>
              <select id="n-group" value={draft.group_id} onChange={set('group_id')}>
                <option value="">None</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="n-remind">Remind me</label>
              <input id="n-remind" type="datetime-local" value={draft.remind_at} onChange={set('remind_at')} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="n-tags">Tags</label>
            <input id="n-tags" value={draft.tags} placeholder="GST, audit"
              onChange={set('tags')} />
            <p className="field-note">Separated by commas. Nothing has to be tagged.</p>
          </div>

          {!isNew && (
            <>
              {making ? (
                <section className="note-convert">
                  <h4>Create a task from this note</h4>
                  <div className="field">
                    <label htmlFor="n-task">What has to be done</label>
                    <input id="n-task" value={taskTitle} autoFocus
                      onChange={(e) => setTaskTitle(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="n-due">Deadline</label>
                    <input id="n-due" type="date" value={taskDue}
                      onChange={(e) => setTaskDue(e.target.value)} />
                  </div>
                  <p className="field-note">
                    The note stays as it is. The task gets the usual reminder and follow-up.
                  </p>
                  <div className="note-convert-foot">
                    <button className="btn primary small" disabled={busy || !taskTitle.trim()}
                      onClick={makeTask}>Create task</button>
                    <button className="link" onClick={() => setMaking(false)}>Cancel</button>
                  </div>
                </section>
              ) : (
                <button type="button" className="btn ghost wide" onClick={() => setMaking(true)}>
                  <Icon name="plus" size={14} /> Create a task from this note
                </button>
              )}

              {detail?.tasks?.length > 0 && (
                <section className="facts">
                  <h4>Tasks from this note</h4>
                  <ul className="note-tasks">
                    {detail.tasks.map((t) => (
                      <li key={t.id}>
                        <span className={t.status === 'done' ? 'done' : ''}>{t.title}</span>
                        <span className="note-task-state">{t.status.replace('_', ' ')}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="facts">
                <h4>About this note</h4>
                <dl className="fact-list">
                  <div><dt>Created</dt><dd>{addedLabel(note.created_at)?.replace('Added ', '') || '—'}</dd></div>
                  <div><dt>Updated</dt><dd>{agoLabel(note.updated_at) || '—'}</dd></div>
                  {note.source === 'whatsapp' && (
                    <div><dt>Source</dt><dd>WhatsApp{note.chat_name ? ` · ${note.chat_name}` : ''}</dd></div>
                  )}
                </dl>
              </section>

              {detail?.events?.length > 0 && (
                <section className="facts">
                  <h4>History</h4>
                  <ul className="note-events">
                    {detail.events.slice(0, 12).map((e) => (
                      <li key={e.id}>
                        <span>{e.kind}{e.detail ? ` — ${e.detail}` : ''}</span>
                        <span className="note-event-at">{agoLabel(e.at)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        <footer className="sheet-foot note-foot">
          <button className="btn primary" disabled={busy} onClick={save}>Save</button>
          {!isNew && (
            <>
              <button type="button" className="btn ghost small" disabled={busy}
                onClick={() => act(() => api.updateNote(note.id, { pinned: !note.pinned }))}>
                {note.pinned ? 'Unpin' : 'Pin'}
              </button>
              {note.archived ? (
                <button type="button" className="btn ghost small" disabled={busy}
                  onClick={() => act(() => api.restoreNote(note.id))}>
                  Restore
                </button>
              ) : (
                <button type="button" className="btn ghost small" disabled={busy}
                  onClick={() => act(() => api.archiveNote(note.id))}>
                  Archive
                </button>
              )}
              <button type="button" className="link danger" disabled={busy}
                onClick={() => {
                  // Archive keeps a note; this does not, so it asks.
                  if (window.confirm('Delete this note for good? Archiving keeps it instead.')) {
                    act(() => api.deleteNote(note.id));
                  }
                }}>
                Delete
              </button>
            </>
          )}
          <button className="link" onClick={onClose}>Cancel</button>
        </footer>
      </div>
    </div>
  );
}

/** An ISO instant as the value a datetime-local input wants, on this clock. */
function toLocalInput(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export default function NotesPage({ groups = [], query = '', openId = null, onOpened, onError, onCountChange }) {
  const [notes, setNotes] = useState([]);
  const [tags, setTags] = useState([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [filter, setFilter] = useState('all');
  const [tag, setTag] = useState('');
  const [group, setGroup] = useState('');
  const [own, setOwn] = useState('');
  const [open, setOpen] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.notes({
        archived: filter === 'archived' ? 1 : undefined,
        group_id: group || undefined,
        tag: tag || undefined,
        reminder: filter === 'reminder' ? 1 : undefined,
      });
      setNotes(data.notes);
      setTags(data.tags);
      setArchivedCount(data.archived_count);
      onCountChange?.(data.notes.length);
    } catch (err) {
      onError(err);
    } finally {
      setLoaded(true);
    }
  }, [filter, group, tag, onError, onCountChange]);

  useEffect(() => { load(); }, [load]);

  /*
   * A note asked for from somewhere else - a search result in the top bar -
   * opens as soon as the list it lives in has arrived. Cleared straight away,
   * so closing the note does not reopen it.
   */
  useEffect(() => {
    if (!openId || !loaded) return;
    const found = notes.find((n) => n.id === openId);
    if (found) { setOpen(found); onOpened?.(); }
  }, [openId, loaded, notes, onOpened]);

  // The page's own search box, and the one in the top bar, are the same search.
  const needle = (own || query).trim().toLowerCase();
  const shown = useMemo(() => {
    const base = filter === 'pinned' ? notes.filter((n) => n.pinned) : notes;
    if (!needle) return base;
    return base.filter((note) =>
      [note.title, note.body, note.group_name, note.chat_name, note.tags.join(' ')]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle))
    );
  }, [notes, filter, needle]);

  const pinned = shown.filter((n) => n.pinned);
  const rest = shown.filter((n) => !n.pinned);

  const pin = async (note) => {
    try {
      await api.updateNote(note.id, { pinned: !note.pinned });
      load();
    } catch (err) { onError(err); }
  };

  return (
    <section className="notes-page">
      <div className="notes-bar">
        <label className="notes-search">
          <Icon name="search" size={15} />
          <input
            value={own}
            placeholder="Search notes…"
            aria-label="Search notes"
            onChange={(e) => setOwn(e.target.value)}
          />
          {own && <button className="icon-btn" aria-label="Clear" onClick={() => setOwn('')}>✕</button>}
        </label>
        <button className="btn primary" onClick={() => setOpen({})}>
          <Icon name="plus" size={15} /> New note
        </button>
      </div>

      <div className="notes-filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`chip ${filter === f.key ? 'on' : ''}`}
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {f.key === 'archived' && archivedCount > 0 ? ` (${archivedCount})` : ''}
          </button>
        ))}
        {groups.length > 0 && (
          <select value={group} aria-label="Business" onChange={(e) => setGroup(e.target.value)}>
            <option value="">Every business</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
        {tags.length > 0 && (
          <select value={tag} aria-label="Tag" onChange={(e) => setTag(e.target.value)}>
            <option value="">Every tag</option>
            {tags.map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({t.count})</option>)}
          </select>
        )}
      </div>

      {!loaded ? null : shown.length === 0 ? (
        <div className="empty">
          <strong>
            {needle ? 'No note matches that.'
              : filter === 'archived' ? 'Nothing archived.'
              : 'No notes yet.'}
          </strong>
          <p>
            {filter === 'archived'
              ? 'Notes you archive stay here rather than being deleted.'
              : 'Things worth remembering — what the CA said, points for a meeting, an account number. Nothing here is chased or given a deadline.'}
          </p>
        </div>
      ) : (
        <>
          {pinned.length > 0 && (
            <>
              <h3 className="notes-head">Pinned</h3>
              <div className="notes-grid">
                {pinned.map((note) => (
                  <Card key={note.id} note={note} onOpen={setOpen} onPin={pin} />
                ))}
              </div>
            </>
          )}

          {rest.length > 0 && (
            <>
              {pinned.length > 0 && <h3 className="notes-head">All notes</h3>}
              <div className="notes-grid">
                {rest.map((note) => (
                  <Card key={note.id} note={note} onOpen={setOpen} onPin={pin} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {open && (
        <Editor
          note={open}
          groups={groups}
          onClose={() => setOpen(null)}
          onSaved={load}
          onError={onError}
        />
      )}
    </section>
  );
}
