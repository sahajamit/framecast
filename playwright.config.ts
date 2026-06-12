import { defineConfig } from '@playwright/test';

/**
 * E2E against real Chrome with fake capture devices:
 * - fake camera/mic streams (no hardware needed)
 * - the screen picker auto-selects the framecast tab itself
 * - ?e2e=1 backs the library with OPFS and renders controls inline
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5179',
    channel: 'chrome',
    headless: true,
    permissions: ['camera', 'microphone'],
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--auto-select-tab-capture-source-by-title=framecast',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  webServer: {
    command: 'npm run dev -- --port 5179 --strictPort',
    url: 'http://localhost:5179',
    reuseExistingServer: !process.env.CI,
  },
});
