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
const { resolveSendable, state } = await import('../src/whatsapp.js');

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


/*
 * And then the send itself failed, on a connected session, saying nothing.
 *
 * Reported as a red line reading *"WhatsApp could not send that right now"* —
 * the whole of what the route said, with **nothing written to the log** either.
 * So a number that is not on WhatsApp, a linked identity that cannot be
 * addressed and a passing network blip all read identically, and none of them
 * could be acted on.
 *
 * Underneath it, the id was a guess: `@c.us` stuck onto some digits is what a
 * typed number and a contact number stored inside a message both give, and it
 * is a guess at the id WhatsApp actually files that person under. `getNumberId`
 * is the answer instead of the guess — and it says, for free, whether that
 * number is on WhatsApp at all.
 */
describe('saying why a send failed, and asking WhatsApp for the right id', () => {
  const chat = (id) => ({ id: { _serialized: id } });

  it('a chat WhatsApp already knows needs no lookup', async () => {
    let asked = 0;
    const api = {
      getChatById: async () => chat('919825011111@c.us'),
      getNumberId: async () => { asked += 1; return null; },
    };
    state.status = 'ready';
    const out = await resolveSendable('919825011111@c.us', api);
    assert.equal(out.ok, true);
    assert.equal(out.wid, '919825011111@c.us');
    assert.equal(asked, 0, 'a round trip that buys nothing is not made');
  });

  it('a guessed id is replaced by the one WhatsApp gives', async () => {
    /* WhatsApp answering with an id that is not the one we constructed is the
       whole point: `919825011111@c.us` is where it files the person, and
       `9825011111@c.us` — a number typed without the country code — is not. */
    const api = {
      getChatById: async () => null,
      getNumberId: async () => ({ _serialized: '919825011111@c.us' }),
    };
    state.status = 'ready';
    const out = await resolveSendable('9825011111@c.us', api);
    assert.equal(out.ok, true);
    assert.equal(out.wid, '919825011111@c.us', 'the answer, not the guess');
    // `corrected` is what tells the route to write it back, so the lookup
    // happens once rather than on every press.
    assert.equal(out.corrected, true);
  });

  it('a number that is not on WhatsApp says exactly that', async () => {
    const api = { getChatById: async () => null, getNumberId: async () => null };
    state.status = 'ready';
    const out = await resolveSendable('919999999999@c.us', api);
    assert.equal(out.ok, false);
    assert.match(out.reason, /not on WhatsApp/);
    // And it names the number, because the commonest cause is a missing
    // country code and you cannot see that in a sentence that omits it.
    assert.match(out.reason, /919999999999/);
  });

  it('a group is refused before anything is looked up', async () => {
    let touched = 0;
    const api = {
      getChatById: async () => { touched += 1; return chat('x'); },
      getNumberId: async () => { touched += 1; return null; },
    };
    state.status = 'ready';
    const out = await resolveSendable('120363000001@g.us', api);
    assert.equal(out.ok, false);
    assert.match(out.reason, /group/);
    assert.equal(touched, 0);
  });

  it('a disconnected session is its own answer, not a lookup failure', async () => {
    state.status = 'disconnected';
    const out = await resolveSendable('919825011111@c.us', { getChatById: async () => null, getNumberId: async () => null });
    assert.equal(out.ok, false);
    assert.match(out.reason, /not connected/);
    state.status = 'ready';
  });

  it('the route logs the failure and passes the reason on', () => {
    const src = fs.readFileSync(new URL('../src/routes/delegation.js', import.meta.url), 'utf8');
    const send = src.slice(src.indexOf("delegationRouter.post('/tasks/:id/nudge'"));
    assert.match(send, /log\.error\(/, 'a failure nobody can read is a failure nobody can fix');
    assert.match(send, /err\?\.message/, "and it is WhatsApp's own words, not a paraphrase");
    assert.match(send, /log\.warn\(/, 'a refusal before the send is logged too');
    assert.ok(!/error: 'WhatsApp could not send that right now'/.test(send),
      'the sentence with nothing behind it is gone');
  });

  it('the preview reports the problem before the button is pressed', () => {
    // A Send button that is enabled and then fails is worse than one never
    // offered: the message looks sent.
    const src = fs.readFileSync(new URL('../src/routes/delegation.js', import.meta.url), 'utf8');
    const preview = src.slice(
      src.indexOf("delegationRouter.get('/tasks/:id/nudge'"),
      src.indexOf("delegationRouter.get('/chats'")
    );
    assert.match(preview, /await resolveSendable\(wid\)/);
    assert.match(preview, /can_send: Boolean\(target\?\.ok\)/, 'the button follows the real answer');
    assert.match(preview, /problem:/, 'and the reason travels with it');
  });
});
