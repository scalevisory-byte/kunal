import { useEffect, useState } from 'react';
import { api, download } from '../../api.js';

/**
 * EVERY RESULT, IN ONE PLACE.
 *
 * Dinesh, looking straight at a finished test on the screening queue:
 * *"result kahan dikhayega bhai"*. It was there — one line under his own
 * name, which is the right place while you are working that one opening and
 * the wrong place for the question he was actually asking.
 *
 * The queue is a list of PEOPLE still being hired, carrying their latest
 * attempt. So somebody's older paper is missing from it, and anybody who has
 * since been rejected or joined takes their result off the screen with them.
 * A score that disappears because the person moved on is not a record. This
 * is the record: every submitted paper, newest first, whoever they are.
 *
 * Nothing here decides anything. A score orders a list and a flag is a reason
 * to ring somebody back — neither moves a candidate a single stage.
 */

const VERDICTS = [
  ['all', 'All'],
  ['passed', 'Qualified'],
  ['failed', 'Not qualified'],
  ['flagged', 'Flagged'],
  ['clean', 'Clean'],
];

const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? String(iso).slice(0, 16).replace('T', ' ')
    : d.toLocaleString(undefined, {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
};

export default function TestResults({ companyId, onSheet, onError }) {
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ total: 0, passed: 0, failed: 0, flagged: 0 });
  const [papers, setPapers] = useState([]);
  const [q, setQ] = useState('');
  const [paperId, setPaperId] = useState('');
  const [verdict, setVerdict] = useState('all');
  const [loaded, setLoaded] = useState(false);

  const query = () => {
    const bits = [];
    if (companyId) bits.push(`company_id=${companyId}`);
    if (paperId) bits.push(`paper_id=${paperId}`);
    if (q.trim()) bits.push(`q=${encodeURIComponent(q.trim())}`);
    if (verdict !== 'all') bits.push(`verdict=${verdict}`);
    return bits.length ? `?${bits.join('&')}` : '';
  };

  const load = async () => {
    try {
      const [res, { papers: ps }] = await Promise.all([
        api.get(`/hiring/test-results${query()}`),
        api.get('/hiring/papers'),
      ]);
      setRows(res.results || []);
      setCounts(res.counts || { total: 0, passed: 0, failed: 0, flagged: 0 });
      setPapers(ps || []);
      setLoaded(true);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, paperId, verdict]);

  // The search waits for them to stop typing, so eight letters are not eight
  // requests. Everything else reloads the moment it is pressed.
  useEffect(() => {
    if (!loaded) return undefined;
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="card">
      <div className="row">
        <h3 style={{ margin: 0 }}>Test results</h3>
        <span className="spacer" />
        {/* Through `download`, not a bare href: every /api call carries the
            session, and an anchor straight at the route would download the
            sign-in page instead of the results. */}
        <button
          onClick={() =>
            download(`/hiring/export/test-results.csv${query()}`, 'Test-results.csv').catch(onError)
          }
        >
          Export CSV
        </button>
      </div>
      <p className="muted small">
        Every paper anybody has sat, newest first — including people who have since been taken on
        or turned down. A score is one more thing to weigh; it moves nobody.
      </p>

      <div className="row wrap" style={{ gap: '0.5rem', margin: '0.6rem 0' }}>
        <input
          style={{ width: '14rem' }}
          placeholder="Name, mobile, job or test…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={paperId} onChange={(e) => setPaperId(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Every test</option>
          {papers.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {VERDICTS.map(([key, label]) => (
          <button
            key={key}
            className={verdict === key ? 'primary tiny' : 'tiny'}
            onClick={() => setVerdict(key)}
          >
            {label}
            {key === 'passed' ? ` (${counts.passed})`
              : key === 'failed' ? ` (${counts.failed})`
              : key === 'flagged' ? ` (${counts.flagged})`
              : key === 'all' ? ` (${counts.total})` : ''}
          </button>
        ))}
      </div>

      <p className="muted small">
        {counts.total} result{counts.total === 1 ? '' : 's'} · {counts.passed} qualified ·{' '}
        {counts.failed} not qualified · {counts.flagged} flagged
      </p>

      {!rows.length ? (
        <p className="muted small">
          {counts.total
            ? 'Nothing matches that.'
            : 'Nobody has sat a test yet. Draw a paper for somebody on the list above and send them the link.'}
        </p>
      ) : (
        <div className="scroll-x">
          <table className="sheet">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Applied for</th>
                <th>Test</th>
                <th className="num">Score</th>
                <th>Result</th>
                <th>Time</th>
                <th>Integrity</th>
                <th>Sat on</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.candidate_name}</strong>
                    <div className="muted small">{[r.ref_no, r.phone].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td>
                    {r.job_title || <span className="muted">on the list only</span>}
                    {r.company_name ? <div className="muted small">{r.company_name}</div> : null}
                  </td>
                  <td>{r.paper_name}</td>
                  <td className="num">
                    {r.right_count} / {r.asked}
                    <div className="muted small">{r.percentage}%</div>
                  </td>
                  <td className={r.passed ? 'ans-right' : 'ans-wrong'}>
                    {r.passed ? 'Qualified' : 'Not qualified'}
                  </td>
                  <td>
                    {r.minutes === null || r.minutes === undefined ? (
                      <span className="muted">—</span>
                    ) : (
                      <>
                        {r.minutes}m
                        {r.avg_seconds ? <div className="muted small">{r.avg_seconds}s / question</div> : null}
                      </>
                    )}
                  </td>
                  <td>
                    {/*
                      * "Clean" is said out loud, never left blank. A blank
                      * cell reads as "nobody has looked", which is the
                      * opposite of what it means — the same rule the uniform
                      * check and the stock take already follow.
                      */}
                    {r.flags.length ? (
                      <span className="ans-wrong">
                        {r.flags.map((f) => <div key={f}>⚠ {f}</div>)}
                      </span>
                    ) : (
                      <span className="muted">Clean</span>
                    )}
                  </td>
                  <td>{when(r.submitted_at)}</td>
                  <td>
                    <button className="tiny" onClick={() => onSheet(r.id)}>Answer sheet</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
