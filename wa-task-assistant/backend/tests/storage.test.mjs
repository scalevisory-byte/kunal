/**
 * How much room is left where the data lives.
 *
 * This is the figure that has actually taken the service down: the volume
 * filled, SQLite could not write, and the process died before it bound a port
 * - so it could not report its own outage. Nothing was watching. Now something
 * is, and these are the cases that decide whether it speaks up.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-storage-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const { diagnostics } = await import('../src/diagnostics.js');

describe('space where the data lives', () => {
  it('is reported, and adds up', () => {
    const { storage } = diagnostics();
    assert.ok(storage, 'statfs answered');
    assert.ok(storage.totalBytes > 0);
    assert.ok(storage.availableBytes >= 0);
    assert.ok(storage.availableBytes <= storage.totalBytes);
    assert.equal(
      storage.usedPct,
      Math.round(((storage.totalBytes - storage.availableBytes) / storage.totalBytes) * 100)
    );
  });

  it('does not cry wolf on a big disk that is proportionally full', () => {
    /*
     * A development machine with 29 GB free on a 270 GB disk is 89% used and
     * in no danger. Warning there teaches you to ignore the real one, so the
     * percentage only counts when the absolute room is small too.
     */
    const { storage } = diagnostics();
    if (storage.availableBytes > 2 * 1024 ** 3) {
      assert.equal(storage.low, false, 'gigabytes free is not low, whatever the percentage');
    }
  });
});
