/**
 * "Task list me se direct assign ka option do."
 *
 * The table's Assignee column said "You" and did nothing. It is the list's own
 * Staff button now: one press, a name required, the same handler as the list.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../../frontend/src/${p}`, import.meta.url), 'utf8');
const table = read('components/TaskTable.jsx');
const app = read('App.jsx');
const css = read('styles.css');

describe('assigning from the table', () => {
  it('uses the list\'s own Staff button, not a copy', () => {
    assert.match(table, /import \{ RowMenu, AssignButton[^}]*\} from '\.\/TaskItem\.jsx'/);
    assert.match(table, /<AssignButton task=\{task\} people=\{people\} onAssign=\{onAssign\} \/>/);
    assert.ok(!/function AssignButton/.test(table));
  });

  it('shares one handler with the list', () => {
    assert.match(app, /const onAssign = async \(task, name, wid\) =>/);
    assert.equal((app.match(/onAssign=\{onAssign\}/g) || []).length, 2, 'table and list');
  });

  it('opens its menus upward on the bottom rows, and keeps the phone from scrolling sideways', () => {
    assert.match(css, /\.tt-table tbody tr:nth-last-child\(-n\+3\):not\(:nth-child\(-n\+3\)\) \.menu \{\s*\n\s*top: auto; bottom: calc\(100% \+ 4px\);/);
    assert.match(css, /\.tt-scroll \{ overflow-x: auto; position: relative; \}/);
  });
});

describe('the phone\'s bottom bar', () => {
  it('opens the list, because the dashboard has none', () => {
    assert.match(app, /if \(v === 'myday'\) goto\('myday'\);\s*\n\s*else \{ goto\('all'\); setView\(v\); \}/);
    assert.ok(!/onView=\{\(v\) => \{ setSection\('dashboard'\)/.test(app));
  });
});

describe('the table\'s columns', () => {
  it('has no Priority column ("priority yaha se hata do")', () => {
    assert.ok(!/label: 'Priority'/.test(table));
    assert.ok(!/tt-pri/.test(table) && !/\.tt-pri/.test(css));
  });
});

describe('finishing a task from the table', () => {
  it('is one press, on every open row, with an Undo that restores the old status', () => {
    assert.match(table, /\{onDone && !done && \(\s*\n\s*<button\s*\n\s*type="button"\s*\n\s*className="tt-done"/);
    assert.match(app, /const onDone = async \(task\) =>/);
    assert.match(app, /setUndo\(\{ kind: 'done', id: task\.id, title: task\.title, from: task\.status \}\)/);
    assert.match(app, /if \(last\.kind === 'done'\) return api\.updateTask\(last\.id, \{ status: last\.from \|\| 'open' \}\)/);
    assert.match(app, /onDone=\{onDone\}/);
  });
});

describe('renaming from the table', () => {
  it('has the list\'s pencil beside every title, shown on hover and always on touch', () => {
    assert.match(table, /className="t-rename"[\s\S]{0,120}onClick=\{rename\.start\}/);
    assert.match(css, /\.tt-table tbody tr:hover \.t-rename,\s*\n\.tt-table tbody tr:focus-within \.t-rename \{ opacity: 1; \}/);
    assert.match(css, /@media \(hover: none\) \{ \.t-rename \{ opacity: 1; \} \}/);
  });
});

describe('assigning to anybody, not only staff', () => {
  const item = fs.readFileSync(new URL('../../frontend/src/components/TaskItem.jsx', import.meta.url), 'utf8');
  it('the button says Assign, and the field invites a CA or a party', () => {
    assert.match(item, /<span>\{held \|\| 'Assign'\}<\/span>/);
    assert.match(item, /placeholder="Name: staff, CA, party…"/);
  });
  it('typing searches the WhatsApp chats, and picking one brings its number', () => {
    assert.match(item, /api\.findChats\(q\)/);
    assert.match(item, /onClick=\{\(\) => give\(c\.name, c\.id\)\}/);
    // A contact already on the people list is not offered twice.
    assert.match(item, /!people\.some\(\(p\) => p\.wid && p\.wid === c\.id\)/);
  });
});

describe('"status hata do" and filing from the table', () => {
  const table = fs.readFileSync(new URL('../../frontend/src/components/TaskTable.jsx', import.meta.url), 'utf8');
  const appSrc = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');

  it('has no Status column', () => {
    assert.doesNotMatch(table, /label: 'Status'/);
    assert.doesNotMatch(table, /tt-status/);
  });

  it('files a task from the Business / Folder cell with the list\'s own Folder button', () => {
    assert.match(table, /import \{[^}]*GroupButton[^}]*\} from '\.\/TaskItem\.jsx'/);
    assert.match(table, /<td className="tt-folder">[\s\S]*?<GroupButton task=\{task\}/);
    // One handler each for the list and the table, not two copies.
    assert.match(appSrc, /<TaskTable[\s\S]*?onMove=\{onMove\}[\s\S]*?onNewGroup=\{newGroup\}/);
    assert.match(appSrc, /<TaskList[\s\S]*?onNewGroup=\{newGroup\}/);
  });
});

/*
 * "Lead ke andar additional details add karni he to comment ya notes ka
 * option, jese excel me hota he": a note from the table row, like a comment
 * on a cell, written to the same updates stream the drawer and list keep.
 */
describe('notes from the table, like a comment on a cell', () => {
  it('every title carries a Note mark that shows the count and previews on hover', () => {
    assert.match(table, /<NoteMark task=\{task\}/);
    assert.match(table, /title=\{preview \?/);
  });

  it('a press opens a row under it with the details, the notes so far and a box for the next', () => {
    assert.match(table, /<tr className="tt-note-row">[\s\S]*?<NotePanel/);
    assert.match(app, /onLoadNotes=\{\(task\) => api\.updates\(task\.id\)\}/);
    assert.match(table, /await onAddUpdate\(task, clean\)/);
  });

  it('the table saves the note straight away instead of opening the drawer', () => {
    assert.match(app, /<TaskTable[\s\S]*?onAddUpdate=\{async \(task, text\) => \{[\s\S]*?api\.addUpdate\(task\.id, \{ body: text \}\)/);
  });

  it('the note box stays in view when the table scrolls sideways on a phone', () => {
    assert.match(css, /\.tt-notes \{[^}]*position: sticky; left: 14px/);
  });
});

/*
 * "Make it like excel view / space saving": one line per row, a hairline
 * round every cell, fixed column widths, a row number, and the chat in its
 * own column instead of a second line under the title.
 */
describe('the table reads like a sheet', () => {
  it('rows are one line: fixed layout, a 30px cell, nothing wraps', () => {
    assert.match(css, /\.tt-table \{ table-layout: fixed;/);
    assert.match(css, /\.tt-table th, \.tt-table td \{\s*\n\s*padding: 0 8px; height: 30px; border: 1px solid var\(--line\);\s*\n\s*overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/);
  });

  it('the checkbox does not inherit the 36px field height that doubled the row', () => {
    assert.match(css, /\.tt-table \.tt-pick input \{[^}]*min-height: 0/);
  });

  it('each row is numbered, and the chat has a column of its own', () => {
    assert.match(table, /<td className="tt-num">\{num\}<\/td>/);
    assert.match(table, /num=\{shown\.from \+ i\}/);
    assert.match(table, /\{ key: 'from', label: 'From' \}/);
    assert.doesNotMatch(table, /<small className=\{source\.unnamed/);
  });

  it('the note row spans every column, however many there are', () => {
    assert.match(table, /<td colSpan=\{HEAD\.length \+ 3\}>/);
  });

  it('the whole title is on its tooltip, since the cell cuts it', () => {
    assert.match(table, /title=\{`\$\{task\.title\}\\n\\n/);
  });
});

/*
 * "Due date and followup engine kese add karna he": the Due cell read "No
 * date" and could not be pressed, and the deadline is the one thing that
 * starts reminders and follow-ups. It is the shared deadline control now.
 */
describe('the Due cell sets the deadline, which starts the follow-up engine', () => {
  const shared = fs.readFileSync(new URL('../../frontend/src/components/DeadlineButton.jsx', import.meta.url), 'utf8');
  const deleg = fs.readFileSync(new URL('../../frontend/src/components/Delegation.jsx', import.meta.url), 'utf8');

  it('the table and Task allotted use one control, not two copies', () => {
    assert.match(table, /import DeadlineButton from '\.\/DeadlineButton\.jsx'/);
    assert.match(deleg, /import DeadlineButton from '\.\/DeadlineButton\.jsx'/);
    assert.doesNotMatch(deleg, /function DeadlineButton/);
    assert.match(table, /<td className=\{`tt-due[\s\S]*?<DeadlineButton[\s\S]*?onDeadline=\{onDeadline\}/);
  });

  it('offers a call-back in an hour and tomorrow morning, and a date and time', () => {
    assert.match(shared, /onClick=\{\(\) => inHours\(1\)\}>In 1 hour</);
    assert.match(shared, /set\(dayAfter\(1\), '11:00'\)\}>Tomorrow, 11am</);
    assert.match(shared, /type="date"[\s\S]*?type="time"/);
  });

  it('writes both halves of the deadline, so the server rebuilds the ladder', () => {
    assert.match(app, /const onDeadline = \(task, day, clock = '18:00'\) =>[\s\S]*?due_date: day, due_at: new Date\(`\$\{day\}T\$\{clock\}:00`\)\.toISOString\(\)[\s\S]*?\{ due_date: '', due_at: '' \}/);
    assert.match(app, /<TaskTable[\s\S]*?onDeadline=\{onDeadline\}/);
  });

  it('says what the engine will do on the cell: nothing without a deadline, the next follow-up with one', () => {
    assert.match(table, /No deadline, so nothing is chased/);
    assert.match(table, /Next follow-up: /);
    assert.match(table, /Stopped asking after/);
  });
});

/*
 * "Jo task under progress he usko alag tab": an In progress tab beside Open,
 * the first note starting a task (pinned in progress.test.mjs), and Waiting
 * as the second half of the same tab.
 */
describe('In progress: its own tab, Started and Waiting on the row', () => {
  const lib = fs.readFileSync(new URL('../../frontend/src/lib/task.js', import.meta.url), 'utf8');
  const derive = fs.readFileSync(new URL('../../frontend/src/lib/derive.js', import.meta.url), 'utf8');
  const item = fs.readFileSync(new URL('../../frontend/src/components/TaskItem.jsx', import.meta.url), 'utf8');

  it('one rule decides it: started or waiting', () => {
    assert.match(lib, /export const isStarted = \(task\) => task\.status === 'in_progress' \|\| task\.status === 'waiting';/);
  });

  it('the tab sits between Open and All, and its badge and its list use that rule', () => {
    assert.match(app, /\{ key: 'open', label: 'Open' \},[\s\S]*?\{ key: 'in_progress', label: 'In progress', count: summary\.counts\.inProgress \},[\s\S]*?\{ key: 'all', label: 'All' \}/);
    assert.match(app, /if \(view === 'in_progress' && !isStarted\(task\)\) return false;/);
    assert.match(derive, /inProgress: open\.filter\(isStarted\)\.length/);
  });

  it('the ⋮ menu moves a task along: Start, Waiting on someone, back again', () => {
    assert.match(item, /task\.status === 'open' && \([\s\S]*?onStatus\(task, 'in_progress'\)[\s\S]*?Start/);
    assert.match(item, /task\.status === 'in_progress' && \([\s\S]*?onStatus\(task, 'waiting'\)[\s\S]*?Waiting on someone/);
    assert.match(item, /task\.status === 'waiting' && \([\s\S]*?onStatus\(task, 'in_progress'\)[\s\S]*?Back to in progress/);
  });

  it('the table row says Started or Waiting, and an untouched task says nothing', () => {
    assert.match(table, /\{!done && isStarted\(task\) && \([\s\S]*?\{task\.status === 'waiting' \? 'Waiting' : 'Started'\}/);
  });

  it('six tabs scroll inside their strip on a phone instead of pushing the page sideways', () => {
    assert.match(css, /\.segment\.tabs \{ max-width: 100%; overflow-x: auto;/);
    assert.match(css, /\.segment\.tabs button \{ flex: none; white-space: nowrap; \}/);
  });
});

/*
 * "Jese notes ka option he wese option do uska bhi": steps (the checklist)
 * from the table row, beside the notes, with the count on the row.
 */
describe('steps on a row, like notes', () => {
  it('a Steps mark sits beside Note and carries done/total', () => {
    assert.match(table, /<NoteMark task=\{task\} open=\{panel === 'notes'\}[\s\S]*?<StepsMark task=\{task\} open=\{panel === 'steps'\}/);
    assert.match(table, /\{total \? `\$\{done\}\/\$\{total\}` : 'Steps'\}/);
  });

  it('it opens the one Checklist component, not a second copy of it', () => {
    assert.match(table, /import Checklist from '\.\/Checklist\.jsx';/);
    assert.match(table, /<Checklist task=\{task\} onChanged=\{onStepsChanged\} onError=\{onError\} \/>/);
    assert.doesNotMatch(table, /api\./, 'the table still fetches nothing of its own');
  });

  it('a note that is really a to-do moves into the checklist: added first, then removed', () => {
    assert.match(table, /Make it a step/);
    assert.match(app, /onNoteToStep=\{async \(task, note\) => \{[\s\S]*?await api\.addSubtask\(task\.id, note\.body\);\s*\n\s*await api\.deleteUpdate\(task\.id, note\.id\);/);
  });

  it('the panel keeps checkboxes the size of checkboxes', () => {
    assert.match(css, /\.tt-steps \.checklist input\[type="checkbox"\] \{[^}]*padding: 0;/);
  });
});
