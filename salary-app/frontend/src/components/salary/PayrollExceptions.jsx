import { useMemo, useState } from 'react';
import { api } from '../../api.js';
import { rupees } from '../../format.js';
import { col, printReport } from '../../printReport.js';
import { SEVERITIES, severityLabel } from '../../../../shared/payrollExceptions.js';

/**
 * WHAT TO CHECK BEFORE THE MONTH IS PAID.
 *
 * The engine is in shared/payrollExceptions.js and it changes nothing: this
 * screen is the same - it can mark a flag **resolved** or **ignored** with a
 * reason, and that is the whole of what it writes. No button here edits a
 * salary.
 *
 * A FLAG IS A QUESTION. A net of nought is right for somebody who joined on
 * the 30th, and a director may well take no salary. So "ignored, because…"
 * is a first-class answer rather than something to be made to go away.
 *
 * FIVE AT A TIME. It used to list every flag on the month above the register,
 * so on a bad month the sheet - the thing the page is for - started below the
 * fold. Five is what somebody acts on this morning; the rest are behind
 * "View all", and the whole panel folds away.
 */
/*
 * `.pex-*` and not `.alerts` / `.alert`: the dashboard already owns those
 * class names, and reusing them restyled its list and stretched this one's
 * dot into an oval. The same trap the sign-in screen hit with `.login`.
 */
const STATES = [
  ['open', 'Open'],
  ['resolved', 'Resolved'],
  ['ignored', 'Ignored'],
];

/** Loudest first, so the five that show are the five that matter. */
const ORDER = { critical: 0, warning: 1, info: 2 };
const TOP = 5;

export default function PayrollExceptions({ period, review, onError, onChanged, onOpenEmployee }) {
  const [state, setState] = useState('open');
  const [level, setLevel] = useState('any');
  const [all, setAll] = useState(false);
  /*
   * null means "nobody has said". The panel then opens ONLY when something
   * is critical - on a clean month the register starts at the top of the
   * screen where it belongs, and on a bad month the thing to act on is in
   * sight. Once somebody folds or unfolds it themselves, their choice wins.
   */
  const [shut, setShut] = useState(null);
  const [busy, setBusy] = useState(false);

  const list = review?.exceptions || [];
  const summary = review?.summary;

  const shown = useMemo(() => {
    const matching = list.filter(
      (e) =>
        (state === 'any' || (e.state || 'open') === state) &&
        (level === 'any' || e.severity === level)
    );
    return [...matching].sort(
      (a, b) => (ORDER[a.severity] ?? 9) - (ORDER[b.severity] ?? 9) || String(a.name).localeCompare(String(b.name))
    );
  }, [list, state, level]);

  if (!review) return null;

  const folded = shut === null ? !summary?.critical : shut;
  const visible = all ? shown : shown.slice(0, TOP);
  const hidden = shown.length - visible.length;

  const note = async (entry, want) => {
    const remark = want === 'ignored'
      ? window.prompt(`Why is this being ignored?\n\n${entry.name}: ${entry.label}`)
      : entry.remark || '';
    if (want === 'ignored' && !String(remark || '').trim()) return;
    setBusy(true);
    try {
      await api.put(`/periods/${period.id}/review`, {
        employee_id: entry.employee_id, code: entry.code, state: want, remark,
      });
      onChanged?.();
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy(false);
    }
  };

  const printIt = () =>
    printReport({
      title: 'Salary exception report',
      subtitle: period.label,
      meta: [
        `${list.length} flag(s) · ${summary?.open ?? 0} open · ${summary?.critical ?? 0} critical, ${summary?.warning ?? 0} warning, ${summary?.info ?? 0} informational`,
        'Nothing here has been corrected — these are checks, not changes.',
      ],
      landscape: true,
      columns: [
        col('#', (_e, i) => i + 1, '3%'),
        col('Level', (e) => severityLabel(e.severity)),
        col('Employee', (e) => e.name || '(the month)'),
        col('Company', (e) => e.company),
        col('Issue', (e) => e.label),
        col('What to check', (e) => e.detail),
        col('Amount', (e) => (e.amount === null ? '' : rupees(e.amount))),
        col('State', (e) => e.state),
        col('Reviewed by', (e) => e.reviewed_by || ''),
        col('Remark', (e) => e.remark || ''),
      ],
      rows: shown,
      empty: 'Nothing flagged.',
      footer:
        'Every line is a question about a figure, not a correction to it. Only a Critical flag holds the payroll up, and even that can be approved over with a reason.',
    });

  return (
    <div className="card pex-card">
      <div className="row">
        <button className="pex-fold" onClick={() => setShut(!folded)} aria-expanded={!folded}>
          <span className={`pex-caret ${folded ? '' : 'open'}`}>›</span>
          <h3>Things to check</h3>
        </button>
        {/*
          * THE THREE COUNTS ADD UP TO WHAT IS OPEN. They did not before:
          * "4 Critical" sat over a list naming two people, because one
          * problem was being reported twice and the third level was never
          * counted at all.
          */}
        {summary?.critical > 0 && <span className="pill bad">{summary.critical} critical</span>}
        {summary?.warning > 0 && <span className="pill warn">{summary.warning} warning</span>}
        {summary?.info > 0 && <span className="pill">{summary.info} info</span>}
        {!summary?.open && <span className="pill ok">nothing open</span>}
        <span className="grow" />
        <button className="ghost" onClick={printIt} disabled={!shown.length}>Print</button>
      </div>

      {folded ? (
        <p className="muted small">
          {summary?.open
            ? `${summary.open} open — ${summary.critical} critical, ${summary.warning} warning, ${summary.info} informational.`
            : 'Nothing open on this month.'}
        </p>
      ) : (
        <>
          <div className="toolbar pex-filters">
            <div className="chips">
              {[['any', 'All levels'], ...SEVERITIES.map(([k, l]) => [k, l])].map(([key, label]) => (
                <button
                  key={key}
                  className={`chip ${level === key ? 'active' : ''}`}
                  onClick={() => { setLevel(key); setAll(false); }}
                >
                  {label}
                  {key === 'any' ? '' : ` (${list.filter((e) => e.severity === key && (e.state || 'open') === 'open').length})`}
                </button>
              ))}
            </div>
            <span className="grow" />
            <div className="chips">
              {[...STATES, ['any', 'All']].map(([key, label]) => (
                <button
                  key={key}
                  className={`chip ${state === key ? 'active' : ''}`}
                  onClick={() => { setState(key); setAll(false); }}
                >
                  {label}
                  {key === 'any' ? '' : ` (${list.filter((e) => (e.state || 'open') === key).length})`}
                </button>
              ))}
            </div>
          </div>

          {visible.length ? (
            <ul className="pex-list">
              {visible.map((e) => (
                <li key={`${e.employee_id ?? 'month'}-${e.code}`} className={`pex ${e.severity}`}>
                  <span className="pex-dot" title={severityLabel(e.severity)}>
                    {e.severity === 'critical' ? '!' : e.severity === 'warning' ? '•' : 'i'}
                  </span>
                  <span className="pex-text">
                    {/* A month-level line belongs to nobody, so there is no
                        name to click - and a button that opens nothing is
                        worse than no button. */}
                    {e.employee_id ? (
                      <>
                        <button className="link" onClick={() => onOpenEmployee?.(e.employee_id)}>
                          {e.name}
                        </button>{' '}
                        :{' '}
                      </>
                    ) : null}
                    {e.label}. {e.detail}
                    {e.amount ? ` (${rupees(e.amount)})` : ''}
                    {e.state !== 'open' && (
                      <em className="muted small">
                        {' '}— {e.state}{e.reviewed_by ? ` by ${e.reviewed_by}` : ''}
                        {e.remark ? `: ${e.remark}` : ''}
                      </em>
                    )}
                  </span>
                  <span className="pex-do">
                    {e.employee_id ? (
                      <>
                        {e.state !== 'resolved' && (
                          <button className="tiny" disabled={busy} onClick={() => note(e, 'resolved')}>
                            Resolved
                          </button>
                        )}{' '}
                        {e.state !== 'ignored' && (
                          <button className="tiny" disabled={busy} onClick={() => note(e, 'ignored')}>
                            Ignore…
                          </button>
                        )}{' '}
                        {e.state !== 'open' && (
                          <button className="tiny ghost" disabled={busy} onClick={() => note(e, 'open')}>
                            Reopen
                          </button>
                        )}
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty fo-empty">
              {state === 'open' ? 'Nothing open — the month looks clean.' : 'Nothing here.'}
            </p>
          )}

          {hidden > 0 && (
            <button className="ghost pex-more" onClick={() => setAll(true)}>
              View all {shown.length} ({hidden} more)
            </button>
          )}
          {all && shown.length > TOP && (
            <button className="ghost pex-more" onClick={() => setAll(false)}>
              Show the top {TOP} only
            </button>
          )}

          <p className="muted small">
            These are checks, not corrections: <strong>nothing on this screen changes a salary</strong>.
            Only a <strong>Critical</strong> flag holds the month up; a warning is worth a look and an
            informational line is a status. Ignoring one keeps it on the record with your reason.
          </p>
        </>
      )}
    </div>
  );
}
