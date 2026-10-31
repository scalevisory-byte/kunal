import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_COMPONENTS,
  DEFAULT_TEMPLATE,
  applyTemplate,
  earnedStructure,
  payslipEarnings,
  pfOnBasic,
  salaryStructure,
} from '../../shared/structure.js';

const employee = (over = {}) => ({ monthly_salary: 20000, ...over });

test('nothing typed is no structure, not a structure of zero', () => {
  const s = salaryStructure(employee());
  assert.equal(s.set, false);
  assert.equal(s.over, false);
  assert.equal(s.total, 20000);
});

test('special allowance is whatever is left, so the parts always equal the salary', () => {
  const s = salaryStructure(employee({ basic: 10000, hra: 4000, conveyance: 1600, medical: 1250 }));
  assert.equal(s.set, true);
  assert.equal(s.special, 20000 - 10000 - 4000 - 1600 - 1250);
  assert.equal(s.basic + s.hra + s.conveyance + s.medical + s.special, s.total);
});

test('components adding up to more than the salary is an error, not a negative', () => {
  const s = salaryStructure(employee({ basic: 15000, hra: 8000 }));
  assert.equal(s.over, true);
  assert.equal(s.overBy, 3000);
  assert.equal(s.set, false, 'an impossible breakup is not usable');
  assert.equal(s.special, 0, 'never shown as a negative allowance');
});

test('a structure that exactly fills the salary leaves no special allowance', () => {
  const s = salaryStructure(employee({ basic: 12000, hra: 8000 }));
  assert.equal(s.set, true);
  assert.equal(s.special, 0);
  assert.equal(s.over, false);
});

/* ---------------- the rule that makes this safe ---------------- */

test('a full month earns exactly the structure, to the rupee', () => {
  const emp = employee({ basic: 10000, hra: 4000, conveyance: 1600, medical: 1250 });
  const earned = earnedStructure(emp, { salary: 20000, gross_after_absent: 20000 });
  assert.equal(earned.basic, 10000);
  assert.equal(earned.hra, 4000);
  assert.equal(earned.special, 3150);
  assert.equal(earned.total, 20000);
});

test('a short month pro-rates every line, and they still sum to the gross', () => {
  const emp = employee({ basic: 10000, hra: 4000, conveyance: 1600, medical: 1250 });
  // Three days absent out of 26: gross after absence is 17,692.31.
  const gross = 20000 - (20000 / 26) * 3;
  const earned = earnedStructure(emp, { salary: 20000, gross_after_absent: gross });
  const sum = earned.basic + earned.hra + earned.conveyance + earned.medical + earned.special;
  assert.equal(sum, Math.round(gross), 'the lines must add up to the gross exactly');
  assert.equal(earned.total, Math.round(gross));
  assert.ok(earned.basic < 10000 && earned.basic > 8000);
});

test('awkward numbers still sum exactly - special takes the rounding', () => {
  // Thirds of a salary that does not divide: each line rounds, and the
  // balancing figure absorbs whatever that costs.
  for (const salary of [12345, 9999, 23457, 7777]) {
    for (const absent of [0, 1, 2.5, 7, 13]) {
      const emp = employee({ monthly_salary: salary, basic: Math.round(salary * 0.5), hra: Math.round(salary * 0.2) });
      const gross = salary - (salary / 26) * absent;
      const earned = earnedStructure(emp, { salary, gross_after_absent: gross });
      const sum = earned.basic + earned.hra + earned.conveyance + earned.medical + earned.special;
      assert.equal(sum, Math.round(gross), `${salary} with ${absent} absent did not balance`);
    }
  }
});

test('somebody with no structure earns nothing broken up', () => {
  assert.equal(earnedStructure(employee(), { salary: 20000, gross_after_absent: 20000 }), null);
});

test('a payslip falls back to one Salary line until a structure is set', () => {
  const plain = payslipEarnings(employee(), { gross_after_absent: 18000 });
  assert.deepEqual(plain, [{ key: 'salary', label: 'Salary', amount: 18000 }]);

  const broken = payslipEarnings(
    employee({ basic: 10000, hra: 4000 }),
    { salary: 20000, gross_after_absent: 20000 }
  );
  assert.deepEqual(broken.map((l) => l.key), ['basic', 'hra', 'special']);
  assert.equal(broken.reduce((n, l) => n + l.amount, 0), 20000);
});

/* ---------------- the template ---------------- */

test('the template splits a salary and never overruns it', () => {
  const parts = applyTemplate(20000);
  assert.equal(parts.basic, 10000);
  assert.equal(parts.hra, 4000);     // 40% of basic, because Vadodara is not a metro
  assert.equal(parts.conveyance, 1600);
  assert.equal(parts.medical, 1250);
  assert.equal(salaryStructure({ monthly_salary: 20000, ...parts }).over, false);
});

test('a small salary gets a smaller allowance rather than a negative special', () => {
  for (const salary of [3000, 5000, 8000, 12000, 15000]) {
    const parts = applyTemplate(salary);
    const s = salaryStructure({ monthly_salary: salary, ...parts });
    assert.equal(s.over, false, `${salary} overran`);
    assert.ok(s.special >= 0);
    assert.ok(parts.basic > 0);
  }
});

test('a zero salary produces nothing rather than throwing', () => {
  assert.deepEqual(applyTemplate(0), { basic: 0, hra: 0, conveyance: 0, medical: 0 });
});

test('the template is adjustable', () => {
  const parts = applyTemplate(30000, { ...DEFAULT_TEMPLATE, basicPercent: 60, hraPercentOfBasic: 50 });
  assert.equal(parts.basic, 18000);
  assert.equal(parts.hra, 9000);
});

/* ---------------- PF: reported, never changed ---------------- */

test('PF on basic is reported against what is actually deducted', () => {
  const pf = pfOnBasic(employee({ basic: 10000, hra: 4000, pf: 1800 }));
  assert.equal(pf.wages, 10000);
  assert.equal(pf.would, 1200);
  assert.equal(pf.deducted, 1800);
  assert.equal(pf.matches, false);
  assert.equal(pf.difference, 600);
  assert.equal(pf.capped, false);
});

test('PF wages stop at the statutory ceiling', () => {
  const pf = pfOnBasic({ monthly_salary: 60000, basic: 30000, pf: 1800 });
  assert.equal(pf.wages, 15000);
  assert.equal(pf.would, 1800);
  assert.equal(pf.matches, true);
  assert.equal(pf.capped, true);
});

test('no structure means nothing to say about PF', () => {
  assert.equal(pfOnBasic(employee({ pf: 1800 })), null);
});

test('every component a payslip can print has a label and a hint', () => {
  for (const c of ALL_COMPONENTS) {
    assert.ok(c.key && c.label, 'a component with no name');
    assert.ok(c.hint, `${c.key} does not explain itself`);
  }
});

test('the components scale off the master salary, not the month being paid', () => {
  // A month where the salary itself was edited - a raise part-way, or a
  // corrected figure. The breakup must still split, rather than vanishing
  // because the parts now add up to more than that month's salary.
  const emp = { monthly_salary: 20000, basic: 10000, hra: 4000, conveyance: 1600, medical: 1250 };

  const lower = earnedStructure(emp, { salary: 15000, gross_after_absent: 15000 });
  assert.equal(lower.basic, 7500, 'half the master salary is half the basic');
  assert.equal(lower.total, 15000);
  assert.equal(
    lower.basic + lower.hra + lower.conveyance + lower.medical + lower.special,
    15000
  );

  const higher = earnedStructure(emp, { salary: 26000, gross_after_absent: 26000 });
  assert.equal(higher.basic, 13000);
  assert.equal(
    higher.basic + higher.hra + higher.conveyance + higher.medical + higher.special,
    26000
  );
});

test('a payroll row carrying no master salary still splits off the month', () => {
  const earned = earnedStructure(
    { basic: 10000, hra: 4000 },
    { salary: 20000, gross_after_absent: 20000 }
  );
  assert.equal(earned.basic, 10000);
  assert.equal(earned.total, 20000);
});
