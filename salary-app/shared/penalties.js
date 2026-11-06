/**
 * Fines, losses and damage recovered from somebody's salary.
 *
 * Dinesh: *"any penlaty loss ?"*, then *"haan bana do penalty wala / salary me
 * se decut hoga / and uska reporting bhi / kyu kata he kis chiz ka kata he
 * uska note dalne ka option bhi dena"*.
 *
 * Before this, a fine was a number in the month's Deduct box with a line of
 * remark beside it. That deducts perfectly well and remembers nothing: what
 * was broken, when, who decided, whether the person was ever told, and whether
 * ₹5,000 was meant to come out in one month or five. The next argument about
 * it has only the remark to go on.
 *
 * ---------------------------------------------------------------------------
 * Two rules this module exists to hold:
 *
 *   1. NOTHING IS DEDUCTED UNTIL SOMEBODY RECOVERS IT INTO A NAMED MONTH.
 *      Recording a penalty changes nobody's pay. The same discipline as the
 *      expense claim next door, and the attendance request before it.
 *
 *   2. THE LAW'S LIMITS ARE REPORTED, NEVER ENFORCED SILENTLY.
 *      The Payment of Wages Act caps a damage-or-loss deduction at the actual
 *      loss, and caps the month's total deductions at half of wages. This
 *      module says when a recovery crosses those lines. It does not refuse -
 *      refusing would just get the figure typed into the Deduct box instead,
 *      where nothing checks anything at all.
 * ---------------------------------------------------------------------------
 *
 * Dependency-free, so the server and the dashboard agree.
 */

/** What kind of thing was being recovered. Free text is not a category. */
export const PENALTY_KINDS = [
  {
    key: 'damage',
    label: 'Damage to company property',
    why: 'something was broken — a laptop, a vehicle, a fitting',
    needsThing: true,
  },
  {
    key: 'loss',
    label: 'Loss of company property',
    why: 'something issued to them is gone',
    needsThing: true,
  },
  { key: 'shortage', label: 'Cash or stock shortage', why: 'the till or the stock did not tally' },
  { key: 'fine', label: 'Fine', why: 'a penalty for conduct, with a warning behind it' },
  { key: 'advance_excess', label: 'Excess paid earlier', why: 'they were overpaid and it is coming back' },
  { key: 'other', label: 'Something else', why: '' },
];

export const kindLabel = (key) =>
  PENALTY_KINDS.find((k) => k.key === key)?.label || key || 'Penalty';

const kindOf = (key) => PENALTY_KINDS.find((k) => k.key === key) || null;

export const STATUSES = ['open', 'recovered', 'waived'];

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

/**
 * Is this penalty even recordable? Shape only — whether it is FAIR is the
 * office's call, which is the whole point of it being a record and not a rule.
 */
export function validatePenalty(penalty = {}) {
  const problems = [];
  if (!Number(penalty.employee_id)) problems.push('whose penalty is this?');
  if (!kindOf(penalty.kind)) problems.push('pick what kind of penalty this is');

  const amount = money(penalty.amount);
  if (!(amount > 0)) problems.push('how much?');

  /*
   * The note is REQUIRED, and that is the point of the module.
   *
   * "kyu kata he kis chiz ka kata he uska note" - a deduction nobody can
   * explain six months later is the one that turns into a dispute, so the app
   * will not record one without the explanation.
   */
  if (!String(penalty.note || '').trim()) {
    problems.push('say why it is being deducted — that is the whole point of recording it');
  }

  if (kindOf(penalty.kind)?.needsThing && !String(penalty.what || '').trim()) {
    problems.push('name what was damaged or lost');
  }

  const months = Number(penalty.months ?? 1);
  if (!Number.isInteger(months) || months < 1 || months > 24) {
    problems.push('recover it over 1 to 24 months');
  }

  if (penalty.recovered_so_far !== undefined && money(penalty.recovered_so_far) > amount) {
    problems.push('more has been recovered than the penalty is worth');
  }

  return { ok: problems.length === 0, problems };
}

/** What is still to come out, never below zero. */
export const outstandingOf = (penalty = {}) =>
  Math.max(0, money(penalty.amount) - money(penalty.recovered));

/**
 * The instalment this month, when it is being spread.
 *
 * The last one carries the rounding, so N instalments add to the penalty
 * exactly - the alternative is a few paise left open for ever.
 */
export function instalmentOf(penalty = {}) {
  const left = outstandingOf(penalty);
  const months = Math.max(1, Number(penalty.months) || 1);
  const done = Number(penalty.recoveries_count) || 0;
  const monthsLeft = Math.max(1, months - done);
  if (monthsLeft <= 1) return left;
  return Math.min(left, Math.round(money(penalty.amount) / months));
}

/**
 * What the Payment of Wages Act has to say about this recovery.
 *
 * Reported, not enforced. Each line names the rule so somebody can decide
 * against it knowingly rather than discovering it at an inspection.
 *
 * `wages` is the month's gross for that person; `otherDeductions` is what is
 * already coming out of that row before this penalty.
 */
export function wageCheck({ amount, wages, otherDeductions = 0, kind } = {}) {
  const warnings = [];
  const take = money(amount);
  const gross = money(wages);
  if (!(gross > 0)) return { warnings, share: null };

  const total = money(otherDeductions) + take;
  const share = total / gross;

  if (share > 0.5) {
    warnings.push({
      rule: 'half of wages',
      says:
        `deductions in this month would come to ${Math.round(share * 100)}% of the ` +
        'gross; the Payment of Wages Act caps the total at 50% (75% where co-operative ' +
        'society dues are involved)',
    });
  }
  if ((kind === 'damage' || kind === 'loss') && take > gross) {
    warnings.push({
      rule: 'more than a month',
      says: 'this one deduction is more than the whole month — spread it over months instead',
    });
  }
  return { warnings, share };
}

/**
 * The register: one line per penalty, plus the totals anybody would ask for.
 *
 * It ASSEMBLES. Every figure comes from the rows handed in; nothing here
 * recalculates a salary.
 */
export function penaltyReport(penalties = [], { from, to } = {}) {
  const rows = penalties
    .filter((p) => {
      if (from && String(p.happened_on || '') < from) return false;
      if (to && String(p.happened_on || '') > to) return false;
      return true;
    })
    .map((p) => ({
      ...p,
      outstanding: outstandingOf(p),
      kind_label: kindLabel(p.kind),
    }));

  const sum = (pick) => money(rows.reduce((t, r) => t + (Number(pick(r)) || 0), 0));
  const byKind = new Map();
  for (const row of rows) {
    const at = byKind.get(row.kind) || { kind: row.kind, label: row.kind_label, count: 0, amount: 0 };
    at.count += 1;
    at.amount = money(at.amount + Number(row.amount || 0));
    byKind.set(row.kind, at);
  }

  return {
    rows,
    totals: {
      count: rows.length,
      amount: sum((r) => r.amount),
      recovered: sum((r) => r.recovered),
      // Waived money is not outstanding - it is money nobody is collecting.
      outstanding: money(
        rows.filter((r) => r.status === 'open').reduce((t, r) => t + outstandingOf(r), 0)
      ),
      waived: sum((r) => (r.status === 'waived' ? outstandingOf(r) : 0)),
    },
    by_kind: [...byKind.values()].sort((a, b) => b.amount - a.amount),
  };
}
