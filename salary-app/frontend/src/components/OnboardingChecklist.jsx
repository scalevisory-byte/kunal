import { onboardingStatus } from '../../../shared/onboarding.js';

/**
 * What is still missing on a new joiner, and what each gap will cost.
 *
 * A checklist, not a gate: nothing here blocks a save or a payslip. Payroll
 * runs on what it has — this only says what will break later and why.
 */
export default function OnboardingChecklist({ employee, compact = false }) {
  const status = onboardingStatus(employee, {
    paidInCash: /cash/i.test(employee?.payment_mode || ''),
  });
  if (status.complete) {
    return compact ? null : (
      <p className="muted small">Record complete — nothing outstanding for this person.</p>
    );
  }

  return (
    <div className="onboarding">
      <div className="row" style={{ marginBottom: '0.4rem' }}>
        <strong className="small">Joining checklist</strong>{' '}
        <span className="muted small">
          {status.done} of {status.total} done
        </span>
        <span className="bar" aria-hidden="true">
          <i style={{ width: `${status.percent}%` }} />
        </span>
      </div>

      {status.steps
        .filter((step) => !step.done)
        .map((step) => (
          <div className="step" key={step.key}>
            <div className="small">
              <strong>{step.title}</strong>{' '}
              <span className="muted">
                — {[...step.missing.map((f) => f.label), ...step.malformed.map((f) => `${f.label} looks wrong`)].join(', ')}
              </span>
            </div>
            <div className="muted small why">{step.why}</div>
          </div>
        ))}
    </div>
  );
}
