import test from 'node:test';
import assert from 'node:assert/strict';

/*
 * The People tab in the single-file build.
 *
 * It was switched off, on the grounds that a record has to outlive one browser
 * and be seen by more than one person. The first half was never true of this
 * file - it already holds 115 people and a year of payslips. The second half
 * is true and is one sentence, not a reason to hide eight panels.
 *
 * These drive localStore the way the browser does and pin the rules that cost
 * money or lose a record if the two halves differ: nothing decides itself, a
 * decision is taken once, money reaches the payroll through one call that
 * names its month, and what was done stays on the record.
 */

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

let nonce = 0;
async function freshStore() {
  globalThis.localStorage = fakeStorage();
  const mod = await import(`../../frontend/src/localStore.js?p=${nonce++}`);
  const api = (method, path, body) => mod.handle(method, path, body);
  const company = await api('POST', '/companies', { name: 'BOOKNFLY PRIVATE LIMITED' });
  const employee = await api('POST', '/employees', {
    company_id: company.id,
    name: 'Devanshi Trivedi',
    monthly_salary: 26000,
    joined_on: '2022-04-01',
    cl_quota: 7,
    sl_quota: 7,
    pl_quota: 12,
  });
  return { api, mod, company, employee };
}

/* ---------------- warnings and appreciations ---------------- */

test('a warning carries its level; an appreciation does not', async () => {
  const { api, employee } = await freshStore();
  const warning = await api('POST', '/people/notes', {
    employee_id: employee.id,
    kind: 'warning',
    subject: 'Late four days running',
    severity: 'written',
  });
  assert.equal(warning.kind, 'warning');
  assert.equal(warning.severity, 'written');
  assert.equal(warning.employee_name, 'Devanshi Trivedi');
  assert.equal(warning.acknowledged_on, null, 'nobody has signed it yet');

  const praise = await api('POST', '/people/notes', {
    employee_id: employee.id,
    kind: 'appreciation',
    subject: 'Sorted the Dubai group single-handed',
    severity: 'final',
  });
  assert.equal(praise.severity, null, 'an appreciation has no level, whatever is sent');

  // A warning the person never saw is not much of a warning.
  const signed = await api('PATCH', `/people/notes/${warning.id}`, { acknowledged_on: '2026-11-04' });
  assert.equal(signed.acknowledged_on, '2026-11-04');

  const { notes } = await api('GET', '/people/notes?kind=warning');
  assert.equal(notes.length, 1);
});

test('a note needs a line saying what it is about', async () => {
  const { api, employee } = await freshStore();
  await assert.rejects(
    () => api('POST', '/people/notes', { employee_id: employee.id, kind: 'warning' }),
    /what it is about/
  );
});

/* ---------------- appraisals ---------------- */

test('an appraisal is a proposal until it is applied', async () => {
  const { api, employee } = await freshStore();
  const a = await api('POST', '/people/appraisals', {
    employee_id: employee.id,
    cycle: '2026-27',
    rating: 'A',
    to_salary: 29000,
  });
  // Measured against what they are on NOW, so it cannot be worked off a
  // stale figure.
  assert.equal(a.from_salary, 26000);
  assert.equal(a.increment, 3000);
  assert.equal(a.increment_percent, 11.5);
  assert.equal(a.applied_at, null);

  // Nobody is paid differently yet.
  const onFile = async () =>
    (await api('GET', '/employees')).employees.find((e) => e.id === employee.id).monthly_salary;
  assert.equal(await onFile(), 26000);

  const applied = await api('POST', `/people/appraisals/${a.id}/apply`, {});
  assert.equal(applied.applied, true);
  assert.equal(applied.employee.monthly_salary, 29000);

  // Applying twice gives no second rise.
  const again = await api('POST', `/people/appraisals/${a.id}/apply`, {});
  assert.equal(again.applied, false);
  assert.equal(again.employee.monthly_salary, 29000);
  assert.equal(await onFile(), 29000);
});

test('an applied increment cannot be edited or deleted', async () => {
  const { api, employee } = await freshStore();
  const a = await api('POST', '/people/appraisals', { employee_id: employee.id, to_salary: 28000 });
  await api('POST', `/people/appraisals/${a.id}/apply`, {});
  await assert.rejects(() => api('PATCH', `/people/appraisals/${a.id}`, { rating: 'C' }), /stays on the record/);
  await assert.rejects(() => api('DELETE', `/people/appraisals/${a.id}`), /stays on the record/);
});

test('an increment with no new salary cannot be applied', async () => {
  const { api, employee } = await freshStore();
  const a = await api('POST', '/people/appraisals', { employee_id: employee.id, rating: 'B' });
  await assert.rejects(() => api('POST', `/people/appraisals/${a.id}/apply`, {}), /set the new salary/);
});

/* ---------------- expense claims ---------------- */

async function monthWithRow(api) {
  const period = await api('POST', '/periods', { year: 2026, month: 11, hours_per_day: 9 });
  await api('GET', `/periods/${period.id}/payroll`);
  return period;
}

test('a claim is decided once, and paid into a named month', async () => {
  const { api, employee } = await freshStore();
  const period = await monthWithRow(api);

  await assert.rejects(
    () => api('POST', '/people/claims', { employee_id: employee.id, amount: 0 }),
    /what did it cost/
  );
  const claim = await api('POST', '/people/claims', {
    employee_id: employee.id,
    kind: 'Petrol',
    amount: 1200,
    spent_on: '2026-11-02',
  });
  assert.equal(claim.status, 'pending');

  // Approve before paying, always.
  await assert.rejects(
    () => api('POST', `/people/claims/${claim.id}/pay`, { period_id: period.id }),
    /approve the claim/
  );

  await api('POST', `/people/claims/${claim.id}/decide`, { status: 'approved', by: 'Dinesh' });
  // And a decision is taken once - not approved, then rejected, then approved.
  await assert.rejects(
    () => api('POST', `/people/claims/${claim.id}/decide`, { status: 'rejected' }),
    /already approved/
  );

  const paid = await api('POST', `/people/claims/${claim.id}/pay`, { period_id: period.id, by: 'Dinesh' });
  assert.equal(paid.status, 'paid');
  assert.equal(paid.paid_period_id, period.id);

  // It reaches the payroll as an addition on that person's row, with a remark.
  const { rows } = await api('GET', `/periods/${period.id}/payroll`);
  const row = rows.find((r) => r.employee_id === employee.id);
  assert.equal(row.addition, 1200);
  assert.match(row.adjustment_note, /Petrol claim 2026-11-02/);

  // A double click cannot pay a petrol bill twice.
  await assert.rejects(
    () => api('POST', `/people/claims/${claim.id}/pay`, { period_id: period.id }),
    /already been paid/
  );
  const after = await api('GET', `/periods/${period.id}/payroll`);
  assert.equal(after.rows.find((r) => r.employee_id === employee.id).addition, 1200);
});

test('paying ADDS to whatever the row already carries', async () => {
  const { api, employee } = await freshStore();
  const period = await monthWithRow(api);
  const { rows } = await api('GET', `/periods/${period.id}/payroll`);
  const row = rows.find((r) => r.employee_id === employee.id);
  await api('PATCH', `/periods/${period.id}/rows/${row.id}`, { addition: 500 });

  const claim = await api('POST', '/people/claims', { employee_id: employee.id, amount: 1200 });
  await api('POST', `/people/claims/${claim.id}/decide`, { status: 'approved' });
  await api('POST', `/people/claims/${claim.id}/pay`, { period_id: period.id });

  const after = await api('GET', `/periods/${period.id}/payroll`);
  assert.equal(
    after.rows.find((r) => r.employee_id === employee.id).addition,
    1700,
    'an incentive already on the row must not be wiped out by a petrol bill'
  );
});

test('a claim cannot be paid into a closed month', async () => {
  const { api, employee } = await freshStore();
  const period = await monthWithRow(api);
  const claim = await api('POST', '/people/claims', { employee_id: employee.id, amount: 300 });
  await api('POST', `/people/claims/${claim.id}/decide`, { status: 'approved' });
  await api('PATCH', `/periods/${period.id}`, { locked: 1 });
  await assert.rejects(
    () => api('POST', `/people/claims/${claim.id}/pay`, { period_id: period.id }),
    /is closed/
  );
});

/* ---------------- office tasks ---------------- */

test('a task that was done stays on the record', async () => {
  const { api, employee } = await freshStore();
  const task = await api('POST', '/people/tasks', {
    employee_id: employee.id,
    title: 'Collect the PAN copy',
    due_on: '2026-10-01',
    priority: 'high',
  });
  assert.equal(task.status, 'open');

  const open = await api('GET', '/people/tasks?status=open');
  assert.equal(open.tasks[0].overdue, true, 'a due date in the past is overdue, worked out on read');

  await api('POST', `/people/tasks/${task.id}/status`, { status: 'done', note: 'Got it' });
  await assert.rejects(() => api('DELETE', `/people/tasks/${task.id}`), /drop it instead/);

  // An open one can still be deleted - it was a mistake, not a record.
  const typo = await api('POST', '/people/tasks', { title: 'teh wrong thing' });
  assert.deepEqual(await api('DELETE', `/people/tasks/${typo.id}`), { deleted: true });
});

test('a task needs a title, and only three states exist', async () => {
  const { api } = await freshStore();
  await assert.rejects(() => api('POST', '/people/tasks', {}), /what is the task/);
  const task = await api('POST', '/people/tasks', { title: 'Chase the ESIC number' });
  await assert.rejects(
    () => api('POST', `/people/tasks/${task.id}/status`, { status: 'maybe' }),
    /open, done or dropped/
  );
});

/* ---------------- the helpdesk ---------------- */

test('answering is not closing, and a reply reopens it', async () => {
  const { api, employee } = await freshStore();
  const ticket = await api('POST', '/people/tickets', {
    employee_id: employee.id,
    category: 'Salary',
    subject: 'October PF looks wrong',
  });
  assert.equal(ticket.status, 'open');

  const answered = await api('POST', `/people/tickets/${ticket.id}/reply`, {
    body: 'Checked — it is 12% of basic.',
    author: 'Dinesh',
  });
  assert.equal(answered.status, 'answered', 'the office answering does not close it');

  // The person who raised it decides whether the answer settled it.
  const back = await api('POST', `/people/tickets/${ticket.id}/reply`, {
    side: 'employee',
    body: 'My basic is not what you have.',
  });
  assert.equal(back.status, 'open');
  assert.equal(back.replies.length, 2);

  const closed = await api('POST', `/people/tickets/${ticket.id}/close`, { note: 'Corrected.' });
  assert.equal(closed.status, 'closed');
  assert.equal(closed.replies.length, 3, 'a last word on closing is kept');

  // A closed one is not replied to - it is raised again.
  await assert.rejects(
    () => api('POST', `/people/tickets/${ticket.id}/reply`, { body: 'one more thing' }),
    /closed/
  );
  assert.equal((await api('POST', `/people/tickets/${ticket.id}/reopen`, {})).status, 'open');
});

/* ---------------- leaving, and the full and final ---------------- */

test('the full and final assembles the payslip’s own figures', async () => {
  const { api, employee } = await freshStore();
  const period = await api('POST', '/periods', { year: 2026, month: 11, hours_per_day: 9 });
  await api('GET', `/periods/${period.id}/payroll`);

  await api('PUT', `/people/exits/${employee.id}`, {
    type: 'resigned',
    resigned_on: '2026-10-15',
    notice_days: 30,
    last_working_day: '2026-11-14',
    reason: 'Moving to Surat',
  });

  const ff = await api('GET', `/people/exits/${employee.id}`);
  assert.equal(ff.exit.last_working_day, '2026-11-14');
  assert.equal(ff.final_month_label, period.label);
  assert.ok(ff.final_month, 'the final month is the payslip row, not a new sum');
  const salaryLine = ff.settlement.pays.find((l) => /Salary for/.test(l.label));
  assert.equal(
    salaryLine.amount,
    Math.round(ff.final_month.net_salary),
    'the settlement quotes the payslip, it does not recompute it'
  );
  assert.ok(Number.isFinite(ff.settlement.net), 'and it adds up to a figure');
  // Over four years of service, so gratuity is due - and it is reported with
  // its rule even when it is not, which is why it is always a line.
  assert.ok(
    ff.settlement.pays.some((l) => l.label === 'Gratuity'),
    'gratuity is reported with its rule either way'
  );

  const settled = await api('POST', `/people/exits/${employee.id}/settle`, { amount: 41000, by: 'Dinesh' });
  assert.equal(settled.exit.settled_amount, 41000);
  // Settled once, after which the dates stop moving.
  await assert.rejects(
    () => api('POST', `/people/exits/${employee.id}/settle`, { amount: 99999 }),
    /already been paid/
  );
});

test('an exit records once per person, and editing does not duplicate it', async () => {
  const { api, employee } = await freshStore();
  await api('PUT', `/people/exits/${employee.id}`, { type: 'resigned', resigned_on: '2026-10-01' });
  await api('PUT', `/people/exits/${employee.id}`, { last_working_day: '2026-10-31' });
  const { exits } = await api('GET', '/people/exits');
  assert.equal(exits.length, 1);
  assert.equal(exits[0].resigned_on, '2026-10-01', 'the second save kept what the first set');
  assert.equal(exits[0].last_working_day, '2026-10-31');
  assert.equal(exits[0].employee_name, 'Devanshi Trivedi');
});

/* ---------------- the trail ---------------- */

test('the trail records what was decided, by the name on the form', async () => {
  const { api, employee } = await freshStore();
  const claim = await api('POST', '/people/claims', { employee_id: employee.id, amount: 800, by: 'Devanshi' });
  await api('POST', `/people/claims/${claim.id}/decide`, { status: 'approved', by: 'Dinesh' });

  const { entries } = await api('GET', '/people/audit');
  const actions = entries.map((e) => e.action);
  assert.ok(actions.includes('approved'), 'the decision is on the trail');
  assert.ok(actions.includes('created'));
  const approved = entries.find((e) => e.action === 'approved');
  assert.equal(approved.who, 'Dinesh');
  assert.equal(approved.entity, 'expense_claims');

  // Newest first, and narrowed by entity like the server's.
  const only = await api('GET', '/people/audit?entity=expense_claims');
  assert.ok(only.entries.length >= 2);
  assert.ok(only.entries.every((e) => e.entity === 'expense_claims'));
});

/* ---------------- the digest ---------------- */

test('the digest says what is waiting, and a quiet day says so', async () => {
  const { api, employee } = await freshStore();
  const quiet = await api('GET', '/people/digest');
  assert.ok(quiet.heading);
  assert.match(quiet.text, /Nothing waiting/i);

  await api('POST', '/people/claims', { employee_id: employee.id, amount: 1200 });
  await api('POST', '/people/tickets', {
    employee_id: employee.id,
    category: 'Salary',
    subject: 'PF query',
  });
  const busy = await api('GET', '/people/digest');
  assert.doesNotMatch(busy.text, /Nothing waiting/i);
  assert.match(busy.text, /claim/i);
});

/* ---------------- it is still there after a refresh ---------------- */

test('People survives a reload - this file is the only copy there is', async () => {
  globalThis.localStorage = fakeStorage();
  const first = await import(`../../frontend/src/localStore.js?p=pr-a${nonce++}`);
  const company = await first.handle('POST', '/companies', { name: 'BOOKNFLY' });
  const emp = await first.handle('POST', '/employees', {
    company_id: company.id, name: 'Krupa Shah', monthly_salary: 21000,
  });
  await first.handle('POST', '/people/notes', {
    employee_id: emp.id, kind: 'appreciation', subject: 'Covered the counter alone',
  });

  const second = await import(`../../frontend/src/localStore.js?p=pr-b${nonce++}`);
  const { notes } = await second.handle('GET', '/people/notes');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].subject, 'Covered the counter alone');
  assert.equal(notes[0].employee_name, 'Krupa Shah');
});

/*
 * Found by driving the real file, not by a test: raising a claim did nothing
 * and the list stayed empty.
 *
 * Every id that reaches the store from a form is a STRING - a <select> value
 * and an <input> value always are - and the lookups compared with ===, so
 * `5 === '5'` was false and somebody plainly on the list came back as "not
 * found". The same class of bug as the manager picker that once stored
 * reports_to_id as a string and drew all 115 people as roots.
 */
test('an id that arrives as a string still finds the person', async () => {
  const { api, employee, company } = await freshStore();
  const asForm = String(employee.id);

  const claim = await api('POST', '/people/claims', { employee_id: asForm, amount: '900' });
  assert.equal(claim.employee_id, employee.id);
  assert.equal(claim.employee_name, 'Devanshi Trivedi');

  const note = await api('POST', '/people/notes', { employee_id: asForm, subject: 'Typed from a form' });
  assert.equal(note.employee_name, 'Devanshi Trivedi');

  const task = await api('POST', '/people/tasks', { title: 'Collect PAN', employee_id: asForm });
  assert.equal(task.employee_name, 'Devanshi Trivedi');

  const ticket = await api('POST', '/people/tickets', { employee_id: asForm, subject: 'PF query' });
  assert.equal(ticket.employee_name, 'Devanshi Trivedi');

  // And paying into a month, where the period id comes off a picker too.
  const period = await api('POST', '/periods', { year: 2026, month: 11, hours_per_day: 9 });
  await api('GET', `/periods/${period.id}/payroll`);
  await api('POST', `/people/claims/${claim.id}/decide`, { status: 'approved' });
  const paid = await api('POST', `/people/claims/${claim.id}/pay`, { period_id: String(period.id) });
  assert.equal(paid.status, 'paid');

  // A nonsense id still finds nobody, which is the right answer.
  await assert.rejects(
    () => api('POST', '/people/claims', { employee_id: 'abc', amount: 100 }),
    /employee not found/
  );
  assert.ok(company.id);
});
