import { test, expect } from './fixtures/electron-app';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function loadMarkdown(page: Page, markdown: string) {
  await page.locator('button[title="Edit Raw Markdown"]').click();
  await page.locator('.cm-content').fill(markdown);
  await page.locator('button[title="Switch to WYSIWYG"]').click();
}

async function toggleModes(page: Page) {
  await page.locator('button[title="Edit Raw Markdown"]').click();
  await page.locator('button[title="Switch to WYSIWYG"]').click();
}

test('prices and percentages remain prose through repeated mode switches', async ({ page }, testInfo) => {
  await loadMarkdown(page, [
    'Prices are $10.00 and $20.00.',
    'A $100 item with 10% tax costs $110.',
    '**$10.00** and **$20.00**',
    'Prices are \\$10.00 and \\$20.00.',
    'Price: $100\nTax: 10%\nTotal: $110',
  ].join('\n\n'));

  for (let pass = 0; pass < 3; pass++) {
    const editor = page.locator('.ProseMirror');
    await expect(editor.locator('p')).toHaveText([
      'Prices are $10.00 and $20.00.',
      'A $100 item with 10% tax costs $110.',
      '$10.00 and $20.00',
      'Prices are $10.00 and $20.00.',
      'Price: $100 Tax: 10% Total: $110',
    ], { useInnerText: true });
    await expect(editor.locator('[data-katex-inline]')).toHaveCount(0);
    await expect(editor.locator('strong')).toHaveText(['$10.00', '$20.00']);
    if (pass < 2) await toggleModes(page);
  }
  await page.screenshot({ path: testInfo.outputPath('currency-rendering.png') });
});

test('typed prices survive saving and reopening a real file', async ({ page, electronApp }) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'markover-currency-'));
  const filePath = path.join(tempDir, 'prices.md');
  try {
    await electronApp.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
    }, filePath);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.insertText('Prices are $10.00 and $20.00.');
    await expect(editor).toHaveText('Prices are $10.00 and $20.00.');
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('menu:action', 'save');
    });
    await expect.poll(() => fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf8')).toContain('Prices are \\$10.00 and \\$20.00.');

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('menu:action', 'new');
    });
    await expect(editor).toHaveText('');
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('menu:action', 'open');
    });
    await expect(editor).toHaveText('Prices are $10.00 and $20.00.');
    await expect(editor.locator('[data-katex-inline]')).toHaveCount(0);
    await toggleModes(page);
    await expect(editor).toHaveText('Prices are $10.00 and $20.00.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('table pipes and line breaks retain their cells and percentage values', async ({ page }, testInfo) => {
  await loadMarkdown(page, [
    '| Condition | Value |\n| :--- | ---: |\n| x \\| y | 12.5% |',
    '| Revenue | Margin |\n| ---: | ---: |\n| 1,234.56<br>2,345.67 | 12.5% |',
    '| Item | Range |\n| :--- | :--- |\n| Standard | \\$10.00 to \\$20.00 |',
  ].join('\n\n'));

  for (let pass = 0; pass < 3; pass++) {
    const tables = page.locator('.ProseMirror table');
    await expect(tables).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(tables.nth(i).locator('tr')).toHaveCount(2);
      await expect(tables.nth(i).locator('td')).toHaveCount(2);
    }
    await expect(tables.nth(0).locator('td')).toHaveText(['x | y', '12.5%']);
    await expect(tables.nth(1).locator('td').nth(0)).toHaveText('1,234.562,345.67');
    await expect(tables.nth(1).locator('td').nth(0).locator('br')).toHaveCount(1);
    await expect(tables.nth(1).locator('td').nth(1)).toHaveText('12.5%');
    await expect(tables.nth(1).locator('td').nth(1)).toHaveCSS('text-align', 'right');
    await expect(tables.nth(2).locator('td').nth(1)).toHaveText('$10.00 to $20.00');
    if (pass < 2) await toggleModes(page);
  }
  await page.screenshot({ path: testInfo.outputPath('table-rendering.png') });
});

test('numeric paragraphs stay paragraphs while real numbered lists remain lists', async ({ page }) => {
  await loadMarkdown(page, '2026\\. Annual revenue: 12.5%\n\n2026\\) Annual revenue: 12.5%\n\n3. Actual ordered item\n4. Next item');
  for (let pass = 0; pass < 3; pass++) {
    const editor = page.locator('.ProseMirror');
    await expect(editor.locator(':scope > p').filter({ hasText: /\S/ })).toHaveText([
      '2026. Annual revenue: 12.5%',
      '2026) Annual revenue: 12.5%',
    ]);
    await expect(editor.locator('ol')).toHaveCount(1);
    await expect(editor.locator('ol')).toHaveAttribute('start', '3');
    if (pass < 2) await toggleModes(page);
  }
});

test('genuine formulas still render after mode switches', async ({ page }) => {
  await loadMarkdown(page, 'Square: $x^2$.\n\nPercentage: $r = 12.5\\%$.\n\n$$\n100 \\times (1 + 0.10) = 110\n$$');
  for (let pass = 0; pass < 2; pass++) {
    await expect(page.locator('.ProseMirror [data-katex-inline]')).toHaveCount(2);
    await expect(page.locator('.ProseMirror [data-katex-block]')).toHaveCount(1);
    await expect(page.locator('.ProseMirror .katex')).toHaveCount(3);
    await expect(page.locator('.ProseMirror .katex-error')).toHaveCount(0);
    if (pass === 0) await toggleModes(page);
  }
});
