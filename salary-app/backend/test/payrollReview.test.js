import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { payrollExceptions, exceptionSummary } from '../../shared/payrollExceptions.js';
import { payrollStage } from '../../shared/payrollStages.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-review-'));
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

let period;
let company;
let riya;
test.before(async () => {
  company = (await api('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  period = (await api('POST', '/api/periods', { year: 2026, month: 11, label: 'November 2026' })).body;
  riya = (await api('POST', '/api/employees', {
    company_id: company.id, name: 'Riya Pal', monthly_salary: 22000,
  })).body;
  await api('POST', '/api/employees', { company_id: company.id, name: 'No Salary', monthly_salary: 0 });
  await api('GET', `/api/periods/${period.id}/payroll`);
});

/* ---------------- the rule the whole thing rests on ---------------- */

test('THE EXCEPTION REPORT CHANGES NOTHING', async () => {
  /*
   * His brief says it twice. So: read the month, read it again after the
   * review has run, and every figure must be identical - and the review
   * itself must not create, delete or edit a single row.
   */
  const before = (await api('GET', `/api/periods/${period.id}/payroll`)).body;
  await api('GET', `/api/periods/${period.id}/review?today=2026-11-20`);
  const after = (await api('GET', `/api/periods/${period.id}/payroll`)).body;

  assert.equal(after.rows.length, before.rows.length);
  for (let i = 0; i < before.rows.length; i += 1) {
    for (const field of ['salary', 'gross_salary', 'net_salary', 'pt', 'esi', 'pf', 'absent_days', 'present_days']) {
      assert.equal(after.rows[i][field], before.rows[i][field], `${field} moved on row ${i}`);
    }
  }
  assert.deepEqual(after.totals, before.totals, 'the month’s totals must be untouched');

  /* And the module itself has no write in it. */
  const src = fs.readFileSync(new URL('../../shared/payrollExceptions.js', import.meta.url), 'utf8');
  assert.ok(!/UPDATE |INSERT |DELETE /i.test(src));
});

test('the flags name the person, the figure and what to check', () => {
  const rows = [
    {
      row: { id: 1, employee_id: 1, employee_name: 'Dinesh Parmar', company_name: 'BNF', salary: 0, status: 'pending' },
      calc: { per_day: 0, net_salary: 0, working_days: 26, absent_days: 0, gross_salary: 0 },
      employee: {},
    },
  ];
  const [first] = payrollExceptions(rows, { period: { year: 2026, month: 11 } });
  assert.equal(first.name, 'Dinesh Parmar');
  assert.equal(first.code, 'no_salary');
  /* THREE LEVELS NOW, and only `critical` blocks the payroll. No salary on a
     row is money that is missing, so it is the loudest of the three. */
  assert.equal(first.severity, 'critical');
  assert.match(first.detail, /check the employee master/i);
});

test('a nought is flagged, never corrected - and “paid” needs something behind it', () => {
  const rows = [
    {
      row: { employee_id: 2, employee_name: 'Zero Net', salary: 20000, status: 'paid' },
      calc: { per_day: 769, net_salary: 0, working_days: 26, absent_days: 0, gross_salary: 0 },
      employee: {},
    },
  ];
  const codes = payrollExceptions(rows, { period: {} }).map((e) => e.code);
  assert.ok(codes.includes('zero_net'));
  /* Marked paid with no mode, no date and no reference. */
  assert.ok(codes.includes('paid_without_details'));
});

test('absent days cannot exceed the month, and a negative net is serious', () => {
  const rows = [
    {
      row: { employee_id: 3, employee_name: 'Over Absent', salary: 20000 },
      calc: { per_day: 769, net_salary: -500, working_days: 26, absent_days: 31, gross_salary: 0 },
      employee: {},
    },
  ];
  const list = payrollExceptions(rows, { period: {} });
  const by = Object.fromEntries(list.map((e) => [e.code, e]));
  assert.ok(by.absent_over_days);
  assert.equal(by.negative_net.severity, 'critical');
  /* And the large deduction is NOT listed beside it: a net below nought IS
     the deduction being bigger than the gross, and saying both reads as two
     problems where there is one. */
  assert.ok(!by.big_deduction, 'the symptom is dropped when its cause is listed');
});

test('the same name twice on one company is flagged ONCE, not per row', () => {
  /*
   * The database cannot stop it - the unique key is employee + month, so
   * two employee records with one name are two legal rows and two salaries.
   */
  const one = (id) => ({
    row: { employee_id: id, employee_name: 'Amit Shah', company_name: 'BNF', salary: 20000 },
    calc: { per_day: 769, net_salary: 19800, working_days: 26, absent_days: 0, gross_salary: 20000 },
    employee: {},
  });
  const list = payrollExceptions([one(1), one(2)], { period: {} });
  assert.equal(list.filter((e) => e.code === 'duplicate_person').length, 1);
});

/* ---------------- the decision about a flag ---------------- */

test('a flag can be ignored with a reason, and the reason is kept', async () => {
  const { body } = await api('GET', `/api/periods/${period.id}/review`);
  const flag = body.exceptions.find((e) => e.code === 'no_salary');
  assert.ok(flag, 'the zero-salary row should be flagged');
  assert.equal(flag.state, 'open');

  await api('PUT', `/api/periods/${period.id}/review`, {
    employee_id: flag.employee_id, code: 'no_salary', state: 'ignored', remark: 'director, takes none',
  });

  const after = (await api('GET', `/api/periods/${period.id}/review`)).body;
  const again = after.exceptions.find((e) => e.code === 'no_salary');
  assert.equal(again.state, 'ignored');
  assert.equal(again.remark, 'director, takes none');
  assert.ok(again.reviewed_by, 'who said so');

  // A state nobody has heard of is refused.
  const bad = await api('PUT', `/api/periods/${period.id}/review`, {
    employee_id: flag.employee_id, code: 'no_salary', state: 'sorted',
  });
  assert.equal(bad.status, 400);
});

test('the flags are worked out fresh, so a corrected figure stops being flagged', async () => {
  const before = (await api('GET', `/api/periods/${period.id}/review`)).body;
  const flagged = before.exceptions.filter((e) => e.code === 'no_salary');
  assert.equal(flagged.length, 1);

  const rows = (await api('GET', `/api/periods/${period.id}/payroll`)).body.rows;
  const zero = rows.find((r) => r.employee_name === 'No Salary');
  await api('PATCH', `/api/periods/${period.id}/rows/${zero.id}`, { salary: 15000 });

  const after = (await api('GET', `/api/periods/${period.id}/review`)).body;
  assert.equal(after.exceptions.filter((e) => e.code === 'no_salary').length, 0);
});

/* ---------------- the five stages ---------------- */

test('the first three stages are observations; the last two are DECISIONS', () => {
  const rows = [{ attendance: { 1: 'P' } }];
  /* Attendance in, rows calculated, nothing serious open - and still nobody
     has approved anything. An app that slid from one to the other would be
     approving payroll on the office's behalf. */
  const clean = payrollStage({ period: {}, rows, exceptions: [] });
  assert.equal(clean.stages[0].done, true);
  assert.equal(clean.stages[1].done, true);
  assert.equal(clean.stages[2].done, true);
  assert.equal(clean.stages[3].done, false, 'approval is a decision');
  assert.equal(clean.stages[4].done, false, 'so is locking');
  assert.equal(clean.at, 'approved');

  const approved = payrollStage({
    period: { approved_at: '2026-11-30', approved_by: 'Dinesh', locked: 1, locked_by: 'Dinesh' },
    rows,
    exceptions: [],
  });
  assert.equal(approved.stages[3].done, true);
  assert.equal(approved.stages[4].done, true);
});

test('only a CRITICAL flag stands in the way of approval', () => {
  const rows = [{ attendance: { 1: 'P' } }];
  const noisy = payrollStage({
    period: {}, rows,
    exceptions: [{ severity: 'warning', state: 'open' }, { severity: 'info', state: 'open' }],
  });
  assert.equal(noisy.blocking.length, 0, 'a warning and a status are not blockers');
  assert.match(noisy.stages[2].why, /none critical/);

  const serious = payrollStage({
    period: {}, rows, exceptions: [{ severity: 'critical', state: 'open' }],
  });
  assert.equal(serious.blocking.length, 1);
  // …and an ignored one has been dealt with.
  const dealt = payrollStage({
    period: {}, rows, exceptions: [{ severity: 'critical', state: 'ignored' }],
  });
  assert.equal(dealt.blocking.length, 0);
});

/* ---------------- approving and locking ---------------- */

test('a month cannot be locked before it is approved, and reopening needs a reason', async () => {
  const early = await api('POST', `/api/periods/${period.id}/lock`, {});
  assert.equal(early.status, 409);
  assert.match(early.body.error, /approved/);

  const approved = (await api('POST', `/api/periods/${period.id}/approve`, { note: 'checked' })).body;
  assert.ok(approved.approved_by);
  assert.ok(approved.approved_at);
  assert.equal(approved.locked, 0, 'approving is not paying');

  const locked = (await api('POST', `/api/periods/${period.id}/lock`, {})).body;
  assert.equal(locked.locked, 1);
  assert.ok(locked.locked_by);

  /* A locked month is still locked against edits, exactly as before. */
  const rows = (await api('GET', `/api/periods/${period.id}/payroll`)).body.rows;
  const refused = await api('PATCH', `/api/periods/${period.id}/rows/${rows[0].id}`, { salary: 1 });
  assert.equal(refused.status, 409);

  assert.equal((await api('POST', `/api/periods/${period.id}/lock`, { open: true })).status, 400);
  const open = (await api('POST', `/api/periods/${period.id}/lock`, { open: true, reason: 'OT missed' })).body;
  assert.equal(open.locked, 0);
  assert.equal(open.reopen_reason, 'OT missed');

  /* Approving, locking and reopening are all on the trail with the reason. */
  const { entries } = (await api('GET', `/api/people/audit?entity=periods&entity_id=${period.id}`)).body;
  assert.ok(entries.some((e) => e.action === 'approved'));
  assert.ok(entries.some((e) => e.action === 'locked'));
  assert.ok(entries.some((e) => e.note === 'OT missed'));
});

test('approving is refused while a CRITICAL flag is open', async () => {
  const other = (await api('POST', '/api/periods', { year: 2026, month: 12, label: 'December 2026' })).body;
  await api('POST', '/api/employees', { company_id: company.id, name: 'Another Zero', monthly_salary: 0 });
  await api('GET', `/api/periods/${other.id}/payroll`);

  const refused = await api('POST', `/api/periods/${other.id}/approve`, {});
  assert.equal(refused.status, 409);
  assert.ok(refused.body.blocking.length >= 1);
  /* And it says there IS a way past, rather than leaving somebody stuck on a
     flag that is correct - a director really does take no salary. */
  assert.equal(refused.body.can_override, true);
  assert.match(refused.body.error, /approve anyway with a reason/);

  /* THE OVERRIDE NEEDS A REASON, AND IT IS NOT OPTIONAL. It used to be
     `anyway: true` with nothing else: no reason asked for, none recorded,
     and no button on the screen - so the only way past the block was an
     undocumented field, and the trail could not say why. */
  const bare = await api('POST', `/api/periods/${other.id}/approve`, { anyway: true });
  assert.equal(bare.status, 409, 'the old undocumented bypass does nothing');

  const thin = await api('POST', `/api/periods/${other.id}/approve`, { override_reason: 'ok' });
  assert.equal(thin.status, 400, 'one word is not a reason');

  const done = await api('POST', `/api/periods/${other.id}/approve`, {
    override_reason: 'Director takes no salary — confirmed with Dinesh',
  });
  assert.equal(done.status, 200);

  /* The override is its own line on the trail, naming who, why, and which
     people were open at the time. */
  const { entries } = (await api('GET', `/api/people/audit?entity=periods&entity_id=${other.id}`)).body;
  const over = entries.find((e) => e.action === 'overrode');
  assert.ok(over, 'approving over a critical flag is recorded as an override');
  assert.match(over.note, /Director takes no salary/);
  assert.match(over.note, /Another Zero|No salary set/i, 'and it names what was open');

  /* And the history route reads it back in order. */
  const { history } = (await api('GET', `/api/periods/${other.id}/approvals`)).body;
  assert.ok(history.some((h) => h.action === 'approved'));
  assert.ok(history.some((h) => h.action === 'overrode'));
});

test('a month with nothing critical open is approved with no reason at all', async () => {
  const clean = (await api('POST', '/api/periods', { year: 2027, month: 1, label: 'January 2027' })).body;
  await api('GET', `/api/periods/${clean.id}/payroll`);
  /* The zero-salary people are still on the books, so settle their flags the
     way the review screen does - ignored, with a reason. */
  const { exceptions } = (await api('GET', `/api/periods/${clean.id}/review`)).body;
  for (const flag of exceptions.filter((e) => e.severity === 'critical')) {
    await api('PUT', `/api/periods/${clean.id}/review`, {
      employee_id: flag.employee_id, code: flag.code, state: 'ignored',
      remark: 'takes no salary', by: 'Dinesh',
    });
  }
  const done = await api('POST', `/api/periods/${clean.id}/approve`, {});
  assert.equal(done.status, 200, 'nothing critical left, so nothing to explain');
});

/* ---------------- the statement ---------------- */

test('the statement is the sheet’s own figures, and carries their months', async () => {
  const sheet = (await api('GET', `/api/periods/${period.id}/payroll`)).body.rows
    .find((r) => r.employee_id === riya.id);
  const { body } = await api('GET', `/api/periods/${period.id}/statement/${riya.id}`);

  for (const field of ['gross_salary', 'net_salary', 'pt', 'esi', 'pf', 'per_day', 'present_days']) {
    assert.equal(body.row[field], sheet[field], `${field} must be the sheet's own`);
  }
  assert.ok(Array.isArray(body.payments));
  assert.ok(body.payments.some((p) => p.period_id === period.id));
});

test('the summary counts what is open, not what has been dealt with', () => {
  const list = [
    { severity: 'critical', state: 'open', employee_id: 1 },
    { severity: 'warning', state: 'ignored', employee_id: 2 },
    { severity: 'warning', state: 'open', employee_id: 1 },
    { severity: 'info', state: 'open', employee_id: null },
  ];
  const s = exceptionSummary(list);
  assert.equal(s.total, 4);
  assert.equal(s.open, 3);
  assert.equal(s.critical, 1);
  assert.equal(s.warning, 1);
  assert.equal(s.info, 1);
  assert.equal(s.ignored, 1);
  /* The three levels add up to what is open, so the chips and the headline
     figure can never disagree - which is how "4 Critical" appeared over a
     list naming two people. */
  assert.equal(s.critical + s.warning + s.info, s.open);
  assert.equal(s.people, 1, 'two flags on one person is one person, and the month belongs to nobody');
});

test('TAKING THE APPROVAL BACK CARRIES ITS REASON, and the browser sends one', async () => {
  const month = (await api('POST', '/api/periods', { year: 2027, month: 2, label: 'February 2027' })).body;
  await api('GET', `/api/periods/${month.id}/payroll`);
  const { exceptions } = (await api('GET', `/api/periods/${month.id}/review`)).body;
  for (const flag of exceptions.filter((e) => e.severity === 'critical')) {
    await api('PUT', `/api/periods/${month.id}/review`, {
      employee_id: flag.employee_id, code: flag.code, state: 'ignored', remark: 'takes none', by: 'Dinesh',
    });
  }
  assert.equal((await api('POST', `/api/periods/${month.id}/approve`, {})).status, 200);

  const bare = await api('DELETE', `/api/periods/${month.id}/approve`, {});
  assert.equal(bare.status, 400, 'a reason is required');

  const done = await api('DELETE', `/api/periods/${month.id}/approve`, { reason: 'OT was missed' });
  assert.equal(done.status, 200);
  assert.equal(done.body.approved_at, null, 'the approval is off');

  /*
   * AND THE BROWSER HAS TO BE ABLE TO SEND IT. `api.del` took no body at
   * all, so the reason was typed, the call went out empty and the server
   * refused every time - the button never once worked. One caller passes a
   * body and this is it.
   */
  const apiSrc = fs.readFileSync(new URL('../../frontend/src/api.js', import.meta.url), 'utf8');
  assert.match(apiSrc, /del: \(path, body\) => request\('DELETE', path, body\)/);
});
