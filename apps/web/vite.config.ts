import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Served from https://jraleman.com/ReactBoy/ on GitHub Pages.
  base: process.env.BASE_PATH ?? '/ReactBoy/',
  plugins: [
    react(),
    VitePWA({
      // A new version waits until the player chooses to reload (see src/pwa.ts).
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'ReactBoy',
        short_name: 'ReactBoy',
        description:
          'A Game Boy emulator that runs in your browser. Load your own ROMs; nothing leaves your device.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#17161f',
        theme_color: '#26243a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        // Opening a .gb file with the installed app (Chromium) hands it to the launch queue.
        file_handlers: [{ action: '.', accept: { 'application/x-gameboy-rom': ['.gb', '.gbc'] } }],
        launch_handler: { client_mode: 'focus-existing' },
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
