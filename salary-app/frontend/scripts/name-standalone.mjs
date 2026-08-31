import fs from 'node:fs';
import path from 'node:path';

/** Vite writes index.html; the file people download deserves a real name. */
const dir = path.resolve('dist-standalone');
const from = path.join(dir, 'index.html');
const to = path.join(dir, 'Salary-Sheet.html');

if (!fs.existsSync(from)) {
  console.error('No dist-standalone/index.html - did the build run?');
  process.exit(1);
}
fs.renameSync(from, to);

// Anything left beside it means something failed to inline, and the file would
// be broken the moment it is moved somewhere else.
const strays = fs.readdirSync(dir).filter((name) => name !== 'Salary-Sheet.html');
if (strays.length) {
  console.error(`Not self-contained - these were not inlined: ${strays.join(', ')}`);
  process.exit(1);
}

const size = fs.statSync(to).size;
console.log(`Salary-Sheet.html  ${(size / 1024 / 1024).toFixed(2)} MB  (one file, no server)`);
