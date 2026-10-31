export default function Reports({ overview, config, onExport }) {
  return (
    <>
      <div className="card">
        <h2>Exports</h2>
        <p className="muted small">
          CSVs open in Excel. The candidate export says whether a CV is on file; it never
          carries the CV itself, because a spreadsheet of strangers&apos; résumés is exactly
          the file that gets forwarded by mistake.
        </p>
        <div className="row">
          <button onClick={() => onExport('pipeline')}>Pipeline</button>
          <button onClick={() => onExport('candidates')}>Candidates</button>
          <button onClick={() => onExport('placements')}>Placements</button>
        </div>
      </div>

      <div className="card">
        <h2>How this is set up</h2>
        <div className="lines">
          <div>
            <span className="what">Apply link</span>
            <span className="small">
              {config?.public_url ? config.public_url : <span className="muted">PUBLIC_URL not set</span>}
            </span>
          </div>
          <div>
            <span className="what">Password on the recruiter side</span>
            <span className="small">
              {config?.auth_required ? 'on' : <span style={{ color: 'var(--bad)' }}>OFF — anyone can open this</span>}
            </span>
          </div>
          <div>
            <span className="what">Test system</span>
            <span className="small">
              {config?.test_configured
                ? `linked, pass mark ${config.test_pass_percent}%`
                : 'not linked (TEST_EMBED_URL)'}
            </span>
          </div>
          <div>
            <span className="what">Fee</span>
            <span className="small">
              {config?.fee?.percent}% of{' '}
              {config?.fee?.basis === 'monthly' ? "one month's salary" : 'annual CTC'} + {config?.fee?.gst_percent}% GST
            </span>
          </div>
          <div>
            <span className="what">Replacement window</span>
            <span className="small">{config?.fee?.replacement_days} days</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>How the matching is weighted</h2>
        <div className="lines">
          {Object.entries(config?.weights || {}).map(([name, weight]) => (
            <div key={name}>
              <span className="what">{name}</span>
              <span className="num">{weight}</span>
            </div>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: '0.5rem' }}>
          The score orders a queue. It never shortlists or rejects anybody — every move in the
          pipeline is somebody choosing it.
        </p>
      </div>

      {overview ? (
        <div className="card">
          <h2>Totals</h2>
          <div className="figures">
            <Fig n={overview.vacancies.total} k="Vacancies" />
            <Fig n={overview.candidates.total} k="Candidates" />
            <Fig n={overview.candidates.withResume} k="With a CV" />
            <Fig n={overview.applications.total} k="Applications" />
            <Fig n={overview.applications.rejected} k="Rejected" />
            <Fig n={overview.placements.total} k="Placements" />
          </div>
        </div>
      ) : null}
    </>
  );
}

function Fig({ n, k }) {
  return (
    <div className="figure">
      <span className="n">{n}</span>
      <span className="k">{k}</span>
    </div>
  );
}
