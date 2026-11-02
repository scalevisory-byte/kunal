/**
 * Photographs of an asset.
 *
 * The picture itself is the easy part. What these pin is everything around it,
 * which is the same set of rules the employee documents and the candidate CVs
 * follow, and for the same reasons:
 *
 *  - the uploaded filename is thrown away, because it is user input and this
 *    is a path;
 *  - where the file sits on disk never leaves the server;
 *  - the picture is readable without a password, because a browser cannot put
 *    a bearer token on an <img src> - so the link is signed and expires;
 *  - deleting the row takes the file with it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-photos-'));
process.env.DATA_DIR = DATA;
process.env.APP_PASSWORD = 'the-key';
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { authorization: 'Bearer the-key', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

/* A real 1x1 PNG rather than a renamed text file: the filter reads the type. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const send = async (url, { name = 'my holiday snap.png', type = 'image/png', bytes = PNG, note } = {}) => {
  const form = new FormData();
  form.set('photo', new Blob([bytes], { type }), name);
  if (note) form.set('note', note);
  const res = await fetch(`${base}${url}`, {
    method: 'POST',
    headers: { authorization: 'Bearer the-key' },
    body: form,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

let assetId;

test('an asset to photograph', async () => {
  const company = await api('POST', '/api/companies', { name: 'BOOKNFLY PRIVATE LIMITED' });
  const asset = await api('POST', '/api/people/assets', {
    company_id: company.body.id,
    kind: 'Laptop',
    label: 'Dell Latitude 3420',
    purchase_cost: 42000,
  });
  assert.equal(asset.status, 201);
  assetId = asset.body.id;
});

test('the uploaded filename is thrown away, and the path never leaves the server', async () => {
  const sent = await send(`/api/people/assets/${assetId}/photos`, {
    name: '../../etc/passwd.png',
    note: 'scratched lid, on handover',
  });
  assert.equal(sent.status, 201);

  const photo = sent.body.photo;
  assert.equal(photo.note, 'scratched lid, on handover');
  assert.ok(!('file_path' in photo), `the page was told where the file is: ${JSON.stringify(photo)}`);

  const listed = await api('GET', `/api/people/assets/${assetId}/photos`);
  assert.equal(listed.body.photos.length, 1);
  assert.ok(!('file_path' in listed.body.photos[0]));

  // One file, under a name this process made up.
  const files = fs.readdirSync(path.join(DATA, 'asset-photos'));
  assert.equal(files.length, 1);
  assert.match(files[0], /^ast-[a-z0-9]+-[0-9a-f]{8}\.png$/, files[0]);
  assert.ok(!files[0].includes('passwd'), 'the uploaded name was kept');
});

test('the picture opens with no password, because an <img> cannot carry one', async () => {
  const { photos } = (await api('GET', `/api/people/assets/${assetId}/photos`)).body;
  const link = photos[0].link;
  assert.ok(link?.url && link.expires_at);

  const open = await fetch(`${base}${link.url}`);
  assert.equal(open.status, 200);
  assert.match(open.headers.get('content-type') || '', /image\/png/);
  assert.equal((await open.arrayBuffer()).byteLength, PNG.length);
});

test('and only with the right signature, before it expires', async () => {
  const { photos } = (await api('GET', `/api/people/assets/${assetId}/photos`)).body;
  const id = photos[0].id;
  const sig = new URL(`${base}${photos[0].link.url}`).searchParams.get('sig');

  assert.equal((await fetch(`${base}/files/asset-photo/${id}`)).status, 403, 'no signature');
  assert.equal(
    (await fetch(`${base}/files/asset-photo/${id}?exp=9999999999&sig=made-up`)).status,
    403,
    'a made-up signature'
  );
  // The signature is real; the moment has passed.
  assert.equal(
    (await fetch(`${base}/files/asset-photo/${id}?exp=1000000000&sig=${sig}`)).status,
    403,
    'expired'
  );
});

test('a PDF is not a photograph', async () => {
  const sent = await send(`/api/people/assets/${assetId}/photos`, {
    name: 'invoice.pdf',
    type: 'application/pdf',
    bytes: Buffer.from('%PDF-1.4'),
  });
  assert.equal(sent.status, 400);
  assert.match(sent.body.error, /JPG, PNG, WEBP or HEIC/);
  // And nothing was left behind on disk.
  assert.equal(fs.readdirSync(path.join(DATA, 'asset-photos')).length, 1);
});

test('a photo of an asset that is not on the register is refused, and leaves no file', async () => {
  const sent = await send('/api/people/assets/9999/photos');
  assert.equal(sent.status, 400);
  assert.equal(
    fs.readdirSync(path.join(DATA, 'asset-photos')).length,
    1,
    'the file was written before the row was refused and then not cleaned up'
  );
});

test('removing a photo takes the file with it', async () => {
  const { photos } = (await api('GET', `/api/people/assets/${assetId}/photos`)).body;
  const gone = await api('DELETE', `/api/people/assets/${assetId}/photos/${photos[0].id}`);
  assert.equal(gone.status, 204);

  assert.equal((await api('GET', `/api/people/assets/${assetId}/photos`)).body.photos.length, 0);
  assert.equal(fs.readdirSync(path.join(DATA, 'asset-photos')).length, 0, 'the file is still there');
});
