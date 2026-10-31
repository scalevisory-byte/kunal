import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PT_SLABS_GUJARAT,
  contributionsFor,
  esiContributionPeriod,
  esiFor,
  isAuto,
  pfFor,
  ptFor,
  wouldChange,
} from '../../shared/contributions.js';

/* ---------------- PF ---------------- */

test('PF is 12% of Basic when a salary has been broken up', () => {
  const pf = pfFor({ wages_basic: 10000, fallback: 20000 });
  assert.equal(pf.on, 'basic');
  assert.equal(pf.wages, 10000);
  assert.equal(pf.employee, 1200);
  assert.equal(pf.employer, 1200);
  assert.equal(pf.pension, 833);
  assert.equal(pf.provident, 367);
  assert.equal(pf.capped, false);
});

test('PF falls back to the gross when there is no Basic to charge', () => {
  const pf = pfFor({ wages_basic: null, fallback: 20000 });
  assert.equal(pf.on, 'gross');
  // Still capped at the ceiling, which is why the figure is the familiar 1,800.
  assert.equal(pf.wages, 15000);
  assert.equal(pf.employee, 1800);
  assert.equal(pf.capped, true);
});

test('PF wages stop at the ceiling, and so does the pension share', () => {
  const pf = pfFor({ wages_basic: 40000, fallback: 80000 });
  assert.equal(pf.wages, 15000);
  assert.equal(pf.employee, 1800);
  assert.equal(pf.pension, 1250);
  assert.equal(pf.provident, 550);
  assert.equal(pf.pension + pf.provident, pf.employer);
});

test('the employer cost carries EDLI and admin, which is what a CTC needs', () => {
  const pf = pfFor({ wages_basic: 15000, fallback: 15000 });
  assert.equal(pf.edli, 75);
  assert.equal(pf.admin, 75);
  assert.equal(pf.employer_cost, pf.employer + 75 + 75);
  assert.ok(pf.employer_cost > pf.employer, 'the employer always pays more than its 12%');
});

test('a zero wage produces zeroes, not NaN', () => {
  const pf = pfFor({ wages_basic: 0, fallback: 0 });
  for (const value of Object.values(pf)) {
    assert.ok(typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value));
  }
  assert.equal(pf.employee, 0);
});

/* ---------------- ESI ---------------- */

test('ESI applies under the wage limit and the shares round up', () => {
  const esi = esiFor({ gross: 18000 });
  assert.equal(esi.eligible, true);
  // 0.75% of 18,000 is 135 exactly.
  assert.equal(esi.employee, 135);
  assert.equal(esi.employer, 585);
});

test('ESI rounds a part rupee UP, which is the ESIC own rule', () => {
  const esi = esiFor({ gross: 10001 });
  // 0.75% is 75.0075 - a rupee is added, not dropped.
  assert.equal(esi.employee, 76);
  assert.equal(esi.employer, Math.ceil((10001 * 3.25) / 100));
});

test('over the wage limit there is no ESI, and it says so', () => {
  const esi = esiFor({ gross: 25000 });
  assert.equal(esi.eligible, false);
  assert.equal(esi.over_limit, true);
  assert.equal(esi.employee, 0);
  assert.equal(esi.employer, 0);
});

test('exactly at the limit is still covered', () => {
  assert.equal(esiFor({ gross: 21000 }).eligible, true);
  assert.equal(esiFor({ gross: 21001 }).eligible, false);
});

test('the contribution periods are April-September and October-March', () => {
  assert.equal(esiContributionPeriod(4), 'Apr-Sep');
  assert.equal(esiContributionPeriod(9), 'Apr-Sep');
  assert.equal(esiContributionPeriod(10), 'Oct-Mar');
  assert.equal(esiContributionPeriod(3), 'Oct-Mar');
});

/* ---------------- professional tax ---------------- */

test('Gujarat PT is nil up to 12,000 and 200 above it', () => {
  assert.equal(ptFor(11999), 0);
  assert.equal(ptFor(12000), 0);
  assert.equal(ptFor(12001), 200);
  assert.equal(ptFor(50000), 200);
});

test("a period's own threshold and amount win, so a paid month never moves", () => {
  // The sheet's original rule, carried on every period.
  assert.equal(ptFor(15000, { threshold: 20000, amount: 150 }), 0);
  assert.equal(ptFor(25000, { threshold: 20000, amount: 150 }), 150);
});

test('the slabs are data, so another state is a list and not a rewrite', () => {
  const maharashtra = [
    { upto: 7500, amount: 0 },
    { upto: 10000, amount: 175 },
    { upto: null, amount: 200 },
  ];
  assert.equal(ptFor(7000, { slabs: maharashtra }), 0);
  assert.equal(ptFor(9000, { slabs: maharashtra }), 175);
  assert.equal(ptFor(30000, { slabs: maharashtra }), 200);
  assert.equal(PT_SLABS_GUJARAT.at(-1).amount, 200);
});

/* ---------------- nothing switches itself on ---------------- */

test('everybody starts on fixed, so the typed figure is what is deducted', () => {
  assert.equal(isAuto(undefined), false);
  assert.equal(isAuto('fixed'), false);
  assert.equal(isAuto('auto'), true);

  const c = contributionsFor(
    { pf: 1800, esi: 150 },
    { earned_basic: 10000, gross_after_absent: 20000, gross_salary: 20000 }
  );
  assert.equal(c.pf.deducted, 1800, 'the typed amount, untouched');
  assert.equal(c.esi.deducted, 150);
  // And it still says what the rule would give, without applying it.
  assert.equal(c.pf.employee, 1200);
  assert.equal(c.pf.differs, true);
});

test('choosing auto is what makes the rule apply', () => {
  const under = contributionsFor(
    { pf: 1800, esi: 999, pf_mode: 'auto', esi_mode: 'auto' },
    { earned_basic: 10000, gross_after_absent: 20000, gross_salary: 20000 }
  );
  assert.equal(under.pf.deducted, 1200, '12% of basic, not the typed 1,800');
  // 20,000 is under the 21,000 limit, so ESI applies and the typed 999 is
  // ignored.
  assert.equal(under.esi.deducted, 150);

  const over = contributionsFor(
    { pf: 1800, esi: 999, pf_mode: 'auto', esi_mode: 'auto' },
    { earned_basic: 15000, gross_after_absent: 30000, gross_salary: 30000 }
  );
  assert.equal(over.esi.deducted, 0, 'over the wage limit, nothing is deducted');
  assert.equal(over.esi.over_limit, true);
});

test('what switching would do is answerable before anything is switched', () => {
  const change = wouldChange(
    { pf: 1800, esi: 0 },
    { earned_basic: 10000, gross_after_absent: 20000, gross_salary: 20000 }
  );
  assert.equal(change.pf.now, 1800);
  assert.equal(change.pf.then, 1200);
  assert.equal(change.pf.change, -600);
  // Less PF deducted means more in hand.
  assert.equal(change.take_home, 600 - change.esi.change);
});

test('a bigger deduction means a SMALLER take-home, and the sign says so', () => {
  // Pinned because the panel once read "they would take home ₹1,215 more"
  // when switching on a PF of ₹1,080 and an ESI of ₹135.
  const more = wouldChange(
    { pf: 0, esi: 0 },
    { earned_basic: 9000, gross_after_absent: 18000, gross_salary: 18000 }
  );
  assert.equal(more.pf.then, 1080);
  assert.equal(more.esi.then, 135);
  assert.ok(more.take_home < 0, 'deducting more cannot increase take-home');
  assert.equal(more.take_home, -1215);

  const less = wouldChange(
    { pf: 1800, esi: 0 },
    { earned_basic: 9000, gross_after_absent: 18000, gross_salary: 18000 }
  );
  assert.ok(less.take_home > 0, 'deducting less leaves more in hand');
  assert.equal(less.take_home, 1800 - 1080 - 135);
});
