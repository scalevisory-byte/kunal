import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * One build. Unlike the salary app there is no standalone file here: the whole
 * point of this app is a link a stranger can open, which needs a server.
 */
export default defineConfig({
  plugins: [react()],
  define: {
    // Stamped into the page so a screenshot can be dated.
    __BUILT__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 5175,
    // shared/ lives above this directory: the dashboard scores and words
    // messages with the exact same code the server uses.
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://localhost:3003', '/files': 'http://localhost:3003' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
