/**
 * Reading photos.
 *
 * Invoices, bills and bank-transfer screenshots arrive as pictures, so the
 * cases that matter are the guards around cost and storage: a photo is only
 * fetched when the feature is on, an oversized or unsupported one is dropped
 * rather than sent, and a photo that cannot be stored must never cost the task
 * it produced.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-images-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';
delete process.env.READ_IMAGES;

const { config } = await import('../src/config.js');
const S = await import('../src/scheduling.js');
const A = await import('../src/attachments.js');
const DB = await import('../src/db.js');
const WA = await import('../src/whatsapp.js');

let passed = 0;
let failed = 0;
const run = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
};

/** A stand-in for a whatsapp-web.js message carrying a photo. */
const photoMessage = ({ mimetype = 'image/jpeg', bytes = 40_000, fails = false } = {}) => ({
  hasMedia: true,
  type: 'image',
  body: '',
  downloadMedia: async () => {
    if (fails) throw new Error('download failed');
    return { data: Buffer.alloc(bytes, 7).toString('base64'), mimetype, filename: 'invoice.jpg' };
  },
});

console.log('\nwhen a photo is fetched at all');

await run('nothing is downloaded while the setting is off', async () => {
  S.saveSettings({ readImages: false });
  let called = false;
  const message = { ...photoMessage(), downloadMedia: async () => { called = true; return null; } };
  assert.equal(await WA.downloadImage(message), null);
  assert.equal(called, false, 'the download is never even attempted');
});

await run('a photo is fetched once the setting is on', async () => {
  S.saveSettings({ readImages: true });
  const image = await WA.downloadImage(photoMessage());
  assert.ok(image?.data, 'the bytes come back');
  assert.equal(image.mime, 'image/jpeg');
});

await run('a message with no photo is left alone', async () => {
  S.saveSettings({ readImages: true });
  assert.equal(await WA.downloadImage({ hasMedia: false, type: 'chat' }), null);
  // A document or a voice note is not an image, whatever the setting says.
  assert.equal(await WA.downloadImage({ hasMedia: true, type: 'document' }), null);
  assert.equal(await WA.downloadImage({ hasMedia: true, type: 'ptt' }), null);
});

console.log('\nmessages you send yourself');

await run('a note typed into your own chat is captured like any other', async () => {
  /*
   * The "message yourself" chat is how a lot of this actually gets used - you
   * think of something and type it to yourself. Those arrive with fromMe set
   * and from === to === your own id, which is a shape nothing else has, so it
   * is worth pinning down.
   */
  const me = '919909993565@c.us';
  WA.state.me = me;
  const before = DB.listMessages({ limit: 200 }).length;

  await WA.handleMessage({
    id: { _serialized: 'self-note-1' },
    from: me, to: me, fromMe: true, isStatus: false,
    body: 'Kal BNF salary 5 baje process karni hai',
    timestamp: Date.now() / 1000, hasMedia: false, type: 'chat',
    getChat: async () => ({ id: { _serialized: me }, name: 'You', isGroup: false }),
    getContact: async () => ({ pushname: 'Me', number: '919909993565' }),
  });

  const rows = DB.listMessages({ limit: 200 });
  assert.equal(rows.length, before + 1, 'the note was stored');
  const stored = rows.find((r) => r.body.includes('BNF salary'));
  assert.ok(stored, 'with its text intact');
  assert.equal(stored.from_me, 1, 'and marked as written by you');
});

await run('the same note twice is stored once', async () => {
  const me = '919909993565@c.us';
  const before = DB.listMessages({ limit: 200 }).length;
  const msg = {
    id: { _serialized: 'self-note-dup' },
    from: me, to: me, fromMe: true, isStatus: false,
    body: 'GST return file karna hai',
    timestamp: Date.now() / 1000, hasMedia: false, type: 'chat',
    getChat: async () => ({ id: { _serialized: me }, name: 'You', isGroup: false }),
    getContact: async () => ({ pushname: 'Me', number: '919909993565' }),
  };
  // message_create can fire more than once for the same message.
  await WA.handleMessage(msg);
  await WA.handleMessage(msg);
  assert.equal(DB.listMessages({ limit: 200 }).length, before + 1);
});

console.log('\nguards against spending');

await run('an oversized photo is dropped rather than sent', async () => {
  S.saveSettings({ readImages: true });
  const huge = photoMessage({ bytes: config.maxImageBytes + 1000 });
  assert.equal(await WA.downloadImage(huge), null);
});

await run('a format the API does not take is dropped', async () => {
  S.saveSettings({ readImages: true });
  assert.equal(await WA.downloadImage(photoMessage({ mimetype: 'image/heic' })), null);
  assert.equal(await WA.downloadImage(photoMessage({ mimetype: 'application/pdf' })), null);
  // The four it does take.
  for (const mime of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
    const image = await WA.downloadImage(photoMessage({ mimetype: mime }));
    assert.equal(image?.mime, mime, mime);
  }
});

await run('a download that throws costs the message nothing', async () => {
  S.saveSettings({ readImages: true });
  // The text of the message must still get through; only the photo is lost.
  assert.equal(await WA.downloadImage(photoMessage({ fails: true })), null);
});

console.log('\nputting the photo on the task');

await run('the photo is attached to the task it produced', () => {
  const task = DB.createTask({ title: 'Pay Sunshine invoice 4471', status: 'open', source: 'whatsapp', origin: 'ai' });
  const saved = A.addAttachment(task.id, {
    filename: 'invoice.jpg', mime: 'image/jpeg', buffer: Buffer.alloc(2000, 3),
  });
  assert.equal(A.attachmentsFor(task.id).length, 1);
  assert.equal(saved.mime, 'image/jpeg');
});

await run('a full store loses the photo, never the task', () => {
  // The store refusing is the expected outcome once it fills; the task it was
  // about is the part that matters and has already been created.
  const task = DB.createTask({ title: 'Task with an unstorable photo', status: 'open', source: 'whatsapp', origin: 'ai' });
  let threw = false;
  try {
    A.addAttachment(task.id, {
      filename: 'huge.jpg', mime: 'image/jpeg', buffer: Buffer.alloc(11_000_000),
    });
  } catch {
    threw = true;
  }
  assert.equal(threw, true, 'the store refuses');
  assert.ok(DB.getTask(task.id), 'and the task is still there');
  assert.equal(A.attachmentsFor(task.id).length, 0);
});

console.log('\nnothing reaches the volume before it has to');

await run('a fetched photo is not written to disk by itself', async () => {
  S.saveSettings({ readImages: true });
  const before = fs.readdirSync(A.attachmentDir).length;
  await WA.downloadImage(photoMessage());
  assert.equal(fs.readdirSync(A.attachmentDir).length, before,
    'downloading holds the bytes in memory only');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
