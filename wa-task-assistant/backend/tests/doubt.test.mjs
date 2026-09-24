/**
 * "Jisme shaq ho usko confirm karo."
 *
 * Plain conversation was becoming tasks. A task Claude is not sure about now
 * waits in "Is this a task?" on the dashboard and is on no list until he says
 * yes; so does every new task from a chat he keeps throwing tasks out of.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-doubt-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'ai';
process.env.ANTHROPIC_API_KEY = 'test-key-not-used';
process.env.TIMEZONE = 'Asia/Kolkata';

const DB = await import('../src/db.js');
const D = await import('../src/doubt.js');
const extractor = await import('../src/extractor.js');

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const msg = (chat, extra = {}) => ({
  id: Math.floor(Math.random() * 1e9), chat_id: `${chat}@c.us`, chat_name: chat,
  contact_name: chat, body: 'x', is_group: 0, from_me: 0, sent_at: new Date().toISOString(), ...extra,
});

const reply = (confidence) => ({
  title: `Task ${confidence}`, description: '', contact: '', chat_name: '', due_date: '',
  remind_time: '', priority: 'medium', confidence, source_index: 0, assigned_to: '', group: '',
});

async function extract(message, confidence) {
  extractor.setClientForTests({
    messages: { parse: async () => ({ usage: {}, stop_reason: 'end_turn', parsed_output: { tasks: [reply(confidence)] } }) },
  });
  const [task] = await extractor.extractTasks([message]);
  return task;
}

const aiTask = (chat, extra = {}) => DB.createTask({
  title: `t ${Math.random()}`, status: 'open', source: 'whatsapp', origin: 'ai',
  chat_id: `${chat}@c.us`, chat_name: chat, ...extra,
});
const throwOut = (id) => DB.updateTask(id, { archived_at: new Date().toISOString() });

describe('what Claude is not sure about is asked, not listed', () => {
  it('only a "high" task goes straight on the list', async () => {
    assert.equal((await extract(msg('Meera'), 'high')).needs_confirmation, 0);
    assert.equal((await extract(msg('Meera'), 'medium')).needs_confirmation, 1);
    assert.equal((await extract(msg('Meera'), 'low')).needs_confirmation, 1);
  });

  it('never holds his own notes-to-self chat', async () => {
    const note = msg('Me', { is_self: 1, from_me: 1 });
    assert.equal((await extract(note, 'low')).needs_confirmation, 0);
  });

  it('tells the model that talking is not a task, and doubt means low', () => {
    const src = read('src/extractor.js');
    assert.match(src, /plain conversation/);
    assert.match(src, /When in doubt between the two, choose "low"/);
  });
});

describe('a chat he keeps rejecting tasks from', () => {
  it('holds its new tasks even when Claude is sure', async () => {
    for (let i = 0; i < 3; i += 1) throwOut(aiTask('Gossip Group').id);
    aiTask('Gossip Group');
    assert.equal((await extract(msg('Gossip Group'), 'high')).needs_confirmation, 1);
  });

  it('needs three rejections, and at least half of what he decided', () => {
    assert.equal(D.isDoubtfulChat({ rejected: 2, kept: 0 }), false);
    assert.equal(D.isDoubtfulChat({ rejected: 3, kept: 3 }), true);
    assert.equal(D.isDoubtfulChat({ rejected: 3, kept: 4 }), false);
  });

  it('forgets a rejection that was undone, and finished work is not a rejection', () => {
    const undone = aiTask('Client A');
    throwOut(undone.id);
    DB.updateTask(undone.id, { archived_at: null });
    const finished = aiTask('Client A', { status: 'done' });
    throwOut(finished.id);
    assert.deepEqual(D.chatVerdicts().get('Client A@c.us'), { rejected: 0, kept: 1 });
  });

  it('says why it is asking, in the box', () => {
    for (let i = 0; i < 3; i += 1) throwOut(aiTask('Noisy').id);
    const held = aiTask('Noisy', { needs_confirmation: 1 });
    assert.deepEqual(D.heldBecause(held, D.chatVerdicts()), { reason: 'chat', rejected: 3, kept: 0 });
    assert.match(read('../frontend/src/components/NeedsConfirmation.jsx'), /held\?\.reason === 'chat'/);
  });
});

describe('a held task is on no list', () => {
  it('is left out of the board and the figures until he says yes', () => {
    assert.match(read('../frontend/src/App.jsx'), /taskData\.tasks\.filter\(\(t\) => !t\.needs_confirmation\)/);
    const before = DB.taskStats().total;
    aiTask('Quiet', { needs_confirmation: 1 });
    assert.equal(DB.taskStats().total, before);
  });
});
