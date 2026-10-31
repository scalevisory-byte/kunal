import { api } from '../../api.js';

export default function Interviews({ interviews, onOpen, onReload, onError }) {
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
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Candidate</th>
            <th>Job</th>
            <th>Mode</th>
            <th>Where / link</th>
            <th>Round</th>
            <th>Status</th>
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
              <td className="num">{i.round}</td>
              <td>
                <select value={i.status} onChange={(e) => set(i.id, { status: e.target.value })}>
                  {['Scheduled', 'Done', 'No show', 'Cancelled', 'Rescheduled'].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
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
