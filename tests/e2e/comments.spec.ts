import { test, expect } from './fixtures/electron-app';

test.describe('Comments', () => {
  test('can add a comment to selected text', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('Review this sentence please.');

    // Select the word "sentence"
    await page.keyboard.press('Home');
    await page.keyboard.press('Control+F');
    // Use keyboard selection instead: position + shift-select
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Control+C');

    // Simpler: select all text then add comment
    await editor.click();
    await page.keyboard.type('Annotate this');
    await page.keyboard.press('Control+A');

    // Click the add-comment toolbar button (MessageSquarePlus)
    const commentBtn = page.locator('button[title="Add Comment (select text first)"]');
    await expect(commentBtn).toBeVisible();
    await commentBtn.click();

    // Comment dialog should appear
    const textarea = page.locator('textarea[placeholder="Write a comment…"]');
    await expect(textarea).toBeVisible({ timeout: 5_000 });
    await textarea.fill('This is a test comment');
    await page.keyboard.press('Enter');

    // Highlight mark should appear in editor
    await expect(editor.locator('.markover-highlight')).toBeVisible({ timeout: 5_000 });
  });

  test('comment appears in sidebar', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('Sidebar test');
    await page.keyboard.press('Control+A');

    const commentBtn = page.locator('button[title="Add Comment (select text first)"]');
    await commentBtn.click();

    const textarea = page.locator('textarea[placeholder="Write a comment…"]');
    await textarea.fill('Sidebar comment');
    await page.keyboard.press('Enter');

    // Open sidebar — it should auto-open on comment add; if not, click panel button
    const sidebarPanel = page.locator('.markover-highlight').first();
    await expect(sidebarPanel).toBeVisible({ timeout: 5_000 });

    // Comment text should be visible somewhere on screen
    await expect(page.locator('text=Sidebar comment')).toBeVisible({ timeout: 5_000 });
  });

  test('comment dialog can be cancelled', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('Cancel test');
    await page.keyboard.press('Control+A');

    const commentBtn = page.locator('button[title="Add Comment (select text first)"]');
    await commentBtn.click();

    const textarea = page.locator('textarea[placeholder="Write a comment…"]');
    await expect(textarea).toBeVisible({ timeout: 5_000 });

    // Press Escape to cancel
    await page.keyboard.press('Escape');
    await expect(textarea).not.toBeVisible({ timeout: 3_000 });

    // No highlight should have been added
    await expect(editor.locator('.markover-highlight')).toHaveCount(0);
  });
});
