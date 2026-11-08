import { test, expect } from './fixtures/electron-app';
import type { ElectronApplication, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * Track changes on content that has no ordinary text to mark: inline atoms
 * (math), whole code/math blocks, paragraph splits and joins, plus moving
 * commented text with cut and paste and IME composition.
 */

function menu(app: ElectronApplication, action: string) {
  return app.evaluate(({ BrowserWindow }, a) => {
    BrowserWindow.getAllWindows()[0].webContents.send('menu:action', a);
  }, action);
}

/** Write `md` to a temp file, open it, and point Save/Open dialogs at it. */
async function openFile(page: Page, app: ElectronApplication, dir: string, md: string) {
  const file = path.join(dir, 'doc.md');
  fs.writeFileSync(file, md);
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  }, file);
  await menu(app, 'open');
  await expect(page.getByText('doc.md', { exact: true })).toBeVisible();
  return file;
}

async function enableTracking(page: Page) {
  await page.locator('button[title="Track Changes: OFF"]').click();
  await expect(page.locator('button[title="Track Changes: ON"]')).toBeVisible();
}

/** Save, start a new document, reopen the file; returns the saved Markdown. */
async function saveAndReopen(page: Page, app: ElectronApplication, file: string): Promise<string> {
  const before = fs.readFileSync(file, 'utf8');
  await menu(app, 'save');
  await expect.poll(() => fs.readFileSync(file, 'utf8')).not.toBe(before);
  await expect(page.getByText('doc.md', { exact: true })).toBeVisible();
  const saved = fs.readFileSync(file, 'utf8');
  await menu(app, 'new');
  await expect(page.locator('.ProseMirror')).toHaveText('');
  await menu(app, 'open');
  await expect(page.getByText('doc.md', { exact: true })).toBeVisible();
  return saved;
}

const entries = (page: Page) => page.locator('.markover-change-entry');
const paragraphs = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('.ProseMirror > p')].map((p) => p.textContent ?? ''));

test.describe('Track changes: atoms, blocks and paragraph breaks', () => {
  let dir: string;
  test.beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markover-structure-')); });
  test.afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('deleted inline math keeps its change markup through save and reopen', async ({ page, electronApp }) => {
    const file = await openFile(page, electronApp, dir, 'Sum $x^2$ end\n');
    await enableTracking(page);
    const editor = page.locator('.ProseMirror');
    await editor.locator('p').click();
    await page.keyboard.press('End');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft'); // before " end"
    await page.keyboard.press('Backspace'); // the math atom
    await expect(editor.locator('.markover-delete [data-katex-inline]')).toHaveCount(1);
    await expect(entries(page)).toHaveCount(1);

    const saved = await saveAndReopen(page, electronApp, file);
    expect(saved).toMatch(/<span data-markov="del"[^>]*>\$x\^2\$<\/span>/);
    await expect(editor.locator('.markover-delete [data-katex-inline]')).toHaveCount(1);
    await entries(page).first().getByTitle('Reject').click();
    await expect(editor.locator('.markover-delete')).toHaveCount(0);
    await expect(editor.locator('[data-katex-inline]')).toHaveCount(1);
  });

  test('editing a code block keeps the original as a deleted block', async ({ page, electronApp }) => {
    const md = 'Intro\n\n```js\nlet a = 1;\n```\n';
    const file = await openFile(page, electronApp, dir, md);
    await enableTracking(page);
    const editor = page.locator('.ProseMirror');
    await editor.locator('pre code').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' // edited');
    await expect(editor.locator('[data-markov-block-delete]')).toHaveCount(1);
    await expect(editor.locator('[data-markov-block-insert]')).toHaveCount(1);
    await expect(editor.locator('[data-markov-block-insert] code')).toHaveText('let a = 1; // edited');
    await expect(entries(page)).toHaveCount(2);

    const saved = await saveAndReopen(page, electronApp, file);
    expect(saved).toContain('<div data-markov="block" data-op="del"');
    expect(saved).toContain('<div data-markov="block" data-op="ins"');
    await expect(editor.locator('[data-markov-block-delete]')).toHaveCount(1);
    await expect(editor.locator('[data-markov-block-insert]')).toHaveCount(1);

    await page.locator('button', { hasText: 'Reject All' }).click();
    await expect(editor.locator('pre code')).toHaveCount(1);
    await expect(editor.locator('pre code')).toHaveText('let a = 1;');
    await menu(electronApp, 'save');
    await expect.poll(() => fs.readFileSync(file, 'utf8').trimEnd()).toBe(md.trimEnd());
  });

  test('deleting a math block is tracked; Accept removes it', async ({ page, electronApp }) => {
    await openFile(page, electronApp, dir, 'Before\n\n$$\nx^2\n$$\n\nAfter\n');
    await enableTracking(page);
    const editor = page.locator('.ProseMirror');
    await editor.locator('p', { hasText: 'After' }).click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace'); // deletes the atom block before the caret
    await page.keyboard.press('Backspace'); // again: the deleted block is kept, not removed
    await expect(editor.locator('[data-katex-block][data-markov-block-delete]')).toHaveCount(1);
    await expect(entries(page)).toHaveCount(1);
    await expect(entries(page).first()).toContainText('Math block');
    await entries(page).first().getByTitle('Accept').click();
    await expect(editor.locator('[data-katex-block]')).toHaveCount(0);
    expect(await paragraphs(page)).toEqual(['Before', 'After']);
  });

  test('Enter is a tracked paragraph split; Reject joins it back', async ({ page, electronApp }) => {
    const file = await openFile(page, electronApp, dir, 'Hello world\n');
    await enableTracking(page);
    const editor = page.locator('.ProseMirror');
    await editor.locator('p').click();
    await page.keyboard.press('Home');
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect.poll(() => paragraphs(page)).toEqual(['Hello', ' world']);
    await expect(editor.locator('[data-markov-split-mark]')).toHaveCount(1);
    await expect(entries(page)).toHaveCount(1);

    const saved = await saveAndReopen(page, electronApp, file);
    // Markdown cannot keep the space at the start of a paragraph; the change
    // records it (data-ws) so rejecting after reopen restores "Hello world".
    expect(saved).toContain('data-op="split"');
    expect(saved).toContain('data-ws=" "');
    await expect.poll(() => paragraphs(page)).toEqual(['Hello', 'world']);
    await entries(page).first().getByTitle('Reject').click();
    await expect.poll(() => paragraphs(page)).toEqual(['Hello world']);
  });

  test('Backspace at a paragraph start is a tracked join; Accept joins', async ({ page, electronApp }) => {
    await openFile(page, electronApp, dir, 'One\n\nTwo\n');
    await enableTracking(page);
    const editor = page.locator('.ProseMirror');
    await editor.locator('p', { hasText: 'Two' }).click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');
    await expect.poll(() => paragraphs(page)).toEqual(['One', 'Two']);
    await expect(editor.locator('[data-markov-join-mark]')).toHaveCount(1);
    // The caret moved to the end of "One": the next Backspace deletes "e".
    await page.keyboard.press('Backspace');
    await expect(editor.locator('.markover-delete')).toHaveText('e');
    await expect(entries(page)).toHaveCount(1);
    await page.locator('button', { hasText: 'Accept All' }).click();
    await expect.poll(() => paragraphs(page)).toEqual(['OnTwo']);
  });
});

test.describe('Cut and paste keeps comments', () => {
  async function commentOn(page: Page, word: string) {
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type(`Start ${word} middle end`);
    await page.keyboard.press('Home');
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
    for (let i = 0; i < word.length; i++) await page.keyboard.press('Shift+ArrowRight');
    await page.locator('button[title="Add Comment (select text first)"]').click();
    const textarea = page.locator('textarea[placeholder="Write a comment…"]');
    await textarea.fill('Keep me attached');
    await page.keyboard.press('Enter');
    await expect(textarea).toHaveCount(0);
    await expect(editor.locator('.markover-highlight')).toHaveText(word);
  }

  async function cutAndPasteAtEnd(page: Page, app: ElectronApplication, word: string) {
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.press('Home');
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
    for (let i = 0; i < word.length; i++) await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Control+X');
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(word);
    await page.keyboard.press('End');
    await page.keyboard.press('Control+V');
  }

  test('untracked cut and paste moves the comment with the text', async ({ page, electronApp }) => {
    const editor = page.locator('.ProseMirror');
    await commentOn(page, 'moved');
    await cutAndPasteAtEnd(page, electronApp, 'moved');
    await expect(editor).toHaveText('Start  middle endmoved');
    await expect(editor.locator('.markover-highlight')).toHaveText('moved');
    await expect(page.locator('.markover-comment-thread .markover-comment-detached')).toHaveCount(0);
  });

  test('copy and paste does not duplicate the comment', async ({ page, electronApp }) => {
    const editor = page.locator('.ProseMirror');
    await commentOn(page, 'copied');
    await editor.click();
    await page.keyboard.press('Home');
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Control+C');
    await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe('copied');
    await page.keyboard.press('End');
    await page.keyboard.press('Control+V');
    await expect(editor).toHaveText('Start copied middle endcopied');
    await expect(editor.locator('.markover-highlight')).toHaveCount(1);
  });

  test('tracked cut and paste: accepting the move keeps the comment on the pasted text', async ({ page, electronApp }) => {
    const editor = page.locator('.ProseMirror');
    await commentOn(page, 'moved');
    await enableTracking(page);
    await cutAndPasteAtEnd(page, electronApp, 'moved');
    await expect(editor.locator('.markover-insert .markover-highlight, .markover-highlight .markover-insert')).toHaveCount(1);
    await page.locator('button', { hasText: 'Accept All' }).click();
    await expect(editor).toHaveText('Start  middle endmoved');
    await expect(editor.locator('.markover-highlight')).toHaveText('moved');
  });
});

test.describe('IME composition with track changes', () => {
  test('composed text is one tracked insertion with no duplicated characters', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('Base ');
    await enableTracking(page);
    await editor.click();
    await page.keyboard.press('End');

    const cdp = await page.context().newCDPSession(page);
    for (const text of ['に', 'にほ', 'にほん']) {
      await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    }
    await cdp.send('Input.insertText', { text: '日本' });
    await expect(editor).toHaveText('Base 日本');

    // A second composition straight after extends the same insertion.
    for (const text of ['ご', 'ごの']) {
      await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    }
    await cdp.send('Input.insertText', { text: '語の' });
    await page.keyboard.insertText('文');
    await expect(editor).toHaveText('Base 日本語の文');
    const ids = await editor.locator('.markover-insert').evaluateAll((els) =>
      [...new Set(els.map((e) => e.getAttribute('data-change-id')))],
    );
    expect(ids).toHaveLength(1);
    await expect.poll(() => editor.locator('.markover-insert').evaluateAll((els) => els.map((e) => e.textContent).join(''))).toBe('日本語の文');
  });

  test('composing over a selection is a deletion then an insertion', async ({ page }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('The cat sat');
    await enableTracking(page);
    await editor.click();
    await page.keyboard.press('Home');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');

    const cdp = await page.context().newCDPSession(page);
    for (const text of ['ね', 'ねこ']) {
      await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    }
    await cdp.send('Input.insertText', { text: '猫' });
    await expect(editor).toHaveText('The cat猫 sat');
    await expect(editor.locator('.markover-delete')).toHaveText('cat');
    await expect(editor.locator('.markover-insert')).toHaveText('猫');
  });
});
