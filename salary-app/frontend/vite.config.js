import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // shared/calc.js lives above this directory - the dashboard recalculates
    // locally with the exact same code the server uses.
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://localhost:3002' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
