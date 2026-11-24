import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { todayIso } from '../../../../shared/today.js';

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
  /*
   * ONE LINE UNTIL SOMEBODY OPENS IT.
   *
   * Dinesh: *"salary sheet tab me bhi space kam karo"*. Measured at
   * 1420x1200: this card was 137px and the sheet did not start until 667px.
   * Closed, the five dots stay - so where the month has got to is still
   * visible at a glance - and only the stage that is CURRENT keeps its
   * label and its reason, because the other four say what has already
   * happened. The action button never folds away.
   */
  const [steps, setSteps] = useState(false);
  const [history, setHistory] = useState(null);

  /*
   * WHAT HAS HAPPENED TO THIS MONTH'S APPROVAL, in order.
   *
   * `periods` holds only the CURRENT approval, so a month approved, taken
   * back and approved again shows one name and no sign of the rest. The
   * trail has all three, and this reads it back - loaded only when somebody
   * asks, because most months nobody does.
   */
  useEffect(() => { setHistory(null); }, [period?.id, period?.approved_at, period?.locked]);
  const showHistory = async () => {
    try {
      const { history: rows } = await api.get(`/periods/${period.id}/approvals`);
      setHistory(rows || []);
    } catch (err) {
      onError?.(err);
    }
  };

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
    run(() => api.post(`/periods/${period.id}/approve`, { today: todayIso() }));

  /*
   * APPROVING OVER A CRITICAL FLAG IS A DECISION SOMEBODY SIGNS FOR.
   *
   * There was no button for this at all - the only way past the block was an
   * undocumented `anyway: true` with no reason asked for and none recorded.
   * So somebody facing a flag that was CORRECT (a director really does take
   * no salary) was simply stuck, and anybody who knew the field name went
   * round the back with nothing on the trail.
   */
  const approveAnyway = () => {
    const names = workflow.blocking
      .slice(0, 6)
      .map((b) => `• ${b.name || 'the month'}: ${b.label}`)
      .join('\n');
    const reason = window.prompt(
      `${workflow.blocking.length} critical exception(s) are still open:\n\n${names}` +
        `${workflow.blocking.length > 6 ? `\n…and ${workflow.blocking.length - 6} more` : ''}` +
        '\n\nApproving over them is recorded against your name, with this reason.\n' +
        'Why is the month being approved as it stands?'
    );
    if (!String(reason || '').trim() || reason.trim().length < 5) return;
    run(() => api.post(`/periods/${period.id}/approve`, {
      override_reason: reason.trim(),
      today: todayIso(),
    }));
  };

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
    <div className={`card wf-card${steps ? ' open' : ''}`}>
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
          workflow.blocking.length > 0 ? (
            <>
              <span className="muted small">
                <strong>{workflow.blocking.length} critical exception(s)</strong> are open. Settle or
                ignore them below, or approve over them with a reason.
              </span>
              <button className="ghost" disabled={busy} onClick={approveAnyway}>
                Approve anyway, with a reason…
              </button>
            </>
          ) : (
            <button className="primary" disabled={busy} onClick={approve}>Approve the payroll</button>
          )
        ) : (
          <span className="muted small">Approving and locking are an admin’s.</span>
        )}
        <span className="grow" />
        <button className="ghost small" onClick={() => setSteps((v) => !v)}>
          {steps ? 'Hide the steps' : `All ${workflow.stages.length} steps`}
        </button>
        <button className="ghost small" onClick={showHistory}>Approval history</button>
        {period.reopen_reason && !period.locked ? (
          <span className="muted small">Reopened: {period.reopen_reason}</span>
        ) : null}
      </div>

      {history !== null && (
        <div className="wf-history">
          <div className="row">
            <strong className="small">Approval history</strong>
            <span className="grow" />
            <button className="tiny ghost" onClick={() => setHistory(null)}>Close</button>
          </div>
          {history.length ? (
            <ul className="plain-list">
              {history.map((h) => (
                <li key={h.id} className="muted small">
                  <strong>{String(h.at || '').replace('T', ' ').slice(0, 16)}</strong>{' '}
                  {h.action === 'overrode' ? 'approved over open critical flags' : h.action}
                  {h.who ? ` by ${h.who}` : ''}
                  {h.note ? ` — ${h.note}` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Nothing yet — this month has not been approved or locked.</p>
          )}
        </div>
      )}
    </div>
  );
}
