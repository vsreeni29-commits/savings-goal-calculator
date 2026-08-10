import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Relative base keeps the same build working on GitHub Pages (served from a
// sub-path) and inside the Capacitor WebView (served from the app bundle).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2020',
  },
  server: {
    host: true,
    port: 5173,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
