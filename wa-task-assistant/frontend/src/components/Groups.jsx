import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';

const blank = { name: '', colour: '', keywords: '', separate: false };

/**
 * One group per business.
 *
 * Which company a task belongs to cannot be read off the chat it arrived in -
 * work for the same business comes through several chats, and some of it is
 * typed by hand. So a group is its own thing, and it carries the words that
 * put a task in it.
 */
export default function Groups({ onChanged, onError }) {
  const [groups, setGroups] = useState([]);
  const [colours, setColours] = useState([]);
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.groups();
      setGroups(data.groups);
      setColours(data.colours);
    } catch (err) {
      onError(err);
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setNote('');
    try {
      const body = {
        name: form.name,
        colour: form.colour || undefined,
        keywords: form.keywords,
        separate: form.separate,
      };
      if (editing) await api.updateGroup(editing, body);
      else {
        const { group } = await api.createGroup(body);
        // A group made today should pick up work already sitting in the list.
        const { moved } = await api.applyGroup(group.id);
        setNote(
          moved > 0
            ? `${group.name} created — ${moved} existing task${moved === 1 ? '' : 's'} moved into it.`
            : `${group.name} created. New tasks matching its words will go here.`
        );
      }
      setForm(null);
      setEditing(null);
      await load();
      onChanged?.();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (group) => {
    setEditing(group.id);
    setForm({
      name: group.name,
      colour: group.colour,
      separate: Boolean(group.separate),
      // The name is always a keyword; showing it back would invite deleting it.
      keywords: group.keywords.filter((k) => k !== group.name.toLowerCase()).join(', '),
    });
  };

  const remove = async (group) => {
    setBusy(true);
    try {
      await api.deleteGroup(group.id);
      setNote(`${group.name} removed. Its tasks are still here, just ungrouped.`);
      await load();
      onChanged?.();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  return (
    <section className="settings-block">
      <header className="settings-head">
        <h3>Your businesses</h3>
        <span>{groups.length ? `${groups.length} group${groups.length === 1 ? '' : 's'}` : 'None yet'}</span>
      </header>

      {groups.length === 0 && !form && (
        <p className="field-note">
          Make one for each business — BNF, Scale Visory, Sunshine — and tasks that mention
          it go there on their own. Each becomes its own item in the sidebar.
        </p>
      )}

      {note && <p className="field-note ok-text">{note}</p>}

      {groups.length > 0 && (
        <ul className="group-list">
          {groups.map((g) => (
            <li key={g.id}>
              <span className={`group-dot c-${g.colour}`} aria-hidden="true" />
              <div className="group-what">
                <strong>{g.name}</strong>
                <span className="group-meta">
                  {g.counts.open} open · {g.counts.total} in total
                  {g.separate && ' · kept out of the main list'}
                  {g.keywords.length > 1 && ` · matches ${g.keywords.slice(0, 6).join(', ')}`}
                </span>
              </div>
              <div className="group-actions">
                <button type="button" className="btn small ghost" disabled={busy}
                  onClick={() => startEdit(g)}>
                  Edit
                </button>
                <button type="button" className="icon-btn" aria-label={`Delete ${g.name}`}
                  disabled={busy} onClick={() => remove(g)}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {form ? (
        <form className="template-form" onSubmit={save}>
          <div className="field">
            <label htmlFor="g-name">Name</label>
            <input id="g-name" value={form.name} onChange={set('name')}
              placeholder="BNF" required autoFocus />
          </div>

          <div className="field">
            <label htmlFor="g-words">Other words that mean this business</label>
            <input id="g-words" value={form.keywords} onChange={set('keywords')}
              placeholder="book n fly, booknfly, flight booking" />
            <p className="field-note">
              Comma separated. The name itself always counts, so you need only add the
              other ways you write it. A task is matched on whole words, so “TCS” will not
              catch “watch”.
            </p>
          </div>

          <div className="field">
            <label>Colour</label>
            <div className="colour-row">
              {colours.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`colour-swatch c-${c} ${form.colour === c ? 'picked' : ''}`}
                  aria-label={c}
                  aria-pressed={form.colour === c}
                  onClick={() => setForm((f) => ({ ...f, colour: c }))}
                />
              ))}
            </div>
          </div>

          {/*
            * Some work arrives in bulk and is not the day's work — vacancies
            * landing on a recruitment desk, dozens a week. Mixed into the list
            * they bury everything else; thrown away they are lost. This keeps
            * them, in their own section, and out of the way.
            */}
          <div className="field">
            <label className="check-inline">
              <input
                type="checkbox"
                checked={form.separate}
                onChange={(e) => setForm((f) => ({ ...f, separate: e.target.checked }))}
              />
              <span>Keep this group out of the main list</span>
            </label>
            <p className="field-note">
              Its work is still captured and still has its own section in the sidebar, but it
              stays out of the dashboard, Focus today and Needs attention — and it is never
              chased: no reminders, no digest, no daily briefing. For things worth keeping a
              record of that are not the day&rsquo;s work.
            </p>
          </div>

          <div className="template-form-foot">
            <button type="submit" className="btn primary" disabled={busy || !form.name.trim()}>
              {editing ? 'Save' : 'Create group'}
            </button>
            <button type="button" className="btn ghost"
              onClick={() => { setForm(null); setEditing(null); }}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn small ghost" onClick={() => { setForm(blank); setEditing(null); }}>
          New group
        </button>
      )}
    </section>
  );
}
