/**
 * Answering "which chat is Nidhi?" — the dead end behind "unable to send msg".
 *
 * A task handed over by typing a name carries the name and nothing else, so
 * the Nudge button had no chat to send to. That much was honest. What was not:
 *
 *   - Putting her number on the Staff list afterwards did nothing, because the
 *     nudge route read the task's own column and never the list. Nothing would
 *     have helped, ever — the wid is copied onto a task when the work is handed
 *     over, so a number learnt later could not reach a task already given.
 *   - Meanwhile the automatic reminder resolved through the staff list quite
 *     happily. So the app could message her on its own while the button a
 *     person pressed could not, which is exactly backwards.
 *
 * The cure is the app's own memory: it has seen her chat for months. So the
 * question is asked where it arises and answered by picking a name. The rails
 * on that lookup are what these cases are mostly about, because this is the one
 * place in the app that decides where a message goes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-nudgechat-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';

const { createTask, getTask, insertMessage, findChats } = await import('../src/db.js');
const { assignTask, addStaff, listStaff } = await import('../src/assignment.js');
const { chatForAssignee } = await import('../src/assignee-nudge.js');

const seen = (chat_id, chat_name, number, is_group = 0, n = 2) => {
  for (let i = 0; i < n; i += 1) {
    insertMessage({
      wa_message_id: `${chat_id}-${i}-${Math.random()}`,
      chat_id, chat_name, contact_name: chat_name, contact_number: number,
      body: 'ok', is_group, from_me: 0,
      sent_at: new Date(Date.now() - i * 3_600_000).toISOString(),
    });
  }
};

seen('919825011111@c.us', 'Nidhi Chaudry BNF', '919825011111');
seen('919825022222@c.us', 'Nidhi Patel', '919825022222');
seen('120363000001@g.us', 'Nidhi Family', null, 1);
seen('202383321759941@lid', '202383321759941:33', null);

describe('finding the chat a name belongs to', () => {
  it('offers every chat of that name and picks none of them', () => {
    const hits = findChats('nidhi');
    const names = hits.map((c) => c.name);
    assert.ok(names.includes('Nidhi Chaudry BNF'));
    assert.ok(names.includes('Nidhi Patel'));
    /*
     * Two Nidhis is the normal case, not an edge one, and it is why nothing
     * here chooses. Deciding "Nidhi means this Nidhi" alone is how a person's
     * work reaches a stranger — so the number is shown under each name,
     * because that is what tells them apart.
     */
    assert.ok(hits.every((c) => c.number), 'each one carries the number that identifies it');
  });

  it('never offers a group, whatever it is called', () => {
    // A nudge names one person and says what they owe. Sending that to twenty
    // people is a different act, and it is not one a picker should make easy.
    assert.ok(!findChats('nidhi').some((c) => c.id.endsWith('@g.us')));
    assert.equal(findChats('Nidhi Family').length, 0);
  });

  it('never offers a chat it has not actually seen', () => {
    assert.equal(findChats('Vikas Gupta').length, 0, 'nothing is invented to fill the list');
    assert.equal(findChats('n').length, 0, 'and one letter is not a search');
  });

  it('finds a chat by number as readily as by name', () => {
    assert.equal(findChats('9825011').length, 1);
    // A number typed the way a person types it is the same number.
    assert.equal(findChats('+91 98250 22222')[0]?.id, '919825022222@c.us');
  });

  it('an id is never shown as a name', () => {
    // A linked identity names nobody. Blank is honest; "202383321759941:33" is
    // not, and it has been on these screens before.
    const lid = findChats('2023833').find((c) => c.id.endsWith('@lid'));
    if (lid) assert.equal(lid.name, null);
  });
});

describe('the button and the engine use one rule', () => {
  it('a name with a chat on the staff list can be nudged', () => {
    const task = createTask({ title: 'File GST for Nidhi', source: 'manual', origin: 'manual' });
    assignTask(task.id, 'Nidhi');
    assert.equal(getTask(task.id).assigned_to_wid, null, 'typed by name: no chat on the task');
    assert.equal(chatForAssignee(getTask(task.id)), null);

    addStaff('Nidhi', { wid: '919825011111@c.us', number: '919825011111' });
    /*
     * THE BUG. This resolves now, and the manual nudge route reads exactly
     * this — it used to read `task.assigned_to_wid`, which a number added
     * later can never reach. The engine always read this; the button did not,
     * so the app could message her on its own but not when asked to.
     */
    assert.equal(chatForAssignee(getTask(task.id)), '919825011111@c.us');
  });

  it('the route both halves call is the same function', () => {
    const src = fs.readFileSync(new URL('../src/routes/delegation.js', import.meta.url), 'utf8');
    const nudge = src.slice(src.indexOf("delegationRouter.get('/tasks/:id/nudge'"));
    assert.ok(!/task\.assigned_to_wid/.test(nudge), 'nothing reads the column directly any more');
    assert.equal((src.match(/chatForAssignee\(task\)/g) || []).length, 2, 'preview and send');
  });

  it('answering once answers it everywhere', () => {
    const task = createTask({ title: 'Scan mediclaim file', source: 'manual', origin: 'manual' });
    assignTask(task.id, 'Meera');
    // What POST /tasks/:id/chat does: the task so this nudge can go now, the
    // staff list so her other tasks — and the automatic reminder, which reads
    // that list — know it too.
    assignTask(task.id, 'Meera', '919825033333@c.us');
    addStaff('Meera', { wid: '919825033333@c.us', number: '919825033333' });

    const other = createTask({ title: 'Collect staff documents', source: 'manual', origin: 'manual' });
    assignTask(other.id, 'Meera');
    assert.equal(chatForAssignee(getTask(other.id)), '919825033333@c.us',
      'a task given before the chat was known can still reach her');
    assert.equal(listStaff().filter((p) => p.name.toLowerCase() === 'meera').length, 1,
      'and she is one person, not two');
  });
});
