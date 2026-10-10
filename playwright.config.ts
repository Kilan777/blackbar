import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  use: { channel: 'chrome', baseURL: 'http://localhost:4173', acceptDownloads: true },
  webServer: { command: 'npm run build && npx vite preview --port 4173 --strictPort', port: 4173, reuseExistingServer: false, timeout: 120_000 },
});
