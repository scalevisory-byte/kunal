import { useEffect, useState } from 'react';
import { REQUEST_KINDS, kindLabel, spans } from '../../../shared/attendanceRequests.js';
import { ATTENDANCE_CODES } from '../../../shared/calc.js';

const clock = (iso) => String(iso || '').slice(11, 16);

/**
 * The employee's own page, opened from a link on their phone.
 *
 * Deliberately almost empty: one big button, what they punched today, and a
 * way to say "the machine missed me". No salary, no colleagues, no approvals —
 * this page knows who they are and nothing else about the business.
 */
export default function PunchPage({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [said, setSaid] = useState('');
  const [asking, setAsking] = useState(false);
  const [raising, setRaising] = useState(false);

  const load = async () => {
    try {
      const res = await fetch(`/api/punch/${token}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Could not open this link');
      setData(body);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const where = () =>
    new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    });

  const punch = async (kind) => {
    setBusy('Finding where you are…');
    setError('');
    setSaid('');
    try {
      const at = await where();
      setBusy('Recording…');
      const res = await fetch(`/api/punch/${token}/punch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, ...(at || {}) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Could not record that');
      setSaid(`${kind === 'in' ? 'Punched in' : 'Punched out'} at ${clock(body.at)} — ${body.where}`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  if (error && !data) {
    return (
      <div className="public">
        <div className="done">
          <p className="big">This link does not work</p>
          <p className="muted">{error}</p>
        </div>
      </div>
    );
  }
  if (!data) return <p className="loading">Loading…</p>;

  const { employee, settings, punches, next, requests, periods, tasks = [], tickets = [] } = data;

  return (
    <div className="public punch">
      <header>
        <span className="brand">{employee.company_name}</span>
        <h1>{employee.name}</h1>
        <span className="where">{employee.designation || 'Attendance'}</span>
      </header>

      {!settings.enabled ? (
        <div className="banner">
          Punching from a phone is switched off. Ask the office to turn it on.
        </div>
      ) : null}

      {said ? <div className="banner good">{said}</div> : null}
      {error ? <div className="banner bad">{error}</div> : null}

      <button
        className="primary punch-button"
        disabled={!settings.enabled || !!busy}
        onClick={() => punch(next)}
      >
        {busy || (next === 'in' ? 'Punch IN' : 'Punch OUT')}
      </button>
      <p className="note" style={{ textAlign: 'center' }}>
        {settings.requireLocation
          ? 'Your location is recorded with each punch.'
          : 'Location is recorded when you allow it.'}
      </p>

      <section>
        <h3>Today</h3>
        {punches.length ? (
          <ul className="jobs">
            {punches
              .slice()
              .reverse()
              .map((p) => (
                <li key={p.id}>
                  <strong>{p.kind === 'in' ? 'In' : 'Out'}</strong> at {clock(p.at)}
                  <div className="muted small">{p.note}</div>
                </li>
              ))}
          </ul>
        ) : (
          <p className="note">Nothing punched yet today.</p>
        )}
      </section>

      <section>
        <div className="row">
          <h3 style={{ margin: 0 }}>Leave, or something wrong with a day</h3>
          <span className="spacer" />
          <button onClick={() => setAsking((v) => !v)}>{asking ? 'Cancel' : 'Ask the office'}</button>
        </div>

        {asking ? (
          <RequestForm
            token={token}
            periods={periods}
            onDone={async () => {
              setAsking(false);
              setSaid('Sent to the office. Nothing changes until they approve it.');
              await load();
            }}
            onError={setError}
          />
        ) : null}

        {requests.length ? (
          <ul className="jobs">
            {requests.map((r) => (
              <li key={r.id}>
                <strong>{kindLabel(r.kind)}</strong> ·{' '}
                {r.to_day && r.to_day > r.day ? `days ${r.day}\u2013${r.to_day}` : `day ${r.day}`} of{' '}
                {r.period_label}
                <div className="muted small">
                  {r.reason} — <strong>{r.status}</strong>
                  {r.decision_note ? ` · ${r.decision_note}` : ''}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="note">Nothing asked for yet.</p>
        )}
      </section>

      <MyTasks token={token} tasks={tasks} onDone={load} onError={setError} />

      <section>
        <div className="row">
          <h3 style={{ margin: 0 }}>Ask the office something</h3>
          <span className="spacer" />
          <button onClick={() => setRaising((v) => !v)}>{raising ? 'Cancel' : 'New question'}</button>
        </div>

        {raising ? (
          <TicketForm
            token={token}
            categories={data.ticket_categories || []}
            onDone={async () => {
              setRaising(false);
              setSaid('Sent to the office.');
              await load();
            }}
            onError={setError}
          />
        ) : null}

        {tickets.length ? (
          <ul className="jobs">
            {tickets.map((t) => (
              <li key={t.id}>
                <strong>{t.subject}</strong>
                <div className="muted small">
                  {t.category} — <strong>{t.status}</strong>
                  {t.replies ? ` · ${t.replies} ${t.replies === 1 ? 'reply' : 'replies'}` : ''}
                </div>
                <Thread token={token} id={t.id} onDone={load} onError={setError} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="note">Nothing asked yet.</p>
        )}
      </section>
    </div>
  );
}

/** Work the office has given them. They can tick it off; they cannot drop it. */
function MyTasks({ token, tasks, onDone, onError }) {
  const [busy, setBusy] = useState(0);
  const open = tasks.filter((t) => t.status === 'open');
  if (!tasks.length) return null;

  const set = async (task, status) => {
    setBusy(task.id);
    try {
      const res = await fetch(`/api/punch/${token}/tasks/${task.id}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Could not save that');
      await onDone();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(0);
    }
  };

  return (
    <section>
      <h3>Your jobs {open.length ? `(${open.length})` : ''}</h3>
      <ul className="jobs">
        {tasks.map((task) => (
          <li key={task.id}>
            <strong>{task.title}</strong>
            <div className="muted small">
              {task.due_on ? `wanted by ${task.due_on}` : 'no date'}
              {task.overdue ? ' · overdue' : ''}
              {task.priority === 'high' ? ' · urgent' : ''}
            </div>
            {task.detail ? <div className="muted small">{task.detail}</div> : null}
            <button disabled={busy === task.id} onClick={() => set(task, task.status === 'open' ? 'done' : 'open')}>
              {task.status === 'open' ? 'Mark done' : 'Not done after all'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One question, its answers, and a box to say more. */
function Thread({ token, id, onDone, onError }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [said, setSaid] = useState('');

  const load = async () => {
    try {
      const res = await fetch(`/api/punch/${token}/tickets/${id}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Could not open that');
      setDetail(body);
    } catch (err) {
      onError(err.message);
    }
  };

  const show = async () => {
    setOpen(true);
    await load();
  };

  const send = async () => {
    if (!said.trim()) return;
    try {
      const res = await fetch(`/api/punch/${token}/tickets/${id}/reply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: said }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Could not send that');
      setDetail(body);
      setSaid('');
      await onDone();
    } catch (err) {
      onError(err.message);
    }
  };

  if (!open) {
    return (
      <button onClick={show} style={{ marginTop: '0.3rem' }}>
        Open
      </button>
    );
  }

  return (
    <div style={{ marginTop: '0.4rem' }}>
      {detail?.detail ? <p className="note">{detail.detail}</p> : null}
      {(detail?.replies || []).map((r) => (
        <p key={r.id} className="note">
          <strong>{r.side === 'office' ? 'Office' : 'You'}:</strong> {r.body}
        </p>
      ))}
      {detail && detail.status !== 'closed' ? (
        <>
          <textarea rows={2} value={said} onChange={(e) => setSaid(e.target.value)} placeholder="Say more" />
          <button className="primary" onClick={send} disabled={!said.trim()}>
            Send
          </button>
        </>
      ) : (
        <p className="note">This one is closed.</p>
      )}
      <button onClick={() => setOpen(false)}>Hide</button>
    </div>
  );
}

function TicketForm({ token, categories, onDone, onError }) {
  const [form, setForm] = useState({ category: categories[0] || 'Other', subject: '', detail: '' });
  const [busy, setBusy] = useState(false);

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/punch/${token}/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Could not send that');
      onDone();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={send} style={{ marginTop: '0.8rem' }}>
      <label className="field">
        About
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="field wide">
        In a line
        <input
          required
          value={form.subject}
          placeholder="October PF looks higher than September"
          onChange={(e) => setForm({ ...form, subject: e.target.value })}
        />
      </label>
      <label className="field wide">
        Anything more
        <textarea rows={2} value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} />
      </label>
      <div className="wide">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  );
}

function RequestForm({ token, periods, onDone, onError }) {
  const [form, setForm] = useState({
    kind: 'missing_punch',
    period_id: periods[0]?.id || '',
    day: '',
    to_day: '',
    in_time: '',
    out_time: '',
    code: '',
    reason: '',
  });
  const [busy, setBusy] = useState(false);
  const needs = REQUEST_KINDS.find((k) => k.key === form.kind)?.needs || 'both';

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/punch/${token}/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          period_id: Number(form.period_id),
          day: Number(form.day),
          to_day: form.to_day === '' ? null : Number(form.to_day),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Could not send that');
      onDone();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={send} style={{ marginTop: '0.8rem' }}>
      <label className="field">
        What you need
        <select
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value, to_day: '' })}
        >
          {REQUEST_KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label} — {k.hint}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Month
        <select value={form.period_id} onChange={(e) => setForm({ ...form, period_id: e.target.value })}>
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        {spans(form.kind) ? 'From day' : 'Day'}
        <input
          type="number"
          min="1"
          max="31"
          required
          value={form.day}
          onChange={(e) => setForm({ ...form, day: e.target.value })}
        />
      </label>

      {/* A fortnight off is one request, not fourteen. */}
      {spans(form.kind) ? (
        <label className="field">
          To day
          <input
            type="number"
            min="1"
            max="31"
            placeholder="same day"
            value={form.to_day}
            onChange={(e) => setForm({ ...form, to_day: e.target.value })}
          />
        </label>
      ) : null}

      {needs === 'times' || needs === 'both' ? (
        <>
          <label className="field">
            In at
            <input placeholder="09:30" value={form.in_time} onChange={(e) => setForm({ ...form, in_time: e.target.value })} />
          </label>
          <label className="field">
            Out at
            <input placeholder="18:30" value={form.out_time} onChange={(e) => setForm({ ...form, out_time: e.target.value })} />
          </label>
        </>
      ) : null}

      {needs === 'mark' || needs === 'both' ? (
        <label className="field">
          The day should be
          <select value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}>
            <option value="">Choose…</option>
            {Object.entries(ATTENDANCE_CODES).map(([code, meta]) => (
              <option key={code} value={code}>
                {meta.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="field wide">
        Why
        <textarea
          required
          rows={2}
          value={form.reason}
          placeholder="The machine did not read my finger"
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
      </label>
      <div className="wide">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send to the office'}
        </button>
      </div>
      <p className="note wide">
        Nothing on your attendance changes until the office approves it.
      </p>
    </form>
  );
}
