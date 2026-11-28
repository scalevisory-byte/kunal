import { useEffect, useMemo, useState } from 'react';
import { col, printReport } from '../../printReport.js';
import { api } from '../../api.js';
import { onStaff } from '../../onStaff.js';

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

  /*
   * PRIORITY AND WHO HAS IT. Both were stored from the start and printed on
   * the register, and nothing on screen could set either - so every ticket
   * sat at "normal" with nobody. Changed on the row, saved at once.
   */
  const [prio, setPrio] = useState('');
  const [routeSaid, setRouteSaid] = useState('');
  const route = async (ticket, patch) => {
    try {
      const after = await api.patch(`/people/tickets/${ticket.id}`, patch);
      setTickets((list) => list.map((t) => (t.id === ticket.id ? { ...t, ...after, replies: t.replies } : t)));
      setRouteSaid('');
    } catch (err) {
      setRouteSaid(err.message);
    }
  };
  const PRIO_RANK = { high: 0, normal: 1, low: 2 };
  const shown = useMemo(
    () =>
      tickets
        .filter((t) => !prio || (t.priority || 'normal') === prio)
        // Open work by urgency, then oldest first; closed ones after, as they came.
        .sort(
          (a, b) =>
            Number(a.status === 'closed') - Number(b.status === 'closed') ||
            (a.status === 'closed' ? 0 : (PRIO_RANK[a.priority] ?? 1) - (PRIO_RANK[b.priority] ?? 1)) ||
            String(a.created_at).localeCompare(String(b.created_at))
        ),
    [tickets, prio]
  );
  // Names already used, so the same person is typed the same way every time.
  const withNames = useMemo(
    () => [...new Set(tickets.map((t) => t.assigned_to).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [tickets]
  );

  /**
   * WHAT STAFF HAVE ASKED, AND WHO IS WAITING ON WHOM.
   *
   * Two rules of this module ride onto the paper, because both are easy to
   * read the wrong way round:
   *
   *   **Waiting means waiting on US.** A ticket somebody has answered is
   *   waiting on the employee, not on the office, and the column says which.
   *
   *   **Answering is not closing.** The employee decides whether the answer
   *   settled it, and replying puts it back to open.
   */
  const printIt = () => {
    printReport({
      title: 'Helpdesk — what staff have asked',
      subtitle: { open: 'open', answered: 'answered', closed: 'closed' }[status] || 'every ticket on record',
      meta: [
        `${tickets.length} ${tickets.length === 1 ? 'ticket' : 'tickets'}`,
        `${waiting.length} waiting on the office`,
      ],
      landscape: true,
      /* Thirteen columns once the detail is on it. */
      compact: true,
      columns: [
        col('#', (_t, i) => i + 1, '3%'),
        col('Raised', (t) => String(t.created_at || '').slice(0, 10)),
        col('Who', (t) => t.employee_name || ''),
        col('About', (t) => t.category || ''),
        col('Priority', (t) => t.priority || ''),
        col('With', (t) => t.assigned_to || ''),
        col('What they asked', (t) => t.subject || ''),
        col('Detail', (t) => t.detail || ''),
        col('Where it stands', (t) => t.status || ''),
        col('Waiting on', (t) => (t.waiting ? 'the office' : t.status === 'closed' ? '—' : 'them')),
        /* The row's own field names, read off the API rather than guessed:
           `last_reply_at` and `last_side`, not an `answered_at` that does
           not exist. */
        col('Last reply', (t) => String(t.last_reply_at || '').slice(0, 10)),
        col('By', (t) => (t.last_side === 'office' ? 'the office' : t.last_side ? 'them' : '')),
        col('Replies', (t) => t.replies ?? ''),
        col('Closed', (t) => String(t.closed_on || '').slice(0, 10)),
      ],
      rows: tickets,
      footer:
        '“Waiting on the office” means nobody here has replied yet. Answering is not closing: the person who raised it decides whether the answer settled it, and a reply from them puts it back to open.',
    });
  };

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
        <div className="figure">
          <span className="k">High priority, open</span>
          <span className="n">{tickets.filter((t) => t.status !== 'closed' && t.priority === 'high').length}</span>
        </div>
        <div className="figure">
          <span className="k">Open with nobody</span>
          <span className="n">{tickets.filter((t) => t.status !== 'closed' && !t.assigned_to).length}</span>
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
        <select value={prio} onChange={(e) => setPrio(e.target.value)} aria-label="Priority">
          <option value="">Any priority</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
        <button className="ghost" onClick={printIt} disabled={!tickets.length}>
          Print {tickets.length}
        </button>
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
                {onStaff(employees).map((e) => (
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

      {routeSaid && <p className="lic-alert warn">{routeSaid}</p>}
      <datalist id="hd-with">
        {withNames.map((n) => <option key={n} value={n} />)}
      </datalist>

      {!shown.length ? (
        <p className="muted small">{tickets.length ? 'Nothing at that priority.' : 'Nothing asked.'}</p>
      ) : (
        <div className="table-wrap">
        <table className="sheet">
          <thead>
            <tr>
              <th>Raised</th>
              <th>Who</th>
              <th>About</th>
              <th>What</th>
              <th>Priority</th>
              <th>With</th>
              <th>Where it stands</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((ticket) => (
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
                  <select
                    className={`hd-prio p-${ticket.priority || 'normal'}`}
                    value={ticket.priority || 'normal'}
                    disabled={ticket.status === 'closed'}
                    onChange={(e) => route(ticket, { priority: e.target.value })}
                    aria-label={`Priority of ${ticket.subject}`}
                  >
                    <option value="high">High</option>
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                  </select>
                </td>
                <td>
                  <input
                    className="hd-with"
                    key={`${ticket.id}-${ticket.assigned_to || ''}`}
                    list="hd-with"
                    defaultValue={ticket.assigned_to || ''}
                    placeholder="nobody yet"
                    disabled={ticket.status === 'closed'}
                    onBlur={(e) => e.target.value.trim() !== (ticket.assigned_to || '') && route(ticket, { assigned_to: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    aria-label={`Who has ${ticket.subject}`}
                  />
                </td>
                <td>
                  <span className={`pill ${ticket.status}`}>{ticket.status}</span>
                  {ticket.waiting && <span className="pill pending"> waiting on us</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
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
