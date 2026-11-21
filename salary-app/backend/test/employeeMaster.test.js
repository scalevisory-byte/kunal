import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_FIELDS,
  REFUSED_WITHOUT,
  SECTIONS,
  STARRED,
  completeness,
  duplicatesOf,
  fieldApplies,
  lifecycleOf,
  maskAadhaar,
  maskAccount,
  maskPan,
  missingRequired,
} from '../../shared/employeeMaster.js';

/**
 * THE EMPLOYEE MASTER.
 *
 * Dinesh's brief: a *"complete, professional New Employee form with 8
 * sections"*, duplicate detection, drafts, and PAN and Aadhaar masked.
 */

test('there are eight sections and no field belongs to two of them', () => {
  assert.equal(SECTIONS.length, 8);
  const seen = new Map();
  for (const f of ALL_FIELDS) {
    assert.ok(!seen.has(f.field), `${f.field} is in both ${seen.get(f.field)} and ${f.section}`);
    seen.set(f.field, f.section);
  }
  // Every section says why it exists; an unexplained tab is one people skip.
  for (const s of SECTIONS) assert.ok(s.why && s.why.length > 10, `${s.key} has no reason`);
});

test('a save refuses ONLY a name and a company', () => {
  /*
   * NOT the joining date and NOT the salary, however loudly the form stars
   * them. Every other door into this table - the staff spreadsheet import,
   * the hiring handover, the bulk add - wants no more than this, and a rule
   * enforced on one door of several is a surprise rather than a rule.
   */
  assert.deepEqual(REFUSED_WITHOUT, ['name', 'company_id']);
  assert.deepEqual(missingRequired({}), ['Full name', 'Company']);
  assert.deepEqual(missingRequired({ name: 'Amit', company_id: 2 }), []);
  // Starred is a different, larger list: what a FINISHED record has.
  assert.ok(STARRED.includes('joined_on') && STARRED.includes('monthly_salary'));
  assert.ok(STARRED.length > REFUSED_WITHOUT.length);
});

test('a mask keeps the last few characters, and nothing else', () => {
  assert.equal(maskPan('ABCDE1234F'), '••••••234F');
  assert.equal(maskAadhaar('1234 5678 1234'), '•••• •••• 1234');
  assert.equal(maskAccount('50100123456789'), '••••••••••6789');
  /* A blank is a blank, not a row of dots - dots would read as "there is
     something here that you cannot see". */
  assert.equal(maskPan(''), '');
  assert.equal(maskPan(null), '');
  // Too short to hide is left alone rather than hidden entirely.
  assert.equal(maskAccount('123'), '123');
});

test('a duplicate is a warning with a reason, and only a code clash blocks', () => {
  const staff = [
    { id: 1, name: 'Amit Shah', code: 'BOO-001', phone: '9825012345', pan: 'ABCDE1234F' },
    { id: 2, name: 'Amit Shah', dob: '1990-05-02' },
    { id: 3, name: 'Riya Pal', aadhaar: '123456781234' },
  ];

  /* The mobile is the strongest everyday signal, and +91 or a leading 0 is
     the same number. */
  const byPhone = duplicatesOf({ name: 'Different Name', phone: '+91 98250 12345' }, staff);
  assert.equal(byPhone.length, 1);
  assert.deepEqual(byPhone[0].why, ['the same mobile number']);
  assert.equal(byPhone[0].blocking, false);

  /* A NAME ALONE IS NOT A DUPLICATE - there are two Patels in most offices
     in Gujarat - but a name and a date of birth is worth asking about. */
  const byName = duplicatesOf({ name: 'Amit Shah' }, staff);
  assert.equal(byName.length, 2);
  assert.ok(byName.every((d) => !d.blocking));
  const withDob = duplicatesOf({ name: 'Amit Shah', dob: '1990-05-02' }, staff);
  assert.ok(withDob[0].why.includes('the same name and date of birth'));

  /* The code is a CLASH, not a resemblance: two people with one code means
     the punch import, the bank file and the muster roll each pick whichever
     they find first. */
  const clash = duplicatesOf({ name: 'Somebody', code: 'boo-001' }, staff);
  assert.equal(clash[0].blocking, true);
  assert.deepEqual(clash[0].why, ['the same employee code']);

  /* Editing somebody must not find THEM. */
  assert.deepEqual(duplicatesOf({ name: 'Amit Shah', code: 'BOO-001' }, staff, { exceptId: 1 })
    .filter((d) => d.id === 1), []);

  /* A part-filled Aadhaar is not an Aadhaar: matching on four digits would
     flag half the staff. */
  assert.deepEqual(duplicatesOf({ aadhaar: '1234' }, staff), []);
  assert.equal(duplicatesOf({ aadhaar: '1234 5678 1234' }, staff)[0].id, 3);
});

test('completeness counts only the fields that apply', () => {
  /* Somebody paid in cash is not three boxes short for having no IFSC, and
     a permanent address marked "same as present" is not five blanks. */
  const cash = { name: 'A', company_id: 1, payment_mode: 'Cash', perm_same: true };
  const bank = { name: 'A', company_id: 1, payment_mode: 'Bank', perm_same: false };
  assert.ok(completeness(cash).want < completeness(bank).want);

  assert.equal(fieldApplies({ unless: 'cash' }, cash), false);
  assert.equal(fieldApplies({ unless: 'cash' }, bank), true);
  assert.equal(fieldApplies({ unless: 'perm_same' }, cash), false);

  /* A section with nothing to type is 100%, not 0% - Documents is a note,
     and a nought there would read as work undone for ever. */
  assert.equal(completeness({}).sections.documents.percent, 100);
});

test('the lifecycle is worked out, never stored', () => {
  const on = (e) => lifecycleOf(e, '2026-11-21').key;
  assert.equal(on({ is_draft: 1 }), 'draft');
  assert.equal(on({ left_on: '2026-10-01' }), 'left');
  assert.equal(on({ active: 0 }), 'left');
  assert.equal(on({ joined_on: '2026-12-01' }), 'joining');
  assert.equal(on({ joined_on: '2026-01-01', probation_until: '2026-12-31' }), 'probation');
  assert.equal(on({ joined_on: '2026-01-01', probation_until: '2026-06-30' }), 'working');
  /*
   * A DRAFT WINS OVER EVERYTHING. A half-typed form with a leaving date on
   * it by accident is still a draft, and reading it as a leaver would hide
   * it from the list of things to finish.
   */
  assert.equal(on({ is_draft: 1, left_on: '2026-01-01' }), 'draft');
});
