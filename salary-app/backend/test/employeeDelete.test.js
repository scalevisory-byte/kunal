import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * DELETING A WRONGLY ADDED EMPLOYEE.
 *
 * Dinesh: "employee me se wrongly added employee delete kaise hoga". The
 * button was already there; what it could not do was tell the two cases
 * apart. Somebody added by mistake this morning and a cashier of four years
 * looked identical on that screen, and only one of them should go.
 */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'emp-delete-'));
process.env.APP_PASSWORD = 'open-sesame';
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const db = await import('../src/db.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const auth = { authorization: `Bearer ${process.env.APP_PASSWORD}` };
const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { ...auth, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const company = (await api('POST', '/api/companies', { name: 'BOOKNFLY PVT LTD' })).body;
const hire = async (name, salary = 20000) =>
  (await api('POST', '/api/employees', { company_id: company.id, name, monthly_salary: salary }))
    .body;

test('somebody added by mistake comes back with nothing against their name', async () => {
  const oops = await hire('Typed By Mistake');
  const { status, body } = await api('GET', `/api/employees/${oops.id}/delete-check`);
  assert.equal(status, 200);
  assert.deepEqual(
    {
      months: body.months, attendance_days: body.attendance_days,
      documents: body.documents, loans: body.loans, reports: body.reports,
    },
    { months: 0, attendance_days: 0, documents: 0, loans: 0, reports: 0 },
    'zeroes ARE the answer - nothing is lost by deleting this one'
  );
  assert.equal(body.problem, '');
  assert.equal((await api('DELETE', `/api/employees/${oops.id}`)).status, 204);
  assert.equal((await api('GET', `/api/employees/${oops.id}`)).status, 404);
});

test('a real employee comes back with what would go', async () => {
  const real = await hire('Amit Shah', 26000);
  const period = (await api('POST', '/api/periods', { year: 2026, month: 10 })).body;
  await api('GET', `/api/periods/${period.id}/payroll`);
  const marked = await api('POST', `/api/periods/${period.id}/attendance`, {
    entries: [{ employee_id: real.id, day: 5, code: 'P' }],
  });
  assert.equal(marked.status, 200);

  const { body } = await api('GET', `/api/employees/${real.id}/delete-check`);
  assert.equal(body.months, 1, 'the month they are on');
  assert.equal(body.attendance_days, 1);
  assert.equal(body.problem, '', 'an OPEN month does not stop it - that is where a mistake sits');
});

test('a closed month refuses, and says to mark them Left instead', async () => {
  const paid = await hire('Priya Nair', 30000);
  const period = (await api('POST', '/api/periods', { year: 2026, month: 9 })).body;
  await api('GET', `/api/periods/${period.id}/payroll`);
  await api('PATCH', `/api/periods/${period.id}`, { locked: 1 });

  const check = await api('GET', `/api/employees/${paid.id}/delete-check`);
  assert.match(check.body.problem, /closed month/);
  assert.match(check.body.problem, /Left/, 'a refusal has to say what to do instead');

  const refused = await api('DELETE', `/api/employees/${paid.id}`);
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /PF return|payslip/);
  assert.equal((await api('GET', `/api/employees/${paid.id}`)).status, 200, 'and nothing went');
});

test('deleting takes their documents off the disk, not just the rows', async () => {
  const leaving = await hire('Kiran Rao');
  for (const kind of ['pan', 'aadhaar']) {
    const form = new FormData();
    form.set('document', new Blob([Buffer.from('%PDF-1.4')], { type: 'application/pdf' }), `${kind}.pdf`);
    form.set('kind', kind);
    const res = await fetch(`${base}/api/employees/${leaving.id}/documents`, {
      method: 'POST', headers: auth, body: form,
    });
    assert.equal(res.status, 201);
  }
  const dir = path.join(process.env.DATA_DIR, 'documents');
  const before = fs.readdirSync(dir).length;
  assert.ok(before >= 2);

  assert.equal((await api('GET', `/api/employees/${leaving.id}/delete-check`)).body.documents, 2);
  assert.equal((await api('DELETE', `/api/employees/${leaving.id}`)).status, 204);
  assert.equal(
    fs.readdirSync(dir).length,
    before - 2,
    'rows cascade away, files do not - the folder fills with PAN cards nothing points at'
  );
});

test('the people reporting to them are counted, so nobody is orphaned silently', async () => {
  const manager = await hire('Alpesh Shah', 45000);
  const reportsTo = await hire('Riya Shah', 22000);
  await api('PATCH', `/api/employees/${reportsTo.id}`, { reports_to_id: manager.id });

  const { body } = await api('GET', `/api/employees/${manager.id}/delete-check`);
  assert.equal(body.reports, 1);
  assert.equal(body.problem, '', 'named, not blocked - a manager can still be removed');

  await api('DELETE', `/api/employees/${manager.id}`);
  assert.equal(
    db.getEmployee(reportsTo.id).reports_to_id,
    null,
    'their report is left without a manager, not deleted with them'
  );
});

test('checking somebody who is not there is 404, not a crash', async () => {
  assert.equal((await api('GET', '/api/employees/999999/delete-check')).status, 404);
  assert.equal((await api('DELETE', '/api/employees/999999')).status, 404);
});
