import { test, expect } from './fixtures/electron-app';

test.describe('App smoke tests', () => {
  test('app window opens', async ({ page }) => {
    expect(page).toBeTruthy();
    const title = await page.title();
    expect(title).toBeTruthy();
  });

  test('editor is visible and contenteditable', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible({ timeout: 10_000 });
    await expect(editor).toHaveAttribute('contenteditable', 'true');
  });

  test('toolbar is visible', async ({ page }) => {
    const toolbar = page.locator('[class*="toolbar"]').first();
    await expect(toolbar).toBeVisible({ timeout: 10_000 });
  });

  test('can type into the editor', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible({ timeout: 10_000 });
    await editor.click();
    await page.keyboard.type('Hello Markover');
    await expect(editor).toContainText('Hello Markover');
  });
});
