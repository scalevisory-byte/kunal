/**
 * The punch log over the API — Dinesh: *"sare logs kaha dikhte he?"*
 *
 * What this exists to prove:
 *
 *  1. IT WRITES NOTHING. It is the raw record, read back. Attendance is a
 *     different question, answered by the grid, which is what the sheet is
 *     paid from.
 *  2. A PUNCH NOBODY CARRIES IS STILL LISTED. Those are the whole reason
 *     somebody opens it: attendance arriving for a person it can never reach.
 *  3. A STAFF LOGIN CANNOT READ IT. Their own punches reach them through
 *     /api/me; a door onto everybody's comings and goings is another thing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-plog-'));
process.env.DATA_DIR = DATA;
process.env.APP_PASSWORD = 'the-key';
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const { createEmployee, createCompany } = await import('../src/db.js');
const require2 = await import('../src/devices.js');
const { saveSpoolPunches } = require2;

const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const api = async (method, url, body, key = 'the-key') => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const company = createCompany({ name: 'BNF' });
const amit = createEmployee({
  name: 'AMIT SHAH', company_id: company.id, code: 'BNF-EMP-0043',
  device_code: '37', monthly_salary: 26000,
});
createEmployee({
  name: 'KIRAN DESAI', company_id: company.id, code: 'BNF-EMP-0099', monthly_salary: 20000,
});

const spool = (user, when) => ({ user, when, device: 'GUID-IN', verify: 255 });
saveSpoolPunches([
  spool('37', '20-11-2026 09:12:01'),
  spool('37', '20-11-2026 13:37:00'),
  spool('37', '20-11-2026 18:02:44'),
  spool('37', '21-11-2026 09:05:00'),
  // A number nobody on the staff list carries.
  spool('188', '21-11-2026 10:00:00'),
]);

test('every punch comes back, newest first', async () => {
  const { status, body } = await api('GET', '/api/punch-log?month=2026-11');
  assert.equal(status, 200);
  assert.equal(body.month, '2026-11');
  assert.equal(body.total, 5);
  assert.equal(body.rows.length, 5);
  assert.equal(body.rows[0].date, '2026-11-21');
  // To the second: this is the raw record, and two punches forty seconds
  // apart are two door openings.
  assert.equal(body.rows[0].time, '10:00:00');
  assert.equal(body.counts.days, 2);
  assert.equal(body.counts.people, 1);
  assert.ok(Array.isArray(body.columns) && body.columns.length);
});

test('A PUNCH NOBODY CARRIES IS LISTED AND NAMED AS SUCH', async () => {
  const { body } = await api('GET', '/api/punch-log?month=2026-11');
  const orphan = body.rows.find((r) => r.punch_id === '188');
  assert.ok(orphan, 'it is on the list, not dropped');
  assert.equal(orphan.employee_id, null);
  assert.equal(orphan.employee_name, '');
  assert.equal(body.counts.unmatched, 1);
  assert.equal(body.counts.unknownIds, 1);
});

test('it narrows to a day and to a person', async () => {
  const day = await api('GET', '/api/punch-log?month=2026-11&day=20');
  assert.equal(day.body.total, 3);
  const who = await api('GET', `/api/punch-log?month=2026-11&employee_id=${amit.id}`);
  assert.equal(who.body.total, 4, 'the orphan is somebody else');
  assert.ok(who.body.rows.every((r) => r.employee_id === amit.id));
});

test('a month with nothing in it is an empty list, not an error', async () => {
  const { status, body } = await api('GET', '/api/punch-log?month=2026-01');
  assert.equal(status, 200);
  assert.deepEqual(body.rows, []);
  assert.equal(body.counts.punches, 0);
});

test('IT WRITES NOTHING — the punches are unchanged after reading them', async () => {
  const before = (await api('GET', '/api/punch-log?month=2026-11')).body.total;
  await api('GET', '/api/punch-log?month=2026-11');
  await api('GET', '/api/punch-log?month=2026-11&day=20');
  const after = (await api('GET', '/api/punch-log?month=2026-11')).body.total;
  assert.equal(after, before, 'reading it cannot file a punch');
});

test('the log and the totals agree about what punches exist', async () => {
  // They are the same events counted and listed, so the gathering is one
  // function. Two gatherings is how two answers to one question come to exist.
  const log = (await api('GET', '/api/punch-log?month=2026-11')).body;
  const totals = (await api('GET', '/api/punch-totals?month=2026-11')).body;
  assert.equal(log.counts.punches, totals.totals.punches);
  assert.equal(log.counts.unknownIds, totals.unknown.length);
});

test('it carries no salary and nothing statutory', async () => {
  const { body } = await api('GET', '/api/punch-log?month=2026-11');
  /*
   * Checked on the KEYS, not by searching the text. The first version of this
   * swept JSON.stringify for 'pan' and failed on `company_name`, which
   * contains it - a naive match there would have had me "fixing" a route
   * that was behaving perfectly.
   */
  const keys = new Set(body.rows.flatMap((r) => Object.keys(r)));
  for (const banned of ['monthly_salary', 'salary', 'pan', 'aadhaar', 'bank_account', 'dob', 'uan']) {
    assert.ok(!keys.has(banned), `${banned} has no business on a punch log`);
  }
  // And the one value that would matter most if a key were ever added.
  assert.ok(!JSON.stringify(body.rows).includes('26000'), 'no salary figure travels');
});

test('a staff login cannot open it', async () => {
  const { status } = await api('GET', '/api/punch-log?month=2026-11', null, 'not-the-key');
  assert.equal(status, 401);
});

/*
 * Two defects found by reading the "Seen by" column on a real server, both
 * of them older than this report.
 */
test('A SPOOL PUNCH IS NOT "a reader since removed"', () => {
  /*
   * device_id is NULL for every spool punch, because that reader is not one
   * of ours - so a COALESCE over the device name reported the whole feed as
   * removed. Nothing was removed; that feed is the one still running.
   */
  const { punchEventsForMonth } = require2;
  const rows = punchEventsForMonth({ year: 2026, month: 11 });
  assert.ok(rows.length, 'there are punches to look at');
  for (const r of rows) {
    assert.notEqual(r.source, 'a reader since removed', `${r.at} is from the spool, not a dead reader`);
    assert.equal(r.source, 'Bizcompass spool');
  }
});

test('THE SPOOL FILES ARE ACTUALLY READ, and a punch already stored is not counted twice', async () => {
  /*
   * `fileCouldMatter` takes a month NUMBER. The route passed { year, month },
   * so it compared a number to an object, answered false for every file, and
   * read nothing at all - on a server with sixteen thousand files the report
   * said none were found.
   *
   * Fixing it brings back the other half: an imported month holds the spool's
   * punches as rows AND still has the files in the folder. Both read would
   * list every door opening twice.
   */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-spool-'));
  fs.mkdirSync(path.join(dir, 'logdata'));
  fs.writeFileSync(
    path.join(dir, 'logdata', 'LogFile_11_20_2026.dat'),
    // The first two are already in the store (filed above). The third is not.
    '37\t20-11-2026 09:12:01\t255\tGUID-IN\t0\n' +
    '37\t20-11-2026 13:37:00\t255\tGUID-IN\t0\n' +
    '37\t20-11-2026 19:30:00\t255\tGUID-OUT\t0\n'
  );
  process.env.BIZCOMPASS_DIR = dir;
  try {
    const { body } = await api('GET', '/api/punch-log?month=2026-11&day=20');
    assert.equal(body.spool.files, 1, 'the file is found');
    assert.equal(body.spool.read, 3, 'and read');
    assert.equal(body.spool.already, 2, 'two of them were already filed');
    // Day 20 already holds three punches; the file repeats two of them and
    // adds one. Four, not six.
    assert.equal(body.total, 4, 'three stored plus the one new one - not six');
    assert.equal(body.rows.filter((r) => r.time === '09:12:01').length, 1, 'listed once, not twice');
    assert.ok(body.rows.some((r) => r.time === '19:30:00'), 'a punch only in the file is still added');
  } finally {
    delete process.env.BIZCOMPASS_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every punch of a month comes back once, keyed by person and day', async () => {
  /*
   * For the in/out register. Asking the per-person route eighty times is
   * eighty requests nobody wanted, so the whole month comes back in one.
   */
  const { status, body } = await api('GET', '/api/punches/month?month=2026-11');
  assert.equal(status, 200);
  assert.equal(body.month, '2026-11');
  const mine = body.punches[amit.id];
  assert.ok(mine, 'the matched person is keyed by their employee id');
  assert.deepEqual(Object.keys(mine).sort(), ['20', '21']);
  assert.deepEqual(mine['20'].map((p) => p.at), ['09:12:01', '13:37:00', '18:02:44']);
  // A number nobody carries is counted, not filed against somebody.
  assert.equal(body.unmatched, 1);
  for (const id of Object.keys(body.punches)) {
    assert.notEqual(id, 'null');
    assert.notEqual(id, 'undefined');
  }
});

test('the month-wide punches carry no salary and nothing statutory', async () => {
  const { body } = await api('GET', '/api/punches/month?month=2026-11');
  const text = JSON.stringify(body.punches);
  assert.ok(!text.includes('26000'), 'no salary figure travels');
  assert.ok(!/BNF-EMP/.test(text), 'and no employee code either - only the id and the times');
});

test('a staff login cannot read everybody\u2019s punches', async () => {
  const { status } = await api('GET', '/api/punches/month?month=2026-11', null, 'not-the-key');
  assert.equal(status, 401);
});

test.after(() => {
  server.close();
  fs.rmSync(DATA, { recursive: true, force: true });
});
