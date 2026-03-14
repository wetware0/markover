import { test, expect } from './fixtures/electron-app';

test.describe('Track Changes', () => {
  test('enable track changes via toolbar button', async ({ page }) => {
    const btn = page.locator('button[title="Track Changes: OFF"]');
    await expect(btn).toBeVisible();
    await btn.click();
    // Button title should update to ON
    await expect(page.locator('button[title="Track Changes: ON"]')).toBeVisible({ timeout: 3_000 });
  });

  test('typed text is marked as insertion when tracking', async ({ page }) => {
    // Enable track changes
    await page.locator('button[title="Track Changes: OFF"]').click();
    await expect(page.locator('button[title="Track Changes: ON"]')).toBeVisible({ timeout: 3_000 });

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('Tracked insertion');

    // Insertion mark should appear
    await expect(editor.locator('.markover-insert')).toBeVisible({ timeout: 5_000 });
    await expect(editor.locator('.markover-insert')).toContainText('Tracked insertion');
  });

  test('deleted text is marked as deletion when tracking', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();

    // Type base content with tracking OFF
    await page.keyboard.type('Delete me');

    // Enable track changes
    await page.locator('button[title="Track Changes: OFF"]').click();
    await expect(page.locator('button[title="Track Changes: ON"]')).toBeVisible({ timeout: 3_000 });

    // Select and delete the text
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');

    // Deletion mark should appear (text kept but struck through)
    await expect(editor.locator('.markover-delete')).toBeVisible({ timeout: 5_000 });
  });

  test('changes panel shows tracked changes', async ({ page }) => {
    // Enable track changes
    await page.locator('button[title="Track Changes: OFF"]').click();
    await expect(page.locator('button[title="Track Changes: ON"]')).toBeVisible({ timeout: 3_000 });

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('Panel test text');

    // Sidebar should be open (auto-opens when TC is enabled)
    // Changes tab should show items
    await expect(page.locator('text=Panel test text').nth(1)).toBeVisible({ timeout: 5_000 });
  });

  test('accept all clears insertion marks', async ({ page }) => {
    // Enable track changes and type
    await page.locator('button[title="Track Changes: OFF"]').click();
    await expect(page.locator('button[title="Track Changes: ON"]')).toBeVisible({ timeout: 3_000 });

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('Accept this');

    await expect(editor.locator('.markover-insert')).toBeVisible({ timeout: 5_000 });

    // Click Accept All in the sidebar
    const acceptAll = page.locator('button', { hasText: 'Accept All' });
    await expect(acceptAll).toBeVisible({ timeout: 3_000 });
    await acceptAll.click();

    // Insertion marks should be gone
    await expect(editor.locator('.markover-insert')).toHaveCount(0, { timeout: 5_000 });
    // Text should still be present
    await expect(editor).toContainText('Accept this');
  });
});
