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
const { EVENT, recordEvent, messagesSentFor } = await import('../src/task-events.js');
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


/*
 * He is told every time the app messages somebody for him.
 *
 * His own follow-up messages are off by default - three per late task is how a
 * reminder becomes something you mute - but the nudge to the assignee is not.
 * So at the deadline he heard about it and at the follow-up, thirty minutes
 * later, his staff got a message and he got nothing. Finding out later that
 * your app has been chasing people on your behalf is how a feature loses its
 * welcome, and this is the app's most sensitive behaviour.
 */
describe('nothing is sent on his behalf in silence', () => {
  const src = fs.readFileSync(new URL('../src/reminders.js', import.meta.url), 'utf8');

  it('the nudge runs before his own message, so that message can carry it', () => {
    const nudgeAt = src.indexOf('await nudgeAssignee(task, reminder.kind, settings)');
    const mineAt = src.indexOf('if (wantsWhatsApp && state.status');
    assert.ok(nudgeAt > 0 && mineAt > 0);
    assert.ok(nudgeAt < mineAt, 'ordered the other way, his message cannot mention it');
    assert.match(src, /told \? `✔ I have also reminded \$\{told\} on WhatsApp\.` : null/);
  });

  it('and when his own message is not sent, he is told anyway', () => {
    // This is the case that was silent: kind 'follow_up' with
    // whatsappFollowUps off, which is the default.
    const tail = src.slice(src.indexOf('} else if (told && state.status'));
    assert.match(tail, /sendMessage\(\s*\n?\s*reminderChatId\(\)/, 'to his own chat, as always');
    assert.match(tail, /Reminded \*\$\{told\}\*/);
    // Only when a message really went out - `told` is set from out.sent alone.
    assert.match(src, /if \(out\.sent\) \{\n\s*told = out\.to;/);
  });

  it('the notice cannot outnumber the nudges it reports', () => {
    // It is bounded by the nudge's own caps rather than by a rule of its own:
    // at most two per task, four per person per day, and nothing at night.
    const nudge = fs.readFileSync(new URL('../src/assignee-nudge.js', import.meta.url), 'utf8');
    assert.match(nudge, /const MAX_PER_TASK = 2/);
    assert.match(nudge, /const MAX_PER_PERSON_PER_DAY = 4/);
  });

  it('the comment that said this never happens is gone', () => {
    // It read "Nothing here messages that person", which stopped being true
    // the day the automatic nudge shipped. A comment that lies is worse than
    // no comment: the next person reads it instead of the code.
    assert.ok(!/Nothing here messages\s*\n?\s*\* that person/.test(src));
    assert.ok(!src.includes('sending to an assignee happens only from the dashboard'));
  });
});


/*
 * "Why task reminder coming to me — direct Nidhi ko jana chahiye."
 *
 * Asked of the 2pm message for a 3pm job given to NIDHI BNF. That message is
 * correctly his: it is the `pre_due` rung, an hour before, and the assignee
 * nudge rides only `due` and `follow_up` - so she heard nothing at 2 and hears
 * from the app at 3. What he wanted was to stop being copied on work that is
 * not his to do.
 */
describe('his own copy for work he gave away', () => {
  const src = fs.readFileSync(new URL('../src/reminders.js', import.meta.url), 'utf8');

  it('the hour-before rung was never sent to the assignee', async () => {
    const { whyNot } = await import('../src/assignee-nudge.js');
    const t = given('Nidhi', { assigned_to_wid: '919825011111@c.us' });
    assert.match(whyNot(t, 'pre_due', ON, DAY), /only the deadline and the first follow-up/);
    assert.match(whyNot(t, 'warning', ON, DAY), /only the deadline and the first follow-up/);
    assert.equal(whyNot(t, 'due', ON, DAY), null, 'that one does reach her');
  });

  it('turning the copy off sends her nothing extra', () => {
    /*
     * The whole point, and the thing that must not drift: this setting can
     * only ever REMOVE one of his own messages. It is not in the assignee's
     * path at all, and the caps that protect the number are constants rather
     * than settings.
     */
    const nudge = fs.readFileSync(new URL('../src/assignee-nudge.js', import.meta.url), 'utf8');
    assert.ok(!/ownCopyWhenDelegated/.test(nudge), 'it cannot reach the send-to-them path');
    assert.match(src, /const wantsWhatsApp = byKind\s*\n?\s*&& !\(task\.assigned_to && settings\.ownCopyWhenDelegated === false\)/);
    assert.match(nudge, /const MAX_PER_TASK = 2/);
  });

  it('it is on by default, because a silent deadline is how work is forgotten', async () => {
    const sched = fs.readFileSync(new URL('../src/scheduling.js', import.meta.url), 'utf8');
    assert.match(sched, /ownCopyWhenDelegated: true/);
    const { getSettings } = await import('../src/scheduling.js');
    assert.equal(getSettings().ownCopyWhenDelegated, true);
  });

  it('and he is still told each time the app messages them', () => {
    // Without this, turning the copy off would mean his staff are chased and
    // he never hears of it - which is the failure the notice exists for.
    assert.match(src, /} else if \(told && state\.status === 'ready'\)/);
  });
});

/*
 * "Auto followup done? followup history maintain?" - asked over a row reading
 * "already chased 2 times" that said nothing about when or what.
 */
describe('what was sent is on the row that says it was sent', () => {
  it('returns every message to the holder, oldest first, saying how each went out', () => {
    const task = given('Nidhi');
    recordEvent(task.id, EVENT.handoverSent, 'Nidhi', { text: 'New task for you' });
    recordEvent(task.id, EVENT.nudgeSent, 'Nidhi', { text: 'Quick update please', automatic: true });
    recordEvent(task.id, EVENT.nudgeSent, 'Nidhi', { text: 'Any news?' });
    recordEvent(task.id, EVENT.edited, 'title');
    const sent = messagesSentFor([task.id]).get(task.id);
    assert.deepEqual(sent.map((m) => m.how), ['handover', 'automatic', 'pressed']);
    assert.deepEqual(sent.map((m) => m.text), ['New task for you', 'Quick update please', 'Any news?']);
    assert.ok(sent.every((m) => m.to === 'Nidhi' && m.at));
  });

  it('agrees with the count the engine stops on', () => {
    // The log and "chased N times" read the same event, so they cannot differ.
    const task = given('Nidhi');
    recordEvent(task.id, EVENT.nudgeSent, 'Nidhi', { text: 'a', automatic: true });
    recordEvent(task.id, EVENT.nudgeSent, 'Nidhi', { text: 'b', automatic: true });
    const sent = messagesSentFor([task.id]).get(task.id);
    assert.equal(sent.filter((m) => m.how !== 'handover').length, nudgesSoFar(task.id));
  });

  it('is carried by the Task allotted rows and drawn on both views', () => {
    const route = fs.readFileSync(new URL('../src/routes/delegation.js', import.meta.url), 'utf8');
    assert.match(route, /sent: sent\.get\(task\.id\) \|\| \[\]/);
    const page = fs.readFileSync(new URL('../../frontend/src/components/Delegation.jsx', import.meta.url), 'utf8');
    assert.equal((page.match(/<SentLog sent=\{task\.sent\} \/>/g) || []).length, 2,
      'the pipeline cards and the flat rows must both show it');
  });
});

/* "How to followup screen make minimal and useful." */
describe('the follow-up screen shows the follow-up and little else', () => {
  const page = fs.readFileSync(new URL('../../frontend/src/components/Delegation.jsx', import.meta.url), 'utf8');
  const drawer = fs.readFileSync(new URL('../../frontend/src/components/TaskDetail.jsx', import.meta.url), 'utf8');
  const route = fs.readFileSync(new URL('../src/routes/delegation.js', import.meta.url), 'utf8');

  it('says the follow-up once, on the row, not again in the drawer', () => {
    // "Follow-up task ke niche dikha raha he to yaha dikhane ki need nahi":
    // the row already carries who has it, the chase line and every message
    // sent, so the drawer repeating it was the same fact twice.
    assert.ok(!/<FollowUp\b/.test(drawer), 'the drawer repeats the follow-up the row shows');
    assert.ok(!/'\/tasks\/:id\/followup'/.test(route), 'an endpoint nothing calls any more');
    assert.equal((page.match(/<SentLog sent=\{task\.sent\} \/>/g) || []).length, 2);
  });

  it('draws no stage that holds nothing', () => {
    assert.match(page, /stages\.filter\(\(s\) => s\.items\.length \|\| stage === s\.key\)/);
    assert.match(page, /const held = stages\.filter\(\(stage\) => stage\.items\.length\)/);
  });

  it('keeps the diagnosis for when there is something to diagnose', () => {
    assert.match(page, /wa && \(!wa\.ownSeenEver \|\| !wa\.delegatedEver\) && \(\s*<p className="deleg-counts">/);
  });
});

/* "Follow-up tab is very good but it's still too lengthy form." */
describe('the drawer opens on what gets acted on, and folds the rest', () => {
  const drawer = fs.readFileSync(new URL('../../frontend/src/components/TaskDetail.jsx', import.meta.url), 'utf8');
  const open = drawer.slice(drawer.indexOf('<div className="sheet-body">'), drawer.indexOf('<details'));
  const folded = drawer.slice(drawer.indexOf('<details'), drawer.indexOf('</details>'));

  it('keeps status, deadline, priority and progress outside the fold', () => {
    for (const bit of ['<label>Status</label>', 'id="d-due"', 'id="d-time"', '<label>Priority</label>', '<TaskProgress']) {
      assert.ok(open.includes(bit), `${bit} is folded away`);
    }
  });

  it('puts the long tail inside it', () => {
    for (const bit of ['id="d-title"', 'id="d-desc"', '<Checklist', '<Dependencies', '<Attachments', 'id="d-notes"', '<Reminders', 'className="facts"']) {
      assert.ok(folded.includes(bit), `${bit} is still in the open part`);
    }
  });

  it('never hides a value in silence, and survives storage that throws', () => {
    assert.match(folded, /moreHas\.length > 0 &&/);
    for (const field of ['description', 'subtasks', 'attachments', 'notes', 'source_message']) {
      assert.match(drawer, new RegExp(`task\\.${field}`), `the fold's heading does not mention ${field}`);
    }
    assert.match(drawer, /try \{ return localStorage\.getItem\('wa\.drawer\.more'\)/);
  });
});

/*
 * "▯ Medium · ▯ Low": 🟠 and 🟢 are Unicode 12, and Windows' emoji font does
 * not draw them, so on his Chrome they were empty boxes beside a 🔴 that
 * happened to be older. Priority is a drawn mark (.pri-mark) now.
 */
describe('no mark the screen cannot draw', () => {
  it('uses no Unicode 12 coloured circles or squares anywhere in the dashboard', () => {
    const dir = new URL('../../frontend/src/', import.meta.url);
    const files = ['lib/task.js', ...fs.readdirSync(new URL('components/', dir)).map((f) => `components/${f}`)];
    const late = /[\u{1F7E0}-\u{1F7EB}]/u;
    const hits = files.filter((f) => late.test(
      fs.readFileSync(new URL(f, dir), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''),
    ));
    assert.deepEqual(hits, [], `draws empty boxes on Windows: ${hits.join(', ')}`);
  });
});
