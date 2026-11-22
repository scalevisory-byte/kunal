/**
 * The Bizcompass spool, read off disk and written onto the grid.
 *
 * The folder belongs to another company's product. These pin the two things
 * that matter about that: we only ever READ it, and a day it has nothing for
 * writes nothing rather than marking anybody absent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-biz-'));
const SPOOL = fs.mkdtempSync(path.join(os.tmpdir(), 'bizspool-'));
process.env.DATA_DIR = DATA;
process.env.APP_PASSWORD = 'the-key';
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
process.env.BIZCOMPASS_DIR = SPOOL;

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      authorization: 'Bearer the-key',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const importSpool = async (periodId, dryRun) => {
  const form = new FormData();
  form.append('dry_run', String(dryRun));
  const res = await fetch(`${base}/api/periods/${periodId}/bizcompass`, {
    method: 'POST',
    headers: { authorization: 'Bearer the-key' },
    body: form,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const G = '17c5b74f-8de9-4840-b565-9fcc32280df3';
const writeBatch = (name, lines) =>
  fs.writeFileSync(path.join(SPOOL, name), lines.map((l) => `${l}\t255\t${G}\t0`).join('\n'));

let period;
let amit;
let riya;

test('a month, two people, and a spool on disk', async () => {
  const company = await api('POST', '/api/companies', { name: 'BNF' });
  const a = await api('POST', '/api/employees', {
    name: 'AMIT SHAH', code: 'E101', device_code: '37',
    company_id: company.body.id, monthly_salary: 26000, joined_on: '2024-01-01',
  });
  const r = await api('POST', '/api/employees', {
    name: 'RIYA PAL', code: '114',
    company_id: company.body.id, monthly_salary: 24000, joined_on: '2024-01-01',
  });
  amit = a.body;
  riya = r.body;
  assert.equal(amit.device_code, '37', 'the punch ID must come back on the record');
  assert.equal(riya.device_code, null, 'blank falls back to the code');

  const p = await api('POST', '/api/periods', { month: 11, year: 2026 });
  period = p.body;

  // Two batches, as the tool writes them: the name carries the sync day.
  writeBatch('LogFile_11_20_09_15_00_000.dat', [
    '37\t20-11-2026 09:14:00',
    '114\t20-11-2026 09:31:00',
  ]);
  writeBatch('LogFile_11_20_18_25_00_000.dat', [
    '37\t20-11-2026 18:12:00',
    '114\t20-11-2026 18:40:00',
    // A number nobody carries.
    '999\t20-11-2026 09:02:00',
  ]);
  // Another month's batch, which must not reach November.
  writeBatch('LogFile_08_14_10_00_00_000.dat', ['37\t14-08-2026 09:00:00']);
});

test('the status says where it is reading', async () => {
  const res = await api('GET', '/api/bizcompass/status');
  assert.equal(res.status, 200);
  assert.equal(res.body.configured, true);
  assert.equal(res.body.readable, true);
  assert.equal(res.body.dir, SPOOL);
});

test('a look writes nothing and names the number nobody carries', async () => {
  const res = await importSpool(period.id, true);
  assert.equal(res.status, 200);
  assert.equal(res.body.dryRun, true);
  assert.equal(res.body.written, 0);
  assert.equal(res.body.matchedPeople, 2, 'both the punch ID and the code must match');
  assert.deepEqual(res.body.unknownIds, [{ id: '999', punches: 1 }]);
  assert.deepEqual(res.body.coverage.days.map((d) => d.day), [20]);

  const grid = await api('GET', `/api/periods/${period.id}/attendance`);
  const marked = grid.body.employees.flatMap((e) =>
    Object.values(e.attendance || {}).filter((d) => d && d.code)
  );
  assert.equal(marked.length, 0, 'a look must write nothing');
});

test('writing puts the day and its clock times on the grid', async () => {
  const res = await importSpool(period.id, false);
  assert.equal(res.status, 200);
  assert.equal(res.body.written, 2);

  const grid = await api('GET', `/api/periods/${period.id}/attendance`);
  const of = (id) => (grid.body.employees.find((e) => e.employee_id === id) || {}).attendance || {};
  assert.equal(of(amit.id)[20].code, 'P');
  assert.equal(of(amit.id)[20].in_time, '09:14');
  assert.equal(of(amit.id)[20].out_time, '18:12');
  assert.equal(of(riya.id)[20].in_time, '09:31');
});

test('a day the spool has nothing for is left alone, never marked absent', async () => {
  // This is the whole reason the spool is a safer source than a printed
  // report: no punch means no entry, not an absence nobody earned.
  const grid = await api('GET', `/api/periods/${period.id}/attendance`);
  const amitDays = (grid.body.employees.find((e) => e.employee_id === amit.id) || {}).attendance || {};
  const marked = Object.entries(amitDays).filter(([, d]) => d && d.code);
  assert.deepEqual(marked.map(([day]) => Number(day)), [20]);
});

test('NOTHING in that folder is touched', async () => {
  // It belongs to another product, which is writing to it while we read, and
  // its archive is the only copy of punches already uploaded.
  const names = fs.readdirSync(SPOOL).sort();
  assert.deepEqual(names, [
    'LogFile_08_14_10_00_00_000.dat',
    'LogFile_11_20_09_15_00_000.dat',
    'LogFile_11_20_18_25_00_000.dat',
  ]);
  const text = fs.readFileSync(path.join(SPOOL, 'LogFile_11_20_09_15_00_000.dat'), 'utf8');
  assert.match(text, /^37\t20-11-2026 09:14:00/);
});

test('a locked month is refused', async () => {
  const locked = await api('POST', '/api/periods', { month: 10, year: 2026 });
  await api('PATCH', `/api/periods/${locked.body.id}`, { locked: 1 });
  const res = await importSpool(locked.body.id, true);
  assert.equal(res.status, 409);
});
