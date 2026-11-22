/**
 * Our own way to the attendance readers.
 *
 * None of this can be checked against the real firmware from here, so what it
 * CAN pin is pinned: the framing round-trips, a half-read reply is not read
 * as a refusal, a record size this does not know is reported rather than
 * guessed at — and the commands that could wipe a device are not in the file
 * at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  CMD,
  TCP_MAGIC,
  authData,
  checksum,
  decodeTime,
  packet,
  readAttendance,
  readTcp,
  recordSize,
  stamp,
  tcpPacket,
} from '../../shared/zkProtocol.js';

/* ---------------- the one that matters most ---------------- */

test('THERE IS NO CLEAR AND NO DELETE IN THE PROTOCOL FILE', () => {
  /*
   * The readers are set to wipe themselves after a download, so erasing
   * punches nobody has read is the one unrecoverable mistake available here.
   * The commands are not implemented and must never be: a bug cannot call
   * what does not exist.
   */
  const src = fs.readFileSync(new URL('../../shared/zkProtocol.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const danger of ['CLEAR_ATTLOG', 'CLEAR_DATA', 'DELETE_USER', 'CLEAR_ADMIN', '1004']) {
    assert.ok(!code.includes(danger), `${danger} must not be in the protocol`);
  }
  assert.ok(!/\bclear\b/i.test(code), 'nothing in the code may be called clear');
});

/* ---------------- framing ---------------- */

test('a packet carries its own checksum, and it checks out', () => {
  const p = packet(CMD.CONNECT, { sessionId: 0, replyId: 0 });
  assert.equal(p.readUInt16LE(0), CMD.CONNECT);
  const copy = Buffer.from(p);
  const was = copy.readUInt16LE(2);
  copy.writeUInt16LE(0, 2);
  assert.equal(checksum(copy), was, 'the checksum does not verify');
});

test('an odd-length payload is still summed whole', () => {
  // The last byte of an odd packet has no partner; dropping it gives a
  // checksum the device ignores in silence, which reads as "no answer".
  const p = packet(CMD.AUTH, { data: Buffer.from([1, 2, 3]) });
  const copy = Buffer.from(p);
  const was = copy.readUInt16LE(2);
  copy.writeUInt16LE(0, 2);
  assert.equal(checksum(copy), was);
});

test('the TCP wrapper states the length and round-trips', () => {
  const wire = tcpPacket(CMD.CONNECT, { sessionId: 7, replyId: 3 });
  assert.ok(wire.subarray(0, 4).equals(TCP_MAGIC));
  assert.equal(wire.readUInt32LE(4), wire.length - 8);
  const got = readTcp(wire);
  assert.equal(got.command, CMD.CONNECT);
  assert.equal(got.sessionId, 7);
  assert.equal(got.replyId, 3);
  assert.equal(got.consumed, wire.length);
});

test('HALF A REPLY IS NOT A REFUSAL', () => {
  // These arrive in pieces. Reading a short buffer as an answer is how a
  // working device reads as unreachable.
  const wire = tcpPacket(CMD.DATA, { data: Buffer.alloc(64, 7) });
  assert.equal(readTcp(wire.subarray(0, 10)), null);
  assert.equal(readTcp(wire.subarray(0, wire.length - 1)), null);
  assert.ok(readTcp(wire));
});

test('something that is not one of these devices is named, not parsed', () => {
  const junk = Buffer.alloc(32, 0xaa);
  assert.match(readTcp(junk).error, /not a reply/i);
});

test('the comm key is scrambled the same way every time, and is not the key', () => {
  const a = authData(1234, 99);
  const b = authData(1234, 99);
  assert.deepEqual(a, b);
  assert.equal(a.length, 4);
  assert.notDeepEqual(authData(1234, 99), authData(1234, 100), 'it must fold in the session');
});

/* ---------------- time ---------------- */

test('the device counts from 2000, and comes back in the shape the importer reads', () => {
  const t = decodeTime(0);
  assert.deepEqual(t, { year: 2000, month: 1, day: 1, hour: 0, minute: 0, second: 0 });
  assert.equal(stamp(t), '01-01-2000 00:00:00');
  // One day on.
  assert.equal(stamp(decodeTime(24 * 60 * 60)), '02-01-2000 00:00:00');
});

/* ---------------- records ---------------- */

test('the record size is worked out from the payload, never assumed', () => {
  assert.equal(recordSize(40 * 3), 40);
  assert.equal(recordSize(28 * 5), 28);
  assert.equal(recordSize(0), 0);
  assert.equal(recordSize(37), 0);
});

test('a firmware whose records this cannot read SAYS SO', () => {
  // Returning nothing would read as "nobody punched today", which is the one
  // thing it must never be mistaken for.
  const got = readAttendance(Buffer.alloc(37, 1));
  assert.deepEqual(got.punches, []);
  assert.match(got.error, /not a size this knows/);
  assert.ok(got.sample.length > 0, 'it must hand back the bytes so they can be read');
});

const NOV20 = ((((26 * 12 + 10) * 31 + 19) * 24 + 9) * 60 + 14) * 60; // 20 Nov 2026 09:14

const record40 = (user, seconds) => {
  const b = Buffer.alloc(40);
  b.writeUInt16LE(1, 0);
  Buffer.from(String(user), 'latin1').copy(b, 2);
  b[26] = 0;
  b.writeUInt32LE(seconds, 27);
  b[31] = 1;
  return b;
};

test('a 40-byte record reads out as a punch', () => {
  const seconds = ((((26 * 12 + 10) * 31 + 19) * 24 + 9) * 60 + 14) * 60 + 0; // 20 Nov 2026 09:14
  const got = readAttendance(Buffer.concat([record40('37', seconds)]));
  assert.equal(got.size, 40);
  assert.equal(got.punches.length, 1);
  assert.equal(got.punches[0].user, '37');
  assert.equal(got.punches[0].when, '20-11-2026 09:14:00');
});

test('THE USER ID IS TEXT, NOT A NUMBER', () => {
  // Some offices enrol as 0037. Dropping the zeros on one side of the
  // comparison is how a punch ends up belonging to nobody.
  const got = readAttendance(record40('0037', NOV20));
  assert.equal(got.punches[0].user, '0037');
});

test('several records come back in order, and rubbish between them is dropped', () => {
  const a = record40('12', NOV20);
  const b = record40('', NOV20 + 60); // no user - not a punch
  const c = record40('13', NOV20 + 120);
  const got = readAttendance(Buffer.concat([a, b, c]));
  assert.deepEqual(got.punches.map((p) => p.user), ['12', '13']);
});

test('a length prefix in front of the stream is skipped', () => {
  const body = Buffer.concat([record40('9', NOV20), record40('9', NOV20 + 60)]);
  const prefixed = Buffer.concat([(() => { const n = Buffer.alloc(4); n.writeUInt32LE(body.length, 0); return n; })(), body]);
  const got = readAttendance(prefixed);
  assert.equal(got.punches.length, 2);
});

test('A DATE THAT CANNOT BE RIGHT IS NOT FILED, AND IS COUNTED', () => {
  // Bytes read at the wrong offset still produce a date. One in 2001 is not a
  // punch, and an attendance row in a month nobody looks at is worse than an
  // error saying the firmware could not be read.
  const got = readAttendance(Buffer.concat([record40('7', 60), record40('8', 120)]));
  assert.deepEqual(got.punches, []);
  assert.equal(got.odd, 2);
  assert.match(got.error, /probably not 40-byte records/);
});

test('one odd date among good ones is dropped quietly, not called a failure', () => {
  const got = readAttendance(Buffer.concat([
    record40('1', NOV20), record40('2', NOV20 + 60), record40('3', 60),
  ]));
  assert.deepEqual(got.punches.map((p) => p.user), ['1', '2']);
  assert.equal(got.odd, 1);
  assert.equal(got.error, '');
});

test('a punch carries a sortable time as well as the importer shape', () => {
  const got = readAttendance(record40('37', NOV20));
  assert.equal(got.punches[0].when, '20-11-2026 09:14:00');
  assert.equal(got.punches[0].at, '2026-11-20 09:14:00');
});

test('an empty payload is no punches, not an error', () => {
  const got = readAttendance(Buffer.alloc(0));
  assert.deepEqual(got.punches, []);
  assert.equal(got.error, '');
});
