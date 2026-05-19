import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const TEST_BUILD_MARKER = path.join(
  process.cwd(),
  'out',
  'Markover-win32-x64',
  '.markover-test-build',
);

export default function globalSetup() {
  const exePath = path.join(
    process.cwd(),
    'out',
    'Markover-win32-x64',
    'Markover.exe',
  );

  const haveTestBuild = fs.existsSync(exePath) && fs.existsSync(TEST_BUILD_MARKER);

  if (haveTestBuild) {
    console.log('Test-mode packaged app already exists, skipping packaging step.');
    return;
  }

  // Either no build at all, or the existing build is a release build (whose
  // EnableNodeCliInspectArguments fuse is off — Playwright cannot attach).
  // Repackage with MARKOVER_TEST_BUILD=1 so the fuse is flipped on.
  console.log('Packaging Electron app for E2E tests (MARKOVER_TEST_BUILD=1)...');
  execSync('npx electron-forge package', {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env, MARKOVER_TEST_BUILD: '1' },
  });
  fs.writeFileSync(TEST_BUILD_MARKER, 'test build');
}
