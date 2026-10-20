import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const CI = !!process.env.CI;

/** Runs against the production build (`pnpm build` first), so the service worker is real. */
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/ReactBoy/`,
    trace: 'retain-on-failure',
  },
  // Chromium covers service workers, file handling and the audio worklet.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/ReactBoy/`,
    reuseExistingServer: !CI,
  },
});
