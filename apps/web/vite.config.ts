import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Served from https://jraleman.com/ReactBoy/ on GitHub Pages.
  base: process.env.BASE_PATH ?? '/ReactBoy/',
  plugins: [react()],
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
