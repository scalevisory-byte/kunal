import { useEffect, useState } from 'react';
import { api } from '../../api.js';

const when = (v) => String(v || '').replace('T', ' ').slice(0, 16);

const CATEGORIES = ['Salary', 'Attendance', 'Leave', 'PF / ESI', 'Bank details', 'Documents', 'Complaint', 'Other'];

/**
 * What staff have asked the office for, or complained about.
 *
 * An employee raises one from the link they punch from — no password, because a
 * hundred people are not getting logins. Two rules keep it honest:
 *
 * **Answering is not closing.** The office replying moves a ticket to
 * "answered"; whether the answer settled it is the employee's call, and they
 * replying puts it back to "open". A helpdesk that closes its own tickets
 * measures nothing.
 *
 * **Waiting means waiting on us.** The list leads with the ones where nobody
 * in the office has spoken since the employee did.
 */
export default function Helpdesk({ employees, onError, only = null }) {
  const [tickets, setTickets] = useState([]);
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reply, setReply] = useState('');
  const [adding, setAdding] = useState(false);
  // On one person's file the picker is already answered.
  const [draft, setDraft] = useState({
    employee_id: only?.id || '',
    category: 'Salary',
    subject: '',
    detail: '',
  });

  const load = async (filter = status) => {
    try {
      const { tickets: list } = await api.get(
        `/people/tickets${filter ? `?status=${filter}` : ''}${only ? `${filter ? '&' : '?'}employee_id=${only.id}` : ''}`
      );
      setTickets(list);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const openTicket = async (id) => {
    setOpenId(id);
    setReply('');
    try {
      setDetail(await api.get(`/people/tickets/${id}`));
    } catch (err) {
      onError(err);
    }
  };

  const send = async () => {
    if (!reply.trim()) return;
    try {
      setDetail(await api.post(`/people/tickets/${openId}/reply`, { body: reply }));
      setReply('');
      load();
    } catch (err) {
      onError(err);
    }
  };

  const close = async () => {
    try {
      setDetail(await api.post(`/people/tickets/${openId}/close`, {}));
      load();
    } catch (err) {
      onError(err);
    }
  };

  const reopen = async () => {
    try {
      setDetail(await api.post(`/people/tickets/${openId}/reopen`, {}));
      load();
    } catch (err) {
      onError(err);
    }
  };

  const raise = async () => {
    if (!draft.employee_id || !draft.subject.trim()) return;
    try {
      await api.post('/people/tickets', draft);
      setDraft({ ...draft, subject: '', detail: '' });
      setAdding(false);
      load();
    } catch (err) {
      onError(err);
    }
  };

  const waiting = tickets.filter((t) => t.waiting);

  return (
    <section className="stack">
      <div className="figures">
        <div className="figure">
          <span className="k">Waiting on the office</span>
          <span className="n">{waiting.length}</span>
        </div>
        <div className="figure">
          <span className="k">Open in all</span>
          <span className="n">{tickets.filter((t) => t.status !== 'closed').length}</span>
        </div>
      </div>

      <div className="toolbar">
        <div className="sub-tabs toolbar">
          {[['', 'Everything'], ['open', 'Open'], ['answered', 'Answered'], ['closed', 'Closed']].map(
            ([value, label]) => (
              <button key={value} className={status === value ? 'active' : undefined} onClick={() => setStatus(value)}>
                {label}
              </button>
            )
          )}
        </div>
        <button className="ghost" onClick={() => setAdding(!adding)}>
          {adding ? 'Cancel' : 'Log one for somebody'}
        </button>
      </div>

      {adding && (
        <div className="card">
          <p className="muted small">
            Staff raise these themselves from their punch link. This is for when somebody tells you
            in person and you want it on the record.
          </p>
          <div className="form-grid">
            <label>
              Who
              <select value={draft.employee_id} onChange={(e) => setDraft({ ...draft, employee_id: e.target.value })}>
                <option value="">Pick somebody</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              About
              <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            In a line
            <input type="text" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          </label>
          <label className="block">
            What they said
            <textarea rows="2" value={draft.detail} onChange={(e) => setDraft({ ...draft, detail: e.target.value })} />
          </label>
          <button onClick={raise} disabled={!draft.employee_id || !draft.subject.trim()}>
            Log it
          </button>
        </div>
      )}

      {!tickets.length ? (
        <p className="muted small">Nothing asked.</p>
      ) : (
        <table className="sheet">
          <thead>
            <tr>
              <th>Raised</th>
              <th>Who</th>
              <th>About</th>
              <th>What</th>
              <th>Where it stands</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <tr key={ticket.id}>
                <td className="muted small">{when(ticket.created_at)}</td>
                <td className="sticky-name">{ticket.employee_name}</td>
                <td>{ticket.category}</td>
                <td>
                  <button className="ghost small" onClick={() => openTicket(ticket.id)}>
                    {ticket.subject}
                  </button>
                  {ticket.replies > 0 && (
                    <span className="muted small">
                      {' '}
                      · {ticket.replies} {ticket.replies === 1 ? 'reply' : 'replies'}
                    </span>
                  )}
                </td>
                <td>
                  <span className={`pill ${ticket.status}`}>{ticket.status}</span>
                  {ticket.waiting && <span className="pill pending"> waiting on us</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {detail && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="late-head">
              <div>
                <h3>{detail.subject}</h3>
                <p className="muted small">
                  {detail.employee_name} · {detail.category} · {when(detail.created_at)}
                </p>
              </div>
              <button className="ghost" onClick={() => setDetail(null)}>
                Close
              </button>
            </div>

            {detail.detail && <p>{detail.detail}</p>}

            <div className="stack">
              {detail.replies.map((r) => (
                <div key={r.id} className={`reply ${r.side}`}>
                  <span className="muted small">
                    {r.side === 'office' ? r.author || 'the office' : detail.employee_name} · {when(r.created_at)}
                  </span>
                  <div>{r.body}</div>
                </div>
              ))}
            </div>

            {detail.status === 'closed' ? (
              <p className="muted small">
                Closed {detail.closed_on}. <button className="ghost small" onClick={reopen}>reopen it</button>
              </p>
            ) : (
              <>
                <label className="block">
                  Answer
                  <textarea rows="3" value={reply} onChange={(e) => setReply(e.target.value)} />
                </label>
                <button onClick={send} disabled={!reply.trim()}>
                  Send
                </button>{' '}
                <button className="ghost" onClick={close}>
                  Close it
                </button>
                <p className="muted small">
                  Answering moves it to &ldquo;answered&rdquo;, not closed — whether the answer
                  settled it is theirs to say, and them replying puts it back to you.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
