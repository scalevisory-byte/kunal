import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WEIGHTS,
  matchScore,
  toMonthlySalary,
  toSkills,
  toYearBand,
  toYears,
} from '../../shared/match.js';

test('the weights add up to 100, so a score is a percentage', () => {
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100);
});

test('an experience band written the way people write it', () => {
  // The hyphen matters: stripping it turned "1-3 yrs" into a minimum of 3,
  // which rejected every junior candidate for a junior job.
  assert.deepEqual(toYearBand('1-3 yrs'), { min: 1, max: 3 });
  assert.deepEqual(toYearBand('2 to 5 years'), { min: 2, max: 5 });
  assert.deepEqual(toYearBand('fresher'), { min: 0, max: 0 });
  assert.deepEqual(toYearBand('5+ years'), { min: 5, max: null });
  // Nothing asked for: both ends null, which scoreExperience reads as
  // "cannot be failed" rather than as a band of zero.
  assert.deepEqual(toYearBand(''), { min: null, max: null });
});

test('years of experience out of free text', () => {
  assert.equal(toYears('2 years'), 2);
  assert.equal(toYears('2.5 yrs'), 2.5);
  assert.equal(toYears('fresher'), 0);
  assert.equal(toYears('6 months'), 0.5);
  assert.equal(toYears(''), null);
});

test('salary, however it was typed', () => {
  assert.equal(toMonthlySalary('18000'), 18000);
  assert.equal(toMonthlySalary('18k'), 18000);
  // The low end of a range is what the candidate will actually take.
  assert.equal(toMonthlySalary('₹10-18k/month'), 10000);
  // "l" alone does not match inside "lpa", which silently returned 0.
  assert.equal(toMonthlySalary('3.6 LPA'), 30000);
  assert.equal(toMonthlySalary('2.5 lakh'), Math.round(250000 / 12));
  assert.equal(toMonthlySalary(''), null);
});

test('skills split on commas, slashes and the word and', () => {
  assert.deepEqual(toSkills('Tally, GST / Excel and Busy'), ['tally', 'gst', 'excel', 'busy']);
  // "and" only splits on its own. Android is one skill, not Andro + id.
  assert.deepEqual(toSkills('Android development and Kotlin'), ['android development', 'kotlin']);
  assert.deepEqual(toSkills('Demand planning, SAP'), ['demand planning', 'sap']);
});

const vacancy = {
  title: 'Accountant',
  location: 'Vadodara',
  experience_band: '1-3 yrs',
  salary_min: '15000',
  salary_max: '22000',
  skills: 'Tally, GST, Excel',
  education: 'B.Com',
};

test('a candidate who fits scores high, one who does not scores low', () => {
  const good = matchScore(
    {
      location: 'Bhayli, Vadodara',
      experience: '2 years',
      skills: 'Tally, GST, Excel, Busy',
      education: 'B.Com',
      expected_salary: '20000',
    },
    vacancy
  );
  const poor = matchScore(
    {
      location: 'Chennai',
      experience: '12 years',
      skills: 'Welding, Fitting',
      education: 'ITI',
      expected_salary: '60000',
    },
    vacancy
  );
  assert.ok(good.total >= 85, `good candidate scored ${good.total}`);
  assert.ok(poor.total <= 35, `poor candidate scored ${poor.total}`);
  assert.ok(good.total > poor.total);
});

test('the score explains itself - factors and what is missing', () => {
  const { factors, missing } = matchScore(
    { location: 'Surat', experience: '2 years', skills: 'Tally', education: 'B.Com' },
    vacancy
  );
  assert.deepEqual(Object.keys(factors).sort(), [
    'education',
    'experience',
    'location',
    'salary',
    'skills',
  ]);
  for (const [name, f] of Object.entries(factors)) {
    assert.ok(Number.isFinite(f.score), `${name} has no score`);
    assert.ok(f.score <= f.of, `${name} scored more than its weight`);
    assert.ok(f.note, `${name} does not say why`);
  }
  // The two skills the vacancy asked for and this person has not got.
  assert.ok(missing.some((m) => /gst/i.test(m)));
  assert.ok(missing.some((m) => /excel/i.test(m)));
});

test('a same-city candidate in a different area is a full location match', () => {
  const same = matchScore({ location: 'Bhayli, Vadodara' }, { location: 'Vadodara' });
  const other = matchScore({ location: 'Rajkot' }, { location: 'Vadodara' });
  assert.equal(same.factors.location.score, WEIGHTS.location);
  assert.equal(other.factors.location.score, 0);
});

test('nothing known about a candidate does not score as a perfect match', () => {
  const { total } = matchScore({ name: 'Unknown' }, vacancy);
  assert.ok(total < 60, `an empty profile scored ${total}`);
});
