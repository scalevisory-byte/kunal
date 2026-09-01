import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FESTIVALS,
  festivalNames,
  fixedFestivalsIn,
  matchFestival,
  religionsToTick,
} from '../../shared/festivals.js';

test('a festival is found however it is spelt', () => {
  assert.equal(matchFestival('Diwali').name, 'Diwali');
  assert.equal(matchFestival('deepavali').name, 'Diwali');
  assert.equal(matchFestival('  DIWALI  ').name, 'Diwali');
  assert.equal(matchFestival('Bakri Eid').name, 'Eid-ul-Adha');
  assert.equal(matchFestival('bakrid').name, 'Eid-ul-Adha');
  assert.equal(matchFestival('Ramzan Eid').name, 'Eid-ul-Fitr');
  assert.equal(matchFestival('uttarayan').name, 'Makar Sankranti');
  assert.equal(matchFestival('gurpurab').name, 'Guru Nanak Jayanti');
});

test('half a name still finds it, but a letter or two does not', () => {
  assert.equal(matchFestival('janmash').name, 'Janmashtami');
  assert.equal(matchFestival('christ').name, 'Christmas');
  assert.equal(matchFestival('e'), null, 'one letter must not become Eid');
  assert.equal(matchFestival('id'), null);
  assert.equal(matchFestival(''), null);
  assert.equal(matchFestival('office picnic'), null, 'an unknown name is left alone');
});

test('each festival carries the religions it is a holiday for', () => {
  assert.deepEqual(matchFestival('Holi').religions, ['Hindu']);
  assert.deepEqual(matchFestival('Muharram').religions, ['Muslim']);
  assert.deepEqual(matchFestival('Good Friday').religions, ['Christian']);
  assert.deepEqual(matchFestival('Mahavir Jayanti').religions, ['Jain']);
  assert.deepEqual(matchFestival('Independence Day').religions, [], 'a national holiday is everybody');
});

test('only the religions actually on the staff list are ticked', () => {
  const diwali = matchFestival('Diwali'); // Hindu, Jain and Sikh observe it
  const { tick, missing } = religionsToTick(diwali, ['Hindu', 'Muslim']);
  assert.deepEqual(tick, ['Hindu'], 'ticking Jain when nobody is Jain would cover nobody');
  assert.deepEqual(missing, ['Jain', 'Sikh'], 'and the caller can say so');

  // However it was typed on the master, the app's own spelling is ticked back.
  assert.deepEqual(religionsToTick(matchFestival('Eid'), ['muslim']).tick, ['muslim']);
  assert.deepEqual(religionsToTick(null, ['Hindu']), { tick: [], missing: [] });
});

test('a date is only offered where it genuinely does not move', () => {
  assert.deepEqual(matchFestival('Republic Day').fixed, { month: 1, day: 26 });
  assert.deepEqual(matchFestival('Christmas').fixed, { month: 12, day: 25 });
  assert.deepEqual(matchFestival('Makar Sankranti').fixed, { month: 1, day: 14 });

  // Everything on a lunar calendar must not carry one - it moves every year.
  for (const name of ['Diwali', 'Eid-ul-Fitr', 'Holi', 'Good Friday', 'Muharram']) {
    assert.equal(matchFestival(name).fixed, undefined, `${name} must not carry a date`);
  }

  assert.deepEqual(fixedFestivalsIn(8).map((f) => f.name), ['Independence Day']);
  assert.deepEqual(fixedFestivalsIn(1).map((f) => f.name), ['Republic Day', 'Makar Sankranti']);
  assert.deepEqual(fixedFestivalsIn(3), [], 'no fixed holiday in March');
});

test('the list itself is well formed', () => {
  const names = festivalNames();
  assert.ok(names.length > 30);
  assert.equal(new Set(names).size, names.length, 'no duplicate names');
  for (const festival of FESTIVALS) {
    assert.ok(festival.name, 'every entry is named');
    assert.ok(Array.isArray(festival.religions), `${festival.name} says who it covers`);
    // A name must find itself, or the box would not tick anything for it.
    assert.equal(matchFestival(festival.name)?.name, festival.name, festival.name);
  }
});
