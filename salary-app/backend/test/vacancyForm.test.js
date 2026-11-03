import test from 'node:test';
import assert from 'node:assert/strict';
import { fromBand, toBand } from '../../shared/experienceBand.js';
import { validateVacancy } from '../../shared/vacancyForm.js';
import { toYearBand } from '../../shared/match.js';

/*
 * The redesigned New Vacancy form asks for a minimum and a maximum experience.
 * The database has one `experience_band` text column, and match.js scores every
 * candidate by parsing it. These tests pin that the two boxes and that column
 * stay the same thing - a band written by the form must read back out of it
 * unchanged, AND must mean to the scorer exactly what the form said.
 */

test('two boxes compose into a band the scorer reads the same way', () => {
  for (const [min, max, expected] of [
    [1, 3, { min: 1, max: 3 }],
    [0, 2, { min: 0, max: 2 }],
    [5, null, { min: 5, max: null }],
    [2, 2, { min: 2, max: null }], // "2 yrs" is a floor to the scorer
    [0, 1, { min: 0, max: 1 }],
  ]) {
    const band = toBand(min, max);
    const read = toYearBand(band);
    assert.deepEqual(read, expected, `${min}-${max} wrote "${band}", scored as ${JSON.stringify(read)}`);
  }
});

/*
 * Caught by the test above, and worth keeping: writing the word "Fresher" for
 * nought-to-one years made match.js read the ceiling as NOUGHT, so a candidate
 * with a year behind them fell outside a band the form had just shown as
 * nought to one. The word is read, never written.
 */
test('a fresher band is written as a range, because the word scores differently', () => {
  assert.equal(toBand(0, 1), '0-1 yrs');
  assert.deepEqual(toYearBand(toBand(0, 1)), { min: 0, max: 1 });
  assert.deepEqual(toYearBand('Fresher'), { min: 0, max: 0 }, 'what the word actually means');
  // Still read, because vacancies on file already carry it.
  assert.deepEqual(fromBand('Fresher'), { min: 0, max: 1 });
});

test('a band opens back into the boxes it was written from', () => {
  for (const [min, max] of [[1, 3], [0, 2], [5, ''], [2.5, 4], ['', '']]) {
    const band = toBand(min, max);
    const back = fromBand(band);
    assert.equal(String(back.min), String(min === '' ? '' : min), `min of "${band}"`);
    assert.equal(String(back.max), String(max === '' ? '' : max), `max of "${band}"`);
  }
});

test('bands typed by hand before this form existed still open', () => {
  // Every shape already sitting in a real database.
  assert.deepEqual(fromBand('1-3 yrs'), { min: 1, max: 3 });
  assert.deepEqual(fromBand('2 to 4 years'), { min: 2, max: 4 });
  assert.deepEqual(fromBand('3+ yrs'), { min: 3, max: '' });
  assert.deepEqual(fromBand('Fresher'), { min: 0, max: 1 });
  assert.deepEqual(fromBand('5'), { min: 5, max: '' });
  assert.deepEqual(fromBand(''), { min: '', max: '' });
  assert.deepEqual(fromBand(null), { min: '', max: '' });
  // Not a number anywhere: not asked for, never nought.
  assert.deepEqual(fromBand('negotiable'), { min: '', max: '' });
});

test('nothing asked for stays nothing asked for', () => {
  assert.equal(toBand('', ''), '');
  assert.equal(toBand(null, null), '');
  // Because match.js must not then score anybody on experience at all.
  assert.deepEqual(toYearBand(toBand('', '')), { min: null, max: null });
});

/* ---------------- the rules the form refuses on ---------------- */

const ok = { company_id: 1, title: 'Travel Consultant', location: 'Vadodara', positions: 1 };

test('company, title, location and seats are all required', () => {
  const problems = validateVacancy({});
  assert.ok(problems.company_id);
  assert.ok(problems.title);
  assert.ok(problems.location);
  assert.ok(problems.positions);
  assert.deepEqual(validateVacancy(ok), {});
});

test('a salary range cannot be upside down, however it is typed', () => {
  assert.ok(validateVacancy({ ...ok, salary_min: '25000', salary_max: '18000' }).salary_max);
  assert.deepEqual(validateVacancy({ ...ok, salary_min: '18000', salary_max: '25000' }), {});
  // The same figures written the way people actually write them.
  assert.ok(validateVacancy({ ...ok, salary_min: '25k', salary_max: '18k' }).salary_max);
  assert.ok(validateVacancy({ ...ok, salary_min: '6 LPA', salary_max: '30000' }).salary_max);
  // Unreadable is NOT refused - "negotiable" is a real answer, and refusing it
  // would be worse than not comparing it.
  assert.deepEqual(validateVacancy({ ...ok, salary_min: 'negotiable', salary_max: '' }), {});
});

test('experience cannot run backwards', () => {
  assert.ok(validateVacancy({ ...ok, experience_min: 5, experience_max: 2 }).experience_max);
  assert.deepEqual(validateVacancy({ ...ok, experience_min: 1, experience_max: 3 }), {});
  assert.deepEqual(validateVacancy({ ...ok, experience_min: 0, experience_max: 2 }), {});
  // A floor with no ceiling is the commonest band there is.
  assert.deepEqual(validateVacancy({ ...ok, experience_min: 5, experience_max: '' }), {});
  assert.ok(validateVacancy({ ...ok, experience_min: -1 }).experience_min);
});

test('applications cannot close after the seat is needed', () => {
  assert.ok(validateVacancy({ ...ok, apply_by: '2026-12-20', needed_by: '2026-12-01' }).apply_by);
  assert.deepEqual(validateVacancy({ ...ok, apply_by: '2026-12-01', needed_by: '2026-12-20' }), {});
  // Same day is fine: apply on the morning, start in the afternoon.
  assert.deepEqual(validateVacancy({ ...ok, apply_by: '2026-12-01', needed_by: '2026-12-01' }), {});
  assert.ok(validateVacancy({ ...ok, apply_by: 'next week' }).apply_by);
});

test('test settings are only checked when the assessment is switched on', () => {
  const withTest = { ...ok, test_url: '', test_pass_percent: 500 };
  // Off: a pass mark left behind in a box nobody can see must not block a save.
  assert.deepEqual(validateVacancy(withTest, { assessment: false }), {});
  // On: both are wrong and both are named.
  const problems = validateVacancy(withTest, { assessment: true });
  assert.ok(problems.test_url, 'an assessment with no link');
  assert.ok(problems.test_pass_percent, '500% is not a pass mark');
});

test('a test link has to be a web address', () => {
  const on = { assessment: true };
  assert.ok(validateVacancy({ ...ok, test_url: 'office-admin test' }, on).test_url);
  assert.deepEqual(
    validateVacancy({ ...ok, test_url: 'https://crm.zyntajobs.in/test?t=office-admin' }, on),
    {}
  );
});

test('a timing of nought is refused; blank is no limit', () => {
  const on = { assessment: true };
  const base = { ...ok, test_url: 'https://crm.zyntajobs.in/test' };
  // Nought seconds would read to a test system as "no time at all".
  assert.ok(validateVacancy({ ...base, test_seconds_per_question: 0 }, on).test_seconds_per_question);
  assert.ok(validateVacancy({ ...base, test_duration_minutes: 0 }, on).test_duration_minutes);
  assert.deepEqual(validateVacancy({ ...base, test_seconds_per_question: '', test_duration_minutes: '' }, on), {});
  assert.deepEqual(validateVacancy({ ...base, test_seconds_per_question: 30, test_duration_minutes: 20 }, on), {});
});

test('seats must be at least one, and a typo is caught', () => {
  assert.ok(validateVacancy({ ...ok, positions: 0 }).positions);
  assert.ok(validateVacancy({ ...ok, positions: 5000 }).positions);
  assert.deepEqual(validateVacancy({ ...ok, positions: 12 }), {});
});

/*
 * The API enforces the same list. The form is one way in; a vacancy posted
 * around it with its salary range upside down would score every candidate
 * against nonsense, so the server refuses it too.
 */
test('the API refuses what the form refuses', async () => {
  process.env.DATA_DIR ||= (await import('node:fs')).mkdtempSync(
    (await import('node:path')).join((await import('node:os')).tmpdir(), 'vac-')
  );
  process.env.APP_PASSWORD ||= 'open-sesame';
  process.env.SERVE_FRONTEND = 'false';
  const { createCompany } = await import('../src/db.js');
  const { createVacancy, updateVacancy } = await import('../src/hiring.js');

  const company = createCompany({ name: `Vac rules ${Date.now()}` });
  const base = { company_id: company.id, title: 'Travel Consultant', location: 'Vadodara' };

  assert.throws(() => createVacancy({ ...base, salary_min: '25000', salary_max: '18000' }), /below the bottom/);
  assert.throws(() => createVacancy({ ...base, experience_band: '8-2 yrs' }), /below the least/);
  assert.throws(
    () => createVacancy({ ...base, apply_by: '2026-12-20', needed_by: '2026-12-01' }),
    /still be open/
  );

  const good = createVacancy({ ...base, salary_min: '18000', salary_max: '25000', experience_band: '1-3 yrs' });
  assert.equal(good.salary_max, '25000');

  // A patch is judged against what the row WILL be, not the patch alone:
  // sending only a new maximum has to be read against the stored minimum.
  assert.throws(() => updateVacancy(good.id, { salary_max: '9000' }), /below the bottom/);
  assert.equal(updateVacancy(good.id, { salary_max: '30000' }).salary_max, '30000');
});
