/**
 * Every path that writes attendance must agree.
 *
 * These tests exist because for a while they did not. Five bugs, all in
 * `setAttendance` or the callers that lean on it:
 *
 *  1. A GPS punch wrote a clock time with no mark and no minutes, so a month
 *     attended by phone paid everybody as present with no hours effect at all.
 *  2. Short-hour minutes were derived only in the browser, so the Time tab
 *     displayed "-32m" for a day the salary sheet charged nothing for.
 *  3. Approving a missing-punch request recorded the hours but not the money.
 *  4. (auth, tested in its own file)
 *  5. An entry that did not name a code WIPED the stored mark - a punch on a
 *     day marked Paid Holiday or Casual Leave silently cleared it, taking the
 *     leave off the register with it.
 *
 * The property all of them come down to: **the same hours pay the same money,
 * whichever screen wrote them, and no write touches a column it did not name.**
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-writes-'));
process.env.APP_PASSWORD = '';
process.env.SERVE_FRONTEND = 'false';
process.env.PUNCH_ENABLED = 'true';
process.env.PUNCH_REQUIRE_LOCATION = 'false';

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

let periodId;
const staff = {};

const dayOf = async (employeeId, day) => {
  const { body } = await api('GET', `/api/periods/${periodId}/attendance`);
  return body.employees.find((e) => e.employee_id === employeeId)?.attendance?.[day] || null;
};

const rowOf = async (employeeId) => {
  const { body } = await api('GET', `/api/periods/${periodId}/payroll`);
  return body.rows.find((r) => r.employee_id === employeeId);
};

const PER_MINUTE = 26000 / 26 / 9 / 60;

test('set the scene: one company, four people on the same salary, one open month', async () => {
  const company = await api('POST', '/api/companies', { name: 'BOOKNFLY' });
  for (const name of ['Typed', 'Punched', 'Requested', 'Imported']) {
    const made = await api('POST', '/api/employees', {
      company_id: company.body.id,
      name,
      monthly_salary: 26000,
    });
    assert.equal(made.status, 201);
    staff[name] = made.body.id;
  }
  const period = await api('POST', '/api/periods', { year: 2026, month: 11 });
  periodId = period.body.id;
  await api('GET', `/api/periods/${periodId}/payroll`);
});

/* ================================================================= *
 * BUG-5 — no write touches a column it did not name
 * ================================================================= */

test('a write that names only a time leaves a Paid Holiday alone', async () => {
  const who = staff.Typed;
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 5, code: 'PH', minutes: 0 }],
  });
  assert.equal((await dayOf(who, 5)).code, 'PH');

  // What a phone punch sends: a time, and nothing else.
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 5, in_time: '09:40' }],
  });
  const day = await dayOf(who, 5);
  assert.equal(day.code, 'PH', 'the holiday survives the punch');
  assert.equal(day.in_time, '09:40', 'and the punch is recorded against it');
});

test('and it leaves Casual Leave alone, so the leave register does not lose a day', async () => {
  const who = staff.Typed;
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 6, code: 'CL', minutes: 0 }],
  });
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 6, in_time: '09:40', out_time: '18:30' }],
  });
  assert.equal((await dayOf(who, 6)).code, 'CL');

  const leave = await api('GET', '/api/leave?year=2026');
  const mine = leave.body.rows.find((r) => r.employee_id === who);
  assert.equal(mine.taken.CL, 1, 'the day of casual leave is still counted');
});

test('a mark can still be cleared, by naming it empty', async () => {
  const who = staff.Typed;
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 6, code: '' }],
  });
  const day = await dayOf(who, 6);
  assert.equal(day.code, '', 'naming it empty clears it');
  assert.equal(day.in_time, '09:40', 'without disturbing the times');
});

test('marking somebody Present does not wipe their typed hours', async () => {
  const who = staff.Typed;
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 7, in_time: '09:30', out_time: '18:30', lunch_out: '13:00', lunch_in: '13:45' }],
  });
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 7, code: 'P', minutes: 0 }],
  });
  const day = await dayOf(who, 7);
  assert.equal(day.lunch_in, '13:45', 'the lunch is still there');
  assert.equal(day.out_time, '18:30');
});

/* ================================================================= *
 * BUG-1, 2 and 3 — hours become money on the server
 * ================================================================= */

test('clock times posted with no minutes are charged, not just stored', async () => {
  const who = staff.Requested;
  // 09:52 -> 18:20 is 8h28m against a 9h day: 32 minutes short.
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 10, in_time: '09:52', out_time: '18:20' }],
  });
  const day = await dayOf(who, 10);
  assert.equal(day.minutes, -32, 'the shortfall is worked out on the server');
  assert.equal(day.code, 'P', 'and a blank day gets its mark');
});

test('a day punched in but never out is Present with no minutes — nothing invents a departure', async () => {
  const who = staff.Requested;
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 11, in_time: '09:30' }],
  });
  const day = await dayOf(who, 11);
  assert.equal(day.code, 'P', 'somebody was here');
  assert.equal(day.minutes, 0, 'but how long is not known, so nothing is charged');
});

test('a short day is a half day, and its hours are not deducted as well', async () => {
  const who = staff.Requested;
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 12, in_time: '09:30', out_time: '13:00' }],
  });
  const day = await dayOf(who, 12);
  assert.equal(day.code, 'HF', 'three and a half hours against a 4½ line');
  assert.equal(day.minutes, 0, 'already paid at half — charging the hours again would be double');
});

test('a caller that works the minutes out itself is left alone', async () => {
  const who = staff.Imported;
  // What the biometric importer and the Time tab send: times AND minutes.
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 10, code: 'P', in_time: '09:52', out_time: '18:20', minutes: -45 }],
  });
  assert.equal((await dayOf(who, 10)).minutes, -45, 'its own figure stands');
});

/* ================================================================= *
 * The property that matters: four routes, one answer
 * ================================================================= */

test('the same hours pay the same money whichever route wrote them', async () => {
  const hours = { in_time: '09:52', out_time: '18:20' }; // 32 minutes short
  const days = [20, 21, 22];

  // 1. Typed on the Time tab — times plus the minutes it worked out.
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: days.map((day) => ({ employee_id: staff.Typed, day, code: 'P', ...hours, minutes: -32 })),
  });

  // 2. Straight through the attendance API with no minutes — what a punch sends.
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: days.map((day) => ({ employee_id: staff.Punched, day, ...hours })),
  });

  // 3. Through an approved missing-punch request.
  for (const day of days) {
    const raised = await api('POST', '/api/attendance/requests', {
      employee_id: staff.Requested,
      period_id: periodId,
      day,
      kind: 'missing_punch',
      ...hours,
      reason: 'The machine did not read my finger',
    });
    assert.equal(raised.status, 201);
    const decided = await api('POST', `/api/attendance/requests/${raised.body.id}/decide`, {
      approve: true,
      by: 'Dinesh',
    });
    assert.equal(decided.status, 200);
  }

  for (const [name, who] of [['Typed', staff.Typed], ['Punched', staff.Punched], ['Requested', staff.Requested]]) {
    for (const day of days) {
      const entry = await dayOf(who, day);
      assert.equal(entry.minutes, -32, `${name} day ${day}: the shortfall`);
      assert.equal(entry.code, 'P', `${name} day ${day}: the mark`);
    }
  }

  // And the money. Each of the three carries 3 x 32 = 96 minutes short on
  // these days, so their gross must move by the same amount.
  const typed = await rowOf(staff.Typed);
  const punched = await rowOf(staff.Punched);
  const requested = await rowOf(staff.Requested);
  assert.equal(punched.ot_minutes, -96, 'three days, 32 minutes each');
  assert.equal(punched.ot_salary, Math.round(-96 * PER_MINUTE * 100) / 100);
  assert.equal(
    punched.ot_salary,
    typed.ot_salary,
    'a punched day and a typed day are worth the same',
  );
});

/* ================================================================= *
 * A real GPS punch, end to end
 * ================================================================= */

test('a GPS punch marks the day, instead of leaving a blank that is paid in full', async () => {
  const made = await api('POST', '/api/employees', {
    company_id: (await api('GET', '/api/companies')).body.companies[0].id,
    name: 'Phone Only',
    monthly_salary: 26000,
  });
  const who = made.body.id;
  await api('GET', `/api/periods/${periodId}/payroll`);

  const link = await api('GET', `/api/employees/${who}/punch-link`);
  const token = link.body.path.split('/punch/')[1];
  const punched = await fetch(`${base}/api/punch/${token}/punch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'in' }),
  });
  assert.equal(punched.status, 201);

  const today = new Date().getDate();
  const entry = await dayOf(who, today);
  assert.ok(entry, 'the punch reached the grid');
  assert.equal(entry.code, 'P', 'and it is marked, not left blank');
  assert.ok(entry.in_time, 'with the time on it');
});

/* ================================================================= *
 * The absence reason, and whether it was allowed
 * ================================================================= *
 *
 * Dinesh asked for both by name. Two things have to hold, and the second is
 * the one that would hurt: they follow the SAME per-field merge rule as every
 * other column, and NEITHER MOVES A RUPEE.
 */

test('a reason and a decision are kept on the day', async () => {
  const who = staff.Requested;
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 17, code: 'A' }],
  });
  // Nobody has decided anything yet, and that is NOT "not approved".
  assert.equal((await dayOf(who, 17)).approved, null);
  assert.equal((await dayOf(who, 17)).reason, '');

  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 17, reason: 'Rang in — fever', approved: true }],
  });
  const day = await dayOf(who, 17);
  assert.equal(day.reason, 'Rang in — fever');
  assert.equal(day.approved, true);
  // And naming only those two left the mark alone.
  assert.equal(day.code, 'A');
});

test('neither of them moves a rupee', async () => {
  const who = staff.Requested;
  const before = await rowOf(who);

  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 17, approved: false, reason: 'No word at all' }],
  });
  const after = await rowOf(who);

  // An allowed absence is still an absence. Paid time off is CL/SL/PL, and
  // this column is not a back door to it.
  for (const field of ['gross_salary', 'net_salary', 'absent_days', 'present_days', 'pt', 'pf']) {
    assert.equal(after[field], before[field], `${field} moved`);
  }
});

test('marking everyone Present does not wipe a reason typed that morning', async () => {
  const who = staff.Imported;
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 18, reason: 'Said he would be late', approved: true }],
  });
  // What the toolbar sends: a code and minutes, naming neither column.
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 18, code: 'P', minutes: 0 }],
  });
  const day = await dayOf(who, 18);
  assert.equal(day.reason, 'Said he would be late');
  assert.equal(day.approved, true);
  assert.equal(day.code, 'P');
});

test('a decision can be handed back, which is not the same as refusing it', async () => {
  const who = staff.Imported;
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 18, approved: null }],
  });
  assert.equal((await dayOf(who, 18)).approved, null, 'back to nobody having decided');

  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 18, approved: false }],
  });
  assert.equal((await dayOf(who, 18)).approved, false, 'and false is a real refusal');
});

test('a reason survives on a day with no mark at all — somebody rang in first', async () => {
  const who = staff.Punched;
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 23, reason: 'Rang to say he will not be in tomorrow' }],
  });
  const day = await dayOf(who, 23);
  assert.ok(day, 'the day was kept rather than thrown away for having no mark');
  assert.equal(day.code, '');
  assert.equal(day.reason, 'Rang to say he will not be in tomorrow');
});

test('approving a leave application fills both in by itself', async () => {
  const who = staff.Typed;
  const made = await api('POST', '/api/attendance/requests', {
    employee_id: who,
    period_id: periodId,
    day: 27,
    kind: 'leave',
    code: 'CL',
    reason: 'Family function in Surat',
  });
  assert.equal(made.status, 201);
  const decided = await api('POST', `/api/attendance/requests/${made.body.id}/decide`, {
    approve: true,
    by: 'Dinesh',
  });
  assert.equal(decided.status, 200);

  const day = await dayOf(who, 27);
  assert.equal(day.code, 'CL');
  // Nobody types the reason twice, and the grid cannot disagree with the queue.
  assert.equal(day.reason, 'Family function in Surat');
  assert.equal(day.approved, true);
});

/* ================================================================= *
 * The uniform check
 * ================================================================= */

test('the uniform check is three-state: not looked at is not a failure', async () => {
  const who = staff.Typed;
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 20, code: 'P' }],
  });
  // A floor nobody walked must not read as a floor full of offenders.
  assert.equal((await dayOf(who, 20)).uniform, null);

  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 20, uniform: false }],
  });
  assert.equal((await dayOf(who, 20)).uniform, false);

  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 20, uniform: null }],
  });
  assert.equal((await dayOf(who, 20)).uniform, null, 'handed back, not turned into a pass');
});

test('the uniform check moves no money either', async () => {
  const who = staff.Punched;
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 21, code: 'P' }],
  });
  const before = await rowOf(who);

  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 21, uniform: false }],
  });
  const after = await rowOf(who);
  for (const field of ['gross_salary', 'net_salary', 'absent_days', 'present_days', 'pt', 'pf']) {
    assert.equal(after[field], before[field], `${field} moved`);
  }
});

test('a uniform verdict survives the grid, the clock and the punch import', async () => {
  const who = staff.Imported;
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 22, code: 'P', uniform: false, reason: 'No ID card' }],
  });
  // The toolbar: a code and minutes, naming neither.
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 22, code: 'P', minutes: 0 }],
  });
  // A punch: times only.
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 22, in_time: '09:30', out_time: '18:30' }],
  });
  const day = await dayOf(who, 22);
  assert.equal(day.uniform, false);
  assert.equal(day.reason, 'No ID card');
});

/* ================================================================= *
 * A few hours off — and never charging the same hours twice
 * ================================================================= *
 *
 * Dinesh: "what if employee apply leave for 2 hrs 3 hrs 4 hrs / need
 * deduction for that type of leave".
 *
 * The app could always DEDUCT a few hours — that is the minutes column the
 * sheet has always paid from — but nobody could ASK for them. The rule that
 * matters is the one the late/early concession hangs on: the same afternoon
 * must never be docked twice.
 */

test('a few hours off deducts, on a day the clock says nothing about', async () => {
  const who = staff.Typed;
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 24, code: 'P' }],
  });
  const before = await rowOf(who);

  const made = await api('POST', '/api/attendance/requests', {
    employee_id: who,
    period_id: periodId,
    day: 24,
    kind: 'short_leave',
    minutes: 120,
    reason: 'Bank work',
  });
  assert.equal(made.status, 201);
  // Pending changes nothing, like every other request.
  assert.equal((await dayOf(who, 24)).minutes, 0);
  assert.equal((await rowOf(who)).net_salary, before.net_salary);

  const decided = await api('POST', `/api/attendance/requests/${made.body.id}/decide`, {
    approve: true,
    by: 'Dinesh',
  });
  assert.equal(decided.status, 200);

  const day = await dayOf(who, 24);
  assert.equal(day.minutes, -120, 'two hours off the day');
  assert.equal(day.code, 'P', 'the day is still Present — only the hours moved');
  assert.equal(day.reason, 'Bank work');
  // And it costs exactly two hours at this person's minute rate.
  const after = await rowOf(who);
  assert.equal(before.net_salary - after.net_salary, Math.round(120 * PER_MINUTE));
  assert.match(decided.body.decision_note || '', /deducted/);
});

test('but NOT twice, when the clock already shows the day short', async () => {
  const who = staff.Punched;
  // Clocked in at 9:30 and away at 16:30 — the sheet already docks the hours.
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 25, in_time: '09:30', out_time: '16:30' }],
  });
  const clocked = await dayOf(who, 25);
  assert.ok(clocked.minutes < 0, 'the clock already found the shortfall');
  const before = await rowOf(who);

  const made = await api('POST', '/api/attendance/requests', {
    employee_id: who,
    period_id: periodId,
    day: 25,
    kind: 'short_leave',
    minutes: 120,
    reason: 'Left for the bank',
  });
  const decided = await api('POST', `/api/attendance/requests/${made.body.id}/decide`, {
    approve: true,
    by: 'Dinesh',
  });
  assert.equal(decided.status, 200);

  const after = await dayOf(who, 25);
  assert.equal(after.minutes, clocked.minutes, 'the hours the clock found still stand');
  assert.equal(after.reason, 'Left for the bank', 'and now they have a reason beside them');
  assert.equal((await rowOf(who)).net_salary, before.net_salary, 'nobody was docked twice');
  assert.match(decided.body.decision_note || '', /not deducted twice/);
});

test('a whole day or more is refused — that is a leave application', async () => {
  const tooLong = await api('POST', '/api/attendance/requests', {
    employee_id: staff.Typed,
    period_id: periodId,
    day: 26,
    kind: 'short_leave',
    minutes: 9 * 60,
    reason: 'the whole day',
  });
  assert.equal(tooLong.status, 400);
  assert.match(tooLong.body.error, /whole day|leave instead/i);

  const tooShort = await api('POST', '/api/attendance/requests', {
    employee_id: staff.Typed,
    period_id: periodId,
    day: 26,
    kind: 'short_leave',
    minutes: 5,
    reason: 'five minutes',
  });
  assert.equal(tooShort.status, 400);
});

test('rejecting a few hours off writes nothing at all', async () => {
  const who = staff.Imported;
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: who, day: 27, code: 'P' }],
  });
  const made = await api('POST', '/api/attendance/requests', {
    employee_id: who,
    period_id: periodId,
    day: 27,
    kind: 'short_leave',
    minutes: 180,
    reason: 'Personal work',
  });
  await api('POST', `/api/attendance/requests/${made.body.id}/decide`, {
    approve: false,
    by: 'Dinesh',
  });
  const day = await dayOf(who, 27);
  assert.equal(day.minutes, 0);
  assert.equal(day.reason, '');
});
