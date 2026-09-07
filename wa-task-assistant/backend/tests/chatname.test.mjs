/**
 * Where a task came from, always answerable.
 *
 * "Which chat was this?" is the question people ask of a task they do not
 * recognise, and a blank is no answer. A saved contact gives a name; an unsaved
 * one gives WhatsApp's own id, which is not something to put on a row.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../../frontend/src/lib/task.js', import.meta.url), 'utf8');
const { taskChat, formatWaNumber } = new Function(
  src.replace(/^import.*$/gm, '').replace(/export /g, '') +
  '; return { taskChat, formatWaNumber };'
)();

let pass = 0, fail = 0;
const run = (n, f) => { try { f(); pass++; console.log('  ok   ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + '\n       ' + e.message); } };

run('a named chat is shown as its name', () => {
  assert.equal(taskChat({ chat_name: 'Booknfly Accounts', chat_id: 'g1@g.us' }), 'Booknfly Accounts');
});

run('a person falls back to the contact name', () => {
  assert.equal(taskChat({ chat_name: null, contact: 'Dipen Shah' }), 'Dipen Shah');
});

run('an unsaved number is shown as a number, not as a wid', () => {
  // The row used to carry "919824106181@c.us", which nobody recognises.
  assert.equal(taskChat({ chat_name: '919824106181@c.us', chat_id: '919824106181@c.us' }),
    '+91 98241 06181');
});

run('with no name at all it still says where it came from', () => {
  assert.equal(taskChat({ chat_id: '919909993565@c.us' }), '+91 99099 93565');
});

run('a number already written properly is left alone', () => {
  assert.equal(taskChat({ chat_name: '+91 98251 25378' }), '+91 98251 25378');
});

run('a name that happens to contain digits is still a name', () => {
  assert.equal(taskChat({ chat_name: 'BNF 2026 Growth' }), 'BNF 2026 Growth');
});

run('a task with no source at all says nothing rather than guessing', () => {
  assert.equal(taskChat({ title: 'Typed by hand' }), null);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
