import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RESTRICTIONS,
  distanceMetres,
  formatDistance,
  judgePunch,
  nearestOffice,
  nextKind,
  punchAllowed,
  punchesToDay,
} from '../../shared/punchClock.js';

// Two real places in Vadodara, about 3 km apart.
const alkapuri = { id: 1, name: 'Alkapuri office', lat: 22.3072, lng: 73.1812, radius_m: 200 };
const bhayli = { id: 2, name: 'Bhayli site', lat: 22.2900, lng: 73.1300, radius_m: 300 };

test('distance is in metres and symmetrical', () => {
  const there = distanceMetres(alkapuri, bhayli);
  const back = distanceMetres(bhayli, alkapuri);
  assert.equal(there, back);
  assert.ok(there > 4000 && there < 7000, `got ${there} m`);
  assert.equal(distanceMetres(alkapuri, alkapuri), 0);
});

test('a missing or nonsense point is null, never zero', () => {
  // Zero would read as "standing in the office", which is the worst possible
  // answer to "we do not know where they were".
  assert.equal(distanceMetres(null, alkapuri), null);
  assert.equal(distanceMetres({ lat: 'x', lng: 'y' }, alkapuri), null);
  assert.equal(distanceMetres({ lat: 22.3 }, alkapuri), null);
});

test('the nearest office is found, and the fence is its own radius', () => {
  const atDesk = { lat: 22.3073, lng: 73.1813 };
  const near = nearestOffice(atDesk, [alkapuri, bhayli]);
  assert.equal(near.office.id, 1);
  assert.ok(near.metres < 50);
  assert.equal(near.inside, true);
  assert.equal(near.radius, 200);

  // Bhayli's wider fence is used when Bhayli is the nearest.
  const onSite = nearestOffice({ lat: 22.2902, lng: 73.1302 }, [alkapuri, bhayli]);
  assert.equal(onSite.office.id, 2);
  assert.equal(onSite.radius, 300);
});

test('a punch outside the fence still names where it was', () => {
  const j = judgePunch({ point: { lat: 22.3400, lng: 73.2100 }, accuracy: 20, offices: [alkapuri] });
  assert.equal(j.located, true);
  assert.equal(j.inside_fence, false);
  assert.ok(j.distance_m > 200);
  assert.match(j.note, /from Alkapuri office/);
});

test('a vague fix cannot say somebody was inside - it says it does not know', () => {
  const j = judgePunch({ point: { lat: 22.3072, lng: 73.1812 }, accuracy: 2000, offices: [alkapuri] });
  assert.equal(j.located, true);
  assert.equal(j.vague, true);
  // Not true, and not false either.
  assert.equal(j.inside_fence, null);
  assert.match(j.note, /accurate to 2000 m/);
});

test('no location shared is recorded as that, not as being elsewhere', () => {
  const j = judgePunch({ offices: [alkapuri] });
  assert.equal(j.located, false);
  assert.equal(j.inside_fence, null);
  assert.equal(j.distance_m, null);
  assert.match(j.note, /not shared/);
});

test('with no offices set up nothing is judged, and it says so', () => {
  const j = judgePunch({ point: { lat: 22.3, lng: 73.1 }, accuracy: 10, offices: [] });
  assert.equal(j.located, true);
  assert.equal(j.inside_fence, null);
  assert.match(j.note, /no office locations set/);
});

test('distance reads in metres up close and kilometres far away', () => {
  assert.equal(formatDistance(150), '150 m');
  assert.equal(formatDistance(2400), '2.4 km');
  assert.equal(formatDistance(23400), '23 km');
  assert.equal(formatDistance(null), '');
});

/* ---------------- punches into a day ---------------- */

const punch = (at, kind, extra = {}) => ({ at: `2026-10-15T${at}:00`, kind, located: true, inside_fence: true, ...extra });

test('the first punch in and the last punch out make the day', () => {
  const day = punchesToDay([
    punch('09:28', 'in'),
    punch('13:05', 'out'),
    punch('13:48', 'in'),
    punch('18:34', 'out'),
  ]);
  assert.equal(day.in_time, '09:28');
  assert.equal(day.out_time, '18:34');
  assert.equal(day.punches, 4);
  assert.deepEqual(day.flags, []);
});

test('punches out of order still give the right day', () => {
  const day = punchesToDay([punch('18:34', 'out'), punch('09:28', 'in')]);
  assert.equal(day.in_time, '09:28');
  assert.equal(day.out_time, '18:34');
});

test('somebody who never punched out is flagged, not guessed at', () => {
  const day = punchesToDay([punch('09:30', 'in')]);
  assert.equal(day.in_time, '09:30');
  assert.equal(day.out_time, '', 'no departure may be invented');
  assert.ok(day.flags.includes('never punched out'));
});

test('a punch away from the office rides into the day as a flag', () => {
  const day = punchesToDay([
    punch('09:30', 'in', { inside_fence: false }),
    punch('18:00', 'out'),
  ]);
  assert.ok(day.flags.includes('punched away from the office'));
  assert.equal(day.in_time, '09:30', 'and the day is still recorded');
});

test('no punches at all is null, not an empty day', () => {
  assert.equal(punchesToDay([]), null);
  assert.equal(punchesToDay([{ at: 'nonsense', kind: 'in' }]), null);
});

test('the phone offers the button that makes sense next', () => {
  assert.equal(nextKind([]), 'in');
  assert.equal(nextKind([punch('09:30', 'in')]), 'out');
  assert.equal(nextKind([punch('09:30', 'in'), punch('13:00', 'out')]), 'in');
});

/* ---------------- what is allowed ---------------- */

test('punching from a phone is off until somebody turns it on', () => {
  assert.equal(DEFAULT_RESTRICTIONS.enabled, false);
  const j = judgePunch({ point: { lat: 22.3072, lng: 73.1812 }, accuracy: 10, offices: [alkapuri] });
  assert.equal(punchAllowed(j, {}).ok, false);
  assert.equal(punchAllowed(j, { enabled: true }).ok, true);
});

test('a punch outside the fence is recorded by default, not refused', () => {
  // The whole argument: refusing it leaves the person with no attendance at
  // all, and somebody retypes it that evening with no record of what happened.
  const away = judgePunch({ point: { lat: 22.3400, lng: 73.2100 }, accuracy: 20, offices: [alkapuri] });
  assert.equal(punchAllowed(away, { enabled: true }).ok, true);
  // It can be made strict, deliberately.
  const strict = punchAllowed(away, { enabled: true, allowOutsideFence: false });
  assert.equal(strict.ok, false);
  assert.match(strict.reason, /from the office/);
});

test('a punch with no location is refused while location is required', () => {
  const blind = judgePunch({ offices: [alkapuri] });
  assert.equal(punchAllowed(blind, { enabled: true }).ok, false);
  assert.equal(punchAllowed(blind, { enabled: true, requireLocation: false }).ok, true);
});
