import { useEffect, useState } from 'react';
import { api } from '../../api.js';

/**
 * THE COMPANY'S HOLIDAYS, as they apply to this person.
 *
 * A holiday carries the religions it covers - Diwali for the Hindu staff,
 * Eid for the Muslim staff, everybody else at work - so the server only
 * sends the ones that cover whoever is signed in. A list showing all of them
 * would tell somebody they have days off they do not have.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pretty = (iso) => {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return iso || '';
  const dow = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dow} ${d} ${MONTHS[m - 1]} ${y}`;
};

export default function MyHolidays({ onError }) {
  const [holidays, setHolidays] = useState(null);

  useEffect(() => {
    api
      .get('/me/holidays')
      .then(({ holidays: list }) => setHolidays(list || []))
      .catch((err) => { setHolidays([]); onError?.(err); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (holidays === null) return <p className="muted small">Loading…</p>;

  const today = new Date().toISOString().slice(0, 10);
  const ahead = holidays.filter((h) => h.date >= today);
  const past = holidays.filter((h) => h.date < today).reverse();

  const table = (list, empty) =>
    list.length ? (
      <table className="sheet">
        <thead>
          <tr>
            <th className="grow">Day</th>
            <th>Holiday</th>
            <th>For</th>
            <th>On the grid</th>
          </tr>
        </thead>
        <tbody>
          {list.map((h) => (
            <tr key={`${h.period_id}-${h.day}-${h.name}`}>
              <td>{pretty(h.date)}</td>
              <td><strong>{h.name}</strong></td>
              <td className="muted small">
                {h.religions?.length ? h.religions.join(', ') : 'everybody'}
              </td>
              <td>
                {/*
                  * A holiday the office has not applied to the grid is
                  * PLANNED, not a day off. Saying otherwise is how somebody
                  * does not turn up.
                  */}
                {h.applied
                  ? <span className="pill ok">marked</span>
                  : <span className="pill" title="Planned, but not yet marked on the attendance grid">planned</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <p className="empty fo-empty">{empty}</p>
    );

  return (
    <div className="stack">
      <div className="card">
        <h3>Coming up</h3>
        {table(ahead, 'No holidays ahead on the calendar yet.')}
        <p className="muted small">
          These are the holidays that apply to <strong>you</strong>. A festival kept by some of the
          staff and not others shows only for the people it covers, which is why this list may be
          shorter than somebody else&rsquo;s.
        </p>
      </div>

      {past.length > 0 && (
        <details className="card fold">
          <summary>
            <strong>Earlier this year</strong>
            <span className="muted small"> — {past.length} already gone</span>
          </summary>
          {table(past, '')}
        </details>
      )}
    </div>
  );
}
