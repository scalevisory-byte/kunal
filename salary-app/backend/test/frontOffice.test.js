import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  dailyReportText, dayStats, monthSummary, monthSummaryText,
} from '../../shared/frontOffice.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-fo-'));
process.env.APP_PASSWORD = '';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const DAY = '2026-11-20';
let areas = [];
test.before(async () => {
  await api('POST', '/api/front-office/areas/usual');
  areas = (await api('GET', '/api/front-office/areas')).body.areas;
});

/* ---------------- the rule this module exists for ---------------- */

test('A DAY NOBODY WALKED IS NOT A CLEAN DAY', () => {
  /*
   * His own tool started every area at "Clean" and counted only the others,
   * so a morning the app was never opened reported a spotless office. The
   * same trap as the stock take ("not checked" is not "missing") and the
   * biometric file (a day the machine missed is not 114 absences).
   */
  const three = [{ id: 1, name: 'Reception' }, { id: 2, name: 'Pantry' }, { id: 3, name: 'Washroom' }];

  const untouched = dayStats({ areas: three, inspections: [] });
  assert.equal(untouched.clean, 0, 'nothing checked must not read as clean');
  assert.equal(untouched.flags, 0);
  assert.equal(untouched.not_checked, 3);

  const walked = dayStats({
    areas: three,
    inspections: [
      { area_id: 1, status: 'Clean' },
      { area_id: 2, status: 'Not Clean', remark: 'bin' },
    ],
  });
  assert.equal(walked.clean, 1);
  assert.equal(walked.flags, 1);
  assert.equal(walked.not_checked, 1, 'the third area is still not checked');
  // The three always add up to the areas on the list, so none can hide.
  assert.equal(walked.clean + walked.flags + walked.not_checked, three.length);
});

test('a visitor with no out time is STILL IN, never a guessed departure', () => {
  const stats = dayStats({
    visitors: [{ name: 'A' }, { name: 'B', out_time: '17:10' }],
  });
  assert.equal(stats.visitors, 2);
  assert.equal(stats.still_in, 1);
});

/* ---------------- the walk ---------------- */

test('a verdict replaces, and can be taken away again', async () => {
  const area = areas[0];
  const first = await api('PUT', '/api/front-office/inspections', {
    day: DAY, area_id: area.id, status: 'Not Clean', remark: 'bin not emptied',
  });
  assert.equal(first.status, 200);

  // Changing your mind replaces it - never two rows that disagree.
  await api('PUT', '/api/front-office/inspections', { day: DAY, area_id: area.id, status: 'Clean' });
  const { inspections } = (await api('GET', `/api/front-office/day/${DAY}`)).body;
  const mine = inspections.filter((i) => i.area_id === area.id);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].status, 'Clean');

  /*
   * And a blank takes it away: "I ticked the wrong row" has to be undoable,
   * and a day with no verdict is a real state here, not a hole.
   */
  await api('PUT', '/api/front-office/inspections', { day: DAY, area_id: area.id, status: '' });
  const after = (await api('GET', `/api/front-office/day/${DAY}`)).body.inspections;
  assert.ok(!after.some((i) => i.area_id === area.id));
});

test('only the three verdicts are accepted', async () => {
  const out = await api('PUT', '/api/front-office/inspections', {
    day: DAY, area_id: areas[0].id, status: 'Spotless',
  });
  assert.equal(out.status, 400);
  assert.match(out.body.error, /Clean, Not Clean, Needs Attention/);
});

test('an area off the list keeps what it was flagged for', async () => {
  /*
   * Deleting would take every verdict ever recorded against it, and "the
   * pantry was flagged eleven days in October" is the only reason any of
   * this is written down.
   */
  const pantry = areas.find((a) => a.name === 'Pantry');
  await api('PUT', '/api/front-office/inspections', {
    day: '2026-11-18', area_id: pantry.id, status: 'Not Clean',
  });
  await api('DELETE', `/api/front-office/areas/${pantry.id}`);

  const live = (await api('GET', '/api/front-office/areas')).body.areas;
  assert.ok(!live.some((a) => a.id === pantry.id), 'it is off the list');

  const month = (await api('GET', '/api/front-office/month/2026-11')).body;
  const summary = monthSummary({ ...month, month: '2026-11' });
  assert.ok(
    summary.flags_by_area.some((r) => r.name === 'Pantry'),
    'its flagged days are still counted and still named'
  );

  // Adding it back is the SAME area, not a second one with a split history.
  const again = await api('POST', '/api/front-office/areas', { name: 'pantry' });
  assert.equal(again.body.id, pantry.id);
});

/* ---------------- the books ---------------- */

test('a visitor needs a name; a courier entry needs a company or a from/to', async () => {
  assert.equal((await api('POST', '/api/front-office/visitors', { day: DAY })).status, 400);
  assert.equal(
    (await api('POST', '/api/front-office/courier', { day: DAY, direction: 'Inward' })).status,
    400
  );
  assert.equal(
    (await api('POST', '/api/front-office/courier', { day: DAY, direction: 'Sideways', company: 'DTDC' }))
      .status,
    400
  );
});

test('signing a visitor out records a time; it is never filled in by itself', async () => {
  /*
   * A visitor needs a name and a purpose; the mobile is optional, though
   * one that is typed must be real. visitorRegister.test.js covers the
   * refusals; this one is about the out time.
   */
  const visitor = (await api('POST', '/api/front-office/visitors', {
    day: DAY, name: 'Amit Trivedi', company: 'HDFC', purpose: 'KYC',
    mobile: '9898011223', in_time: '10:15',
  })).body;
  assert.equal(visitor.out_time, null, 'nobody has left yet');

  const out = (await api('PATCH', `/api/front-office/visitors/${visitor.id}`, { out_time: '11:40' })).body;
  assert.equal(out.out_time, '11:40');
});

test('a bad date is refused rather than quietly reading as some other day', async () => {
  assert.equal((await api('GET', '/api/front-office/day/20-11-2026')).status, 400);
  assert.equal((await api('GET', '/api/front-office/month/November')).status, 400);
});

/* ---------------- what gets sent to the group ---------------- */

test('the daily report says what was flagged, what was NOT checked, and who is still in', () => {
  const list = [{ id: 1, name: 'Reception' }, { id: 2, name: 'Pantry' }, { id: 3, name: 'Washroom' }];
  const text = dailyReportText({
    day: '2026-11-20',
    company: 'BOOKNFLY',
    areas: list,
    inspections: [
      { area_id: 1, status: 'Clean' },
      { area_id: 2, status: 'Not Clean', remark: 'bin not emptied' },
    ],
    visitors: [
      { name: 'Amit Trivedi', company: 'HDFC', purpose: 'KYC' },
      { name: 'Pooja Shah', purpose: 'Invoice', out_time: '12:30' },
    ],
    courier: [{ direction: 'Inward', company: 'DTDC', party: 'Head office', ref_no: 'X9981' }],
  });

  assert.match(text, /\*BOOKNFLY FRONT OFFICE REPORT\*/);
  assert.match(text, /Pantry — Not clean \(bin not emptied\)/);
  // The honest line his version could not have had.
  assert.match(text, /\(1 area\(s\) not checked\)/);
  assert.match(text, /Count: 2 · 1 still in/);
  assert.match(text, /Amit Trivedi \(HDFC\) — KYC \[in\]/);
  // Somebody who signed out is not marked as still in.
  assert.ok(!/Pooja Shah.*\[in\]/.test(text));
  /*
   * The tracking number, which was written as `c.ref` first - the column is
   * `ref_no`, so the ref quietly never appeared on the report.
   */
  assert.match(text, /\(Ref: X9981\)/);
});

test('a day with nothing on it says so rather than reporting a clean office', () => {
  const text = dailyReportText({ day: '2026-11-21', areas: [{ id: 1, name: 'Reception' }] });
  assert.match(text, /Nothing checked yet/);
  assert.ok(!/All .* clean/.test(text));
});

test('the month counts the DAYS SOMEBODY RECORDED, not the days in the month', () => {
  const summary = monthSummary({
    month: '2026-11',
    areas: [{ id: 1, name: 'Reception' }],
    inspections: [
      { day: '2026-11-02', area_id: 1, status: 'Not Clean' },
      { day: '2026-11-03', area_id: 1, status: 'Clean' },
      { day: '2026-10-30', area_id: 1, status: 'Not Clean' },
    ],
    visitors: [{ day: '2026-11-02' }, { day: '2026-11-09' }],
    courier: [{ day: '2026-11-02', direction: 'Inward' }],
  });
  assert.equal(summary.days_recorded, 3, 'the 2nd, the 3rd and the 9th');
  assert.equal(summary.flags, 1, 'October is another month');
  assert.equal(summary.visitors, 2);
  assert.equal(summary.courier_in, 1);
  assert.match(monthSummaryText(summary), /Days recorded: 3/);
});

/* ---------------- clearing a day ---------------- */

test('clearing a day empties THAT day and leaves every other one alone', async () => {
  const visitor = (over) => ({ purpose: 'visit', mobile: '9898012345', ...over });
  await api('POST', '/api/front-office/visitors', visitor({ day: '2026-11-19', name: 'Yesterday' }));
  await api('POST', '/api/front-office/visitors', visitor({ day: DAY, name: 'Today', mobile: '9898012346' }));

  const counts = (await api('DELETE', `/api/front-office/day/${DAY}`)).body;
  assert.ok(counts.visitors >= 1);

  /* ARCHIVED, not destroyed: off the register, still on the record. */
  assert.equal((await api('GET', `/api/front-office/day/${DAY}`)).body.visitors.length, 0);
  const kept = (await api('GET', `/api/front-office/visitors?day=${DAY}&archived=true`)).body;
  assert.ok(kept.rows.length >= 1, 'a visitor book is a record of who was in the building');
  assert.equal((await api('GET', '/api/front-office/day/2026-11-19')).body.visitors.length, 1);
});

test('it is its own right, so reception can be given a login that reaches nothing else', async () => {
  const { AREA_KEYS } = await import('../../shared/rights.js');
  assert.ok(AREA_KEYS.includes('frontoffice'));
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(server, /requireArea\('frontoffice'\)/);
});
