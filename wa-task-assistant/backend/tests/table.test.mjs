/*
 * All Tasks as a table: its order, its pages, and the two places a table can
 * quietly lie - a sort that floats blank rows to the top, and a "Showing 1-20
 * of N" whose N is not the list on screen.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { sortRows, pageOf, pageList } = await import('../../frontend/src/lib/table.js');
const read = (rel) => fs.readFileSync(new URL(`../../frontend/src/${rel}`, import.meta.url), 'utf8');
const table = read('components/TaskTable.jsx');
const app = read('App.jsx');
const toolbar = read('components/Toolbar.jsx');

const t = (id, extra = {}) => ({ id, title: `t${id}`, status: 'open', ...extra });
const ids = (rows) => rows.map((r) => r.id);

describe('a sort never floats the blanks to the top', () => {
  const rows = [t(1), t(2, { due_date: '2026-09-20' }), t(3), t(4, { due_date: '2026-10-01' })];

  it('puts undated rows last going up', () => {
    assert.deepEqual(ids(sortRows(rows, 'due', 'asc')), [2, 4, 1, 3]);
  });

  it('and still last going down', () => {
    // Flipping the arrow must mean "latest first", not "hide the dated work
    // under two hundred rows with no date".
    assert.deepEqual(ids(sortRows(rows, 'due', 'desc')), [4, 2, 1, 3]);
  });

  it('treats an unassigned or unfiled row the same way', () => {
    const people = [t(1), t(2, { assigned_to: 'Nidhi' }), t(3, { assigned_to: 'Anil' })];
    assert.deepEqual(ids(sortRows(people, 'assignee', 'desc')), [2, 3, 1]);
    const names = { 2: 'SENA', 3: 'Arrohan' };
    const filed = [t(1), t(2, { group_id: 2 }), t(3, { group_id: 3 })];
    assert.deepEqual(ids(sortRows(filed, 'folder', 'asc', { folderOf: (r) => names[r.group_id] })), [3, 2, 1]);
  });

  it('keeps the board order for ties, so a heading press does not reshuffle a day', () => {
    const same = [t(5, { due_date: '2026-09-20' }), t(2, { due_date: '2026-09-20' }), t(9, { due_date: '2026-09-20' })];
    assert.deepEqual(ids(sortRows(same, 'due', 'asc')), [5, 2, 9]);
  });

  it('orders priority by urgency, not by the alphabet', () => {
    const p = [t(1, { priority: 'low' }), t(2, { priority: 'high' }), t(3, { priority: 'medium' }), t(4)];
    assert.deepEqual(ids(sortRows(p, 'priority', 'asc')), [2, 3, 1, 4]);
  });

  it('a time sorts inside its day', () => {
    const d = [t(1, { due_date: '2026-09-20' }), t(2, { due_at: '2026-09-20T10:00' }), t(3, { due_at: '2026-09-20T18:00' })];
    assert.deepEqual(ids(sortRows(d, 'due', 'asc')), [2, 3, 1]);
  });

  it('never changes the list it was given', () => {
    const before = ids(rows);
    sortRows(rows, 'due', 'desc');
    assert.deepEqual(ids(rows), before);
  });
});

/*
 * "Why done showing here - here be only latest pending." Sorted by deadline, a
 * task finished a fortnight ago has the oldest deadline on the list, so page 1
 * was struck-through rows still marked "17 days late".
 */
describe('finished work goes under everything still owed', () => {
  const rows = [
    t(1, { status: 'done', due_date: '2026-09-01', created_at: '2026-09-01 10:00:00' }),
    t(2, { due_date: '2026-09-20', created_at: '2026-09-18 10:00:00' }),
    t(3, { status: 'done', due_date: '2026-09-02', created_at: '2026-09-22 10:00:00' }),
    t(4, { status: 'in_progress', due_date: '2026-09-25', created_at: '2026-09-20 10:00:00' }),
  ];

  it('whatever the column and whichever way', () => {
    for (const key of ['due', 'added', 'task', 'priority', 'status', null]) {
      for (const dir of ['asc', 'desc']) {
        const out = sortRows(rows, key, dir);
        const firstDone = out.findIndex((r) => r.status === 'done');
        assert.ok(out.slice(firstDone).every((r) => r.status === 'done'),
          `${key} ${dir} put finished work among the owed: ${ids(out)}`);
      }
    }
  });

  it('opens on the newest owed work', () => {
    assert.match(table, /useState\(\{ key: 'added', dir: 'desc' \}\)/);
    assert.deepEqual(ids(sortRows(rows, 'added', 'desc')), [4, 2, 3, 1]);
  });

  it('never calls a finished task late', () => {
    assert.match(table, /const due = done \? null : dueLabel\(task\.due_date\)/);
  });
});

describe('"Showing 1-20 of N" counts the list on screen', () => {
  const rows = Array.from({ length: 45 }, (_, i) => t(i + 1));

  it('describes each page exactly', () => {
    assert.deepEqual(
      (({ from, to, total, pages }) => ({ from, to, total, pages }))(pageOf(rows, 1, 20)),
      { from: 1, to: 20, total: 45, pages: 3 },
    );
    const last = pageOf(rows, 3, 20);
    assert.equal(last.rows.length, 5);
    assert.deepEqual([last.from, last.to], [41, 45]);
  });

  it('pulls a page past the end back to the last one that exists', () => {
    // The list shrank under a filter while he was on page 9: draw the last
    // page, never an empty one with "Showing 161-180 of 12" above it.
    const shrunk = pageOf(rows.slice(0, 12), 9, 20);
    assert.equal(shrunk.page, 1);
    assert.deepEqual([shrunk.from, shrunk.to, shrunk.total], [1, 12, 12]);
  });

  it('says 0-0 of 0 for nothing, not 1-0', () => {
    const none = pageOf([], 1, 20);
    assert.deepEqual([none.from, none.to, none.total, none.pages], [0, 0, 0, 1]);
  });

  it('draws a handful of page numbers, not a ruler', () => {
    assert.deepEqual(pageList(1, 1), [1]);
    assert.deepEqual(pageList(10, 22), [1, 'gap', 9, 10, 11, 'gap', 22]);
    for (let p = 1; p <= 40; p += 1) {
      const list = pageList(p, 40);
      assert.ok(list.includes(1) && list.includes(40) && list.includes(p));
      assert.ok(list.length <= 7, `page ${p} drew ${list.length} items`);
    }
  });

  it('is handed the same rows the sections read', () => {
    // One list behind both shapes: a table fed from a second query would
    // eventually count differently from the sections it replaces.
    assert.match(app, /<TaskTable[\s\S]*?tasks=\{visible\}/);
    assert.ok(!/api\./.test(table), 'the table fetches something of its own');
  });
});

describe('one box, one meaning', () => {
  it('the leading box picks and never completes', () => {
    // A table has a Status column, and finishing a task is that column's job.
    assert.ok(!/onToggle/.test(table), 'the table box is wired to done');
    assert.match(table, /<select[\s\S]*?tt-status[\s\S]*?onStatus\(task, e\.target\.value\)/);
  });

  it('the header box speaks for this page and says so', () => {
    assert.match(table, /on this page/);
    assert.match(table, /onPickMany\(onPage,/);
  });

  it('throws a row out in one press, with the list\'s own handler', () => {
    // "yaha se direct delete karne wala option kaha gya": the list's ✕ was
    // left out of the table, putting delete two presses deep behind the ⋮.
    assert.match(table, /className="tt-dismiss"[\s\S]*?onClick=\{\(\) => onNotATask\(task\)\}/);
    assert.match(app, /<TaskTable[\s\S]*?onNotATask=\{onNotATask\}/);
  });

  it('shares the row menu rather than copying it', () => {
    assert.match(table, /import \{ RowMenu(, AssignButton)? \} from '\.\/TaskItem\.jsx'/);
    assert.ok(!/function RowMenu/.test(table));
  });

  it('starts again from page 1 on a new question, not on a poll', () => {
    const effect = /useEffect\(\(\) => \{ setPage\(1\); \}, \[([^\]]*)\]\)/.exec(table);
    assert.ok(effect, 'nothing resets the page');
    assert.ok(!/\btasks\b/.test(effect[1]), 'a thirty-second poll would throw him back to page 1');
    assert.match(effect[1], /scope/);
  });

  it('hides the controls a table cannot honour', () => {
    // Grouping is what sections are, and a table's boxes need no mode.
    assert.match(toolbar, /layout !== 'table' && \(\s*<div className="segment small">/);
    assert.match(toolbar, /onSelecting && layout !== 'table'/);
  });

  it('is not offered on My Day, whose rows are a ranked few', () => {
    assert.match(app, /const tableOn = layout === 'table' && Boolean\(page\.tabs\) && view !== 'myday'/);
  });
});
