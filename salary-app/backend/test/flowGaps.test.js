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

test('once a paper is sent they drop off it', async () => {
  await api('POST', '/api/hiring/bank/starter', { position: 'Accounts' });
  const paper = (await api('GET', '/api/hiring/papers')).body.papers.find(
    (p) => p.name === 'Accounts test'
  );
  const asg = await api('POST', `/api/hiring/papers/${paper.id}/assign`, {
    candidate_id: made.candidate, application_id: made.application,
  });
  assert.equal(asg.status, 201);

  const { body } = await api('GET', '/api/hiring/screening/awaiting-test');
  assert.equal(body.rows.length, 0, 'sent is sent — chasing is the candidate’s own row');
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
