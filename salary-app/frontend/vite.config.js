import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Two builds from one source:
 *
 *   npm run build             the dashboard the server serves, talking to /api
 *   npm run build:standalone  one self-contained .html file that keeps its data
 *                             in the browser and needs no server at all
 *
 * The difference is VITE_STANDALONE, which api.js reads; every component is
 * identical in both.
 */
export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';

  // An employee master baked into the standalone file, so it opens with
  // everybody already listed rather than empty. Built by
  // scripts/make-seed.mjs; absent is fine, the file just starts blank.
  const seedPath = path.resolve('seed.json');
  const seed = standalone && fs.existsSync(seedPath) ? fs.readFileSync(seedPath, 'utf8') : 'null';
  if (standalone) {
    const count = seed === 'null' ? 0 : JSON.parse(seed).employees.length;
    console.log(count ? `Baking in ${count} employees from seed.json` : 'No seed.json - the file will start empty');
  }

  /*
   * A blank copy, for testing or for handing to somebody else.
   *
   * It needs its OWN storage key, and that is the whole point of this flag.
   * Every file:// copy in a browser shares one localStorage, so a blank file
   * opened in the browser that already holds the real payroll showed all 85
   * people - the file was blank, the browser was not, and it read as if the
   * blank build had simply not worked.
   *
   * Tied to an explicit flag, NOT to "seed.json is missing": deriving it from
   * the seed would mean one rebuild with the seed mislaid silently moved the
   * key and made his real work vanish.
   */
  const blank = standalone && process.env.BLANK_BUILD === '1';
  if (blank) console.log('BLANK build - its own storage, so it cannot see the real data');

  return {
    plugins: [react(), ...(standalone ? [viteSingleFile()] : [])],
    define: {
      'import.meta.env.VITE_STANDALONE': JSON.stringify(String(standalone)),
      __SEED__: seed,
      __BLANK__: JSON.stringify(blank),
      // The real file keeps this key for ever - it is where the work lives.
      __STORE_KEY__: JSON.stringify(blank ? 'salary-app-blank-v1' : 'salary-app-data-v1'),
      // Stamped into the page so a downloaded file can say how old it is.
      // Every download lands as "SalarySheet (3).html" and so on, and there is
      // no other way to tell one from the next.
      __BUILT__: JSON.stringify(new Date().toISOString()),
    },
    server: {
      port: 5174,
      // shared/ lives above this directory - the dashboard recalculates locally
      // with the exact same code the server uses.
      fs: { allow: ['..'] },
      proxy: { '/api': 'http://localhost:3002' },
    },
    build: {
      outDir: standalone ? 'dist-standalone' : 'dist',
      emptyOutDir: true,
      assetsInlineLimit: standalone ? 100000000 : 4096,
      chunkSizeWarningLimit: standalone ? 5000 : 500,
    },
  };
});
