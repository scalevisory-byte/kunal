import { aging } from '../../../shared/stages.js';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

/**
 * What needs doing, before what has been done. The money is at the bottom on
 * purpose: on any given morning the useful question is who is waiting on a
 * reply, not what the month has earned.
 */
export default function Overview({ data, onGo, onOpenApplication }) {
  if (!data) return <p className="loading">Loading…</p>;

  const { vacancies, candidates, applications, interviews, followups, placements } = data;
  const stale = (data.recent || []).filter((a) => aging(a.stage_changed_at).tone === 'stale');

  const alerts = [
    followups.overdue && {
      text: `${followups.overdue} follow-up${followups.overdue === 1 ? '' : 's'} overdue`,
      go: 'followups',
    },
    stale.length && {
      text: `${stale.length} candidate${stale.length === 1 ? '' : 's'} sitting more than a week in one stage`,
      go: 'pipeline',
      who: stale.slice(0, 4).map((a) => a.candidate_name).join(', '),
    },
    vacancies.draft && {
      text: `${vacancies.draft} vacanc${vacancies.draft === 1 ? 'y' : 'ies'} still a draft — nobody can apply`,
      go: 'vacancies',
    },
    candidates.total - candidates.withResume > 0 && {
      text: `${candidates.total - candidates.withResume} candidate${
        candidates.total - candidates.withResume === 1 ? '' : 's'
      } with no CV on file`,
      go: 'candidates',
    },
  ].filter(Boolean);

  return (
    <>
      {alerts.length ? (
        <div className="card">
          <h2>Needs attention</h2>
          <div className="lines">
            {alerts.map((a) => (
              <div key={a.text}>
                <span className="what">
                  {a.text}
                  {a.who ? <span className="muted small"> — {a.who}</span> : null}
                </span>
                <button className="link" onClick={() => onGo(a.go)}>
                  open
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="card">
        <h2>Today</h2>
        <div className="figures">
          <Figure n={interviews.upcoming} k="Interviews coming up" onClick={() => onGo('interviews')} />
          <Figure n={followups.open} k="Open follow-ups" onClick={() => onGo('followups')} />
          <Figure n={applications.thisWeek} k="New applications this week" onClick={() => onGo('pipeline')} />
          <Figure n={vacancies.open} k="Open vacancies" onClick={() => onGo('vacancies')} />
          <Figure n={vacancies.positions} k="Positions to fill" onClick={() => onGo('vacancies')} />
        </div>
      </div>

      <div className="cards">
        <div className="card">
          <h2>The pipeline</h2>
          <div className="lines">
            {Object.entries(applications.byStage).length === 0 ? (
              <p className="muted small">Nobody in the pipeline yet.</p>
            ) : (
              Object.entries(applications.byStage).map(([stage, n]) => (
                <div key={stage}>
                  <span className="what">{stage}</span>
                  <span className="num">{n}</span>
                </div>
              ))
            )}
          </div>
          <p className="small muted" style={{ marginTop: '0.6rem' }}>
            {applications.total} applications in all, {candidates.total} people on the books
            {candidates.addedThisWeek ? `, ${candidates.addedThisWeek} added this week` : ''}.
          </p>
        </div>

        <div className="card">
          <h2>Next up</h2>
          {data.upcoming?.length ? (
            <div className="lines">
              {data.upcoming.slice(0, 8).map((i) => (
                <div key={i.id}>
                  <span className="what">
                    {i.candidate_name} <span className="muted small">— {i.job_title}</span>
                  </span>
                  <span className="small num">{String(i.at).replace('T', ' ').slice(0, 16)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small">No interviews scheduled.</p>
          )}
        </div>

        <div className="card">
          <h2>Latest applications</h2>
          {data.recent?.length ? (
            <div className="lines">
              {data.recent.slice(0, 8).map((a) => {
                const age = aging(a.created_at);
                return (
                  <div key={a.id}>
                    <span className="what">
                      <button className="link" onClick={() => onOpenApplication(a.id)}>
                        {a.candidate_name}
                      </button>
                      <span className="muted small"> — {a.job_title}</span>
                    </span>
                    <span className={`small age ${age.tone}`}>{age.label}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted small">Nothing yet. Publish a vacancy and share the link.</p>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Placements</h2>
        <div className="figures">
          <Figure n={placements.total} k="Placed" onClick={() => onGo('placements')} />
          <Figure n={inr(placements.feeEarned)} k="Fee earned" onClick={() => onGo('placements')} />
          <Figure n={inr(placements.feeReceived)} k="Fee received" onClick={() => onGo('placements')} />
          <Figure
            n={inr(placements.feeEarned - placements.feeReceived)}
            k="Still to collect"
            onClick={() => onGo('placements')}
          />
        </div>
      </div>
    </>
  );
}

function Figure({ n, k, onClick }) {
  return (
    <div className="figure">
      {onClick ? (
        <button className="n" onClick={onClick}>
          {n}
        </button>
      ) : (
        <span className="n">{n}</span>
      )}
      <span className="k">{k}</span>
    </div>
  );
}
