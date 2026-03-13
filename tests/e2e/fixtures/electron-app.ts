import { test as base, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';

// Determine the path to the packaged Electron app
function getAppPath(): string {
  const rootDir = path.resolve(__dirname, '..', '..', '..');
  if (process.platform === 'win32') {
    return path.join(rootDir, 'out', 'markover-win32-x64', 'markover.exe');
  } else if (process.platform === 'darwin') {
    return path.join(rootDir, 'out', 'markover-darwin-x64', 'markover.app', 'Contents', 'MacOS', 'markover');
  } else {
    return path.join(rootDir, 'out', 'markover-linux-x64', 'markover');
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
    });
    await use(app);
    await app.close();
  },
  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await use(page);
  },
});

export { expect };
