import { useState } from 'react';
import { api } from '../../api.js';
import { CLEARANCE_STATES } from '../../../../shared/exitClearance.js';

/**
 * THE CLEARANCE CHECKLIST on somebody's way out.
 *
 * Dinesh: *"exit par clearance checklist bhi bana do"*.
 *
 * Two halves, and the screen says which is which:
 *
 *   **Worked out** — assets still out, a loan still owed, a claim unpaid, a
 *   login still live. These have **no buttons**: they clear when the thing
 *   itself is settled. A tick box saying "assets: cleared" beside a register
 *   listing three things still out is the disagreement this avoids.
 *
 *   **Signed** — IT, Accounts, Store, the manager, HR. Somebody puts their
 *   name and the date on each, because "who said this was fine" has to have
 *   an answer.
 *
 * Nothing here blocks the full and final. The office sometimes pays on a
 * promise, and a system that refuses gets worked around with a cash payment
 * nobody records — so this says what is open, and a person decides.
 */
const TONE = { given: 'approved', blocked: 'rejected', na: 'paid', pending: 'pending' };

export default function ExitClearance({ employeeId, clearance, onChanged, onError }) {
  const [open, setOpen] = useState(null);      // the step being signed
  const [draft, setDraft] = useState({ state: 'given', by: '', note: '' });
  const [busy, setBusy] = useState(false);

  if (!clearance) return null;

  const save = async (step) => {
    setBusy(true);
    try {
      await api.put(`/people/exits/${employeeId}/clearance/${step}`, draft);
      setOpen(null);
      setDraft({ state: 'given', by: '', note: '' });
      await onChanged?.();
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      {(() => {
        /* How far along, as a bar: "does not apply" is dealt with, not open. */
        const total = clearance.items?.length || 0;
        const done = total - (clearance.outstanding || 0);
        return total ? (
          <div className="ex-progress" title={`${done} of ${total} dealt with`}>
            <span className="ex-track"><i style={{ width: `${Math.round((done / total) * 100)}%` }} /></span>
            <span className="small">{done} of {total} dealt with</span>
          </div>
        ) : null;
      })()}
      <h4>
        Clearance{' '}
        <span className="muted small">
          {clearance.ready
            ? 'everything dealt with'
            : `${clearance.outstanding} still open — ${clearance.blocking.slice(0, 3).join(', ')}${
                clearance.blocking.length > 3 ? ' and more' : ''
              }`}
        </span>
      </h4>

      <p className="muted small">
        The top half is <strong>worked out</strong> from the registers and has no buttons — it clears
        when the thing itself is settled. The bottom half is <strong>signed</strong> by whoever
        checked it. <strong>None of it blocks the final payment</strong>: it says what is open, and
        you decide.
      </p>

      <table className="sheet clearance-table">
        <tbody>
          {clearance.checked.map((item) => (
            <tr key={item.key}>
              <td className="sticky-name">
                {item.label}
                <div className="muted small">{item.detail}</div>
                {item.note ? <div className="muted small">{item.note}</div> : null}
              </td>
              <td className="small">
                <span className={`pill ${TONE[item.state] || ''}`}>
                  {item.state === 'given' ? 'clear' : item.state === 'na' ? 'does not apply' : 'still open'}
                </span>
              </td>
              <td className="small muted">worked out</td>
            </tr>
          ))}

          {clearance.signed.map((item) => (
            <tr key={item.key}>
              <td className="sticky-name">
                {item.label}
                <div className="muted small">{item.ask}</div>
                {item.note ? <div className="muted small">“{item.note}”</div> : null}
              </td>
              <td className="small">
                <span className={`pill ${TONE[item.state] || ''}`}>
                  {CLEARANCE_STATES.find(([k]) => k === item.state)?.[1] || item.state}
                </span>
                {item.by_whom ? (
                  <div className="muted small">
                    {item.by_whom}
                    {item.on ? ` · ${item.on}` : ''}
                  </div>
                ) : null}
              </td>
              <td className="small">
                {open === item.key ? (
                  <div className="row" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
                    <select
                      value={draft.state}
                      onChange={(e) => setDraft({ ...draft, state: e.target.value })}
                    >
                      {CLEARANCE_STATES.map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <input
                      style={{ width: '8rem' }}
                      placeholder="your name"
                      value={draft.by}
                      onChange={(e) => setDraft({ ...draft, by: e.target.value })}
                    />
                    <input
                      style={{ width: '12rem' }}
                      placeholder="anything worth saying"
                      value={draft.note}
                      onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                    />
                    <button className="primary tiny" disabled={busy} onClick={() => save(item.key)}>
                      {busy ? 'Saving…' : 'Save'}
                    </button>
                    <button className="ghost tiny" disabled={busy} onClick={() => setOpen(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="ghost small"
                    onClick={() => {
                      setOpen(item.key);
                      setDraft({ state: item.state === 'pending' ? 'given' : item.state, by: item.by_whom || '', note: item.note || '' });
                    }}
                  >
                    {item.state === 'pending' ? 'sign it off' : 'change'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
