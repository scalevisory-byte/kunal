import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-reports-'));
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

const report = async (key, q = '') => (await api('GET', `/api/hiring/reports/${key}${q}`)).body.rows;

/* Six people at six different points, built once for every test below. */
let made = [];
let vacancy;
const today = new Date().toISOString().slice(0, 10);

test.before(async () => {
  const company = (await api('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  vacancy = (await api('POST', '/api/hiring/vacancies', {
    company_id: company.id, title: 'Travel Consultant', department: 'Operations', status: 'published',
  })).body;
  for (const name of ['Aarti', 'Bhavin', 'Chirag', 'Dhara', 'Esha', 'Farhan']) {
    const c = (await api('POST', '/api/hiring/candidates', {
      name, phone: String(9500000000 + made.length * 111111),
    })).body;
    const { application } = (await api('POST', '/api/hiring/applications', {
      vacancy_id: vacancy.id, candidate_id: c.id,
    })).body;
    made.push({ c, application });
  }
  const app = (i) => made[i].application.id;

  await api('PUT', `/api/hiring/applications/${app(0)}/screening`, {
    verdict: 'Rejected', rejection_reason: 'Not enough experience',
  });
  await api('PUT', `/api/hiring/applications/${app(1)}/screening`, {
    verdict: 'On Hold', hold_reason: 'Waiting for their CV',
  });
  for (const i of [2, 3, 4, 5]) {
    await api('PUT', `/api/hiring/applications/${app(i)}/screening`, { verdict: 'Eligible' });
    await api('POST', `/api/hiring/applications/${app(i)}/stage`, { stage: 'Interview' });
  }

  const ivs = [];
  for (const [i, at, who, status] of [
    [2, `${today}T11:00`, 'Dinesh Parmar', 'Done'],
    [3, `${today}T15:00`, 'Priya Nair', 'Scheduled'],
    [4, '2026-12-05T10:00', 'Dinesh Parmar', 'Scheduled'],
    [5, `${today}T09:00`, 'Dinesh Parmar', 'Done'],
  ]) {
    const r = (await api('POST', '/api/hiring/interviews', {
      application_id: app(i), at, round: 1, round_name: 'HR Round', interviewer: who,
    })).body.interview;
    await api('PATCH', `/api/hiring/interviews/${r.id}`, { status });
    ivs.push(r);
  }
  await api('PUT', `/api/hiring/interviews/${ivs[0].id}/form?submit=true`, {
    decision: 'Next Round', next_round: 'Technical Round',
  });
  await api('PUT', `/api/hiring/interviews/${ivs[0].id}/evaluation?submit=true`, {
    recommendation: 'Recommended', next_action: 'Next Round', next_round: 'Technical Round',
  });
  await api('PUT', `/api/hiring/interviews/${ivs[3].id}/evaluation?submit=true`, {
    recommendation: 'Not Recommended', next_action: 'Reject', recommendation_reason: 'Weak on ticketing',
  });

  const GOOD = { salary: 26000, designation: 'Travel Consultant', joining_date: '2027-01-12' };
  for (const [i, end, salary] of [[5, 'accepted', 26000], [4, 'declined', 31000]]) {
    await api('PUT', `/api/hiring/applications/${app(i)}/offer`, { ...GOOD, salary });
    await api('POST', `/api/hiring/applications/${app(i)}/offer/move`, { to: 'approved' });
    await api('POST', `/api/hiring/applications/${app(i)}/offer/move`, { to: 'sent' });
    await api('POST', `/api/hiring/applications/${app(i)}/offer/move`, {
      to: end, remarks: end === 'declined' ? 'Took another job' : undefined,
    });
  }
  await api('POST', `/api/hiring/applications/${app(5)}/hire`, {});
});

test('every report answers', async () => {
  for (const key of ['schedule', 'today', 'upcoming', 'completed', 'selected', 'hold',
    'rejected', 'next_round', 'interviewers', 'funnel', 'time_to_hire']) {
    const res = await api('GET', `/api/hiring/reports/${key}`);
    assert.equal(res.status, 200, `${key} failed: ${res.body?.error}`);
    assert.ok(Array.isArray(res.body.rows), `${key} returned no rows array`);
  }
  const nonsense = await api('GET', '/api/hiring/reports/made-up');
  assert.equal(nonsense.status, 400);
});

test("today's interviews are today's, and upcoming excludes what is done", async () => {
  const now = await report('today');
  assert.equal(now.length, 3);
  assert.ok(now.every((r) => String(r.at).startsWith(today)));

  const next = await report('upcoming');
  // Only Scheduled, and nothing in the past: the 15:00 today and the December one.
  assert.equal(next.length, 2);
  assert.ok(next.every((r) => r.status === 'Scheduled'));
});

test('A DECLINE IS NOT A REJECTION', async () => {
  const rows = await report('rejected');

  /*
   * Counting a candidate's refusal as our rejection would flatter the
   * rejection reasons and hide the fact that the money was wrong. Both are in
   * one list - the office wants to know who is out - but they are named apart.
   */
  const ours = rows.find((r) => r.candidate_name === 'Aarti');
  assert.equal(ours.held_at, 'Screening');
  assert.equal(ours.reason, 'Not enough experience');

  const theirs = rows.find((r) => r.candidate_name === 'Esha');
  assert.equal(theirs.held_at, 'They declined the offer');
  assert.equal(theirs.reason, 'Took another job');
});

test('on hold gathers both places somebody can be parked', async () => {
  const rows = await report('hold');
  const held = rows.find((r) => r.candidate_name === 'Bhavin');
  assert.equal(held.held_at, 'Screening');
  assert.equal(held.reason, 'Waiting for their CV');
});

test('next round pending is a to-do list, not a history', async () => {
  let rows = await report('next_round');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].candidate_name, 'Chirag');
  assert.equal(rows[0].next_round, 'Technical Round');
  assert.ok(Number.isInteger(rows[0].waiting_days));

  /*
   * Booking the next round makes the row disappear by itself. A list somebody
   * has to remember to tick off is a list that stays wrong.
   */
  await api('POST', '/api/hiring/interviews', {
    application_id: made[2].application.id, at: '2026-12-01T11:00', round: 2,
    round_name: 'Technical Round',
  });
  rows = await report('next_round');
  assert.equal(rows.length, 0);
});

test('the interviewer-wise report counts what each person did', async () => {
  const rows = await report('interviewers');
  const dinesh = rows.find((r) => r.interviewer === 'Dinesh Parmar');
  assert.equal(dinesh.total, 3);
  assert.equal(dinesh.done, 2);
  assert.equal(dinesh.scheduled, 1);
  assert.equal(dinesh.evaluations, 2);
  // "Not Recommended" must not be counted as recommended just because the
  // word is in it.
  assert.equal(dinesh.recommended, 1);
  assert.equal(dinesh.not_recommended, 1);
});

test('one skipped stage does not break the funnel', async () => {
  const rows = await report('funnel');
  const at = (stage) => rows.find((r) => r.stage === stage);

  // Screening writes Shortlisted straight from New, so nobody passes through
  // Under Review.
  assert.equal(at('Under Review').reached, 0);

  /*
   * ...and the step after it is still measured. Against the step immediately
   * before, Shortlisted was 4 out of 0 and printed a dash, which reads as a
   * broken report rather than as a stage the office does not use.
   */
  assert.equal(at('Shortlisted').reached, 4);
  assert.equal(at('Shortlisted').through_pct, 66.7);
  assert.equal(at('Interview').through_pct, 100);

  // "Reached it" is read off the stage log, so somebody at Joined counts at
  // every step on the way.
  assert.equal(at('New').reached, 6);
  assert.equal(at('Joined').reached, 1);
});

test('time to hire counts real dates only', async () => {
  const rows = await report('time_to_hire');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].candidate_name, 'Farhan');
  assert.equal(rows[0].joined_on, '2027-01-12');
  assert.ok(Number.isInteger(rows[0].days));
  assert.equal(rows[0].salary, 26000);
});

test('selected finds somebody moved by hand as well as somebody with an offer', async () => {
  const byHand = made[1];
  await api('POST', `/api/hiring/applications/${byHand.application.id}/stage`, { stage: 'Selected' });
  const rows = await report('selected');
  const names = rows.map((r) => r.candidate_name);
  assert.ok(names.includes('Farhan'), 'the accepted offer is missing');
  // A report that only looked at offers would quietly lose this one.
  assert.ok(names.includes('Bhavin'), 'somebody moved by hand is missing');
});

test('a filter that is used narrows, and one the report ignores changes nothing', async () => {
  const all = await report('schedule');
  const mine = await report('schedule', '?interviewer=Priya');
  assert.ok(mine.length < all.length);
  assert.ok(mine.every((r) => r.interviewer.includes('Priya')));

  // The funnel does not use `interviewer`, so sending it must change nothing
  // rather than silently returning less.
  const f1 = await report('funnel');
  const f2 = await report('funnel', '?interviewer=Priya');
  assert.deepEqual(f1, f2);
});
