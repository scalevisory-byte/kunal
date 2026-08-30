import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev the dashboard runs on :5173 and proxies /api to the backend on :3001,
// so the browser sees a single origin and no CORS or auth-header surprises.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
  },
});
