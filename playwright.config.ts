import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests of the key flows, against a running build:
 *   docker compose -f docker-compose.yml -f docker-compose.local.yml up -d   (http://localhost:4280)
 *   npm run test:e2e
 * E2E_BASE_URL targets another server (e.g. http://localhost:4200 with `npm start`), E2E_CHANNEL
 * another browser (chrome by default: WebCodecs and WebGPU), E2E_AI=1 adds the Whisper tests.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:4280',
    channel: process.env['E2E_CHANNEL'] ?? 'chrome',
    locale: 'en-US',
    viewport: { width: 1400, height: 900 },
    colorScheme: 'dark',
    acceptDownloads: true,
    launchOptions: { args: ['--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required'] },
  },
});
