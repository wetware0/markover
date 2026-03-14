import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export default function globalSetup() {
  const exePath = path.join(
    process.cwd(),
    'out',
    'Markover-win32-x64',
    'Markover.exe',
  );

  if (fs.existsSync(exePath)) {
    console.log('Packaged app already exists, skipping packaging step.');
    return;
  }

  console.log('Packaging Electron app for E2E tests...');
  execSync('npx electron-forge package', { stdio: 'inherit', cwd: process.cwd() });
}
