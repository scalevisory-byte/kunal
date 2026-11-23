/**
 * THE DAILY REPORT OVER HTTP — what a scheduled job would fetch.
 *
 * The screen builds the same message in the browser; this route exists so
 * something else can post it every morning without anybody opening the app.
 *
 * What these pin:
 *
 *  - `?format=text` returns the message itself, ready to send.
 *  - The three lines the app cannot know appear only when they are passed in.
 *  - **Reading a report never writes payroll.** Every other read learned this
 *    the hard way: opening a month backdates new hires into it and posts loan
 *    instalments into months already paid.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-daily-'));
process.env.APP_PASSWORD = 'the-key';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const call = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { authorization: 'Bearer the-key', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed, text };
};

let period;
let disha;

test('set the scene: one marked day', async () => {
  const company = (await call('POST', '/api/companies', { name: 'BOOKNFLY' })).body.id;
  disha = (await call('POST', '/api/employees', { company_id: company, name: 'Disha Sakre', monthly_salary: 18000 })).body.id;
  const amit = (await call('POST', '/api/employees', { company_id: company, name: 'Amit Patel', monthly_salary: 26000 })).body.id;
  period = (await call('POST', '/api/periods', { year: 2026, month: 11 })).body.id;
  await call('GET', `/api/periods/${period}/payroll`);
  await call('POST', `/api/periods/${period}/attendance`, {
    entries: [
      { employee_id: disha, day: 19, code: 'A', reason: 'WENT TO VILLAGE' },
      { employee_id: amit, day: 19, code: 'P', in_time: '10:22', out_time: '18:40', uniform: 1 },
    ],
  });
});

test('format=text returns the message, with the names and the reason', async () => {
  const res = await call('GET', '/api/people/daily-report?day=2026-11-19&format=text');
  assert.equal(res.status, 200);
  assert.ok(res.text.startsWith('DAILY OFFICE REPORT'));
  assert.ok(res.text.includes('Date: 19 November 2026'));
  assert.ok(res.text.includes('Disha Sakre (WENT TO VILLAGE)'));
  assert.ok(res.text.includes('Amit Patel — 10:22'));
});

test('the json carries the counts and the names behind each line', async () => {
  const res = await call('GET', '/api/people/daily-report?day=2026-11-19');
  assert.equal(res.body.counts.absent, 1);
  assert.equal(res.body.counts.late, 1);
  assert.equal(res.body.lists.absent[0].employee_name, 'Disha Sakre');
});

test('the three typed lines are carried through, and are absent until they are given', async () => {
  const bare = await call('GET', '/api/people/daily-report?day=2026-11-19&format=text');
  assert.ok(!bare.text.includes('Office Inspection'));

  const told = await call(
    'GET',
    '/api/people/daily-report?day=2026-11-19&format=text&inspection=All%20checklist%20items%20OK&conduct=No%20issues%20today&incidents=Logged%20today%3A%200'
  );
  assert.ok(told.text.includes('Office Inspection\nAll checklist items OK'));
  assert.ok(told.text.includes('Conduct\nNo issues today'));
  assert.ok(told.text.includes('Incidents\nLogged today: 0'));
});

test('the office start can be sent, so the message matches the screen that asked for it', async () => {
  const strict = await call('GET', '/api/people/daily-report?day=2026-11-19&in=10:30&format=text');
  assert.ok(!strict.text.includes('Amit Patel — 10:22'), 'not late against a 10:30 start');
});

test('reading the report does not add a new hire to a month already closed', async () => {
  const before = (await call('GET', `/api/periods/${period}/payroll?sync=false`)).body.rows.length;
  const company = (await call('GET', '/api/companies')).body.companies[0].id;
  await call('POST', '/api/employees', { company_id: company, name: 'Brand New', monthly_salary: 20000 });
  await call('GET', '/api/people/daily-report?day=2026-11-19');
  const after = (await call('GET', `/api/periods/${period}/payroll?sync=false`)).body.rows.length;
  assert.equal(after, before, 'the report read the month; it must not have opened rows in it');
});

/*
 * THE SHAPES OVER HTTP - the whole point of which is a cron that fetches
 * `shape=morning` at ten and `shape=end_of_day` after the last shift, both of
 * them today's. Dinesh: *"short hours & ot ka report aaj ki date ka dusre din
 * jayega / same day kaise jayega"*.
 */
test('shape=morning leaves the hours out; end_of_day carries them', async () => {
  /* Amit worked 10:22 to 18:40 on the 19th, so there is a real figure. */
  const morning = await call('GET', '/api/people/daily-report?day=2026-11-19&shape=morning&format=text');
  /* The HEADING, anchored both ends - the line that says the hours are not here
   * begins "Short hours and overtime...", so a one-sided anchor matches it and
   * the assertion fails against perfectly correct text. */
  assert.ok(!/^Short hours$/m.test(morning.text), 'no Short hours heading in the morning');
  assert.ok(!/Nobody was short/.test(morning.text), 'and never a clean bill of health');
  assert.match(morning.text, /not in this message: the day is not finished/);

  const evening = await call('GET', '/api/people/daily-report?day=2026-11-19&shape=end_of_day&format=text');
  assert.match(evening.text, /^Short hours$/m);
  assert.match(evening.text, /^Overtime$/m);
});

test('an unknown shape gets the message this route always sent', async () => {
  const silly = await call('GET', '/api/people/daily-report?day=2026-11-19&shape=nonsense&format=text');
  const plain = await call('GET', '/api/people/daily-report?day=2026-11-19&format=text');
  assert.equal(silly.text, plain.text);
});

test('as_of stamps the hour, and nothing stamps it unasked', async () => {
  const stamped = await call('GET', '/api/people/daily-report?day=2026-11-19&as_of=19:10&format=text');
  assert.match(stamped.text, /^As at: 19:10$/m);
  const plain = await call('GET', '/api/people/daily-report?day=2026-11-19&format=text');
  assert.ok(!/As at/.test(plain.text));
});

test("with_yesterday reads the day before out of the same month, under its own date", async () => {
  const company = (await call('GET', '/api/companies')).body.companies[0].id;
  assert.ok(company);
  /* Mark the 18th short, so yesterday has something to report. */
  const rows = (await call('GET', `/api/periods/${period}/payroll?sync=false`)).body.rows;
  const amit = rows.find((r) => r.employee_name === 'Amit Patel');
  await call('POST', `/api/periods/${period}/attendance`, {
    entries: [{ employee_id: amit.employee_id, day: 18, code: 'P', in_time: '09:30', out_time: '17:00' }],
  });

  const built = await call('GET', '/api/people/daily-report?day=2026-11-19&shape=with_yesterday');
  assert.equal(built.body.hours_day, 18);
  assert.equal(built.body.hours_date, '2026-11-18');
  assert.match(built.body.text, /Short hours — 18 November 2026/);
  assert.match(built.body.text, /Date: 19 November 2026/, "today's date still heads it");
});

test('ON THE FIRST OF THE MONTH yesterday is another sheet, and it says so', async () => {
  const built = await call('GET', '/api/people/daily-report?day=2026-11-01&shape=with_yesterday');
  assert.equal(built.body.hours_day, null);
  assert.equal(built.body.counts.hours_in_another_month, true);
  assert.match(built.body.text, /previous month, which is a separate sheet/);
  assert.ok(!/Nobody was short/.test(built.body.text), 'a day this sheet has never seen is not a clean day');
});
