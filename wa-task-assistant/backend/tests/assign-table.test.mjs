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
    assert.match(table, /import \{ RowMenu, AssignButton \} from '\.\/TaskItem\.jsx'/);
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
