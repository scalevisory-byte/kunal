import test from 'node:test';
import assert from 'node:assert/strict';
import qr from 'qrcode-generator';
import { qrSvg, qrModules } from '../../shared/qr.js';

/*
 * The asset sticker's QR code.
 *
 * The Code 128 in barcode.js is written out by hand and there is a test there
 * that all 107 patterns are the right width, because one mistyped digit gives
 * a barcode that looks perfect and scans as nothing. A QR code is far worse
 * for that - Reed-Solomon over a finite field, mask selection, format bits -
 * so this one is not written out by hand at all. These tests cover the SVG
 * around it, which is the part that is ours.
 *
 * That the codes actually SCAN is checked by decoding the rendered stickers
 * with a real reader, which needs a browser; it is in the drive script rather
 * than here. 11 of 11 read back their own code.
 */

test('a code is drawn, sized in millimetres, with its quiet zone', () => {
  const svg = qrSvg('BPL-LAP-001', { qr, sizeMm: 18 });
  const n = qrModules('BPL-LAP-001', { qr });
  assert.equal(n, 21, 'a short code fits the smallest version');

  // 18mm of code plus four modules of quiet either side.
  const side = 18 + (8 * 18) / n;
  assert.ok(svg.includes(`width="${side.toFixed(2)}mm"`), svg.slice(0, 120));
  assert.ok(svg.includes('shape-rendering="crispEdges"'), 'a scaled code must not be blurred');
  // White behind it: a transparent QR on a brown box does not scan.
  assert.ok(svg.includes('fill="#fff"'));
});

test('the quiet zone is never dropped, however small it is asked to be', () => {
  // It is part of the specification, not decoration: without it a scanner
  // cannot find the code's edge against whatever it is stuck to.
  const bare = qrSvg('BPL-LAP-001', { qr, sizeMm: 18, quietModules: 0 });
  const four = qrSvg('BPL-LAP-001', { qr, sizeMm: 18, quietModules: 4 });
  assert.equal(bare, four);
});

test('a longer code takes a bigger grid, and still comes out as one sticker', () => {
  const small = qrModules('BPL-LAP-001', { qr });
  const big = qrModules('BOOKNFLY-PRIVATE-LIMITED/LAPTOP/0001/2026', { qr });
  assert.ok(big > small, `${big} should need more modules than ${small}`);
  assert.ok(qrSvg('BOOKNFLY-PRIVATE-LIMITED/LAPTOP/0001/2026', { qr }));
});

test('higher correction costs modules, which is the trade a scuffed sticker wants', () => {
  assert.ok(
    qrModules('BPL-LAP-001', { qr, ecc: 'H' }) >= qrModules('BPL-LAP-001', { qr, ecc: 'L' })
  );
});

test('nothing to encode draws nothing, rather than an empty code that scans as nothing', () => {
  assert.equal(qrSvg('', { qr }), null);
  assert.equal(qrSvg('   ', { qr }), null);
  assert.equal(qrSvg(null, { qr }), null);
  // And with no library handed in it refuses rather than throwing mid-print.
  assert.equal(qrSvg('BPL-LAP-001', {}), null);
});

test("an asset's name cannot break out of the caption", () => {
  const svg = qrSvg('BPL-LAP-001', { qr, label: '<script>alert(1)</script>' });
  assert.ok(!svg.includes('<script>'), svg);
  assert.ok(svg.includes('&lt;script&gt;'));
});
