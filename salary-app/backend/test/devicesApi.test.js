/**
 * Our own collector, end to end: a reader on the loopback, pulled, stored,
 * and put onto the grid.
 *
 * The two claims this exists to prove:
 *
 *  1. A PULL CANNOT MOVE MONEY. It copies punches into a store of ours and
 *     stops. Attendance changes only when somebody imports, and only after a
 *     dry run that writes nothing.
 *  2. PULLING THE SAME READER AGAIN FILES NOTHING TWICE. We never erase a
 *     reader, so every pull brings back the whole log it still holds. If that
 *     doubled the punches the design would not work at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-dev-'));
process.env.DATA_DIR = DATA;
process.env.APP_PASSWORD = 'the-key';
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';

const { CMD, readTcp, tcpPacket } = await import('../../shared/zkProtocol.js');
const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

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

const importStored = async (periodId, dryRun) => {
  const form = new FormData();
  form.append('dry_run', String(dryRun));
  const res = await fetch(`${base}/api/periods/${periodId}/device-punches`, {
    method: 'POST',
    headers: { authorization: 'Bearer the-key' },
    body: form,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

/* ---------------- a reader of our own ---------------- */

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

let log = Buffer.alloc(0);
const reader = net.createServer((socket) => {
  let buffer = Buffer.alloc(0);
  socket.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);
    for (;;) {
      const packet = readTcp(buffer);
      if (!packet || packet.error) break;
      buffer = buffer.subarray(packet.consumed);
      const say = (command, payload) =>
        socket.write(tcpPacket(command, { sessionId: 0x4321, replyId: packet.replyId, data: payload }));
      if (packet.command === CMD.DATA_WRRQ) say(CMD.DATA, log);
      else say(CMD.ACK_OK);
    }
  });
  socket.on('error', () => {});
});
const readerPort = await new Promise((r) => reader.listen(0, '127.0.0.1', () => r(reader.address().port)));

test.after(() => { server.close(); reader.close(); });

let period;
let amit;
let device;

test('a month, two people and a reader on the network', async () => {
  const company = await api('POST', '/api/companies', { name: 'BNF' });
  const a = await api('POST', '/api/employees', {
    name: 'AMIT SHAH', code: 'BNF-EMP-0043', device_code: '128',
    company_id: company.body.id, monthly_salary: 26000, joined_on: '2024-01-01',
  });
  amit = a.body;
  await api('POST', '/api/employees', {
    name: 'RIYA PAL', code: '114',
    company_id: company.body.id, monthly_salary: 24000, joined_on: '2024-01-01',
  });
  const p = await api('POST', '/api/periods', { month: 11, year: 2026 });
  period = p.body;

  const made = await api('POST', '/api/devices', {
    name: 'IN gate', host: '127.0.0.1', port: readerPort,
  });
  assert.equal(made.status, 201);
  device = made.body;
  assert.equal(device.port, readerPort);

  log = Buffer.concat([
    record('128', at(20, 9, 14)),
    record('128', at(20, 18, 12)),
    record('114', at(20, 9, 31)),
    record('114', at(20, 18, 40)),
    record('999', at(20, 9, 2)),      // a number nobody carries
  ]);
});

test('a reader is refused without a name or an address, in words', async () => {
  const a = await api('POST', '/api/devices', { host: '127.0.0.1' });
  assert.equal(a.status, 400);
  assert.match(a.body.error, /needs a name/);
  const b = await api('POST', '/api/devices', { name: 'Back door' });
  assert.equal(b.status, 400);
  assert.match(b.body.error, /address/);
});

test('testing a reader does not download its log', async () => {
  const res = await api('POST', `/api/devices/${device.id}/test`);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const store = await api('GET', '/api/devices');
  assert.equal(store.body.store.punches, 0, 'a test must collect nothing');
});

test('A PULL COLLECTS PUNCHES AND CHANGES NO ATTENDANCE', async () => {
  const before = await api('GET', `/api/periods/${period.id}/payroll`);
  const netBefore = before.body.rows.find((r) => r.employee_id === amit.id).net_salary;

  const res = await api('POST', `/api/devices/${device.id}/pull`);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.read, 5);
  assert.equal(res.body.added, 5);
  assert.equal(res.body.record_size, 40);
  assert.ok(res.body.sample.length > 0, 'the raw bytes must come back for checking');

  const grid = await api('GET', `/api/periods/${period.id}/attendance`);
  const marks = grid.body.employees.flatMap((e) => Object.values(e.attendance || {}));
  assert.equal(marks.length, 0, 'collecting punches must not mark anybody');

  const after = await api('GET', `/api/periods/${period.id}/payroll`);
  assert.equal(after.body.rows.find((r) => r.employee_id === amit.id).net_salary, netBefore);
});

test('PULLING THE SAME READER AGAIN FILES NOTHING TWICE', async () => {
  // Nothing erases the reader, so this is the ordinary case, not the odd one.
  const res = await api('POST', `/api/devices/${device.id}/pull`);
  assert.equal(res.body.read, 5);
  assert.equal(res.body.added, 0, 'the same punches must not be filed again');

  const store = await api('GET', '/api/devices');
  assert.equal(store.body.store.punches, 5);
  assert.equal(store.body.store.ids, 3);
});

test('a number nobody carries is named with its count, never guessed at', async () => {
  const res = await api('GET', '/api/devices');
  assert.deepEqual(
    res.body.unknownIds.map((r) => ({ id: r.device_code, punches: r.punches })),
    [{ id: '999', punches: 1 }],
  );
});

test('a look at the stored punches writes nothing', async () => {
  const res = await importStored(period.id, true);
  assert.equal(res.status, 200);
  assert.equal(res.body.dryRun, true);
  assert.equal(res.body.written, 0);
  assert.equal(res.body.collected, 5);
  assert.equal(res.body.matchedPeople, 2, 'the punch ID and the plain code must both match');

  const grid = await api('GET', `/api/periods/${period.id}/attendance`);
  const marks = grid.body.employees.flatMap((e) => Object.values(e.attendance || {}));
  assert.equal(marks.length, 0);
});

test('the import marks the day and records the hours', async () => {
  const res = await importStored(period.id, false);
  assert.equal(res.status, 200);
  assert.ok(res.body.written > 0);

  const grid = await api('GET', `/api/periods/${period.id}/attendance`);
  const mine = grid.body.employees.find((e) => e.employee_id === amit.id);
  assert.equal(mine.attendance[20].code, 'P');
  assert.equal(mine.attendance[20].in_time, '09:14');
  assert.equal(mine.attendance[20].out_time, '18:12');
});

test('A PUNCH MAY NOT OVERRULE A DECISION', async () => {
  await api('POST', `/api/periods/${period.id}/attendance`, {
    entries: [{ employee_id: amit.id, day: 21, code: 'CL' }],
  });
  log = Buffer.concat([log, record('128', at(21, 9, 5)), record('128', at(21, 18, 30))]);

  await api('POST', `/api/devices/${device.id}/pull`);
  const res = await importStored(period.id, false);
  assert.ok(res.body.keptMarks > 0, 'the leave day must be reported as kept');

  const grid = await api('GET', `/api/periods/${period.id}/attendance`);
  const mine = grid.body.employees.find((e) => e.employee_id === amit.id);
  assert.equal(mine.attendance[21].code, 'CL', 'casual leave must survive a punch');
  assert.equal(mine.attendance[21].in_time, '09:05', 'the clock times still land');
});

test('a reader that is not there is reported, not thrown', async () => {
  const made = await api('POST', '/api/devices', { name: 'Unplugged', host: '127.0.0.1', port: 1 });
  const res = await api('POST', `/api/devices/${made.body.id}/pull`);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /127\.0\.0\.1:1/);
  assert.equal(res.body.added, 0);

  const list = await api('GET', '/api/devices');
  const row = list.body.devices.find((d) => d.id === made.body.id);
  assert.ok(row.last_error, 'the reader row must say what went wrong');
  assert.ok(!row.last_ok_at, 'and must not claim it answered');
  await api('DELETE', `/api/devices/${made.body.id}`);
});

test('pulling every reader reports each one in turn', async () => {
  const dud = await api('POST', '/api/devices', { name: 'Dud', host: '127.0.0.1', port: 1 });
  const res = await api('POST', '/api/devices/pull');
  assert.equal(res.status, 200);
  assert.equal(res.body.devices.length, 2);
  assert.equal(res.body.failed.length, 1);
  assert.equal(res.body.failed[0].name, 'Dud');
  await api('DELETE', `/api/devices/${dud.body.id}`);
});

test('REMOVING A READER KEEPS ITS PUNCHES', async () => {
  // They are attendance already collected, and may already have been paid.
  const before = (await api('GET', '/api/devices')).body.store.punches;
  const gone = await api('DELETE', `/api/devices/${device.id}`);
  assert.equal(gone.status, 200);
  const after = await api('GET', '/api/devices');
  assert.equal(after.body.store.punches, before);
  assert.equal(after.body.devices.length, 0);
});

test('an import into a month with nothing collected says so', async () => {
  const other = await api('POST', '/api/periods', { month: 2, year: 2026 });
  const res = await importStored(other.body.id, true);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /nothing has been collected/);
});

test('a locked month is refused', async () => {
  await api('PATCH', `/api/periods/${period.id}`, { locked: 1 });
  const res = await importStored(period.id, false);
  assert.equal(res.status, 409);
  await api('PATCH', `/api/periods/${period.id}`, { locked: 0 });
});
