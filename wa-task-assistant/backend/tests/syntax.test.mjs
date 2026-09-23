/*
 * Every backend source file parses.
 *
 * A route file cut mid-function while removing an endpoint left a stray
 * `return` at the top level - and the whole suite still passed, because no
 * test imports the routes. On Railway that is "WA Tasks did not start": the
 * server binds and every page is the fallback. `node --check` over every file
 * costs a second and would have said so before the push.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
  e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []
));

describe('the server can load', () => {
  const files = walk(src);
  it('finds the source', () => assert.ok(files.length > 20 && files.some((f) => f.includes('routes'))));
  for (const file of files) {
    it(path.relative(src, file), () => {
      try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
      } catch (err) {
        assert.fail(String(err.stderr || err.message));
      }
    });
  }
});
