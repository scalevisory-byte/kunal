/**
 * Where the app is allowed to put a message.
 *
 * The rule was one line: nothing this app does on its own may place a message
 * in anybody else's chat, the Nudge button excepted - one press, one message.
 *
 * That rule was overruled on purpose ("karna to he hi"): a task given to
 * somebody is now chased on WhatsApp without a press. So the rule became two
 * lines rather than none. There are exactly TWO places a message can leave for
 * somebody else - the Nudge button and assignee-nudge.js - and this test still
 * holds every other send to the original rule, because the failure mode has
 * not changed: a message goes to a client and nobody finds out from the
 * dashboard.
 *
 * What guards the new one is not this file but its own rails, which
 * assignee-nudge.test.mjs pins: never a group, never at night, never more than
 * twice about one job, never a number nobody deliberately stored. The last
 * case below makes sure that file is the only door.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', 'src');

/** Every `sendMessage(<first argument>` in the backend, with its file. */
function sendTargets() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  walk(src);

  const found = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    // A call, not the declaration or an import of it.
    const re = /(?<!function\s)(?<![A-Za-z.])sendMessage\(/g;
    let m;
    while ((m = re.exec(text))) {
      // Read the first argument by hand: a naive comma split cuts
      // `reminderChatId()` in half at its own bracket.
      let depth = 1;
      let i = m.index + m[0].length;
      let arg = '';
      while (i < text.length && depth > 0) {
        const ch = text[i];
        if (ch === '(') depth += 1;
        else if (ch === ')') { depth -= 1; if (!depth) break; }
        else if (ch === ',' && depth === 1) break;
        arg += ch;
        i += 1;
      }
      arg = arg.trim();
      if (!arg) continue;
      found.push({ file: path.basename(file), arg });
    }
  }
  return found;
}

describe('nothing automatic reaches somebody else', () => {
  const targets = sendTargets();

  it('finds the sends, so this test cannot pass by finding none', () => {
    assert.ok(targets.length >= 5, `only found ${targets.length}`);
  });

  it('every send is his own chat, a reply in a chat he wrote in, or the Nudge', () => {
    const allowed = new Set([
      // His own chat. Reminders, digest, briefing, weekly review, answers.
      'reminderChatId()',
      // The chat a command arrived in - and handleCommand refuses to act
      // unless that chat IS his own, which the next test pins down.
      'chatId',
      /*
       * The person a task was given to — the engine chasing them, and the
       * Nudge button a person presses. Both send to `chat`, and in both places
       * `chat` is chatForAssignee(task), which is pinned below: it resolves
       * only from the task's own stored id or the Staff list, never from a
       * name, and every rail around the automatic half lives in one file.
       *
       * `task.assigned_to_wid` used to be on this list, and taking it off is
       * the point. Reading that column directly is what made the Nudge button
       * unable to reach somebody whose number was added after the task was
       * handed over — while the engine, reading the line below, could.
       *
       * `target.wid` is that same chat after WhatsApp has been asked for the
       * id it really files the person under — a second hop from `chat`, never
       * a second source. The chain is pinned below rather than taken on
       * trust, because a guard on a variable name guards nothing.
       */
      'chat',
      'target.wid',
    ]);
    for (const t of targets) {
      assert.ok(allowed.has(t.arg), `${t.file} sends to ${t.arg}, which is not on the list`);
    }
  });

  it('and those names are never anything but the one chain', () => {
    // The name is only as good as what is behind it, in every file that uses
    // it — otherwise this whole list is guarding a variable name.
    for (const file of ['assignee-nudge.js', path.join('routes', 'delegation.js')]) {
      const text = fs.readFileSync(path.join(src, file), 'utf8');
      if (/sendMessage\(\s*chat\b/.test(text)) {
        assert.match(text, /const chat = chatForAssignee\(task\)/,
          `${file} sends to \`chat\` without resolving it through chatForAssignee`);
      }
      if (/sendMessage\(\s*target\.wid\b/.test(text)) {
        // One hop further, and the hop must be the resolver - not a body
        // field, not a query parameter, not a name looked up somewhere else.
        assert.match(text, /const target = await resolveSendable\(chat\)/,
          `${file} sends to \`target.wid\` without resolving it from chat`);
        assert.match(text, /const chat = chatForAssignee\(task\)/,
          `${file} resolves a chat that did not come from chatForAssignee`);
      }
    }
  });

  it('a command is only acted on in his own chat, so its reply cannot escape', () => {
    const text = fs.readFileSync(path.join(src, 'whatsapp.js'), 'utf8');
    const body = text.slice(text.indexOf('export async function handleCommand'));
    const guard = body.slice(0, body.indexOf('let targets'));
    assert.match(guard, /chatId !== reminderChatId\(\)/, 'the guard is still there');
    assert.match(guard, /return false/);
  });

  it('only one file may send to somebody else without a press', () => {
    /* The Nudge is a route, so it is reached by a person. Everything else that
       can address another chat must be the one bounded file - if a second one
       appears, these rails have been copied and one copy will fall behind. */
    const automatic = targets.filter((t) => t.arg === 'chat' || t.arg === 'target.wid');
    const files = new Set(automatic.map((t) => t.file));
    assert.deepEqual([...files].sort(), ['assignee-nudge.js', 'delegation.js']);
  });

  it('that file refuses a group, the night, and a third message', () => {
    const text = fs.readFileSync(path.join(src, 'assignee-nudge.js'), 'utf8');
    assert.match(text, /@g\.us/, 'a group must be refused by name');
    assert.match(text, /MAX_PER_TASK/);
    assert.match(text, /DAY_START|DAY_END/);
    /* And it cannot send at all while the switch is off. */
    assert.match(text, /if \(!settings\.nudgeAssignee\) return/);
  });

  it('a note typed in somebody else\'s chat is confirmed to him, not to them', () => {
    const text = fs.readFileSync(path.join(src, 'whatsapp.js'), 'utf8');
    const body = text.slice(text.indexOf('export async function maybeSaveNote'));
    const fn = body.slice(0, body.indexOf('\n}\n'));
    assert.match(fn, /sendMessage\(\s*\n?\s*reminderChatId\(\)/, 'confirmation goes to his own chat');
    assert.doesNotMatch(fn, /sendMessage\(chatId/, 'and never back into the chat he typed in');
  });
});
