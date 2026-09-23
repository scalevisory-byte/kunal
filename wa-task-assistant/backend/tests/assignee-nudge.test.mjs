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
const { whyNot, chatForAssignee, nudgesSoFar } = await import('../src/assignee-nudge.js');
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
