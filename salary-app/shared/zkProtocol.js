/**
 * Talking to an eSSL / ZKTeco reader ourselves.
 *
 * Dinesh: *"aap naya tool banavo / bizcompass ke bharose mat raho"* — after
 * their cloud answered **License Not Found**. The punch spool we had been
 * reading is written by THEIR product; if it stops, the feed stops. So this
 * is our own way to the devices, over the office LAN.
 *
 * NO DEPENDENCY, AND THE REASON. The npm module for this depends on itself in
 * its own manifest and was last published in 2022 — a binary network protocol
 * that nothing here can test, from a package nobody is maintaining, in a
 * payroll app. This is framing plus a checksum plus a fixed record layout,
 * which is the Code 128 end of the scale rather than the Reed-Solomon end
 * (see shared/barcode.js for where that line was drawn before).
 *
 * **THERE IS NO CLEAR AND NO DELETE IN THIS FILE, DELIBERATELY.** The devices
 * are set to wipe themselves after a download, so the one unrecoverable
 * mistake available here is erasing punches nobody has read yet. The commands
 * that could do it are not implemented, not named, and a test asserts they
 * never appear.
 *
 * Everything here is pure: bytes in, bytes out. The socket lives in
 * backend/src/zk/client.js so this half can be tested without a device.
 */

/** The four bytes every TCP packet to these devices starts with. */
export const TCP_MAGIC = Buffer.from([0x50, 0x50, 0x82, 0x7d]);
export const TCP_HEADER_LENGTH = 8;
export const DEFAULT_PORT = 4370;

/**
 * Only what we need, and nothing that writes to the device.
 *
 * CLEAR_ATTLOG (1004), DELETE_USER (18) and the rest of the write side are
 * NOT here on purpose. Adding one would make it possible for a bug in this
 * app to wipe a month of attendance off a machine that keeps no other copy.
 */
export const CMD = {
  CONNECT: 1000,
  EXIT: 1001,
  ENABLE_DEVICE: 1002,
  DISABLE_DEVICE: 1003,
  AUTH: 1102,
  DATA_WRRQ: 1503,
  PREPARE_DATA: 1500,
  DATA: 1501,
  FREE_DATA: 1502,
  READ_BUFFER: 1504,
  ACK_OK: 2000,
  ACK_ERROR: 2001,
  ACK_UNAUTH: 2005,
};

export const ACK_NAMES = {
  2000: 'ok',
  2001: 'the device refused it',
  2005: 'the comm key is wrong',
};

/**
 * The device's checksum: 16-bit words added up, the carry folded back in,
 * then inverted. A packet whose checksum is wrong is ignored in silence, so
 * this is the difference between "no answer" and a working link.
 */
export function checksum(buffer) {
  let sum = 0;
  let i = 0;
  for (; i + 1 < buffer.length; i += 2) sum += buffer.readUInt16LE(i);
  if (i < buffer.length) sum += buffer[i];
  while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
  return (~sum) & 0xffff;
}

/** One command, as the device expects it (before the TCP wrapper). */
export function packet(command, { sessionId = 0, replyId = 0, data = Buffer.alloc(0) } = {}) {
  const head = Buffer.alloc(8);
  head.writeUInt16LE(command, 0);
  head.writeUInt16LE(0, 2); // checksum goes in once the rest is written
  head.writeUInt16LE(sessionId & 0xffff, 4);
  head.writeUInt16LE(replyId & 0xffff, 6);
  const body = Buffer.concat([head, Buffer.from(data)]);
  body.writeUInt16LE(checksum(body), 2);
  return body;
}

/** The same, wrapped for TCP. */
export function tcpPacket(command, options) {
  const body = packet(command, options);
  const header = Buffer.alloc(8);
  TCP_MAGIC.copy(header, 0);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/**
 * What came back: the command (its reply code), the session, and the payload.
 * Returns null when there is not a whole packet yet — these arrive in pieces
 * and a half-read reply must not be read as a refusal.
 */
export function readTcp(buffer) {
  if (!buffer || buffer.length < TCP_HEADER_LENGTH + 8) return null;
  if (!buffer.subarray(0, 4).equals(TCP_MAGIC)) return { error: 'not a reply from one of these devices' };
  const size = buffer.readUInt32LE(4);
  if (buffer.length < TCP_HEADER_LENGTH + size) return null;
  const body = buffer.subarray(TCP_HEADER_LENGTH, TCP_HEADER_LENGTH + size);
  return {
    command: body.readUInt16LE(0),
    sessionId: body.readUInt16LE(4),
    replyId: body.readUInt16LE(6),
    data: body.subarray(8),
    consumed: TCP_HEADER_LENGTH + size,
  };
}

/**
 * The comm key, scrambled the way the device expects.
 *
 * This is the device's own obfuscation, not encryption, and it is worth
 * saying so plainly: anybody on that LAN who can read the packet can work the
 * key back out. It keeps a stray program off the reader; it is not a secret.
 */
export function authData(commKey, sessionId) {
  const key = Number(commKey) || 0;
  let k = 0;
  for (let i = 0; i < 32; i += 1) {
    if (key & (1 << i)) k = (k << 1) >>> 0;
    else k = ((k << 1) | 1) >>> 0;
  }
  k = (k + sessionId) >>> 0;
  const out = Buffer.alloc(4);
  out.writeUInt32LE(k >>> 0, 0);
  out[0] ^= 'Z'.charCodeAt(0);
  out[1] ^= 'K'.charCodeAt(0);
  out[2] ^= 'S'.charCodeAt(0);
  out[3] ^= 'O'.charCodeAt(0);
  return out;
}

/* ---------------- the records ---------------- */

/**
 * The attendance log comes back as fixed-size records, and **the size varies
 * by firmware**. Rather than assume one, the size is worked out from the
 * payload itself: whichever known size divides it exactly.
 *
 * If none does, nothing is parsed and the caller is told the length — a
 * wrong guess here would hand somebody else's punches to a person.
 */
export const RECORD_SIZES = [40, 32, 28, 16];

export function recordSize(length) {
  for (const size of RECORD_SIZES) {
    if (length > 0 && length % size === 0) return size;
  }
  return 0;
}

/** The device counts seconds from 2000-01-01 in its own encoding. */
export function decodeTime(value) {
  let v = Number(value) >>> 0;
  const second = v % 60; v = Math.floor(v / 60);
  const minute = v % 60; v = Math.floor(v / 60);
  const hour = v % 24; v = Math.floor(v / 24);
  const day = (v % 31) + 1; v = Math.floor(v / 31);
  const month = (v % 12) + 1; v = Math.floor(v / 12);
  const year = v + 2000;
  return { year, month, day, hour, minute, second };
}

export const stamp = (t) =>
  `${String(t.day).padStart(2, '0')}-${String(t.month).padStart(2, '0')}-${t.year} ` +
  `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}:${String(t.second).padStart(2, '0')}`;

/** Sortable, for storing. `stamp` is the shape the punch importer reads. */
export const sortable = (t) =>
  `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')} ` +
  `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}:${String(t.second).padStart(2, '0')}`;

/*
 * A record size read off the payload length can be wrong — three firmwares
 * share these sizes — and bytes read at the wrong offset still produce a
 * date. One dated 2079 is not a punch, and letting it through would put an
 * attendance row in a month nobody will ever look at. So a year outside this
 * window means the records were not read correctly, which is said out loud
 * rather than filed.
 */
export const EARLIEST_YEAR = 2015;
export const LATEST_YEAR = 2100;
export const plausible = (t) => t.year >= EARLIEST_YEAR && t.year <= LATEST_YEAR;

const asText = (buf) => buf.toString('latin1').split('\0')[0].trim();

const timeFields = (raw) => {
  const t = decodeTime(raw);
  return { when: stamp(t), at: sortable(t), plausible: plausible(t) };
};

/**
 * One record. The user id is read as TEXT, never as a number: these readers
 * are enrolled with ids like `0037` in some offices, and dropping the zeros
 * on one side of a comparison is how a punch ends up on nobody.
 */
export function readRecord(buf, size) {
  if (size >= 40) {
    return {
      user: asText(buf.subarray(2, 11)),
      ...timeFields(buf.readUInt32LE(27)),
      state: buf[26],
      verify: buf[31],
    };
  }
  if (size >= 28) {
    return {
      user: asText(buf.subarray(2, 11)),
      ...timeFields(buf.readUInt32LE(24)),
      state: buf[23],
      verify: buf[28] ?? 0,
    };
  }
  return {
    user: asText(buf.subarray(0, 9)),
    ...timeFields(buf.readUInt32LE(10)),
    state: buf[9],
    verify: 0,
  };
}

/**
 * The whole attendance payload.
 *
 * Returns what it could read AND what it could not, because a reader whose
 * records are a size this does not know must say so rather than quietly
 * return nothing — "no punches today" and "I cannot read this firmware" are
 * very different answers.
 */
export function readAttendance(payload) {
  const data = Buffer.from(payload || []);
  // Some firmware prefixes the stream with a 4-byte length.
  const body = data.length > 4 && data.readUInt32LE(0) === data.length - 4 ? data.subarray(4) : data;
  /*
   * Nothing at all is not a fault. A reader with no new punches answers with
   * an empty payload, and calling that an error would put a working device on
   * a list of broken ones every quiet evening.
   */
  if (!body.length) return { punches: [], size: 0, bytes: 0, error: '', sample: '' };
  const size = recordSize(body.length);
  if (!size) {
    return {
      punches: [],
      size: 0,
      bytes: body.length,
      error: `the records are ${body.length} bytes, which is not a size this knows`,
      sample: body.subarray(0, 64).toString('hex'),
    };
  }
  const punches = [];
  let odd = 0;
  for (let at = 0; at + size <= body.length; at += size) {
    const record = readRecord(body.subarray(at, at + size), size);
    if (!record.user) continue;
    if (!record.plausible) { odd += 1; continue; }
    punches.push(record);
  }
  /*
   * Mostly nonsense dates means the size was guessed wrong, so say so: half a
   * log filed and half discarded in silence is the worst of both.
   */
  const error = odd && odd >= punches.length
    ? `${odd} of ${odd + punches.length} records carry a date outside ${EARLIEST_YEAR}-${LATEST_YEAR}, so these are probably not ${size}-byte records`
    : '';
  return { punches, size, bytes: body.length, odd, error, sample: body.subarray(0, 64).toString('hex') };
}
