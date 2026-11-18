/**
 * THE SOFTWARE LICENCE REGISTER.
 *
 * What these pin, in the order they matter:
 *
 *  - **No renewal date is not an expired licence.** A perpetual Tally licence
 *    bought in 2019 must never appear on a reminder list, and a SUBSCRIPTION
 *    with no date must never read as perpetual.
 *  - **The key never travels.** Not in a list, not in a detail read, not in an
 *    export. One route returns it, and it writes to the audit trail.
 *  - **Seats in use are counted, never stored**, so the figure and the seat
 *    list cannot disagree.
 *  - **Over-allocation is recorded and flagged, never refused** — the eleventh
 *    install exists whether or not the register admits it.
 *  - **Anything with a history is cancelled, not deleted.**
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-licenses-'));
process.env.APP_PASSWORD = 'the-key';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      authorization: 'Bearer the-key',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed, text };
};

const THE_KEY = 'TALLY-9F3K-2210-ZX88';

/** The admin's cookie, signed in once and kept. */
let signedIn = null;
const adminCookie = async () => {
  if (signedIn) return { cookie: signedIn };
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'dinesh', password: 'first-password-here' }),
  });
  assert.equal(res.status, 200);
  signedIn = res.headers.get('set-cookie');
  return { cookie: signedIn };
};
let tally = 0;
let office = 0;
let amit = 0;

test('set up: a company and two people', async () => {
  const company = await api('POST', '/api/companies', { name: 'BOOKNFLY PRIVATE LIMITED' });
  assert.equal(company.status, 201);
  const one = await api('POST', '/api/employees', {
    name: 'Amit Shah',
    company_id: company.body.id,
    monthly_salary: 26000,
    joined_on: '2026-01-05',
  });
  assert.equal(one.status, 201);
  amit = one.body.id;
  const two = await api('POST', '/api/employees', {
    name: 'Priya Nair',
    company_id: company.body.id,
    monthly_salary: 24000,
    joined_on: '2026-02-01',
  });
  assert.equal(two.status, 201);

  const made = await api('POST', '/api/people/licenses', {
    name: 'Tally Prime Silver',
    kind: 'Accounting software',
    publisher: 'Tally Solutions',
    term: 'subscription',
    key: THE_KEY,
    seats: 2,
    purchased_on: '2026-04-01',
    expires_on: '2027-03-31',
    cost: 22500,
    renew_every_months: 12,
    vendor: 'Vadodara Tally Partner',
  });
  assert.equal(made.status, 201);
  tally = made.body.id;
});

/* ---------------- the key ---------------- */

test('the key is nowhere in any read, and only its last four show', async () => {
  const list = await api('GET', '/api/people/licenses');
  assert.equal(list.status, 200);
  assert.ok(!list.text.includes(THE_KEY), 'the whole key was in the register listing');
  assert.ok(!list.text.includes('2210-ZX88'), 'most of the key was in the register listing');

  const row = list.body.licenses.find((l) => l.id === tally);
  assert.equal(row.has_key, true);
  assert.equal(row.key_masked, '•••• ZX88');
  assert.equal(row.key, undefined);
  assert.equal(row.license_key, undefined);

  const one = await api('GET', `/api/people/licenses/${tally}`);
  assert.ok(!one.text.includes(THE_KEY), 'the whole key was in the detail read');
  assert.equal(one.body.license.key, undefined);
  assert.equal(one.body.license.license_key, undefined);
});

test('one route gives the key, and says in the trail who read it', async () => {
  const shown = await api('POST', `/api/people/licenses/${tally}/key`, {
    why: 'reinstalling on the accounts PC',
    by: 'Dinesh',
  });
  assert.equal(shown.status, 200);
  assert.equal(shown.body.key, THE_KEY);

  const trail = await api('GET', '/api/people/audit?entity=licenses');
  const read = trail.body.entries.find((e) => e.action === 'key read');
  assert.ok(read, 'reading the key left nothing on the audit trail');
  assert.equal(read.who, 'Dinesh');
  assert.match(read.note, /reinstalling on the accounts PC/);
  // The trail itself must not carry the key either - it is on screen in Trail.
  assert.ok(!JSON.stringify(trail.body).includes(THE_KEY));
});

test('the export has no key column at all', async () => {
  const csv = await api('GET', '/api/people/licenses.csv');
  assert.equal(csv.status, 200);
  assert.ok(!csv.text.includes(THE_KEY));
  assert.ok(!csv.text.includes('ZX88'), 'even the masked tail is in a file that gets emailed');
  assert.match(csv.text, /Key on file/);      // whether there is one: yes.
  assert.match(csv.text, /Tally Prime Silver/);
});

/* ---------------- seats ---------------- */

test('a seat has to name somebody or something', async () => {
  const nothing = await api('POST', `/api/people/licenses/${tally}/seats`, { note: 'somewhere' });
  assert.equal(nothing.status, 400);
  assert.match(nothing.body.error, /who or which machine/i);
});

test('seats in use are counted off the list, never stored', async () => {
  const first = await api('POST', `/api/people/licenses/${tally}/seats`, { employee_id: amit });
  assert.equal(first.status, 201);
  assert.equal(first.body.license.seat_use.used, 1);
  assert.equal(first.body.license.seat_use.free, 1);
  assert.equal(first.body.license.seat_use.over, false);

  const second = await api('POST', `/api/people/licenses/${tally}/seats`, {
    device: 'ACCOUNTS-PC',
  });
  assert.equal(second.status, 201);
  assert.equal(second.body.license.seat_use.used, 2);
  assert.equal(second.body.license.seat_use.free, 0);

  // Releasing one gives the seat back, and the figure follows the list.
  const seat = second.body.seat.id;
  const released = await api('POST', `/api/people/licenses/seats/${seat}/release`, { by: 'Dinesh' });
  assert.equal(released.status, 200);
  assert.equal(released.body.seat_use.used, 1);
  assert.equal(released.body.seat_use.free, 1);
  // And the history is kept, not deleted.
  assert.equal(released.body.seats_list.length, 2);
  assert.ok(released.body.seats_list.some((s) => s.released_on));
});

test('the same person cannot hold two seats on one licence', async () => {
  const twice = await api('POST', `/api/people/licenses/${tally}/seats`, { employee_id: amit });
  assert.equal(twice.status, 400);
  assert.match(twice.body.error, /already has/i);
});

test('an eleventh install on a ten-seat licence is RECORDED and flagged, not refused', async () => {
  const made = await api('POST', '/api/people/licenses', {
    name: 'Microsoft 365 Business',
    term: 'subscription',
    seats: 1,
    expires_on: '2027-06-30',
    cost: 12000,
    renew_every_months: 12,
  });
  assert.equal(made.status, 201);
  office = made.body.id;

  const one = await api('POST', `/api/people/licenses/${office}/seats`, { device: 'RECEPTION-PC' });
  assert.equal(one.status, 201);
  const over = await api('POST', `/api/people/licenses/${office}/seats`, { device: 'HR-PC' });
  assert.equal(over.status, 201, 'the second install was refused instead of recorded');
  assert.equal(over.body.license.seat_use.over, true);
  assert.equal(over.body.license.seat_use.over_by, 1);

  const register = await api('GET', '/api/people/licenses');
  assert.ok(register.body.alerts.over_allocated.some((l) => l.id === office));
});

test('a site licence is never over-allocated and never reads as all free', async () => {
  const made = await api('POST', '/api/people/licenses', {
    name: 'ESET Endpoint — site licence',
    term: 'subscription',
    seats: '',                             // nobody is counting
    expires_on: '2027-01-31',
  });
  assert.equal(made.status, 201);
  const id = made.body.id;
  await api('POST', `/api/people/licenses/${id}/seats`, { device: 'PC-1' });
  const one = await api('GET', `/api/people/licenses/${id}`);
  assert.equal(one.body.license.seat_use.counted, false);
  assert.equal(one.body.license.seat_use.seats, null);
  assert.equal(one.body.license.seat_use.free, null, 'an uncounted licence reported free seats');
  assert.equal(one.body.license.seat_use.over, false);
  assert.equal(one.body.license.seat_use.used, 1);
});

/* ---------------- dates ---------------- */

test('a perpetual licence with no date never reaches a reminder list', async () => {
  const made = await api('POST', '/api/people/licenses', {
    name: 'Windows 11 Pro OEM',
    term: 'perpetual',
    key: 'XXXXX-YYYYY-ZZZZZ-11111',
    seats: 4,
    purchased_on: '2024-07-18',
    cost: 48000,
  });
  assert.equal(made.status, 201);
  assert.equal(made.body.status, 'perpetual');
  assert.equal(made.body.days_left, null);

  const register = await api('GET', '/api/people/licenses');
  const ids = [
    ...register.body.alerts.expired,
    ...register.body.alerts.expiring,
    ...register.body.alerts.no_date,
  ].map((l) => l.id);
  assert.ok(!ids.includes(made.body.id), 'a perpetual licence was put on a reminder list');
  // And it annualises to nothing: it was paid once and will not be paid again.
  assert.equal(made.body.annual_cost, 0);
});

test('a subscription with no date is NOT perpetual — it is named', async () => {
  const made = await api('POST', '/api/people/licenses', {
    name: 'Canva Pro',
    term: 'subscription',
    cost: 4000,
  });
  assert.equal(made.body.status, 'no_date');
  const register = await api('GET', '/api/people/licenses');
  assert.ok(register.body.alerts.no_date.some((l) => l.id === made.body.id));
  assert.ok(!register.body.alerts.expired.some((l) => l.id === made.body.id));
});

test('an expired licence says how long ago, and an expiring one how long left', async () => {
  const today = new Date();
  const shift = (days) => {
    const at = new Date(today);
    at.setUTCDate(at.getUTCDate() + days);
    return at.toISOString().slice(0, 10);
  };

  const gone = await api('POST', '/api/people/licenses', {
    name: 'eTimeTrackLite AMC',
    term: 'amc',
    expires_on: shift(-10),
  });
  assert.equal(gone.body.status, 'expired');
  assert.equal(gone.body.days_left, -10);
  assert.match(gone.body.status_label, /10 days ago/);

  const soon = await api('POST', '/api/people/licenses', {
    name: 'scalevisory.in domain',
    term: 'subscription',
    expires_on: shift(12),
  });
  assert.equal(soon.body.status, 'expiring');
  assert.equal(soon.body.days_left, 12);

  const register = await api('GET', '/api/people/licenses');
  assert.ok(register.body.alerts.expired.some((l) => l.id === gone.body.id));
  assert.ok(register.body.alerts.expiring.some((l) => l.id === soon.body.id));
  // Expiring soon is a window, not everything with a date: a licence running
  // to next year is not on it.
  assert.ok(!register.body.alerts.expiring.some((l) => l.id === tally));
});

test('it cannot expire before it was bought', async () => {
  const wrong = await api('POST', '/api/people/licenses', {
    name: 'Typed backwards',
    purchased_on: '2026-05-01',
    expires_on: '2026-04-01',
  });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /before it was bought/);
});

test('a licence needs only a name', async () => {
  const bare = await api('POST', '/api/people/licenses', { name: 'Something nobody has the papers for' });
  assert.equal(bare.status, 201, 'the form refused to save what somebody actually knows');
  const nameless = await api('POST', '/api/people/licenses', { kind: 'Antivirus' });
  assert.equal(nameless.status, 400);
  assert.match(nameless.body.error, /name/i);
});

/* ---------------- renewal ---------------- */

test('renewing moves the licence on and keeps what every period cost', async () => {
  const renewed = await api('POST', `/api/people/licenses/${tally}/renew`, {
    renewed_on: '2027-03-20',
    period_from: '2027-04-01',
    period_to: '2028-03-31',
    cost: 24750,
    invoice_no: 'TP/27-28/114',
    by: 'Dinesh',
  });
  assert.equal(renewed.status, 200);
  assert.equal(renewed.body.expires_on, '2028-03-31');
  assert.equal(renewed.body.cost, 24750);
  assert.equal(renewed.body.renewals.length, 1);
  // The ledger keeps the period that was paid for; the licence carries only now.
  assert.equal(renewed.body.renewals[0].period_to, '2028-03-31');
  assert.equal(renewed.body.renewals[0].cost, 24750);
  assert.equal(renewed.body.annual_cost, 24750);
});

test('a renewal that would move a licence backwards is refused, and says what to do', async () => {
  const back = await api('POST', `/api/people/licenses/${tally}/renew`, { period_to: '2027-01-01' });
  assert.equal(back.status, 400);
  assert.match(back.body.error, /backwards/);
  assert.match(back.body.error, /edit the licence directly/i);
});

test('a trial that has been paid for stops being a trial', async () => {
  const made = await api('POST', '/api/people/licenses', {
    name: 'Zoho Books',
    term: 'trial',
    expires_on: '2026-12-01',
  });
  assert.equal(made.body.term, 'trial');
  const renewed = await api('POST', `/api/people/licenses/${made.body.id}/renew`, {
    period_to: '2027-12-01',
    cost: 9000,
  });
  assert.equal(renewed.body.term, 'subscription');
});

/* ---------------- cancelling and deleting ---------------- */

test('cancelling keeps the row, and releases nothing', async () => {
  const before = await api('GET', `/api/people/licenses/${office}`);
  const seats = before.body.license.seat_use.used;
  assert.equal(seats, 2);

  const done = await api('POST', `/api/people/licenses/${office}/cancel`, {
    on: '2026-11-18',
    why: 'moved to Google Workspace',
    by: 'Dinesh',
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.status, 'cancelled');
  assert.equal(
    done.body.seat_use.used,
    seats,
    'cancelling emptied the seat list — the software is still installed on those machines'
  );

  // And a cancelled licence is off the reminder lists: it is settled, not pending.
  const register = await api('GET', '/api/people/licenses');
  const pending = [...register.body.alerts.expired, ...register.body.alerts.expiring, ...register.body.alerts.over_allocated];
  assert.ok(!pending.some((l) => l.id === office));

  const again = await api('POST', `/api/people/licenses/${office}/cancel`, {});
  assert.equal(again.status, 400, 'it was cancelled twice');
});

test('a cancelled licence hands out no new seats until it is back in use', async () => {
  const no = await api('POST', `/api/people/licenses/${office}/seats`, { device: 'STORE-PC' });
  assert.equal(no.status, 400);
  assert.match(no.body.error, /cancelled/);
  const back = await api('POST', `/api/people/licenses/${office}/uncancel`, {});
  assert.equal(back.status, 200);
  assert.equal(back.body.cancelled_on, null);
  const yes = await api('POST', `/api/people/licenses/${office}/seats`, { device: 'STORE-PC' });
  assert.equal(yes.status, 201);
});

test('anything with a history is cancelled, not deleted', async () => {
  const no = await api('DELETE', `/api/people/licenses/${tally}`);
  assert.equal(no.status, 400);
  assert.match(no.body.error, /renewal/i);
  assert.match(no.body.error, /Cancel it instead/);

  const fresh = await api('POST', '/api/people/licenses', { name: 'Typed by mistake' });
  const gone = await api('DELETE', `/api/people/licenses/${fresh.body.id}`);
  assert.equal(gone.status, 200);
  assert.equal(gone.body.deleted, true);
});

/* ---------------- the figures ---------------- */

test('the yearly figure names what it could not work out', async () => {
  const register = await api('GET', '/api/people/licenses');
  const { totals } = register.body;
  assert.ok(totals.licenses > 0);
  assert.ok(totals.yearly > 0);
  // Canva Pro has a cost and no period, so it cannot be annualised - and that
  // is counted rather than silently left out of the total.
  assert.ok(totals.yearly_unknown >= 1, 'a cost nobody could annualise vanished from the total');
  assert.ok(totals.uncounted >= 1, 'the site licence was folded in as zero seats');
});

test('a narrowed login without the licence right is refused, salary-style', async () => {
  const admin = await api('POST', '/api/auth/setup', {
    name: 'Dinesh',
    username: 'dinesh',
    password: 'first-password-here',
  });
  assert.equal(admin.status, 201);

  const signIn = async (username, password) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(res.status, 200);
    return res.headers.get('set-cookie');
  };
  const cookie = await signIn('dinesh', 'first-password-here');

  const made = await fetch(`${base}/api/auth/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      name: 'Store keeper',
      username: 'store',
      role: 'hr',
      password: 'assets-only-123',
    }),
  });
  assert.equal(made.status, 201);
  const theirId = (await made.json()).id;

  // Assets, deliberately NOT licences: whoever counts the chairs has no
  // business reading the Tally key.
  const narrowed = await fetch(`${base}/api/auth/users/${theirId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ areas: ['assets'], must_change: false }),
  });
  assert.equal(narrowed.status, 200);
  assert.deepEqual((await narrowed.json()).areas, ['assets']);

  const theirCookie = await signIn('store', 'assets-only-123');

  const assets = await fetch(`${base}/api/people/assets`, { headers: { cookie: theirCookie } });
  assert.equal(assets.status, 200, 'the store keeper lost the asset register');

  for (const url of ['/api/people/licenses', '/api/people/licenses.csv']) {
    const res = await fetch(`${base}${url}`, { headers: { cookie: theirCookie } });
    assert.equal(res.status, 403, `${url} was open to a login without the licence right`);
  }
});

/* ---------------- the dashboard hears about it ---------------- */

test('an expired licence reaches the dashboard, and opens the licence tab', async () => {
  const built = await api('GET', '/api/people/digest');
  assert.equal(built.status, 200);
  const lapsed = built.body.items.find((i) => /licence.* expired/.test(i.text));
  assert.ok(lapsed, 'an expired licence was nowhere in the digest');
  assert.match(lapsed.text, /eTimeTrackLite/);
  assert.equal(lapsed.go, 'license', 'the line opened the wrong tab, which is the whole point of `go`');
  // It is a date to act on, not a queue waiting on a decision.
  assert.equal(lapsed.kind, 'dates');

  const text = await api('GET', '/api/people/digest?format=text');
  assert.match(text.text, /software licence/);
});

test('the digest never carries a key, and never licences a login cannot see', async () => {
  const built = await api('GET', '/api/people/digest');
  assert.ok(!JSON.stringify(built.body).includes(THE_KEY));

  // A login narrowed to People has no licence tab, so a summary must not hand
  // it the names and renewal dates either.
  const made = await api('POST', '/api/auth/users', {
    name: 'People only', username: 'people.only', role: 'hr', password: 'people-only-123',
  });
  assert.equal(made.status, 201);
  const cookie = await (async () => {
    await fetch(`${base}/api/auth/users/${made.body.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await adminCookie()) },
      body: JSON.stringify({ areas: ['people'], must_change: false }),
    });
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'people.only', password: 'people-only-123' }),
    });
    assert.equal(res.status, 200);
    return res.headers.get('set-cookie');
  })();

  const theirs = await fetch(`${base}/api/people/digest`, { headers: { cookie } });
  assert.equal(theirs.status, 200);
  const body = await theirs.json();
  assert.ok(
    !body.items.some((i) => /licence/.test(i.text)),
    'a login with no licence tab was told what is expiring on it'
  );
});
