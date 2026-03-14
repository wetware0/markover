import { test, expect } from './fixtures/electron-app';

test.describe('Tables', () => {
  test('insert table via toolbar', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();

    const tableBtn = page.locator('button[title="Insert Table"]');
    await expect(tableBtn).toBeVisible();
    await tableBtn.click();

    await expect(editor.locator('table')).toBeVisible({ timeout: 5_000 });
    await expect(editor.locator('th')).toHaveCount(3); // 3 header cells in default 3x3
  });

  test('table context bar appears when cursor is in table', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();

    await page.locator('button[title="Insert Table"]').click();
    await expect(editor.locator('table')).toBeVisible({ timeout: 5_000 });

    // Click into a table cell
    await editor.locator('td').first().click();

    // Table context bar should appear
    const contextBar = page.locator('text=Table').first();
    await expect(contextBar).toBeVisible({ timeout: 3_000 });
  });

  test('can add a column via table context bar', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();

    await page.locator('button[title="Insert Table"]').click();
    await expect(editor.locator('table')).toBeVisible({ timeout: 5_000 });

    await editor.locator('td').first().click();

    // Add column after
    await page.locator('button[title="Insert column after"]').click();

    // Should now have 4 header cells
    await expect(editor.locator('th')).toHaveCount(4, { timeout: 3_000 });
  });

  test('can type in table cells', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();

    await page.locator('button[title="Insert Table"]').click();
    await expect(editor.locator('table')).toBeVisible({ timeout: 5_000 });

    const firstCell = editor.locator('th').first();
    await firstCell.click();
    await page.keyboard.type('Header 1');

    await expect(firstCell).toContainText('Header 1');
  });
});

test.describe('Code Blocks', () => {
  test('insert code block via toolbar', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();

    const codeBlockBtn = page.locator('button[title="Code Block"]');
    await expect(codeBlockBtn).toBeVisible();
    await codeBlockBtn.click();

    await expect(editor.locator('pre')).toBeVisible({ timeout: 5_000 });
  });

  test('can type inside code block', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();

    await page.locator('button[title="Code Block"]').click();
    await expect(editor.locator('pre')).toBeVisible({ timeout: 5_000 });

    await page.keyboard.type('const x = 42;');
    await expect(editor.locator('pre')).toContainText('const x = 42;');
  });

  test('language selector is visible on code block', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();

    await page.locator('button[title="Code Block"]').click();
    await expect(editor.locator('pre')).toBeVisible({ timeout: 5_000 });

    // The language dropdown should be visible
    const langSelect = page.locator('.code-block-wrapper select');
    await expect(langSelect).toBeVisible({ timeout: 3_000 });
  });
});

test.describe('Raw Mode', () => {
  test('toggle raw mode and back preserves content', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('Round-trip content');

    // Switch to raw mode
    const rawBtn = page.locator('button[title="Edit Raw Markdown"]');
    await rawBtn.click();

    // Raw editor should show the content
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.cm-content')).toContainText('Round-trip content');

    // Switch back
    await page.locator('button[title="Switch to WYSIWYG"]').click();
    await expect(editor).toBeVisible({ timeout: 5_000 });
    await expect(editor).toContainText('Round-trip content');
  });

  test('raw mode shows markdown syntax', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();

    // Apply bold formatting
    await page.keyboard.type('Bold text');
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Control+B');

    // Switch to raw mode
    await page.locator('button[title="Edit Raw Markdown"]').click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5_000 });

    // Should see markdown bold syntax
    await expect(page.locator('.cm-content')).toContainText('**Bold text**');
  });
});
