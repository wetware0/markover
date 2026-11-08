import { test, expect } from './fixtures/electron-app';
import type { ElectronApplication, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TABLE = '| A | B | C |\n| --- | --- | --- |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n';
const ORIGINAL = 'A,B,C / a1,b1,c1 / a2,b2,c2';

function menu(app: ElectronApplication, action: string) {
  return app.evaluate(({ BrowserWindow }, a) => {
    BrowserWindow.getAllWindows()[0].webContents.send('menu:action', a);
  }, action);
}

/** Row-by-row cell text, '_' for empty cells; '' when there is no table. */
function grid(page: Page) {
  return page.evaluate(() => {
    const t = document.querySelector('.ProseMirror table');
    if (!t) return '';
    return [...t.querySelectorAll('tr')]
      .map((tr) => [...tr.children].map((c) => c.textContent?.trim() || '_').join(','))
      .join(' / ');
  });
}

const cellMarks = (page: Page) =>
  page.evaluate(() => ({
    ins: document.querySelectorAll('.ProseMirror .markover-cell-insert').length,
    del: document.querySelectorAll('.ProseMirror .markover-cell-delete').length,
  }));

async function openTable(page: Page, app: ElectronApplication, dir: string) {
  const file = path.join(dir, 'table.md');
  fs.writeFileSync(file, TABLE);
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  }, file);
  await menu(app, 'open');
  await page.locator('.ProseMirror table').waitFor();
  await page.locator('button[title="Track Changes: OFF"]').click();
  await expect(page.locator('button[title="Track Changes: ON"]')).toBeVisible();
  await page.locator('.ProseMirror td').filter({ hasText: 'b1' }).click();
  return file;
}

interface Op {
  name: string;
  button: string | null;
  during: string;
  marks: { ins: number; del: number };
  accepted: string;
  rejected: string;
}

const OPS: Op[] = [
  {
    name: 'insert row', button: 'Insert row below',
    during: 'A,B,C / a1,b1,c1 / _,_,_ / a2,b2,c2', marks: { ins: 3, del: 0 },
    accepted: 'A,B,C / a1,b1,c1 / _,_,_ / a2,b2,c2', rejected: ORIGINAL,
  },
  {
    name: 'insert column', button: 'Insert column after',
    during: 'A,B,_,C / a1,b1,_,c1 / a2,b2,_,c2', marks: { ins: 3, del: 0 },
    accepted: 'A,B,_,C / a1,b1,_,c1 / a2,b2,_,c2', rejected: ORIGINAL,
  },
  {
    name: 'delete row', button: 'Delete row',
    during: ORIGINAL, marks: { ins: 0, del: 3 },
    accepted: 'A,B,C / a2,b2,c2', rejected: ORIGINAL,
  },
  {
    name: 'delete column', button: 'Delete column',
    during: ORIGINAL, marks: { ins: 0, del: 3 },
    accepted: 'A,C / a1,c1 / a2,c2', rejected: ORIGINAL,
  },
  {
    name: 'delete table', button: 'Delete entire table',
    during: ORIGINAL, marks: { ins: 0, del: 9 },
    accepted: '', rejected: ORIGINAL,
  },
  {
    name: 'type in cell', button: null,
    during: 'A,B,C / a1,b1X,c1 / a2,b2,c2', marks: { ins: 0, del: 0 },
    accepted: 'A,B,C / a1,b1X,c1 / a2,b2,c2', rejected: ORIGINAL,
  },
];

test.describe('Track changes on table structure', () => {
  let dir: string;
  test.beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markover-table-')); });
  test.afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  for (const op of OPS) {
    for (const action of ['Accept', 'Reject'] as const) {
      test(`${op.name} → ${action}`, async ({ page, electronApp }) => {
        await openTable(page, electronApp, dir);
        if (op.button) await page.locator(`button[title="${op.button}"]`).click();
        else {
          await page.keyboard.press('End');
          await page.keyboard.type('X');
        }
        await expect.poll(() => grid(page)).toBe(op.during);
        expect(await cellMarks(page)).toEqual(op.marks);

        // Exactly one entry in the Changes panel, resolved with its own button.
        const entries = page.locator('.markover-change-entry');
        await expect(entries).toHaveCount(1);
        await entries.first().getByTitle(action).click();
        await expect(entries).toHaveCount(0);
        await expect.poll(() => grid(page)).toBe(action === 'Accept' ? op.accepted : op.rejected);
        expect(await cellMarks(page)).toEqual({ ins: 0, del: 0 });
      });
    }
  }

  test('Accept All / Reject All with several table changes', async ({ page, electronApp }) => {
    await openTable(page, electronApp, dir);
    await page.locator('button[title="Delete row"]').click();
    await page.locator('.ProseMirror td').filter({ hasText: 'b2' }).click();
    await page.locator('button[title="Insert column after"]').click();
    await expect(page.locator('.markover-change-entry')).toHaveCount(2);
    await page.locator('button', { hasText: 'Reject All' }).click();
    await expect.poll(() => grid(page)).toBe(ORIGINAL);

    await page.locator('.ProseMirror td').filter({ hasText: 'b1' }).click();
    await page.locator('button[title="Delete row"]').click();
    await page.locator('.ProseMirror td').filter({ hasText: 'b2' }).click();
    await page.locator('button[title="Insert column after"]').click();
    await page.locator('button', { hasText: 'Accept All' }).click();
    await expect.poll(() => grid(page)).toBe('A,B,_,C / a2,b2,_,c2');
  });

  test('pending row deletion survives save and reopen', async ({ page, electronApp }) => {
    const file = await openTable(page, electronApp, dir);
    await page.locator('button[title="Delete row"]').click();
    await expect.poll(() => cellMarks(page)).toEqual({ ins: 0, del: 3 });
    const id = await page.locator('.ProseMirror .markover-cell-delete').first().getAttribute('data-change-id');

    await menu(electronApp, 'save');
    await expect(page.getByText('table.md', { exact: true })).toBeVisible();
    const saved = fs.readFileSync(file, 'utf8');
    expect(saved).toContain(`data-op="del" data-change-id="${id}"`);

    await menu(electronApp, 'new');
    await expect(page.locator('.ProseMirror table')).toHaveCount(0);
    await menu(electronApp, 'open');
    await page.locator('.ProseMirror table').waitFor();
    expect(await grid(page)).toBe(ORIGINAL);
    expect(await cellMarks(page)).toEqual({ ins: 0, del: 3 });
    const reopenedIds = await page.locator('.ProseMirror .markover-cell-delete').evaluateAll((els) =>
      [...new Set(els.map((e) => e.getAttribute('data-change-id')))],
    );
    expect(reopenedIds).toEqual([id]);

    // Accepting after reopen removes only that row (sidebar is still open on Changes).
    await page.locator('.markover-change-entry').first().getByTitle('Accept').click();
    await expect.poll(() => grid(page)).toBe('A,B,C / a2,b2,c2');
  });

  test('moving rows/columns is unavailable while tracking', async ({ page, electronApp }) => {
    await openTable(page, electronApp, dir);
    await expect(page.locator('button[title^="Move row down"]')).toBeDisabled();
    await expect(page.locator('button[title^="Move column right"]')).toBeDisabled();
  });
});
