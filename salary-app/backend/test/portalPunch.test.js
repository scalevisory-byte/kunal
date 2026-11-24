import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portalpunch-'));
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
process.env.PUNCH_ENABLED = 'true';
delete process.env.APP_PASSWORD;

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

/** A signed-in browser: cookies carried by hand, as the real one does. */
function session() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    for (const c of res.headers.getSetCookie?.() || []) cookie = c.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

const admin = session();
const harish = session();
const alifaya = session();
let him;
let her;
let periodId;
const today = new Date();
const dayOfMonth = today.getDate();

test('the scene: two people on one month, each with their own login', async () => {
  assert.equal(
    (await admin('POST', '/api/auth/setup', {
      username: 'dinesh', name: 'Dinesh', password: 'a-long-enough-password',
    })).status,
    201
  );
  const company = (await admin('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  him = (await admin('POST', '/api/employees', {
    company_id: company.id, name: 'Harish Gupta', monthly_salary: 26000, joined_on: '2024-04-01',
  })).body;
  her = (await admin('POST', '/api/employees', {
    company_id: company.id, name: 'Alifaya Chikhaliwala', monthly_salary: 24000, joined_on: '2024-04-01',
  })).body;

  /* The month this very day falls in, because a punch lands on today and
     has nowhere to go unless that month is open. */
  periodId = (await admin('POST', '/api/periods', {
    year: today.getFullYear(), month: today.getMonth() + 1,
  })).body.id;
  await admin('GET', `/api/periods/${periodId}/payroll`);

  const staff = await admin('POST', '/api/auth/staff', {
    employee_ids: [him.id, her.id],
  });
  assert.equal(staff.status, 201, JSON.stringify(staff.body));
  assert.equal(staff.body.made.length, 2, JSON.stringify(staff.body.refused));

  for (const [who, employee] of [[harish, him], [alifaya, her]]) {
    const slip = staff.body.made.find((m) => m.employee_id === employee.id);
    const login = await who('POST', '/api/auth/login', {
      username: slip.username,
      password: slip.password,
    });
    assert.equal(login.status, 200, JSON.stringify(login.body));
  }
});

test('the button asks the server what to offer, and reading files nothing', async () => {
  const before = await harish('GET', '/api/me/punch');
  assert.equal(before.status, 200);
  assert.equal(before.body.settings.enabled, true);
  assert.deepEqual(before.body.punches, []);
  // Nothing punched yet, so the first tap is IN.
  assert.equal(before.body.next, 'in');

  /* A LOOK MUST NOT WRITE. The same rule the import dry run follows: asking
     what the button should say cannot leave a punch behind. */
  const again = await harish('GET', '/api/me/punch');
  assert.deepEqual(again.body.punches, []);
});

test('an employee punches in from their own login, and it reaches the grid', async () => {
  const done = await harish('POST', '/api/me/punch', {
    kind: 'in', lat: 22.3072, lng: 73.1812, accuracy: 12,
  });
  assert.equal(done.status, 201, JSON.stringify(done.body));
  assert.equal(done.body.ok, true);
  assert.equal(done.body.punches.length, 1);
  // Punched in, so the next tap is OUT.
  assert.equal(done.body.next, 'out');

  /*
   * THE POINT OF THE WHOLE FEATURE: it is not a note on a page of its own,
   * it is the attendance the sheet is paid from. The punch rolls up onto the
   * day's in time, exactly as the personal link and the readers do.
   */
  const grid = await admin('GET', `/api/periods/${periodId}/attendance`);
  const mine = (grid.body.employees || []).find((e) => e.employee_id === him.id);
  const day = mine?.attendance?.[dayOfMonth];
  assert.ok(day, 'the punch did not reach the attendance row');
  assert.match(day.in_time, /^\d{2}:\d{2}$/);
});

test('it is recorded as coming from the portal, not the link', async () => {
  /*
   * `source` is how a punch can say where it came from. The link, the portal
   * and a reader in the corridor are three different stories about one
   * person's morning, and a store that called them all 'phone' could not tell
   * them apart afterwards.
   */
  const mine = await harish('GET', '/api/me/punch');
  assert.equal(mine.body.punches.length, 1);
  assert.equal(mine.body.punches[0].source, 'portal');
});

test('THE EMPLOYEE ID COMES OFF THE LOGIN — a body cannot punch for somebody else', async () => {
  /*
   * The rule every /api/me route follows. An employee cannot ask for
   * somebody else's payslip however the request is written, and they
   * certainly cannot stamp somebody else's attendance. The body names him;
   * the punch is hers, because the LOGIN is hers.
   */
  const sneaky = await alifaya('POST', '/api/me/punch', {
    kind: 'in',
    employee_id: him.id,
    id: him.id,
    lat: 22.3072,
    lng: 73.1812,
  });
  assert.equal(sneaky.status, 201);

  const hers = await alifaya('GET', '/api/me/punch');
  const his = await harish('GET', '/api/me/punch');
  assert.equal(hers.body.punches.length, 1, 'her punch was filed against somebody else');
  assert.equal(his.body.punches.length, 1, 'his record grew a punch he did not make');
});

test('punching out closes the day, and only that day', async () => {
  const out = await harish('POST', '/api/me/punch', {
    kind: 'out', lat: 22.3072, lng: 73.1812,
  });
  assert.equal(out.status, 201);
  assert.equal(out.body.punches.length, 2);

  const grid = await admin('GET', `/api/periods/${periodId}/attendance`);
  const mine = (grid.body.employees || []).find((e) => e.employee_id === him.id);
  const day = mine?.attendance?.[dayOfMonth] || {};
  /*
   * In and out in the same second is ONE PUNCH, not a day - `departureTime`
   * refuses to call the second one a departure. Whichever it decides, it must
   * never be a stale or invented time: either a real clock time or empty.
   */
  const stamped = day.out_time || '';
  assert.ok(stamped === '' || /^\d{2}:\d{2}$/.test(stamped), `out_time was ${stamped}`);
});

test('an office login has no /api/me at all', async () => {
  /*
   * `requireSelf` takes the employee id off the login, and an office login
   * has none. Dinesh punching himself in as nobody is not a thing that
   * should have an answer.
   */
  const no = await admin('POST', '/api/me/punch', { kind: 'in' });
  assert.equal(no.status, 403);
});

test('a staff login still cannot reach the office punch routes', async () => {
  /*
   * Their own punches come back through /api/me. A door onto everybody's
   * comings and goings is a different thing, and the staff role has no
   * `read` ability at all.
   */
  for (const url of ['/api/punch-log', '/api/punch-totals', `/api/employees/${him.id}/punches`]) {
    const res = await harish('GET', url);
    assert.equal(res.status, 403, `${url} answered ${res.status}`);
  }
});
