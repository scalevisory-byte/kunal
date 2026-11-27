/**
 * A weekly off somebody clocked in on.
 *
 * HR, off the live Sunday tab: "ama sunday present show nathi thatu / count
 * alag thi nathi krtu". The punch import knew nothing about a day off - a
 * Sunday came out P or HF, or stayed S - so SP was never written by anything
 * but a person, and SP is the only mark the Sunday register reads.
 *
 * These pin the rule (six hours done is SP, anything less is still the day
 * off), every path that writes it, and the things it must never touch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { calculateRow } from '../../shared/calc.js';
import {
  OFF_DAY_MAY_BECOME,
  offDayEntries,
  offDaySentence,
  offDaysNotOnRegister,
  offDayVerdict,
  ownWeeklyOff,
  priceOffDays,
  settleOffDays,
  sundayDutyFor,
} from '../../shared/sundayDuty.js';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-offday-'));
const SPOOL = fs.mkdtempSync(path.join(os.tmpdir(), 'offdayspool-'));
process.env.DATA_DIR = DATA;
process.env.APP_PASSWORD = 'the-key';
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
process.env.BIZCOMPASS_DIR = SPOOL;

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
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const importSpool = async (periodId, dryRun) => {
  const form = new FormData();
  form.append('dry_run', String(dryRun));
  const res = await fetch(`${base}/api/periods/${periodId}/bizcompass`, {
    method: 'POST',
    headers: { authorization: 'Bearer the-key' },
    body: form,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const G = '17c5b74f-8de9-4840-b565-9fcc32280df3';
const writeBatch = (name, lines) =>
  fs.writeFileSync(path.join(SPOOL, name), lines.map((l) => `${l}\t255\t${G}\t0`).join('\n'));

// November 2026: the Sundays are 1, 8, 15, 22 and 29; the 12th is a Thursday.
const PERIOD = { year: 2026, month: 11, hours_per_day: 9, lunch_paid: 1, pt_threshold: 12000, pt_amount: 200, late_policy: 'none' };

/* ------------------------------ the rule ------------------------------ */

test('six hours done is SP; under it, or not known, is still the day off', () => {
  assert.equal(offDayVerdict({ in_time: '09:00', out_time: '15:00' }, PERIOD).code, 'SP', 'six on the nose');
  assert.equal(offDayVerdict({ in_time: '09:00', out_time: '14:59' }, PERIOD).code, 'S');
  const unknown = offDayVerdict({ in_time: '09:00', out_time: '' }, PERIOD);
  assert.equal(unknown.code, 'S', 'not known is not six hours');
  assert.equal(unknown.full, null, '...and it is not "under six" either');
  assert.equal(unknown.worked, null);
  assert.equal(offDayVerdict({ in_time: '09:00', out_time: '17:00' }, { ...PERIOD, sunday_hours: 8 }).code, 'SP');
  assert.equal(offDayVerdict({ in_time: '09:00', out_time: '15:30' }, { ...PERIOD, sunday_hours: 8 }).code, 'S', 'the month names its own line');
});

test('the six hours follow the month’s own lunch rule - here and on the register', () => {
  const day = { in_time: '09:00', lunch_out: '12:00', lunch_in: '12:40', out_time: '15:00' };
  assert.equal(offDayVerdict(day, { ...PERIOD, lunch_paid: 1 }).code, 'SP', 'lunch inside the paid day');
  assert.equal(offDayVerdict(day, { ...PERIOD, lunch_paid: 0 }).code, 'S', 'lunch taken out leaves 5h 20m');
  // The register read the default and called this very day short on a month
  // whose break is inside the paid day.
  const row = { attendance: { 8: { code: 'SP', ...day } } };
  assert.equal(sundayDutyFor(row, { ...PERIOD, lunch_paid: 1 }).shortDays.length, 0);
  assert.equal(sundayDutyFor(row, { ...PERIOD, lunch_paid: 0 }).shortDays.length, 1);
});

test('whose day off it is: their own, else the company’s, else Sunday', () => {
  assert.equal(ownWeeklyOff({}, PERIOD, 8), true);
  assert.equal(ownWeeklyOff({}, PERIOD, 9), false);
  const thursday = { weekly_off: JSON.stringify({ days: [4] }) };
  assert.equal(ownWeeklyOff(thursday, PERIOD, 12), true, 'a driver off on Thursday');
  assert.equal(ownWeeklyOff(thursday, PERIOD, 8), false, '...for whom Sunday is a working day');
  const company = { company_weekly_off: JSON.stringify({ days: [0], alternate: { day: 6, weeks: [2, 4] } }) };
  assert.equal(ownWeeklyOff(company, PERIOD, 14), true, 'the 2nd Saturday');
  assert.equal(ownWeeklyOff(company, PERIOD, 7), false, 'the 1st is worked');
});

test('only a mark nobody chose, or the day off itself, gives way', () => {
  assert.deepEqual([...OFF_DAY_MAY_BECOME].sort(), ['', 'A', 'HF', 'P', 'S']);
  const entries = [
    { employee_id: 1, day: 8, code: 'P', minutes: 30, in_time: '09:00', out_time: '18:30' },
    { employee_id: 2, day: 8, code: 'HF', minutes: 0, in_time: '10:00', out_time: '13:00' },
    { employee_id: 3, day: 8, code: 'P', minutes: 0, in_time: '09:00', out_time: '' },
    { employee_id: 4, day: 8, code: 'P', minutes: -20, in_time: '09:30', out_time: '18:10' }, // on leave
    { employee_id: 5, day: 8, code: 'P', minutes: 0, in_time: '10:00', out_time: '12:00' }, // office said SP
    { employee_id: 1, day: 9, code: 'P', minutes: -15, in_time: '09:45', out_time: '18:30' }, // a Monday
    { employee_id: 9, day: 8, code: 'P', minutes: 0, in_time: '09:00', out_time: '18:00' }, // nobody we know
  ];
  const stored = (id, day) => (day === 8 ? { 3: 'S', 4: 'CL', 5: 'SP' }[id] || '' : '');
  const got = settleOffDays(entries, { period: PERIOD, personOf: (id) => (id === 9 ? null : {}), stored });
  const on = (id, day) => got.entries.find((e) => e.employee_id === id && e.day === day);

  assert.equal(on(1, 8).code, 'SP');
  assert.equal(on(1, 8).minutes, 0, 'paid by the day, never by the minute');
  assert.equal(on(1, 8).in_time, '09:00', 'the times go through');
  assert.equal(on(2, 8).code, 'S', 'three hours on a day off is NOT half a day absent');
  assert.equal(on(3, 8).code, 'S');
  assert.equal(on(4, 8).code, 'P', 'leave is left for the guard that protects it');
  assert.equal(on(4, 8).minutes, -20);
  assert.equal(on(5, 8).code, 'P', 'an SP somebody set is theirs');
  assert.equal(on(1, 9).code, 'P', 'a working day is untouched');
  assert.equal(on(1, 9).minutes, -15);
  assert.equal(on(9, 8).code, 'P', 'nobody is guessed at');

  assert.deepEqual([...got.settled].sort(), ['1:8', '2:8', '3:8']);
  assert.deepEqual(got.summary, { worked: 1, short: 1, unknown: 1, wasHalfDay: 1, wasPresent: 2, wasShort: 0, wasOver: 1 });
});

test('the catch-up finds what is already on the grid, in three piles', () => {
  const rows = [
    { id: 11, employee_id: 1, employee_name: 'AMIT', salary: 26000, attendance: {
      8: { code: 'P', in_time: '09:00', out_time: '15:30' },
      15: { code: 'S', in_time: '09:00', out_time: '16:00' },
      22: { code: 'SP', in_time: '09:00', out_time: '11:00' }, // already on the register
      9: { code: 'P', in_time: '09:30', out_time: '18:30' },
    } },
    { id: 12, employee_id: 2, employee_name: 'RIYA', salary: 26000, attendance: {
      8: { code: 'HF', in_time: '10:00', out_time: '13:00' },
      15: { code: 'P', in_time: '10:00', out_time: '' },
      22: { code: 'S' }, // off, nobody came
      29: { code: 'CL', in_time: '10:00', out_time: '17:00' },
    } },
  ];
  const found = offDaysNotOnRegister(rows, PERIOD);
  assert.deepEqual(found.full.map((l) => [l.employee_name, l.day]), [['AMIT', 8], ['AMIT', 15]]);
  assert.deepEqual(found.short.map((l) => [l.employee_name, l.day, l.short]), [['RIYA', 8, 180]]);
  assert.deepEqual(found.unknown.map((l) => [l.employee_name, l.day]), [['RIYA', 15]]);
  assert.deepEqual(found.docked.map((l) => l.day), [8], 'the half day is costing her pay');
  assert.equal(found.lines.length, 4, 'SP, an empty S, leave and a Monday are not questions');

  // The write names the mark and its minutes and nothing else.
  assert.deepEqual(offDayEntries(found.full, 'SP'), [
    { employee_id: 1, day: 8, code: 'SP', minutes: 0 },
    { employee_id: 1, day: 15, code: 'SP', minutes: 0 },
  ]);
});

test('times on a day are not proof anybody was there', () => {
  // "Fill the usual timings" pressed on a Sunday: nine hours for the whole
  // office, and not one of them worked. Offered in bulk, that is a day's pay
  // each for a day nobody came in.
  const P = { ...PERIOD, shift_in: '09:30', shift_out: '18:30' };
  const rows = [
    { id: 11, employee_id: 1, employee_name: 'AMIT', attendance: { 8: { code: 'P', in_time: '09:30', out_time: '18:30' } } },
    { id: 12, employee_id: 2, employee_name: 'RIYA', attendance: { 8: { code: 'P', in_time: '09:12', out_time: '16:05' } } },
    { id: 13, employee_id: 3, employee_name: 'NIGHT', shift_in: '14:00', shift_out: '23:00',
      attendance: { 8: { code: 'P', in_time: '14:00', out_time: '23:00' } } },
  ];

  // With the month's punch record: a punch is the evidence, nothing else is.
  const known = offDaysNotOnRegister(rows, P, { punches: { 2: { 8: [{ at: '09:12' }, { at: '16:05' }] } } });
  assert.deepEqual(known.full.map((l) => l.employee_name), ['RIYA']);
  assert.deepEqual(known.typed.map((l) => l.employee_name), ['AMIT', 'NIGHT']);
  assert.equal(known.typed[0].punched, false);

  // A typed day the readers DID see is still clocked, usual timings or not.
  const seen = offDaysNotOnRegister(rows, P, { punches: { 1: { 8: [{ at: '09:30' }] } } });
  assert.deepEqual(seen.full.map((l) => l.employee_name), ['AMIT']);

  // No record to ask (the single file): exactly the usual day is a fill.
  const blind = offDaysNotOnRegister(rows, P);
  assert.deepEqual(blind.full.map((l) => l.employee_name), ['RIYA']);
  assert.deepEqual(blind.typed.map((l) => l.employee_name), ['AMIT', 'NIGHT'], 'judged against their OWN shift');
  assert.equal(blind.typed[0].punched, null, 'not known is not "no punch"');
  assert.equal(blind.typed[0].looksFilled, true);
});

test('what it moves is read off calculateRow, both ways', () => {
  const amit = { salary: 26000, attendance: { 8: { code: 'P', in_time: '09:00', out_time: '15:30' } } };
  const moved = priceOffDays(amit, PERIOD, { 8: 'SP' });
  assert.equal(moved.sunday, 1000, 'one day at 26,000 / 26');
  assert.equal(moved.net, 0, 'the month’s own net does not move');

  const riya = { salary: 26000, attendance: { 8: { code: 'HF', in_time: '10:00', out_time: '13:00' } } };
  const before = calculateRow(riya, PERIOD, riya.attendance);
  assert.equal(before.absent_days, 0.5, 'the half day really was docking her');
  const back = priceOffDays(riya, PERIOD, { 8: 'S' });
  assert.equal(back.net, 500, 'half a day comes back');
  assert.equal(back.sunday, 0, 'and nobody goes on the register by it');
});

test('the dry run says it in one sentence, and says nothing when there is nothing', () => {
  assert.equal(offDaySentence({}), '');
  assert.equal(offDaySentence({ worked: 0, short: 0, unknown: 0 }), '');
  const said = offDaySentence({ worked: 2, short: 1, unknown: 1 }, 6);
  assert.match(said, /2 weekly offs were worked for the 6 hours/);
  assert.match(said, /Sunday register as SP/);
  assert.match(said, /not in the month's net/);
  assert.match(said, /1 was under 6 hours/);
  assert.match(said, /1 has no out time yet/);
});

/* --------------------------- through the import --------------------------- */

let period;
let amit;
let riya;
let kiran;
const gridOf = async (id) => {
  const grid = await api('GET', `/api/periods/${period.id}/attendance`);
  return grid.body.employees.find((e) => e.employee_id === id).attendance;
};

test('a month, three people - one of them off on Thursdays', async () => {
  const company = await api('POST', '/api/companies', { name: 'BNF' });
  const make = (body) => api('POST', '/api/employees', { company_id: company.body.id, monthly_salary: 26000, joined_on: '2024-01-01', ...body });
  amit = (await make({ name: 'AMIT SHAH', code: 'E101', device_code: '37' })).body;
  riya = (await make({ name: 'RIYA PAL', code: '114' })).body;
  kiran = (await make({ name: 'KIRAN DAVE', code: '120', weekly_off: JSON.stringify({ days: [4] }) })).body;
  period = (await api('POST', '/api/periods', { month: 11, year: 2026 })).body;

  // The office had already decided two things before any punch arrived.
  const res = await api('POST', `/api/periods/${period.id}/attendance`, {
    entries: [
      { employee_id: riya.id, day: 22, code: 'SP' }, // "count her Sunday"
      { employee_id: amit.id, day: 22, code: 'S' }, // Mark everyone Present wrote the off
      { employee_id: riya.id, day: 15, code: 'CL' }, // leave that happens to be a Sunday
    ],
  });
  assert.equal(res.status, 200);

  writeBatch('LogFile_11_08_19_00_00_000.dat', [
    '37\t08-11-2026 09:00:00', '37\t08-11-2026 15:30:00', // six and a half hours
    '114\t08-11-2026 10:00:00', '114\t08-11-2026 13:00:00', // three hours
    '120\t08-11-2026 09:30:00', '120\t08-11-2026 18:30:00', // his working day
    '120\t12-11-2026 09:00:00', '120\t12-11-2026 16:00:00', // his own day off, seven hours
    '37\t15-11-2026 09:00:00', // one punch
    '114\t15-11-2026 10:00:00', '114\t15-11-2026 17:00:00', // on leave
    '37\t22-11-2026 09:00:00', '37\t22-11-2026 15:10:00', // S on the grid already
    '114\t22-11-2026 10:00:00', '114\t22-11-2026 12:00:00', // SP on the grid already
  ]);
});

test('the look says what the days off come to, and writes nothing', async () => {
  const res = await importSpool(period.id, true);
  assert.equal(res.status, 200);
  assert.equal(res.body.written, 0);
  assert.deepEqual(
    { worked: res.body.offDays.worked, short: res.body.offDays.short, unknown: res.body.offDays.unknown },
    { worked: 3, short: 1, unknown: 1 }
  );
  assert.equal(res.body.sundayHours, 6);
  // Two short Sundays are in the spool. The one on the 8th is the off-day
  // rule's and is no longer a half day; the one on the 22nd is under an SP the
  // office set, which the summary has always counted and the guard protects.
  assert.equal(res.body.summary.halfDay, 1, 'the three-hour Sunday is not reported as a half day it will not write');
  assert.equal(res.body.keptMarks, 2, 'the SP and the leave');
  assert.equal((await gridOf(amit.id))[8], undefined, 'a look must not write');
});

test('six hours on a day off is written SP and reaches the Sunday register', async () => {
  const res = await importSpool(period.id, false);
  assert.equal(res.status, 200);

  const a = await gridOf(amit.id);
  assert.equal(a[8].code, 'SP', 'a blank Sunday worked six hours');
  assert.equal(a[8].in_time, '09:00');
  assert.equal(a[8].out_time, '15:30');
  assert.equal(a[8].minutes || 0, 0, 'no overtime on a day paid by the day');
  assert.equal(a[22].code, 'SP', 'a Sunday already marked S is lifted - or the rule could never work on a live feed');
  assert.equal(a[15].code, 'S', 'one punch: the day off stands until a departure arrives');
  assert.equal(a[15].in_time, '09:00');
  assert.ok(!a[15].out_time, 'nothing invents a departure');

  const k = await gridOf(kiran.id);
  assert.equal(k[12].code, 'SP', 'his day off is Thursday, and he worked it');
  assert.equal(k[8].code, 'P', 'Sunday is an ordinary working day for him');

  const payroll = await api('GET', `/api/periods/${period.id}/payroll`);
  const row = (id) => payroll.body.rows.find((r) => r.employee_id === id);
  const calc = (id) => calculateRow(row(id), payroll.body.period, row(id).attendance);
  assert.equal(calc(amit.id).sundays_worked, 2);
  assert.equal(calc(amit.id).sunday_salary, 2000);
  assert.equal(calc(kiran.id).sundays_worked, 1);
});

test('under six hours stays the day off - and is never half a day absent', async () => {
  const r = await gridOf(riya.id);
  assert.equal(r[8].code, 'S', 'three hours on her day off used to be written HF');
  assert.equal(r[8].in_time, '10:00', 'the times are kept, for whoever decides');
  assert.equal(r[8].minutes || 0, 0);

  const payroll = await api('GET', `/api/periods/${period.id}/payroll`);
  const row = payroll.body.rows.find((x) => x.employee_id === riya.id);
  const calc = calculateRow(row, payroll.body.period, row.attendance);
  assert.equal(calc.absent_days, 0, 'coming in on a day off costs her nothing');
});

test('a mark somebody chose is still theirs', async () => {
  const r = await gridOf(riya.id);
  assert.equal(r[22].code, 'SP', 'the office counted her two-hour Sunday; a punch does not uncount it');
  assert.equal(r[22].in_time, '10:00');
  assert.equal(r[15].code, 'CL', 'leave on a Sunday is still leave, however long she was in');
});

test('the evening’s pull turns the one-punch Sunday into a Sunday worked', async () => {
  writeBatch('LogFile_11_15_19_00_00_000.dat', ['37\t15-11-2026 16:00:00']);
  const res = await importSpool(period.id, false);
  assert.equal(res.status, 200);
  const a = await gridOf(amit.id);
  assert.equal(a[15].code, 'SP');
  assert.equal(a[15].out_time, '16:00');
  // ...and running it again changes nothing.
  await importSpool(period.id, false);
  assert.equal((await gridOf(amit.id))[15].code, 'SP');
});

test('clock times with no mark - a phone punch, an approved missing punch - follow the same line', async () => {
  const send = (entries) => api('POST', `/api/periods/${period.id}/attendance`, { entries });
  await send([{ employee_id: amit.id, day: 29, in_time: '09:00', out_time: '15:30' }]);
  await send([{ employee_id: riya.id, day: 29, in_time: '10:00', out_time: '12:00' }]);
  await send([{ employee_id: kiran.id, day: 29, in_time: '10:00', out_time: '12:00' }]);
  assert.equal((await gridOf(amit.id))[29].code, 'SP');
  assert.equal((await gridOf(riya.id))[29].code, 'S', 'not HF');
  assert.equal((await gridOf(kiran.id))[29].code, 'HF', 'for him it IS a working day cut short');

  // A mark the caller NAMES is the caller's: the grid and the Sunday tab's own
  // buttons are decisions, not readings of the clock.
  await send([{ employee_id: riya.id, day: 1, code: 'P', in_time: '09:00', out_time: '18:00' }]);
  assert.equal((await gridOf(riya.id))[1].code, 'P');
});

/* ------------------------------ the screens ------------------------------ */

const read = (file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
const bare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('every path that sets a mark from the clock asks the one rule', () => {
  for (const file of ['../src/db.js', '../../frontend/src/localStore.js', '../../frontend/src/components/TimeSheet.jsx']) {
    const src = bare(read(file));
    assert.match(src, /offDayVerdict\(/, `${file} judges a day off by the six-hour line`);
    assert.match(src, /OFF_DAY_MAY_BECOME\.has\(/, `${file} only where the mark may give way`);
    assert.match(src, /ownWeeklyOff\(/, `${file} on the person’s OWN day off`);
  }
  assert.match(bare(read('../src/punchApply.js')), /settleOffDays\(/, 'the import, before the guard');
});

test('"Fill the usual timings" never writes onto somebody’s day off', () => {
  const tab = bare(read('../../frontend/src/components/TimeSheet.jsx'));
  const fill = tab.slice(tab.indexOf('const fillStandard'), tab.indexOf('const clearDay'));
  // Nine hours of usual timings on a Sunday would put the whole office on the
  // register in one press.
  assert.match(fill, /ownWeeklyOff\(row, period, d\)[\s\S]*?continue;/);
});

test('the Sunday tab offers the days already on the grid, and both import panels say the same sentence', () => {
  const tab = bare(read('../../frontend/src/components/SundayRegister.jsx'));
  assert.match(tab, /offDaysNotOnRegister\(computed, period, \{ punches:/, 'asked with the month’s punch record');
  assert.match(tab, /catchUp\.clocked\.filter\(/, 'the bulk "day off" button only touches what was clocked');
  assert.match(tab, /putOnRegister\(catchUp\.full\)/, 'the bulk button is the clocked six-hour days and nothing else');
  assert.match(tab, /priceOffDays\(/, 'what it costs is read, not multiplied out');
  assert.match(tab, /offDayEntries\(lines, 'SP'\)/);
  assert.match(tab, /offDayEntries\(toRest, 'S'\)/);
  for (const file of ['BizcompassImport.jsx', 'PunchDevices.jsx']) {
    assert.match(bare(read(`../../frontend/src/components/${file}`)), /offDaySentence\(preview\.offDays/, file);
  }
  const css = read('../../frontend/src/styles.css');
  for (const cls of ['off-day-catchup', 'off-day-actions', 'off-day-list']) {
    assert.ok(css.includes(`.${cls}`), `.${cls} has a rule`);
  }
});
