/**
 * The dashboard he drew, and the two places the drawing would have lied.
 *
 * The mockup asked for a stacked bar of Open · Due today · Overdue · Added
 * today · Completed, and a week chart with a bar on every day. Neither could
 * be built as drawn: those five overlap, so they are not parts of a whole, and
 * four of the seven days had not happened yet.
 *
 * These read the real functions out of lib/derive.js. Nothing here runs
 * against the API, because none of this is in the database - it is arithmetic
 * the page does over the tasks it already has.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../../frontend/src/lib/derive.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const home = fs.readFileSync(new URL('../../frontend/src/components/DashboardHome.jsx', import.meta.url), 'utf8');

const today = new Date().toISOString().slice(0, 10);
const isDone = (t) => t.status === 'done';
const isOverdue = (t) => t.due_date && t.due_date < today && t.status !== 'done';
const todayIso = () => today;
const onDay = (stamp, iso) => Boolean(stamp) && String(stamp).slice(0, 10) === iso;

/** Pull one exported function out of the module, with its helpers injected. */
function take(name, endsBefore) {
  const body = src.slice(src.indexOf(`export function ${name}`), src.indexOf(endsBefore));
  return new Function('isDone', 'isOverdue', 'todayIso', 'onDay',
    `${body.replace('export function', 'function')}; return ${name};`)(isDone, isOverdue, todayIso, onDay);
}
const statusSlices = take('statusSlices', 'export function weekActivity');
const weekActivity = take('weekActivity', '/** Chats that have tasks');

const t = (id, extra = {}) => ({ id, title: `t${id}`, status: 'open', due_date: null, ...extra });
const yday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);

describe('the bar is parts of a whole, or it is not a bar', () => {
  it('cuts every task into exactly one slice', () => {
    const list = [
      t(1, { due_date: yday }),                              // overdue
      t(2, { due_date: yday }),                              // overdue
      t(3, { due_date: today }),                             // due today
      t(4, { due_date: '2099-01-01' }),                      // later
      t(5),                                                  // undated
      t(6, { status: 'done', completed_at: `${today} 09:00:00` }),
    ];
    const { slices, total, exact } = statusSlices(list);
    assert.equal(total, list.length, 'the slices do not add up to the list');
    assert.ok(exact, 'the function itself says they do not add up');
    assert.deepEqual(
      Object.fromEntries(slices.map((s) => [s.key, s.value])),
      { overdue: 2, due_today: 1, open: 2, done: 1 },
    );
  });

  it('never counts one task twice', () => {
    // The drawing's five categories put this task in three of them: it is
    // open, it is overdue, and it arrived today. Summing those is how a bar
    // ends up wider than the thing it sits inside.
    const one = [t(1, { due_date: yday, created_at: `${today} 10:00:00` })];
    const { slices, total } = statusSlices(one);
    assert.equal(total, 1);
    assert.equal(slices.filter((s) => s.value > 0).length, 1, 'it landed in more than one slice');
  });

  it('keeps "added today" out of it, because arriving is not a status', () => {
    assert.ok(!/added/i.test(src.slice(src.indexOf('export function statusSlices'), src.indexOf('export function weekActivity')).replace(/\/\*[\s\S]*?\*\//g, '')));
  });
});

describe('a day that has not happened has no bar', () => {
  it('reports null for the days still ahead and a number for the rest', () => {
    const { days } = weekActivity([], new Date());
    const now = days.find((d) => d.today);
    assert.ok(now, 'today is not in the week');
    for (const d of days) {
      if (d.iso > today) {
        assert.equal(d.count, null, `${d.label} is in the future and carries a count`);
        assert.equal(d.future, true);
      } else {
        assert.equal(typeof d.count, 'number', `${d.label} has passed and carries no count`);
      }
    }
    assert.equal(days.length, 7);
  });

  it('a quiet day that has passed is a real zero, not a blank', () => {
    const { days, total } = weekActivity([t(1, { status: 'done', completed_at: `${today} 08:00:00` })]);
    assert.equal(days.find((d) => d.today).count, 1);
    assert.equal(total, 1);
    const past = days.filter((d) => !d.future && !d.today);
    for (const d of past) assert.equal(d.count, 0, 'a passed day with nothing done should read 0');
  });
});

describe('one list behind every figure', () => {
  it('hands the page dayTasks, not the raw list', () => {
    // Delegated and set-aside work is off the board. The first render passed
    // the raw list to half the page and put six zeroes above a bar that said
    // two - two figures on one screen disagreeing about the same tasks.
    const call = app.slice(app.indexOf('<DashboardHome'), app.indexOf('</DashboardHome>'));
    assert.match(call, /tasks=\{dayTasks\}/, 'the page reads the raw list');
    assert.ok(!/tasks=\{tasks\}/.test(call), 'something on the page still reads the raw list');
  });

  it('gives every figure somewhere to go', () => {
    const keys = [...home.matchAll(/\{ key: '([a-z_]+)',/g)].map((m) => m[1]);
    assert.equal(keys.length, 6, `expected six figures, saw ${keys.length}`);
    const go = app.slice(app.indexOf('const goFigure'), app.indexOf('const goto'));
    for (const key of keys) {
      // Either goFigure names it, or it is a plain view the board already has.
      const handled = go.includes(`'${key}'`) || new RegExp(`view === '${key}'`).test(app);
      assert.ok(handled, `pressing "${key}" goes nowhere`);
    }
    // It must leave the dashboard: the dashboard is a summary with no list on
    // it, so setting a view there changes nothing anybody can see.
    assert.match(go, /goto\('all'\)/, 'the figures never leave the dashboard');
    // And nothing toggles: "Open" was lit on arrival, so the toggle made the
    // one figure that says Open open a list of everything.
    assert.ok(!/picked/.test(home), 'a figure still claims to be a filter chip');
  });
});

/*
 * The width rule, which outlived the layout it was written for.
 *
 * "ye part jese tha wese hi rehne do", over the banners, the "is this a task?"
 * card and the KPI row: they are as wide as the page's cap, so the cap cannot
 * be raised to give the dashboard room. It lives on the page's children
 * instead, with the dashboard as the one exception. That exception used to
 * name `.workspace.withcal`, which no longer exists - a selector that matches
 * nothing would have quietly handed the gutter back.
 */
describe('every block keeps its width, except the one asked to grow', () => {
  const css = fs.readFileSync(new URL('../../frontend/src/styles.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('caps the blocks, not the page', () => {
    const child = /\.page\s*>\s*\*\s*\{([^{}]*)\}/.exec(css);
    assert.ok(child, 'nothing caps the blocks on a page');
    // 1408 = the old 1460 page less its own 26px of padding either side.
    assert.match(child[1], /max-width:\s*1408px/, 'the blocks are not the width they were');
  });

  it('names the dashboard as the exception, and only it', () => {
    const uncapped = [...css.matchAll(/\.page\s*>\s*([^{]*?)\s*\{[^{}]*max-width:\s*none/g)].map((m) => m[1].trim());
    assert.deepEqual(uncapped, ['.home'], `uncapped blocks: ${uncapped.join(', ') || 'none'}`);
    // And it has to be a selector that something on the page actually has.
    assert.match(home, /className="home"/, 'nothing renders .home, so the exception matches nothing');
  });

  it('leaves no stylesheet behind for the component that is gone', () => {
    // SideRail.jsx was deleted; a block nothing can match is one the next
    // person reads and believes.
    assert.ok(!/\.rail\.spread\s*\{/.test(css), '.rail.spread outlived its component');
    assert.ok(!/\.workspace\.withcal\s*\{/.test(css), '.workspace.withcal outlived its column');
    assert.ok(!fs.existsSync(new URL('../../frontend/src/components/SideRail.jsx', import.meta.url)));
  });
});
