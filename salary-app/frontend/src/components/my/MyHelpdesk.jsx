import { useEffect, useState } from 'react';
import { api } from '../../api.js';

/*
 * THE HELPDESK, ON THE STAFF PORTAL.
 *
 * Dinesh: *"help desk employee ko diya hua he?"* - and the honest answer was
 * "only from the punch link". The routes under /api/me/tickets had existed
 * since staff logins arrived, and no page in the portal used them, so
 * somebody signed in had no way to raise a question at all.
 *
 * The same two rules as the office's Helpdesk panel: answering is not
 * closing (they decide whether the answer settled it, and replying puts it
 * back to open), and the employee id comes off the login on the server, so
 * nothing here can read or write anybody else's ticket.
 */

// The office's own list (people.js TICKET_CATEGORIES), in the order it uses.
const CATEGORIES = ['Salary', 'Attendance', 'Leave', 'PF / ESI', 'Bank details', 'Documents', 'Complaint', 'Other'];

const STATUS = {
  open: 'Waiting on the office',
  answered: 'Answered — tell them if it is settled',
  closed: 'Closed',
};

const when = (v) => String(v || '').replace('T', ' ').slice(0, 16);

export default function MyHelpdesk({ onError }) {
  const [tickets, setTickets] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reply, setReply] = useState('');
  const [draft, setDraft] = useState({ category: 'Salary', subject: '', detail: '' });
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setTickets((await api.get('/me/tickets')).tickets || []);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = async (id) => {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(id);
    setReply('');
    try {
      setDetail(await api.get(`/me/tickets/${id}`));
    } catch (err) {
      onError(err);
    }
  };

  const raise = async () => {
    if (!draft.subject.trim()) return setProblem('Say what it is about in a line.');
    setBusy(true);
    setProblem('');
    try {
      await api.post('/me/tickets', draft);
      setDraft({ category: draft.category, subject: '', detail: '' });
      await load();
    } catch (err) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  const send = async () => {
    if (!reply.trim()) return;
    try {
      setDetail(await api.post(`/me/tickets/${openId}/reply`, { body: reply }));
      setReply('');
      load();
    } catch (err) {
      onError(err);
    }
  };

  return (
    <section className="stack">
      <div className="card">
        <h3>Ask the office</h3>
        <p className="muted small">
          A question about your salary, attendance or leave, a document, or a complaint. The office
          sees it in their Helpdesk and answers here.
        </p>
        <div className="form-grid">
          <label>
            About
            <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="wide-field">
            In a line
            <input
              value={draft.subject}
              placeholder="e.g. October salary is ₹500 less"
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            />
          </label>
          <label className="wide-field">
            Anything more
            <textarea rows={3} value={draft.detail} onChange={(e) => setDraft({ ...draft, detail: e.target.value })} />
          </label>
        </div>
        {problem ? <p className="banner bad">{problem}</p> : null}
        <button className="primary" disabled={busy} onClick={raise}>
          {busy ? 'Sending…' : 'Send it'}
        </button>
      </div>

      <div className="card">
        <h3>What you have asked</h3>
        {tickets === null ? (
          <p className="muted small">Loading…</p>
        ) : !tickets.length ? (
          <p className="empty">Nothing asked yet.</p>
        ) : (
          <ul className="plain-list my-tickets">
            {tickets.map((t) => (
              <li key={t.id}>
                <button className="link" onClick={() => open(t.id)}>
                  <strong>{t.subject}</strong>
                </button>
                <span className="muted small"> · {t.category} · {when(t.created_at)} · {STATUS[t.status] || t.status}</span>
                {openId === t.id && detail ? (
                  <div className="my-ticket">
                    {detail.detail ? <p className="small">{detail.detail}</p> : null}
                    {(detail.replies || []).map((r) => (
                      <p key={r.id} className={`small my-reply ${r.side}`}>
                        <strong>{r.side === 'office' ? r.author || 'The office' : 'You'}</strong>{' '}
                        <span className="muted">{when(r.created_at)}</span>
                        <br />
                        {r.body}
                      </p>
                    ))}
                    {detail.status !== 'closed' ? (
                      <div className="my-ticket-reply">
                        <textarea
                          rows={2}
                          value={reply}
                          placeholder={detail.status === 'answered' ? 'Not settled? Say why — it goes back to the office.' : 'Add something'}
                          onChange={(e) => setReply(e.target.value)}
                        />
                        <button onClick={send} disabled={!reply.trim()}>Send</button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
