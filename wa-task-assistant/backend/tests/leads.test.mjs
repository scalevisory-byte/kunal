/**
 * Leads: people who might buy something.
 *
 * Two things decide the shape of this, and both are about not being wrong in
 * public:
 *
 *  1. The app never messages the lead. A follow-up reminds *him* and hands him
 *     a link to their chat; the send is a person's press. On a personal
 *     WhatsApp that is not a preference, it is the condition of the account
 *     surviving - so these tests count what the code can send and to whom.
 *
 *  2. Nothing captured from a chat files itself. A courier asking for an
 *     address looks exactly like an enquiry until somebody reads it, and a
 *     pipeline full of couriers is worth less than an empty one.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-leads-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const DB = await import('../src/db.js');
const L = await import('../src/leads.js');
const G = await import('../src/groups.js');

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

const soon = (mins) => new Date(Date.now() + mins * 60_000).toISOString();

console.log('\nsomebody arrives');

let bnf;
let mehta;

run('a lead needs a name and nothing else', () => {
  bnf = G.createGroup({ name: 'Book N Fly' });
  assert.throws(() => L.createLead({}), /needs a name/);
  mehta = L.createLead({ name: 'Mehta Sir', phone: '9824106181', group_id: bnf.id, source: 'facebook' });
  assert.equal(mehta.stage, 'new', 'and starts at the beginning');
  assert.equal(mehta.group_name, 'Book N Fly');
  assert.equal(mehta.needs_confirmation, false, 'one added by hand is not held');
});

run('a lead is not a task: nothing is owed and nothing is chased', () => {
  // No deadline, no ladder, no follow-up count. The only date is the next
  // contact, and that is a decision, not an obligation.
  for (const field of ['due_at', 'due_date', 'follow_up_count', 'needs_attention', 'status']) {
    assert.equal(field in mehta, false, `a lead must not carry ${field}`);
  }
  assert.equal(DB.db.prepare(`SELECT COUNT(*) AS n FROM tasks`).get().n, 0,
    'and it did not quietly become one');
});

console.log('\nthe pipeline');

run('the stage moves, and the move is remembered', () => {
  L.updateLead(mehta.id, { stage: 'quoted' });
  assert.equal(L.getLead(mehta.id).stage, 'quoted');
  const kinds = L.leadEvents(mehta.id).map((e) => `${e.kind}:${e.detail || ''}`);
  assert.ok(kinds.some((k) => k.startsWith('stage changed:new → quoted')), kinds.join(' | '));
});

run('closing stamps the day; reopening takes it back off', () => {
  L.updateLead(mehta.id, { stage: 'won' });
  assert.ok(L.getLead(mehta.id).closed_at, 'won is closed');
  assert.equal(L.getLead(mehta.id).closed, true);
  L.updateLead(mehta.id, { stage: 'negotiating' });
  assert.equal(L.getLead(mehta.id).closed_at, null, 'and it is open again');
});

run('the board counts what is in each stage', () => {
  const counts = L.stageCounts();
  assert.equal(counts.negotiating, 1);
  assert.equal(counts.new, 0);
});

run('the one you should call first is at the top', () => {
  const later = L.createLead({ name: 'Later Lead', next_action_at: soon(600) });
  const sooner = L.createLead({ name: 'Sooner Lead', next_action_at: soon(30) });
  const undated = L.createLead({ name: 'Undated Lead' });

  const order = L.listLeads().map((l) => l.name);
  assert.ok(order.indexOf('Sooner Lead') < order.indexOf('Later Lead'));
  assert.ok(order.indexOf('Later Lead') < order.indexOf('Undated Lead'),
    'a lead nobody has decided about sits below the ones that are dated');
});

console.log('\nthe next contact, and being reminded about it');

run('a due contact is delivered once and only once', () => {
  const lead = L.createLead({ name: 'Ready To Call', next_action_at: soon(-1) });
  assert.ok(L.dueLeadReminders(new Date().toISOString()).some((l) => l.id === lead.id));

  assert.ok(L.claimLeadReminder(lead.id), 'the first caller gets it');
  for (let i = 0; i < 5; i += 1) {
    assert.equal(L.claimLeadReminder(lead.id), null, 'and nobody else ever does');
  }
  assert.equal(L.dueLeadReminders(new Date().toISOString()).some((l) => l.id === lead.id), false);
});

run('moving the date lets it be reminded again', () => {
  const lead = L.listLeads().find((l) => l.name === 'Ready To Call');
  L.updateLead(lead.id, { next_action_at: soon(-1) });
  assert.ok(L.dueLeadReminders(new Date().toISOString()).some((l) => l.id === lead.id));
});

run('a closed lead is never chased', () => {
  const lead = L.createLead({ name: 'Already Won', next_action_at: soon(-5) });
  L.updateLead(lead.id, { stage: 'won' });
  assert.equal(L.dueLeadReminders(new Date().toISOString()).some((l) => l.id === lead.id), false);
});

run('"spoke to them" moves it on and sets the next one', () => {
  const lead = L.createLead({ name: 'Fresh Enquiry' });
  L.markContacted(lead.id, { nextAt: soon(4320), note: 'wants a quote for 12 seats' });
  const after = L.getLead(lead.id);
  assert.equal(after.stage, 'contacted', 'New becomes Contacted; a later stage is left alone');
  assert.ok(after.next_action_at);
  assert.match(after.note, /12 seats/);
  assert.ok(L.leadEvents(lead.id).some((e) => e.kind === 'contacted'));
});

console.log('\ncaptured from a chat, and held');

run('a capture waits to be confirmed and is on no board', () => {
  const held = L.createLead({
    name: 'Unknown Number', wid: '919999000011@c.us', source: 'facebook',
    source_ref: 'matched “i saw your ad”', needs_confirmation: 1,
  });
  assert.equal(L.listLeads().some((l) => l.id === held.id), false, 'not on the board');
  assert.equal(L.heldLeads().some((l) => l.id === held.id), true, 'waiting to be read');

  L.confirmLead(held.id);
  assert.equal(L.listLeads().some((l) => l.id === held.id), true);
  assert.equal(L.heldLeads().length, 0);
});

run('a held capture is never reminded about', () => {
  const held = L.createLead({ name: 'Not Yet Read', needs_confirmation: 1, next_action_at: soon(-10) });
  assert.equal(L.dueLeadReminders(new Date().toISOString()).some((l) => l.id === held.id), false);
});

run('the same number cannot open two cards', () => {
  const first = L.createLead({ name: 'Repeat Caller', wid: '919888000022@c.us' });
  const again = L.createLead({ name: 'Repeat Caller Again', wid: '919888000022@c.us' });
  assert.equal(again.id, first.id, 'a second message updates the person, it does not clone them');
});

console.log('\nthe badge that says somebody is waiting');

run('it counts what is unread and what is late, and nothing else', () => {
  const dir2 = L.leadAttention();
  const held = L.heldLeads().length;
  const late = L.listLeads().filter((l) =>
    !l.closed && l.next_action_at && new Date(l.next_action_at) <= new Date()).length;

  assert.equal(dir2.held, held);
  assert.equal(dir2.overdue, late);
  assert.equal(dir2.badge, held + late, 'the badge is the two of them');
  /*
   * Deliberately not the whole pipeline: a badge that counts every lead never
   * goes away, and a badge that never goes away is wallpaper.
   */
  assert.ok(dir2.badge <= dir2.open + held, 'it is a subset, not the total');
});

run('a lead that is closed or in the future is not on the badge', () => {
  const before = L.leadAttention().badge;
  const future = L.createLead({ name: 'Later On', next_action_at: soon(600) });
  assert.equal(L.leadAttention().badge, before, 'a future contact is not waiting');

  L.updateLead(future.id, { next_action_at: soon(-5) });
  assert.equal(L.leadAttention().badge, before + 1, 'once it is past, it is');

  L.updateLead(future.id, { stage: 'lost' });
  assert.equal(L.leadAttention().badge, before, 'and closing it clears it again');
});

console.log('\nwhat WhatsApp Business already knows');

run('the labels he filed the chat under are kept', () => {
  const lead = L.createLead({
    name: 'Harshadbhai', wid: '919879017579@c.us', source: 'facebook',
    labels: ['Arth Debt Recovery', 'AI handoff'],
  });
  assert.deepEqual(L.getLead(lead.id).labels, ['Arth Debt Recovery', 'AI handoff']);
});

run('a lead with no labels reads as an empty list, not as broken', () => {
  const lead = L.createLead({ name: 'No Labels' });
  assert.deepEqual(L.getLead(lead.id).labels, []);
});

run('the ad phrase that actually arrives is the one it looks for', () => {
  /*
   * Read off his real chats rather than guessed: Meta's click-to-WhatsApp ads
   * put "Hello! Can I get more info on this?" in the customer's mouth, and
   * every one of his ad leads opens with it. None of the phrases I invented
   * first would have matched a single one.
   */
  const sched = fs.readFileSync(new URL('../src/scheduling.js', import.meta.url), 'utf8');
  assert.match(sched, /'can i get more info on this'/);

  const wa = fs.readFileSync(new URL('../src/whatsapp.js', import.meta.url), 'utf8');
  const block = wa.slice(wa.indexOf('async function maybeLead'));
  assert.match(block.slice(0, 1400), /text\.includes\(String\(phrase\)\.toLowerCase\(\)\)/,
    'matched against the message, lower-cased both sides');
});

console.log('\nwhat this app will not do');

run('nothing in the lead code sends anything to a lead', () => {
  const src = fs.readFileSync(new URL('../src/leads.js', import.meta.url), 'utf8');
  assert.ok(!/sendMessage|client\.send/.test(src), 'leads.js sends nothing at all');

  const routes = fs.readFileSync(new URL('../src/routes/leads.js', import.meta.url), 'utf8');
  assert.ok(!/sendMessage|client\.send/.test(routes), 'and neither do its routes');
});

run("a lead's own reminder goes to his chat, never theirs", () => {
  const engine = fs.readFileSync(new URL('../src/reminders.js', import.meta.url), 'utf8');
  const block = engine.slice(engine.indexOf('async function deliverLeadReminders'));
  const body = block.slice(0, 1600);

  // Every send in the block, and what each was handed as a destination. The
  // lead's number appears in the *text* of the reminder - that is the point of
  // it - so the test has to be about the argument, not about the word.
  const sends = [...body.matchAll(/sendMessage\(([^,]+),/g)].map((m) => m[1].trim());
  assert.deepEqual(sends, ['reminderChatId()'],
    `the only destination is the linked account: ${sends.join(', ')}`);
});

run('capture is explicit, and the wide net is off by default', () => {
  const wa = fs.readFileSync(new URL('../src/whatsapp.js', import.meta.url), 'utf8');
  const block = wa.slice(wa.indexOf('async function maybeLead'));
  const capture = block.slice(0, block.indexOf('log.info'));
  assert.match(capture, /needs_confirmation: 1/, 'everything captured is held');
  assert.match(capture, /if \(row\.from_me \|\| row\.is_group\) return null;/,
    'his own messages and group chatter are not leads');
  assert.ok(!/sendMessage/.test(capture), 'and capturing one says nothing to anybody');

  const sched = fs.readFileSync(new URL('../src/scheduling.js', import.meta.url), 'utf8');
  assert.match(sched, /leadFromUnknown: false/, 'first-message-from-anyone is opt-in');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
