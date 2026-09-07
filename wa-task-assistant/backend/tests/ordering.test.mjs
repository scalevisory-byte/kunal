/**
 * The order a day is read in.
 *
 * The list arrives from the database ordered by priority, which is right across
 * the whole board and wrong inside one day: a medium task at 11:30 was sitting
 * under a high one at 6pm, so "Today" did not read in the order the day
 * actually happens.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../../frontend/src/components/TaskList.jsx', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('function byClock'), src.indexOf('/** Sections by day'));
const byClock = new Function(`${body}; return byClock;`)();

let pass = 0, fail = 0;
const run = (n, f) => { try { f(); pass++; console.log('  ok   ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + '\n       ' + e.message); } };

const t = (id, title, due_at, priority = 'medium') => ({ id, title, due_at, priority });

run('a day runs from morning to evening', () => {
  const day = [
    t(1, 'Pay BNF TDS', '2026-09-07T12:30:00Z', 'high'),      // 6 pm
    t(2, 'Pay Arroohan TDS', '2026-09-07T06:00:00Z'),          // 11:30 am
    t(3, 'Submit mediclaim', '2026-09-07T03:30:00Z', 'high'),  // 9 am
    t(4, 'Process salary', '2026-09-07T08:35:00Z'),            // 2:05 pm
  ];
  assert.deepEqual(day.sort(byClock).map((x) => x.id), [3, 2, 4, 1]);
});

run('a high-priority task later in the day does not jump the queue', () => {
  // The exact case on the dashboard: 6pm high above 11:30 medium.
  const day = [
    t(1, 'six pm, high', '2026-09-07T12:30:00Z', 'high'),
    t(2, 'half eleven, medium', '2026-09-07T06:00:00Z'),
  ];
  assert.deepEqual(day.sort(byClock).map((x) => x.id), [2, 1]);
});

run('priority decides between two things due at the same moment', () => {
  const same = [
    t(1, 'medium', '2026-09-07T12:30:00Z'),
    t(2, 'high', '2026-09-07T12:30:00Z', 'high'),
    t(3, 'low', '2026-09-07T12:30:00Z', 'low'),
  ];
  assert.deepEqual(same.sort(byClock).map((x) => x.id), [2, 1, 3]);
});

run('a task with no time sits after the ones that have one', () => {
  /*
   * It is owed that day, not at a point in it — so it cannot be placed among
   * them, and putting it first would push real appointments down.
   */
  const day = [
    t(1, 'no time'),
    t(2, 'nine am', '2026-09-07T03:30:00Z'),
    t(3, 'no time either', null, 'high'),
  ];
  const order = day.sort(byClock).map((x) => x.id);
  assert.equal(order[0], 2);
  assert.deepEqual(order.slice(1).sort(), [1, 3]);
});

run('undated tasks are ordered by when they arrived, newest first', () => {
  /*
   * "No date" is where most of the list ends up - twenty-three of them on the
   * dashboard - and every one showed the same label and no useful order. What
   * separates them is when they came in: this morning's capture belongs at the
   * top, not buried under a fortnight of older ones.
   */
  const pile = [
    { id: 1, title: 'a week ago', due_at: null, priority: 'high', created_at: '2026-09-01 09:00:00' },
    { id: 2, title: 'this morning', due_at: null, priority: 'low', created_at: '2026-09-07 08:00:00' },
    { id: 3, title: 'yesterday', due_at: null, priority: 'medium', created_at: '2026-09-06 15:00:00' },
  ];
  assert.deepEqual(pile.sort(byClock).map((x) => x.id), [2, 3, 1]);
});

run('priority still breaks a genuine tie', () => {
  const same = (id, priority) =>
    ({ id, due_at: null, priority, created_at: '2026-09-07 08:00:00' });
  assert.deepEqual([same(1, 'medium'), same(2, 'high'), same(3, 'low')].sort(byClock).map((x) => x.id),
    [2, 1, 3]);
});

run('the ordering is stable rather than shuffling on every render', () => {
  const day = [t(1, 'a'), t(2, 'b'), t(3, 'c')];
  const once = [...day].sort(byClock).map((x) => x.id);
  const twice = [...day].sort(byClock).map((x) => x.id);
  assert.deepEqual(once, twice);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
