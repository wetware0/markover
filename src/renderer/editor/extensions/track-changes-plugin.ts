import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Mapping, ReplaceStep } from '@tiptap/pm/transform';
import type { StepMap } from '@tiptap/pm/transform';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Mark, MarkType, Node as PMNode, NodeType } from '@tiptap/pm/model';
import { nanoid } from 'nanoid';

export const trackChangesPluginKey = new PluginKey('trackChanges');

/** Transactions carrying this meta are never (re-)tracked. */
export const TRACK_CHANGES_PROCESSED = 'trackChangesProcessed';

/** prosemirror-history tags undo/redo transactions with its plugin key ("history$"). */
const HISTORY_META = 'history$';

export interface TrackChangesConfig {
  enabled: boolean;
  author: string;
}

export interface TrackChangesOptions {
  /** Override for tests: today's date as YYYY-MM-DD. */
  today?: () => string;
  /** Override for tests: change-id generator. */
  newId?: () => string;
  /** Called when an edit could not be represented as a tracked change. */
  onUntrackedEdit?: () => void;
}

/*
 * Coalescing rules (Word / Google Docs style). Grouping is derived from the
 * document itself rather than from in-memory "last keystroke" state, so it is
 * independent of typing speed, undo history, cursor moves and reloads:
 *
 *  1. New text joins an existing insertion when it touches (is directly left
 *     or right of) an insertion by the SAME author. The existing mark is reused
 *     verbatim (same id/author/date), so ProseMirror merges the text nodes and
 *     the change list shows one entry. Otherwise a fresh insertion id is minted.
 *  2. Deleting untracked text re-inserts it as "ghost" text with a deletion
 *     mark. The ghost joins an adjacent deletion by the same author (either
 *     side), so backspacing or forward-deleting over a word is one change.
 *  3. Deleting text that is the author's OWN pending insertion removes it for
 *     real: there is nothing to review.
 *  4. Deleting someone else's insertion marks it deleted (it keeps their
 *     insertion mark as well), so accepting/rejecting works for both parties.
 *  5. Existing ghost text is never deleted by editing. A collapsed Backspace or
 *     Delete over it skips the whole ghost run and deletes the next visible
 *     character instead, which then coalesces with that run (rule 2).
 *  6. Typing over a selection yields an adjacent deletion followed by an
 *     insertion; the caret stays after the inserted text.
 *  7. After a collapsed Backspace the caret sits BEFORE the new ghost text so
 *     the next Backspace extends the same deletion leftwards; after Delete (or
 *     a range deletion) it sits after it.
 *
 * No time window is used: two edits only coalesce when they are physically
 * adjacent and by the same author, which is exactly what "one change" means in
 * a review UI. Undo/redo transactions are never re-tracked; the marks added
 * here are appended to the same history event, so undo removes them together
 * with the edit that produced them.
 */
export function trackTransactions(
  transactions: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
  config: TrackChangesConfig,
  options: TrackChangesOptions = {},
): Transaction | null {
  if (!config.enabled) return null;
  const schema = newState.schema;
  const insType = schema.marks.markovInsert;
  const delType = schema.marks.markovDelete;
  if (!insType || !delType) return null;

  const isTracked = (tr: Transaction) =>
    tr.docChanged && !tr.getMeta(TRACK_CHANGES_PROCESSED) && !tr.getMeta(HISTORY_META);
  if (!transactions.some(isTracked)) return null;

  const author = config.author;
  const today = options.today ?? (() => new Date().toISOString().split('T')[0]);
  const newId = options.newId ?? (() => nanoid(8));

  // Flatten every step of every transaction in this batch so positions from an
  // early step can be mapped into newState.doc.
  interface StepRef { step: ReplaceStep; docBefore: PMNode; mapIndex: number }
  const maps: StepMap[] = [];
  const refs: StepRef[] = [];
  for (const t of transactions) {
    const tracked = isTracked(t);
    t.steps.forEach((step, i) => {
      // ReplaceAroundStep (wrap/lift/set block type) and mark steps are
      // formatting/structure, not content; they pass through untracked.
      if (tracked && step instanceof ReplaceStep) {
        refs.push({ step, docBefore: t.docs[i], mapIndex: maps.length });
      }
      maps.push(step.getMap());
    });
  }
  if (refs.length === 0) return null;

  const tr = newState.tr;
  tr.setMeta(TRACK_CHANGES_PROCESSED, true);
  let untracked = false;
  const insertions: Array<{ from: number; to: number }> = [];
  let caret: number | null = null;

  const isOwnInsert = (marks: readonly Mark[]) =>
    marks.some((m) => m.type === insType && m.attrs.author === author);
  const isGhost = (marks: readonly Mark[]) => marks.some((m) => m.type === delType);
  const ownDeleteMark = (node: PMNode | null | undefined) =>
    node?.marks.find((m) => m.type === delType && m.attrs.author === author) ?? null;

  // Table structure (rows/columns/tables) is tracked on cell attributes; one
  // id per batch so e.g. a column insert/delete (one step per row) is one change.
  let structIns: { changeId: string; author: string; date: string } | null = null;
  let structDel: { changeId: string; author: string; date: string } | null = null;
  const structInsAttr = () => (structIns ??= { changeId: newId(), author, date: today() });
  const structDelAttr = () => (structDel ??= { changeId: newId(), author, date: today() });

  const singleStep = refs.length === 1 && transactions.filter(isTracked).length === 1;
  const oldSel = oldState.selection;

  for (const ref of refs) {
    const { step, docBefore } = ref;
    const rest = new Mapping(maps.slice(ref.mapIndex + 1));
    const { from, to, slice } = step;

    // Deleted content → restore as ghost text.
    if (to > from) {
      const deleted = docBefore.slice(from, to);
      const pos = tr.mapping.map(rest.map(from, -1), -1);
      const backspace = singleStep && slice.size === 0 && oldSel.empty && oldSel.from === to;
      const forwardDelete = singleStep && slice.size === 0 && oldSel.empty && oldSel.from === from;
      const ghostOnly = hasInline(deleted.content) && allInline(deleted.content, (n) => isGhost(n.marks));

      if (isTableStructureSlice(deleted)) {
        // Whole rows / cells (a column is one cell per row) / tables: keep them
        // in place flagged as deleted; Accept removes exactly these nodes.
        const restored = toDeletedCells(deleted);
        if (restored) {
          try {
            tr.replace(pos, pos, restored);
          } catch {
            untracked = true;
          }
        }
      } else if (ghostOnly && (backspace || forwardDelete)) {
        // Rule 5: restore the ghost, skip past its run, delete the next char.
        tr.replace(pos, pos, deleted);
        const after = pos + deleted.size;
        caret = skipGhostAndDelete(tr, backspace ? pos : after, backspace ? -1 : 1);
        continue;
      } else {
        // Text (possibly spanning blocks) → restore as ghost text.
        const $from = docBefore.resolve(from);
        const parentType = $from.node($from.sharedDepth(to)).type;
        const $pos = tr.doc.resolve(pos);
        const reuse =
          ownDeleteMark($pos.nodeBefore) ??
          ownDeleteMark($pos.nodeAfter) ??
          findInFragment(deleted.content, (n) => ownDeleteMark(n));
        const delMark = reuse ?? delType.create({ changeId: newId(), author, date: today() });

        const ghost = toGhost(deleted, parentType, delMark, true);
        if (ghost === 'unmarkable') {
          untracked = true;
        } else if (ghost) {
          try {
            tr.replace(pos, pos, ghost);
            if (backspace) caret = pos;
          } catch {
            // Dropping own insertions produced a shape that won't fit — retry
            // keeping them (as deleted text) before giving up on tracking.
            const full = toGhost(deleted, parentType, delMark, false);
            try {
              if (full && full !== 'unmarkable') {
                tr.replace(pos, pos, full);
                if (backspace) caret = pos;
              } else {
                untracked = true;
              }
            } catch {
              untracked = true;
            }
          }
        }
      }
    }

    // Inserted content → record its range in newState coordinates.
    if (slice.size > 0 && (hasInline(slice.content) || hasTableCells(slice.content))) {
      insertions.push({ from: rest.map(from, 1), to: rest.map(from + slice.size, -1) });
    }
  }

  // Mark insertions (after restorations, so ghosts typed over sit before them).
  for (const range of insertions) {
    const a = tr.mapping.map(range.from, 1);
    const b = tr.mapping.map(range.to, -1);
    if (b <= a) continue;
    const before = tr.doc.resolve(a).nodeBefore;
    const after = tr.doc.resolve(b).nodeAfter;
    const own = (n: PMNode | null | undefined) =>
      n?.marks.find((m) => m.type === insType && m.attrs.author === author) ?? null;
    // Whole cells inside the inserted range (new row/column/table) are
    // tracked structurally; their text is part of that change.
    const cells: Array<{ pos: number; node: PMNode }> = [];
    tr.doc.nodesBetween(a, b, (node, pos) => {
      if (isTableCell(node) && pos >= a && pos + node.nodeSize <= b) {
        cells.push({ pos, node });
        return false;
      }
      return true;
    });
    const newCellPositions = new Set(cells.map((c) => c.pos));
    for (const { pos, node } of cells) {
      // A cell added to a row that is pending deletion (e.g. inserting a
      // column) belongs to that deletion too, so accepting it removes the
      // whole row rather than leaving a stub row behind.
      const $cell = tr.doc.resolve(pos);
      const rowStart = $cell.start();
      const siblingDeletes: Array<{ changeId: string } | null> = [];
      $cell.parent.forEach((sibling, offset) => {
        if (!newCellPositions.has(rowStart + offset)) siblingDeletes.push(sibling.attrs.markovDelete ?? null);
      });
      const rowDelete =
        siblingDeletes.length > 0 &&
        siblingDeletes.every((d) => d && d.changeId === siblingDeletes[0]?.changeId)
          ? siblingDeletes[0]
          : null;
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        markovInsert: node.attrs.markovInsert ?? structInsAttr(),
        markovDelete: rowDelete,
      });
    }
    if (!hasInline(tr.doc.slice(a, b).content)) continue;
    const mark = own(before) ?? own(after) ?? insType.create({ changeId: newId(), author, date: today() });
    // Typed text can inherit someone's insertion or a ghost's deletion mark
    // when the caret is inside that span; new text is only ever "inserted by me".
    tr.removeMark(a, b, insType);
    tr.removeMark(a, b, delType);
    tr.addMark(a, b, mark);
    for (const { pos, node } of cells) tr.removeMark(pos, pos + node.nodeSize, insType);
  }

  if (caret !== null) {
    try {
      tr.setSelection(TextSelection.create(tr.doc, caret));
    } catch {
      /* leave the mapped selection */
    }
  }

  if (untracked) options.onUntrackedEdit?.();
  return tr.docChanged ? tr : null;

  // --- helpers (hoisted) ---

  function skipGhostAndDelete(t: Transaction, start: number, dir: -1 | 1): number {
    let p = start;
    // Walk across the contiguous ghost run within the textblock.
    for (;;) {
      const $p = t.doc.resolve(p);
      const n = dir < 0 ? $p.nodeBefore : $p.nodeAfter;
      if (!n || !n.isText || !isGhost(n.marks)) break;
      p += dir * n.nodeSize;
    }
    const $p = t.doc.resolve(p);
    const n = dir < 0 ? $p.nodeBefore : $p.nodeAfter;
    if (!n || !n.isText || !n.text) return p;
    // One character (keep surrogate pairs whole).
    const text = n.text;
    const ch = dir < 0 ? text.slice(-2) : text.slice(0, 2);
    const len = ch.length === 2 && /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(ch) ? 2 : 1;
    const a = dir < 0 ? p - len : p;
    const b = dir < 0 ? p : p + len;
    if (isOwnInsert(n.marks)) {
      t.delete(a, b);
      return a;
    }
    const $a = t.doc.resolve(a);
    if (!$a.parent.type.allowsMarkType(delType)) return p;
    const mark =
      ownDeleteMark(dir < 0 ? t.doc.resolve(b).nodeAfter : t.doc.resolve(a).nodeBefore) ??
      delType.create({ changeId: newId(), author, date: today() });
    t.addMark(a, b, mark);
    return dir < 0 ? a : b;
  }

  /** Deleted rows/cells/tables flagged as pending deletions (own inserted ones dropped). */
  function toDeletedCells(deleted: Slice): Slice | null {
    const ownInsertedOnly = (node: PMNode) => {
      let all = true;
      let any = false;
      node.descendants((n) => {
        if (!isTableCell(n)) return true;
        any = true;
        if ((n.attrs.markovInsert as { author?: string } | null)?.author !== author) all = false;
        return false;
      });
      if (isTableCell(node)) return (node.attrs.markovInsert as { author?: string } | null)?.author === author;
      return any && all;
    };
    const mark = (node: PMNode): PMNode => {
      if (isTableCell(node)) {
        return node.attrs.markovDelete ? node : node.type.create({ ...node.attrs, markovDelete: structDelAttr() }, node.content, node.marks);
      }
      const kids: PMNode[] = [];
      node.forEach((c) => kids.push(mark(c)));
      return node.copy(Fragment.from(kids));
    };
    const out: PMNode[] = [];
    deleted.content.forEach((child) => {
      // Deleting a row/column/table you inserted yourself just removes it.
      if (ownInsertedOnly(child)) return;
      out.push(mark(child));
    });
    if (out.length === 0) return null;
    return new Slice(Fragment.from(out), 0, 0);
  }

  function toGhost(
    deleted: Slice,
    parentType: NodeType,
    delMark: Mark,
    dropOwnInserts: boolean,
  ): Slice | null | 'unmarkable' {
    let unmarkable = false;
    const mapFragment = (frag: Fragment, parent: NodeType, depth: number): Fragment => {
      const out: PMNode[] = [];
      frag.forEach((child, _offset, index) => {
        if (child.isInline) {
          if (dropOwnInserts && isOwnInsert(child.marks)) return;
          if (isGhost(child.marks)) { out.push(child); return; }
          if (!parent.allowsMarkType(delType)) { unmarkable = true; out.push(child); return; }
          out.push(child.mark(delMark.addToSet(child.marks)));
          return;
        }
        const isOpenEdge =
          (index === 0 && depth < deleted.openStart) ||
          (index === frag.childCount - 1 && depth < deleted.openEnd);
        const content = mapFragment(child.content, child.type, depth + 1);
        // A closed textblock whose text was entirely the author's own insertion
        // disappears with it rather than leaving an empty paragraph behind.
        if (!isOpenEdge && child.isTextblock && child.content.size > 0 && content.size === 0) return;
        out.push(child.copy(content));
      });
      return Fragment.from(out);
    };
    const content = mapFragment(deleted.content, parentType, 0);
    if (unmarkable) return 'unmarkable';
    if (!hasInline(content)) return null;
    return new Slice(content, deleted.openStart, deleted.openEnd);
  }
}

function tableRole(node: PMNode): string | undefined {
  return node.type.spec.tableRole as string | undefined;
}

export function isTableCell(node: PMNode): boolean {
  const role = tableRole(node);
  return role === 'cell' || role === 'header_cell';
}

/** A closed slice made only of table rows, cells or whole tables. */
function isTableStructureSlice(slice: Slice): boolean {
  if (slice.openStart !== 0 || slice.openEnd !== 0 || slice.content.childCount === 0) return false;
  let ok = true;
  slice.content.forEach((n) => {
    const role = tableRole(n);
    if (role !== 'row' && role !== 'table' && !isTableCell(n)) ok = false;
  });
  return ok;
}

function hasTableCells(frag: Fragment): boolean {
  let found = false;
  frag.descendants((n) => {
    if (found) return false;
    if (isTableCell(n)) { found = true; return false; }
    return !n.isInline;
  });
  return found;
}

function hasInline(frag: Fragment): boolean {
  let found = false;
  frag.descendants((n) => {
    if (found) return false;
    if (n.isInline) { found = true; return false; }
    return true;
  });
  return found;
}

function allInline(frag: Fragment, pred: (n: PMNode) => boolean): boolean {
  let ok = true;
  frag.descendants((n) => {
    if (!ok) return false;
    if (n.isInline) { if (!pred(n)) ok = false; return false; }
    return true;
  });
  return ok;
}

function findInFragment<T>(frag: Fragment, fn: (n: PMNode) => T | null): T | null {
  let result: T | null = null;
  frag.descendants((n) => {
    if (result) return false;
    if (n.isInline) { result = fn(n); return false; }
    return true;
  });
  return result;
}

/**
 * Strip collaboration marks from pasted content. Copied tracked text would
 * otherwise duplicate change/comment ids at a second location (accepting one
 * would silently accept the other), and copied ghost text would paste as
 * "already deleted".
 */
export function stripCollaborationMarksFromSlice(slice: Slice, schema: { marks: Record<string, MarkType> }): Slice {
  const del = schema.marks.markovDelete;
  const strip = [schema.marks.markovInsert, schema.marks.markovDelete, schema.marks.markovHighlight].filter(Boolean);
  const mapFragment = (frag: Fragment): Fragment => {
    const out: PMNode[] = [];
    frag.forEach((child) => {
      if (child.isInline) {
        if (del && child.marks.some((m) => m.type === del)) return;
        out.push(child.mark(child.marks.filter((m) => !strip.includes(m.type))));
        return;
      }
      const content = mapFragment(child.content);
      if (isTableCell(child) && (child.attrs.markovInsert || child.attrs.markovDelete)) {
        out.push(child.type.create({ ...child.attrs, markovInsert: null, markovDelete: null }, content, child.marks));
      } else {
        out.push(child.copy(content));
      }
    });
    return Fragment.from(out);
  };
  return new Slice(mapFragment(slice.content), slice.openStart, slice.openEnd);
}

export function createTrackChangesPlugin(
  getConfig: () => TrackChangesConfig,
  options: TrackChangesOptions = {},
): Plugin {
  return new Plugin({
    key: trackChangesPluginKey,
    props: {
      transformPasted: (slice, view) => stripCollaborationMarksFromSlice(slice, view.state.schema),
    },
    appendTransaction(transactions, oldState, newState) {
      return trackTransactions(transactions, oldState, newState, getConfig(), options);
    },
  });
}

export const TrackChangesPlugin = Extension.create({
  name: 'trackChangesPlugin',

  addStorage() {
    return {
      enabled: false,
      author: 'User',
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const extensionName = this.name;
    return [
      createTrackChangesPlugin(
        () => (editor.storage as unknown as Record<string, TrackChangesConfig>)[extensionName],
        {
          onUntrackedEdit: () => {
            // A tracked document must never contain silent, invisible edits.
            if (typeof document !== 'undefined') {
              document.dispatchEvent(new CustomEvent('markover:untracked-edit'));
            }
          },
        },
      ),
    ];
  },
});
