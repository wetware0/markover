import { execSync } from 'child_process';

export default function globalSetup() {
  console.log('Packaging Electron app for E2E tests...');
  execSync('npx electron-forge package', { stdio: 'inherit', cwd: process.cwd() });
}
