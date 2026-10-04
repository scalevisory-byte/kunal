#!/usr/bin/env node
/**
 * AI File Organizer
 * Usage:  node organizer.js <folder-path> [options]
 *
 * Options:
 *   --execute      Actually move files (default: dry run only)
 *   --recursive    Also scan sub-folders
 *   --depth <n>    Max folder depth when recursive (default: 3)
 *   --no-confirm   Skip the "press Y to proceed" step (use with --execute)
 *   --model <id>   Override model (default: claude-haiku-4-5-20251001)
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const targetFolder = args.find(a => !a.startsWith('--'));

if (!targetFolder || args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage:  node organizer.js <folder-path> [options]

Options:
  --execute      Actually move files  (default: dry run – shows plan only)
  --recursive    Also scan sub-folders
  --depth <n>    Max scan depth when --recursive  (default: 3)
  --no-confirm   Skip the confirmation prompt  (combine with --execute)
  --model <id>   Override the AI model

Example:
  node organizer.js ~/Downloads
  node organizer.js ~/Downloads --execute
  node organizer.js ~/Documents --recursive --execute
`);
  process.exit(0);
}

const EXECUTE     = args.includes('--execute');
const RECURSIVE   = args.includes('--recursive');
const NO_CONFIRM  = args.includes('--no-confirm');
const DEPTH       = parseInt(args[args.indexOf('--depth') + 1] || '3', 10);
const MODEL       = args.includes('--model')
  ? args[args.indexOf('--model') + 1]
  : 'claude-haiku-4-5-20251001';

const BATCH_SIZE  = 50;   // files per AI call
const SKIP_DIRS   = new Set(['.git', 'node_modules', '__pycache__', '.DS_Store', 'Thumbs.db']);

// ─── File scanner ─────────────────────────────────────────────────────────────

function scanFiles(dir, maxDepth, currentDepth = 0) {
  const files = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isFile()) {
      files.push(fullPath);
    } else if (entry.isDirectory() && RECURSIVE && currentDepth < maxDepth) {
      files.push(...scanFiles(fullPath, maxDepth, currentDepth + 1));
    }
  }
  return files;
}

// ─── AI categoriser ───────────────────────────────────────────────────────────

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a file organization assistant. Given a list of file names (with their relative paths), decide which organised sub-folder each file should go into.

Rules:
1. Return ONLY a JSON array, no markdown, no explanation.
2. Each element: { "file": "<original relative path>", "folder": "<destination folder>", "reason": "<one short sentence>" }
3. "folder" must be a clean folder name (e.g. "Book N Fly", "Scale Visory", "ZYNTA Placement", "Arth Advisory", "Arrohan Living", "Personal", "Photos", "Documents", "Videos", "Audio", "Archives", "Code", "Installers"). Create meaningful sub-folders based on the file content or name.
4. Never suggest moving a file into its current folder – if a file is already well-placed, say folder = "KEEP" and reason = "already organised".
5. Use the file extension and name to infer purpose. For the owner's businesses:
   - BNF / Book N Fly / travel / flight / booking / ticket / itinerary → "Book N Fly"
   - GST / TDS / ITR / tax / audit / ledger / balance sheet / scale visory → "Scale Visory"
   - placement / recruitment / CV / resume / candidate / zynta → "ZYNTA Placement"
   - recovery / NI Act / notice / cheque / arth / artha → "Arth Advisory"
   - furniture / interior / design / arrohan / living → "Arrohan Living"
6. For clearly personal files (photos, personal docs, family), use "Personal".
7. Group installer/setup files under "Installers". Videos under "Videos". Music under "Audio".`;

async function categorise(relativePaths) {
  const userMessage = `Organise these files:\n${relativePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content[0].text.trim();
  // Strip markdown code fences if model added them
  const json = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(json);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

const ANSI = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', red: '\x1b[31m', dim: '\x1b[2m',
};
const c = (code, str) => `${code}${str}${ANSI.reset}`;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const absFolder = path.resolve(targetFolder);

  if (!fs.existsSync(absFolder) || !fs.statSync(absFolder).isDirectory()) {
    console.error(c(ANSI.red, `✗ Not a valid folder: ${absFolder}`));
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(c(ANSI.red, '✗ ANTHROPIC_API_KEY is not set.'));
    console.error('  Export it first:  export ANTHROPIC_API_KEY=sk-ant-...');
    process.exit(1);
  }

  console.log(`\n${c(ANSI.bold, '📁 AI File Organizer')}`);
  console.log(`   Folder : ${c(ANSI.cyan, absFolder)}`);
  console.log(`   Mode   : ${RECURSIVE ? `recursive (max depth ${DEPTH})` : 'top-level only'}`);
  console.log(`   Action : ${EXECUTE ? c(ANSI.yellow, 'EXECUTE — files will be moved') : c(ANSI.green, 'DRY RUN — no files touched')}`);
  console.log(`   Model  : ${MODEL}\n`);

  // Scan
  process.stdout.write('Scanning files…');
  const allFiles = scanFiles(absFolder, DEPTH);
  const relFiles = allFiles.map(f => path.relative(absFolder, f));
  console.log(` found ${c(ANSI.bold, plural(relFiles.length, 'file'))}`);

  if (relFiles.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // Batch AI calls
  const plan = [];
  const batches = Math.ceil(relFiles.length / BATCH_SIZE);
  console.log(`Asking Claude to categorise ${plural(relFiles.length, 'file')} in ${plural(batches, 'batch')}…\n`);

  for (let i = 0; i < relFiles.length; i += BATCH_SIZE) {
    const batch = relFiles.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    process.stdout.write(`  Batch ${batchNum}/${batches}… `);
    try {
      const results = await categorise(batch);
      plan.push(...results);
      console.log(c(ANSI.green, '✓'));
    } catch (err) {
      console.log(c(ANSI.red, `✗ (${err.message})`));
      console.error('Aborting.');
      process.exit(1);
    }
  }

  // Display plan
  console.log(`\n${c(ANSI.bold, '─── Proposed organisation ───────────────────────────────────')}\n`);

  // Group by destination
  const grouped = {};
  let keepCount = 0;
  for (const item of plan) {
    if (item.folder === 'KEEP') { keepCount++; continue; }
    const dest = item.folder;
    if (!grouped[dest]) grouped[dest] = [];
    grouped[dest].push(item);
  }

  const moveCount = plan.length - keepCount;
  const folders = Object.keys(grouped).sort();

  for (const folder of folders) {
    console.log(`${c(ANSI.bold + ANSI.cyan, folder)}  (${grouped[folder].length} files)`);
    for (const item of grouped[folder]) {
      const shortName = item.file.length > 60 ? '…' + item.file.slice(-57) : item.file;
      console.log(`  ${c(ANSI.dim, '→')} ${shortName}`);
      console.log(`    ${c(ANSI.dim, item.reason)}`);
    }
    console.log();
  }

  if (keepCount > 0) {
    console.log(c(ANSI.dim, `  (${keepCount} files already in the right place — unchanged)\n`));
  }

  console.log(`${c(ANSI.bold, '─────────────────────────────────────────────────────────────')}`);
  console.log(`  ${c(ANSI.bold, plural(moveCount, 'file'))} will move into ${plural(folders.length, 'folder')}.\n`);

  if (moveCount === 0) {
    console.log('Everything is already organised. Nothing to move.');
    return;
  }

  if (!EXECUTE) {
    console.log(c(ANSI.yellow, '  This was a DRY RUN.  Re-run with --execute to apply.\n'));
    return;
  }

  // Confirm
  if (!NO_CONFIRM) {
    const answer = await ask('Proceed? This will move files.  [y/N] ');
    if (answer.toLowerCase() !== 'y') {
      console.log('Cancelled.');
      return;
    }
  }

  // Execute moves
  console.log('\nMoving files…');
  let moved = 0, skipped = 0, errors = 0;

  for (const folder of folders) {
    const destDir = path.join(absFolder, folder);
    try {
      fs.mkdirSync(destDir, { recursive: true });
    } catch (err) {
      console.error(c(ANSI.red, `  ✗ Could not create ${destDir}: ${err.message}`));
      errors++;
      continue;
    }

    for (const item of grouped[folder]) {
      const src  = path.join(absFolder, item.file);
      const dest = path.join(destDir, path.basename(item.file));

      // Skip if source no longer exists
      if (!fs.existsSync(src)) { skipped++; continue; }

      // Avoid collision — rename with a counter if needed
      let finalDest = dest;
      let counter = 1;
      while (fs.existsSync(finalDest)) {
        const ext  = path.extname(dest);
        const base = path.basename(dest, ext);
        finalDest = path.join(destDir, `${base} (${counter})${ext}`);
        counter++;
      }

      try {
        fs.renameSync(src, finalDest);
        moved++;
        console.log(`  ${c(ANSI.green, '✓')} ${item.file}  →  ${folder}/`);
      } catch (err) {
        // Cross-device move: copy + delete
        try {
          fs.copyFileSync(src, finalDest);
          fs.unlinkSync(src);
          moved++;
          console.log(`  ${c(ANSI.green, '✓')} ${item.file}  →  ${folder}/`);
        } catch (err2) {
          console.error(`  ${c(ANSI.red, '✗')} ${item.file}: ${err2.message}`);
          errors++;
        }
      }
    }
  }

  console.log(`\n${c(ANSI.bold, '─── Done ─────────────────────────────')}`);
  console.log(`  Moved  : ${c(ANSI.green, moved)}`);
  if (skipped > 0)  console.log(`  Skipped: ${skipped} (file gone before move)`);
  if (errors  > 0)  console.log(`  Errors : ${c(ANSI.red, errors)}`);
  console.log();
}

main().catch(err => {
  console.error(c(ANSI.red, `\nFatal error: ${err.message}`));
  process.exit(1);
});
