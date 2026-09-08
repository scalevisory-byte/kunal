import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';
import { agoLabel, formatWaNumber } from '../lib/task.js';

/**
 * People who might buy something, and where each of them has got to.
 *
 * A lead is not a task: a task is work he owes, a lead is somebody else's
 * decision he is waiting on. All he owes it is the next contact, so that is
 * what the board is built around - the stage, and when to speak to them next.
 *
 * Nothing here messages the lead. The follow-up is a button that opens their
 * chat with the words ready; he presses send. That line is the whole reason
 * this can live on a personal WhatsApp at all.
 */
const NEXT_CHOICES = [
  { key: 0, label: 'Today' },
  { key: 1, label: 'Tomorrow' },
  { key: 3, label: 'In 3 days' },
  { key: 7, label: 'Next week' },
];

const atHour = (days, hour = 11) => {
  const at = new Date();
  at.setDate(at.getDate() + days);
  at.setHours(hour, 0, 0, 0);
  return at.toISOString();
};

const whenLabel = (iso) => {
  if (!iso) return null;
  const at = new Date(iso);
  const day = at.toLocaleDateString('en-CA');
  const today = new Date().toLocaleDateString('en-CA');
  const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA');
  const clock = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (day === today) return `Today · ${clock}`;
  if (day === tomorrow) return `Tomorrow · ${clock}`;
  return `${at.toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${clock}`;
};

const isOverdue = (lead) =>
  Boolean(lead.next_action_at) && new Date(lead.next_action_at) < new Date();

/** wa.me opens the chat with the message typed but not sent. */
const chatLink = (lead, text) => {
  const digits = String(lead.wid || lead.phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
};

function Card({ lead, stages, onMove, onContacted, onOpen }) {
  const link = chatLink(lead, `Hello ${lead.name.split(' ')[0]}, `);
  return (
    <article className={`lead-card ${isOverdue(lead) ? 'late' : ''}`}>
      <button className="lead-open" onClick={() => onOpen(lead)}>
        <strong>{lead.name}</strong>
        <span className="lead-meta">
          {lead.group_name && <span className={`lead-chip c-${lead.group_colour || 'slate'}`}>{lead.group_name}</span>}
          {lead.value ? <span className="lead-value">₹{Number(lead.value).toLocaleString('en-IN')}</span> : null}
          {lead.phone && <span className="lead-num">{formatWaNumber(lead.phone) || lead.phone}</span>}
        </span>

        {/* His own filing, from WhatsApp Business. Shown rather than restated:
            a chat marked "AI handoff" there is one the AI has stopped
            answering, which is exactly when he needs to see it. */}
        {lead.labels?.length > 0 && (
          <span className="lead-labels">
            {/* The label that named the business is already the chip above it;
                printing it twice says nothing the second time. */}
            {lead.labels
              .filter((label) => label.toLowerCase() !== String(lead.group_name || '').toLowerCase())
              .map((label) => (
                <span key={label} className={`lead-label ${/handoff|manual/i.test(label) ? 'hot' : ''}`}>
                  {label}
                </span>
              ))}
          </span>
        )}
        <span className={`lead-when ${isOverdue(lead) ? 'danger-text' : ''}`}>
          {lead.next_action_at
            ? `${isOverdue(lead) ? 'Overdue — ' : 'Next: '}${whenLabel(lead.next_action_at)}`
            : 'No next contact set'}
        </span>
      </button>

      <div className="lead-tools">
        <select
          value={lead.stage}
          aria-label={`Stage for ${lead.name}`}
          onChange={(e) => onMove(lead, e.target.value)}
        >
          {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        {link && (
          <a className="tool" href={link} target="_blank" rel="noreferrer" title="Opens WhatsApp — you send it">
            <Icon name="whatsapp" size={13} /> Open chat
          </a>
        )}
        <button className="tool" onClick={() => onContacted(lead)}>Spoke to them</button>
      </div>
    </article>
  );
}

export default function LeadsPage({ groups = [], onError }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', group_id: '', source: 'facebook' });
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.leads());
    } catch (err) {
      onError(err);
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const columns = useMemo(() => {
    if (!data) return [];
    return data.stages.map((stage) => ({
      ...stage,
      items: data.leads.filter((l) => l.stage === stage.key),
    }));
  }, [data]);

  if (!data) return null;
  const { held } = data;
  const chasing = data.leads.filter((l) => !l.closed && isOverdue(l)).length;
  const waiting = data.leads.filter((l) => !l.closed && !l.next_action_at).length;

  return (
    <section className="leads-page">
      {/*
        * Captured, not filed. Somebody arriving from an ad looks exactly like
        * a courier asking for an address until a person has read it, so
        * nothing reaches the board on its own.
        */}
      {held.length > 0 && (
        <section className="lead-held">
          <h3>Is this a lead? <span>{held.length} waiting</span></h3>
          {held.map((lead) => (
            <div className="lead-held-row" key={lead.id}>
              <div>
                <strong>{lead.name}</strong>
                <span>
                  {lead.source_ref}
                  {lead.first_message ? ` — “${lead.first_message.slice(0, 90)}”` : ''}
                </span>
              </div>
              <div className="lead-held-act">
                <button className="btn small" disabled={busy}
                  onClick={() => act(() => api.confirmLead(lead.id))}>
                  Yes, a lead
                </button>
                <button className="link" disabled={busy}
                  onClick={() => act(() => api.deleteLead(lead.id))}>
                  No
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="lead-bar">
        <span className="lead-figs">
          <b>{data.leads.filter((l) => !l.closed).length}</b> open
          {chasing > 0 && <> · <b className="danger-text">{chasing}</b> overdue</>}
          {waiting > 0 && <> · {waiting} with no next contact</>}
        </span>
        <button className="btn primary small" onClick={() => setAdding((v) => !v)}>
          <Icon name="plus" size={14} /> New lead
        </button>
      </div>

      {adding && (
        <form
          className="lead-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.name.trim()) return;
            act(async () => {
              await api.createLead({
                ...form,
                group_id: form.group_id ? Number(form.group_id) : null,
                next_action_at: atHour(0),
              });
              setForm({ name: '', phone: '', group_id: '', source: 'facebook' });
              setAdding(false);
            });
          }}
        >
          <input
            value={form.name}
            autoFocus
            placeholder="Name"
            aria-label="Lead name"
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <input
            value={form.phone}
            placeholder="Phone"
            aria-label="Phone"
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
          <select
            value={form.group_id}
            aria-label="Business"
            onChange={(e) => setForm((f) => ({ ...f, group_id: e.target.value }))}
          >
            <option value="">Which business?</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select
            value={form.source}
            aria-label="Where from"
            onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
          >
            {data.sources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button className="btn primary small" type="submit" disabled={busy || !form.name.trim()}>Add</button>
        </form>
      )}

      <div className="lead-board">
        {columns.map((col) => (
          <section className={`lead-col s-${col.key}`} key={col.key}>
            <header>
              <h3>{col.label}</h3>
              <span>{col.items.length}</span>
            </header>
            {col.items.length === 0 ? (
              <p className="lead-empty">{col.note}</p>
            ) : (
              col.items.map((lead) => (
                <Card
                  key={lead.id}
                  lead={lead}
                  stages={data.stages}
                  onOpen={setOpen}
                  onMove={(l, stage) => act(() => api.updateLead(l.id, { stage }))}
                  onContacted={(l) => act(() => api.leadContacted(l.id, { next_action_at: atHour(3) }))}
                />
              ))
            )}
          </section>
        ))}
      </div>

      {open && (
        <LeadSheet
          lead={open}
          groups={groups}
          stages={data.stages}
          onClose={() => setOpen(null)}
          onSaved={() => { load(); setOpen(null); }}
          onError={onError}
        />
      )}
    </section>
  );
}

/** One lead, opened: everything about them, and what happens next. */
function LeadSheet({ lead, groups, stages, onClose, onSaved, onError }) {
  const [draft, setDraft] = useState({
    name: lead.name,
    phone: lead.phone || '',
    group_id: lead.group_id ? String(lead.group_id) : '',
    value: lead.value || '',
    stage: lead.stage,
    note: lead.note || '',
  });
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.lead(lead.id).then(setDetail).catch(() => {}); }, [lead.id]);

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  const save = async (patch) => {
    setBusy(true);
    try {
      await api.updateLead(lead.id, patch ?? {
        ...draft,
        group_id: draft.group_id ? Number(draft.group_id) : null,
        value: draft.value === '' ? null : Number(draft.value),
      });
      onSaved();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const link = chatLink(lead, `Hello ${lead.name.split(' ')[0]}, `);

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="Lead" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>{lead.name}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </header>

        <div className="sheet-body">
          <div className="field-row">
            <div className="field">
              <label htmlFor="l-name">Name</label>
              <input id="l-name" value={draft.name} onChange={set('name')} />
            </div>
            <div className="field">
              <label htmlFor="l-phone">Phone</label>
              <input id="l-phone" value={draft.phone} onChange={set('phone')} />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="l-stage">Stage</label>
              <select id="l-stage" value={draft.stage} onChange={set('stage')}>
                {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="l-group">Business</label>
              <select id="l-group" value={draft.group_id} onChange={set('group_id')}>
                <option value="">None</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="l-value">What it is worth (₹)</label>
            <input id="l-value" type="number" min="0" value={draft.value} onChange={set('value')}
              placeholder="Leave empty if you do not know yet" />
          </div>

          <div className="field">
            <label htmlFor="l-note">What was said</label>
            <textarea id="l-note" rows={4} value={draft.note} onChange={set('note')} />
          </div>

          <section className="facts">
            <h4>Next contact</h4>
            <p className="field-note">
              {lead.next_action_at
                ? `You will be reminded ${whenLabel(lead.next_action_at)}. Nothing is sent to them.`
                : 'Nobody is chasing this one. Set a day and the app will remind you.'}
            </p>
            <div className="lead-next">
              {NEXT_CHOICES.map((c) => (
                <button key={c.key} type="button" className="chip" disabled={busy}
                  onClick={() => save({ next_action_at: atHour(c.key) })}>
                  {c.label}
                </button>
              ))}
              {lead.next_action_at && (
                <button type="button" className="link" disabled={busy}
                  onClick={() => save({ next_action_at: null })}>
                  Clear
                </button>
              )}
            </div>
          </section>

          {link && (
            <p className="field-note">
              <a className="btn small ghost" href={link} target="_blank" rel="noreferrer">
                <Icon name="whatsapp" size={13} /> Open their chat
              </a>
              {' '}The message is typed for you; WhatsApp will not send it until you do.
            </p>
          )}

          <section className="facts">
            <h4>Where they came from</h4>
            <dl className="fact-list">
              <div><dt>Source</dt><dd>{lead.source}</dd></div>
              {lead.source_ref && <div><dt>How it was spotted</dt><dd>{lead.source_ref}</dd></div>}
              {lead.chat_name && <div><dt>Chat</dt><dd>{lead.chat_name}</dd></div>}
              {lead.labels?.length > 0 && (
                <div><dt>WhatsApp labels</dt><dd>{lead.labels.join(', ')}</dd></div>
              )}
              <div><dt>First seen</dt><dd>{agoLabel(lead.created_at)}</dd></div>
            </dl>
            {lead.first_message && (
              <p className="quote">{lead.first_message}</p>
            )}
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
        </div>

        <footer className="sheet-foot">
          <button className="btn primary" disabled={busy} onClick={() => save()}>Save</button>
          <button className="link" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
