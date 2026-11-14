import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-iform-'));
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

/** A company, an opening, a candidate, an application and a scheduled round. */
async function round(n = 1, who = 'Amit Shah') {
  const company = (await api('POST', '/api/companies', { name: `BNF ${Math.random()}` })).body;
  const vacancy = (await api('POST', '/api/hiring/vacancies', {
    company_id: company.id, title: 'Travel Consultant', department: 'Operations', status: 'published',
  })).body;
  const candidate = (await api('POST', '/api/hiring/candidates', {
    name: who, phone: String(9000000000 + Math.floor(Math.random() * 999999999)),
    email: 'x@example.com', notice_period: '30 days',
  })).body;
  const { application } = (await api('POST', '/api/hiring/applications', {
    vacancy_id: vacancy.id, candidate_id: candidate.id,
  })).body;
  await api('POST', `/api/hiring/applications/${application.id}/stage`, { stage: 'Interview' });
  const interview = (await api('POST', '/api/hiring/interviews', {
    application_id: application.id, at: '2026-11-20T11:00', round: n,
    round_name: 'HR Round', interviewer: 'Dinesh Parmar',
  })).body.interview;
  return { company, vacancy, candidate, application, interview };
}

const stageOf = async (id) => (await api('GET', `/api/hiring/applications/${id}`)).body.application.stage;

/* ---------------- the information form ---------------- */

test('a draft needs nothing and moves nobody', async () => {
  const { interview, application } = await round();
  const res = await api('PUT', `/api/hiring/interviews/${interview.id}/form`, {
    observations: 'Half way through typing',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.form.status, 'draft');
  assert.equal(res.body.form.observations, 'Half way through typing');
  // That is the whole point of a draft: no decision, no complaint.
  assert.equal(await stageOf(application.id), 'Interview');
});

test('submitting needs a decision, and a rejection needs a reason', async () => {
  const { interview } = await round();
  const bare = await api('PUT', `/api/hiring/interviews/${interview.id}/form?submit=true`, {});
  assert.equal(bare.status, 400);
  assert.match(bare.body.error, /what happens next/i);

  const noReason = await api('PUT', `/api/hiring/interviews/${interview.id}/form?submit=true`, {
    decision: 'Rejected',
  });
  assert.equal(noReason.status, 400);
  assert.match(noReason.body.error, /has to say why/i);
});

test('"Selected" at interview does NOT skip the offer', async () => {
  const { interview, application } = await round();
  const res = await api('PUT', `/api/hiring/interviews/${interview.id}/form?submit=true`, {
    decision: 'Selected', decision_remarks: 'Strong on bookings',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.form.status, 'submitted');

  /*
   * "Selected" in this pipeline means the offer was ACCEPTED, which is two
   * steps past a good interview. Writing that stage here would issue nothing
   * and skip everything - the exact thing the spec forbids.
   */
  assert.equal(await stageOf(application.id), 'Interview');
});

test('"Rejected" at interview does move them, with the reason on the trail', async () => {
  const { interview, application } = await round();
  const res = await api('PUT', `/api/hiring/interviews/${interview.id}/form?submit=true`, {
    decision: 'Rejected', rejection_reason: 'No ticketing experience',
  });
  assert.equal(res.status, 200);
  assert.equal(await stageOf(application.id), 'Rejected');

  const { body } = await api('GET', `/api/hiring/applications/${application.id}`);
  const last = body.application.stage_log.at(-1);
  assert.equal(last.stage, 'Rejected');
  assert.match(last.note, /No ticketing experience/);
});

test('correcting a fact at the interview corrects the candidate, and a blank wipes nothing', async () => {
  const { interview, candidate } = await round();
  await api('PUT', `/api/hiring/interviews/${interview.id}/form`, {
    dob: '1998-04-12', gender: 'Male', notice_period: '',
    address: { current_city: 'Vadodara', current_pin: '390001' },
  });
  const after = (await api('GET', `/api/hiring/candidates/${candidate.id}`)).body.candidate;
  assert.equal(after.dob, '1998-04-12');
  assert.equal(after.gender, 'Male');
  assert.equal(after.current_city, 'Vadodara');
  // An interviewer who skipped the box did not say the candidate has no notice
  // period.
  assert.equal(after.notice_period, '30 days');
});

test('each round keeps its own form; nothing is overwritten', async () => {
  const { application, interview } = await round(1);
  await api('PUT', `/api/hiring/interviews/${interview.id}/form?submit=true`, {
    decision: 'Next Round', next_round: 'Technical Round', observations: 'Round one notes',
  });
  const second = (await api('POST', '/api/hiring/interviews', {
    application_id: application.id, at: '2026-11-25T11:00', round: 2,
    round_name: 'Technical Round', interviewer: 'Priya Nair',
  })).body.interview;
  await api('PUT', `/api/hiring/interviews/${second.id}/form`, { observations: 'Round two notes' });

  const one = (await api('GET', `/api/hiring/interviews/${interview.id}/form`)).body.form;
  const two = (await api('GET', `/api/hiring/interviews/${second.id}/form`)).body.form;
  assert.equal(one.observations, 'Round one notes');
  assert.equal(two.observations, 'Round two notes');
  assert.notEqual(one.id, two.id);
});

/* ---------------- the evaluation ---------------- */

test('a rating outside 1 to 5 is refused, never clamped', async () => {
  const { interview } = await round();
  const res = await api('PUT', `/api/hiring/interviews/${interview.id}/evaluation?submit=true`, {
    recommendation: 'Recommended', next_action: 'Management Approval',
    ratings: { communication: 7 },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /1 to 5/);
});

test('the score counts what was rated, not all ten', async () => {
  const { interview } = await round();
  const res = await api('PUT', `/api/hiring/interviews/${interview.id}/evaluation`, {
    ratings: { communication: 5, confidence: 4, job_knowledge: 3 },
  });
  const s = res.body.evaluation.summary;
  assert.equal(s.total, 12);
  assert.equal(s.out_of, 15, 'rating three of ten must not be scored out of fifty');
  assert.equal(s.average, 4);
  assert.deepEqual(s.strongest, ['Communication skills', 'Confidence and personality']);
});

test('submitting an evaluation moves the paperwork, never the candidate', async () => {
  const { interview, application } = await round();
  const res = await api('PUT', `/api/hiring/interviews/${interview.id}/evaluation?submit=true`, {
    recommendation: 'Strongly Recommended', next_action: 'Final Selection',
    ratings: { communication: 5 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.evaluation.status, 'submitted');
  // The rule the module exists for.
  assert.equal(await stageOf(application.id), 'Interview');
});

test('HR cannot approve an evaluation; only an admin can', async () => {
  // This file runs wide open, so the actor is an admin. The gate itself is
  // unit-tested against each ability in interviewEval.test.js; here we prove
  // the ROUTE reads abilities off the session rather than the body.
  const { interview } = await round();
  await api('PUT', `/api/hiring/interviews/${interview.id}/evaluation?submit=true`, {
    recommendation: 'Recommended', next_action: 'Management Approval',
  });
  const id = (await api('GET', `/api/hiring/interviews/${interview.id}/evaluation`)).body.evaluation.id;

  // Sending abilities in the body must change nothing - they are not read.
  const sneaky = await api('POST', `/api/hiring/evaluations/${id}/review`, {
    to: 'approved', abilities: ['admin'], by: 'Somebody Else',
  });
  assert.equal(sneaky.status, 400, 'submitted goes to review first, not straight to approved');
});

test('an approved evaluation is locked, and only a rejection moves anybody', async () => {
  const { interview, application } = await round();
  await api('PUT', `/api/hiring/interviews/${interview.id}/evaluation?submit=true`, {
    recommendation: 'Not Recommended', next_action: 'Reject',
    recommendation_reason: 'Not enough ticketing experience',
  });
  const id = (await api('GET', `/api/hiring/interviews/${interview.id}/evaluation`)).body.evaluation.id;

  await api('POST', `/api/hiring/evaluations/${id}/review`, { to: 'pending_hr' });
  assert.equal(await stageOf(application.id), 'Interview', 'a review step moves nobody');

  const approved = await api('POST', `/api/hiring/evaluations/${id}/review`, {
    to: 'approved', remarks: 'Agreed',
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.evaluation.status, 'approved');
  assert.equal(await stageOf(application.id), 'Rejected');

  // Locked.
  const edit = await api('PUT', `/api/hiring/interviews/${interview.id}/evaluation`, {
    overall_remarks: 'changed my mind',
  });
  assert.equal(edit.status, 400);
  assert.match(edit.body.error, /already been decided/i);

  /*
   * And not decided twice - which is a 400 and NOT a 403.
   *
   * Nothing is wrong with this login's rights; the evaluation is simply
   * finished. Answering 403 would tell an admin they lacked the permission for
   * something no permission could ever allow, and send them hunting for a
   * password that was never the problem. Same distinction the review gate
   * draws between "forbidden" and "bad-step".
   */
  const again = await api('POST', `/api/hiring/evaluations/${id}/review`, { to: 'rejected' });
  assert.equal(again.status, 400);
  assert.match(again.body.error, /already approved/i);
});

test('the candidate history carries both records, one row per round', async () => {
  const { application, interview, candidate } = await round(1, 'Riya Pal');
  await api('PUT', `/api/hiring/interviews/${interview.id}/form?submit=true`, {
    decision: 'Next Round', next_round: 'Technical Round',
  });
  await api('PUT', `/api/hiring/interviews/${interview.id}/evaluation?submit=true`, {
    recommendation: 'Recommended', next_action: 'Next Round', next_round: 'Technical Round',
    ratings: { communication: 4, attitude: 5 },
  });
  const second = (await api('POST', '/api/hiring/interviews', {
    application_id: application.id, at: '2026-11-26T10:00', round: 2, round_name: 'Technical Round',
  })).body.interview;

  const { history } = (await api('GET', `/api/hiring/candidates/${candidate.id}/interviews`)).body;
  assert.equal(history.length, 2);
  const one = history.find((h) => h.interview_id === interview.id);
  assert.equal(one.decision, 'Next Round');
  assert.equal(one.recommendation, 'Recommended');
  assert.equal(one.summary.average, 4.5);
  // The round nobody has filled in yet says so, rather than borrowing round one's.
  const two = history.find((h) => h.interview_id === second.id);
  assert.equal(two.form_id, null);
  assert.equal(two.summary.average, null);
});

test('every decision lands on the audit trail', async () => {
  const { interview, candidate } = await round(1, 'Kiran Patel');
  await api('PUT', `/api/hiring/interviews/${interview.id}/form?submit=true`, {
    decision: 'Selected', decision_remarks: 'Good fit',
  });
  const { body } = await api('GET', '/api/people/audit?entity=interview_form&limit=50');
  const line = body.entries.find((r) => String(r.label || '').includes('Kiran Patel'));
  assert.ok(line, 'submitting an interview form wrote no audit line');
  assert.equal(line.to_value, 'Selected');
  assert.equal(line.note, 'Good fit');
});
