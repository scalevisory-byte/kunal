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
  return {
    plugins: [react(), ...(standalone ? [viteSingleFile()] : [])],
    define: { 'import.meta.env.VITE_STANDALONE': JSON.stringify(String(standalone)) },
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
