import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron } from '@playwright/test';
import { test, expect } from './fixtures/electron-app';

test('launching with a file path, as Windows does on double-click, opens that file', async () => {
  test.skip(process.platform !== 'win32', 'Windows packaged build path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markover assoc '));
  const file = path.join(dir, 'Double Clicked.md');
  fs.writeFileSync(file, '# Opened from Explorer\n\nHello.\n');
  const exe = path.resolve(__dirname, '..', '..', 'out', 'Markover-win32-x64', 'Markover.exe');
  const app = await _electron.launch({ executablePath: exe, args: [file], env: { ...process.env, MARKOVER_E2E_TEST: '1' } });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.ProseMirror h1')).toHaveText('Opened from Explorer', { timeout: 15_000 });
    await expect(page.getByText('Double Clicked.md', { exact: true })).toBeVisible();
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('File menu offers to open Markdown files with Markover on Windows', async ({ electronApp }) => {
  test.skip(process.platform !== 'win32', 'Windows-only menu item');
  const labels = await electronApp.evaluate(({ Menu }) => {
    const file = Menu.getApplicationMenu()?.items.find((i) => i.label === 'File');
    return file?.submenu?.items.map((i) => i.label) ?? [];
  });
  expect(labels).toContain('Open Markdown Files with Markover...');
  expect(labels.indexOf('Open Markdown Files with Markover...')).toBeLessThan(labels.length - 1);
});
