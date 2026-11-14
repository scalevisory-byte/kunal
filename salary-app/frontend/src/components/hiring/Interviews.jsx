import { api } from '../../api.js';

export default function Interviews({ interviews, onOpen, onForm, onEvaluate, onReload, onError }) {
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
                <button onClick={() => onForm(i.id)}>
                  {i.form_status === 'submitted' ? 'Form ✓' : i.form_status ? 'Form…' : 'Fill form'}
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
      {!interviews.length ? (
        <p className="empty">Nothing scheduled. Interviews are booked from a candidate&apos;s card.</p>
      ) : null}
    </div>
  );
}
