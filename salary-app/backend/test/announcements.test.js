import test from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, covers, forEmployee, isLive, validate } from '../../shared/announcements.js';

/**
 * THE NOTICEBOARD.
 *
 * Dinesh: *"any announcmnet like celbration holiday o bhi"*. The portal's
 * Announcements card used to say there was no noticeboard in the system.
 */

test('a blank date means now, and a start date in the future keeps it off the board', () => {
  const today = '2026-11-21';
  /* Blank both ends is how a cork board works: up now, down when somebody
     takes it down. */
  assert.equal(isLive({}, today), true);
  assert.equal(isLive({ from_on: '2026-11-01' }, today), true);
  assert.equal(isLive({ until_on: '2026-12-31' }, today), true);

  /*
   * WRITTEN IN ADVANCE IS NOT ON THE BOARD. Somebody turning up to a picnic
   * a week early is exactly what a start date is for.
   */
  assert.equal(isLive({ from_on: '2026-12-01' }, today), false);
  assert.equal(isLive({ until_on: '2026-11-20' }, today), false);
  /* The day itself counts, both ends. */
  assert.equal(isLive({ from_on: today, until_on: today }, today), true);
});

test('a notice with no company is the whole office', () => {
  assert.equal(covers({}, 3), true);
  assert.equal(covers({ company_id: null }, 3), true);
  assert.equal(covers({ company_id: 3 }, 3), true);
  /* BOOKNFLY's picnic is not SCALE's. */
  assert.equal(covers({ company_id: 9 }, 3), false);
});

test('what one person sees: pinned first, then newest, and nothing of the office', () => {
  const all = [
    { id: 1, title: 'Old', kind: 'notice', from_on: '2026-01-01' },
    { id: 2, title: 'Pinned', kind: 'holiday', pinned: 1, from_on: '2026-02-01' },
    { id: 3, title: 'Newest', kind: 'celebration', from_on: '2026-11-01' },
    { id: 4, title: 'Theirs', company_id: 99, from_on: '2026-11-02' },
    { id: 5, title: 'Not yet', from_on: '2027-01-01' },
  ];
  const seen = forEmployee(all, { companyId: 1, today: '2026-11-21' });
  assert.deepEqual(seen.map((a) => a.title), ['Pinned', 'Newest', 'Old']);

  /* A whitelist, like every other staff payload. `posted_by` travels because
     "who put this up" is a fair question; nothing else about the office.
     v2.35.0: the two labels carry the time a notice goes up and comes down,
     which is the office's own words about the notice, not about the office. */
  assert.deepEqual(
    Object.keys(seen[0]).sort(),
    ['body', 'from_label', 'from_on', 'id', 'kind', 'pinned', 'posted_by', 'title', 'until_label', 'until_on']
  );
  assert.ok(!JSON.stringify(seen).includes('company_id'));
});

test('a notice needs a title, and cannot come down before it goes up', () => {
  assert.deepEqual(validate({}).problems, ['say what it is about in a line']);
  assert.equal(validate({ title: 'Diwali' }).ok, true);
  assert.deepEqual(
    validate({ title: 'x', from_on: '2026-05-01', until_on: '2026-04-01' }).problems,
    ['it cannot come down before it goes up']
  );
  assert.deepEqual(validate({ title: 'x', kind: 'gossip' }).problems, ['that is not one of the kinds']);
  /* Three kinds, because they read differently on the staff page - not
     because anything behaves differently. */
  assert.deepEqual(KINDS.map((k) => k.key), ['notice', 'celebration', 'holiday']);
});
