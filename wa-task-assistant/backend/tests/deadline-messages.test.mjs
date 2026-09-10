/**
 * The messages that arrive when a deadline does.
 *
 * Without them a deadline reaching its moment produced nothing on the phone -
 * the twice-daily digest is a list you go and read, not the app speaking at
 * the moment the promise came due. These hold what is on, what is not, and
 * that turning it off is respected.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-dlmsg-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

await import('../src/db.js');
const S = await import('../src/scheduling.js');

describe('what a fresh install does', () => {
  it('sends the deadline messages, and not the follow-ups', () => {
    const s = S.getSettings();
    assert.equal(s.notifyWhatsApp, true, 'an hour before, and at the deadline');
    assert.equal(s.remindAtDue, true);
    assert.equal(
      s.whatsappFollowUps, false,
      'three messages after a missed deadline is how a reminder becomes something you mute'
    );
  });
});

describe('an install that predates them', () => {
  it('is turned on once', () => {
    S.saveSettings({ notifyWhatsApp: false });
    assert.equal(S.getSettings().notifyWhatsApp, false, 'as it was');

    const first = S.enableDeadlineMessagesOnce();
    assert.equal(first.changed, true);
    assert.equal(S.getSettings().notifyWhatsApp, true, 'now on');
  });

  it('and turning it off afterwards is respected', () => {
    S.saveSettings({ notifyWhatsApp: false });
    const again = S.enableDeadlineMessagesOnce();
    assert.equal(again.changed, false, 'it did not run a second time');
    assert.equal(S.getSettings().notifyWhatsApp, false, 'and the choice stands');
  });
});

describe('where those messages can go', () => {
  it("only ever the linked account's own chat", () => {
    /*
     * The rule that matters more than any setting. Read from the source: the
     * reminder sender must resolve its recipient through reminderChatId() and
     * never from the task, the chat it came from, or anybody named on it.
     */
    const text = fs.readFileSync(new URL('../src/reminders.js', import.meta.url), 'utf8');
    const calls = [...text.matchAll(/(?<!function\s)(?<![A-Za-z.])sendMessage\(\s*([^,\n]+)/g)]
      .map((m) => m[1].trim());
    assert.ok(calls.length > 0, 'it does send something');
    for (const target of calls) {
      assert.equal(target, 'reminderChatId()', `sends to ${target}`);
    }
  });
});
