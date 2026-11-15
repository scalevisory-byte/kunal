import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import ProcessSteps from './ProcessSteps.jsx';


/** The review statuses, in the office's words. */
const STATUS_LABEL = {
  submitted: 'with HR',
  pending_hr: 'with HR',
  pending_management: 'with management',
};

export default function Interviews({ interviews, onOpen, onForm, onEvaluate, onReload, onError, onToast, onGo}) {
  const [link, setLink] = useState(null);
  const [waiting, setWaiting] = useState([]);

  /*
   * Evaluations an interviewer has submitted and nobody has decided.
   *
   * Dinesh asked where a submitted evaluation goes. It went into the review
   * chain and nowhere on screen, so the only way to find one was to remember
   * which interview it was. This is the answer, on the tab where interviews
   * live.
   */
  useEffect(() => {
    api
      .get('/hiring/evaluations/waiting')
      .then(({ waiting: rows }) => setWaiting(rows || []))
      .catch(() => setWaiting([]));
  }, [interviews]);

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
    <>
      {/*
        * The process, on the tab where most of it happens. Dinesh asked for it
        * in simple steps - and each one names the tab and the click, because
        * "screen the candidate" is no use to somebody who cannot find the
        * button.
        */}
      <ProcessSteps onGo={onGo} />

      {waiting.length ? (
        <div className="card">
          <h2>Waiting for a decision</h2>
          <p className="muted small">
            Submitted by an interviewer and not decided yet. Approving is an Admin’s — and only an
            approval moves anybody.
          </p>
          <div className="lines">
            {waiting.map((w) => (
              <div key={w.id}>
                <span className="what">
                  <button className="opens" onClick={() => onEvaluate(w.interview_id)}>
                    {w.candidate_name}
                  </button>
                  <span className="muted small">
                    {' '}· {w.job_title} · round {w.round}
                    {w.evaluated_by ? ` · by ${w.evaluated_by}` : ''}
                  </span>
                  <div className="muted small">
                    {w.recommendation || 'no recommendation'}
                    {w.summary?.average !== null ? ` · average ${w.summary.average}` : ''}
                    {w.next_action ? ` · wants: ${w.next_action}` : ''}
                  </div>
                </span>
                <span className="tag">{STATUS_LABEL[w.status] || w.status}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

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
            <th>Interviewer / panel</th>
            <th>Status</th>
            {/*
              * The way in to both forms.
              *
              * Sixth and seventh time this lesson has been learnt here: a form
              * reachable only from somewhere nobody is standing is a form that
              * does not exist. Somebody about to interview is looking at this
              * list, so the two things they do are on the row.
              */}
            <th className="row-actions-head">Interview record</th>
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
              {/*
                * Interviewer AND panel, both typed here.
                *
                * `panel` has been a column since the table was made and
                * nothing ever wrote to it, so a three-person board was
                * recorded as one name. The lead goes in the first box and
                * everybody else in the second - two boxes rather than one
                * list, because the evaluation is signed by a person and the
                * panel is who else was in the room.
                *
                * Uncontrolled and keyed on the stored value, so a reload
                * under an open row redraws the box instead of leaving a
                * stale name showing.
                */}
              <td className="small">
                <input
                  className="who"
                  key={`iv-${i.id}-${i.interviewer ?? ''}`}
                  defaultValue={i.interviewer ?? ''}
                  placeholder="who is taking it"
                  onBlur={(e) =>
                    e.target.value !== (i.interviewer ?? '') &&
                    set(i.id, { interviewer: e.target.value })
                  }
                />
                <input
                  className="who"
                  key={`pn-${i.id}-${i.panel ?? ''}`}
                  defaultValue={i.panel ?? ''}
                  placeholder="others on the panel"
                  onBlur={(e) =>
                    e.target.value !== (i.panel ?? '') && set(i.id, { panel: e.target.value })
                  }
                />
              </td>
              <td>
                <select value={i.status} onChange={(e) => set(i.id, { status: e.target.value })}>
                  {['Scheduled', 'Done', 'No show', 'Cancelled', 'Rescheduled'].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </td>
              <td className="actions-cell">
                <div className="row-actions">
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
                  {/*
                    * Short, because four of these have to sit on one line. The
                    * dot is the news - they have sent theirs and nobody has
                    * read it - and the tooltip carries the sentence.
                    */}
                  {i.candidate_filled_at && i.form_status !== 'submitted'
                    ? 'Form ●'
                    : i.form_status === 'submitted'
                      ? 'Form ✓'
                      : 'Form'}
                </button>
                <button
                  onClick={() => sendLink(i.id)}
                  title={
                    i.candidate_sent_at
                      ? 'Send the link again — the same form, nothing is lost'
                      : 'Send them the form to fill in'
                  }
                >
                  {i.candidate_sent_at ? 'Sent' : 'Send'}
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
                </div>
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
    </>
  );
}