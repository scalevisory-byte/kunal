/*
 * By Chat, read as "by person": "sahil ke 4 task he to sahil ka name open
 * kare to o dikhe" - the work that came from Sahil AND the work given to him,
 * under one name.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { byPerson, personNote } = await import('../../frontend/src/lib/people.js');
const read = (rel) => fs.readFileSync(new URL(`../../frontend/src/${rel}`, import.meta.url), 'utf8');

const t = (id, extra = {}) => ({ id, title: `t${id}`, status: 'open', origin: 'ai', ...extra });
const sahil = { chat_id: '919800000001@c.us', chat_name: 'Sahil' };
const find = (sections, label) => sections.find((s) => s.label === label);

describe('one section per person, both directions', () => {
  it('puts work from Sahil and work given to Sahil under Sahil', () => {
    const sections = byPerson([
      t(1, sahil), t(2, sahil), t(3, sahil),
      t(4, { origin: 'manual', assigned_to: 'Sahil', assigned_to_wid: '919800000001@c.us' }),
    ]);
    const s = find(sections, 'Sahil');
    assert.deepEqual(s.from.map((x) => x.id), [1, 2, 3]);
    assert.deepEqual(s.given.map((x) => x.id), [4]);
    assert.equal(s.items.length, 4);
    assert.equal(personNote(s), '3 from them · 1 given to them');
    assert.equal(find(sections, 'Added by hand'), undefined, 'a given task is not also "added by hand"');
  });

  it('matches a typed name to the chat when no number is on the task', () => {
    const sections = byPerson([
      t(1, { chat_id: '919800000002@c.us', chat_name: 'NIDHI BNF' }),
      t(2, { origin: 'manual', assigned_to: 'Nidhi Bnf' }),
    ]);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].items.length, 2);
  });

  it('lists a task under who asked AND who it was given to', () => {
    const sections = byPerson([t(1, { ...sahil, assigned_to: 'Nidhi' })]);
    assert.deepEqual(find(sections, 'Sahil').from.map((x) => x.id), [1]);
    assert.deepEqual(find(sections, 'Nidhi').given.map((x) => x.id), [1]);
  });

  it('keeps a group as its own section, never merged with a person of the same name', () => {
    const sections = byPerson([
      t(1, { chat_id: '1203630001@g.us', chat_name: 'Sahil', is_group: 1 }),
      t(2, sahil),
    ]);
    assert.equal(sections.length, 2);
    assert.equal(personNote(sections.find((s) => s.group)), null);
  });

  it('puts "Added by hand" last and the busiest person first', () => {
    const sections = byPerson([
      t(1, { origin: 'manual' }), t(2, { origin: 'manual' }), t(3, { origin: 'manual' }),
      t(4, sahil), t(5, sahil), t(6, { chat_name: 'Vikas' }),
    ]);
    assert.deepEqual(sections.map((s) => s.label), ['Sahil', 'Vikas', 'Added by hand']);
  });
});

describe('the page shows the given half', () => {
  const app = read('App.jsx');
  it('lets allotted work through when grouped by person, but never into the table', () => {
    assert.match(app, /withSomebody\(task\) && !showAllotted && !personView/);
    assert.match(app, /personView = groupBy === 'chat' && !\(layout === 'table'/);
  });
  it('splits a person with both kinds into From / Given to', () => {
    const list = read('components/TaskList.jsx');
    assert.match(list, /byPerson\(tasks\)/);
    assert.match(list, /From \{section\.label\}/);
    assert.match(list, /Given to \{section\.label\}/);
  });
});

describe('every door opens the page', () => {
  it('Jump to → By Chat navigates rather than grouping a dashboard with no list', () => {
    const app = read('App.jsx');
    assert.match(app, /if \(key === 'chat'\) return goto\('chat'\);/);
    assert.doesNotMatch(app, /if \(key === 'chat'\) return setGroupBy\('chat'\);/);
  });
});

describe('old tasks are under the person too', () => {
  const done = (id, extra) => t(id, { status: 'done', ...extra });

  it('puts finished work in the person\'s Done, whichever way it went, newest first', () => {
    const sections = byPerson([
      t(1, sahil),
      done(2, { ...sahil, completed_at: '2026-09-01T10:00:00Z' }),
      done(3, { origin: 'manual', assigned_to: 'Sahil Shah', assigned_to_wid: sahil.chat_id, completed_at: '2026-09-20T10:00:00Z' }),
    ].map((x) => (x.chat_name ? { ...x, chat_name: 'Sahil Shah' } : x)));
    const s = find(sections, 'Sahil Shah');
    assert.deepEqual(s.items.map((x) => x.id), [1], 'the count is what is still owed');
    assert.deepEqual(s.done.map((x) => x.id), [3, 2]);
    assert.equal(personNote(s), '1 from them · 2 done');
  });

  it('keeps a person whose work is all finished', () => {
    const sections = byPerson([done(1, sahil)]);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].items.length, 0);
    assert.equal(sections[0].done.length, 1);
  });

  it('the page loads everything but opens on Pending, never mixing the two', () => {
    const app = read('App.jsx');
    const list = read('components/TaskList.jsx');
    assert.match(app, /if \(key === 'chat'\) return setView\('all'\);/);
    assert.match(list, /useState\('pending'\)/, 'Pending on every visit, not remembered');
    assert.match(list, /groupBy === 'chat'\) sections = byChat\(tasks, canShowDone \? chatShow : 'pending'\)/);
    assert.match(list, /groupBy !== 'chat' && done\.length/);
    assert.doesNotMatch(list, /doneOpen/, 'no Done fold inside the pending list');
  });
});

describe('the chat list, WhatsApp\'s way', async () => {
  const { chatOrder, lastActivity } = await import('../../frontend/src/lib/people.js');

  it('puts the person with the newest activity first and "Added by hand" last', () => {
    const sections = byPerson([
      t(1, { origin: 'manual', created_at: '2026-09-29 09:00:00' }),
      t(2, { chat_name: 'Old', chat_id: '911@c.us', created_at: '2026-09-01 09:00:00' }),
      t(3, { chat_name: 'New', chat_id: '912@c.us', created_at: '2026-09-28 09:00:00' }),
      t(4, { chat_name: 'Finished', chat_id: '913@c.us', status: 'done', completed_at: '2026-09-20T09:00:00Z' }),
    ]);
    assert.deepEqual(chatOrder(sections).map((s) => s.label), ['New', 'Finished', 'Old', 'Added by hand']);
  });

  it('previews the newest task still owed, and a finished one only when nothing is owed', () => {
    const [s] = byPerson([
      t(1, { ...sahil, created_at: '2026-09-01 09:00:00', title: 'older' }),
      t(2, { ...sahil, created_at: '2026-09-28 09:00:00', title: 'newer' }),
      t(3, { ...sahil, status: 'done', completed_at: '2026-09-29T09:00:00Z', title: 'finished' }),
    ]);
    assert.equal(lastActivity(s).task.title, 'newer');
    const [only] = byPerson([t(3, { ...sahil, status: 'done', completed_at: '2026-09-29T09:00:00Z', title: 'finished' })]);
    assert.deepEqual([lastActivity(only).task.title, lastActivity(only).done], ['finished', true]);
  });

  it('is the default layout, with the old one a remembered switch away', () => {
    const list = read('components/TaskList.jsx');
    assert.match(list, /localStorage\.getItem\(CHAT_LAYOUT\) === 'list' \? 'list' : 'chats'/);
    assert.match(list, /<PersonChats sections=\{sections\} row=\{row\} mode=/);
    const pc = read('components/PersonChats.jsx');
    assert.match(pc, /\{current\.items\.map\(row\)\}/, 'the rows are the board\'s own TaskItem');
  });

  it('lays the rows out by the pane\'s width, not the window\'s', () => {
    const css = read('styles.css');
    assert.match(css, /\.pc-detail \{ container: pcdetail \/ inline-size; \}/);
    assert.match(css, /@container pcdetail \(max-width: 900px\)/);
  });
});

describe('"chat wala option yaha pe bhi de do"', () => {
  const toolbar = read('components/Toolbar.jsx');
  const app = read('App.jsx');
  it('puts Chats in the List · Table · Calendar switch, opening the By Chat page', () => {
    assert.match(toolbar, /onChats && \([\s\S]*?<Icon name="chat"[^>]*\/> Chats/);
    assert.match(app, /onChats=\{[^}]*\(\) => goto\('chat'\)/);
  });
  it('keeps the switch on By Chat, with Chats lit and List / Table leading back to All Tasks', () => {
    assert.match(app, /layout=\{section === 'chat' \? 'chats'/);
    assert.match(app, /section === 'chat'\s*\? \(key\) => \{ goto\('all'\); pickLayout\(key\); \}/);
  });
  it('names the page\'s own two shapes so they are not a second "List"', () => {
    assert.match(read('components/TaskList.jsx'), /\['chats', 'Side by side'\], \['list', 'One below another'\]/);
  });
});

describe('"isme completed kese dikhege": Pending · Completed', async () => {
  const { chatSections, chatOrder, lastActivity } = await import('../../frontend/src/lib/people.js');
  const mixed = [
    t(1, sahil),
    t(2, { ...sahil, status: 'done', completed_at: '2026-09-20T10:00:00Z' }),
    t(3, { chat_id: '9111@c.us', chat_name: 'Ravi', status: 'done', completed_at: '2026-09-25T10:00:00Z' }),
  ].map((x) => (x.chat_name === 'Sahil' ? { ...x, chat_name: 'Sahil Shah' } : x));

  it('Pending lists only people with something pending, and none of their finished work', () => {
    const s = chatSections(byPerson(mixed), 'pending');
    assert.deepEqual(s.map((x) => x.label), ['Sahil Shah']);
    assert.deepEqual(s[0].items.map((x) => x.id), [1]);
    assert.equal(s[0].done.length, 0);
  });

  it('Completed lists only finished work, under the person it was for, newest first', () => {
    const s = chatOrder(chatSections(byPerson(mixed), 'done'), 'completed_at');
    assert.deepEqual(s.map((x) => x.label), ['Ravi', 'Sahil Shah']);
    assert.deepEqual(s[1].items.map((x) => x.id), [2]);
    assert.equal(lastActivity(s[0], 'completed_at').at, '2026-09-25T10:00:00Z');
  });

  it('offers the switch only where finished tasks are loaded, and keeps it when a side is empty', () => {
    const list = read('components/TaskList.jsx');
    assert.match(list, /const canShowDone = byPeople && view === 'all';/);
    assert.match(list, /\['pending', 'Pending'\], \['done', 'Completed'\]/);
    assert.match(list, /if \(!sections\.length\) \{[\s\S]*?\{layoutSwitch\}/);
  });
});
