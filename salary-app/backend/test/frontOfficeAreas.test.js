/**
 * THE AREAS THE HOUSEKEEPING WALK RUNS DOWN.
 *
 * Dinesh's front desk had nine areas on screen against the twelve the app
 * knows, and asked where the others had gone: *"FRONT DESK ME AREA KA SOLVE
 * KIYA?"*. Nothing had broken — somebody had taken three off the list — but
 * there was no way to SEE that, and the button that puts the usual ones back
 * was hidden behind "the list is empty", which is exactly the one case where
 * it was not needed.
 *
 * What these pin:
 *
 *  - **Off the list is not deleted**, and the records it was flagged for
 *    stay. That is the only reason any of this is written down.
 *  - **Putting one back is the SAME area**, not a second of it, so its
 *    history follows.
 *  - Adding the usual ones is **idempotent** and adds only what is absent.
 *  - **Renaming keeps the history**, which typing a new name does not.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { USUAL_AREAS, areaHistory } from '../../shared/frontOffice.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-areas-'));
process.env.APP_PASSWORD = 'the-key';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { authorization: 'Bearer the-key', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const areas = async (all = false) =>
  (await api('GET', `/api/front-office/areas${all ? '?all=true' : ''}`)).body.areas;

let parking = 0;

test('the usual list goes on, once', async () => {
  await api('POST', '/api/front-office/areas/usual', {});
  const list = await areas();
  assert.equal(list.length, USUAL_AREAS.length);

  // Pressing it twice does not make twenty-four areas.
  await api('POST', '/api/front-office/areas/usual', {});
  assert.equal((await areas()).length, USUAL_AREAS.length);

  parking = list.find((a) => a.name === 'Parking').id;
});

test('a flagged day is why none of this is ever deleted', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const put = await api('PUT', '/api/front-office/inspections', {
    day: today, area_id: parking, status: 'Not Clean', remark: 'oil on the floor',
  });
  assert.equal(put.status, 200);

  await api('DELETE', `/api/front-office/areas/${parking}`);
  assert.ok(!(await areas()).some((a) => a.id === parking), 'off the walk');

  const all = await areas(true);
  const off = all.find((a) => a.id === parking);
  assert.ok(off, 'and still there to be seen');
  assert.equal(Boolean(off.active), false, 'and plainly marked as off');

  // The day it was flagged on is untouched.
  const day = await api('GET', `/api/front-office/day/${today}`);
  const kept = (day.body.inspections || []).find((i) => i.area_id === parking);
  assert.ok(kept, 'the flagged day went nowhere');
  assert.equal(kept.remark, 'oil on the floor');
});

test('PUTTING IT BACK IS THE SAME AREA, not a second one', async () => {
  const back = await api('PATCH', `/api/front-office/areas/${parking}`, { active: true });
  assert.equal(back.status, 200);
  const list = await areas();
  assert.equal(list.filter((a) => a.name === 'Parking').length, 1, 'one Parking, not two');
  assert.equal(list.find((a) => a.name === 'Parking').id, parking, 'and the same one');
});

test('typing the name of one that is off the list brings that one back', async () => {
  await api('DELETE', `/api/front-office/areas/${parking}`);
  const typed = await api('POST', '/api/front-office/areas', { name: 'parking' });
  assert.equal(typed.body.id, parking, 'same row, whatever the capitals');
  assert.equal((await areas()).filter((a) => a.name === 'Parking').length, 1);
});

test('renaming keeps the history; it does not start a new area', async () => {
  const renamed = await api('PATCH', `/api/front-office/areas/${parking}`, { name: 'Parking (rear)' });
  assert.equal(renamed.body.name, 'Parking (rear)');
  assert.equal(renamed.body.id, parking);
  const all = await areas(true);
  assert.ok(!all.some((a) => a.name === 'Parking'), 'the old name is not left behind as a second row');
});

test('the settings screen can see every area, the walk only the live ones', async () => {
  assert.ok((await areas(true)).length >= (await areas()).length);
});


/* ---------------- one area, down the days ---------------- */

test('AREA-WISE HISTORY: which days, what was said, who looked', async () => {
  const list = await areas();
  const washroom = list.find((a) => a.name === 'Washroom');
  const other = list.find((a) => a.name === 'Pantry');

  const days = [
    ['2026-11-02', 'Clean', ''],
    ['2026-11-04', 'Not Clean', 'tap leaking'],
    ['2026-11-06', 'Needs Attention', 'soap finished'],
  ];
  for (const [day, status, remark] of days) {
    await api('PUT', '/api/front-office/inspections', { day, area_id: washroom.id, status, remark });
  }
  // Somebody else's day, to prove the history is one area's and not the office's.
  await api('PUT', '/api/front-office/inspections', {
    day: '2026-11-04', area_id: other.id, status: 'Not Clean', remark: 'bin full',
  });

  const got = await api('GET', `/api/front-office/areas/${washroom.id}/history?from=2026-11-01&to=2026-11-10`);
  assert.equal(got.status, 200);
  assert.equal(got.body.area.name, 'Washroom');
  assert.equal(got.body.inspections.length, 3, 'only this area');
  assert.equal(got.body.inspections[0].day, '2026-11-06', 'newest first');
  assert.equal(got.body.inspections[1].remark, 'tap leaking', 'and what was said');

  const history = areaHistory({ area: got.body.area, inspections: got.body.inspections, from: '2026-11-01', to: '2026-11-10' });
  assert.equal(history.checked, 3);
  assert.equal(history.clean, 1);
  assert.equal(history.flagged, 2);
  /* TEN DAYS IN THE RANGE, THREE WALKED. The other seven are not clean days
     - they are days nobody looked, and that is the figure. */
  assert.equal(history.not_checked, 7);
  assert.equal(history.latest.day, '2026-11-06');
});

test('with no range, "not checked" is NOT KNOWN rather than nought', () => {
  const history = areaHistory({ area: { id: 1 }, inspections: [] });
  assert.equal(history.not_checked, null, 'nought would read as "every day was walked"');
  assert.equal(history.latest, null);
});

test('the history of an area that is off the list still opens', async () => {
  /*
   * Its record is exactly what somebody wants AFTER taking it off - "how
   * often was the store room flagged before we stopped walking it".
   */
  const washroom = (await areas()).find((a) => a.name === 'Washroom');
  await api('DELETE', `/api/front-office/areas/${washroom.id}`);

  const got = await api('GET', `/api/front-office/areas/${washroom.id}/history`);
  assert.equal(got.status, 200);
  assert.equal(Boolean(got.body.area.active), false, 'and it says it is off the list');
  assert.equal(got.body.inspections.length, 3, 'with every day it was ever walked');
});

test('an area that never existed is a 404, not an empty history', async () => {
  assert.equal((await api('GET', '/api/front-office/areas/99999/history')).status, 404);
});
