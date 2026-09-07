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
const { taskChat, taskSource, readableName } = new Function(
  src.replace(/^import.*$/gm, '').replace(/export /g, '') +
  '; return { taskChat, taskSource, readableName };'
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

console.log('\na group message says who wrote it, as well as where');

run('a group shows the sender and the group', () => {
  /*
   * A request in BOOK N FLY LEGAL TEAM is a different thing depending on
   * whether Hasmukh or the advocate wrote it, and the group alone does not say.
   */
  const s = taskSource({ is_group: 1, chat_name: 'BOOK N FLY LEGAL TEAM', contact: 'HASMUKH' });
  assert.equal(s.label, 'HASMUKH · BOOK N FLY LEGAL TEAM');
  assert.equal(s.group, 'BOOK N FLY LEGAL TEAM');
  assert.equal(s.sender, 'HASMUKH');
});

run('a one-to-one chat stays one name', () => {
  const s = taskSource({ is_group: 0, chat_name: 'Dipen Shah', contact: 'Dipen Shah' });
  assert.equal(s.label, 'Dipen Shah', 'the two are the same person written twice');
  assert.equal(s.sender, undefined);
});

run('a group with no known sender still names the group', () => {
  assert.equal(taskSource({ is_group: 1, chat_name: 'BNF - GROWTH TEAM' }).label, 'BNF - GROWTH TEAM');
});

run('a group whose name is also the sender is not printed twice', () => {
  assert.equal(taskSource({ is_group: 1, chat_name: 'Booknfly', contact: 'Booknfly' }).label, 'Booknfly');
});

console.log('\na stylised group name is made readable');

run('mathematical letters become plain ones', () => {
  /*
   * Not decoration in a font - they are different characters, Unicode's
   * mathematical alphabets, and the app's self-hosted faces have no glyphs for
   * them, so a real group name arrived on the row as a row of boxes.
   */
  assert.equal(readableName('\u{1D53B}\u{1D542}\u{1D54A}\u{1D543}'), 'DKSL');
  assert.equal(taskSource({ is_group: 1, chat_name: '\u{1D401}\u{1D40D}\u{1D40D}', contact: 'Vikas' }).label,
    'Vikas · BNN');
});

run('circled and fullwidth letters too', () => {
  assert.equal(readableName('\u24B7\u24C3\u24BB'), 'BNF');
  assert.equal(readableName('\uFF26\uFF55\uFF4C\uFF4C'), 'Full');
});

run('accents, Gujarati, Hindi and emoji are left exactly as they are', () => {
  // NFKC composes compatibility forms; it does not strip anything real.
  for (const n of ['José Fernández', 'ગુજરાતી ગ્રુપ', 'अकाउंट्स', 'BNF - GROWTH TEAM 🌟', 'Mummy ❤️ Home']) {
    assert.equal(readableName(n), n, n);
  }
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
