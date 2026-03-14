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
    const app = await _electron.launch({ executablePath: getAppPath() });
    await use(app);
    await app.close();
  },
  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    // Wait for the React app to mount
    await page.waitForSelector('.ProseMirror', { timeout: 15_000 });
    await use(page);
  },
});

export { expect };
