import { Extension } from '@tiptap/core';

/**
 * Tracked changes that live on block nodes rather than as inline marks:
 *
 * - Code, math, Mermaid blocks, block images and horizontal rules carry `markovInsert` /
 *   `markovDelete` (a whole block inserted or deleted, or an edited block shown
 *   as "old version deleted, new version inserted"). Code-block text cannot
 *   carry marks, and atom blocks have no text at all.
 * - Paragraphs and headings carry `markovSplit` (the paragraph break before this
 *   block was inserted: Enter) and `markovJoin` (the paragraph break before this
 *   block was deleted: Backspace/Delete at a paragraph boundary).
 *
 * Persistence (see markdown/serializer.ts and markdown/parser.ts):
 * - blocks: an HTML marker line before the block,
 *     <div data-markov="block" data-op="del" data-change-id="x" data-author="A" data-date="2026-01-01"></div>
 * - paragraphs/headings: an empty marker span at the start of the text,
 *     <span data-markov="para" data-op="split" data-change-id="x" ...></span>
 * The parser folds both into `data-markov-*` JSON attributes read below.
 */
export interface BlockChange {
  changeId: string;
  author: string;
  date: string;
  /**
   * Paragraph breaks only: whitespace that sat at the break (end of the
   * previous paragraph + start of this one). Markdown drops it on save; a
   * join restores it.
   */
  ws?: string;
}

export const TRACKED_BLOCK_TYPES = ['codeBlock', 'katexBlock', 'mermaidBlock', 'horizontalRule', 'image'];
export const SPLITTABLE_BLOCK_TYPES = ['paragraph', 'heading'];

function jsonAttr(key: string, name: string, flagAttr: string) {
  return {
    default: null,
    keepOnSplit: false,
    parseHTML: (el: HTMLElement) => {
      // A linked image is parsed from its <a>; the marker is on the <img>.
      const raw = el.getAttribute(name) ?? (el.tagName === 'A' ? el.querySelector('img')?.getAttribute(name) : null);
      if (!raw) return null;
      try {
        const v = JSON.parse(raw) as BlockChange;
        return v && typeof v.changeId === 'string' ? v : null;
      } catch {
        return null;
      }
    },
    renderHTML: (attrs: Record<string, unknown>) => {
      const v = attrs[key] as BlockChange | null | undefined;
      return v ? { [name]: JSON.stringify(v), [flagAttr]: 'true' } : {};
    },
  };
}

export const BlockChanges = Extension.create({
  name: 'markoverBlockChanges',

  addGlobalAttributes() {
    return [
      {
        types: TRACKED_BLOCK_TYPES,
        attributes: {
          markovInsert: jsonAttr('markovInsert', 'data-markov-block-ins', 'data-markov-block-insert'),
          markovDelete: jsonAttr('markovDelete', 'data-markov-block-del', 'data-markov-block-delete'),
        },
      },
      {
        types: SPLITTABLE_BLOCK_TYPES,
        attributes: {
          markovSplit: jsonAttr('markovSplit', 'data-markov-split', 'data-markov-split-mark'),
          markovJoin: jsonAttr('markovJoin', 'data-markov-join', 'data-markov-join-mark'),
        },
      },
    ];
  },
});
