import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  REPORTS, cell, reportMeta, reportTotals,
} from '../../shared/hiringReports.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-offers-'));
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

let company;
let n = 0;
test.before(async () => {
  company = (await api('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
});

/** Somebody with an offer on the table, left wherever `upto` says. */
async function offered({ upto = 'draft', valid_till = '2099-01-01', joining_date = '2099-02-01' } = {}) {
  n += 1;
  const v = (await api('POST', '/api/hiring/vacancies', {
    company_id: company.id, title: 'Travel Consultant', status: 'published',
  })).body;
  const c = (await api('POST', '/api/hiring/candidates', {
    name: `Person ${n}`, phone: String(9200000000 + n),
  })).body;
  const { application } = (await api('POST', '/api/hiring/applications', {
    vacancy_id: v.id, candidate_id: c.id,
  })).body;
  await api('PUT', `/api/hiring/applications/${application.id}/offer`, {
    salary: '24000', designation: 'Travel Consultant', joining_date, valid_till,
  });
  for (const to of ['approved', 'sent', 'accepted']) {
    if (['approved', 'sent', 'accepted'].indexOf(upto) < ['approved', 'sent', 'accepted'].indexOf(to)) break;
    if (upto === 'draft') break;
    const moved = await api('POST', `/api/hiring/applications/${application.id}/offer/move`, { to });
    assert.equal(moved.status, 200, `could not move to ${to}: ${JSON.stringify(moved.body)}`);
    if (to === upto) break;
  }
  return { application, candidate: c };
}

const offers = async () => (await api('GET', '/api/hiring/reports/offers')).body.rows;

test('the offers register carries the DRAFTS, which no other screen shows', async () => {
  /*
   * This is what makes it a different report from "Selected candidates"
   * beside it. That one is read off the stage as well, so it finds somebody
   * moved to Selected by hand; this one finds the offer that was written and
   * then never approved, which is otherwise invisible.
   */
  const { candidate } = await offered({ upto: 'draft' });
  const row = (await offers()).find((r) => r.candidate_name === candidate.name);
  assert.ok(row, 'a draft offer must be on the register');
  assert.equal(row.status, 'draft');
  assert.equal(row.approved_by, null);
});

test('past its date is read off the calendar, and only for an offer still waiting', async () => {
  // Sent, and the day it was valid till has gone.
  const gone = await offered({ upto: 'sent', valid_till: '2020-01-10', joining_date: '2020-02-01' });
  // Accepted - they answered, so the date is beside the point.
  const answered = await offered({ upto: 'accepted', valid_till: '2020-01-10', joining_date: '2020-02-01' });
  // A draft nobody has approved is not waiting on anybody outside the office.
  const draft = await offered({ upto: 'draft', valid_till: '2020-01-10', joining_date: '2020-02-01' });

  const rows = await offers();
  const by = (c) => rows.find((r) => r.candidate_name === c.candidate.name);
  assert.equal(by(gone).past_valid, 'yes');
  assert.equal(by(answered).past_valid, '');
  assert.equal(by(draft).past_valid, '');

  // Nothing expired itself: the offer still says what it said.
  assert.equal(by(gone).status, 'sent');
});

test('the report is the offers, not the applications - one row each', async () => {
  const rows = await offers();
  const ids = rows.map((r) => r.ref_no);
  assert.equal(new Set(ids).size, ids.length, 'an offer must appear once');
  for (const row of rows) {
    assert.ok(row.candidate_name, 'every row names the person');
    assert.ok(row.company_name, 'and the company it is from');
  }
});

/* ---------------- the shared half ---------------- */

test('only the columns that say they can be totalled are', () => {
  /*
   * A sum of "days to hire" is not a fact about anything, and the funnel's
   * counts would count a candidate once per step they got through. Both are
   * numbers; neither carries the flag.
   */
  const funnel = reportMeta('funnel');
  assert.deepEqual(reportTotals(funnel, [{ reached: 10, here: 4 }, { reached: 6, here: 2 }]), {});

  const time = reportMeta('time_to_hire');
  const times = reportTotals(time, [{ days: 30, salary: 20000 }, { days: 10, salary: 15000 }]);
  assert.equal(times.Days, undefined, 'days to hire must not be added up');
  assert.equal(times.Salary, '₹35,000');

  const out = reportMeta('offers');
  assert.equal(reportTotals(out, [{ salary: 24000 }, { salary: 21000 }]).Offered, '₹45,000');
});

test('the paper uses the office’s word for where an offer stands', () => {
  const column = reportMeta('offers').columns.find((c) => c.key === 'status');
  assert.equal(cell({ status: 'sent' }, column), 'Sent');
  assert.equal(cell({ status: 'accepted' }, column), 'Accepted');
  // A status nobody has heard of is shown as it is, never swallowed.
  assert.equal(cell({ status: 'parked' }, column), 'parked');
  // And a blank stays blank rather than becoming a label.
  assert.equal(cell({ status: '' }, column), '');
});

test('every report still has a key, a label and filters the screen can draw', () => {
  const keys = REPORTS.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes('offers'));
  for (const r of REPORTS) {
    assert.ok(r.label && r.hint, `${r.key} needs a label and a hint`);
    assert.ok(r.columns.length, `${r.key} needs columns`);
  }
});
