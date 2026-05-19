import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Electron cold-start on Windows can take 15+ seconds, then the React app
  // needs to mount before the .ProseMirror selector appears. Keep test timeout
  // well above launch time so the fixture has room.
  timeout: 60_000,
  globalSetup: './tests/e2e/global-setup.ts',
  reporter: [['list'], ['html', { open: 'never' }]],
});
