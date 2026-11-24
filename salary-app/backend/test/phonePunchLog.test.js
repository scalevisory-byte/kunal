/*
 * A PHONE PUNCH IN THE PUNCH LOG — and the five and a half hours it hangs on.
 *
 * Dinesh: *"punch log me bhi phone punch dikhao"*. The log read the readers
 * and the Bizcompass spool; a punch from the portal or a personal link was
 * nowhere in it.
 *
 * This file runs in **Asia/Kolkata on purpose**. A phone punch is stored as
 * an ISO stamp, which is UTC, while every reader's punch is the local string
 * it printed. In UTC those are the same text and the bug is invisible, so a
 * test written here would have proved nothing at all.
 */
process.env.TZ = 'Asia/Kolkata';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { localStamp } from '../../shared/punchClock.js';
import { punchLog } from '../../shared/punchLog.js';
import { punchTotals } from '../../shared/punchTotals.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'phonelog-'));
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
process.env.PUNCH_ENABLED = 'true';
delete process.env.APP_PASSWORD;

test('the zone really is the one this file needs', () => {
  /* If the runner ignored TZ, every assertion below passes for the wrong
     reason, so it is checked rather than assumed. */
  assert.equal(new Date('2026-11-24T04:12:30Z').getHours(), 9, 'TZ is not Asia/Kolkata');
});

test('A PHONE PUNCH IS READ AS THE WALL CLOCK SHOWED IT, not as UTC', () => {
  /*
   * 04:12 UTC is twenty to ten in the morning in Vadodara. Slicing the stored
   * text would print it as 04:12, which reads as somebody arriving before
   * dawn - a fault in the machine rather than a bug here.
   */
  assert.equal(localStamp('2026-11-24T04:12:30.000Z'), '2026-11-24 09:42:30');
  /* And across midnight the DATE moves too, which is the half that makes a
     punch land in the wrong month if it is ignored. */
  assert.equal(localStamp('2026-11-30T20:00:00.000Z'), '2026-12-01 01:30:00');
  /* Nothing readable in, nothing invented out. */
  assert.equal(localStamp(''), '');
  assert.equal(localStamp('not a date'), '');
});

/* ================================================================= *
 * the log itself
 * ================================================================= */

const people = [
  { id: 1, name: 'Harish Gupta', code: 'BNF-EMP-0043', device_code: '', company_name: 'BOOKNFLY', active: 1 },
  { id: 2, name: 'Alifaya Chikhaliwala', code: 'BNF-EMP-0047', device_code: '47', company_name: 'BOOKNFLY', active: 1 },
];

test('a punch that names its person is taken at its word, never matched by number', () => {
  /*
   * THE WHOLE REASON THE TWO FEEDS COULD NOT SIMPLY BE CONCATENATED.
   *
   * Harish carries no punch ID and his employee code is not a number, so no
   * reader can ever reach him - `matcherFor` would return null and his own
   * punch would have been listed as belonging to nobody. It names him, so it
   * is his.
   */
  const log = punchLog(
    [
      { code: '', employee_id: 1, at: '2026-11-24 09:42:30', source: 'Their own login' },
      { code: '47', at: '2026-11-24 09:40:00', source: 'IN gate' },
    ],
    people
  );
  const his = log.rows.find((r) => r.employee_id === 1);
  assert.ok(his, 'the phone punch was not attributed to anybody');
  assert.equal(his.employee_name, 'Harish Gupta');
  assert.equal(his.punch_id, '', 'a phone punch has no reader number to show');
  assert.equal(his.where, 'Their own login');
  assert.equal(log.counts.unmatched, 0);
  assert.equal(log.counts.people, 2);
});

test('an empty punch ID is NOT a number nobody carries', () => {
  /*
   * `unknownIds` is the count that says "attendance is arriving for somebody
   * it can never reach". A phone punch has no number at all, so counting its
   * blank one would report a reader sending blanks - a fault that is not
   * happening, on the screen somebody opens to find real ones.
   */
  const log = punchLog(
    [
      { code: '', employee_id: 1, at: '2026-11-24 09:42:30', source: 'Their own login' },
      { code: '999', at: '2026-11-24 09:41:00', source: 'IN gate' },
    ],
    people
  );
  assert.equal(log.counts.unknownIds, 1, 'only the real reader number is unknown');
  assert.equal(log.counts.unmatched, 1);
});

test('a punch naming somebody since deleted is listed, and said to be', () => {
  const log = punchLog(
    [{ code: '', employee_id: 404, at: '2026-11-24 09:42:30', source: 'Their punch link' }],
    people
  );
  assert.equal(log.rows.length, 1);
  assert.equal(log.rows[0].employee_id, 404);
  assert.equal(log.rows[0].employee_name, 'no longer on the staff list');
  assert.equal(log.counts.unknownIds, 0);
});

test('narrowing to one person finds their phone punches too', () => {
  const log = punchLog(
    [
      { code: '', employee_id: 1, at: '2026-11-24 09:42:30', source: 'Their own login' },
      { code: '47', at: '2026-11-24 09:40:00', source: 'IN gate' },
    ],
    people,
    { employeeId: 1 }
  );
  assert.equal(log.rows.length, 1);
  assert.equal(log.rows[0].employee_id, 1);
});

/* ================================================================= *
 * the totals, which must agree with the log about the same punch
 * ================================================================= */

test('the totals count both feeds for one person, and add them up', () => {
  const totals = punchTotals(
    [
      { code: '47', at: '2026-11-24 09:40:00', source: 'IN gate' },
      { code: '47', at: '2026-11-24 18:30:00', source: 'IN gate' },
      { code: '', employee_id: 2, at: '2026-11-25 09:50:00', source: 'Their own login' },
    ],
    people
  );
  const hers = totals.lines.find((l) => l.employee_id === 2);
  assert.equal(hers.punches, 3, 'the two feeds were not added together');
  assert.equal(hers.days, 2);
  assert.deepEqual(hers.sources, ['IN gate', 'Their own login']);
});

test('SOMEBODY NO READER CAN REACH still shows their own phone punches', () => {
  /*
   * `punches: null` means "no punch can ever find them", which is a job for
   * somebody. Once they punch from their own phone it is no longer true, and
   * a dash there would send the office hunting for a punch ID that would
   * change nothing.
   */
  const totals = punchTotals(
    [{ code: '', employee_id: 1, at: '2026-11-24 09:42:30', source: 'Their own login' }],
    people
  );
  const his = totals.lines.find((l) => l.employee_id === 1);
  assert.equal(his.reach, 'none', 'the scene is wrong: he should be unreachable by a reader');
  assert.equal(his.punches, 1);
  assert.equal(his.days, 1);
});

test('a phone punch is never listed as a reader number nobody carries', () => {
  const totals = punchTotals(
    [{ code: '', employee_id: 1, at: '2026-11-24 09:42:30', source: 'Their own login' }],
    people
  );
  assert.deepEqual(totals.unknown, []);
});

/* ================================================================= *
 * end to end: punch from the portal, read it in the log
 * ================================================================= */

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

function session() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    for (const c of res.headers.getSetCookie?.() || []) cookie = c.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

const admin = session();
const staff = session();
let him;
const now = new Date();
const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

test('end to end: somebody with no punch ID punches from their login', async () => {
  await admin('POST', '/api/auth/setup', {
    username: 'dinesh', name: 'Dinesh', password: 'a-long-enough-password',
  });
  const company = (await admin('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  him = (await admin('POST', '/api/employees', {
    company_id: company.id, name: 'Harish Gupta', code: 'BNF-EMP-0043',
    monthly_salary: 26000, joined_on: '2024-04-01',
  })).body;
  await admin('POST', '/api/periods', { year: now.getFullYear(), month: now.getMonth() + 1 });

  const slip = (await admin('POST', '/api/auth/staff', { employee_ids: [him.id] })).body.made[0];
  assert.equal(
    (await staff('POST', '/api/auth/login', { username: slip.username, password: slip.password })).status,
    200
  );

  const log0 = await admin('GET', `/api/punch-log?month=${month}`);
  assert.equal(log0.status, 200);
  const before = log0.body.rows.filter((r) => r.employee_id === him.id).length;
  assert.equal(before, 0);

  const punched = await staff('POST', '/api/me/punch', {
    kind: 'in', lat: 22.3072, lng: 73.1812, accuracy: 15,
  });
  assert.equal(punched.status, 201, JSON.stringify(punched.body));

  const log1 = await admin('GET', `/api/punch-log?month=${month}`);
  const mine = log1.body.rows.filter((r) => r.employee_id === him.id);
  assert.equal(mine.length, 1, 'the phone punch is still missing from the log');
  assert.equal(mine[0].employee_name, 'Harish Gupta');
  assert.equal(mine[0].where, 'Their own login');
  /* The time is a real clock time of today, not a sliced ISO stamp. */
  assert.match(mine[0].time, /^\d{2}:\d{2}:\d{2}$/);
  assert.equal(mine[0].date, new Date().toISOString().slice(0, 10) === mine[0].date ? mine[0].date : mine[0].date);
  assert.match(mine[0].date, new RegExp(`^${month}-\\d{2}$`));
});

test('READING THE LOG FILES NOTHING, as every look in this app must', async () => {
  const a = await admin('GET', `/api/punch-log?month=${month}`);
  const b = await admin('GET', `/api/punch-log?month=${month}`);
  assert.equal(a.body.counts.punches, b.body.counts.punches);
});

test('the totals report shows it on the same person, with no reader number', async () => {
  const totals = await admin('GET', `/api/punch-totals?month=${month}`);
  const line = totals.body.lines.find((l) => l.employee_id === him.id);
  assert.equal(line.punches, 1);
  assert.equal(line.punch_id, '', 'he has no punch ID, and that has not changed');
  assert.deepEqual(line.sources, ['Their own login']);
  assert.deepEqual(totals.body.unknown, []);
});
