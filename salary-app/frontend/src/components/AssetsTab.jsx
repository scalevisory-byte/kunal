import { STANDALONE } from '../api.js';
import Assets from './people/Assets.jsx';

/**
 * Assets, as their own tab.
 *
 * They sat under People, which was the wrong place and Dinesh said so: an
 * asset belongs to the company, not to a person. Most of them are nobody's -
 * the office printer, the furniture, the spare SIM - and a register you reach
 * through a tab about staff records implies everything on it is issued to
 * somebody.
 *
 * So the register leads, with its own three views: everything the company
 * owns, who is holding what, and a stock take. What somebody was handed is one
 * view of it rather than the way in, and it also shows on that person's own
 * record.
 */
export default function AssetsTab({
  employees,
  companies,
  period,
  me,
  scanned,
  onScanned,
  onError,
  onReload,
}) {
  if (STANDALONE) {
    return (
      <section className="card">
        <h2>Assets</h2>
        <p className="muted small">
          The asset register, handovers, the stock take and the service history need the server
          version. They are records that have to outlive one browser and be seen by more than one
          person — a single file on a laptop cannot hold them. Everything to do with pay,
          attendance and hours works here as normal.
        </p>
      </section>
    );
  }

  return (
    <Assets
      employees={employees}
      companies={companies}
      period={period}
      me={me}
      scanned={scanned}
      onScanned={onScanned}
      onError={onError}
      onReload={onReload}
    />
  );
}
