/**
 * Searching.
 *
 * Typing "salary" on the dashboard narrowed the task list — far below the
 * greeting, the figures, the quick actions and Focus today, all of which stayed
 * exactly where they were. The filtering worked; nothing on screen moved, so it
 * read as a search box that did nothing.
 *
 * Searching is its own mode now, and that changes what it looks at as well as
 * what it shows: every task, whatever view you were on, finished ones and
 * set-aside groups included. If you went looking for it, you want to find it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../../frontend/src/lib/task.js', import.meta.url), 'utf8');
const { matchesQuery } = new Function(
  src.replace(/^import.*$/gm, '').replace(/export /g, '') + '; return { matchesQuery };'
)();

let pass = 0, fail = 0;
const run = (n, f) => { try { f(); pass++; console.log('  ok   ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + '\n       ' + e.message); } };

const task = (over = {}) => ({
  title: 'Process BNF salary', description: null, chat_name: 'ZyntaJobs',
  contact: null, source_message: null, status: 'open', ...over,
});

run('it matches the title', () => {
  assert.equal(matchesQuery(task(), 'salary'), true);
  assert.equal(matchesQuery(task(), 'SALARY'), true, 'case does not matter');
});

run('it matches the chat it came from', () => {
  assert.equal(matchesQuery(task(), 'zynta'), true);
});

run('it matches the person who asked', () => {
  assert.equal(matchesQuery(task({ contact: 'Meera Jariwala' }), 'meera'), true);
});

run('it matches the original WhatsApp message', () => {
  // The words that produced a task are often not the words in its title.
  assert.equal(
    matchesQuery(task({ title: 'Pay TDS', source_message: 'arroohan tds today last day' }), 'arroohan'),
    true
  );
});

run('it matches the notes', () => {
  assert.equal(matchesQuery(task({ description: 'bizcompass mismatch' }), 'bizcompass'), true);
});

run('a word that appears nowhere does not match', () => {
  assert.equal(matchesQuery(task(), 'vacancy'), false);
});

run('an empty search matches everything', () => {
  assert.equal(matchesQuery(task(), ''), true);
  assert.equal(matchesQuery(task(), '   '), true);
});

run('a finished task is still findable', () => {
  /*
   * Search deliberately ignores the view you were on. Looking for last month's
   * salary run and being told there are no results, because the dashboard
   * happened to be showing open tasks, is a wrong answer rather than a filter.
   */
  assert.equal(matchesQuery(task({ status: 'done' }), 'salary'), true);
});

run('a partial word finds it', () => {
  assert.equal(matchesQuery(task(), 'sal'), true);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
