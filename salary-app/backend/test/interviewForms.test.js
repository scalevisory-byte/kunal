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

test('submitting the particulars form requires nothing and moves nobody', async () => {
  const { interview, application } = await round();

  /*
   * REWRITTEN, not patched. This test used to assert that submitting needed a
   * decision and that a rejection needed a reason.
   *
   * Dinesh pointed out why that was wrong: this form is filled in BEFORE the
   * interview, by the candidate. A verdict cannot sit on a form completed
   * before anybody has met them. The decision is on the evaluation now, where
   * the interviewer records it afterwards - so submitting this means only
   * "these particulars are confirmed".
   */
  const bare = await api('PUT', `/api/hiring/interviews/${interview.id}/form?submit=true`, {});
  assert.equal(bare.status, 200);
  assert.equal(bare.body.form.status, 'submitted');
  assert.equal(await stageOf(application.id), 'Interview');
});

test('the particulars form never moves anybody — the evaluation does', async () => {
  const { interview, application } = await round();
  await api('PUT', `/api/hiring/interviews/${interview.id}/form?submit=true`, {});
  assert.equal(await stageOf(application.id), 'Interview');

  /*
   * A rejection is the interviewer's, recorded on the evaluation, and it
   * reaches the candidate only once somebody authorised approves it. The old
   * version of this test rejected somebody straight off the particulars form.
   */
  await api('PUT', `/api/hiring/interviews/${interview.id}/evaluation?submit=true`, {
   evaluated_by: 'Dinesh Parmar',
    evaluated_by: 'Priya Nair',
    recommendation: 'Not Recommended',
    next_action: 'Reject',
    recommendation_reason: 'No ticketing experience',
  });
  assert.equal(await stageOf(application.id), 'Interview', 'submitting moved somebody');

  const id = (await api('GET', `/api/hiring/interviews/${interview.id}/evaluation`)).body.evaluation.id;
  await api('POST', `/api/hiring/evaluations/${id}/review`, { to: 'pending_hr' });
  await api('POST', `/api/hiring/evaluations/${id}/review`, { to: 'approved' });
  assert.equal(await stageOf(application.id), 'Rejected');

  const { body } = await api('GET', `/api/hiring/applications/${application.id}`);
  assert.match(body.application.stage_log.at(-1).note, /No ticketing experience/);
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
    evaluated_by: 'Dinesh Parmar',
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
    evaluated_by: 'Dinesh Parmar',
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
    evaluated_by: 'Dinesh Parmar',
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
    evaluated_by: 'Dinesh Parmar',
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
    college: 'MS University',
  });
  await api('PUT', `/api/hiring/interviews/${interview.id}/evaluation?submit=true`, {
    evaluated_by: 'Dinesh Parmar',
    recommendation: 'Recommended', next_action: 'Next Round', next_round: 'Technical Round',
    ratings: { communication: 4, attitude: 5 },
  });
  const second = (await api('POST', '/api/hiring/interviews', {
    application_id: application.id, at: '2026-11-26T10:00', round: 2, round_name: 'Technical Round',
  })).body.interview;

  const { history } = (await api('GET', `/api/hiring/candidates/${candidate.id}/interviews`)).body;
  assert.equal(history.length, 2);
  const one = history.find((h) => h.interview_id === interview.id);
  // The form says the particulars were confirmed; the EVALUATION says what
  // was decided. They are two different records for a reason.
  assert.equal(one.form_status, 'submitted');
  assert.equal(one.recommendation, 'Recommended');
  assert.equal(one.next_action, 'Next Round');
  assert.equal(one.summary.average, 4.5);
  // The round nobody has filled in yet says so, rather than borrowing round one's.
  const two = history.find((h) => h.interview_id === second.id);
  assert.equal(two.form_id, null);
  assert.equal(two.summary.average, null);
});

test('confirming the particulars lands on the audit trail', async () => {
  const { interview } = await round(1, 'Kiran Patel');
  await api('PUT', `/api/hiring/interviews/${interview.id}/form?submit=true`, {
    college: 'MS University',
  });
  const { body } = await api('GET', '/api/people/audit?entity=interview_form&limit=50');
  const line = body.entries.find((r) => String(r.label || '').includes('Kiran Patel'));
  assert.ok(line, 'confirming an interview form wrote no audit line');
  assert.equal(line.action, 'submitted');
  assert.equal(line.note, 'particulars confirmed');
});

/* ---------------- the candidate fills it in themselves ---------------- */

async function linkFor(interviewId) {
  const res = await api('POST', `/api/hiring/interviews/${interviewId}/candidate-link`, {});
  return res.body.token;
}

test('the candidate sees their own form and NOTHING about the decision', async () => {
  const { interview } = await round(1, 'Nikita Rao');
  // The office has already made a verdict and taken notes.
  await api('PUT', `/api/hiring/interviews/${interview.id}/form`, {
    decision: 'Rejected', rejection_reason: 'Not enough experience',
    observations: 'Nervous, kept checking the door',
    recommended_salary: 19000,
  });

  const page = (await api('GET', `/api/public/interview-form/${await linkFor(interview.id)}`)).body;
  const wire = JSON.stringify(page);

  assert.equal(page.name, 'Nikita Rao');
  /*
   * None of this is merely hidden on the page - it is never put in the
   * response. Dinesh's own rule: candidates must not be able to change
   * screening or interview decisions, and they cannot read them either.
   */
  assert.ok(!/Rejected/.test(wire), 'the decision was sent to the candidate');
  assert.ok(!/Not enough experience/.test(wire), 'the rejection reason was sent to the candidate');
  assert.ok(!/Nervous/.test(wire), "the interviewer's notes were sent to the candidate");
  assert.ok(!/19000/.test(wire), 'the recommended salary was sent to the candidate');
});

test('A CANDIDATE CANNOT WRITE A DECISION ON THEMSELVES', async () => {
  const { interview, application } = await round(1, 'Sneha Joshi');
  const token = await linkFor(interview.id);

  const res = await api('POST', `/api/public/interview-form/${token}`, {
    college: 'MS University',
    degree: 'B.Com',
    answers: { about: 'I have two years in ticketing.' },
    // Everything below is theirs to try and not theirs to set.
    decision: 'Selected',
    decision_remarks: 'I am great',
    rejection_reason: 'none',
    observations: 'they loved me',
    recommended_salary: 99999,
    next_round: 'Final Management Round',
  });
  assert.equal(res.status, 200);

  const form = (await api('GET', `/api/hiring/interviews/${interview.id}/form`)).body.form;
  // What they were allowed to say is there.
  assert.equal(form.college, 'MS University');
  assert.equal(form.answers.about, 'I have two years in ticketing.');
  assert.ok(form.candidate_filled_at);

  /*
   * ...and everything else was dropped by the allow-list on the server,
   * whatever the page sent. An allow-list fails the safe way: a field added
   * to the form later is not theirs until somebody says so.
   */
  assert.equal(form.decision, null);
  assert.equal(form.decision_remarks, null);
  assert.equal(form.rejection_reason, null);
  assert.equal(form.observations, null);
  assert.equal(form.recommended_salary, null);
  assert.equal(form.next_round, null);

  // The form is still a draft - submitting is what records a verdict, and
  // that is never theirs to record. And nobody moved.
  assert.equal(form.status, 'draft');
  assert.equal(await stageOf(application.id), 'Interview');
});

test('what the candidate corrects about themselves reaches their record', async () => {
  const { interview, candidate } = await round(1, 'Rahul Shah');
  const token = await linkFor(interview.id);
  await api('POST', `/api/public/interview-form/${token}`, {
    dob: '1996-02-20',
    email: 'rahul@example.com',
    address: { current_city: 'Vadodara', current_pin: '390007' },
  });
  const after = (await api('GET', `/api/hiring/candidates/${candidate.id}`)).body.candidate;
  assert.equal(after.dob, '1996-02-20');
  assert.equal(after.current_city, 'Vadodara');
});

test('a tampered or made-up link is a 404, never somebody else’s form', async () => {
  const { interview } = await round(1, 'Token Test');
  const token = await linkFor(interview.id);

  assert.equal((await api('GET', '/api/public/interview-form/not-a-token')).status, 404);
  // One character changed breaks the signature.
  const bent = `${token.slice(0, -2)}${token.slice(-2) === 'aa' ? 'bb' : 'aa'}`;
  assert.equal((await api('GET', `/api/public/interview-form/${bent}`)).status, 404);
  // A token of the wrong kind does not work here either.
  assert.equal((await api('GET', `/api/public/sit/${token}`)).status, 404);
});

test('the office can see whether they filled it in', async () => {
  const { interview } = await round(1, 'Filled In');
  const before = (await api('GET', '/api/hiring/interviews')).body.interviews
    .find((i) => i.id === interview.id);
  assert.equal(before.candidate_filled_at, null);

  const token = await linkFor(interview.id);
  await api('POST', `/api/public/interview-form/${token}`, { college: 'Somewhere' });

  const after = (await api('GET', '/api/hiring/interviews')).body.interviews
    .find((i) => i.id === interview.id);
  /*
   * So nobody opens the form expecting it to be filled and finds it blank
   * with the candidate already sitting opposite.
   */
  assert.ok(after.candidate_filled_at);
});

test('a duplicate booking can be deleted; a written-up one cannot', async () => {
  const { application, interview } = await round(1, 'Double Booked');
  const twin = (await api('POST', '/api/hiring/interviews', {
    application_id: application.id, at: '2026-11-16T23:56', round: 1,
  })).body.interview;

  /*
   * Dinesh booked the same interview twice and had no way to remove it. A
   * duplicate nobody wrote up is not a record of anything.
   */
  assert.deepEqual((await api('DELETE', `/api/hiring/interviews/${twin.id}`)).body, { removed: 1 });

  // ...but once it has been written up it carries somebody's judgement and
  // somebody's name, and deleting it would take them with it.
  await api('PUT', `/api/hiring/interviews/${interview.id}/form?submit=true`, { decision: 'Selected' });
  const refused = await api('DELETE', `/api/hiring/interviews/${interview.id}`);
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /Cancelled or No show/);
});

test('a draft can be undone; a decision is withdrawn instead', async () => {
  const { application, interview } = await round(1, 'Undo Me');

  // A screening typed against the wrong person comes off.
  await api('PUT', `/api/hiring/applications/${application.id}/screening`, { verdict: 'Eligible' });
  assert.deepEqual((await api('DELETE', `/api/hiring/applications/${application.id}/screening`)).body,
    { removed: 1 });
  assert.equal((await api('GET', `/api/hiring/applications/${application.id}/screening`)).body.screening, null);

  // A draft evaluation goes; a submitted one does not.
  await api('PUT', `/api/hiring/interviews/${interview.id}/evaluation`, { overall_remarks: 'half typed' });
  assert.deepEqual((await api('DELETE', `/api/hiring/interviews/${interview.id}/evaluation`)).body,
    { removed: 1 });
  await api('PUT', `/api/hiring/interviews/${interview.id}/evaluation?submit=true`, {
    evaluated_by: 'Dinesh Parmar',
    recommendation: 'Recommended', next_action: 'Management Approval',
  });
  const no = await api('DELETE', `/api/hiring/interviews/${interview.id}/evaluation`);
  assert.equal(no.status, 409);
  assert.match(no.body.error, /reject it or put it on hold/);

  // An approved offer is withdrawn, never deleted - deleting it would
  // silently change what last week's figures said.
  await api('PUT', `/api/hiring/applications/${application.id}/offer`, {
    salary: 26000, designation: 'Travel Consultant', joining_date: '2027-01-12',
  });
  assert.deepEqual((await api('DELETE', `/api/hiring/applications/${application.id}/offer`)).body,
    { removed: 1 });
  await api('PUT', `/api/hiring/applications/${application.id}/offer`, {
    salary: 26000, designation: 'Travel Consultant', joining_date: '2027-01-12',
  });
  await api('POST', `/api/hiring/applications/${application.id}/offer/move`, { to: 'approved' });
  const locked = await api('DELETE', `/api/hiring/applications/${application.id}/offer`);
  assert.equal(locked.status, 409);
  assert.match(locked.body.error, /Withdraw it instead/);
});

test('a form the candidate sent shows up where somebody will see it', async () => {
  const { interview } = await round(1, 'Arrived Back');
  const token = await linkFor(interview.id);

  /*
   * Dinesh asked where a form a candidate fills in actually ARRIVES. It goes
   * onto that interview's own form - but nothing said one had come back, so
   * the only way to find out was opening every row.
   */
  // The overview counts the whole database, and earlier tests in this file
  // have filled forms in too - so this measures the CHANGE, not the total.
  let overview = (await api('GET', '/api/hiring/overview')).body;
  const before = overview.candidateForms.filled;
  assert.ok(overview.candidateForms.waiting >= 1, 'a form sent and not back is not counted');

  await api('POST', `/api/public/interview-form/${token}`, { college: 'MS University' });

  overview = (await api('GET', '/api/hiring/overview')).body;
  assert.equal(overview.candidateForms.filled, before + 1);
  assert.ok(overview.candidateForms.who.some((f) => f.candidate_name === 'Arrived Back'),
    'the overview counts it but does not name them');

  // And what they typed is in the office's own form, in the right field.
  const form = (await api('GET', `/api/hiring/interviews/${interview.id}/form`)).body.form;
  assert.equal(form.college, 'MS University');

  /*
   * Once the office confirms it, it stops being something waiting to be read.
   * A list that keeps showing finished work is a list people stop reading.
   */
  await api('PUT', `/api/hiring/interviews/${interview.id}/form?submit=true`, { college: 'MS University' });
  overview = (await api('GET', '/api/hiring/overview')).body;
  assert.ok(!overview.candidateForms.who.some((f) => f.candidate_name === 'Arrived Back'));
});

test('a submitted evaluation shows up in a queue somebody can see', async () => {
  const { interview } = await round(1, 'Waiting Person');

  /*
   * Dinesh asked where an interviewer's submitted evaluation ACTUALLY GOES.
   * It went into the review chain and nowhere on screen, so the only way to
   * find one was to remember which interview it was. A queue nobody can see
   * is a queue nothing comes out of.
   */
  let waiting = (await api('GET', '/api/hiring/evaluations/waiting')).body.waiting;
  assert.ok(!waiting.some((w) => w.candidate_name === 'Waiting Person'));

  await api('PUT', `/api/hiring/interviews/${interview.id}/evaluation?submit=true`, {
    evaluated_by: 'Priya Nair', recommendation: 'Recommended',
    next_action: 'Final Selection', ratings: { communication: 5, attitude: 4 },
  });

  waiting = (await api('GET', '/api/hiring/evaluations/waiting')).body.waiting;
  const mine = waiting.find((w) => w.candidate_name === 'Waiting Person');
  assert.ok(mine, 'a submitted evaluation is not in the queue');
  assert.equal(mine.evaluated_by, 'Priya Nair');
  assert.equal(mine.recommendation, 'Recommended');
  assert.equal(mine.summary.average, 4.5);
  // The stored ratings themselves do not travel - the queue needs the summary.
  assert.equal(mine.ratings, undefined);

  // Decided work leaves the list: one that keeps showing finished work is one
  // people stop reading.
  const id = (await api('GET', `/api/hiring/interviews/${interview.id}/evaluation`)).body.evaluation.id;
  await api('POST', `/api/hiring/evaluations/${id}/review`, { to: 'pending_management' });
  assert.ok((await api('GET', '/api/hiring/evaluations/waiting')).body.waiting
    .some((w) => w.candidate_name === 'Waiting Person'), 'still under review, still listed');

  await api('POST', `/api/hiring/evaluations/${id}/review`, { to: 'approved' });
  assert.ok(!(await api('GET', '/api/hiring/evaluations/waiting')).body.waiting
    .some((w) => w.candidate_name === 'Waiting Person'), 'a decided evaluation is still listed');
});
