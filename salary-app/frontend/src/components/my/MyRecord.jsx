import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { rupees } from '../../format.js';
import { recordSummary } from '../../../../shared/myRecord.js';
import { MONTHS } from '../../format.js';

/* A date in prose reads as a date, not as a serial number: "10 Oct 2026",
   not "2026-10-10". The left-hand column keeps the ISO form, where it lines
   up down the page. */
const niceDay = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${(MONTHS[m - 1] || '').slice(0, 3)} ${y}`;
};

/**
 * MY RECORD - what has been said about me, good and bad.
 *
 * Dinesh: *"emp[loyee me unke achvemnet and penlatlites bhi dikhe esa karo"*.
 *
 * The office has kept both of these since the People tab was built, and the
 * person they are about had never seen either. So an appreciation was a filing
 * exercise, and a fine was something you found out about from the deduction
 * line on a payslip.
 *
 * `shared/myRecord.js` decides what is theirs to see; this only lays it out.
 * The good list comes FIRST, deliberately - it is the longer list in a decent
 * office and putting the fines at the top of somebody's own page would be a
 * choice about how the company talks to its staff.
 */
export default function MyRecord({ onError }) {
  const [notes, setNotes] = useState(null);
  const [penalties, setPenalties] = useState([]);
  const [busy, setBusy] = useState(0);

  const load = async () => {
    try {
      const got = await api.get('/me/record');
      setNotes(got.notes || []);
      setPenalties(got.penalties || []);
    } catch (err) {
      onError?.(err);
      setNotes([]);
    }
  };

  useEffect(() => { load(); }, []);

  const good = useMemo(() => (notes || []).filter((n) => n.kind === 'appreciation'), [notes]);
  const warnings = useMemo(() => (notes || []).filter((n) => n.kind === 'warning'), [notes]);
  const sum = useMemo(
    () => recordSummary({ notes: notes || [], penalties }),
    [notes, penalties]
  );

  /* Saying "I have seen this". Only a warning, only once, never back. */
  const acknowledge = async (id) => {
    setBusy(id);
    try {
      await api.post(`/me/notes/${id}/acknowledge`, {});
      await load();
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy(0);
    }
  };

  if (notes === null) return <p className="muted small">Loading your record…</p>;

  return (
    <div className="my-rec">
      <div className="my-cards">
        <article className="my-card tone-ok">
          <header><span className="my-ico">&#127942;</span><h3>Appreciations</h3></header>
          <strong className="my-big">{sum.appreciations}</strong>
          <p className="muted small">
            {sum.appreciations ? 'on your record' : 'nothing on your record yet'}
          </p>
        </article>
        <article className={`my-card${sum.warnings ? ' tone-warn' : ''}`}>
          <header><span className="my-ico">&#9888;</span><h3>Warnings</h3></header>
          <strong className="my-big">{sum.warnings}</strong>
          <p className="muted small">
            {sum.warnings_unacknowledged
              ? `${sum.warnings_unacknowledged} to acknowledge`
              : sum.warnings
                ? 'all acknowledged'
                : 'none on your record'}
          </p>
        </article>
        <article className={`my-card${sum.outstanding ? ' tone-bad' : ''}`}>
          <header><span className="my-ico">&#8377;</span><h3>Still to come out</h3></header>
          <strong className="my-big">₹{rupees(sum.outstanding)}</strong>
          <p className="muted small">
            {sum.penalties_open
              ? `${sum.penalties_open} open · ₹${rupees(sum.recovered)} recovered so far`
              : sum.penalties
                ? `settled · ₹${rupees(sum.recovered)} recovered`
                : 'no penalty on your record'}
          </p>
        </article>
      </div>

      {/* ------------- the good half ------------- */}
      <section className="card">
        <h3>Appreciations &amp; achievements</h3>
        {good.length ? (
          <ul className="plain-list my-rec-list">
            {good.map((n) => (
              <li key={n.id} className="my-rec-item good">
                <div className="my-rec-when">{n.dated}</div>
                <div className="my-rec-what">
                  <strong>{n.subject}</strong>
                  {n.category ? <span className="pill small">{n.category}</span> : null}
                  {n.detail ? <p className="small">{n.detail}</p> : null}
                  {n.issued_by ? <p className="muted small">Recorded by {n.issued_by}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty fo-empty">
            Nothing recorded yet. An appreciation appears here when the office puts one on your
            record.
          </p>
        )}
      </section>

      {/* ------------- warnings ------------- */}
      <section className="card">
        <h3>Warnings</h3>
        {warnings.length ? (
          <ul className="plain-list my-rec-list">
            {warnings.map((n) => (
              <li key={n.id} className="my-rec-item warn">
                <div className="my-rec-when">{n.dated}</div>
                <div className="my-rec-what">
                  <strong>{n.subject}</strong>
                  {n.severity ? <span className="pill small">{n.severity}</span> : null}
                  {n.detail ? <p className="small">{n.detail}</p> : null}
                  {n.issued_by ? <p className="muted small">Issued by {n.issued_by}</p> : null}
                </div>
                <div className="my-rec-act">
                  {n.acknowledged_on ? (
                    <span className="muted small">You acknowledged this on {niceDay(n.acknowledged_on)}</span>
                  ) : (
                    <button
                      className="small"
                      disabled={busy === n.id}
                      onClick={() => acknowledge(n.id)}
                    >
                      {busy === n.id ? 'Saving…' : 'I have seen this'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty fo-empty">No warning on your record.</p>
        )}
        {warnings.some((n) => !n.acknowledged_on) ? (
          <p className="muted small">
            Acknowledging only records that you have read it &mdash; it is not agreement, and it
            changes nothing about your pay. It cannot be undone, so the record cannot later say
            you never saw it.
          </p>
        ) : null}
      </section>

      {/* ------------- penalties ------------- */}
      <section className="card">
        <h3>Penalties &amp; recoveries</h3>
        {penalties.length ? (
          <>
            <ul className="plain-list my-rec-list">
              {penalties.map((p) => (
                <li key={p.id} className={`my-rec-item pen ${p.status}`}>
                  <div className="my-rec-when">{p.happened_on || p.told_on || ''}</div>
                  <div className="my-rec-what">
                    <strong>₹{rupees(p.amount)}</strong>{' '}
                    <span>{p.kind_label || p.kind}</span>
                    {p.what ? <span className="muted"> &middot; {p.what}</span> : null}
                    {p.asset_code ? <span className="muted"> ({p.asset_code})</span> : null}
                    {/* The note is required when a penalty is recorded. It is
                        the answer to "why was this cut", and it is the same
                        line that prints on the payslip. */}
                    <p className="small">{p.note}</p>
                    <p className="muted small">
                      {p.status === 'waived'
                        ? `Waived${p.waived_note ? ` — ${p.waived_note}` : ''}`
                        : p.months > 1
                          ? `Over ${p.months} months${p.instalment ? ` · about ₹${rupees(p.instalment)} a month` : ''}`
                          : 'In one month'}
                      {p.told_on ? ` · you were told on ${niceDay(p.told_on)}` : ''}
                      {p.acknowledged_on ? ` · accepted ${niceDay(p.acknowledged_on)}` : ''}
                    </p>
                    {p.recoveries.length ? (
                      <p className="muted small">
                        Taken from: {p.recoveries.map((r) => `${r.period_label} ₹${rupees(r.amount)}`).join(' · ')}
                      </p>
                    ) : (
                      <p className="muted small">Nothing deducted yet.</p>
                    )}
                  </div>
                  <div className="my-rec-act">
                    <span className="my-rec-out">
                      {p.status === 'waived'
                        ? 'nothing to pay'
                        : p.outstanding > 0
                          ? `₹${rupees(p.outstanding)} to go`
                          : 'settled'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="muted small">
              A penalty appears here once you have been told about it, or once money has come
              out of it. Anything deducted is also on the payslip for that month, with this same
              note beside it. If you disagree with one, raise it with the office &mdash; nothing
              on this page can be changed from here.
            </p>
          </>
        ) : (
          <p className="empty fo-empty">
            No penalty on your record. Nothing has been deducted from your salary as a fine,
            a loss or damage.
          </p>
        )}
      </section>

      <p className="muted small">
        This is your own copy of your record and shows only what was issued to you. The
        office&rsquo;s own working notes are not here, and nothing on this page is anybody
        else&rsquo;s.
      </p>
    </div>
  );
}
