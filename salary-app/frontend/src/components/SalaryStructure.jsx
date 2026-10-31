import { COMPONENTS, DEFAULT_TEMPLATE, applyTemplate, pfOnBasic, salaryStructure } from '../../../shared/structure.js';

const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

/**
 * One person's salary breakup.
 *
 * The salary on the master stays the total. Special allowance is not typed —
 * it is whatever is left — so the parts can never add up to anything other
 * than what they are already paid.
 */
export default function SalaryStructure({ employee, onPatch }) {
  const s = salaryStructure(employee);
  const pf = pfOnBasic(employee);

  const set = (key, value) => {
    const amount = value === '' ? 0 : Number(value);
    if (!Number.isFinite(amount) || amount === Number(employee[key] || 0)) return;
    onPatch(employee.id, { [key]: amount });
  };

  return (
    <div className="structure">
      <div className="row" style={{ marginBottom: '0.5rem' }}>
        <h3 style={{ margin: 0 }}>Salary structure</h3>
        <span className="spacer" />
        <button
          className="tiny"
          onClick={() => onPatch(employee.id, applyTemplate(employee.monthly_salary))}
          title={`Basic ${DEFAULT_TEMPLATE.basicPercent}%, HRA ${DEFAULT_TEMPLATE.hraPercentOfBasic}% of basic`}
        >
          Use the usual split
        </button>
        {s.set || s.over ? (
          <button
            className="tiny"
            onClick={() => onPatch(employee.id, { basic: 0, hra: 0, conveyance: 0, medical: 0 })}
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="form-grid">
        {COMPONENTS.map(({ key, label, hint }) => (
          <label key={key}>
            {label}
            <input
              type="number"
              key={`${key}-${employee[key] ?? 0}`}
              defaultValue={Math.round(Number(employee[key]) || 0) || ''}
              placeholder="0"
              onBlur={(e) => set(key, e.target.value)}
            />
            <span className="hint">{hint}</span>
          </label>
        ))}
        <label>
          Special allowance
          <input value={s.over ? '' : s.special} readOnly tabIndex={-1} className="computed" />
          <span className="hint">whatever is left — not typed, so it always balances</span>
        </label>
      </div>

      {s.over ? (
        <p className="banner bad">
          The parts come to {inr(s.named)}, which is {inr(s.overBy)} more than the salary of{' '}
          {inr(s.total)}. Lower one of them, or raise the salary.
        </p>
      ) : s.set ? (
        <p className="muted small">
          {inr(s.basic)} + {inr(s.hra)} + {inr(s.conveyance)} + {inr(s.medical)} +{' '}
          {inr(s.special)} = <strong>{inr(s.total)}</strong>, the same salary as before. A
          breakup describes the money; it never changes it.
        </p>
      ) : (
        <p className="muted small">
          No breakup yet — the payslip shows one Salary line. Set one and it shows Basic, HRA
          and the rest, pro-rated for the days worked.
        </p>
      )}

      {pf ? (
        <p className={`small ${pf.matches ? 'muted' : ''}`}>
          PF at 12% of Basic{pf.capped ? ' (capped at ₹15,000 of wages)' : ''} would be{' '}
          <strong>{inr(pf.would)}</strong>; {pf.deducted ? `${inr(pf.deducted)} is being deducted` : 'nothing is being deducted'}.
          {pf.matches ? ' They agree.' : ' '}
          {!pf.matches ? (
            <>
              {' '}
              Nothing has been changed —{' '}
              <button className="link" onClick={() => onPatch(employee.id, { pf: pf.would })}>
                set the deduction to {inr(pf.would)}
              </button>{' '}
              only if that is what you want, because it moves their take-home.
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
