import { useState } from 'react';
import { api } from '../../api.js';
import { rupees } from '../../format.js';
import { col, printReport } from '../../printReport.js';

/**
 * WHAT TO CHECK BEFORE THE MONTH IS PAID.
 *
 * The engine is in shared/payrollExceptions.js and it changes nothing: this
 * screen is the same — it can mark a flag **resolved** or **ignored** with a
 * reason, and that is the whole of what it writes. No button here edits a
 * salary.
 *
 * A FLAG IS A QUESTION. A net of nought is right for somebody who joined on
 * the 30th, and a director may well take no salary. So "ignored, because…"
 * is a first-class answer rather than something to be made to go away.
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

export default function PayrollExceptions({ period, review, onError, onChanged, onOpenEmployee }) {
  const [bucket, setBucket] = useState('open');
  const [busy, setBusy] = useState(false);
  if (!review) return null;

  const all = review.exceptions || [];
  const shown = bucket === 'all' ? all : all.filter((e) => (e.state || 'open') === bucket);

  const note = async (entry, state) => {
    const remark = state === 'ignored'
      ? window.prompt(`Why is this being ignored?\n\n${entry.name}: ${entry.label}`)
      : entry.remark || '';
    if (state === 'ignored' && !String(remark || '').trim()) return;
    setBusy(true);
    try {
      await api.put(`/periods/${period.id}/review`, {
        employee_id: entry.employee_id, code: entry.code, state, remark,
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
        `${all.length} flag(s) · ${review.summary?.open ?? 0} open`,
        'Nothing here has been corrected — these are checks, not changes.',
      ],
      landscape: true,
      columns: [
        col('#', (_e, i) => i + 1, '3%'),
        col('Employee', (e) => e.name),
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
        'Every line is a question about a figure, not a correction to it. A flag can be ignored with a reason — a nought is right for somebody who joined on the 30th.',
    });

  return (
    <div className="card">
      <div className="row">
        <h3>Important alerts</h3>
        {review.summary?.bad > 0 && <span className="pill bad">{review.summary.bad} serious</span>}
        <span className="grow" />
        <div className="chips">
          {[...STATES, ['all', 'All']].map(([key, label]) => (
            <button
              key={key}
              className={`chip ${bucket === key ? 'active' : ''}`}
              onClick={() => setBucket(key)}
            >
              {label}
              {key !== 'all' ? ` (${all.filter((e) => (e.state || 'open') === key).length})` : ''}
            </button>
          ))}
        </div>
        <button className="ghost" onClick={printIt} disabled={!shown.length}>Print</button>
      </div>

      {shown.length ? (
        <ul className="pex-list">
          {shown.map((e) => (
            <li key={`${e.employee_id}-${e.code}`} className={`pex ${e.severity}`}>
              <span className="pex-dot">!</span>
              <span className="pex-text">
                <button className="link" onClick={() => onOpenEmployee?.(e.employee_id)}>
                  {e.name}
                </button>{' '}
                : {e.label}. {e.detail}
                {e.amount ? ` (${rupees(e.amount)})` : ''}
                {e.state !== 'open' && (
                  <em className="muted small">
                    {' '}— {e.state}{e.reviewed_by ? ` by ${e.reviewed_by}` : ''}
                    {e.remark ? `: ${e.remark}` : ''}
                  </em>
                )}
              </span>
              <span className="pex-do">
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
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty fo-empty">
          {bucket === 'open' ? 'Nothing open — the month looks clean.' : 'Nothing here.'}
        </p>
      )}

      <p className="muted small">
        These are checks, not corrections: <strong>nothing on this screen changes a salary</strong>.
        Ignoring a flag keeps it on the record with your reason.
      </p>
    </div>
  );
}
