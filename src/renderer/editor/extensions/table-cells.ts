import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';

/**
 * Tracked table structure: a cell can carry a pending insertion and/or a
 * pending deletion (row/column/table inserted or deleted with track changes
 * on). Stored as node attributes because empty cells have no text to mark.
 *
 * Persistence: the serializer writes an empty marker span at the start of the
 * cell's Markdown, e.g.
 *   | <span data-markov="cell" data-op="del" data-change-id="x" data-author="A" data-date="2026-01-01"></span>a1 |
 * which markdown-it passes through as inline HTML; parseHTML below reads it
 * back. Rendered cells get `markover-cell-insert` / `markover-cell-delete`.
 */
export interface CellChange {
  changeId: string;
  author: string;
  date: string;
}

function readMarker(el: HTMLElement, op: 'ins' | 'del'): CellChange | null {
  // Rendered by the editor itself (copy/paste, DOM round trip)
  const own = el.getAttribute(`data-markov-cell-${op}`);
  if (own) {
    try { return JSON.parse(own) as CellChange; } catch { /* fall through */ }
  }
  // Marker span written by the Markdown serializer
  const span = el.querySelector(`span[data-markov="cell"][data-op="${op}"]`);
  if (!span) return null;
  return {
    changeId: span.getAttribute('data-change-id') ?? '',
    author: span.getAttribute('data-author') ?? '',
    date: span.getAttribute('data-date') ?? '',
  };
}

function cellAttributes(parent: (() => Record<string, unknown>) | undefined) {
  return {
    ...parent?.(),
    // Column alignment (left/center/right) parsed from markdown-it's
    // style="text-align:..." attributes.
    align: {
      default: null,
      parseHTML: (el: HTMLElement) => el.style.textAlign || null,
      renderHTML: (attrs: { align?: string | null }) => (attrs.align ? { style: `text-align: ${attrs.align}` } : {}),
    },
    markovInsert: {
      default: null,
      parseHTML: (el: HTMLElement) => readMarker(el, 'ins'),
      renderHTML: (attrs: { markovInsert?: CellChange | null }) =>
        attrs.markovInsert
          ? {
              class: 'markover-cell-insert',
              'data-markov-cell-ins': JSON.stringify(attrs.markovInsert),
              'data-change-id': attrs.markovInsert.changeId,
            }
          : {},
    },
    markovDelete: {
      default: null,
      parseHTML: (el: HTMLElement) => readMarker(el, 'del'),
      renderHTML: (attrs: { markovDelete?: CellChange | null }) =>
        attrs.markovDelete
          ? {
              class: 'markover-cell-delete',
              'data-markov-cell-del': JSON.stringify(attrs.markovDelete),
              'data-change-id': attrs.markovDelete.changeId,
            }
          : {},
    },
  };
}

export const MarkoverTableCell = TableCell.extend({
  addAttributes() {
    return cellAttributes(this.parent);
  },
});

export const MarkoverTableHeader = TableHeader.extend({
  addAttributes() {
    return cellAttributes(this.parent);
  },
});
