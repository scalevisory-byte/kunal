import { aging } from '../../../../shared/stages.js';

/**
 * What needs doing, before what has been done. There is no money on this page:
 * the cost of a hire shows up on the salary sheet, where it belongs.
 */
export default function HiringOverview({ data, onGo, onOpenApplication }) {
  if (!data) return <p className="loading">Loading…</p>;

  const { vacancies, candidates, applications, interviews, tasks, hires } = data;
  const stale = (data.recent || []).filter((a) => aging(a.stage_changed_at).tone === 'stale');

  const alerts = [
    hires.awaitingPayroll && {
      text: `${hires.awaitingPayroll} selected but not on the payroll yet`,
      why: 'they will be missing from this month’s salary sheet',
      go: 'pipeline',
    },
    tasks.overdue && { text: `${tasks.overdue} follow-up${tasks.overdue === 1 ? '' : 's'} overdue`, go: 'tasks' },
    stale.length && {
      text: `${stale.length} candidate${stale.length === 1 ? '' : 's'} sitting more than a week in one stage`,
      who: stale.slice(0, 4).map((a) => a.candidate_name).join(', '),
      go: 'pipeline',
    },
    vacancies.draft && {
      text: `${vacancies.draft} opening${vacancies.draft === 1 ? '' : 's'} still a draft — nobody can apply`,
      go: 'openings',
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
                  {a.why ? <span className="muted small"> — {a.why}</span> : null}
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
          <Figure n={vacancies.unfilled} k="Seats to fill" onClick={() => onGo('openings')} />
          <Figure n={interviews.upcoming} k="Interviews coming up" onClick={() => onGo('interviews')} />
          <Figure n={tasks.open} k="Open follow-ups" onClick={() => onGo('tasks')} />
          <Figure n={applications.thisWeek} k="Applications this week" onClick={() => onGo('pipeline')} />
          <Figure n={hires.thisMonth} k="Joined this month" onClick={() => onGo('pipeline')} />
        </div>
      </div>

      <div className="cards">
        <div className="card">
          <h2>The pipeline</h2>
          {Object.entries(applications.byStage).length ? (
            <div className="lines">
              {Object.entries(applications.byStage).map(([stage, n]) => (
                <div key={stage}>
                  <span className="what">{stage}</span>
                  <span className="num">{n}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small">Nobody in the pipeline yet.</p>
          )}
          <p className="small muted" style={{ marginTop: '0.6rem' }}>
            {applications.total} applications in all, {candidates.total} people on file
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
            <p className="muted small">
              Nothing yet. Publish an opening and share the link, or add somebody by hand.
            </p>
          )}
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
