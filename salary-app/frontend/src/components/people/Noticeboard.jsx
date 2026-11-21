import { useEffect, useState } from 'react';
import { api, STANDALONE } from '../../api.js';
import { KINDS, isLive, kindIcon, validate } from '../../../../shared/announcements.js';

/**
 * THE NOTICEBOARD the staff portal reads.
 *
 * Dinesh: *"any announcmnet like celbration holiday o bhi"*. Until now the
 * portal's Announcements card said there was no noticeboard in the system,
 * which was true and was a gap.
 *
 * NOTHING IS SENT. This is a board: pin something and the staff see it when
 * they sign in. No message goes out, nobody is notified, and the panel says
 * so rather than letting somebody assume an announcement reached a phone.
 */
const BLANK = { kind: 'notice', title: '', body: '', company_id: '', from_on: '', until_on: '', pinned: false };

export default function Noticeboard({ companies = [], onError }) {
  const [list, setList] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const today = new Date().toISOString().slice(0, 10);

  const load = async () => {
    try {
      const { announcements } = await api.get('/people/announcements');
      setList(announcements || []);
    } catch (err) {
      onError?.(err.message);
      setList([]);
    }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    const { ok, problems } = validate(form);
    if (!ok) return setProblem(problems.join('; '));
    setProblem('');
    setBusy(true);
    try {
      await api.post('/people/announcements', {
        ...form,
        company_id: form.company_id ? Number(form.company_id) : null,
      });
      setForm(BLANK);
      await load();
    } catch (err) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };

  const change = async (id, patch) => {
    try {
      await api.patch(`/people/announcements/${id}`, patch);
      await load();
    } catch (err) {
      onError?.(err.message);
    }
  };

  const remove = async (a) => {
    if (!window.confirm(`Take "${a.title}" off the board? It cannot be put back.`)) return;
    try {
      await api.del(`/people/announcements/${a.id}`);
      await load();
    } catch (err) {
      onError?.(err.message);
    }
  };

  if (STANDALONE) {
    return (
      <div className="card">
        <h3>Noticeboard</h3>
        <p className="muted small">
          This needs the server. The staff read the board when they sign in to their own portal,
          and there is nothing to sign in to in a file on a laptop.
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="card">
        <h3>Put something on the board</h3>
        <div className="form-grid">
          <label>
            What kind
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
            <span className="muted small">{KINDS.find((k) => k.key === form.kind)?.why}</span>
          </label>
          <label>
            Title
            <input
              value={form.title}
              placeholder="Diwali — office shut 10th to 12th"
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label>
            Who sees it
            <select
              value={form.company_id}
              onChange={(e) => setForm({ ...form, company_id: e.target.value })}
            >
              <option value="">Everybody</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name} only</option>)}
            </select>
          </label>
          <label>
            Goes up
            <input
              type="date"
              value={form.from_on}
              onChange={(e) => setForm({ ...form, from_on: e.target.value })}
            />
            <span className="muted small">leave empty for straight away</span>
          </label>
          <label>
            Comes down
            <input
              type="date"
              value={form.until_on}
              onChange={(e) => setForm({ ...form, until_on: e.target.value })}
            />
            <span className="muted small">leave empty to take it down by hand</span>
          </label>
          <label className="wide-field">
            The notice
            <textarea
              rows={3}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </label>
        </div>
        <div className="row">
          <button className="primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Put it up'}
          </button>
          {problem ? <span className="error">{problem}</span> : null}
        </div>
        <p className="muted small">
          <strong>Nothing is sent.</strong> It goes on the staff portal, where people see it when
          they sign in — no message, no email, nobody notified.
        </p>
      </div>

      <div className="card">
        <h3>On the board</h3>
        {list === null ? (
          <p className="muted small">Loading…</p>
        ) : !list.length ? (
          <p className="empty fo-empty">Nothing on the board. Staff see an empty card too.</p>
        ) : (
          <table className="sheet">
            <thead>
              <tr>
                <th>Notice</th>
                <th>Who</th>
                <th>Up</th>
                <th>Down</th>
                <th>Now</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id}>
                  <td>
                    <span aria-hidden="true">{kindIcon(a.kind)} </span>
                    <strong>{a.title}</strong>
                    {a.body ? <div className="muted small">{a.body}</div> : null}
                  </td>
                  <td className="small">{a.company_name || 'Everybody'}</td>
                  <td className="small">{a.from_on || 'straight away'}</td>
                  <td className="small">{a.until_on || 'by hand'}</td>
                  <td className="small">
                    {/* Whether it is actually ON the board today, which is a
                        different question from whether it exists. */}
                    {isLive(a, today) ? <span className="pill">showing</span> : <span className="muted">not yet / over</span>}
                  </td>
                  <td>
                    <button
                      className="ghost tiny"
                      onClick={() => change(a.id, { pinned: !a.pinned })}
                      title="A pinned notice sits at the top of the staff's list"
                    >
                      {a.pinned ? 'unpin' : 'pin'}
                    </button>
                    <button className="ghost tiny danger" onClick={() => remove(a)}>take down</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
