/**
 * The pull that runs on a timer, with nobody watching.
 *
 * What it must never do is the whole of this file: open a month, write into a
 * locked one, overrule a mark somebody set, or throw and take the server down.
 * It may always COLLECT, because collecting cannot cost anybody a day's pay.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-devauto-'));
process.env.DATA_DIR = DATA;
process.env.LINK_SECRET = 'test-secret';

const { CMD, readTcp, tcpPacket } = await import('../../shared/zkProtocol.js');
const db = await import('../src/db.js');
const devices = await import('../src/devices.js');

const at = (day, hour, minute) =>
  ((((26 * 12 + 10) * 31 + (day - 1)) * 24 + hour) * 60 + minute) * 60;   // November 2026

const record = (user, seconds) => {
  const b = Buffer.alloc(40);
  b.writeUInt16LE(1, 0);
  Buffer.from(String(user), 'latin1').copy(b, 2);
  b.writeUInt32LE(seconds, 27);
  b[31] = 1;
  return b;
};

let log = Buffer.concat([record('128', at(20, 9, 14)), record('128', at(20, 18, 12))]);
const reader = net.createServer((socket) => {
  let buffer = Buffer.alloc(0);
  socket.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);
    for (;;) {
      const packet = readTcp(buffer);
      if (!packet || packet.error) break;
      buffer = buffer.subarray(packet.consumed);
      const say = (c, p) => socket.write(tcpPacket(c, { sessionId: 1, replyId: packet.replyId, data: p }));
      if (packet.command === CMD.DATA_WRRQ) say(CMD.DATA, log);
      else say(CMD.ACK_OK);
    }
  });
  socket.on('error', () => {});
});
const port = await new Promise((r) => reader.listen(0, '127.0.0.1', () => r(reader.address().port)));
test.after(() => reader.close());

const company = db.createCompany({ name: 'BNF' });
const amit = db.createEmployee({
  name: 'AMIT SHAH', code: 'BNF-EMP-0043', device_code: '128',
  company_id: company.id, monthly_salary: 26000, joined_on: '2024-01-01',
});
devices.createDevice({ name: 'IN gate', host: '127.0.0.1', port });

const november = new Date('2026-11-25T10:00:00Z');

test('WITH NO OPEN MONTH IT STILL COLLECTS, AND OPENS NOTHING', async () => {
  const run = await devices.autoPullOnce(november);
  assert.equal(run.added, 2, 'the punches must be kept whatever the month is doing');
  assert.match(run.note, /11\/2026 is not open/);
  assert.equal(db.listPeriods().length, 0, 'a timer must not open a month');
});

test('with a month open it marks the day', async () => {
  const period = db.createPeriod({ month: 11, year: 2026 });
  const run = await devices.autoPullOnce(november);
  assert.ok(run.written > 0, `nothing was written: ${JSON.stringify(run)}`);

  const row = db.listAttendance(period.id).find((r) => r.employee_id === amit.id && r.day === 20);
  assert.equal(row.code, 'P');
  assert.equal(row.in_time, '09:14');
});

test('a locked month is left alone, and the punches are still collected', async () => {
  const period = db.listPeriods()[0];
  db.updatePeriod(period.id, { locked: 1 });
  log = Buffer.concat([log, record('128', at(21, 9, 30)), record('128', at(21, 18, 30))]);

  const run = await devices.autoPullOnce(november);
  assert.equal(run.added, 2, 'collecting must carry on');
  assert.match(run.note, /locked/);
  assert.ok(!db.listAttendance(period.id).some((r) => r.day === 21), 'a locked month must not be written');
  db.updatePeriod(period.id, { locked: 0 });
});

test('it never overrules a mark somebody set', async () => {
  const period = db.listPeriods()[0];
  db.setAttendance(period.id, [{ employee_id: amit.id, day: 21, code: 'CL' }]);
  const run = await devices.autoPullOnce(november);
  assert.ok(run.keptMarks > 0);
  const row = db.listAttendance(period.id).find((r) => r.employee_id === amit.id && r.day === 21);
  assert.equal(row.code, 'CL');
  assert.equal(row.in_time, '09:30', 'the clock times still land');
});

test('a reader that is not there does not throw, and is recorded', async () => {
  const dud = devices.createDevice({ name: 'Dud', host: '127.0.0.1', port: 1 }).device;
  const run = await devices.autoPullOnce(november);
  assert.equal(run.failed.length, 1);
  assert.equal(run.failed[0].name, 'Dud');
  assert.ok(devices.lastDevicePull(), 'the last run must be readable, or "automatic" cannot be checked');
  devices.deleteDevice(dud.id);
});

test('OFF unless the office asks, and the floor is one minute', () => {
  delete process.env.DEVICE_PULL_MINUTES;
  assert.equal(devices.pullMinutes(), 0);
  process.env.DEVICE_PULL_MINUTES = '0';
  assert.equal(devices.pullMinutes(), 0);
  process.env.DEVICE_PULL_MINUTES = 'soon';
  assert.equal(devices.pullMinutes(), 0);
  process.env.DEVICE_PULL_MINUTES = '0.2';
  assert.equal(devices.pullMinutes(), 1);
  process.env.DEVICE_PULL_MINUTES = '10';
  assert.equal(devices.pullMinutes(), 10);
  delete process.env.DEVICE_PULL_MINUTES;
  devices.stopDevicePulls();
});
