import { useState } from 'react';
import { api } from '../../api.js';

/**
 * WHERE THE MONTH HAS GOT TO.
 *
 * Five stages across the top of the sheet, from his brief. The first three
 * are OBSERVATIONS — is the attendance in, do the rows exist, are there open
 * exceptions — and they tick themselves because they are facts.
 *
 * THE LAST TWO ARE DECISIONS AND NOTHING TICKS THEM BY ITSELF. *"Do not mark
 * payroll as approved or locked automatically."* Approving carries a name
 * and a time; locking carries its own; reopening will not happen without a
 * reason, and the reason is kept.
 */
export default function PayrollWorkflow({ workflow, period, isAdmin, onError, onChanged }) {
  const [busy, setBusy] = useState(false);
  if (!workflow) return null;

  const run = async (what, body) => {
    setBusy(true);
    try {
      await what(body);
      onChanged?.();
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy(false);
    }
  };

  const approve = () =>
    run(() => api.post(`/periods/${period.id}/approve`, {}));

  const unapprove = () => {
    const reason = window.prompt('Why is the approval being taken back?');
    if (!reason?.trim()) return;
    run(() => api.del(`/periods/${period.id}/approve`, { reason }));
  };

  const lock = () => {
    if (!window.confirm(
      `Lock ${period.label}?\n\nThe figures stop moving: no edits to salary, attendance or payments for this month. An admin can reopen it with a reason.`
    )) return;
    run(() => api.post(`/periods/${period.id}/lock`, {}));
  };

  const reopen = () => {
    const reason = window.prompt('Why is the month being reopened? (kept on the record)');
    if (!reason?.trim()) return;
    run(() => api.post(`/periods/${period.id}/lock`, { open: true, reason }));
  };

  return (
    <div className="card wf-card">
      <ol className="wf">
        {workflow.stages.map((stage) => (
          <li
            key={stage.key}
            className={`wf-step ${stage.done ? 'done' : ''} ${stage.current ? 'at' : ''}`}
          >
            <span className="wf-dot">{stage.done ? '✓' : stage.step}</span>
            <span className="wf-label">{stage.label}</span>
            <span className="wf-why">{stage.why}</span>
          </li>
        ))}
      </ol>

      <div className="row wf-actions">
        {period.locked ? (
          <>
            <span className="pill locked">Locked{period.locked_by ? ` by ${period.locked_by}` : ''}</span>
            {isAdmin && (
              <button className="ghost" disabled={busy} onClick={reopen}>Reopen with a reason</button>
            )}
          </>
        ) : period.approved_at ? (
          <>
            <span className="pill ok">Approved by {period.approved_by}</span>
            {isAdmin && (
              <>
                <button className="primary" disabled={busy} onClick={lock}>Lock the month</button>
                <button className="ghost" disabled={busy} onClick={unapprove}>Take the approval back</button>
              </>
            )}
          </>
        ) : isAdmin ? (
          <>
            <button className="primary" disabled={busy} onClick={approve}>Approve the payroll</button>
            {workflow.blocking.length > 0 && (
              <span className="muted small">
                {workflow.blocking.length} serious exception(s) are open — settle or ignore them first.
              </span>
            )}
          </>
        ) : (
          <span className="muted small">Approving and locking are an admin’s.</span>
        )}
        {period.reopen_reason && !period.locked ? (
          <span className="muted small">Reopened: {period.reopen_reason}</span>
        ) : null}
      </div>
    </div>
  );
}
