/**
 * Saying whose job a task is, from the list.
 *
 * It was already possible - in the drawer, behind a text field - and so it was
 * not done: reading down a list of forty tasks, "this one is Meera's" has to
 * be one press or it does not happen at all. And until it is said, the row
 * gives no sign either way, which is the question the list is actually read
 * with: is this mine?
 *
 * Handing a task over changes nothing about how it is chased. The app still
 * reminds HIM; the person hears from it only when he presses send on their
 * chat. These tests hold that line.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-assign-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const DB = await import('../src/db.js');
const A = await import('../src/assignment.js');
const S = await import('../src/scheduling.js');
const L = await import('../src/task-lifecycle.js');

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
  DB.createTask({ title, status: 'open', source: 'whatsapp', origin: 'ai', ...extra });

console.log('\nnaming somebody');

let payment;

run('a task starts as his own', () => {
  payment = task('Follow up for payment', { chat_name: 'Sena Travel Solutions' });
  assert.equal(payment.assigned_to, null);
  assert.equal(A.directionOf(payment), 'own');
});

run('naming somebody hands it over and records when', () => {
  A.assignTask(payment.id, 'Krishna');
  const after = DB.getTask(payment.id);
  assert.equal(after.assigned_to, 'Krishna');
  assert.ok(after.assigned_at, 'and when it changed hands');
  assert.equal(A.directionOf(after), 'allotted');
});

run('it then appears under that person, and under nobody else', () => {
  assert.ok(A.tasksFor('Krishna').some((t) => t.id === payment.id));
  assert.equal(A.tasksFor('Meera').some((t) => t.id === payment.id), false);

  const names = A.delegates().map((p) => p.name);
  assert.ok(names.includes('Krishna'), 'and the name is offered next time');
});

run('the same name twice is one person, not two', () => {
  A.assignTask(task('Second job').id, 'Krishna');
  const rows = A.delegates().filter((p) => p.name === 'Krishna');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].open, 2, 'carrying both');
});

run('naming nobody takes it back, and that is the same operation', () => {
  const mine = task('Mine again');
  A.assignTask(mine.id, 'Meera');
  assert.equal(DB.getTask(mine.id).assigned_to, 'Meera');

  A.assignTask(mine.id, '');
  const back = DB.getTask(mine.id);
  assert.equal(back.assigned_to, null);
  assert.equal(back.assigned_to_wid, null);
  assert.equal(back.assigned_at, null, 'nothing is left claiming it changed hands');
  assert.equal(A.directionOf(back), 'own');
});

run('a name is trimmed and capped rather than stored as typed', () => {
  const t = task('Long name');
  A.assignTask(t.id, `  ${'K'.repeat(200)}  `);
  assert.equal(DB.getTask(t.id).assigned_to.length, 80);
});

console.log('\nwhat handing it over does not change');

run('it is still chased, and still his', () => {
  const t = task('Send the salary sheet', { due_date: '2026-12-01', due_at: '2026-12-01T12:30:00.000Z' });
  L.planTask(t);
  const before = S.remindersForTask(t.id).length;

  A.assignTask(t.id, 'Krishna');
  L.planTask(DB.getTask(t.id));
  assert.equal(S.remindersForTask(t.id).length, before,
    'the same ladder, unchanged: a delegated task is still owed by him');
});

run('nothing about assigning sends anybody anything', () => {
  const src = fs.readFileSync(new URL('../src/assignment.js', import.meta.url), 'utf8');
  const assign = src.slice(src.indexOf('export function assignTask'), src.indexOf('export function openTaskFor'));
  assert.ok(!/sendMessage|client\.send/.test(assign), 'assigning is a database write and nothing else');
});

run('the reminder for a delegated task still goes to him', () => {
  const engine = fs.readFileSync(new URL('../src/reminders.js', import.meta.url), 'utf8');
  const deliver = engine.slice(engine.indexOf('async function deliver('), engine.indexOf('async function deliverNoteReminders'));
  const sends = [...deliver.matchAll(/sendMessage\(([^,]+),/g)].map((m) => m[1].trim());
  assert.deepEqual(sends, ['reminderChatId()'],
    `a task with somebody else's name on it still reminds him: ${sends.join(', ')}`);
  assert.match(deliver, /With \$\{task\.assigned_to\}/, 'it just says whose desk it is on');
});


/*
 * Where allotted work goes.
 *
 * Reported as "yaha pe bahut saare allotted task aa rahe he" - the board had
 * become a list of other people's work, and the thing he actually has to do was
 * somewhere inside it. Handing a task over now takes it off the board and
 * leaves it on Task allotted. What these cases hold is the other half: it is
 * moved, not dropped, and nothing about chasing it changes.
 */
console.log('\nwhere allotted work goes');

const appSrc = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const taskLib = fs.readFileSync(new URL('../../frontend/src/lib/task.js', import.meta.url), 'utf8');
/*
 * The board's own rule, lifted out of the source rather than restated here - a
 * second copy of it would pass these tests long after the app stopped
 * agreeing with them.
 */
const lineOf = (src, decl) => src.slice(src.indexOf(decl)).split('\n')[0].replace('export ', '');
const withSomebody = new Function(
  `${lineOf(taskLib, 'export const isAllotted')}
   ${lineOf(taskLib, 'export const isDone')}
   ${lineOf(appSrc, 'const withSomebody =')}
   return withSomebody;`
)();

run('only unfinished work with somebody leaves the board', () => {
  assert.equal(withSomebody({ assigned_to: 'Krishna', status: 'open' }), true);
  assert.equal(withSomebody({ assigned_to: null, status: 'open' }), false);
  // Finished is finished: it belongs in Completed with everything else, and
  // keeping it there is what makes the count above the list exact.
  assert.equal(withSomebody({ assigned_to: 'Krishna', status: 'done' }), false);
});

run('the board and its figures apply the same rule', () => {
  // dayTasks is what every figure, the focus list, the calendar and the rail
  // read; `visible` is the list. A rule applied to one and not the other is how
  // "6 open" ends up over four rows.
  const dayTasks = appSrc.slice(appSrc.indexOf('const dayTasks ='), appSrc.indexOf('const allottedHidden'));
  const visible = appSrc.slice(appSrc.indexOf('const visible ='), appSrc.indexOf('const arrivedToday'));
  assert.match(dayTasks, /withSomebody/, 'the figures leave out work with somebody else');
  assert.match(visible, /withSomebody\(task\) && !showAllotted/, 'and so does the list');
});

run('nothing is hidden quietly - the list says where it went, and brings it back', () => {
  const note = appSrc.slice(appSrc.indexOf('allottedHidden > 0'), appSrc.indexOf('<TaskList'));
  assert.match(note, /with somebody else/);
  assert.match(note, /goto\('allotted'\)/, 'it links to the page that holds them');
  assert.match(note, /Show them here/, 'and one press puts them back on the board');
});

run('the number it reports is the number the sidebar badges', () => {
  // Two counts of the same thing, computed in different places and different
  // languages. They disagree the moment one of them starts counting finished
  // delegations, which is exactly the mistake worth pinning.
  const rows = DB.listTasks({ status: undefined, limit: 1000 });
  const board = rows.filter((t) => !t.group_separate && withSomebody(t)).length;
  assert.equal(board, A.delegationCounts().allotted);
});

run('taking it off the board does not take it off the engine', () => {
  const t = task('Client agreement to sign', { due_date: '2020-01-01' });
  A.assignTask(t.id, 'Krishna');
  const chased = DB.pendingReminders('2030-01-01').map((r) => r.id);
  assert.ok(chased.includes(t.id), 'it is off the list, not off his back');
});



/*
 * "One click option do - but allot kisko karna he wo bhi karna padega,
 * compulsory rakho usko." Both halves, held together: the row's Staff button
 * is the only press needed to start, and there is no way through it that files
 * a task under Task allotted without a person's name on it.
 */
console.log('\nputting one there in a single press');

const rowSrc = fs.readFileSync(new URL('../../frontend/src/components/TaskItem.jsx', import.meta.url), 'utf8');
const assignBtn = rowSrc.slice(rowSrc.indexOf('function AssignButton'), rowSrc.indexOf('function GroupButton'));

run('the name field is open on the first press, not behind another one', () => {
  // It used to sit behind "Somebody else…", which on the first days - when
  // nobody is on the list yet - was the only road, so handing a task over was
  // four actions deep.
  // The step was a state flag that had to be flipped before the form existed.
  assert.ok(!/setNaming/.test(assignBtn), 'no step between the button and the field');
  assert.match(assignBtn, /<form[\s\S]*?className="menu-name"/, 'the field is in the menu itself');
  assert.match(assignBtn, /autoFocus/, 'and it has the cursor');
});

run('naming somebody is compulsory', () => {
  assert.match(assignBtn, /if \(name\.trim\(\)\) give\(name\.trim\(\)\)/, 'a blank name submits nothing');
  assert.match(assignBtn, /disabled=\{!name\.trim\(\)\}/, 'and Give stays disabled until there is one');
  // The one call that passes an empty name is the opposite action - taking it
  // back off somebody - and it is only reachable when somebody holds it.
  const empties = [...assignBtn.matchAll(/give\(''\)/g)];
  assert.equal(empties.length, 1, 'exactly one give(\'\'), and it is "take it back"');
  assert.match(assignBtn.slice(assignBtn.indexOf("give('')") - 200, assignBtn.indexOf("give('')") + 200),
    /take it back/, 'it is the take-it-back row, not a way to allot nobody');
});

run('an empty name means take it back, never allot to nobody', () => {
  const t = task('Ledger to reconcile');
  A.assignTask(t.id, 'Meera');
  assert.equal(A.assignTask(t.id, ''), null);
  assert.equal(DB.getTask(t.id).assigned_to, null, 'it is his again');
  // And back on the board with it: nothing is with anybody.
  assert.ok(!DB.getTask(t.id).assigned_to);
});



/*
 * Moving it to somebody else, from the page that holds it.
 *
 * Asked as "allotted me staff ke sath move karne wala option bana he?" - and
 * it was not. The board had the Staff button; Task allotted, the page that
 * exists to hold delegated work, had the assignee as a line of text. The one
 * screen you read while deciding who is doing what was the one screen that
 * could not change it.
 */
console.log('\nmoving it to somebody else from Task allotted');

const delegSrc = fs.readFileSync(new URL('../../frontend/src/components/Delegation.jsx', import.meta.url), 'utf8');

run('all three of its views carry the control, not just one', () => {
  // The rename shipped on three lists and not the fourth because each had its
  // own markup. This page has three: the by-person sections (task rows), the
  // pipeline cards and the flat rows.
  assert.match(delegSrc, /import TaskItem, \{ AssignButton \}/, 'one control, imported, not copied');
  const card = delegSrc.slice(delegSrc.indexOf('function Card('), delegSrc.indexOf('function Board('));
  const rows = delegSrc.slice(delegSrc.indexOf('function Rows('), delegSrc.indexOf('export default function Delegation'));
  assert.match(card, /<AssignButton/, 'the pipeline cards');
  assert.match(rows, /<AssignButton/, 'the flat rows');
  // The by-person sections render TaskItem, which draws it when onAssign is
  // given - so the actions object is what decides.
  assert.match(delegSrc, /onAssign: side !== 'allotted' \? undefined :/, 'the task rows, through actions');
});

run('and Task received does not, because nothing there was given to anybody', () => {
  assert.match(delegSrc, /side !== 'allotted' \? undefined/,
    'work somebody asked HIM for has no assignee to move');
  assert.match(delegSrc, /people: side === 'allotted' \?/,
    'and no list of people to offer');
});

run('handing it on is the same write the board makes', () => {
  const t = task('Sena GST refund follow up');
  A.assignTask(t.id, 'Rahul');
  assert.equal(DB.getTask(t.id).assigned_to, 'Rahul');
  A.assignTask(t.id, 'Priya');
  assert.equal(DB.getTask(t.id).assigned_to, 'Priya', 'moved, not duplicated');
  // And it is still one task, still his to chase, still nothing sent to either
  // of them.
  assert.equal(DB.getTask(t.id).status, 'open');
});



/*
 * The people work can be handed to, before any of it has been.
 *
 * Asked as "staff ma name me staff ka name add karne de". The list the Staff
 * menu offered was derived from tasks already assigned, so a person who had
 * never been given anything did not exist: his name had to be typed from
 * scratch every time, and one typo made a second person with a section of
 * their own on the page.
 */
console.log('\nthe staff list');

run('somebody can be on the list before they hold anything', () => {
  A.addStaff('Rahul Shah');
  A.addStaff('Jignesh');
  const names = A.listStaff().map((p) => p.name);
  assert.ok(names.includes('Rahul Shah') && names.includes('Jignesh'));
  // And the menu offers them, which is the whole point.
  const offered = A.delegates().map((d) => d.name);
  assert.ok(offered.includes('Rahul Shah'), 'offered with nothing assigned');
});

run('one person per name, however it was typed', () => {
  const before = A.listStaff().length;
  A.addStaff('rahul shah');
  A.addStaff('  RAHUL SHAH  ');
  assert.equal(A.listStaff().length, before, '"rahul" and "Rahul" are not two people');
});

run('a blank name is nobody', () => {
  const before = A.listStaff().length;
  assert.equal(A.addStaff('   '), null);
  assert.equal(A.listStaff().length, before);
});

run('a name typed on a row joins the list by itself', () => {
  // Otherwise the list is a second thing to maintain, and a list you have to
  // remember to update goes stale - then the menu stops offering the people you
  // actually give work to and the typing starts again.
  const t = task('Arrohan showroom quotation');
  A.assignTask(t.id, 'Meera Shah');
  assert.ok(A.listStaff().some((p) => p.name === 'Meera Shah'));
});

run('removing somebody leaves their work exactly where it is', () => {
  const t = task('Sena GST refund follow up');
  A.assignTask(t.id, 'Jignesh');
  const person = A.listStaff().find((p) => p.name === 'Jignesh');
  assert.equal(A.removeStaff(person.id), true);

  assert.ok(!A.listStaff().some((p) => p.name === 'Jignesh'), 'no longer offered');
  assert.equal(DB.getTask(t.id).assigned_to, 'Jignesh', 'but the task is untouched');
  // And because the task still says so, the page goes on showing them.
  assert.ok(A.delegates().some((d) => d.name === 'Jignesh' && d.open === 1));
});

run('the staff list is a list of names and nothing more', () => {
  // No login, no role, no way for anybody on it to reach the app - and nothing
  // here sends anybody a message. The number is only ever read by the nudge,
  // which one person presses.
  const src = fs.readFileSync(new URL('../src/assignment.js', import.meta.url), 'utf8');
  const staff = src.slice(src.indexOf('export const listStaff'), src.indexOf('export function delegates'));
  assert.ok(!/sendMessage|client\.send/.test(staff), 'adding somebody messages nobody');
  const routes = fs.readFileSync(new URL('../src/routes/delegation.js', import.meta.url), 'utf8');
  const block = routes.slice(routes.indexOf("delegationRouter.get('/staff'"));
  assert.ok(!/sendMessage/.test(block), 'and neither does any route that manages it');
});


console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
