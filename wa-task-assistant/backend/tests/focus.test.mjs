/**
 * Focus today, against the real list from the dashboard: one late task and ten
 * due today. It used to show three of the eleven and call that "3 tasks need
 * your attention".
 */
import assert from 'node:assert/strict';
const today = new Date().toISOString().slice(0, 10);
const yday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);

// Stand-ins for the two helpers the component imports.
globalThis.__today = today;
const isOverdue = (t) => t.due_date && t.due_date < today && t.status !== 'done';
const todayIso = () => today;

const src = (await import('node:fs')).readFileSync(
  new URL('../../frontend/src/components/FocusToday.jsx', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('const FILLER_TO'), src.indexOf('export default'));
const focusTasks = new Function('isOverdue', 'todayIso',
  `${body.replace('export function', 'function')}; return focusTasks;`)(isOverdue, todayIso);

const t = (id, title, due, priority = 'medium', status = 'open') =>
  ({ id, title, due_date: due, priority, status });

const list = [
  t(1, 'Process BNF salary', yday, 'high'),
  t(2, 'Pay Arroohan TDS', today, 'high'),
  t(3, 'Complete Sunshine audit', today, 'high'),
  t(4, 'Submit Bhavya mediclaim documents', today),
  t(5, 'Process BNF salary', today),
  t(6, 'Pay Arroohan TDS', today),
  t(7, 'Pay Sena TCS', today),
  t(8, 'Pay BNF TDS', today),
  t(9, 'Pay Sunshine TDS', today),
  t(10, 'Call to ravi chacharita', today),
  t(11, 'Check sena tcs', today),
  t(12, 'Something next week', '2099-01-01'),
  t(13, 'Finished thing', today, 'high', 'done'),
];

let pass = 0, fail = 0;
const run = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); } };

run('every task owed today is counted, not just the first three', () => {
  const r = focusTasks(list);
  assert.equal(r.owed, 11, 'one late plus ten due today');
  assert.equal(r.total, 11);
});

run('all eleven are shown', () => {
  assert.equal(focusTasks(list).tasks.length, 11);
});

run('the late one comes first', () => {
  assert.equal(focusTasks(list).tasks[0].id, 1);
});

run('high priority leads within today', () => {
  const ids = focusTasks(list).tasks.slice(1, 3).map((x) => x.id);
  assert.deepEqual(ids, [2, 3]);
});

run('a future task never appears', () => {
  assert.ok(!focusTasks(list).tasks.some((x) => x.id === 12));
});

run('a finished task never appears', () => {
  assert.ok(!focusTasks(list).tasks.some((x) => x.id === 13));
});

run('past the cap, the count still tells the truth', () => {
  const many = Array.from({ length: 20 }, (_, i) => t(100 + i, `Task ${i}`, today));
  const r = focusTasks(many);
  assert.equal(r.total, 20, 'all twenty are owed');
  assert.equal(r.tasks.length, 12, 'twelve fit on the strip');
});

run('on a quiet day, urgent undated work fills the strip', () => {
  const quiet = [t(1, 'Undated urgent', null, 'high'), t(2, 'Underway', null, 'low', 'in_progress')];
  assert.equal(focusTasks(quiet).total, 2);
});

run('filler never displaces work that is actually due today', () => {
  const mixed = [
    t(1, 'Due today', today),
    t(2, 'Due today too', today),
    t(3, 'Also due today', today),
    t(4, 'Undated urgent', null, 'high'),
  ];
  const r = focusTasks(mixed);
  assert.equal(r.total, 3, 'the undated high-priority one is not today');
  assert.ok(!r.tasks.some((x) => x.id === 4));
});

run('nothing owed and nothing urgent says so', () => {
  assert.equal(focusTasks([t(1, 'Later', '2099-01-01')]).total, 0);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
