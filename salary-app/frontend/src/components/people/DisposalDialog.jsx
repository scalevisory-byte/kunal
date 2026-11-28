import { useEffect, useState } from 'react';
import { STANDALONE, api } from '../../api.js';
import {
  DISPOSAL_ACTIONS,
  DISPOSAL_METHODS,
  METHODS_WITH_MONEY,
  validateDisposal,
} from '../../../../shared/assetDisposal.js';
import { todayIso } from '../../../../shared/today.js';

/**
 * Write it off, or dispose of it - asked for, or done by somebody who may
 * approve (v2.48.0).
 *
 * One dialog for both, because the office does not always know which it is
 * until the form asks: "it is broken and still in the cupboard" is a
 * write-off, "the scrap dealer took it for 800" is a disposal.
 *
 * The button says what will happen BEFORE it is pressed: an approver's press
 * does it now, anybody else's sends it for approval and changes nothing yet.
 *
 * In the single file there are no logins and so nobody to approve: the old
 * direct routes are used and the dialog says so.
 */
export default function DisposalDialog({ asset, action: startAs = 'write_off', onClose, onDone }) {
  const [form, setForm] = useState({
    action: startAs,
    reason: '',
    method: 'scrapped',
    party: '',
    amount: '',
    on_date: todayIso(),
  });
  const [canApprove, setCanApprove] = useState(STANDALONE);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    if (STANDALONE) return;
    api
      .get(`/people/assets/disposals?asset_id=${asset.id}`)
      .then((got) => setCanApprove(Boolean(got.can_approve)))
      .catch(() => {});
  }, [asset.id]);

  const writtenOff = Boolean(asset.written_off_on);
  const held = asset.employee_id && !asset.returned_on;
  const needsMoney = form.action === 'dispose' && METHODS_WITH_MONEY.has(form.method);

  const submit = async () => {
    const problems = validateDisposal(form, { today: todayIso() });
    if (problems.length) return setProblem(problems.join('; '));
    setBusy(true);
    setProblem('');
    try {
      if (STANDALONE) {
        if (form.action === 'write_off') {
          await api.post(`/people/assets/${asset.id}/write-off`, { why: form.reason, on: form.on_date });
        } else {
          await api.post(`/people/assets/${asset.id}/state`, { state: 'disposed', note: form.reason, on: form.on_date });
        }
        onDone?.(`${asset.code} ${form.action === 'write_off' ? 'written off' : 'marked disposed'}.`);
        return;
      }
      const got = await api.post(`/people/assets/${asset.id}/disposal`, form);
      const d = got.disposal;
      onDone?.(
        d.status === 'pending'
          ? `${d.number}: asked. ${asset.code} stays exactly as it is until a Manager or an Admin approves it.`
          : `${d.number}: ${asset.code} ${form.action === 'write_off' ? 'written off' : 'disposed of'} — recorded as approved by you.`
      );
    } catch (err) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop wd-over" onClick={onClose}>
      <div className="modal wd-modal" role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="rr-head">
          <h3>{asset.code} {asset.label}</h3>
          <button className="link" onClick={onClose}>Close</button>
        </div>

        <div className="wd-actions" role="radiogroup" aria-label="What to do">
          {DISPOSAL_ACTIONS.map(([key, label, hint]) => {
            const off = key === 'write_off' && writtenOff;
            return (
              <label key={key} className={`wd-choice${form.action === key ? ' on' : ''}${off ? ' off' : ''}`}>
                <input
                  type="radio"
                  name="wd-action"
                  value={key}
                  checked={form.action === key}
                  disabled={off}
                  onChange={() => setForm((f) => ({ ...f, action: key }))}
                />
                <span>
                  <b>{label}</b>
                  <em>{off ? 'Already written off — it can still be disposed of.' : hint}</em>
                </span>
              </label>
            );
          })}
        </div>

        <div className="vf-grid">
          <label className="vf-field wide">
            <span className="vf-label">Why <b>*</b></span>
            <textarea rows={2} value={form.reason} onChange={set('reason')} placeholder="e.g. screen cracked, repair quoted more than it is worth" />
          </label>
          {form.action === 'dispose' && (
            <>
              <label className="vf-field">
                <span className="vf-label">How it went <b>*</b></span>
                <select value={form.method} onChange={set('method')}>
                  {DISPOSAL_METHODS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </label>
              <label className="vf-field">
                <span className="vf-label">To whom</span>
                <input value={form.party} onChange={set('party')} placeholder="buyer, scrap dealer, vendor" />
              </label>
              {needsMoney && (
                <label className="vf-field">
                  <span className="vf-label">Amount received (₹) <b>*</b></span>
                  <input type="number" min="0" value={form.amount} onChange={set('amount')} placeholder="0 if nothing" />
                </label>
              )}
            </>
          )}
          <label className="vf-field">
            <span className="vf-label">Date</span>
            <input type="date" max={todayIso()} value={form.on_date} onChange={set('on_date')} />
          </label>
        </div>

        <p className="muted small wd-effect">
          {held ? `It is with ${asset.employee_name || 'somebody'}; it is taken back from them when this goes through. ` : ''}
          {form.action === 'dispose' && !writtenOff ? 'A disposal writes it off too, so it leaves the books. ' : ''}
          It keeps its code and its history either way.
        </p>
        {STANDALONE ? (
          <p className="muted small">This file has no logins, so there is nobody to approve it: it is done when you press the button.</p>
        ) : canApprove ? (
          <p className="muted small">You can approve, so this is done now and recorded as approved by you.</p>
        ) : (
          <p className="wd-ask small">This goes to a Manager or an Admin for approval. <b>Nothing changes until they approve it.</b></p>
        )}
        {problem ? <p className="error small">{problem}</p> : null}

        <div className="rr-actions">
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className={form.action === 'write_off' || form.method === 'scrapped' ? 'danger' : 'primary'} disabled={busy} onClick={submit}>
            {canApprove
              ? form.action === 'write_off' ? 'Write it off' : 'Dispose of it'
              : form.action === 'write_off' ? 'Ask to write it off' : 'Ask to dispose of it'}
          </button>
        </div>
      </div>
    </div>
  );
}
