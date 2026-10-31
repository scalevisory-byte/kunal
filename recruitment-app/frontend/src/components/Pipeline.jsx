import { useMemo, useState } from 'react';
import { MATCH_BANDS, REJECTED, STAGES, aging, matchBand } from '../../../shared/stages.js';

/**
 * Step 6. The board is the default because a pipeline is a thing you look at
 * sideways; the table is there for when there are too many people for that.
 *
 * Dragging a card is a recruiter moving somebody. There is no rule in here that
 * moves a card on its own, and there never will be.
 */
export default function Pipeline({ applications, vacancies, onMove, onOpen, onExport }) {
  const [view, setView] = useState('board');
  const [vacancyId, setVacancyId] = useState('');
  const [band, setBand] = useState('');
  const [q, setQ] = useState('');
  const [over, setOver] = useState('');
  const [dragging, setDragging] = useState(null);

  const rows = useMemo(
    () =>
      applications.filter((a) => {
        if (vacancyId && String(a.vacancy_id) !== String(vacancyId)) return false;
        if (band && matchBand(a.match_score) !== band) return false;
        if (q) {
          const hay = `${a.candidate_name} ${a.phone} ${a.job_title} ${a.skills || ''}`.toLowerCase();
          if (!hay.includes(q.toLowerCase())) return false;
        }
        return true;
      }),
    [applications, vacancyId, band, q]
  );

  const columns = [...STAGES, { key: REJECTED, label: 'Rejected', hint: 'A recruiter decided no' }];
  const byStage = (stage) => rows.filter((a) => a.stage === stage);

  return (
    <>
      <div className="row" style={{ marginBottom: '0.8rem' }}>
        <select value={vacancyId} onChange={(e) => setVacancyId(e.target.value)}>
          <option value="">Every vacancy</option>
          {vacancies.map((v) => (
            <option key={v.id} value={v.id}>
              {v.ref_no} — {v.title}
            </option>
          ))}
        </select>
        <div className="chips">
          <button className={`chip ${band === '' ? 'on' : ''}`} onClick={() => setBand('')}>
            Any match
          </button>
          {MATCH_BANDS.map((b) => (
            <button
              key={b.key}
              className={`chip ${band === b.key ? 'on' : ''}`}
              onClick={() => setBand(b.key)}
            >
              {b.label} {b.min ? `${b.min}%+` : ''}
            </button>
          ))}
        </div>
        <input value={q} placeholder="Find somebody…" onChange={(e) => setQ(e.target.value)} />
        <span className="spacer" />
        <span className="muted small">{rows.length} shown</span>
        <button onClick={() => setView(view === 'board' ? 'table' : 'board')}>
          {view === 'board' ? 'As a list' : 'As a board'}
        </button>
        <button onClick={onExport}>Export CSV</button>
      </div>

      {view === 'board' ? (
        <div className="board">
          {columns.map((col) => {
            const cards = byStage(col.key);
            return (
              <div
                key={col.key}
                className={`column ${over === col.key ? 'over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(col.key);
                }}
                onDragLeave={() => setOver((c) => (c === col.key ? '' : c))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver('');
                  const id = Number(e.dataTransfer.getData('text/plain')) || dragging;
                  if (id) onMove(id, col.key);
                }}
              >
                <header>
                  <span className="t">{col.label}</span>
                  <span className="n">{cards.length}</span>
                </header>
                <div className="stack">
                  {cards.map((a) => {
                    const age = aging(a.stage_changed_at);
                    return (
                      <div
                        key={a.id}
                        className="pcard"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', String(a.id));
                          setDragging(a.id);
                        }}
                        onDragEnd={() => setDragging(null)}
                        onClick={() => onOpen(a.id)}
                      >
                        <div className="who">
                          <span>{a.candidate_name}</span>
                          <span className={`band ${matchBand(a.match_score)}`}>{a.match_score}%</span>
                        </div>
                        <div className="job">{a.job_title}</div>
                        <div className="meta">
                          <span className={`age ${age.tone}`}>{age.label}</span>
                          {a.test_score != null ? <span>test {a.test_score}%</span> : null}
                          {!a.resume_path ? <span style={{ color: 'var(--warn)' }}>no CV</span> : null}
                        </div>
                      </div>
                    );
                  })}
                  {!cards.length ? <p className="hint">Drag somebody here.</p> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card scroll">
          <table>
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Job</th>
                <th className="num">Match</th>
                <th className="num">Test</th>
                <th>Stage</th>
                <th>Waiting</th>
                <th>Move to</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const age = aging(a.stage_changed_at);
                return (
                  <tr key={a.id}>
                    <td className="name-cell">
                      <button onClick={() => onOpen(a.id)}>{a.candidate_name}</button>
                      <div className="muted small">{a.phone}</div>
                    </td>
                    <td className="small">
                      {a.job_title}
                      <div className="muted small">{a.vacancy_ref}</div>
                    </td>
                    <td className={`num band ${matchBand(a.match_score)}`}>{a.match_score}%</td>
                    <td className="num">{a.test_score == null ? '—' : `${a.test_score}%`}</td>
                    <td className="small">{a.stage}</td>
                    <td className={`small age ${age.tone}`}>{age.label}</td>
                    <td>
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value) onMove(a.id, e.target.value);
                        }}
                      >
                        <option value="">…</option>
                        {columns
                          .filter((c) => c.key !== a.stage)
                          .map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.label}
                            </option>
                          ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length ? <p className="empty">Nobody matches that.</p> : null}
        </div>
      )}
    </>
  );
}
