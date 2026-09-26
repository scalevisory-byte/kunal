/**
 * "Jo my own number pe task reminder and task list aa rahi he usko bandh karo."
 *
 * One switch, whatsappToMe, off by default, in front of every scheduled task
 * message to his own chat. The bell and the browser notification carry on.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ownchat-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const S = await import('../src/scheduling.js');
const B = await import('../src/briefing.js');
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const reminders = read('src/reminders.js');

describe('task messages to his own number', () => {
  it('are off unless he turns them on', () => {
    assert.equal(S.getSettings().whatsappToMe, false);
  });

  it('keep the briefing and weekly review quiet even when those are switched on', async () => {
    S.saveSettings({ dailyBriefing: true, briefingTime: '00:01', weeklySummary: true, whatsappToMe: false });
    assert.equal((await B.maybeSendBriefing()).reason, 'off');
    assert.equal((await B.maybeSendWeekly()).reason, 'off');
    // "Send now" is a press, and a press is asked for.
    assert.notEqual((await B.maybeSendBriefing({ force: true })).reason, 'off');
  });

  it('stop the twice-daily list, but not a press of "run now"', () => {
    assert.match(reminders, /const toMe = label === 'manual' \|\| getSettings\(\)\.whatsappToMe;/);
    const at = reminders.indexOf('const toMe');
    const send = reminders.indexOf('await sendMessage(reminderChatId(), digest)');
    assert.ok(at > 0 && at < send, 'decided before the send');
  });

  it('stop deadline reminders, follow-ups, notes and leads', () => {
    assert.match(reminders, /const wantsWhatsApp = settings\.whatsappToMe && byKind/);
    const gated = reminders.match(/if \(settings\.whatsappToMe && settings\.notifyWhatsApp && state\.status === 'ready'\)/g) || [];
    assert.equal(gated.length, 2, 'note and lead reminders');
    assert.ok(!/if \(settings\.notifyWhatsApp && state\.status === 'ready'\)/.test(reminders), 'none left ungated');
  });

  it('still reach the bell, so nothing goes silent', () => {
    assert.match(reminders, /addNotification\(\{\s*\n\s*kind: reminder\.kind === 'follow_up'/);
    assert.match(reminders, /kind: 'nudge'/);
  });

  it('is a switch in Settings, and greys out the WhatsApp options under it', () => {
    const ui = read('../frontend/src/components/SchedulingSettings.jsx');
    assert.match(ui, /save\(\{ whatsappToMe: v \}\)/);
    assert.equal((ui.match(/disabled=\{[^}]*!settings\.whatsappToMe\}/g) || []).length, 5);
  });
});
