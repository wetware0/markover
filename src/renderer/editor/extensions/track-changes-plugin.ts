import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Mapping, ReplaceStep } from '@tiptap/pm/transform';
import type { StepMap } from '@tiptap/pm/transform';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import type { Mark, MarkType, Node as PMNode, NodeType, ResolvedPos } from '@tiptap/pm/model';
import { nanoid } from 'nanoid';
import { TRACKED_BLOCK_TYPES, SPLITTABLE_BLOCK_TYPES } from './block-changes';
import type { BlockChange } from './block-changes';

const TRACKED_BLOCKS = new Set(TRACKED_BLOCK_TYPES);
const SPLITTABLE = new Set(SPLITTABLE_BLOCK_TYPES);

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
 *  8. Code, math and Mermaid blocks, images and rules are tracked as whole
 *     blocks via node attributes: deleting one keeps it flagged as deleted,
 *     inserting one flags it inserted, and editing inside a code block (or
 *     replacing a math/Mermaid block from its editor) keeps the old version as
 *     a deleted block and flags the edited version inserted. Edits inside a
 *     block you inserted yourself are free.
 *  9. Paragraph breaks: Enter flags the new paragraph `markovSplit` (Reject
 *     joins it back); Backspace/Delete at a paragraph boundary restores the
 *     break flagged `markovJoin` (Accept joins). Removing your own pending
 *     split is a real join.
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
  // Caret placed near a position (between blocks is fine), mapped from tr step `steps`.
  let caretNear: { pos: number; dir: -1 | 1; steps: number } | null = null;

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
  const change = (): BlockChange => ({ changeId: newId(), author, date: today() });
  const handledCodeBlocks = new Set<number>();
  // newState positions at the start of a paragraph created by Enter.
  const splits: number[] = [];

  for (const ref of refs) {
    const { step, docBefore } = ref;
    const rest = new Mapping(maps.slice(ref.mapIndex + 1));
    const { from, to, slice } = step;

    // Edits inside a code block: code text cannot carry marks, so the block is
    // tracked as a whole (rule 8).
    const $stepFrom = docBefore.resolve(from);
    if ($stepFrom.parent.type.name === 'codeBlock' && $stepFrom.sameParent(docBefore.resolve(to))) {
      trackCodeBlockEdit($stepFrom.parent, $stepFrom.before(), rest);
      continue;
    }

    if (to > from && isBoundaryOnlySlice(docBefore.slice(from, to))) {
      // Rule 9: a paragraph break removed on its own (Backspace at the start
      // of a paragraph, Delete at the end, or an empty paragraph removed).
      trackJoin(docBefore.slice(from, to), from, rest, newState.selection.from);
    } else if (to > from) {
      // Deleted content → restore as ghost text.
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
          ownJoinMark($pos) ??
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
    if (slice.size > 0 && (hasInline(slice.content) || hasTableCells(slice.content) || hasTrackedBlock(slice.content))) {
      insertions.push({ from: rest.map(from, 1), to: rest.map(from + slice.size, -1) });
    } else if (
      slice.size > 0 && slice.openStart > 0 && slice.openEnd > 0 &&
      $stepFrom.parent.isTextblock && !hasInline(slice.content)
    ) {
      // Enter: the textblock that now starts at the end of the slice is new.
      splits.push(rest.map(from + slice.size, -1));
    }
  }

  // Rule 9: flag paragraphs created by Enter.
  for (const at of splits) {
    const $p = tr.doc.resolve(tr.mapping.map(at, -1));
    const block = $p.parent;
    // (A plain ProseMirror split copies the original's attributes; the new
    // block's break is always this change.)
    if (!SPLITTABLE.has(block.type.name) || $p.parentOffset !== 0) continue;
    const blockPos = $p.before();
    // Enter straight after your own insertion continues that change.
    const prev = tr.doc.resolve(blockPos).nodeBefore;
    const prevMark = prev?.isTextblock
      ? prev.lastChild?.marks.find((m) => m.type === insType && m.attrs.author === author)
      : null;
    const attr: BlockChange = prevMark ? { ...(prevMark.attrs as BlockChange) } : change();
    const ws = boundaryWhitespace(prev, block);
    if (ws) attr.ws = ws;
    tr.setNodeMarkup(blockPos, undefined, { ...block.attrs, markovSplit: attr, markovJoin: null });
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
    const $a = tr.doc.resolve(a);
    const splitAttr = $a.parentOffset === 0 ? ($a.parent.attrs.markovSplit as BlockChange | null | undefined) : null;
    const mark =
      own(before) ??
      own(after) ??
      (splitAttr && splitAttr.author === author ? insType.create(splitAttr) : null) ??
      insType.create({ changeId: newId(), author, date: today() });
    // Whole code/math/Mermaid blocks and images inside the range (rule 8).
    tr.doc.nodesBetween(a, b, (node, pos) => {
      if (!TRACKED_BLOCKS.has(node.type.name)) return !node.isInline;
      if (pos >= a && pos + node.nodeSize <= b && !node.attrs.markovInsert) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, markovInsert: { ...(mark.attrs as BlockChange) }, markovDelete: null });
      }
      return false;
    });
    if (!hasInline(tr.doc.slice(a, b).content)) continue;
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
  } else {
    // Assigned inside a hoisted helper, which TS flow analysis cannot see.
    const near = caretNear as { pos: number; dir: -1 | 1; steps: number } | null;
    if (near) {
      const p = tr.mapping.slice(near.steps).map(near.pos, near.dir);
      tr.setSelection(Selection.near(tr.doc.resolve(p), near.dir));
    }
  }

  if (untracked) options.onUntrackedEdit?.();
  return tr.docChanged ? tr : null;

  // --- helpers (hoisted) ---

  /**
   * A delete mark continuing an own pending paragraph join next to `$pos`
   * (deleting on from a removed paragraph break is one change).
   */
  function ownJoinMark($pos: ResolvedPos): Mark | null {
    if (!$pos.parent.isTextblock) return null;
    const own = (n: PMNode | null | undefined) => {
      const j = n?.attrs.markovJoin as BlockChange | null | undefined;
      return j && j.author === author ? delType.create(j) : null;
    };
    if ($pos.parentOffset === 0) {
      const mark = own($pos.parent);
      if (mark) return mark;
    }
    if ($pos.parentOffset === $pos.parent.content.size) return own(tr.doc.resolve($pos.after()).nodeAfter);
    return null;
  }

  /**
   * Rule 8 for code blocks: the first edit keeps the original as a deleted
   * block and flags the edited block as inserted; later edits in that (now
   * own-inserted) block are free. An empty block that gets its first text is
   * simply flagged inserted.
   */
  function trackCodeBlockEdit(original: PMNode, beforePos: number, rest: Mapping) {
    const at = rest.map(beforePos, 1);
    if (handledCodeBlocks.has(at)) return;
    handledCodeBlocks.add(at);
    if ((original.attrs.markovInsert as BlockChange | null)?.author === author) return;
    let p = tr.mapping.map(at, 1);
    const current = tr.doc.nodeAt(p);
    if (!current || current.type !== original.type) {
      untracked = true;
      return;
    }
    if (original.content.size > 0 || original.attrs.markovDelete) {
      const kept = original.type.create(
        { ...original.attrs, markovDelete: original.attrs.markovDelete ?? change() },
        original.content,
        original.marks,
      );
      tr.insert(p, kept);
      p += kept.nodeSize;
    }
    tr.setNodeMarkup(p, undefined, { ...current.attrs, markovInsert: change(), markovDelete: null });
  }

  /** Rule 9 for deletions: restore removed paragraph breaks, flagged `markovJoin`. */
  function trackJoin(deleted: Slice, from: number, rest: Mapping, selAfter: number) {
    // Textblocks whose start (the break before them) was deleted.
    const starts: PMNode[] = [];
    const collect = (n: PMNode, open: boolean) => {
      if (n.isTextblock) {
        if (!open) starts.push(n);
        return;
      }
      n.forEach((c, _o, j) => collect(c, open && j === 0));
    };
    deleted.content.forEach((child, _o, i) => collect(child, i === 0 && deleted.openStart > 0));
    // Joining away a break you inserted yourself is a real join.
    if (starts.length > 0 && starts.every((n) => (n.attrs.markovSplit as BlockChange | null)?.author === author)) return;

    const deletedAt = rest.map(from, -1);
    const pos = tr.mapping.map(deletedAt, -1);
    try {
      tr.replace(pos, pos, deleted);
    } catch {
      untracked = true;
      return;
    }
    const end = pos + deleted.size;
    // Continue an adjacent own deletion (Backspace through a word and on into
    // the paragraph break is one change).
    const reuse = ownDeleteMark(tr.doc.resolve(pos).nodeBefore) ?? ownDeleteMark(tr.doc.resolve(end).nodeAfter);
    const attr: BlockChange = reuse ? { ...(reuse.attrs as BlockChange) } : change();
    tr.doc.nodesBetween(pos, end, (node, p) => {
      if (!node.isTextblock) return true;
      if (p + 1 > pos && p + 1 <= end && SPLITTABLE.has(node.type.name) && !node.attrs.markovJoin) {
        const ws = boundaryWhitespace(tr.doc.resolve(p).nodeBefore, node);
        tr.setNodeMarkup(p, undefined, { ...node.attrs, markovJoin: ws ? { ...attr, ws } : attr });
      }
      return false;
    });
    if (singleStep && oldSel.empty) {
      // Leave the caret on the far side of the restored break so the next
      // keystroke deletes the next character instead of re-joining.
      const forward =
        deleted.openStart > 0 ? oldSel.from === from : selAfter > deletedAt;
      caretNear = forward ? { pos: end, dir: 1, steps: tr.steps.length } : { pos, dir: -1, steps: tr.steps.length };
    }
  }

  function skipGhostAndDelete(t: Transaction, start: number, dir: -1 | 1): number {
    let p = start;
    // Walk across the contiguous ghost run within the textblock.
    for (;;) {
      const $p = t.doc.resolve(p);
      const n = dir < 0 ? $p.nodeBefore : $p.nodeAfter;
      if (!n || !n.isInline || !isGhost(n.marks)) break;
      p += dir * n.nodeSize;
    }
    const $p = t.doc.resolve(p);
    const n = dir < 0 ? $p.nodeBefore : $p.nodeAfter;
    if (!n || !n.isInline || (n.isText && !n.text)) return p;
    // One character (keep surrogate pairs whole), or one inline atom.
    let len = n.nodeSize;
    if (n.isText) {
      const text = n.text ?? '';
      const ch = dir < 0 ? text.slice(-2) : text.slice(0, 2);
      len = ch.length === 2 && /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(ch) ? 2 : 1;
    }
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
        if (TRACKED_BLOCKS.has(child.type.name) && !isOpenEdge) {
          // Rule 8: a whole code/math/Mermaid block, image or rule.
          if (dropOwnInserts && (child.attrs.markovInsert as BlockChange | null)?.author === author) return;
          if (child.attrs.markovDelete) { out.push(child); return; }
          const attrs = { ...child.attrs, markovDelete: { ...(delMark.attrs as BlockChange) } };
          out.push(child.type.create(attrs, child.content, child.marks));
          return;
        }
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
    if (!hasInline(content) && !hasTrackedBlock(content)) return null;
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

/**
 * Whitespace on either side of a paragraph break (end of `prev`, start of
 * `block`). Markdown drops it on save, so the change records it and a later
 * join puts it back.
 */
function boundaryWhitespace(prev: PMNode | null | undefined, block: PMNode): string {
  const trailing = prev?.isTextblock ? /\s+$/.exec(prev.textContent)?.[0] ?? '' : '';
  const leading = /^\s+/.exec(block.textContent)?.[0] ?? '';
  return trailing + leading;
}

function hasTrackedBlock(frag: Fragment): boolean {
  let found = false;
  frag.descendants((n) => {
    if (found) return false;
    if (TRACKED_BLOCKS.has(n.type.name)) { found = true; return false; }
    return !n.isInline;
  });
  return found;
}

/**
 * A deleted slice that removes only paragraph breaks and nothing else:
 * `</p><p>` (a join) or a closed run of empty paragraphs.
 */
function isBoundaryOnlySlice(slice: Slice): boolean {
  const frag = slice.content;
  if (frag.childCount === 0 || hasInline(frag) || hasTrackedBlock(frag) || hasTableCells(frag)) return false;
  let ok = true;
  frag.descendants((n) => {
    if (!ok) return false;
    if (n.isTextblock) {
      if (!SPLITTABLE.has(n.type.name)) ok = false;
      return false;
    }
    if (n.isLeaf) ok = false;
    return true;
  });
  if (!ok) return false;
  if (slice.openStart > 0 && slice.openEnd > 0) return true;
  if (slice.openStart !== 0 || slice.openEnd !== 0) return false;
  let allTextblocks = true;
  frag.forEach((n) => { if (!n.isTextblock) allTextblocks = false; });
  return allTextblocks;
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
 *
 * `keepCommentIds` are comments whose highlight survives the paste: text that
 * was cut (its comment no longer anchors anywhere else) keeps its comment.
 */
export function stripCollaborationMarksFromSlice(
  slice: Slice,
  schema: { marks: Record<string, MarkType> },
  keepCommentIds: ReadonlySet<string> = new Set(),
): Slice {
  const del = schema.marks.markovDelete;
  const hl = schema.marks.markovHighlight;
  const strip = [schema.marks.markovInsert, schema.marks.markovDelete].filter(Boolean);
  const keepMark = (m: Mark) =>
    !strip.includes(m.type) && (m.type !== hl || keepCommentIds.has(String(m.attrs.commentId)));
  const changeAttrs = ['markovInsert', 'markovDelete', 'markovSplit', 'markovJoin'];
  const mapFragment = (frag: Fragment): Fragment => {
    const out: PMNode[] = [];
    frag.forEach((child) => {
      if (child.isInline) {
        if (del && child.marks.some((m) => m.type === del)) return;
        out.push(child.mark(child.marks.filter(keepMark)));
        return;
      }
      // Copied deleted blocks are dropped, like copied deleted text.
      if (child.attrs.markovDelete && TRACKED_BLOCKS.has(child.type.name)) return;
      const content = mapFragment(child.content);
      if (changeAttrs.some((a) => child.attrs[a])) {
        const attrs = { ...child.attrs };
        for (const a of changeAttrs) if (a in attrs) attrs[a] = null;
        out.push(child.type.create(attrs, content, child.marks));
      } else {
        out.push(child.copy(content));
      }
    });
    return Fragment.from(out);
  };
  return new Slice(mapFragment(slice.content), slice.openStart, slice.openEnd);
}

/**
 * Comment ids in `slice` that have no highlight on live (not deleted) text in
 * `doc`: the text was cut, so pasting it moves the comment with it. Ids still
 * anchored elsewhere (a copy) are dropped from the paste so one comment never
 * has two live anchors.
 */
export function movedCommentIds(slice: Slice, doc: PMNode): Set<string> {
  const hl = doc.type.schema.marks.markovHighlight;
  const del = doc.type.schema.marks.markovDelete;
  const ids = new Set<string>();
  if (!hl) return ids;
  slice.content.descendants((n) => {
    for (const m of n.marks) if (m.type === hl) ids.add(String(m.attrs.commentId));
    return true;
  });
  if (ids.size === 0) return ids;
  doc.descendants((n) => {
    if (!n.isInline) return true;
    if (del && n.marks.some((m) => m.type === del)) return false;
    for (const m of n.marks) if (m.type === hl) ids.delete(String(m.attrs.commentId));
    return false;
  });
  return ids;
}

/**
 * Track the net change from `start` to `end` as one replacement (used after
 * IME composition, whose intermediate steps replace text the composition
 * itself inserted and would otherwise be read as deletions of it).
 */
export function trackNetChange(
  start: EditorState,
  end: EditorState,
  config: TrackChangesConfig,
  options: TrackChangesOptions = {},
): Transaction | null {
  const a = start.doc;
  const b = end.doc;
  const from = a.content.findDiffStart(b.content);
  if (from === null || from === undefined) return null;
  const diffEnd = a.content.findDiffEnd(b.content);
  if (!diffEnd) return null;
  let { a: endA, b: endB } = diffEnd;
  // findDiffEnd can overlap findDiffStart when the change repeats adjacent text.
  const overlap = from - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  let net: Transaction;
  try {
    net = start.tr.replace(from, endA, b.slice(from, endB));
  } catch {
    return null;
  }
  if (!net.doc.eq(b)) return null;
  return trackTransactions([net], start, end, config, options);
}

/** Dispatched after compositionend when deferred composition edits still need tracking. */
const COMPOSITION_FLUSH = 'trackChangesCompositionFlush';

export function createTrackChangesPlugin(
  getConfig: () => TrackChangesConfig,
  options: TrackChangesOptions = {},
): Plugin {
  let view: EditorView | null = null;
  // While an IME composition is in progress the document must not be changed
  // underneath it (the browser would keep composing into a stale text node and
  // leave stray characters). Edits made while composing are tracked as one net
  // change once the composition ends.
  let composingFrom: { state: EditorState; trs: Transaction[] } | null = null;
  return new Plugin({
    key: trackChangesPluginKey,
    view(v) {
      view = v;
      return { destroy: () => { view = null; } };
    },
    props: {
      transformPasted: (slice, v) =>
        stripCollaborationMarksFromSlice(slice, v.state.schema, movedCommentIds(slice, v.state.doc)),
      handleDOMEvents: {
        compositionend: (v) => {
          // ProseMirror settles the composition ~20ms after compositionend;
          // if no further edit arrives by then, flush the deferred tracking.
          setTimeout(() => {
            if (composingFrom && !v.composing && !v.isDestroyed) {
              v.dispatch(v.state.tr.setMeta(COMPOSITION_FLUSH, true));
            }
          }, 50);
          return false;
        },
      },
    },
    appendTransaction(transactions, oldState, newState) {
      const config = getConfig();
      if (!config.enabled) {
        composingFrom = null;
        return null;
      }
      if (view?.composing) {
        if (transactions.some((t) => t.docChanged)) {
          composingFrom ??= { state: oldState, trs: [] };
          composingFrom.trs.push(...transactions);
        }
        return null;
      }
      if (composingFrom) {
        const start = composingFrom.state;
        composingFrom = null;
        // Undo/redo during a composition: nothing coherent to track.
        if (transactions.some((t) => t.getMeta(HISTORY_META))) return null;
        return trackNetChange(start, newState, config, options);
      }
      return trackTransactions(transactions, oldState, newState, config, options);
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
