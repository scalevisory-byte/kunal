import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  averageMinutes, breakdown, cleanMobile, duration, isMobile, passNumber,
  visitMinutes, visitorKpis, visitorStatus,
} from '../../shared/frontOffice.js';
import { visitorPassHtml } from '../../shared/visitorPass.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-vis-'));
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

const DAY = '2026-11-20';
let company;
let riya;
test.before(async () => {
  company = (await api('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  riya = (await api('POST', '/api/employees', {
    company_id: company.id, name: 'Riya Pal', department: 'Accounts', monthly_salary: 22000,
  })).body;
});

let n = 0;
const sign = (over = {}) => {
  n += 1;
  return api('POST', '/api/front-office/visitors', {
    day: DAY, name: `Visitor ${n}`, purpose: 'Meeting', mobile: String(9800000000 + n), ...over,
  });
};

/* ---------------- the number ---------------- */

test('a pass number is handed out by the series and never typed', async () => {
  const first = (await sign()).body;
  const second = (await sign()).body;
  assert.match(first.pass_no, /^VIS-2026-\d{4}$/);
  assert.notEqual(first.pass_no, second.pass_no);

  /*
   * Read off the HIGHEST ALREADY USED, never a count - the asset codes'
   * rule. An archived visitor keeps their number, so the next one must not
   * reuse it: a pass already printed still says what it says.
   */
  await api('DELETE', `/api/front-office/visitors/${second.id}`);
  const third = (await sign()).body;
  assert.notEqual(third.pass_no, second.pass_no);

  // And a number sent by a caller is ignored rather than honoured.
  const forged = (await sign({ pass_no: 'VIS-2026-9999' })).body;
  assert.notEqual(forged.pass_no, 'VIS-2026-9999');
});

test('two visitors registered at the same moment cannot share a number', async () => {
  /*
   * better-sqlite3 is synchronous and the insert runs inside a transaction,
   * so this is the belt; the unique index is the braces. Both are checked
   * by firing a burst at the route and counting the numbers that come back.
   */
  const burst = await Promise.all(Array.from({ length: 12 }, () => sign()));
  const numbers = burst.map((r) => r.body.pass_no);
  assert.equal(new Set(numbers).size, numbers.length, 'every pass number must be its own');
});

/* ---------------- what the desk may not do ---------------- */

test('a visitor needs a name, a purpose and a real mobile number', async () => {
  assert.equal((await api('POST', '/api/front-office/visitors', { day: DAY })).status, 400);
  assert.equal((await sign({ purpose: '' })).status, 400);
  assert.equal((await sign({ mobile: '12345' })).status, 400);
  // +91 and a leading zero are how people type it, so they are taken off.
  assert.equal(cleanMobile('+91 98980 11223'), '9898011223');
  assert.ok(isMobile('09898011223'));
  assert.ok(!isMobile('1234567890'), 'an Indian mobile does not start with 1');
});

test('the same person cannot be signed in twice while still inside', async () => {
  const first = (await sign({ name: 'Amit Trivedi', mobile: '9898011223' })).body;
  const again = await api('POST', '/api/front-office/visitors', {
    day: DAY, name: 'amit trivedi', mobile: '9898011223', purpose: 'again',
  });
  assert.equal(again.status, 409);
  /* The refusal carries the visit it clashed with, so the desk is told WHOSE
     pass is open rather than just "no". */
  assert.equal(again.body.visitor.pass_no, first.pass_no);

  // Once they have gone home they can come back.
  await api('POST', `/api/front-office/visitors/${first.id}/checkout`, {});
  const back = await api('POST', '/api/front-office/visitors', {
    day: DAY, name: 'Amit Trivedi', mobile: '9898011223', purpose: 'second visit',
  });
  assert.equal(back.status, 201);
});

/* ---------------- in, out, and putting it right ---------------- */

test('checking out never touches the arrival, and can be taken back', async () => {
  const visitor = (await sign({ name: 'Pooja Shah' })).body;
  assert.equal(visitor.status, 'Inside');
  assert.equal(visitor.minutes, null, 'still inside is not a duration of nought');

  const out = (await api('POST', `/api/front-office/visitors/${visitor.id}/checkout`, { time: '18:30' })).body;
  assert.equal(out.status, 'Checked out');
  assert.equal(out.in_time, visitor.in_time, 'the arrival is what it was');
  assert.ok(out.out_by, 'who signed them out is recorded');

  const back = (await api('DELETE', `/api/front-office/visitors/${visitor.id}/checkout`)).body;
  assert.equal(back.status, 'Inside');
  assert.equal(back.out_time, null);
  assert.equal(back.in_time, visitor.in_time);

  /* Both halves are on the trail: the time that was recorded AND the undo. */
  const { entries } = (await api('GET', `/api/people/audit?entity=fo_visitors&entity_id=${visitor.id}`)).body;
  assert.ok(entries.some((e) => e.to_value === '18:30'));
  assert.ok(entries.some((e) => e.from_value === '18:30' && !e.to_value));
});

test('a visitor is ARCHIVED, never deleted', async () => {
  const visitor = (await sign({ name: 'Gone Away' })).body;
  assert.equal((await api('DELETE', `/api/front-office/visitors/${visitor.id}`)).status, 204);

  const open = (await api('GET', `/api/front-office/visitors?day=${DAY}`)).body;
  assert.ok(!open.rows.some((r) => r.id === visitor.id), 'off the register');

  const archived = (await api('GET', `/api/front-office/visitors?day=${DAY}&archived=true`)).body;
  assert.ok(archived.rows.some((r) => r.id === visitor.id), 'still on the record');
  assert.equal((await api('GET', `/api/front-office/visitors/${visitor.id}`)).status, 200);
});

test('clearing a day archives the books and says what it took', async () => {
  const other = '2026-10-02';
  await api('POST', '/api/front-office/visitors', {
    day: other, name: 'October Visitor', purpose: 'x', mobile: '9811111111',
  });
  const counts = (await api('DELETE', `/api/front-office/day/${other}`)).body;
  assert.equal(counts.visitors, 1);

  const gone = (await api('GET', `/api/front-office/visitors?day=${other}`)).body;
  assert.equal(gone.rows.length, 0);
  const kept = (await api('GET', `/api/front-office/visitors?day=${other}&archived=true`)).body;
  assert.equal(kept.rows.length, 1, 'a visitor book is a record of who was in the building');
});

/* ---------------- searching and reporting ---------------- */

test('one box finds a visitor by name, mobile or pass number', async () => {
  const visitor = (await sign({ name: 'Findable Person', company: 'Acme Ltd', mobile: '9812345678' })).body;
  for (const q of ['Findable', '9812345678', visitor.pass_no, 'Acme']) {
    const { rows } = (await api('GET', `/api/front-office/visitors?q=${encodeURIComponent(q)}`)).body;
    assert.ok(rows.some((r) => r.id === visitor.id), `"${q}" should find them`);
  }
});

test('the register is paged, so a year of a busy desk still opens', async () => {
  const { rows, total } = (await api('GET', '/api/front-office/visitors?limit=3')).body;
  assert.equal(rows.length, 3);
  assert.ok(total > 3, 'the total is the whole register, not the page');
  const second = (await api('GET', '/api/front-office/visitors?limit=3&offset=3')).body;
  assert.notDeepEqual(rows.map((r) => r.id), second.rows.map((r) => r.id));
});

test('“never signed out” is NOT a second name for “currently inside”', () => {
  /*
   * Somebody who walked in ten minutes ago is inside; somebody signed in
   * yesterday and never signed out is a row nobody closed. Counting them
   * together is how the second one never gets done.
   */
  const rows = [
    { day: '2026-11-20', in_time: '10:00' },
    { day: '2026-11-19', in_time: '10:00' },
    { day: '2026-11-20', in_time: '09:00', out_time: '10:00' },
  ];
  const k = visitorKpis(rows, { today: '2026-11-20' });
  assert.equal(k.total, 3);
  assert.equal(k.inside, 2);
  assert.equal(k.checked_out, 1);
  assert.equal(k.pending_checkout, 1, 'only the one from an earlier day');
});

test('a duration is null while they are inside, and never negative', () => {
  assert.equal(visitMinutes({ day: '2026-11-20', in_time: '10:00' }), null);
  assert.equal(visitMinutes({ day: '2026-11-20', in_time: '10:00', out_time: '11:25' }), 85);
  assert.equal(duration(85), '1h 25m');
  assert.equal(duration(null), '');
  // A time typed wrong says nothing rather than something absurd.
  assert.equal(visitMinutes({ day: '2026-11-20', in_time: '18:00', out_time: '09:00' }), null);
  assert.equal(visitorStatus({}), 'Inside');
});

test('every breakdown adds up to the same total', () => {
  const rows = [
    { day: '2026-11-18', company: 'HDFC', visitor_type: 'Client', purpose: 'KYC', meeting: 'Dinesh', in_time: '10:00', out_time: '11:00' },
    { day: '2026-11-20', company: '', visitor_type: 'Vendor', purpose: '', meeting: 'Riya', in_time: '10:00' },
    { day: '2026-11-20', company: 'HDFC', visitor_type: 'Client', purpose: 'KYC', meeting: 'Dinesh', in_time: '09:00', out_time: '09:30' },
  ];
  for (const key of ['day', 'company', 'employee', 'visitor_type', 'purpose']) {
    const groups = breakdown(rows, key);
    const counted = groups.reduce((t, g) => t + g.visitors, 0);
    assert.equal(counted, rows.length, `${key} lost somebody`);
  }
  /* A blank column is a group of its own, not a row quietly dropped. */
  assert.ok(breakdown(rows, 'purpose').some((g) => g.name === '(not recorded)'));
  assert.equal(averageMinutes(rows), 45, 'averaged over the visits that ended');
});

/* ---------------- the pass ---------------- */

test('THE QR CODE CARRIES THE PASS NUMBER AND NOTHING ELSE', async () => {
  /*
   * A pass is pinned to a lanyard and walked around a building full of
   * people who are not staff. Anything in that code is readable by anybody
   * with a phone.
   */
  const { default: qr } = await import('qrcode-generator');
  const html = visitorPassHtml(
    {
      pass_no: 'VIS-2026-0001', name: 'Amit Trivedi', company: 'HDFC Bank',
      meeting: 'Dinesh Parmar', purpose: 'KYC papers', day: '2026-11-20',
      in_time: '10:15', mobile: '9898011223',
    },
    { qr, logo: 'data:image/png;base64,iVBORw0KGgo=' }
  );
  const block = html.slice(html.indexOf('<div class="qr">'), html.indexOf('</div>', html.indexOf('<div class="qr">')));
  assert.match(block, /<svg/);
  assert.ok(!block.includes('9898011223'), 'the mobile number must not be in the code');
  assert.ok(!block.includes('Dinesh'), 'nor who they came to see');
  assert.ok(!block.includes('KYC'), 'nor what for');

  // The pass itself carries its own logo and loads nothing from the internet.
  assert.match(html, /<img src="data:image\/png;base64,/);
  assert.ok(!/src="http|href="http|<link /.test(html));
});

test('the pass number comes from the year it was issued in', () => {
  assert.equal(passNumber(2026, 1), 'VIS-2026-0001');
  assert.equal(passNumber(2027, 1234), 'VIS-2027-1234');
});

/* ---------------- the host ---------------- */

test('who they came to see is an employee, so a report can be made of it', async () => {
  const visitor = (await sign({ name: 'For Riya', meet_employee_id: riya.id })).body;
  assert.equal(visitor.meet_employee_id, riya.id);
  assert.equal(visitor.meeting, 'Riya Pal');
  /* And the company is stamped from them, so the register can be read
     company by company without anybody typing it. */
  assert.equal(visitor.company_id, company.id);

  const { rows } = (await api('GET', `/api/front-office/visitors?employee_id=${riya.id}`)).body;
  assert.ok(rows.some((r) => r.id === visitor.id));
});
