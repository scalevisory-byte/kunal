/**
 * The client, against a device of our own making.
 *
 * WHAT THIS CAN AND CANNOT PROVE. There is no reader here, so the fake speaks
 * the protocol through the same module the client does — a mistake in the byte
 * layout would cancel out and pass. What it does prove is the CONVERSATION:
 * the handshake, a device that demands its key, both shapes of answer, a
 * device that stops talking half way, and that neither end hangs. The byte
 * layout is pinned separately in zkProtocol.test.js, and the record parser
 * hands back a hex sample precisely so it can be checked against the real
 * firmware instead of trusted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';

import { CMD, readTcp, tcpPacket } from '../../shared/zkProtocol.js';
import { pullAttendance, testDevice } from '../src/zk/client.js';

const record = (user, seconds) => {
  const b = Buffer.alloc(40);
  b.writeUInt16LE(1, 0);
  Buffer.from(String(user), 'latin1').copy(b, 2);
  b.writeUInt32LE(seconds, 27);
  b[31] = 1;
  return b;
};

/** A reader that answers however the test tells it to. */
function fakeDevice({ wantsKey = false, inline = true, log = Buffer.alloc(0), goQuiet = false, chunk = 0 } = {}) {
  const seen = [];
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let session = 0x1234;
    let authed = !wantsKey;
    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      for (;;) {
        const packet = readTcp(buffer);
        if (!packet || packet.error) break;
        buffer = buffer.subarray(packet.consumed);
        seen.push(packet.command);
        const say = (command, payload) =>
          socket.write(tcpPacket(command, { sessionId: session, replyId: packet.replyId, data: payload }));

        if (packet.command === CMD.CONNECT) {
          say(authed ? CMD.ACK_OK : CMD.ACK_UNAUTH);
        } else if (packet.command === CMD.AUTH) {
          authed = true;
          say(CMD.ACK_OK);
        } else if (packet.command === CMD.DATA_WRRQ) {
          if (goQuiet) return;                         // it stops mid-sentence
          if (inline) { say(CMD.DATA, log); return; }
          const size = Buffer.alloc(4);
          size.writeUInt32LE(log.length, 0);
          say(CMD.PREPARE_DATA, size);
          const step = chunk || log.length;
          for (let at = 0; at < log.length; at += step) say(CMD.DATA, log.subarray(at, at + step));
          say(CMD.ACK_OK);
        } else if (packet.command === CMD.EXIT) {
          say(CMD.ACK_OK);
        }
      }
    });
    socket.on('error', () => {});
  });
  return {
    server,
    seen,
    listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port))),
    stop: () => new Promise((r) => server.close(r)),
  };
}

const nov20 = ((((26 * 12 + 10) * 31 + 19) * 24 + 9) * 60 + 14) * 60;

test('it says hello and reads the log in one reply', async () => {
  const device = fakeDevice({ log: Buffer.concat([record('37', nov20), record('128', nov20 + 60)]) });
  const port = await device.listen();
  const got = await pullAttendance({ host: '127.0.0.1', port, timeoutMs: 2000 });
  await device.stop();
  assert.equal(got.error, '');
  assert.equal(got.ok, true);
  assert.deepEqual(got.punches.map((p) => p.user), ['37', '128']);
  assert.equal(got.punches[0].when, '20-11-2026 09:14:00');
  assert.equal(got.record_size, 40);
});

test('a log sent in pieces comes out the same as one sent whole', async () => {
  const log = Buffer.concat(Array.from({ length: 9 }, (_, i) => record(String(i + 1), nov20 + i * 60)));
  const whole = fakeDevice({ log });
  const p1 = await whole.listen();
  const a = await pullAttendance({ host: '127.0.0.1', port: p1, timeoutMs: 2000 });
  await whole.stop();

  const pieces = fakeDevice({ log, inline: false, chunk: 70 });   // not a record boundary
  const p2 = await pieces.listen();
  const b = await pullAttendance({ host: '127.0.0.1', port: p2, timeoutMs: 2000 });
  await pieces.stop();

  assert.equal(a.punches.length, 9);
  assert.deepEqual(b.punches, a.punches, 'the way it arrived must not change what it says');
});

test('a device that wants its key is given it', async () => {
  const device = fakeDevice({ wantsKey: true, log: record('5', nov20) });
  const port = await device.listen();
  const got = await pullAttendance({ host: '127.0.0.1', port, commKey: 1234, timeoutMs: 2000 });
  await device.stop();
  assert.equal(got.error, '');
  assert.equal(got.punches.length, 1);
  assert.ok(device.seen.includes(CMD.AUTH));
});

test('a device that wants a key we do not have SAYS SO, in words', async () => {
  // "did not answer" would send somebody to check the cable for an hour.
  const device = fakeDevice({ wantsKey: true });
  const port = await device.listen();
  const got = await pullAttendance({ host: '127.0.0.1', port, timeoutMs: 2000 });
  await device.stop();
  assert.equal(got.ok, false);
  assert.match(got.error, /communication key/i);
});

test('NOTHING TO GIVE IS NOT A FAILURE', async () => {
  const device = fakeDevice({ log: Buffer.alloc(0) });
  const port = await device.listen();
  const got = await pullAttendance({ host: '127.0.0.1', port, timeoutMs: 2000 });
  await device.stop();
  assert.equal(got.ok, true);
  assert.deepEqual(got.punches, []);
  assert.equal(got.error, '');
});

test('a device that stops talking half way does not hang the pull', async () => {
  const device = fakeDevice({ goQuiet: true });
  const port = await device.listen();
  const got = await pullAttendance({ host: '127.0.0.1', port, timeoutMs: 300 });
  await device.stop();
  assert.equal(got.ok, false);
  assert.match(got.error, /stopped answering/);
  assert.ok(got.ms < 3000);
});

test('nothing listening is named by address, and comes back quickly', async () => {
  const got = await pullAttendance({ host: '127.0.0.1', port: 1, timeoutMs: 500 });
  assert.equal(got.ok, false);
  assert.match(got.error, /127\.0\.0\.1:1/);
});

test('an address that goes nowhere times out rather than waiting for ever', async () => {
  const got = await testDevice({ host: '192.0.2.1', port: 4370, timeoutMs: 400 });
  assert.equal(got.ok, false);
  assert.ok(got.ms < 3000, `took ${got.ms}ms`);
});

test('testing a device asks it nothing but who it is', async () => {
  const device = fakeDevice({ log: record('1', nov20) });
  const port = await device.listen();
  const got = await testDevice({ host: '127.0.0.1', port, timeoutMs: 2000 });
  await device.stop();
  assert.equal(got.ok, true);
  assert.ok(!device.seen.includes(CMD.DATA_WRRQ), 'a test must not download the log');
});

test('THE CLIENT MAY ONLY EVER SEND THESE FIVE COMMANDS', () => {
  /*
   * Two mistakes that cost real attendance: a reader left disabled after a
   * failed pull takes nobody's punches all morning, and a clear takes the
   * punches nobody has read yet.
   *
   * Rather than hunt for forbidden words — `clearTimeout` contains one — this
   * reads every opcode the file names and requires it to be on the list. A
   * command that has no business here cannot be sent without failing this.
   */
  const allowed = new Set([
    'CONNECT', 'AUTH', 'DATA_WRRQ', 'EXIT',              // the conversation
    'DATA', 'PREPARE_DATA', 'ACK_OK', 'ACK_UNAUTH',      // what it reads back
  ]);
  const src = fs.readFileSync(new URL('../src/zk/client.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const used = [...code.matchAll(/CMD\.([A-Z_]+)/g)].map((m) => m[1]);
  assert.ok(used.length > 0, 'it must name its commands through CMD');
  for (const name of used) {
    assert.ok(allowed.has(name), `the client must not touch ${name}`);
  }
  assert.ok(!/ENABLE_DEVICE|DISABLE_DEVICE/.test(code), 'it must not switch the reader on or off');
});
