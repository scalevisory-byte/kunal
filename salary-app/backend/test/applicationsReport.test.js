/**
 * "WHO APPLIED?" — the report that was missing.
 *
 * Dinesh's HR, on the Hiring → Reports screen, with a candidate who had just
 * filled the form in: *"details nathi aavti jene form fill kari ne apply
 * karyu che eni ... next schedule krva mate"*.
 *
 * Nothing was broken. The screen opened on **Interview schedule**, which
 * reads the INTERVIEWS table — somebody who has only applied has no
 * interview yet, so it was correctly empty — and then said *"Nothing
 * matches. Try widening the dates"*, which sent somebody hunting a date
 * filter that was never the problem. There was no report of applications at
 * all, which is where a recruitment funnel starts.
 *
 * What these pin: the new report shows somebody the minute they apply, the
 * CV path never travels, and every report's empty line says where its rows
 * actually come from.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPORTS, reportMeta } from '../../shared/hiringReports.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'applications-report-'));
process.env.APP_PASSWORD = 'open-sesame';
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
      authorization: `Bearer ${process.env.APP_PASSWORD}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
};

const open = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

let vacancyRef = '';

test('set up: an opening, published', async () => {
  const company = await api('POST', '/api/companies', { name: 'BOOKNFLY PRIVATE LIMITED' });
  const vacancy = await api('POST', '/api/hiring/vacancies', {
    company_id: company.body.id,
    title: 'JR TOUR CONSULTANT',
    department: 'Operation',
    positions: 1,
  });
  vacancyRef = vacancy.body.ref_no;
  await api('PATCH', `/api/hiring/vacancies/${vacancy.body.id}`, { status: 'published' });
});

test('SOMEBODY WHO FILLS THE FORM IN IS ON THE REPORT AT ONCE', async () => {
  const applied = await open('POST', `/api/public/vacancies/${vacancyRef}/apply`, {
    name: 'Nidhi Shah',
    phone: '9825012345',
    experience: '2 years',
    expected_salary: '18000',
  });
  assert.equal(applied.status, 201);

  const report = await api('GET', '/api/hiring/reports/applications');
  assert.equal(report.status, 200);
  const row = report.body.rows.find((r) => r.candidate_name === 'Nidhi Shah');
  assert.ok(row, 'the person who just applied is on it');
  assert.equal(row.stage, 'New');
  assert.equal(row.source, 'The apply form', 'and it says so in words, not as a column value');
  assert.equal(row.job_title, 'JR TOUR CONSULTANT');
  assert.equal(row.phone, '9825012345');
  assert.ok(row.applied_at, 'with when');
  assert.equal(row.has_cv, '', 'no CV attached, said as nothing rather than as a guess');
});

test('and the interview schedule is still correctly empty — they have no interview', async () => {
  const schedule = await api('GET', '/api/hiring/reports/schedule');
  assert.equal(schedule.status, 200);
  assert.deepEqual(schedule.body.rows, [], 'that report reads the interviews table');
});

test('THE CV PATH NEVER TRAVELS', async () => {
  const report = await api('GET', '/api/hiring/reports/applications');
  assert.ok(!/resume_path/.test(report.text), 'the server’s own filename is not in a report that prints');
});

test('today’s applications are inside a from-to of today', async () => {
  /*
   * The commonest way to look: "show me today". An application stamped
   * with a time must fall inside a range typed as two bare dates.
   */
  const today = new Date().toISOString().slice(0, 10);
  const got = await api('GET', `/api/hiring/reports/applications?from=${today}&to=${today}`);
  assert.ok(
    got.body.rows.some((r) => r.candidate_name === 'Nidhi Shah'),
    'a timestamp inside the day must not fall outside the day'
  );
});

test('it can be narrowed to one stage, and the opening', async () => {
  const neu = await api('GET', '/api/hiring/reports/applications?status=New');
  assert.equal(neu.body.rows.length, 1);
  const none = await api('GET', '/api/hiring/reports/applications?status=Selected');
  assert.deepEqual(none.body.rows, []);
});

test('EVERY REPORT SAYS WHERE ITS ROWS COME FROM WHEN IT HAS NONE', () => {
  /*
   * "Try widening the dates" is the right answer for exactly one reason an
   * empty report can have. Said everywhere, it is a wrong answer eleven
   * times out of twelve - and it cost somebody an afternoon on a date
   * filter.
   */
  for (const report of REPORTS) {
    assert.ok(report.empty, `${report.key} has no empty line`);
    assert.ok(!/widening the dates/.test(report.empty), `${report.key} still blames the dates`);
  }
  assert.match(reportMeta('schedule').empty, /Pipeline/, 'and it says where to go instead');
  assert.equal(REPORTS[0].key, 'applications', 'the funnel starts with who applied');
});
