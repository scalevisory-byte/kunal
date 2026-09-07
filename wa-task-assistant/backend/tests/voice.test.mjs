/**
 * Voice notes.
 *
 * Claude reads text and pictures but not audio, so this is the one step that
 * needs a service outside Anthropic. That makes the important cases the ones
 * where the service is absent or unwell: with no key, or a provider that is
 * down, a voice note must be left exactly as it was before this existed - never
 * an error that costs the message it arrived with.
 *
 * Each scenario runs in its own process. `config.js` reads the environment once
 * at import, so changing an environment variable and re-importing would test a
 * configuration the module never actually had.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

let passed = 0;
let failed = 0;
const run = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
};

const dirs = [];

/**
 * Runs `body` in a fresh process with the given environment, and returns what
 * it wrote to stdout as JSON. `fetchImpl` is source text for a stub, so a test
 * can decide what the speech service does without a network.
 */
function inProcess(env, { fetchImpl = 'null', body }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-voice-'));
  dirs.push(dir);
  const script = `
    const stub = ${fetchImpl};
    if (stub) globalThis.fetch = stub;
    const out = { calls: [] };
    if (stub) {
      const inner = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        out.calls.push({ url: String(url), headers: init?.headers ?? null });
        return inner(url, init);
      };
    }
    const main = async () => {
      const T = await import('./src/transcribe.js');
      ${body}
      process.stdout.write('@@' + JSON.stringify(out) + '@@');
    };
    main().catch((e) => { process.stdout.write('@@' + JSON.stringify({ error: e.message }) + '@@'); });
  `;
  const raw = execFileSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: dir, EXTRACTION_MODE: 'manual', TIMEZONE: 'Asia/Kolkata', ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(raw.split('@@')[1]);
}

const noKey = { SPEECH_API_KEY: '', SPEECH_PROVIDER: 'sarvam' };
const withKey = { SPEECH_API_KEY: 'test-key', SPEECH_PROVIDER: 'sarvam' };

const OK = (transcript) =>
  `async () => new Response(JSON.stringify({ transcript: ${JSON.stringify(transcript)} }), { status: 200 })`;

console.log('\nwith no speech service configured');

run('the feature reports itself off', () => {
  const out = inProcess(noKey, { body: 'out.state = T.transcriptionState();' });
  assert.equal(out.state.enabled, false);
  assert.equal(out.state.hasKey, false);
  assert.ok(out.state.providers.includes('sarvam'), 'and still says which services it knows');
});

run('nothing is sent anywhere at all', () => {
  // No key must mean no request, not a request that fails.
  const out = inProcess(noKey, {
    fetchImpl: 'async () => { throw new Error("should not be reached"); }',
    body: 'out.result = await T.transcribe({ buffer: Buffer.alloc(1000), mime: "audio/ogg" });',
  });
  assert.equal(out.result, null);
  assert.equal(out.calls.length, 0);
});

console.log('\nwith a service configured');

run('it reports itself on', () => {
  const out = inProcess(withKey, { body: 'out.state = T.transcriptionState();' });
  assert.equal(out.state.enabled, true);
  assert.equal(out.state.provider, 'sarvam');
  assert.equal(out.state.knownProvider, true);
});

run('a transcript comes back as plain words', () => {
  const out = inProcess(withKey, {
    fetchImpl: OK('Kal BNF salary process karni hai'),
    body: 'out.result = await T.transcribe({ buffer: Buffer.alloc(2000), mime: "audio/ogg" });',
  });
  assert.equal(out.result, 'Kal BNF salary process karni hai');
});

run('the key travels in a header, never in the URL', () => {
  const out = inProcess(withKey, {
    fetchImpl: OK('ok'),
    body: 'out.result = await T.transcribe({ buffer: Buffer.alloc(100), mime: "audio/ogg" });',
  });
  assert.equal(out.calls.length, 1);
  assert.ok(!out.calls[0].url.includes('test-key'), 'not in the URL');
  assert.equal(out.calls[0].headers['api-subscription-key'], 'test-key');
});

console.log('\nwhen the service is unwell');

run('a refusal is silence, not an exception', () => {
  const out = inProcess(withKey, {
    fetchImpl: 'async () => new Response("rate limited", { status: 429 })',
    body: 'out.result = await T.transcribe({ buffer: Buffer.alloc(100), mime: "audio/ogg" });',
  });
  assert.equal(out.result, null);
});

run('a network failure is silence too', () => {
  const out = inProcess(withKey, {
    fetchImpl: 'async () => { throw new Error("ECONNRESET"); }',
    body: 'out.result = await T.transcribe({ buffer: Buffer.alloc(100), mime: "audio/ogg" });',
  });
  assert.equal(out.result, null);
});

run('an empty transcript is treated as nothing said', () => {
  const out = inProcess(withKey, {
    fetchImpl: OK('   '),
    body: 'out.result = await T.transcribe({ buffer: Buffer.alloc(100), mime: "audio/ogg" });',
  });
  assert.equal(out.result, null, 'an empty string must not become an empty task');
});

run('a note over the size limit is never uploaded', () => {
  const out = inProcess(withKey, {
    fetchImpl: OK('never'),
    body: 'out.result = await T.transcribe({ buffer: Buffer.alloc(9000000), mime: "audio/ogg" });',
  });
  assert.equal(out.result, null);
  assert.equal(out.calls.length, 0, 'refused before the upload, not after');
});

run('an empty recording is refused', () => {
  const out = inProcess(withKey, {
    fetchImpl: OK('never'),
    body: `
      out.a = await T.transcribe({ buffer: Buffer.alloc(0), mime: "audio/ogg" });
      out.b = await T.transcribe({ buffer: null, mime: "audio/ogg" });`,
  });
  assert.equal(out.a, null);
  assert.equal(out.b, null);
  assert.equal(out.calls.length, 0);
});

run('a very long transcript is capped rather than stored whole', () => {
  const out = inProcess(withKey, {
    fetchImpl: `async () => new Response(JSON.stringify({ transcript: 'x'.repeat(20000) }), { status: 200 })`,
    body: 'out.length = (await T.transcribe({ buffer: Buffer.alloc(100), mime: "audio/ogg" })).length;',
  });
  assert.equal(out.length, 4000);
});

console.log('\nthe other services, and one that does not exist');

run('Whisper providers read their own response shape', () => {
  for (const provider of ['openai', 'groq']) {
    const out = inProcess({ SPEECH_API_KEY: 'k', SPEECH_PROVIDER: provider }, {
      fetchImpl: `async () => new Response(JSON.stringify({ text: 'from ${provider}' }), { status: 200 })`,
      body: 'out.result = await T.transcribe({ buffer: Buffer.alloc(100), mime: "audio/ogg" });',
    });
    assert.equal(out.result, `from ${provider}`, provider);
    assert.equal(out.calls[0].headers.Authorization, 'Bearer k');
  }
});

run('an unknown provider is off rather than guessed at', () => {
  const out = inProcess({ SPEECH_API_KEY: 'k', SPEECH_PROVIDER: 'something-made-up' }, {
    fetchImpl: OK('never'),
    body: `
      out.state = T.transcriptionState();
      out.result = await T.transcribe({ buffer: Buffer.alloc(100), mime: "audio/ogg" });`,
  });
  assert.equal(out.state.enabled, false);
  assert.equal(out.state.knownProvider, false);
  assert.equal(out.result, null);
  assert.equal(out.calls.length, 0);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
