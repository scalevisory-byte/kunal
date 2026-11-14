import { useState } from 'react';
import { api } from '../../api.js';

export default function Interviews({ interviews, onOpen, onForm, onEvaluate, onReload, onError, onToast }) {
  const [link, setLink] = useState(null);

  /*
   * The link the candidate fills the form in from.
   *
   * It lives on this row because this is where somebody is looking when they
   * are about to interview that person - the same reason the two form buttons
   * are here. The server makes the form row if there is none, so there is no
   * order to remember.
   */
  const sendLink = async (id) => {
    try {
      const made = await api.post(`/hiring/interviews/${id}/candidate-link`, {});
      const full = made.link.startsWith('http')
        ? made.link
        : `${window.location.origin}${made.link}`;
      setLink({ ...made, full });
      onToast?.('Link ready — send it to them on WhatsApp');
    } catch (err) {
      onError(err);
    }
  };

  const drop = async (id) => {
    if (!window.confirm('Delete this interview? This cannot be undone.')) return;
    try {
      await api.del(`/hiring/interviews/${id}`);
      onToast?.('Interview deleted');
      onReload();
    } catch (err) {
      onError(err);
    }
  };

  const set = async (id, body) => {
    try {
      await api.patch(`/hiring/interviews/${id}`, body);
      onReload();
    } catch (err) {
      onError(err);
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="card scroll">
      <h2>Interviews</h2>
      <table className="sheet hiring-table">
        <thead>
          <tr>
            <th>When</th>
            <th className="grow">Candidate</th>
            <th>Job</th>
            <th>Mode</th>
            <th>Where / link</th>
            <th>Round</th>
            <th>Interviewer</th>
            <th>Status</th>
            {/*
              * The way in to both forms.
              *
              * Sixth and seventh time this lesson has been learnt here: a form
              * reachable only from somewhere nobody is standing is a form that
              * does not exist. Somebody about to interview is looking at this
              * list, so the two things they do are on the row.
              */}
            <th>Interview record</th>
          </tr>
        </thead>
        <tbody>
          {interviews.map((i) => (
            <tr key={i.id}>
              <td className="num small">
                {String(i.at).replace('T', ' ').slice(0, 16)}
                {String(i.at).slice(0, 10) === today ? (
                  <span className="tag published" style={{ marginLeft: '0.3rem' }}>
                    today
                  </span>
                ) : null}
              </td>
              <td className="name-cell">
                <button onClick={() => onOpen(i.application_id)}>{i.candidate_name}</button>
              </td>
              <td className="small">{i.job_title}</td>
              <td className="small">{i.mode}</td>
              <td className="small">{i.location_or_link || '—'}</td>
              <td className="num">
                {i.round}
                {i.round_name ? <div className="muted small">{i.round_name}</div> : null}
              </td>
              <td className="small">{i.interviewer || '—'}</td>
              <td>
                <select value={i.status} onChange={(e) => set(i.id, { status: e.target.value })}>
                  {['Scheduled', 'Done', 'No show', 'Cancelled', 'Rescheduled'].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </td>
              <td className="row-actions">
                {/*
                  * The news goes on the button you press to SEE the form, not
                  * on the one that sends it. It was the other way round, so
                  * "They filled it ✓" replaced "Send form" - which hid the way
                  * to send it again and put the news where nobody would act
                  * on it.
                  */}
                <button
                  className={i.candidate_filled_at && i.form_status !== 'submitted' ? 'primary' : ''}
                  onClick={() => onForm(i.id)}
                  title={
                    i.candidate_filled_at
                      ? 'They filled this in — open it to read what they sent'
                      : 'Open the particulars form'
                  }
                >
                  {i.candidate_filled_at && i.form_status !== 'submitted'
                    ? 'Read what they sent'
                    : i.form_status === 'submitted'
                      ? 'Form ✓'
                      : i.form_status
                        ? 'Form…'
                        : 'Fill form'}
                </button>
                <button
                  onClick={() => sendLink(i.id)}
                  title={
                    i.candidate_sent_at
                      ? 'Send the link again — the same form, nothing is lost'
                      : 'Send them the form to fill in'
                  }
                >
                  {i.candidate_sent_at ? 'Send again' : 'Send form'}
                </button>
                <button
                  className="danger"
                  title="Delete this booking — a written-up interview is cancelled instead"
                  onClick={() => drop(i.id)}
                >
                  Delete
                </button>
                <button onClick={() => onEvaluate(i.id)}>
                  {i.evaluation_status === 'approved'
                    ? 'Evaluation ✓'
                    : i.evaluation_status
                      ? 'Evaluation…'
                      : 'Evaluate'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {link ? (
        <div className="card" style={{ marginTop: '0.6rem' }}>
          <h3>Form link for {link.candidate}</h3>
          <p className="muted small">
            Send this on WhatsApp. It opens one form — theirs — and it cannot show or change any
            decision. It works for a fortnight.
          </p>
          <div className="row">
            <input readOnly value={link.full} onFocus={(e) => e.target.select()} />
            <button onClick={() => navigator.clipboard?.writeText(link.full)}>Copy</button>
            <button onClick={() => setLink(null)}>Close</button>
          </div>
        </div>
      ) : null}

      {!interviews.length ? (
        <p className="empty">Nothing scheduled. Interviews are booked from a candidate&apos;s card.</p>
      ) : null}
    </div>
  );
}
