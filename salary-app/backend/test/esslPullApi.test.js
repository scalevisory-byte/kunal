/**
 * The pull from eTimeTrackLite's database, arriving at the same import route
 * as the .xls export.
 *
 * What matters here is that it is the SAME route and therefore the same rules:
 * it looks before it writes, it will not write into a locked month, and the
 * marks it produces are the ones the salary sheet is paid from. A second
 * import path would be a second opinion about whose day was which.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-essl-'));
process.env.DATA_DIR = DATA;
process.env.APP_PASSWORD = 'the-key';
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';

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

const upload = async (periodId, payload, fields = {}) => {
  const form = new FormData();
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  form.append('file', blob, 'essl.json');
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  const res = await fetch(`${base}/api/periods/${periodId}/monthly-status`, {
    method: 'POST',
    headers: { authorization: 'Bearer the-key' },
    body: form,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const pullOf = (rows) => ({
  kind: 'essl-attendance-logs',
  version: 1,
  source: 'E:\\Essl\\eTimeTrackLite1.mdb',
  machine: 'SERVER',
  pulled_at: '2026-11-22 13:50:00',
  rows,
});

let period;
let amit;

/** What the grid holds for Amit, keyed by day. */
const attendanceOf = async () => {
  const res = await api('GET', `/api/periods/${period.id}/attendance`);
  assert.equal(res.status, 200);
  const me = (res.body.employees || []).find((e) => e.employee_id === amit.id);
  return (me && me.attendance) || {};
};

test('set up a month and a person', async () => {
  const company = await api('POST', '/api/companies', { name: 'BNF' });
  assert.ok(company.status < 300, JSON.stringify(company));
  const made = await api('POST', '/api/employees', {
    name: 'AMIT SHAH',
    code: 'E101',
    company_id: company.body.id,
    monthly_salary: 26000,
    joined_on: '2024-01-01',
  });
  assert.ok(made.status < 300, JSON.stringify(made));
  amit = made.body;

  const made2 = await api('POST', '/api/periods', { month: 11, year: 2026 });
  assert.ok(made2.status < 300, JSON.stringify(made2));
  period = made2.body;
});

test('a dry run looks and writes nothing', async () => {
  const res = await upload(
    period.id,
    pullOf([
      {
        company: 'BNF',
        code: 'E101',
        name: 'AMIT SHAH',
        date: '2026-11-03',
        status: 'P',
        in: '2026-11-03 09:28:00',
        out: '2026-11-03 18:40:00',
      },
    ]),
    { dry_run: 'true' }
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.dryRun, true);
  assert.equal(res.body.written, 0);
  assert.equal(res.body.pull.machine, 'SERVER');
  assert.equal(res.body.pull.source, 'E:\\Essl\\eTimeTrackLite1.mdb');

  const marked = Object.values(await attendanceOf()).filter((d) => d && d.code);
  assert.equal(marked.length, 0, 'a look must write nothing');
});

test('writing it puts the marks and the clock times on the grid', async () => {
  const res = await upload(
    period.id,
    pullOf([
      {
        company: 'BNF',
        code: 'E101',
        name: 'AMIT SHAH',
        date: '2026-11-03',
        status: 'P',
        in: '2026-11-03 09:28:00',
        out: '2026-11-03 18:40:00',
      },
      {
        company: 'BNF',
        code: 'E101',
        name: 'AMIT SHAH',
        date: '2026-11-04',
        status: 'P',
        in: '2026-11-04 09:31:00',
        // Never punched out. The out time must arrive blank, not guessed, and
        // not left stale from whatever was there before.
        out: '1900-01-01 00:00:00',
      },
    ])
  );
  assert.equal(res.status, 200);
  assert.ok(res.body.written >= 2, `nothing was written: ${JSON.stringify(res.body)}`);

  const byDay = await attendanceOf();
  assert.equal(byDay[3].code, 'P');
  assert.equal(byDay[3].in_time, '09:28');
  assert.equal(byDay[3].out_time, '18:40');
  assert.equal(byDay[4].code, 'P');
  assert.equal(byDay[4].in_time, '09:31');
  assert.ok(!byDay[4].out_time, `an out time was invented: ${byDay[4].out_time}`);
});

test('a JSON file that is not a pull is refused, not half-read', async () => {
  const res = await upload(period.id, { kind: 'something-else', rows: [] });
  assert.equal(res.status, 400);
});

test('a pull holding no usable rows says so', async () => {
  const res = await upload(period.id, pullOf([{ date: '', status: '' }]));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /no attendance rows/i);
});

test('a locked month is refused before anything is read', async () => {
  const locked = await api('POST', '/api/periods', { month: 10, year: 2026 });
  await api('PATCH', `/api/periods/${locked.body.id}`, { locked: 1 });
  const res = await upload(
    locked.body.id,
    pullOf([
      { company: 'BNF', code: 'E101', name: 'AMIT SHAH', date: '2026-10-03', status: 'P', in: '', out: '' },
    ])
  );
  assert.equal(res.status, 409);
});
