/**
 * Who the punch readers can actually reach.
 *
 * Dinesh, after filling 58 of them in: *"punch id report kahi dikhta he?"*
 * The number was a column and a list inside an import panel; there was
 * nowhere to open on an ordinary day and ask whose attendance will not come.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { REACH, punchIdReport, reachOf } from '../../shared/punchIdReport.js';

const who = (r, name) => r.rows.find((x) => x.name === name);

test('HAVING A CODE IS NOT THE SAME AS BEING REACHABLE', () => {
  /*
   * These machines send a NUMBER and no names at all. Somebody whose record
   * says BNF-EMP-0043 and nothing else looks complete on every screen and no
   * punch will ever find them. That is the whole reason this report exists.
   */
  assert.equal(reachOf({ code: 'BNF-EMP-0043' }), REACH.none);
  assert.equal(reachOf({ code: '37' }), REACH.fallback, 'a numeric code can still match');
  assert.equal(reachOf({ code: 'BNF-EMP-0043', device_code: '95' }), REACH.own);
});

test('a typed Punch ID is taken at its word', () => {
  // The office is saying what the machine calls them; some readers do send a
  // non-numeric id, and second-guessing it would flag a working setup.
  assert.equal(reachOf({ code: 'X', device_code: 'A7' }), REACH.own);
});

test('the people who cannot be reached come first', () => {
  const r = punchIdReport({
    people: [
      { id: 1, name: 'ZARA', device_code: '95' },
      { id: 2, name: 'ANIL', code: 'BNF-EMP-1' },
      { id: 3, name: 'BIMAL', code: '37' },
    ],
  });
  assert.deepEqual(r.rows.map((x) => x.name), ['ANIL', 'BIMAL', 'ZARA']);
  assert.deepEqual(r.counts, {
    staff: 3, own: 1, fallback: 1, none: 1, clashes: 0, unknown: 0, unknownPunches: null,
  });
});

test('TWO PEOPLE ON ONE NUMBER IS NAMED', () => {
  /*
   * Not a tidiness problem: every punch on that number lands on whichever of
   * them the importer meets first, so one person is paid for the other's
   * attendance. Found on his real data the first time (ALPESH SHUKLA, 60/82).
   */
  const r = punchIdReport({
    people: [
      { id: 1, name: 'ALPESH', device_code: '60' },
      { id: 2, name: 'SOMEBODY ELSE', device_code: '060' },  // the same number
      { id: 3, name: 'CLEAR', device_code: '61' },
    ],
  });
  assert.equal(r.counts.clashes, 1);
  assert.deepEqual(r.clashes[0].people.sort(), ['ALPESH', 'SOMEBODY ELSE']);
  assert.equal(who(r, 'ALPESH').clash, true);
  assert.equal(who(r, 'CLEAR').clash, false);
});

test('a number nobody carries is listed with its count, busiest first', () => {
  const r = punchIdReport({
    people: [{ id: 1, name: 'DHARA', device_code: '95' }],
    seen: [
      { device_code: '95', punches: 12 },
      { device_code: '24', punches: 40 },
      { device_code: '7', punches: 3 },
    ],
  });
  assert.deepEqual(r.unknown.map((u) => u.id), ['24', '7']);
  assert.equal(r.counts.unknownPunches, 43);
});

test('NOTHING COLLECTED YET IS NULL, NEVER ZERO', () => {
  // "no punches have come in" and "every number is accounted for" are
  // different answers and must not share a figure.
  const r = punchIdReport({ people: [{ id: 1, name: 'DHARA', device_code: '95' }] });
  assert.equal(r.counts.unknownPunches, null);
  assert.deepEqual(r.unknown, []);
});

test('somebody who left, or a half-finished draft, is not counted', () => {
  const r = punchIdReport({
    people: [
      { id: 1, name: 'GONE', active: 0 },
      { id: 2, name: 'DRAFT', is_draft: 1 },
      { id: 3, name: 'HERE', device_code: '5' },
    ],
  });
  assert.deepEqual(r.rows.map((x) => x.name), ['HERE']);
  assert.equal(r.counts.staff, 1);
});

test('a leading zero is the same number on both sides', () => {
  const r = punchIdReport({
    people: [{ id: 1, name: 'DHARA', device_code: '0095' }],
    seen: [{ device_code: '95', punches: 9 }],
  });
  assert.deepEqual(r.unknown, [], '0095 and 95 are one enrolment');
});
