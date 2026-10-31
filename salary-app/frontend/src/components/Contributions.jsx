import { MODES, esiFor, isAuto, pfFor, ptFor } from '../../../shared/contributions.js';
import { salaryStructure } from '../../../shared/structure.js';

const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

/**
 * PF, ESI and PT for one person.
 *
 * Everybody starts on "Fixed amount", which deducts the number already typed —
 * exactly what this app has always done. Switching to "Work it out" is the only
 * thing that changes a deduction, and the panel says what that change is in
 * rupees before it is made.
 */
export default function Contributions({ employee, onPatch }) {
  const structure = salaryStructure(employee);
  const basic = structure.set ? structure.basic : null;
  const gross = Math.round(Number(employee.monthly_salary) || 0);

  // A full month at the master salary — what the rules would give in a normal
  // month, which is the figure worth showing beside the typed one.
  const pf = pfFor({ wages_basic: basic, fallback: gross });
  const esi = esiFor({ gross });
  const pt = ptFor(gross);

  const pfAuto = isAuto(employee.pf_mode);
  const esiAuto = isAuto(employee.esi_mode);
  const pfTyped = Math.round(Number(employee.pf) || 0);
  const esiTyped = Math.round(Number(employee.esi) || 0);

  // How much MORE would be deducted if both were worked out. Positive means a
  // bigger deduction, which means a smaller take-home - the sign that way
  // round once read as "they would take home ₹1,215 more" when the truth was
  // the exact opposite.
  const extraDeduction =
    (pfAuto ? 0 : pf.employee - pfTyped) + (esiAuto ? 0 : esi.employee - esiTyped);

  return (
    <div className="structure">
      <h3 style={{ margin: '0 0 0.5rem' }}>PF, ESI and professional tax</h3>

      <div className="scroll">
        <table className="sheet">
          <thead>
            <tr>
              <th>What</th>
              <th className="num">Charged on</th>
              <th className="num">Worked out</th>
              <th className="num">Deducting now</th>
              <th>How</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                Provident fund
                <div className="muted small">
                  12% of {pf.on === 'basic' ? 'Basic' : 'gross — no Basic set'}
                  {pf.capped ? ', capped at ₹15,000 of wages' : ''}
                </div>
              </td>
              <td className="num">{inr(pf.wages)}</td>
              <td className="num">{inr(pf.employee)}</td>
              <td className="num">
                <strong>{inr(pfAuto ? pf.employee : pfTyped)}</strong>
              </td>
              <td>
                <select value={pfAuto ? 'auto' : 'fixed'} onChange={(e) => onPatch(employee.id, { pf_mode: e.target.value })}>
                  {MODES.map((m) => (
                    <option key={m.key} value={m.key}>{m.label}</option>
                  ))}
                </select>
              </td>
            </tr>
            <tr>
              <td>
                ESI
                <div className="muted small">
                  {esi.eligible
                    ? '0.75% of gross, rounded up'
                    : `over the ₹21,000 wage limit — not covered`}
                </div>
              </td>
              <td className="num">{esi.eligible ? inr(esi.wages) : '—'}</td>
              <td className="num">{inr(esi.employee)}</td>
              <td className="num">
                <strong>{inr(esiAuto ? esi.employee : esiTyped)}</strong>
              </td>
              <td>
                <select value={esiAuto ? 'auto' : 'fixed'} onChange={(e) => onPatch(employee.id, { esi_mode: e.target.value })}>
                  {MODES.map((m) => (
                    <option key={m.key} value={m.key}>{m.label}</option>
                  ))}
                </select>
              </td>
            </tr>
            <tr>
              <td>
                Professional tax
                <div className="muted small">Gujarat — nil up to ₹12,000, ₹200 above</div>
              </td>
              <td className="num">{inr(gross)}</td>
              <td className="num">{inr(pt)}</td>
              <td className="num"><strong>{inr(pt)}</strong></td>
              <td className="muted small">always worked out</td>
            </tr>
          </tbody>
        </table>
      </div>

      {extraDeduction !== 0 ? (
        <p className="banner">
          Switching both to <strong>Work it out</strong> would deduct{' '}
          {inr(Math.abs(extraDeduction))}{' '}
          {extraDeduction > 0 ? 'more' : 'less'} in a full month — they would take home{' '}
          <strong>
            {extraDeduction > 0
              ? `${inr(extraDeduction)} less`
              : `${inr(-extraDeduction)} more`}
          </strong>
          . A month with days absent deducts proportionally less. Nothing has changed yet.
        </p>
      ) : null}

      <p className="muted small">
        The employer also pays {inr(pf.employer_cost)} of PF
        {esi.eligible ? ` and ${inr(esi.employer)} of ESI` : ''} on top — {inr(gross + pf.employer_cost + (esi.eligible ? esi.employer : 0))} is
        what this person actually costs a month.
      </p>
      {!structure.set ? (
        <p className="muted small">
          No Basic is set, so PF falls back to the gross. Set a salary structure above and PF
          will be charged on Basic, which is what the law charges it on.
        </p>
      ) : null}
      {esi.over_limit ? (
        <p className="muted small">
          Note: once somebody is contributing, ESI continues to the end of the contribution
          period (April–September or October–March) even after they cross the limit. The app
          works out one month at a time — put them on a fixed amount for the rest of the period
          if that applies.
        </p>
      ) : null}
    </div>
  );
}
