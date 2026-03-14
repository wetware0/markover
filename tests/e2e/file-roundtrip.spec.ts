import { test, expect } from './fixtures/electron-app';
import path from 'path';
import fs from 'fs';
import os from 'os';

test.describe('File round-tripping', () => {
  let tempDir: string;

  test.beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'markover-test-'));
  });

  test.afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('dirty indicator appears after typing', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('Making the doc dirty');

    // Status bar should show the dirty bullet •
    const statusBar = page.locator('text=Untitled •');
    await expect(statusBar).toBeVisible({ timeout: 5_000 });
  });

  test('word count updates as you type', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('one two three');

    await expect(page.locator('text=3 words')).toBeVisible({ timeout: 5_000 });
  });

  test('markdown formatting round-trips through raw mode', async ({ page }) => {
    const markdownCases = [
      { type: 'Control+B', syntax: '**', text: 'bold' },
      { type: 'Control+I', syntax: '*', text: 'italic' },
    ];

    for (const { type, syntax, text } of markdownCases) {
      // Start fresh
      const editor = page.locator('.ProseMirror');
      await editor.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');

      await page.keyboard.type(text);
      await page.keyboard.press('Control+A');
      await page.keyboard.press(type);

      // Check in raw mode
      await page.locator('button[title="Edit Raw Markdown"]').click();
      await expect(page.locator('.cm-content')).toContainText(`${syntax}${text}${syntax}`, { timeout: 5_000 });

      // Return to WYSIWYG
      await page.locator('button[title="Switch to WYSIWYG"]').click();
      await expect(editor).toBeVisible({ timeout: 5_000 });
    }
  });

  test('headings serialise correctly to markdown', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('My Heading');
    await page.keyboard.press('Control+A');

    // H1 via toolbar
    await page.locator('button[title="Heading 1"]').click();

    await page.locator('button[title="Edit Raw Markdown"]').click();
    await expect(page.locator('.cm-content')).toContainText('# My Heading', { timeout: 5_000 });

    await page.locator('button[title="Switch to WYSIWYG"]').click();
  });

  test('status bar shows cursor position', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();

    // Should show Ln 1, Col 1 initially
    await expect(page.locator('text=Ln 1, Col 1')).toBeVisible({ timeout: 5_000 });
  });

  test('character count updates as you type', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('hello');

    await expect(page.locator('text=5 characters')).toBeVisible({ timeout: 5_000 });
  });
});
