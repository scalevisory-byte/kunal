import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { rupees } from '../../format.js';
import { appraisalKindLabel } from '../../../../shared/appraisal.js';

/*
 * A PARTY FOR A RAISE.
 *
 * Dinesh: *"appraisal raise kare to employee k dashboard me celebration hona
 * chahiye, party jesa popup ke saath"*. Which rise, and what is shown, is
 * decided on the server (shared/celebration.js) - only an increment somebody
 * APPLIED, only a real rise, only in the last sixty days.
 *
 * Shown once per raise on this device: the ids already celebrated are kept
 * in this browser, so it does not come back every time the dashboard opens.
 * On a new phone it comes once more, which is no hardship.
 *
 * The confetti is CSS only - no library, nothing loaded from anywhere - and
 * it stands still for anybody who has asked their phone for less motion.
 */

const KEY = 'salary-app-celebrated-v1';

const seenIds = () => {
  try {
    const got = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(got) ? got : [];
  } catch {
    return [];
  }
};
const markSeen = (id) => {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set([...seenIds(), id])].slice(-20)));
  } catch {
    /* a private window: it may show again, which is harmless */
  }
};

const COLOURS = ['#f5b301', '#1d4ed8', '#16a34a', '#db2777', '#f97316', '#7c3aed'];
const PIECES = Array.from({ length: 36 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: ((i * 13) % 20) / 10,
  colour: COLOURS[i % COLOURS.length],
  tilt: (i * 47) % 360,
}));

const longDate = (iso) => {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
};

export default function Celebration({ name }) {
  const [party, setParty] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .get('/me/celebration')
      .then((got) => {
        const c = got?.celebration;
        if (alive && c && !seenIds().includes(c.id)) setParty(c);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!party) return null;
  const close = () => {
    markSeen(party.id);
    setParty(null);
  };
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  const kind = appraisalKindLabel(party.kind);

  return (
    <div className="modal-backdrop celebrate-backdrop" onClick={close}>
      <div className="confetti" aria-hidden="true">
        {PIECES.map((p, i) => (
          <i
            key={i}
            style={{
              left: `${p.left}%`,
              animationDelay: `${p.delay}s`,
              background: p.colour,
              transform: `rotate(${p.tilt}deg)`,
            }}
          />
        ))}
      </div>
      <div className="modal celebrate" role="dialog" aria-label="Congratulations" onClick={(e) => e.stopPropagation()}>
        <div className="celebrate-burst" aria-hidden="true">🎉</div>
        <h2>Congratulations{first ? `, ${first}` : ''}!</h2>
        <p className="celebrate-lead">
          Your {kind && kind !== 'Salary increment' ? `${kind.toLowerCase()} ` : ''}increment is through
          {party.cycle ? ` for ${party.cycle}` : ''}.
        </p>
        <div className="celebrate-figures">
          <div>
            <b>+{rupees(party.increment)}</b>
            <em>a month{party.increment_pct !== null ? ` · ${party.increment_pct}%` : ''}</em>
          </div>
          <div>
            <b>{rupees(party.to_salary)}</b>
            <em>your new monthly salary</em>
          </div>
        </div>
        {party.effective_from ? (
          <p className="muted small">From {longDate(party.effective_from)}. It shows on your payslip from that month.</p>
        ) : null}
        <button className="primary" onClick={close}>Thank you</button>
      </div>
    </div>
  );
}
