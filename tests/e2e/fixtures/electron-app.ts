import { test as base, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';

function getAppPath(): string {
  const rootDir = path.resolve(__dirname, '..', '..', '..');
  if (process.platform === 'win32') {
    return path.join(rootDir, 'out', 'Markover-win32-x64', 'Markover.exe');
  } else if (process.platform === 'darwin') {
    return path.join(rootDir, 'out', 'Markover-darwin-x64', 'Markover.app', 'Contents', 'MacOS', 'Markover');
  } else {
    return path.join(rootDir, 'out', 'Markover-linux-x64', 'markover');
  }
}

type ElectronFixtures = {
  electronApp: ElectronApplication;
  page: Page;
};

export const test = base.extend<ElectronFixtures>({
  // eslint-disable-next-line no-empty-pattern
  electronApp: async ({}, use) => {
    const app = await _electron.launch({
      executablePath: getAppPath(),
      // E2E mode: the main process reads MARKOVER_E2E_TEST to skip the
      // auto-update probe and the unsaved-changes close dialog so test
      // teardown doesn't race a dialog or hang on network.
      env: { ...process.env, MARKOVER_E2E_TEST: '1' },
    });
    await use(app);
    await app.close();
  },
  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    // Auto-dismiss any dialog the page surfaces (e.g. confirm()s, beforeunload
    // prompts) so they don't race Playwright's session-close protocol.
    page.on('dialog', (d) => { void d.dismiss(); });
    // Wait for the React app to mount
    await page.waitForSelector('.ProseMirror', { timeout: 15_000 });
    await use(page);
  },
});

export { expect };
