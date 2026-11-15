/**
 * The four gaps Dinesh's own ten-step flow still had.
 *
 * He sent the flow and asked whether the app follows it. Seven steps did.
 * These are the other three plus the panel:
 *
 *   7.  HR -> Department Head -> Final Management, with no head in between
 *   10. "employee code generation", which nothing generated
 *   3->4 "eligible candidates ne test moklo", with no list to work from
 *   5.  "Interviewer / Panel", where panel was a column nothing ever wrote
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  employeeCodeProblem,
  nextEmployeeCode,
  tidyEmployeeCode,
} from '../../shared/employeeCode.js';
import { STATUSES, TRANSITIONS, movesFrom } from '../../shared/interviewEval.js';
import { integrity } from '../../shared/testSheet.js';

/* ---------------- the employee code ---------------- */

/*
 * The number only ever goes up. Counting rows would hand a leaver's number to
 * the next joiner, and then an old payslip, a PF record and an attendance
 * sheet point at two different people.
 */
test('the series reads the highest used, never a count', () => {
  assert.equal(nextEmployeeCode('BOOKNFLY PVT LTD', []), 'BPL-001');
  assert.equal(nextEmployeeCode('BOOKNFLY PVT LTD', ['BPL-001', 'BPL-002']), 'BPL-003');
  /* Two people left; 001 and 002 are gone from the table. 003 must NOT come back. */
  assert.equal(nextEmployeeCode('BOOKNFLY PVT LTD', ['BPL-003']), 'BPL-004');
});

test('a code typed in another shape is left alone and does not set the number', () => {
  assert.equal(nextEmployeeCode('BOOKNFLY PVT LTD', ['E-44', 'EMP/12']), 'BPL-001');
  /* An asset code shares the prefix and is not this series. */
  assert.equal(nextEmployeeCode('BOOKNFLY PVT LTD', ['BPL-LAP-014']), 'BPL-001');
});

test('a number taken in any spelling is never handed out', () => {
  assert.equal(nextEmployeeCode('BOOKNFLY PVT LTD', ['bpl-001', ' BPL-002 ']), 'BPL-003');
});

test('each company has its own series', () => {
  const taken = ['BPL-001', 'BPL-002'];
  assert.equal(nextEmployeeCode('SCALE', taken), 'SCA-001');
});

/* A code is useful, not required: refusing a save would stop a salary. */
test('blank is not a problem, but a duplicate is', () => {
  assert.equal(employeeCodeProblem(''), '');
  assert.equal(employeeCodeProblem('BPL-001', { taken: ['BPL-002'] }), '');
  assert.match(employeeCodeProblem('BPL-001', { taken: ['BPL-001'] }), /already has/);
  /* Their own code is not a clash with themselves. */
  assert.equal(employeeCodeProblem('BPL-001', { taken: ['BPL-001'], mine: 'BPL-001' }), '');
});

test('a code is tidied, not rejected', () => {
  assert.equal(tidyEmployeeCode(' bpl 001 '), 'BPL001');
});

/* ---------------- the department head ---------------- */

test('the head sits between HR and management', () => {
  assert.ok(STATUSES.some((s) => s.key === 'pending_head'));
  assert.ok(TRANSITIONS.pending_hr.some((t) => t.to === 'pending_head'));
  assert.ok(TRANSITIONS.pending_head.some((t) => t.to === 'pending_management'));
});

/*
 * Skippable on purpose. Not every seat needs the head's eye, and a step that
 * cannot be skipped is a step somebody routes around by approving early.
 */
test('HR can still go straight to management', () => {
  assert.ok(TRANSITIONS.pending_hr.some((t) => t.to === 'pending_management'));
});

test('the head can send it back to HR', () => {
  assert.ok(TRANSITIONS.pending_head.some((t) => t.to === 'pending_hr'));
});

/* Approving is still an admin's, at every stage. The step adds no new power. */
test('the head step does not let a writer approve', () => {
  const writer = movesFrom('pending_head', ['read', 'write']);
  assert.ok(!writer.some((m) => ['approved', 'rejected'].includes(m.to)));
  const admin = movesFrom('pending_head', ['read', 'write', 'admin']);
  assert.ok(admin.some((m) => m.to === 'approved'));
});

test('sending to the head asks for a name', () => {
  const move = TRANSITIONS.pending_hr.find((t) => t.to === 'pending_head');
  assert.equal(move.asks, 'head');
});

/* ---------------- against a real server ---------------- */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-flow-'));
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
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
};

const made = {};

test('set up: a published opening and a screened-in candidate', async () => {
  await api('POST', '/api/companies', { name: 'BOOKNFLY PVT LTD' });
  const companyId = (await api('GET', '/api/companies')).body.companies[0].id;
  const v = await api('POST', '/api/hiring/vacancies', {
    company_id: companyId, title: 'Accounts Executive', openings: 1, status: 'published',
  });
  made.vacancy = v.body.vacancy?.id ?? v.body.id;

  const c = await api('POST', '/api/hiring/candidates', {
    name: 'Sanjay Mehta', phone: '9898011223',
  });
  made.candidate = c.body.candidate?.id ?? c.body.id;

  const a = await api('POST', '/api/hiring/applications', {
    vacancy_id: made.vacancy, candidate_id: made.candidate,
  });
  made.application = a.body.application?.id ?? a.body.id;

  const s = await api('PUT', `/api/hiring/applications/${made.application}/screening`, {
    verdict: 'Eligible',
  });
  assert.equal(s.status, 200);
});

/*
 * Step 4 had no list. Marking somebody Eligible took them off the screening
 * queue and out of sight, so "send the eligible ones a test" meant hunting
 * for them one at a time under Candidates.
 */
test('screened Eligible puts them on the ready-for-the-test list', async () => {
  const { body } = await api('GET', '/api/hiring/screening/awaiting-test');
  assert.equal(body.rows.length, 1);
  assert.equal(body.rows[0].name, 'Sanjay Mehta');
});

/*
 * Sending the paper does NOT take them off the list.
 *
 * The first version dropped them, and Dinesh found it within the hour:
 * *"tets ka link kaha se milega"*. Dropping the row took the link with it,
 * which is the same disappearing act one step later — and a link nobody can
 * find again is a link that gets re-drawn, which lets somebody read the
 * questions, close it and sit a fresh paper.
 */
test('sending the paper moves them along the list, it does not remove them', async () => {
  await api('POST', '/api/hiring/bank/starter', { position: 'Accounts' });
  const paper = (await api('GET', '/api/hiring/papers')).body.papers.find(
    (p) => p.name === 'Accounts test'
  );
  const asg = await api('POST', `/api/hiring/papers/${paper.id}/assign`, {
    candidate_id: made.candidate, application_id: made.application,
  });
  assert.equal(asg.status, 201);

  const { body } = await api('GET', '/api/hiring/screening/awaiting-test');
  const row = body.rows.find((r) => r.candidate_id === made.candidate);
  assert.ok(row, 'they fell off the list and the link went with them');
  assert.equal(row.state, 'sent');
  assert.equal(row.attempt.token, asg.body.attempt.token, 'a different link — a second paper');
});

test('somebody turned down is not on that list', async () => {
  const c = await api('POST', '/api/hiring/candidates', { name: 'Asha Patel', phone: '9898044556' });
  const a = await api('POST', '/api/hiring/applications', {
    vacancy_id: made.vacancy, candidate_id: c.body.candidate?.id ?? c.body.id,
  });
  await api('PUT', `/api/hiring/applications/${a.body.application?.id ?? a.body.id}/screening`, {
    verdict: 'Rejected', reason: 'Not enough experience',
  });
  const { body } = await api('GET', '/api/hiring/screening/awaiting-test');
  assert.ok(!body.rows.some((r) => r.name === 'Asha Patel'));
});

/* The panel was a column nothing ever wrote to. */
test('an interview records the panel as well as the interviewer', async () => {
  const iv = await api('POST', '/api/hiring/interviews', {
    application_id: made.application, at: '2026-11-20T11:00', round: 1,
    interviewer: 'Priya Nair', panel: 'Rakesh Shah, Meena Joshi',
  });
  made.interview = iv.body.interview?.id ?? iv.body.id;
  assert.equal(iv.body.interview.panel, 'Rakesh Shah, Meena Joshi');

  const patched = await api('PATCH', `/api/hiring/interviews/${made.interview}`, {
    panel: 'Rakesh Shah',
  });
  assert.equal(patched.body.panel, 'Rakesh Shah');
  assert.equal(patched.body.interviewer, 'Priya Nair', 'the lead was lost');
});

test('the paperwork goes HR → head → management, and the head is named', async () => {
  await api('PUT', `/api/hiring/interviews/${made.interview}/evaluation`, {
    evaluated_by: 'Priya Nair', ratings: { attitude: 5 },
    recommendation: 'Recommended', next_action: 'Final Selection',
  });
  const ev = (await api('GET', `/api/hiring/interviews/${made.interview}/evaluation`)).body
    .evaluation;
  const move = (to, extra = {}) =>
    api('POST', `/api/hiring/evaluations/${ev.id}/review`, { to, ...extra });

  assert.equal((await move('submitted')).status, 200);
  assert.equal((await move('pending_hr')).status, 200);

  /* No name, no step: "who was it with" must always have an answer. */
  const bare = await move('pending_head');
  assert.equal(bare.status, 400);
  assert.match(bare.body.error, /department head/i);

  const sent = await move('pending_head', { head_name: 'Rakesh Shah (Accounts)' });
  assert.equal(sent.body.evaluation.head_name, 'Rakesh Shah (Accounts)');
  assert.equal(sent.body.evaluation.head_reviewed_at, null, 'stamped before they looked at it');

  const on = await move('pending_management');
  assert.ok(on.body.evaluation.head_reviewed_at, 'the head’s step was never closed');
  /* Their own two columns: reviewed_by can only hold whoever touched it last. */
  assert.equal(on.body.evaluation.head_name, 'Rakesh Shah (Accounts)');
});

/*
 * Step 10. People landed on the payroll with the code field empty, and it was
 * found weeks later.
 */
test('hiring generates an employee code, and shows it first', async () => {
  await api('PATCH', `/api/hiring/applications/${made.application}`, {
    offer_salary: 27000, joining_date: '2026-12-01',
  });

  const suggested = await api('GET', `/api/hiring/applications/${made.application}/hire`);
  assert.equal(suggested.body.code, 'BPL-001');

  const hired = await api('POST', `/api/hiring/applications/${made.application}/hire`, {});
  assert.equal(hired.status, 201);
  assert.equal(hired.body.employee.code, 'BPL-001');
});

test('a code typed on the form wins over the suggestion', async () => {
  const c = await api('POST', '/api/hiring/candidates', { name: 'Kiran Rao', phone: '9898077889' });
  const a = await api('POST', '/api/hiring/applications', {
    vacancy_id: made.vacancy, candidate_id: c.body.candidate?.id ?? c.body.id,
  });
  const id = a.body.application?.id ?? a.body.id;
  await api('PATCH', `/api/hiring/applications/${id}`, { offer_salary: 21000 });

  /* And the suggestion has moved on, because 001 is taken. */
  assert.equal((await api('GET', `/api/hiring/applications/${id}/hire`)).body.code, 'BPL-002');

  const hired = await api('POST', `/api/hiring/applications/${id}/hire`, { code: 'ACC/09' });
  assert.equal(hired.body.employee.code, 'ACC/09');
});

/*
 * Dinesh, looking at the tab strip: *"candidate k bad screning aayega na"*.
 *
 * Screening sat third - before the opening existed and before anybody had
 * applied. A row of tabs reads as a sequence whether or not it is meant as
 * one, and a sequence that contradicts the real flow teaches the wrong thing
 * on somebody's first day.
 */
test('the hiring tabs run in the order the work happens', () => {
  const file = fs.readFileSync(
    new URL('../../frontend/src/components/hiring/Hiring.jsx', import.meta.url),
    'utf8'
  );
  const block = file.slice(file.indexOf('const VIEWS = ['), file.indexOf('];', file.indexOf('const VIEWS = [')));
  const order = [...block.matchAll(/\['([a-z]+)',/g)].map((m) => m[1]);

  assert.deepEqual(order, [
    'overview',
    'pipeline',
    'openings',
    'candidates',
    /* The question bank folded in here — he asked for the test to live
     * inside screening rather than beside it. */
    'screening',
    'interviews',
    'reports',
    'tasks',
  ]);

  /* The ones his own flow numbers, in his own order. */
  const step = (k) => order.indexOf(k);
  assert.ok(step('openings') < step('candidates'), 'the opening comes before the applicants');
  assert.ok(step('candidates') < step('screening'), 'screening comes after the candidate');
  assert.ok(step('screening') < step('interviews'), 'the interview comes after screening');
  assert.equal(step('tests'), -1, 'the test is inside screening, not a tab of its own');
});

test('the on-screen flow points the test step at the list that now exists', () => {
  const steps = fs.readFileSync(new URL('../../shared/hiringSteps.js', import.meta.url), 'utf8');
  assert.match(steps, /ready for the test/);
  assert.match(steps, /department head/i, 'step 7 does not mention the head');
});

/*
 * Dinesh, an hour after the list shipped: *"tets ka link kaha se milega"*.
 *
 * The first version listed only people with NO test yet — "sent is sent"
 * sounded tidy. Sending the paper took the person off the list AND TOOK THE
 * LINK WITH THEM, which is the same disappearing act one step later. A link
 * that cannot be found again is a link that gets re-drawn, and a second paper
 * lets somebody read the questions, close it and sit a fresh one.
 */
test('the link is still reachable after they have sat it', async () => {
  const c = await api('POST', '/api/hiring/candidates', { name: 'Neha Desai', phone: '9898010001' });
  const a = await api('POST', '/api/hiring/applications', {
    vacancy_id: made.vacancy, candidate_id: c.body.candidate?.id ?? c.body.id,
  });
  const appId = a.body.application?.id ?? a.body.id;
  await api('PUT', `/api/hiring/applications/${appId}/screening`, { verdict: 'Eligible' });

  const paper = (await api('GET', '/api/hiring/papers')).body.papers.find(
    (p) => p.name === 'Accounts test'
  );
  const asg = await api('POST', `/api/hiring/papers/${paper.id}/assign`, {
    candidate_id: c.body.candidate?.id ?? c.body.id, application_id: appId,
  });

  let row = (await api('GET', '/api/hiring/screening/awaiting-test')).body.rows.find(
    (r) => r.application_id === appId
  );
  assert.equal(row.state, 'sent');
  assert.ok(row.attempt.token);

  /* Sit it, and the row stays — now carrying the score instead of the link. */
  const answers = {};
  asg.body.attempt.drawn.forEach((q, i) => {
    if (i < 10) answers[q.id] = q.correct;
  });
  await fetch(`${base}/api/public/sit/${asg.body.attempt.token}`);
  await api('POST', `/api/public/sit/${asg.body.attempt.token}`, { answers });

  row = (await api('GET', '/api/hiring/screening/awaiting-test')).body.rows.find(
    (r) => r.application_id === appId
  );
  assert.equal(row.state, 'sat');
  assert.equal(row.attempt.percentage, 50);
});

test('a state is one of three, and only a sat test carries a score', async () => {
  const { body } = await api('GET', '/api/hiring/screening/awaiting-test');
  for (const row of body.rows) {
    assert.ok(['not_sent', 'sent', 'sat'].includes(row.state), row.state);
    if (row.state === 'not_sent') assert.equal(row.attempt, null);
    if (row.state === 'sent') assert.equal(row.attempt.submitted_at, null);
    if (row.state === 'sat') assert.ok(row.attempt.submitted_at);
  }
});

/* A list drawing twenty rows has no use for four hundred questions and their key. */
test('the list carries no questions and no answer key', async () => {
  const res = await fetch(`${base}/api/hiring/screening/awaiting-test`);
  const text = await res.text();
  assert.ok(!/"drawn"/.test(text), 'the questions travelled with the list');
  assert.ok(!/"correct"/.test(text), 'the answer key travelled with the list');
});

/* ---------------- one question at a time ---------------- */

/*
 * Dinesh, having sat the test himself: *"test ese nahi / ek bar me ek question
 * hi dikega / uska time khatm hone k bad turant dusra question aa jeyaga"*,
 * and then *"zynta me esa hi he"* — his own test system already works this
 * way.
 *
 * It is a per-PAPER setting, never an app-wide switch: a paper somebody is
 * halfway through must not change shape underneath them.
 */
test('the mode is off by default, so no existing paper changes', async () => {
  const made = await api('PUT', '/api/hiring/papers', {
    name: 'Plain paper', pass_percent: 50, duration_minutes: 20,
    sections: [{ category: 'Accounts', count: 3 }],
  });
  assert.equal(made.body.one_at_a_time, 0);
});

test('a paper can be put one question at a time, with its own seconds', async () => {
  const made = await api('PUT', '/api/hiring/papers', {
    name: 'Timed paper', pass_percent: 50, duration_minutes: 10,
    one_at_a_time: 1, seconds_per_question: 30,
    sections: [{ category: 'Accounts', count: 5 }],
  });
  assert.equal(made.body.one_at_a_time, 1);
  assert.equal(made.body.seconds_per_question, 30);
});

test('the candidate’s page is told the mode, and still never the answers', async () => {
  const c = await api('POST', '/api/hiring/candidates', { name: 'Vikas Jain', phone: '9898022334' });
  const cid = c.body.candidate?.id ?? c.body.id;
  const a = await api('POST', '/api/hiring/applications', {
    vacancy_id: made.vacancy, candidate_id: cid,
  });
  const paper = (await api('GET', '/api/hiring/papers')).body.papers.find(
    (p) => p.name === 'Timed paper'
  );
  const asg = await api('POST', `/api/hiring/papers/${paper.id}/assign`, {
    candidate_id: cid, application_id: a.body.application?.id ?? a.body.id,
  });

  /*
   * The start screen is told the SHAPE of the test but not its contents, so
   * somebody can choose their moment without spending it.
   */
  const peek = JSON.parse(await (await fetch(`${base}/api/public/sit/${asg.body.attempt.token}`)).text());
  assert.equal(peek.one_at_a_time, true);
  assert.equal(peek.seconds_per_question, 30);
  assert.equal(peek.question_count, 5);
  assert.equal(peek.questions, undefined, 'the questions arrived before they started');

  /* Starting hands them over — and still never the answers. */
  const res = await fetch(`${base}/api/public/sit/${asg.body.attempt.token}/start`, {
    method: 'POST',
  });
  const text = await res.text();
  const open = JSON.parse(text);

  assert.equal(open.one_at_a_time, true);
  assert.equal(open.seconds_per_question, 30);
  assert.ok(!/"correct"/.test(text), 'the answer key reached the candidate');
  /* All the questions travel at once — the browser paces them. The SERVER's
   * total is what is actually enforced, and saying so is the point. */
  assert.equal(open.questions.length, 5);
  assert.ok(open.seconds_left > 0);
});

test('a paper with no seconds set falls back to its total divided by the questions', async () => {
  const made = await api('PUT', '/api/hiring/papers', {
    name: 'No seconds', pass_percent: 50, duration_minutes: 10,
    one_at_a_time: 1,
    sections: [{ category: 'Accounts', count: 5 }],
  });
  const c = await api('POST', '/api/hiring/candidates', { name: 'Anita Rao', phone: '9898022998' });
  const cid = c.body.candidate?.id ?? c.body.id;
  const a = await api('POST', '/api/hiring/applications', {
    vacancy_id: made.vacancy ?? undefined, candidate_id: cid,
  });
  const app = a.body.application?.id ?? a.body.id;
  const asg = await api('POST', `/api/hiring/papers/${made.body.id}/assign`, {
    candidate_id: cid, application_id: app,
  });
  const open = (await api('POST', `/api/public/sit/${asg.body.attempt.token}` + '/start', {})).body;
  assert.equal(open.seconds_per_question, 120, '10 minutes over 5 questions');
});

/* The one he asked for from the start: twenty questions, thirty seconds each. */
test('the starter paper is one at a time at thirty seconds', async () => {
  const paper = (await api('GET', '/api/hiring/papers')).body.papers.find(
    (p) => p.name === 'Accounts test'
  );
  assert.equal(paper.one_at_a_time, 1);
  assert.equal(paper.seconds_per_question, 30);
  assert.equal(paper.duration_minutes, 10);
});

/*
 * Dinesh opened his own test link to look at it, went off to do something
 * else, came back and found: *"directly this coming"* — "the time ran out, so
 * your answers were sent automatically".
 *
 * The clock started the moment the link was OPENED. A candidate tapping it on
 * a bus to see what it is would lose their one attempt exactly the same way.
 */
test('opening the link does not start the clock, and sends no questions', async () => {
  const c = await api('POST', '/api/hiring/candidates', { name: 'Imran Shaikh', phone: '9898033445' });
  const cid = c.body.candidate?.id ?? c.body.id;
  const a = await api('POST', '/api/hiring/applications', {
    vacancy_id: made.vacancy, candidate_id: cid,
  });
  const paper = (await api('GET', '/api/hiring/papers')).body.papers.find(
    (p) => p.name === 'Accounts test'
  );
  const asg = await api('POST', `/api/hiring/papers/${paper.id}/assign`, {
    candidate_id: cid, application_id: a.body.application?.id ?? a.body.id,
  });
  made.peek = asg.body.attempt.token;

  const res = await fetch(`${base}/api/public/sit/${made.peek}`);
  const text = await res.text();
  const open = JSON.parse(text);

  assert.equal(open.started, false);
  assert.equal(open.questions, undefined, 'the questions were handed over before they started');
  assert.equal(open.seconds_left, undefined, 'there is a clock before they started');
  /* And nothing to read ahead of time. */
  assert.ok(!/"option_/.test(text));
  assert.ok(!/"correct"/.test(text));

  /* It says what the test IS, so they can choose their moment. */
  assert.equal(open.question_count, 20);
  assert.equal(open.duration_minutes, 10);
  assert.equal(open.one_at_a_time, true);
});

test('looking at it twice still does not start it', async () => {
  await fetch(`${base}/api/public/sit/${made.peek}`);
  const again = (await api('GET', `/api/public/sit/${made.peek}`)).body;
  assert.equal(again.started, false);
});

test('starting is what begins the clock and hands the questions over', async () => {
  const out = (await api('POST', `/api/public/sit/${made.peek}/start`, {})).body;
  assert.equal(out.started, true);
  assert.equal(out.questions.length, 20);
  assert.ok(out.seconds_left > 0);
});

/* A refresh is not a second chance — the clock does not go back up. */
test('starting twice does not restart the clock', async () => {
  const first = (await api('POST', `/api/public/sit/${made.peek}/start`, {})).body;
  await new Promise((r) => setTimeout(r, 1100));
  const second = (await api('POST', `/api/public/sit/${made.peek}/start`, {})).body;
  assert.ok(second.seconds_left <= first.seconds_left, 'the clock went back up');
  assert.equal(second.started_at, first.started_at);
});

/*
 * Dinesh, after the one-at-a-time mode shipped: *"again same"*, *"all
 * question at once"*.
 *
 * His "Accounts test" had been made on an older version, so it carried the
 * old all-on-one-page shape and the old wording — and the loader, being
 * careful, reported "already there" and changed nothing. There was no way to
 * the new mode short of editing the paper by hand, which is not a thing
 * anybody finds.
 */
test('a starter paper nobody has sat is brought up to date', async () => {
  /* A seat nothing in this file has given out, so nobody has sat its paper. */
  await api('POST', '/api/hiring/bank/starter', { position: 'Travel Consultant' });
  const before = (await api('GET', '/api/hiring/papers')).body.papers.find(
    (p) => p.name === 'Travel Consultant test'
  );
  assert.equal(before.attempts, 0);

  /* Put it back the way his was. */
  await api('PUT', '/api/hiring/papers', {
    ...before, one_at_a_time: 0, seconds_per_question: null,
    instructions: 'The clock is on the whole paper.',
  });

  const out = await api('POST', '/api/hiring/bank/starter', { position: 'Travel Consultant' });
  assert.equal(out.body.paper_updated, true);

  const after = (await api('GET', '/api/hiring/papers')).body.papers.find(
    (p) => p.name === 'Travel Consultant test'
  );
  assert.equal(after.one_at_a_time, 1);
  assert.equal(after.seconds_per_question, 30);
  assert.ok(!/whole paper/.test(after.instructions), 'the old wording stayed');
  /* Its sections are left exactly alone, in case they were tuned. */
  assert.deepEqual(
    after.sections.map((s) => `${s.count}×${s.category}`),
    before.sections.map((s) => `${s.count}×${s.category}`)
  );
});

/*
 * Once somebody has sat it, nothing moves. A paper taken under one set of
 * rules has to keep them, or the answer sheet and the test stop describing
 * the same thing.
 */
test('a paper somebody has sat keeps its shape', async () => {
  const paper = (await api('GET', '/api/hiring/papers')).body.papers.find(
    (p) => p.name === 'Accounts test'
  );
  const c = await api('POST', '/api/hiring/candidates', { name: 'Sat It', phone: '9898044001' });
  const cid = c.body.candidate?.id ?? c.body.id;
  const a = await api('POST', '/api/hiring/applications', {
    vacancy_id: made.vacancy, candidate_id: cid,
  });
  const asg = await api('POST', `/api/hiring/papers/${paper.id}/assign`, {
    candidate_id: cid, application_id: a.body.application?.id ?? a.body.id,
  });
  await api('POST', `/api/public/sit/${asg.body.attempt.token}/start`, {});

  await api('PUT', '/api/hiring/papers', { ...paper, one_at_a_time: 0 });
  const out = await api('POST', '/api/hiring/bank/starter', { position: 'Accounts' });
  assert.equal(out.body.paper_updated, false);

  const after = (await api('GET', '/api/hiring/papers')).body.papers.find(
    (p) => p.name === 'Accounts test'
  );
  assert.equal(after.one_at_a_time, 0, 'a paper already sat was changed underneath it');
});

/* And the way a paper is put to people is ON THE LIST, not only inside Edit. */
test('the papers list says how each one is put', () => {
  const bank = fs.readFileSync(
    new URL('../../frontend/src/components/hiring/QuestionBank.jsx', import.meta.url),
    'utf8'
  );
  assert.match(bank, /How it is put/);
  assert.match(bank, /One at a time ·/);
  assert.match(bank, /All on one page/);
  /* Switching is refused on a paper somebody has sat. */
  assert.match(bank, /disabled=\{!!p\.attempts\}/);
});

/* ---------------- how a test was sat ---------------- */

/*
 * Dinesh sent four screenshots of his ZYNTA test and said "see the zynta
 * model": a bar draining for THIS question, the topic above it, a Next
 * button, how far through along the bottom, and on the results side
 * "avg 10s/Q", "2x left the test", "1 question unanswered / timed out",
 * "11 answers under 2s", or "Clean".
 *
 * Every one of those is a FLAG, never a verdict. A fast answer can be a
 * known answer and a phone rings; the office reads them beside the score.
 */
test('the topic rides to the candidate, the answer never does', async () => {
  const c = await api('POST', '/api/hiring/candidates', { name: 'Topic Test', phone: '9898055001' });
  const cid = c.body.candidate?.id ?? c.body.id;
  const a = await api('POST', '/api/hiring/applications', {
    vacancy_id: made.vacancy, candidate_id: cid,
  });
  const paper = (await api('GET', '/api/hiring/papers')).body.papers.find(
    (p) => p.name === 'Accounts test'
  );
  const asg = await api('POST', `/api/hiring/papers/${paper.id}/assign`, {
    candidate_id: cid, application_id: a.body.application?.id ?? a.body.id,
  });
  made.how = asg.body.attempt.token;
  made.howId = asg.body.attempt.id;

  const res = await fetch(`${base}/api/public/sit/${made.how}/start`, { method: 'POST' });
  const text = await res.text();
  const open = JSON.parse(text);

  assert.ok(open.questions.every((q) => q.category), 'no topic to show above the question');
  assert.ok(!/"correct"/.test(text), 'the answer key reached the candidate');
  assert.ok(!/"marks"/.test(text));
});

test('how long each question took, and how often they left, are recorded', async () => {
  const open = (await api('GET', `/api/public/sit/${made.how}`)).body;
  const answers = {};
  const times = {};
  open.questions.forEach((q, i) => {
    answers[q.id] = q.options[0].key;
    times[q.id] = i < 4 ? 1 : 12; // four of them answered in a second
  });
  const out = await api('POST', `/api/public/sit/${made.how}`, {
    answers, times, left_count: 3,
  });
  assert.equal(out.status, 200);

  /* The attempt this test made, by id — never a fallback to another one. */
  const review = (await api('GET', `/api/hiring/attempts/${made.howId}`)).body;
  assert.equal(review.attempt.left_count, 3, 'leaving the page was not recorded');
  assert.equal(Object.keys(review.attempt.times).length, 20, 'the timings were not recorded');
});

test('the flags read as flags, and a clean paper says so', () => {
  const q = (id) => ({ id, question: `q${id}`, option_a: 'x', option_b: 'y', correct: 'b', marks: 1 });

  const clean = integrity({
    drawn: [q(1), q(2)], answers: { 1: 'b', 2: 'a' }, times: { 1: 11, 2: 9 }, left_count: 0,
  });
  assert.deepEqual(clean.flags, []);
  assert.equal(clean.avg_seconds, 10);
  assert.equal(clean.known, true);

  const messy = integrity({
    drawn: [q(1), q(2), q(3)], answers: { 1: 'b', 2: 'b' }, times: { 1: 1, 2: 14 }, left_count: 2,
  });
  assert.match(messy.flags.join(' '), /2× left the test page/);
  assert.match(messy.flags.join(' '), /1 question unanswered or timed out/);
  assert.match(messy.flags.join(' '), /1 answer under 2s/);
});

/*
 * An attempt sat before any of this was recorded has nothing to be clean
 * about. A reassuring tick nobody earned is worse than saying so.
 */
test('a paper sat before the timings existed is not called clean', () => {
  const old = integrity({
    drawn: [{ id: 1, question: 'q', option_a: 'x', option_b: 'y', correct: 'b', marks: 1 }],
    answers: { 1: 'b' },
  });
  assert.equal(old.known, false);
  assert.equal(old.avg_seconds, null);
});

/* The version, readable without signing in — three afternoons went on this. */
test('/healthz says which build is running', async () => {
  const res = await fetch(`${base}/healthz`);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.match(body.version, /^\d+\.\d+\.\d+$/);
});
