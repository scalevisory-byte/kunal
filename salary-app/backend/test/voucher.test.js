import test from 'node:test';
import assert from 'node:assert/strict';
import { inWords, wholeInWords } from '../../shared/amountWords.js';
import { financialYear, voucher, voucherNo } from '../../shared/voucher.js';

/*
 * The purchase voucher.
 *
 * Dinesh's rule, which is the reason it exists: accounts does not release
 * money for a thing that is not on the register. So the voucher is printed
 * FROM an asset rather than filled in, and these pin the two things that would
 * make it useless - a figure spelled wrong, and a number that changes when you
 * print it twice.
 */

test('the figure in words is Indian, and it is the line accounts reads first', () => {
  assert.equal(inWords(42000), 'Rupees Forty Two Thousand Only');
  assert.equal(inWords(100000), 'Rupees One Lakh Only');
  assert.equal(inWords(1000000), 'Rupees Ten Lakh Only');
  assert.equal(inWords(10000000), 'Rupees One Crore Only');
  assert.equal(
    inWords(123456),
    'Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six Only'
  );
  // Not million. 42,000 becoming 4,20,000 between the office and the bank is
  // exactly what spelling it out is for.
  assert.ok(!inWords(1000000).includes('Million'));
});

test('paise appear only when there are any', () => {
  assert.equal(inWords(1234.5), 'Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only');
  assert.equal(inWords(0.75), 'Rupees Zero and Seventy Five Paise Only');
  assert.ok(!inWords(42000).includes('Paise'), '"and Zero Paise" is somebody who has not thought about it');
  // Taken to paise before any of it is spelled out, so a fraction of a paisa
  // does not become its own line.
  assert.equal(inWords(1.014), 'Rupees One and One Paise Only');
  assert.equal(inWords(1.019), 'Rupees One and Two Paise Only');

  /*
   * The documented edge, pinned so nobody "fixes" it into being wrong the
   * other way: a binary float cannot hold 1.015 exactly, stores it a hair
   * under, and rounds DOWN. An epsilon fudge would round 1.0149 up instead.
   * Nothing in this app reaches here with such a number - the test below
   * shows a voucher is whole rupees before it ever asks.
   */
  assert.equal(inWords(1.015), 'Rupees One and One Paise Only');
});

test('the awkward numbers', () => {
  assert.equal(wholeInWords(0), 'Zero');
  assert.equal(wholeInWords(19), 'Nineteen');
  assert.equal(wholeInWords(20), 'Twenty');
  assert.equal(wholeInWords(100), 'One Hundred');
  assert.equal(wholeInWords(101), 'One Hundred One');
  assert.equal(wholeInWords(1001), 'One Thousand One');
  assert.equal(wholeInWords(100001), 'One Lakh One');
  assert.equal(inWords(-500), 'Minus Rupees Five Hundred Only');
});

test('the financial year is April to March, as every invoice writes it', () => {
  assert.equal(financialYear('2026-03-31'), '2025-26');
  assert.equal(financialYear('2026-04-01'), '2026-27');
  assert.equal(financialYear('2026-11-02'), '2026-27');
  assert.equal(financialYear('2027-01-15'), '2026-27');
});

const ASSET = {
  code: 'BPL-LAP-001',
  kind: 'Laptop',
  label: 'Dell Latitude 3420',
  identifier: 'SN-884421',
  company_name: 'BOOKNFLY PRIVATE LIMITED',
  purchase_cost: 42000,
  vendor: 'Rajhans Computers',
  invoice_no: 'RC/24-25/118',
  purchase_date: '2024-07-01',
};

test('a reprint is the same voucher, not a second claim on the same money', () => {
  // The number is worked out from the asset, never stored and never counted
  // up, so printing it again cannot produce a new one.
  assert.equal(voucherNo(ASSET), 'AV/2024-25/BPL-LAP-001');
  assert.equal(voucherNo(ASSET), voucherNo({ ...ASSET }));
  // And it carries the asset's own code, so a voucher cannot be written for
  // something that was never entered.
  assert.ok(voucherNo(ASSET).includes(ASSET.code));
  assert.equal(voucherNo({ ...ASSET, code: '' }), '', 'no code, no voucher number');
});

test('what accounts will ask about is on its face, not left to be noticed', () => {
  const full = voucher(ASSET, { today: '2026-11-02' });
  assert.equal(full.complete, true);
  assert.deepEqual(full.missing, []);
  assert.equal(full.amount, 42000);
  assert.equal(full.amount_in_words, 'Rupees Forty Two Thousand Only');

  const thin = voucher({ code: 'BPL-CHR-001', kind: 'Chair' }, { today: '2026-11-02' });
  assert.equal(thin.complete, false);
  assert.deepEqual(thin.missing, [
    'what it cost',
    'the vendor',
    'the invoice number',
    'the purchase date',
  ]);
  // It still prints. Accounts can chase one field; a voucher that refuses to
  // exist until everything is perfect gets replaced by a scrap of paper.
  assert.ok(thin.no);
});

test('where it went is on the voucher, so somebody is accountable for it', () => {
  assert.equal(voucher({ ...ASSET, employee_name: 'ALPESH SHUKLA' }).holder, 'ALPESH SHUKLA');
  assert.equal(voucher(ASSET).holder, '', 'nobody holding it is the office, not a blank to fill');
});

test('a voucher asks for whole rupees, which is why paise never reach it', () => {
  // The asset's cost is rounded before anything is spelled out, so the
  // floating-point edge in the paise path cannot land on a voucher.
  const v = voucher({ ...ASSET, purchase_cost: 42000.4 });
  assert.equal(v.amount, 42000);
  assert.ok(!v.amount_in_words.includes('Paise'));
});
