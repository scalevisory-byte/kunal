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

run('two undated tasks fall back to priority', () => {
  const undated = [t(1, 'medium'), t(2, 'high', null, 'high'), t(3, 'low', null, 'low')];
  assert.deepEqual(undated.sort(byClock).map((x) => x.id), [2, 1, 3]);
});

run('the ordering is stable rather than shuffling on every render', () => {
  const day = [t(1, 'a'), t(2, 'b'), t(3, 'c')];
  const once = [...day].sort(byClock).map((x) => x.id);
  const twice = [...day].sort(byClock).map((x) => x.id);
  assert.deepEqual(once, twice);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
