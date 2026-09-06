import Icon from './Icon.jsx';
import { needingAttention, whenLabel } from '../lib/followup.js';

/** The dashboard's one line about chasing: only what actually wants attention. */
export default function FollowUpWidget({ followUps, onOpenAll }) {
  const attention = needingAttention(followUps);
  const overdue = attention.filter((f) => f.status === 'overdue' || f.status === 'needs_attention').length;
  const due = attention.filter((f) => f.status === 'due').length;

  return (
    <section className="rail-card">
      <h3 className="rail-title">Follow-ups</h3>

      {attention.length === 0 ? (
        <p className="rail-state on">
          <span className="state-dot" />
          Nothing needs following up
        </p>
      ) : (
        <>
          <p className="fu-counts">
            {overdue > 0 && <span className="danger-text">{overdue} overdue</span>}
            {overdue > 0 && due > 0 && <span className="sep">·</span>}
            {due > 0 && <span className="warn-text">{due} due</span>}
          </p>
          <ul className="rail-list">
            {attention.slice(0, 3).map((f) => (
              <li key={f.id}>
                <button className="rail-row" onClick={onOpenAll}>
                  <span className="rail-name">{f.title}</span>
                  <span className={`rail-count ${f.status === 'overdue' ? 'danger-text' : ''}`}>
                    {whenLabel(f.due_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <button className="btn ghost wide" onClick={onOpenAll}>
        View all <Icon name="arrowRight" size={16} />
      </button>
    </section>
  );
}
