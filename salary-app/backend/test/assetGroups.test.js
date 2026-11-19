import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUP_KEYS, groupLabel, groupOf, groupTally } from '../../shared/assetGroups.js';
import { kindOf } from '../../shared/assetImport.js';

/*
 * Dinesh: "need asset group also, like computer, furniture, mobile". His
 * register is a thousand rows of forty-seven different things, and nobody
 * wants to scroll past 97 lights to find the laptops.
 */

/** What the register actually does: name -> kind -> group. */
const groupFor = (name) => groupLabel(groupOf(kindOf('', name), name));

test('the three he named, by the words his own sheet uses', () => {
  for (const [name, expected] of [
    ['CPU', 'Computer'],
    ['LAPTOP', 'Computer'],
    ['MOUSE', 'Computer'],
    ['KEYBOARD', 'Computer'],
    ['MONITOR', 'Computer'],
    ['CHAIR', 'Furniture'],
    ['TABLE', 'Furniture'],
    ['ALMARI', 'Furniture'],
    ['STORAGE WITH DROWER KEY', 'Furniture'],
    ['SOFA 2 SEATER', 'Furniture'],
    ['MOBILE', 'Mobile'],
    ['SIM', 'Mobile'],
    ['CHARGER CABLE', 'Mobile'],
  ]) {
    assert.equal(groupFor(name), expected, name);
  }
});

test('and the rest of his register lands somewhere sensible', () => {
  for (const [name, expected] of [
    ['LIGHT', 'Electrical'],
    ['AC', 'Electrical'],
    ['AC REMOTE', 'Electrical'],
    ['FREEDGE', 'Electrical'],
    ['TV', 'Electrical'],
    ['CCTV', 'Security'],
    ['CCTV-NVR', 'Security'],
    ['ESSL OUT', 'Security'],
    ['WI-FI DONGAL', 'Network'],
    ['SWITCH-24 PORT', 'Network'],
    ['WI-FI ACCESS POINT', 'Network'],
    ['ROUTER', 'Network'],
    ['CALCULATOR', 'Office equipment'],
    ['SPEAKER', 'Office equipment'],
    ['PENDRIVE', 'Computer'],
    ['POWER CABLE', 'Computer'],
  ]) {
    assert.equal(groupFor(name), expected, name);
  }
});

test('a short kind matches as a WORD, not as a substring', () => {
  /*
   * "ac" is a kind and two letters long. A substring test puts RACK, BLACK
   * BOARD and every ACCESS POINT under Electrical - the same trap the skills
   * parser hit, where "and" inside "demand planning" made a skill nobody had.
   */
  assert.equal(groupFor('RACK'), 'Furniture');
  assert.equal(groupFor('ACCESS POINT'), 'Network');
  assert.equal(groupFor('BLACK BOARD'), 'Other');
  assert.equal(groupFor('AC'), 'Electrical', 'and the real one still works');
});

test('a plural is the same thing', () => {
  assert.equal(groupFor('CHAIRS'), 'Furniture');
  assert.equal(groupFor('LAPTOPS'), 'Computer');
});

test('a kind nobody has mapped is Other, said out loud', () => {
  assert.equal(groupOf('zxqw', 'ZXQW'), 'other');
  assert.equal(groupLabel('zxqw'), 'Other', 'an unknown key still reads as something');
  assert.ok(GROUP_KEYS.includes('other'), 'and Other is a group you can filter to');
  assert.equal(GROUP_KEYS[GROUP_KEYS.length - 1], 'other', 'last, because it is the leftovers');
});

test('the kind decides, and the name is only consulted when it says nothing', () => {
  // Somebody typed the kind by hand: it wins over a misleading label.
  assert.equal(groupOf('chair', 'CPU trolley'), 'furniture');
  // No kind at all - the sticker is the only evidence there is.
  assert.equal(groupOf('', 'Office chair'), 'furniture');
  assert.equal(groupOf('', ''), 'other');
});

test('the tally counts and adds up, biggest first, with no empty groups', () => {
  const rows = groupTally([
    { kind: 'laptop', label: 'Dell', purchase_cost: 45000 },
    { kind: 'laptop', label: 'HP', purchase_cost: 40000 },
    { kind: 'mouse', label: 'MOUSE', purchase_cost: 708 },
    { kind: 'chair', label: 'CHAIR', purchase_cost: 2000 },
  ]);
  assert.deepEqual(rows.map((r) => [r.label, r.count]), [['Computer', 3], ['Furniture', 1]]);
  assert.equal(rows[0].cost, 85708);
  assert.deepEqual(rows[0].kinds, ['laptop', 'mouse'], 'what is in it, for the button’s tooltip');
  assert.ok(!rows.some((r) => r.count === 0), 'a group with nothing in it is not shown');
  assert.deepEqual(groupTally([]), []);
});

test('a cost that is not a number does not poison the total', () => {
  const [row] = groupTally([
    { kind: 'laptop', label: 'A', purchase_cost: null },
    { kind: 'laptop', label: 'B', purchase_cost: '12,000' },
  ]);
  assert.equal(row.count, 2);
  assert.equal(Number.isFinite(row.cost), true, 'NaN here makes the whole register read as blank');
});


test('"Air conditioner" is Electrical, however it was typed', () => {
  // The import maps the kind to `ac`; a row typed by hand says the whole
  // phrase. The whole-word matcher rightly will not find "ac" inside "air",
  // so both spellings are on the list - six rows read as Other until they were.
  assert.equal(groupOf('ac'), 'electrical');
  assert.equal(groupOf('Air conditioner'), 'electrical');
  assert.equal(groupOf('AIR CONDITIONER', 'Voltas 1.5 ton split'), 'electrical');
  // And the reason the matcher is whole-word in the first place:
  assert.notEqual(groupOf('Black board'), 'electrical');
});

test('a kind typed as the group’s own name lands in that group', () => {
  /*
   * "mobile" was not among the mobile group's kinds - only "phone", "sim",
   * "charger" and "powerbank". So a row whose kind reads Mobile, which is
   * both the obvious thing to type AND what the group button above it is
   * called, fell through to Other. Found on the staff-wise register: three
   * mobiles against one person, all filed under Other.
   */
  assert.equal(groupOf('Mobile', 'Redmi Note 12'), 'mobile');
  assert.equal(groupLabel(groupOf('Mobile', '')), 'Mobile');
  assert.equal(groupOf('Smartphone', ''), 'mobile');
  assert.equal(groupOf('Mobile Phone', ''), 'mobile');
  // And the ones that already worked still do.
  assert.equal(groupOf('SIM Card', ''), 'mobile');
  assert.equal(groupOf('Laptop', ''), 'computer');
});
