/**
 * Talking to an attendance reader ourselves.
 *
 * One socket, one question at a time: connect, say who we are if the device
 * wants a key, ask for the attendance log, read it, say goodbye. That is the
 * whole of it.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO.
 *
 * It never erases anything. The readers are set to wipe themselves after a
 * download, so the punches on them may be the only copy that exists; there is
 * no clear command in `shared/zkProtocol.js` for this to call even by mistake.
 *
 * And it never disables the device. Some tools switch the reader off while
 * they read, so nobody can punch meanwhile. A reader that stays dark because
 * a pull failed halfway is a morning of attendance typed from memory.
 */
import net from 'node:net';

import {
  ACK_NAMES,
  CMD,
  DEFAULT_PORT,
  authData,
  readAttendance,
  readTcp,
  tcpPacket,
} from '../../../shared/zkProtocol.js';

export const DEFAULT_TIMEOUT_MS = 8000;

/** What the device is asked for. The 1 is the attendance log. */
export const ATTLOG_REQUEST = Buffer.from([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

const ackName = (command) => ACK_NAMES[command] || `reply ${command}`;

class Reader {
  constructor({ host, port = DEFAULT_PORT, commKey = 0, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.host = host;
    this.port = Number(port) || DEFAULT_PORT;
    this.commKey = Number(commKey) || 0;
    this.timeoutMs = Number(timeoutMs) || DEFAULT_TIMEOUT_MS;
    this.sessionId = 0;
    this.replyId = 0;
    this.buffer = Buffer.alloc(0);
    this.queue = [];      // packets read and not yet taken
    this.waiters = [];    // whoever is waiting for the next one
    this.socket = null;
    this.failed = null;
  }

  /* ---------------- the socket ---------------- */

  open() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      socket.setTimeout(this.timeoutMs);
      const give = (error) => {
        this.failed = error;
        // Anybody waiting for a reply is told, rather than left to the timeout.
        for (const w of this.waiters.splice(0)) w.reject(error);
      };
      socket.once('connect', () => {
        socket.setTimeout(0);
        this.socket = socket;
        resolve();
      });
      socket.once('timeout', () => {
        const error = new Error(`${this.host}:${this.port} did not answer in ${this.timeoutMs}ms`);
        give(error);
        socket.destroy();
        reject(error);
      });
      socket.once('error', (err) => {
        const error = new Error(`${this.host}:${this.port} — ${err.message}`);
        give(error);
        reject(error);
      });
      socket.once('close', () => {
        give(this.failed || new Error('the device closed the connection'));
      });
      socket.on('data', (chunk) => this.take(chunk));
    });
  }

  take(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const packet = readTcp(this.buffer);
      if (!packet) break;                 // half a reply is not a reply
      this.buffer = this.buffer.subarray(packet.consumed);
      if (packet.error) { this.failed = new Error(packet.error); break; }
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(packet);
      else this.queue.push(packet);
    }
  }

  next() {
    if (this.failed) return Promise.reject(this.failed);
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        reject(new Error(`${this.host}:${this.port} stopped answering part way through`));
      }, this.timeoutMs);
      this.waiters.push({
        timer,
        resolve: (p) => { clearTimeout(timer); resolve(p); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
    });
  }

  async ask(command, data) {
    if (!this.socket) throw new Error('not connected');
    this.replyId = (this.replyId + 1) & 0xffff;
    this.socket.write(tcpPacket(command, { sessionId: this.sessionId, replyId: this.replyId, data }));
    return this.next();
  }

  /* ---------------- the conversation ---------------- */

  async hello() {
    const reply = await this.ask(CMD.CONNECT);
    this.sessionId = reply.sessionId;
    if (reply.command === CMD.ACK_UNAUTH) {
      if (!this.commKey) {
        throw new Error('the device wants its communication key and none is set for it');
      }
      const authed = await this.ask(CMD.AUTH, authData(this.commKey, this.sessionId));
      if (authed.command !== CMD.ACK_OK) {
        throw new Error('the device refused the communication key');
      }
      return;
    }
    if (reply.command !== CMD.ACK_OK) {
      throw new Error(`the device answered ${ackName(reply.command)} to hello`);
    }
  }

  /**
   * The attendance log. Firmware answers one of two ways: the whole payload
   * in one reply, or a size followed by the bytes in pieces.
   */
  async attendance() {
    const reply = await this.ask(CMD.DATA_WRRQ, ATTLOG_REQUEST);
    if (reply.command === CMD.DATA) return reply.data;
    if (reply.command === CMD.PREPARE_DATA) {
      const expect = reply.data.length >= 4 ? reply.data.readUInt32LE(0) : 0;
      const pieces = [];
      let got = 0;
      while (got < expect) {
        const piece = await this.next();
        if (piece.command === CMD.ACK_OK) break;   // it has finished early
        if (!piece.data.length) break;
        pieces.push(piece.data);
        got += piece.data.length;
      }
      const body = Buffer.concat(pieces);
      // The device sends an ACK after the data on most firmware; a missing one
      // is not worth failing over when the bytes are already here.
      if (got >= expect) await this.next().catch(() => null);
      return body;
    }
    if (reply.command === CMD.ACK_OK) return Buffer.alloc(0);   // nothing to give
    throw new Error(`the device answered ${ackName(reply.command)} when asked for the log`);
  }

  async goodbye() {
    try { await this.ask(CMD.EXIT); } catch { /* it has gone; nothing to do */ }
    this.close();
  }

  close() {
    if (this.socket) { this.socket.destroy(); this.socket = null; }
  }
}

/**
 * One pull. Returns what was read and what went wrong, never throws: a reader
 * being unplugged is an ordinary Tuesday and the panel has to be able to say
 * so for each device in turn.
 */
export async function pullAttendance(device) {
  const reader = new Reader(device);
  const started = Date.now();
  try {
    await reader.open();
    await reader.hello();
    const payload = await reader.attendance();
    const read = readAttendance(payload);
    await reader.goodbye();
    return {
      ok: !read.error,
      punches: read.punches,
      bytes: read.bytes,
      record_size: read.size,
      sample: read.sample,
      error: read.error,
      ms: Date.now() - started,
    };
  } catch (err) {
    reader.close();
    return {
      ok: false,
      punches: [],
      bytes: 0,
      record_size: 0,
      sample: '',
      error: err.message,
      ms: Date.now() - started,
    };
  }
}

/** Just enough to say whether it is there and answering. */
export async function testDevice(device) {
  const reader = new Reader(device);
  const started = Date.now();
  try {
    await reader.open();
    await reader.hello();
    await reader.goodbye();
    return { ok: true, session: reader.sessionId, error: '', ms: Date.now() - started };
  } catch (err) {
    reader.close();
    return { ok: false, session: 0, error: err.message, ms: Date.now() - started };
  }
}

export const _Reader = Reader;
