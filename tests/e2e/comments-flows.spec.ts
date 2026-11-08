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

/** Type `text` with tracking off, then select its last `n` characters. */
async function typeAndSelectTail(page: Page, text: string, n: number) {
  await page.locator('.ProseMirror').click();
  await page.keyboard.type(text);
  for (let i = 0; i < n; i++) await page.keyboard.press('Shift+ArrowLeft');
}

async function addComment(page: Page, body: string) {
  await page.locator('button[title="Add Comment (select text first)"]').click();
  const textarea = page.locator('textarea[placeholder="Write a comment…"]');
  await expect(textarea).toBeVisible();
  await textarea.fill(body);
  await page.keyboard.press('Enter');
  await expect(textarea).toHaveCount(0);
}

const thread = (page: Page) => page.locator('.markover-comment-thread');

test.describe('Comment flows', () => {
  test('add, reply, resolve, reopen, delete — focus returns to the editor', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await typeAndSelectTail(page, 'Please review this', 4);
    await addComment(page, 'Is this right?');
    await expect(editor.locator('.markover-highlight')).toHaveText('this');
    await expect(thread(page)).toHaveCount(1);

    // Reply
    const reply = thread(page).locator('input[placeholder="Reply..."]');
    await reply.fill('Yes it is');
    await reply.press('Enter');
    await expect(thread(page)).toContainText('Yes it is');
    await expect(editor).toBeFocused();

    // Resolve → status badge, focus back in editor
    await thread(page).getByRole('button', { name: 'Resolve' }).click();
    await expect(thread(page)).toContainText('resolved');
    await expect(editor).toBeFocused();

    // Reopen
    await thread(page).getByRole('button', { name: 'Reopen' }).click();
    await expect(thread(page)).toContainText('open');
    await expect(editor).toBeFocused();

    // Delete removes the thread and the highlight, keeps the text
    await thread(page).getByRole('button', { name: 'Delete' }).click();
    await expect(thread(page)).toHaveCount(0);
    await expect(editor.locator('.markover-highlight')).toHaveCount(0);
    await expect(editor).toHaveText('Please review this');
    await expect(editor).toBeFocused();
  });

  test('clicking a thread selects its text; clicking the text activates the thread', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await typeAndSelectTail(page, 'First second', 6);
    await addComment(page, 'About second');
    await page.keyboard.press('Home');

    await thread(page).locator('p', { hasText: 'About second' }).click();
    await expect(editor).toBeFocused();
    const selected = await page.evaluate(() => window.getSelection()?.toString());
    expect(selected).toBe('second');

    // Click outside the commented text (start of the line), then on it.
    await editor.locator('p').first().click({ position: { x: 2, y: 5 } });
    await expect(thread(page)).not.toHaveAttribute('data-active', 'true');
    await editor.locator('.markover-highlight').click();
    await expect(thread(page)).toHaveAttribute('data-active', 'true');
  });

  test('typing inside commented text keeps one highlight', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await typeAndSelectTail(page, 'Say hello there', 11);
    await addComment(page, 'Greeting');
    // Caret into the middle of the highlight and type
    await page.keyboard.press('End');
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
    await page.keyboard.type(',');
    await expect(editor.locator('.markover-highlight')).toHaveCount(1);
    await expect(editor.locator('.markover-highlight')).toHaveText('hello, there');
  });

  test('deleting all commented text keeps the thread as detached', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await typeAndSelectTail(page, 'Keep gone', 4);
    await addComment(page, 'Will be orphaned');
    await page.keyboard.press('End');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Delete');
    await expect(editor).toHaveText('Keep ');
    await expect(thread(page)).toHaveCount(1);
    await expect(thread(page).locator('.markover-comment-detached')).toBeVisible();
    // Undo brings the text and the anchor back.
    await page.keyboard.press('Control+Z');
    await expect(editor.locator('.markover-highlight')).toHaveText('gone');
    await expect(thread(page).locator('.markover-comment-detached')).toHaveCount(0);
  });

  test('comment on a tracked insertion; save and reopen round-trips both', async ({ page, electronApp }) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'markover-comments-'));
    const filePath = path.join(tempDir, 'review.md');
    try {
      const editor = page.locator('.ProseMirror');
      await editor.click();
      await page.keyboard.type('Base text.');
      await page.locator('button[title="Track Changes: OFF"]').click();
      await editor.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' Added words', { delay: 120 });
      for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft');
      await addComment(page, 'Why words?');
      const insId = await editor.locator('.markover-insert').first().getAttribute('data-change-id');
      const reply = thread(page).locator('input[placeholder="Reply..."]');
      await reply.fill('Because');
      await reply.press('Enter');

      await electronApp.evaluate(({ dialog }, target) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
      }, filePath);
      await menuAction(electronApp, 'save');
      await expect.poll(() => fs.existsSync(filePath)).toBe(true);
      const saved = fs.readFileSync(filePath, 'utf8');
      expect(saved).toContain(`data-change-id="${insId}"`);
      expect(saved).toContain('data-markov="hl"');
      expect(saved).toContain('Why words?');
      expect(saved).toContain('Because');
      expect((saved.match(/data-markov="ins"/g) ?? []).length).toBeLessThanOrEqual(2);

      // Wait until the save has been acknowledged (title no longer dirty).
      await expect(page.getByText('review.md', { exact: true })).toBeVisible();
      // Start fresh, then reopen the saved file.
      await menuAction(electronApp, 'new');
      await expect(editor).toHaveText('');
      await menuAction(electronApp, 'open');
      await expect(editor).toContainText('Base text. Added words');
      await expect(editor.locator('.markover-highlight')).toHaveText('words');
      const reopenedIds = await editor.locator('.markover-insert').evaluateAll((els) =>
        [...new Set(els.map((e) => e.getAttribute('data-change-id')))],
      );
      expect(reopenedIds).toEqual([insId]);
      // The sidebar stayed open on the Comments tab across New/Open.
      await expect(thread(page)).toContainText('Why words?');
      await expect(thread(page)).toContainText('Because');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('Publish strips comments and accepts tracked changes', async ({ page, electronApp }) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'markover-publish-'));
    const filePath = path.join(tempDir, 'published.md');
    try {
      const editor = page.locator('.ProseMirror');
      await editor.click();
      await page.keyboard.type('Old phrase stays.');
      await page.locator('button[title="Track Changes: OFF"]').click();
      await editor.click();
      // Replace "Old" with "New" (deletion + insertion) and comment on "stays"
      await page.keyboard.press('Home');
      for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
      await page.keyboard.type('New');
      await page.keyboard.press('End');
      await page.keyboard.press('ArrowLeft');
      for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft');
      await addComment(page, 'Check');

      await electronApp.evaluate(({ dialog }, target) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
      }, filePath);
      await menuAction(electronApp, 'publish');
      await expect.poll(() => fs.existsSync(filePath)).toBe(true);
      const out = fs.readFileSync(filePath, 'utf8');
      expect(out.trim()).toBe('New phrase stays.');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
