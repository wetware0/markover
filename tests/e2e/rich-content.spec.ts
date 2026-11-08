import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from './fixtures/electron-app';

const SOURCE = [
  '# Rich content',
  '',
  '| Feature | Status | Notes |',
  '| :--- | :---: | ---: |',
  '| **Tables** | ok | pipes x \\| y |',
  '| _Images_ | ok | 12.5% |',
  '| `Mermaid` | ok | [link](https://example.com) |',
  '',
  '![](img/screen.png)',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[Start] --> B{Check}',
  '  B -->|yes| C["$$x^2$$"]',
  '  B -->|no| D[Stop]',
  '```',
  '',
  'Inline math $e^{i\\pi} + 1 = 0$ in a sentence.',
  '',
  '$$',
  '\\int_0^1 x^2 \\, dx = \\frac{1}{3}',
  '$$',
  '',
].join('\n');

function menu(app: ElectronApplication, action: string) {
  return app.evaluate(({ BrowserWindow }, a) => {
    BrowserWindow.getAllWindows()[0].webContents.send('menu:action', a);
  }, action);
}

async function expectRichContent(page: Page, bodyRows: number) {
  const editor = page.locator('.ProseMirror');

  const table = editor.locator('table');
  await expect(table).toBeVisible();
  await expect(table.locator('th')).toHaveCount(3);
  await expect(table.locator('tr')).toHaveCount(bodyRows + 1);
  await expect(table.locator('td').nth(0).locator('strong')).toHaveText('Tables');
  await expect(table.locator('td').nth(2)).toHaveText('pipes x | y');
  await expect(table.locator('td').nth(5)).toHaveText('12.5%');
  await expect(table.locator('td a')).toHaveAttribute('href', 'https://example.com');

  const img = editor.locator('img').first();
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);

  const mermaid = editor.locator('.mermaid-block');
  await expect(mermaid.locator('svg')).toBeVisible({ timeout: 15_000 });
  await expect(mermaid.locator('.mermaid-error')).toHaveCount(0);
  await expect(mermaid.locator('svg')).toContainText('Start');
  await expect(mermaid.locator('svg .katex').first()).toBeAttached();

  await expect(editor.locator('[data-katex-inline] .katex')).toHaveCount(1);
  await expect(editor.locator('[data-katex-block] .katex-display')).toHaveCount(1);
  await expect(editor.locator('.katex-error')).toHaveCount(0);
}

test('tables, images, Mermaid and math render and survive save and reopen', async (
  { page, electronApp },
  testInfo,
) => {
  test.setTimeout(90_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markover-rich-'));
  const filePath = path.join(dir, 'rich.md');
  try {
    fs.mkdirSync(path.join(dir, 'img'));
    fs.copyFileSync(
      path.resolve(__dirname, '..', '..', 'docs', 'test-01-initial-content.png'),
      path.join(dir, 'img', 'screen.png'),
    );
    fs.writeFileSync(filePath, SOURCE);
    await electronApp.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
    }, filePath);

    await menu(electronApp, 'open');
    await expectRichContent(page, 3);
    await page.screenshot({ path: testInfo.outputPath('1-opened.png'), fullPage: true });

    // Edit the table: add a row below the last one and type into it.
    const editor = page.locator('.ProseMirror');
    await editor.locator('td').last().click();
    await page.locator('button[title="Insert row below"]').click();
    await expect(editor.locator('table tr')).toHaveCount(5);
    await editor.locator('table tr').last().locator('td').first().click();
    await page.keyboard.type('Added row');

    await menu(electronApp, 'save');
    await expect(page.getByText('rich.md', { exact: true })).toBeVisible();
    const firstSave = fs.readFileSync(filePath, 'utf8');
    await testInfo.attach('first-save.md', { body: firstSave, contentType: 'text/markdown' });
    expect(firstSave).toContain('| **Tables** | ok | pipes x \\| y |');
    expect(firstSave).toContain('| Added row |');
    expect(firstSave).toContain('![](img/screen.png)');
    expect(firstSave).toContain('```mermaid\nflowchart LR\n  A[Start] --> B{Check}');
    expect(firstSave).toContain('$e^{i\\pi} + 1 = 0$');
    expect(firstSave).toContain('\\int_0^1 x^2 \\, dx = \\frac{1}{3}');

    // Reopen from disk, check everything again, then save unchanged: output must be stable.
    await menu(electronApp, 'new');
    await expect(editor).toHaveText('');
    await menu(electronApp, 'open');
    await expectRichContent(page, 4);
    await page.locator('button[title="Edit Raw Markdown"]').click();
    await expect(page.locator('.cm-content')).toContainText('flowchart LR');
    await page.locator('button[title="Switch to WYSIWYG"]').click();
    await expectRichContent(page, 4);
    await page.screenshot({ path: testInfo.outputPath('2-reopened.png') });
    await editor.locator('.mermaid-block').screenshot({ path: testInfo.outputPath('3-mermaid.png') });
    await editor.locator('[data-katex-block]').screenshot({ path: testInfo.outputPath('4-math.png') });

    await editor.locator('h1').click();
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await page.keyboard.press('Backspace');
    await menu(electronApp, 'save');
    await expect(page.getByText('rich.md', { exact: true })).toBeVisible();
    expect(fs.readFileSync(filePath, 'utf8')).toBe(firstSave);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('table rows, columns and the whole table can be added and deleted', async ({ page, electronApp }) => {
  test.setTimeout(90_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markover-table-'));
  const filePath = path.join(dir, 'table.md');
  try {
    fs.writeFileSync(
      filePath,
      'Before\n\n| A | B | C |\n| --- | --- | --- |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n\nAfter\n',
    );
    await electronApp.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
    }, filePath);
    await menu(electronApp, 'open');

    const editor = page.locator('.ProseMirror');
    const table = editor.locator('table');
    const rows = table.locator('tr');
    const headers = table.locator('th');
    const click = (title: string) => page.locator(`button[title="${title}"]`).click();
    const saved = async () => {
      await menu(electronApp, 'save');
      await expect(page.getByText('table.md', { exact: true })).toBeVisible();
      return fs.readFileSync(filePath, 'utf8');
    };
    await expect(rows).toHaveCount(3);

    await editor.locator('td', { hasText: 'b1' }).click();
    await click('Insert row above');
    await click('Insert row below');
    await expect(rows).toHaveCount(5);
    await click('Insert column before');
    await click('Insert column after');
    await expect(headers).toHaveCount(5);
    let md = await saved();
    expect(md).toContain('| A |  | B |  | C |');
    expect(md.match(/^\|.*\|$/gm)).toHaveLength(6);

    await editor.locator('td', { hasText: 'b1' }).click();
    await click('Delete row');
    await expect(rows).toHaveCount(4);
    await expect(table).not.toContainText('a1');
    await editor.locator('td', { hasText: 'b2' }).click();
    await click('Delete column');
    await expect(headers).toHaveCount(4);
    await expect(table).not.toContainText('b2');
    md = await saved();
    expect(md).not.toContain('a1');
    expect(md).not.toContain('b2');
    expect(md).toContain('| a2 |');

    await editor.locator('td', { hasText: 'a2' }).click();
    await click('Delete entire table');
    await expect(table).toHaveCount(0);
    await expect(editor).toContainText('Before');
    await expect(editor).toContainText('After');
    md = await saved();
    expect(md).not.toContain('|');
    expect(md).toContain('Before');
    expect(md).toContain('After');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
