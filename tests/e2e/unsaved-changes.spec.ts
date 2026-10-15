import { test, expect } from './fixtures/electron-app';
import type { ElectronApplication, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function menuAction(app: ElectronApplication, action: string) {
  await app.evaluate(({ BrowserWindow }, name) => {
    BrowserWindow.getAllWindows()[0].webContents.send('menu:action', name);
  }, action);
}

async function toggleModes(page: Page) {
  await page.locator('button[title="Edit Raw Markdown"]').click();
  await page.locator('button[title="Switch to WYSIWYG"]').click();
}

test('formatted edits remain unsaved after viewing raw Markdown', async ({ page, electronApp }) => {
  const editor = page.locator('.ProseMirror');
  await editor.fill('Price is $100.00, total is $110.00.');
  await expect(page.getByText('Untitled •', { exact: true })).toBeVisible();
  await toggleModes(page);
  await expect(page.getByText('Untitled •', { exact: true })).toBeVisible();
  await menuAction(electronApp, 'new');
  await expect(page.getByRole('heading', { name: 'Unsaved Changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor).toHaveText('Price is $100.00, total is $110.00.');
});

test('raw edits remain unsaved after returning to formatted view', async ({ page, electronApp }) => {
  await page.locator('button[title="Edit Raw Markdown"]').click();
  await page.locator('.cm-content').fill('Raw price is $100.00.');
  await expect(page.getByText('Untitled •', { exact: true })).toBeVisible();
  await page.locator('button[title="Switch to WYSIWYG"]').click();
  await expect(page.getByText('Untitled •', { exact: true })).toBeVisible();
  await menuAction(electronApp, 'new');
  await expect(page.getByRole('heading', { name: 'Unsaved Changes' })).toBeVisible();
});

test('view-only mode switches do not mark a clean document as unsaved', async ({ page, electronApp }) => {
  await toggleModes(page);
  await toggleModes(page);
  await expect(page.getByText('Untitled •', { exact: true })).toHaveCount(0);
  await menuAction(electronApp, 'new');
  await expect(page.getByRole('heading', { name: 'Unsaved Changes' })).toHaveCount(0);
});

test('saving in raw mode stays clean after returning to formatted view', async ({ page, electronApp }) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'markover-unsaved-'));
  const filePath = path.join(tempDir, 'saved.md');
  try {
    await electronApp.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    }, filePath);
    await page.locator('button[title="Edit Raw Markdown"]').click();
    await page.locator('.cm-content').fill('Saved price is $100.00.');
    await menuAction(electronApp, 'save');
    await expect.poll(() => fs.existsSync(filePath)).toBe(true);
    await expect(page.getByText('saved.md', { exact: true })).toBeVisible();
    await page.locator('button[title="Switch to WYSIWYG"]').click();
    await expect(page.getByText('saved.md •', { exact: true })).toHaveCount(0);
    await menuAction(electronApp, 'new');
    await expect(page.getByRole('heading', { name: 'Unsaved Changes' })).toHaveCount(0);
    await expect(page.locator('.ProseMirror')).toHaveText('');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('canceling Save As keeps the pending document and confirmation open', async ({ page, electronApp }) => {
  await electronApp.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' });
  });
  await page.locator('.ProseMirror').fill('Keep this unsaved text.');
  await menuAction(electronApp, 'new');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toHaveText('Keep this unsaved text.');
  await expect(page.getByRole('heading', { name: 'Unsaved Changes' })).toBeVisible();
});

test('a successful save preserves edits before creating a new document', async ({ page, electronApp }) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'markover-save-before-new-'));
  const filePath = path.join(tempDir, 'previous-document.md');
  try {
    await electronApp.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    }, filePath);
    await page.locator('.ProseMirror').fill('Save these edits before starting again.');
    await toggleModes(page);
    await menuAction(electronApp, 'new');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf8')).toContain('Save these edits before starting again.');
    await expect(page.locator('.ProseMirror')).toHaveText('');
    await expect(page.getByRole('heading', { name: 'Unsaved Changes' })).toHaveCount(0);
    await expect(page.getByText('Untitled •', { exact: true })).toHaveCount(0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('a failed save keeps the pending document and confirmation open', async ({ page, electronApp }) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'markover-save-failure-'));
  try {
    await electronApp.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    }, path.join(tempDir, 'missing-directory', 'cannot-save.md'));
    await page.locator('.ProseMirror').fill('Keep this text if saving fails.');
    await menuAction(electronApp, 'new');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(/Save failed:/)).toBeVisible();
    await expect(page.locator('.ProseMirror')).toHaveText('Keep this text if saving fails.');
    await expect(page.getByRole('heading', { name: 'Unsaved Changes' })).toBeVisible();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test.describe('Native close protection', () => {
  test.use({ closeGuardEnabled: true });

  test('closing after a mode switch prompts and Cancel preserves edits', async ({ page, electronApp }) => {
    await electronApp.evaluate(({ dialog }) => {
      const state = globalThis as unknown as { closePrompts: string[] };
      state.closePrompts = [];
      dialog.showMessageBox = async (...args: unknown[]) => {
        state.closePrompts.push((args[args.length - 1] as { message: string }).message);
        return { response: 2, checkboxChecked: false };
      };
    });
    await page.locator('.ProseMirror').fill('Price is $100.00, total is $110.00.');
    await toggleModes(page);
    await expect(page.getByText('Untitled •', { exact: true })).toBeVisible();
    await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
    await expect.poll(() => electronApp.evaluate(() => (globalThis as unknown as { closePrompts: string[] }).closePrompts)).toEqual(['You have unsaved changes']);
    await expect(page.locator('.ProseMirror')).toHaveText('Price is $100.00, total is $110.00.');
    await expect(page.getByText('Untitled •', { exact: true })).toBeVisible();
  });

  test('canceling Save As after Save and Close leaves the window open', async ({ page, electronApp }) => {
    await electronApp.evaluate(({ dialog }) => {
      const state = globalThis as unknown as { saveAttempts: number };
      state.saveAttempts = 0;
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
      dialog.showSaveDialog = async () => {
        state.saveAttempts++;
        return { canceled: true, filePath: '' };
      };
    });
    await page.locator('.ProseMirror').fill('Keep these changes when Save As is canceled.');
    await toggleModes(page);
    await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
    await expect.poll(() => electronApp.evaluate(() => (globalThis as unknown as { saveAttempts: number }).saveAttempts)).toBe(1);
    await expect(page.locator('.ProseMirror')).toHaveText('Keep these changes when Save As is canceled.');
    await expect(page.getByText('Untitled •', { exact: true })).toBeVisible();
  });
});
