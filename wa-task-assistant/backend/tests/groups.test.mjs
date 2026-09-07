/**
 * One group per business.
 *
 * The case that decides the design: a task in the wrong company's list is worse
 * than a task in none. So routing is deliberately conservative - whole-word
 * matches only, the longest keyword wins, and a tie means nothing at all.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-groups-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const DB = await import('../src/db.js');
const G = await import('../src/groups.js');

let passed = 0;
let failed = 0;
const run = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
};

const task = (title, extra = {}) =>
  DB.createTask({ title, status: 'open', source: 'manual', ...extra });

console.log('\nmaking a group');

run('a group needs a name', () => {
  assert.throws(() => G.createGroup({ name: '   ' }), /name/);
});

run('the name is always one of its own keywords', () => {
  // Nobody should have to type "BNF" twice to make a group called BNF match.
  const g = G.createGroup({ name: 'BNF', keywords: ['book n fly'] });
  assert.ok(g.keywords.includes('bnf'));
  assert.ok(g.keywords.includes('book n fly'));
});

run('two groups cannot share a name', () => {
  G.createGroup({ name: 'Scale Visory', keywords: ['scale', 'scalevisory'] });
  assert.throws(() => G.createGroup({ name: "scale visory" }), /already exists/);
});

console.log('\nrouting a task to a business');

run('a task naming the business goes to it', () => {
  G.createGroup({ name: 'Sunshine' });
  assert.equal(G.matchGroup('Pay Sunshine TDS')?.name, 'Sunshine');
  assert.equal(G.matchGroup('Process BNF salary')?.name, 'BNF');
  assert.equal(G.matchGroup('Scale Visory GST return')?.name, 'Scale Visory');
});

run('an alias works as well as the name', () => {
  assert.equal(G.matchGroup('Book N Fly ka refund process karna hai')?.name, 'BNF');
});

run('a keyword inside another word does not count', () => {
  // "scale" must not match "escalate", and matching mid-word is how a task ends
  // up in the wrong company's list.
  assert.equal(G.matchGroup('Escalate this to the lawyer'), null);
  assert.equal(G.matchGroup('Sunshines'), null);
});

run('nothing matching means no group, not a guess', () => {
  assert.equal(G.matchGroup('Call Ravi about the flat'), null);
  assert.equal(G.matchGroup(''), null);
  assert.equal(G.matchGroup(null), null);
});

run('the longer keyword wins when both match', () => {
  G.createGroup({ name: 'Fly', keywords: ['fly'] });
  // "book n fly" is longer than "fly", so BNF takes it.
  assert.equal(G.matchGroup('Book N Fly booking')?.name, 'BNF');
});

run('a tie between two groups goes to neither', () => {
  G.createGroup({ name: 'Alpha', keywords: ['shared'] });
  G.createGroup({ name: 'Beta', keywords: ['shared'] });
  assert.equal(G.matchGroup('a shared thing'), null, 'guessing between two is worse than not filing it');
});

console.log('\nwhat routes a task, in order');

run('a keyword rule beats what the model suggested', () => {
  // The rule is the user\'s own and does not change from day to day.
  const id = G.routeTask({ title: 'Pay Sunshine TDS' }, 'Scale Visory');
  assert.equal(G.getGroup(id).name, 'Sunshine');
});

run('the suggestion is used when no keyword matches', () => {
  const id = G.routeTask({ title: 'Send the papers over' }, 'Scale Visory');
  assert.equal(G.getGroup(id).name, 'Scale Visory');
});

run('a suggestion naming no real group is ignored', () => {
  assert.equal(G.routeTask({ title: 'Send the papers over' }, 'Some Other Firm'), null);
});

run('the chat a task came from counts as a signal', () => {
  const id = G.routeTask({ title: 'Send the invoice', chat_name: 'Sunshine Accounts' });
  assert.equal(G.getGroup(id).name, 'Sunshine');
});

console.log('\nputting existing work into a new group');

run('making a group picks up tasks already in the list', () => {
  task('Pay Arrohan vendor advance');
  task('Check the Arrohan showroom lease');
  task('Something unrelated entirely');

  const arrohan = G.createGroup({ name: 'Arrohan' });
  const { moved } = G.applyGroupToExisting(arrohan.id);
  assert.equal(moved, 2);

  const grouped = DB.listTasks({ status: 'all', limit: 100 })
    .filter((t) => t.group_id === arrohan.id)
    .map((t) => t.title);
  assert.equal(grouped.length, 2);
});

run('a task already filed is never moved by a later group', () => {
  const t = task('Arrohan and Sunshine joint meeting');
  const sunshine = G.groupByName('Sunshine');
  DB.updateTask(t.id, { group_id: sunshine.id });

  const arrohan = G.groupByName('Arrohan');
  G.applyGroupToExisting(arrohan.id);
  assert.equal(DB.getTask(t.id).group_id, sunshine.id, 'a choice already made stands');
});

console.log('\na task that matches no business');

run('an unmatched task is created ungrouped, not refused', () => {
  /*
   * routeTask returns null when nothing matches, and createTask used to run
   * that through `Number.isFinite(Number(null))` - which is true, because
   * Number(null) is 0. The task was stored as group 0, no such row exists, and
   * the insert died with a foreign key error. Every AI task that matched no
   * business was being lost.
   */
  const id = G.routeTask({ title: 'Call Ravi about the flat' });
  assert.equal(id, null, 'nothing matched');

  const t = DB.createTask({
    title: 'Call Ravi about the flat', status: 'open', source: 'whatsapp', origin: 'ai',
    group_id: id,
  });
  assert.ok(t.id, 'the task exists');
  assert.equal(t.group_id, null, 'and is simply ungrouped');
});

run('the empty values that mean "no group" all mean no group', () => {
  for (const empty of [null, undefined, '', false]) {
    const t = DB.createTask({
      title: `Empty group ${String(empty)}`, status: 'open', source: 'manual', group_id: empty,
    });
    assert.equal(t.group_id, null, `group_id: ${String(empty)}`);
  }
});

console.log('\nremoving a group');

run('deleting a group leaves its tasks alone', () => {
  const g = G.createGroup({ name: 'Temporary Co' });
  const t = task('Temporary Co filing');
  DB.updateTask(t.id, { group_id: g.id });

  G.deleteGroup(g.id);
  const after = DB.getTask(t.id);
  assert.ok(after, 'the task is still here');
  assert.equal(after.group_id, null, 'it is simply ungrouped');
  assert.equal(after.title, 'Temporary Co filing');
});

run('a task carries its group name and colour for display', () => {
  const g = G.groupByName('Sunshine');
  const t = task('Sunshine year-end audit');
  DB.updateTask(t.id, { group_id: g.id });
  const fresh = DB.getTask(t.id);
  assert.equal(fresh.group_name, 'Sunshine');
  assert.ok(fresh.group_colour, 'and a colour, so it reads the same everywhere');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
