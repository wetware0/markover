import { test, expect } from './fixtures/electron-app';
import type { Page } from '@playwright/test';

/** Per-keystroke delay that comfortably exceeds the 500ms history group and any
 *  DOM-observer batching window, i.e. "a person typing slowly". */
const SLOW = 300;

async function enableTracking(page: Page) {
  await page.locator('button[title="Track Changes: OFF"]').click();
  await expect(page.locator('button[title="Track Changes: ON"]')).toBeVisible({ timeout: 3_000 });
}

/** Distinct change ids of the given kind currently in the editor DOM. */
async function changeIds(page: Page, kind: 'insert' | 'delete'): Promise<string[]> {
  return page.locator(`.ProseMirror .markover-${kind}`).evaluateAll((els) =>
    [...new Set(els.map((e) => e.getAttribute('data-change-id') ?? ''))],
  );
}

async function changeText(page: Page, kind: 'insert' | 'delete'): Promise<string> {
  return page.locator(`.ProseMirror .markover-${kind}`).evaluateAll((els) =>
    els.map((e) => e.textContent ?? '').join(''),
  );
}

test.describe('Track changes coalescing', () => {
  test('slow typing produces ONE insertion', async ({ page }) => {
    await enableTracking(page);
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('hello world', { delay: SLOW });

    await expect.poll(() => changeText(page, 'insert')).toBe('hello world');
    expect(await changeIds(page, 'insert')).toHaveLength(1);
    // The sidebar badge counts one change.
    await expect(page.locator('.markover-change-entry')).toHaveCount(1);
  });

  test('backspacing a word slowly produces ONE deletion', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('Keep this word');
    await enableTracking(page);
    await editor.click();
    await page.keyboard.press('End');
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(SLOW);
    }

    await expect.poll(() => changeText(page, 'delete')).toBe('word');
    expect(await changeIds(page, 'delete')).toHaveLength(1);
    // Ghost text stays visible; nothing was really removed.
    await expect(editor).toHaveText('Keep this word');
    // The caret sits before the ghost: typing now inserts before it.
    await page.keyboard.type('text', { delay: SLOW });
    await expect(editor).toHaveText('Keep this textword');
    expect(await changeIds(page, 'insert')).toHaveLength(1);
  });

  test('forward-deleting a word produces ONE deletion', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('word stays');
    await enableTracking(page);
    await editor.click();
    await page.keyboard.press('Home');
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Delete');
      await page.waitForTimeout(100);
    }
    await expect.poll(() => changeText(page, 'delete')).toBe('word ');
    expect(await changeIds(page, 'delete')).toHaveLength(1);
  });

  test('typing over a selection is one deletion followed by one insertion', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('The cat sat');
    await enableTracking(page);
    await editor.click();
    await page.keyboard.press('End');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.type('dog', { delay: SLOW });

    await expect.poll(() => changeText(page, 'insert')).toBe('dog');
    expect(await changeText(page, 'delete')).toBe('cat');
    expect(await changeIds(page, 'insert')).toHaveLength(1);
    expect(await changeIds(page, 'delete')).toHaveLength(1);
    // Deletion first, then the insertion, then the untouched rest.
    await expect(editor).toHaveText('The catdog sat');
  });

  test('backspacing inside your own insertion removes it without a deletion', async ({ page }) => {
    await enableTracking(page);
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('abcd', { delay: SLOW });
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(SLOW);
    await page.keyboard.press('Backspace');

    await expect(editor).toHaveText('ab');
    expect(await changeText(page, 'insert')).toBe('ab');
    await expect(editor.locator('.markover-delete')).toHaveCount(0);
  });

  test('typing inside your own insertion extends it', async ({ page }) => {
    await enableTracking(page);
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('helo', { delay: 50 });
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('l', { delay: SLOW });
    await page.keyboard.press('End');
    await page.keyboard.type('!', { delay: SLOW });

    await expect.poll(() => changeText(page, 'insert')).toBe('hello!');
    expect(await changeIds(page, 'insert')).toHaveLength(1);
  });

  test('undo removes a tracked insertion and its marks', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('Base');
    await page.waitForTimeout(700); // close the history group
    await enableTracking(page);
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' added', { delay: SLOW });
    // Step back one undo at a time; every intermediate state must be either
    // "Base" + a marked insertion, or plain "Base" — never unmarked typed text.
    for (let i = 0; i < 10 && (await editor.textContent()) !== 'Base'; i++) {
      await page.keyboard.press('Control+Z');
      const text = (await editor.textContent()) ?? '';
      const marked = await changeText(page, 'insert');
      expect(text).toBe('Base' + marked);
    }
    await expect(editor.locator('.markover-insert')).toHaveCount(0);
    await expect(editor.locator('.markover-delete')).toHaveCount(0);
    await expect(editor).toHaveText('Base');
  });

  test('undo of a tracked deletion leaves no orphan marks', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('Remove me');
    await page.waitForTimeout(700);
    await enableTracking(page);
    await editor.click();
    await page.keyboard.press('End');
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(SLOW);
    }
    await expect(editor.locator('.markover-delete')).toHaveCount(1);
    await page.keyboard.press('Control+Z');
    await page.keyboard.press('Control+Z');
    await expect(editor.locator('.markover-delete')).toHaveCount(0);
    await expect(editor.locator('.markover-insert')).toHaveCount(0);
    await expect(editor).toHaveText('Remove me');
  });

  test('accept and reject a single coalesced change from the sidebar', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('One two');
    await enableTracking(page);
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' three', { delay: 100 });
    await page.keyboard.press('Home');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Delete');

    const entries = page.locator('.markover-change-entry');
    await expect(entries).toHaveCount(2);
    // Reject the deletion → "One " restored; accept the insertion → kept.
    await entries.filter({ hasText: 'Deleted' }).getByTitle('Reject').click();
    await entries.filter({ hasText: 'Added' }).getByTitle('Accept').click();
    await expect(entries).toHaveCount(0);
    await expect(editor).toHaveText('One two three');
    await expect(editor.locator('.markover-insert, .markover-delete')).toHaveCount(0);
    // Focus is back in the editor: typing lands in the document.
    await page.keyboard.type('X');
    await expect(editor).toContainText('X');
  });

  test('tracked changes survive the markdown round trip with ids intact', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('Alpha beta');
    await enableTracking(page);
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' gamma', { delay: 100 });
    const before = { ins: await changeIds(page, 'insert') };

    await page.locator('button[title="Edit Raw Markdown"]').click();
    await expect(page.locator('.cm-content')).toContainText(`data-change-id="${before.ins[0]}"`);
    await page.locator('button[title="Switch to WYSIWYG"]').click();
    await expect.poll(() => changeIds(page, 'insert')).toEqual(before.ins);
    expect(await changeText(page, 'insert')).toBe(' gamma');
  });
});
