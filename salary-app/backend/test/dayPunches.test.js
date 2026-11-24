import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'daypunch-'));
const { createEmployee, createCompany, db } = await import('../src/db.js');
const { punchesByDay, saveSpoolPunches, savePunches, createDevice } = await import('../src/devices.js');

const company = createCompany({ name: 'BNF' });
const amit = createEmployee({ name: 'AMIT SHAH', company_id: company.id, code: 'BNF-EMP-0043', device_code: '37', monthly_salary: 26000 });
const riya = createEmployee({ name: 'RIYA PAL', company_id: company.id, code: '45', monthly_salary: 20000 });
const kiran = createEmployee({ name: 'KIRAN DESAI', company_id: company.id, code: 'BNF-EMP-0099', monthly_salary: 20000 });

const spool = (user, when, device = 'GUID-IN') => ({ user, when, device, verify: 255 });
const NOV = { year: 2026, month: 11 };

test('THE SAME PUNCH FILED TWICE IS STILL ONE PUNCH', () => {
  /*
   * This is the whole reason the `source` column exists. The spool belongs to
   * no reader of ours, so its rows carry device_id NULL - and SQLite treats
   * NULLs in a UNIQUE index as DISTINCT, so the original index would not have
   * stopped anything. Read every five minutes for a month, one punch would be
   * filed thousands of times and a day would read as the door opening all
   * afternoon.
   */
  const batch = [
    spool('37', '20-11-2026 09:12:01'),
    spool('37', '20-11-2026 11:40:33'),
    spool('37', '20-11-2026 18:02:44'),
  ];
  assert.deepEqual(saveSpoolPunches(batch), { seen: 3, added: 3 });
  assert.deepEqual(saveSpoolPunches(batch), { seen: 3, added: 0 }, 'the same batch again adds nothing');
  assert.deepEqual(saveSpoolPunches(batch), { seen: 3, added: 0 });
});

test('two gates recording the same second stay two punches', () => {
  // The reader's own id rides in `source`, so the key separates them. One
  // person cannot be in two doorways, but the data can say it and must not
  // silently lose one.
  saveSpoolPunches([spool('37', '21-11-2026 09:00:00', 'GUID-IN')]);
  saveSpoolPunches([spool('37', '21-11-2026 09:00:00', 'GUID-OUT')]);
  const { days } = punchesByDay(amit, NOV);
  assert.equal(days[21].length, 2);
});

test('the whole day comes back in order, as clock times', () => {
  const { days, matched_on } = punchesByDay(amit, NOV);
  assert.equal(matched_on, 'punch_id');
  /*
   * The SECONDS are kept. A day with two punches in the same minute reads as
   * the same time twice unless they can be told apart - and that is exactly
   * the day whose out time is blank and most needs explaining. How much to
   * show is the screen's decision (`punchTimes`), not the store's.
   */
  assert.deepEqual(days[20].map((p) => p.at), ['09:12:01', '11:40:33', '18:02:44']);
  assert.ok(days[20].every((p) => p.where === 'reader'));
});

test('a leading zero is the same enrolment', () => {
  saveSpoolPunches([spool('0037', '22-11-2026 10:00:00')]);
  assert.deepEqual(punchesByDay(amit, NOV).days[22].map((p) => p.at), ['10:00:00']);
});

test('somebody matched on a numeric employee code is found; somebody unreachable is EMPTY, not wrong', () => {
  saveSpoolPunches([spool('45', '20-11-2026 09:30:00')]);
  const forRiya = punchesByDay(riya, NOV);
  assert.equal(forRiya.matched_on, 'code');
  assert.deepEqual(forRiya.days[20].map((p) => p.at), ['09:30:00']);

  /*
   * KIRAN has no Punch ID and an employee code no reader will ever send, and
   * he has punched nothing from a phone either. The honest answer is an empty
   * map and no id: nobody ever looked for him, which is not the same as him
   * never punching. Guessing a match here would put somebody else's door
   * openings on his statement.
   *
   * This test used to pin the whole object, which encoded an early return
   * that has since gone - the phone punches below are read whatever the
   * reader can or cannot do. It states the RULE now rather than the shape.
   */
  const forKiran = punchesByDay(kiran, NOV);
  assert.equal(forKiran.matched_on, '', 'no reader can reach him, and that has not changed');
  assert.deepEqual(forKiran.days, {});
});

test('SOMEBODY NO READER CAN REACH still sees what they punched themselves', () => {
  /*
   * The point of a phone punch is that it names its person, so it needs no
   * reader number. Returning early on a missing Punch ID - which is what this
   * did - hid somebody's own punches from them on their own page, which is
   * precisely what Dinesh reported in v2.1.0 about the other half of this.
   *
   * Stored as ISO (UTC) and read back through `localStamp`, so the time is
   * the one the clock on the wall showed.
   */
  const at = new Date(2026, 10, 21, 9, 42, 30); // 21 Nov 2026, local
  db.prepare(
    `INSERT INTO punch_events (employee_id, at, day, kind, located, note, source)
     VALUES (?, ?, ?, 'in', 0, '', 'portal')`
  ).run(kiran.id, at.toISOString(), at.toISOString().slice(0, 10));

  const forKiran = punchesByDay(kiran, NOV);
  assert.equal(forKiran.matched_on, '', 'a phone punch does not make a reader able to find him');
  assert.deepEqual(forKiran.days[21].map((p) => p.at), ['09:42:30']);
  assert.equal(forKiran.days[21][0].where, 'their login');
});

test('another month is not this month', () => {
  saveSpoolPunches([spool('37', '20-10-2026 09:00:00')]);
  assert.equal(punchesByDay(amit, NOV).days[20].length, 3, 'October did not leak into November');
  assert.equal(punchesByDay(amit, { year: 2026, month: 10 }).days[20].length, 1);
});

test('a line with no readable stamp is dropped, not filed as something else', () => {
  assert.deepEqual(saveSpoolPunches([spool('37', 'rubbish'), { user: '', when: '20-11-2026 09:00:00' }]), {
    seen: 2,
    added: 0,
  });
});

test("our own readers' punches are NOT re-keyed as spool rows", () => {
  /*
   * Two stores under one roof. A reader's punch is keyed on (code, time,
   * device_id) and a spool punch on (code, time, source); if the spool key
   * also caught reader rows, a day collected by both would lose half of
   * itself. They are the same punch twice over and both are shown, which is
   * the honest record - the person really did go through two doors.
   */
  // createDevice returns { device }, not the row.
  const { device } = createDevice({ name: 'IN gate', host: '192.168.1.7' });
  savePunches(device.id, [{ user: '37', at: '2026-11-23 09:05:00' }]);
  savePunches(device.id, [{ user: '37', at: '2026-11-23 09:05:00' }]);
  saveSpoolPunches([spool('37', '23-11-2026 09:05:00')]);

  const { days } = punchesByDay(amit, NOV);
  assert.equal(days[23].length, 2, 'the reader filed one and the spool one; the reader did not file two');
  assert.deepEqual(days[23].map((p) => p.where).sort(), ['IN gate', 'reader']);
});
