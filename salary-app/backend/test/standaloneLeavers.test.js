import test from 'node:test';
import assert from 'node:assert/strict';

/*
 * LEAVERS IN THE SINGLE-FILE BUILD.
 *
 * The Left column and the rule behind it were built on the server and nowhere
 * else, so *"exited employee abhi bhi dikha rahe he current list me"* stayed
 * true of the file on a laptop: a last working day could be typed and the
 * person went on being active, went on being added to every new month, and
 * went on being offered by every picker.
 *
 * One rule, both builds: a date that has PASSED takes them off, a date still
 * to come leaves them on until it arrives, and an `active` sent in the same
 * patch always wins.
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
  const mod = await import(`../../frontend/src/localStore.js?leavers=${nonce++}`);
  const api = (method, path, body) => mod.handle(method, path, body);
  const company = await api('POST', '/companies', { name: 'BOOKNFLY' });
  const employee = await api('POST', '/employees', {
    company_id: company.id, name: 'Amit Shah', monthly_salary: 26000, joined_on: '2022-04-01',
  });
  return { api, company, employee };
}

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

const thisMonth = () => {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, hours_per_day: 9 };
};

test('a last working day that has passed takes them off the list', async () => {
  const { api, employee } = await freshStore();
  const after = await api('PATCH', `/employees/${employee.id}`, { left_on: day(-1) });
  assert.equal(after.active, 0);
});

test('a last working day STILL TO COME leaves them working, and paid', async () => {
  const { api, employee } = await freshStore();
  const after = await api('PATCH', `/employees/${employee.id}`, { left_on: day(14) });
  assert.equal(after.active, 1, 'somebody serving notice is still here');

  const period = await api('POST', '/periods', thisMonth());
  const payroll = await api('GET', `/periods/${period.id}/payroll`);
  assert.ok(payroll.rows.some((r) => r.employee_id === employee.id), 'and still on the sheet');
});

test('putting somebody back on is still one tick', async () => {
  const { api, employee } = await freshStore();
  await api('PATCH', `/employees/${employee.id}`, { left_on: day(-1) });
  const back = await api('PATCH', `/employees/${employee.id}`, { left_on: '', active: true });
  assert.equal(back.active, 1);
});

test('recording the exit writes the master’s own date, so the two cannot disagree', async () => {
  const { api, employee } = await freshStore();
  await api('PUT', `/people/exits/${employee.id}`, {
    type: 'resigned', resigned_on: day(-30), last_working_day: day(-2),
  });
  const { employees } = await api('GET', '/employees');
  const got = employees.find((e) => e.id === employee.id);
  assert.equal(got.left_on, day(-2));
  assert.equal(got.active, 0);
});

test('an exit with notice left to serve does not take them off either', async () => {
  const { api, employee } = await freshStore();
  await api('PUT', `/people/exits/${employee.id}`, {
    type: 'resigned', resigned_on: day(0), notice_days: 30, last_working_day: day(21),
  });
  const { employees } = await api('GET', '/employees');
  const got = employees.find((e) => e.id === employee.id);
  assert.equal(got.left_on, day(21));
  assert.equal(got.active, 1);
});

test('a month opened after they went does not carry them', async () => {
  const { api, employee } = await freshStore();
  // Left before this month began, and nothing was ever typed against them.
  const now = new Date();
  const before = new Date(now.getFullYear(), now.getMonth(), 1);
  before.setDate(before.getDate() - 3);
  await api('PATCH', `/employees/${employee.id}`, { left_on: before.toISOString().slice(0, 10) });

  const period = await api('POST', '/periods', thisMonth());
  const payroll = await api('GET', `/periods/${period.id}/payroll`);
  assert.ok(!payroll.rows.some((r) => r.employee_id === employee.id));
});

test('BUT A MONTH THAT HAS BEEN WORKED ON KEEPS THEM', async () => {
  /*
   * A row with a mark, a figure, a note or a payment against it is a record,
   * not a draft. Somebody who left mid-month was there for half of it and is
   * owed for those days.
   */
  const { api, employee } = await freshStore();
  const period = await api('POST', '/periods', thisMonth());
  await api('GET', `/periods/${period.id}/payroll`);
  await api('POST', `/periods/${period.id}/attendance`, {
    entries: [{ employee_id: employee.id, day: 2, code: 'P' }],
  });

  const now = new Date();
  const before = new Date(now.getFullYear(), now.getMonth(), 1);
  before.setDate(before.getDate() - 3);
  await api('PATCH', `/employees/${employee.id}`, { left_on: before.toISOString().slice(0, 10) });

  const payroll = await api('GET', `/periods/${period.id}/payroll`);
  assert.ok(payroll.rows.some((r) => r.employee_id === employee.id), 'a marked month is a record');
});
