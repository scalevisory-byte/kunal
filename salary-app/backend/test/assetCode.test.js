import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { codeProblem, companyPrefix, formatCode, kindPrefix, nextCode, tidyCode } from '../../shared/assetCode.js';
import { barcodeSvg, canEncode, encode128 } from '../../shared/barcode.js';

/* ================================================================= *
 * asset codes
 * ================================================================= */

test('a company prefix is its initials, or its first three letters', () => {
  assert.equal(companyPrefix('BOOKNFLY PRIVATE LIMITED'), 'BPL');
  assert.equal(companyPrefix('BOOKNFLY VENTURE LLP'), 'BVL');
  assert.equal(companyPrefix('BOOKNFLY'), 'BOO');
  assert.equal(companyPrefix('SCALE'), 'SCA');
  assert.equal(companyPrefix(''), 'GEN', 'never an empty prefix');
});

test('a kind prefix is a known short form, or the first three letters', () => {
  assert.equal(kindPrefix('Laptop'), 'LAP');
  assert.equal(kindPrefix('SIM card'), 'SIM');
  assert.equal(kindPrefix('ID card'), 'IDC');
  assert.equal(kindPrefix('Projector'), 'PRO', 'anything typed still gets one');
  assert.equal(kindPrefix(''), 'GEN');
});

test('a code reads as whose it is, what it is, and which one', () => {
  assert.equal(formatCode('BOOKNFLY PRIVATE LIMITED', 'Laptop', 14), 'BPL-LAP-014');
  assert.equal(formatCode('SCALE', 'Mobile', 3), 'SCA-MOB-003');
  assert.equal(formatCode('BOOKNFLY', 'Laptop', 1), 'BOO-LAP-001');
});

test('the series runs per company and per kind', () => {
  const taken = ['BPL-LAP-001', 'BPL-LAP-002', 'BPL-SIM-001', 'SCA-LAP-001'];
  assert.equal(nextCode('BOOKNFLY PRIVATE LIMITED', 'Laptop', taken), 'BPL-LAP-003');
  assert.equal(nextCode('BOOKNFLY PRIVATE LIMITED', 'SIM card', taken), 'BPL-SIM-002');
  assert.equal(nextCode('SCALE', 'Laptop', taken), 'SCA-LAP-002');
  assert.equal(nextCode('BOOKNFLY', 'Laptop', taken), 'BOO-LAP-001', 'a new series starts at 1');
});

test('a number is never reused, even when the asset in between is gone', () => {
  // 001 and 003 exist; 002 was deleted. The next must be 004, not 002 - an old
  // service bill and a signed handover slip still refer to 002.
  assert.equal(nextCode('SCALE', 'Laptop', ['SCA-LAP-001', 'SCA-LAP-003']), 'SCA-LAP-004');
});

test('the series reads the highest number, not how many there are', () => {
  assert.equal(nextCode('SCALE', 'Laptop', ['SCA-LAP-099']), 'SCA-LAP-100');
  assert.equal(nextCode('SCALE', 'Laptop', ['SCA-LAP-100', 'SCA-LAP-007']), 'SCA-LAP-101');
});

test('a typed code is tidied, and a bad one is refused with a reason', () => {
  assert.equal(tidyCode('  bpl-lap-014 '), 'BPL-LAP-014');
  assert.equal(tidyCode('BPL LAP 014'), 'BPLLAP014', 'a label has no spaces in it');
  assert.equal(codeProblem('BPL-LAP-014'), '');
  assert.equal(codeProblem('AB/12'), '', 'slashes are allowed - plenty of offices use them');
  assert.match(codeProblem(''), /needed/);
  assert.match(codeProblem('X'), /too short/);
  assert.match(codeProblem('BPL_LAP'), /letters, numbers, dashes and slashes/);
});

/* ================================================================= *
 * the barcode
 * ================================================================= */

test('the pattern table was transcribed correctly', () => {
  /*
   * Every Code 128 symbol is exactly 11 modules wide and the stop is 13. A
   * single mistyped digit anywhere in the 107 rows breaks that, and would
   * otherwise produce a barcode that looks perfect and scans as nothing.
   */
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.join(here, '..', '..', 'shared', 'barcode.js'), 'utf8');
  const from = source.indexOf('const PATTERNS = [');
  const block = source.slice(from, source.indexOf('];', from));
  const patterns = [...block.matchAll(/'(\d{6,7})'/g)].map((m) => m[1]);

  assert.equal(patterns.length, 107);
  patterns.forEach((p, i) => {
    const width = [...p].reduce((a, c) => a + Number(c), 0);
    assert.equal(width, i === 106 ? 13 : 11, `pattern ${i} is ${width} modules wide`);
  });
  assert.equal(new Set(patterns).size, 107, 'and none of them is a duplicate');
});

test('the checksum is the specification’s weighted sum', () => {
  // Start B (104) + each value x its position, mod 103 - computed here
  // independently of the implementation.
  const text = 'BPL-LAP-014';
  const expected =
    ([...text].reduce((sum, ch, i) => sum + (ch.charCodeAt(0) - 32) * (i + 1), 104)) % 103;
  assert.equal(encode128(text).checksum, expected);
});

test('an encoded code is start + characters + checksum + stop', () => {
  const text = 'BPL-LAP-014';
  const encoded = encode128(text);
  // 11 modules for the start, each character and the checksum; 13 for the stop.
  assert.equal(encoded.modules, (text.length + 2) * 11 + 13);
});

test('everything an asset code can contain is encodable', () => {
  assert.equal(canEncode('BPL-LAP-014'), true);
  assert.equal(canEncode('AB/12-9'), true);
  assert.equal(canEncode(''), false, 'and nothing is not a barcode');
});

test('something unencodable gives null, never a barcode that scans as the wrong thing', () => {
  assert.equal(encode128('café'), null);
  assert.equal(barcodeSvg('café'), null);
  assert.equal(encode128(''), null);
});

test('the label is an SVG sized in millimetres, with the quiet zone the spec asks for', () => {
  const svg = barcodeSvg('BPL-LAP-014', { heightMm: 12 });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /width="\d+\.\d+mm"/, 'printed size, not pixels');
  assert.match(svg, /BPL-LAP-014<\/text>/, 'the code is written under the bars');
  // 10 modules of quiet zone either side: without it scanners miss the first bar.
  const modules = encode128('BPL-LAP-014').modules;
  const expectedWidth = ((modules + 20) * 0.33).toFixed(2);
  assert.ok(svg.includes(`width="${expectedWidth}mm"`), `expected ${expectedWidth}mm`);
  assert.equal((svg.match(/<rect/g) || []).length > 20, true, 'drawn as bars, not a font');
});

test('the code can be left off the label when the sticker is tiny', () => {
  assert.equal(barcodeSvg('BPL-LAP-014', { showText: false }).includes('<text'), false);
});
