/**
 * Reminding the person a task was given to, without a press.
 *
 * Asked for as "jisko task allot kiya he usko whatsapp pe auto reminder jaye
 * esa kuch ho sakta he kya", then "karna to he hi" — which overrules the rule
 * the app was built on, that it messages nobody but its owner on its own.
 *
 * So these cases are not about whether it sends. They are about the four
 * things that stop it: never a group, never at night, never more than twice,
 * never to a name whose number nobody stored. This runs on a personal number
 * through an unofficial library, and automated repeat messaging to other
 * people is what gets a number banned — the number five businesses answer on.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-nudge-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const { db, createTask, updateTask, getTask } = await import('../src/db.js');
const { addStaff } = await import('../src/assignment.js');
const { EVENT, recordEvent } = await import('../src/task-events.js');
const { whyNot, chatForAssignee, nudgesSoFar, nudgesToPersonToday } =
  await import('../src/assignee-nudge.js');
const { state } = await import('../src/whatsapp.js');

/* Connected, so these cases are about the rails and not about the link. That
   check is real and comes last, so it reports the most specific reason. */
state.status = 'ready';

const ON = { nudgeAssignee: true };
/* 10am and 2am in Asia/Kolkata, as instants. */
const DAY = new Date('2026-09-23T04:30:00Z');
const NIGHT = new Date('2026-09-22T20:30:00Z');

const given = (to, extra = {}) => {
  const made = createTask({ title: 'File GSTR-1 for Sena', source: 'manual', origin: 'manual' });
  updateTask(made.id, { assigned_to: to, ...extra });
  return getTask(made.id);
};

beforeEach(() => {
  db.prepare('DELETE FROM tasks').run();
  db.prepare('DELETE FROM staff').run();
  db.prepare('DELETE FROM task_events').run();
});

describe('what stops it', () => {
  it('sends nothing at all while the switch is off', () => {
    const task = given('Rahul', { assigned_to_wid: '919812345678@c.us' });
    assert.match(whyNot(task, 'due', { nudgeAssignee: false }, DAY), /switched off/);
  });

  it('never messages a group', () => {
    /* A telling-off in front of twenty people, and the fastest way to have
       this number reported. */
    const task = given('Rahul', { assigned_to_wid: '120363000000000000@g.us' });
    assert.match(whyNot(task, 'due', ON, DAY), /group is never messaged/);
  });

  it('never messages at night', () => {
    const task = given('Rahul', { assigned_to_wid: '919812345678@c.us' });
    assert.equal(whyNot(task, 'due', ON, DAY), null, 'ten in the morning is fine');
    assert.match(whyNot(task, 'due', ON, NIGHT), /outside 8:00–21:00/);
  });

  it('stops after two, and says whose job it is then', () => {
    const task = given('Rahul', { assigned_to_wid: '919812345678@c.us' });
    assert.equal(whyNot(task, 'due', ON, DAY), null);
    recordEvent(task.id, EVENT.nudgeSent, 'Rahul', {});
    assert.equal(whyNot(task, 'due', ON, DAY), null, 'one is not the limit');
    recordEvent(task.id, EVENT.nudgeSent, 'Rahul', {});
    assert.match(whyNot(task, 'due', ON, DAY), /already chased 2 times/);
  });

  it('counts a pressed nudge against the same limit', () => {
    /* Otherwise pressing the button twice and letting the engine send twice
       more is four messages about one job, which is a robot. */
    const task = given('Rahul', { assigned_to_wid: '919812345678@c.us' });
    recordEvent(task.id, EVENT.nudgeSent, 'Rahul', { text: 'pressed' });
    recordEvent(task.id, EVENT.nudgeSent, 'Rahul', { text: 'pressed' });
    assert.equal(nudgesSoFar(task.id), 2);
    assert.match(whyNot(task, 'due', ON, DAY), /already chased/);
  });

  it('never guesses a number from a name', () => {
    const task = given('Somebody Nobody Stored');
    assert.equal(chatForAssignee(task), null);
    assert.match(whyNot(task, 'due', ON, DAY), /no WhatsApp number is stored/);
  });

  it('will use the Staff list, which is where a number was deliberately given', () => {
    addStaff('Rahul', { wid: '919812345678@c.us' });
    const task = given('rahul');   // typed in a different case, still one person
    assert.equal(chatForAssignee(task), '919812345678@c.us');
    assert.equal(whyNot(task, 'due', ON, DAY), null);
  });

  it('sends on the deadline and the follow-up, and on nothing else', () => {
    const task = given('Rahul', { assigned_to_wid: '919812345678@c.us' });
    assert.equal(whyNot(task, 'due', ON, DAY), null);
    assert.equal(whyNot(task, 'follow_up', ON, DAY), null);
    /* A warning fires days ahead; chasing somebody before a job is even due
       is how a useful message becomes one that gets muted. */
    assert.match(whyNot(task, 'warning', ON, DAY), /only the deadline and the first follow-up/);
  });

  it('caps what ONE PERSON gets in a day, across every task they hold', () => {
    /*
     * The per-task limit alone does not bound this: eight jobs falling due
     * together is eight messages to one colleague, each inside its own limit
     * and the lot inside a second. That is the pattern that gets a number
     * banned, and it is the rail I had missed until it was asked for.
     */
    addStaff('Rahul', { wid: '919812345678@c.us' });
    const jobs = [given('Rahul'), given('Rahul'), given('Rahul'), given('Rahul'), given('Rahul')];
    assert.equal(whyNot(jobs[4], 'due', ON, DAY), null, 'the first four are fine');
    for (let i = 0; i < 4; i++) recordEvent(jobs[i].id, EVENT.nudgeSent, 'Rahul', {});
    assert.equal(nudgesToPersonToday('Rahul', DAY), 4);
    assert.match(whyNot(jobs[4], 'due', ON, DAY), /already had 4 today/);
  });

  it('counts that allowance by person, not by everybody at once', () => {
    addStaff('Rahul', { wid: '919812345678@c.us' });
    addStaff('Meera', { wid: '919898989898@c.us' });
    /* Spread across four of his jobs, so it is the DAILY limit being reached
       and not the per-task one. */
    const his = [given('Rahul'), given('Rahul'), given('Rahul'), given('Rahul'), given('Rahul')];
    const hers = given('Meera');
    for (let i = 0; i < 4; i++) recordEvent(his[i].id, EVENT.nudgeSent, 'Rahul', {});
    assert.match(whyNot(his[4], 'due', ON, DAY), /already had 4 today/);
    assert.equal(whyNot(hers, 'due', ON, DAY), null, 'one busy person must not silence another');
  });

  it('paces its sends, so a morning of deadlines is not one burst', () => {
    const src = fs.readFileSync(new URL('../src/assignee-nudge.js', import.meta.url), 'utf8');
    assert.match(src, /GAP_MS/);
    assert.match(src, /JITTER_MS/, 'identical gaps read as automated too');
    assert.match(src, /await wait\(gap - since\)/);
  });

  it('says nothing to a task nobody was given', () => {
    const mine = createTask({ title: 'My own job', source: 'manual', origin: 'manual' });
    assert.match(whyNot(mine, 'due', ON, DAY), /not given to anybody/);
  });
});

describe('the switch', () => {
  it('goes on once, and stays off if it is turned off', async () => {
    const { enableAssigneeNudgeOnce, getSettings, saveSettings } = await import('../src/scheduling.js');
    db.prepare(`DELETE FROM meta WHERE key = 'assignee_nudge_default_on'`).run();
    saveSettings({ nudgeAssignee: false });

    assert.equal(enableAssigneeNudgeOnce().changed, true);
    assert.equal(getSettings().nudgeAssignee, true);

    saveSettings({ nudgeAssignee: false });
    assert.equal(enableAssigneeNudgeOnce().changed, false, 'the marker must not let it come back');
    assert.equal(getSettings().nudgeAssignee, false);
  });

  it('is off in the defaults, so a fresh install messages nobody', async () => {
    const src = fs.readFileSync(new URL('../src/scheduling.js', import.meta.url), 'utf8');
    assert.match(src, /nudgeAssignee: false,/);
  });
});


/*
 * The thing that decides whether any of the above ever happens.
 *
 * Asked as *"hua abhi auto kese hoga"* — the pressed nudge had just gone out,
 * so the question was what makes the next one happen by itself. The answer was
 * printed in grey on all seven rows of that page: **No deadline**.
 *
 * The engine builds its ladder from the deadline, the assignee nudge rides two
 * rungs of that ladder and nothing else, so a task with neither `due_at` nor
 * `due_date` can never produce one. Switch on, numbers stored, nothing would
 * ever have been sent — and nothing on the screen said why. A feature that
 * cannot fire and is silent about it is indistinguishable from a broken one.
 */
describe('nothing is chased automatically without a deadline', () => {
  it('a task with no deadline is not in the engine\'s pass at all', async () => {
    const { tasksWithDeadlines } = await import('../src/task-lifecycle.js');
    const t = given('Meera', { assigned_to_wid: '919825033333@c.us' });
    assert.ok(!t.due_at && !t.due_date, 'this is the state every row was in');
    assert.ok(!tasksWithDeadlines().some((row) => row.id === t.id));
  });

  it('and giving it one puts it there, which is what starts the chasing', async () => {
    const { tasksWithDeadlines } = await import('../src/task-lifecycle.js');
    const t = given('Meera', { assigned_to_wid: '919825033333@c.us' });
    updateTask(t.id, { due_date: '2026-09-24', due_at: '2026-09-24T12:30:00.000Z' });
    assert.ok(tasksWithDeadlines().some((row) => row.id === t.id));
    // And the rails still decide the rest: this is the entry ticket, not a
    // licence to message.
    assert.equal(whyNot(getTask(t.id), 'due', ON, DAY), null);
  });

  it('the page says so, over the rows it is true of', () => {
    const src = fs.readFileSync(
      new URL('../../frontend/src/components/Delegation.jsx', import.meta.url), 'utf8');
    assert.match(src, /const undated = tasks\.filter/, 'counted from the rows on screen');
    assert.match(src, /status !== 'done' && !t\.due_at && !t\.due_date/,
      'finished work needs no deadline and is not counted');
    assert.match(src, /undated > 0 &&/, 'and the line is not shown when it is not true');
    // The way out is on the row, not on another page.
    assert.match(src, /function DeadlineButton/);
    assert.match(src, /Set a deadline/);
  });

  it('setting it from the row writes both columns', () => {
    // `due_at` is the moment the ladder is built from; `due_date` is the day
    // the board files it under. Clearing one alone takes the other with it.
    const src = fs.readFileSync(
      new URL('../../frontend/src/components/Delegation.jsx', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('onDeadline: (task'), src.indexOf('onDelete: async'));
    assert.match(fn, /due_date: isoDay/);
    assert.match(fn, /due_at: new Date/);
    assert.match(fn, /\{ due_date: null, due_at: null \}/, 'and clearing clears both');
  });
});
