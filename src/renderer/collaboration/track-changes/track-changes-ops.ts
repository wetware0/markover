/**
 * Pure ProseMirror operations on tracked changes and comment highlights.
 * Kept free of React/TipTap so the headless test harness can exercise them.
 */
import { EditorState } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import type { Mark, MarkType, Node as PMNode } from '@tiptap/pm/model';
import { TRACK_CHANGES_PROCESSED } from '../../editor/extensions/track-changes-plugin';
import type { TrackedChange } from './track-changes-store';

function markTypes(doc: PMNode) {
  const { marks } = doc.type.schema;
  return {
    ins: marks.markovInsert as MarkType | undefined,
    del: marks.markovDelete as MarkType | undefined,
    hl: marks.markovHighlight as MarkType | undefined,
  };
}

/**
 * One entry per change id, in document order. Text is concatenated across
 * every node carrying the id (a change can span formatting and paragraphs).
 */
export function collectChanges(doc: PMNode): TrackedChange[] {
  const { ins, del } = markTypes(doc);
  const byId = new Map<string, TrackedChange>();
  const lastBlockById = new Map<string, PMNode>();
  doc.descendants((node, pos, parent) => {
    if (!node.isInline) return true;
    for (const mark of node.marks) {
      const type = mark.type === ins ? 'insertion' : mark.type === del ? 'deletion' : null;
      if (!type) continue;
      const id = String(mark.attrs.changeId);
      const key = `${type}:${id}`;
      let change = byId.get(key);
      if (!change) {
        change = { id, type, author: mark.attrs.author, date: mark.attrs.date, text: '', from: pos, to: pos };
        byId.set(key, change);
      } else if (lastBlockById.get(key) !== parent) {
        change.text += ' ¶ ';
      }
      lastBlockById.set(key, parent as PMNode);
      change.text += node.isText ? node.text ?? '' : `[${node.type.name}]`;
      change.to = pos + node.nodeSize;
    }
    return false;
  });
  return [...byId.values()];
}

interface Range { from: number; to: number }

function rangesWithMark(doc: PMNode, pred: (m: Mark) => boolean): Array<Range & { mark: Mark }> {
  const out: Array<Range & { mark: Mark }> = [];
  doc.descendants((node, pos) => {
    if (!node.isInline) return true;
    for (const mark of node.marks) {
      if (pred(mark)) out.push({ from: pos, to: pos + node.nodeSize, mark });
    }
    return false;
  });
  return out;
}

/** Group ranges into runs separated only by node boundaries (no other inline content). */
function toRuns(doc: PMNode, ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const runs: Range[] = [];
  for (const r of sorted) {
    const prev = runs[runs.length - 1];
    if (prev && r.from <= prev.to) { prev.to = Math.max(prev.to, r.to); continue; }
    if (prev) {
      let gapHasInline = false;
      doc.nodesBetween(prev.to, r.from, (n, p) => {
        if (gapHasInline) return false;
        if (n.isInline && p + n.nodeSize > prev.to && p < r.from) gapHasInline = true;
        return true;
      });
      if (!gapHasInline) { prev.to = r.to; continue; }
    }
    runs.push({ ...r });
  }
  return runs;
}

/**
 * Delete a run of tracked content. When the run covers every inline node of an
 * enclosing block (a whole paragraph, list, table…), the block goes too, so
 * accepting a deleted paragraph does not leave an empty line behind and a
 * table cell edit never takes the whole table with it.
 */
function deleteRun(tr: Transaction, run: Range, covered: (n: PMNode) => boolean) {
  const from = tr.mapping.map(run.from, 1);
  const to = tr.mapping.map(run.to, -1);
  if (to <= from) return;
  const $from = tr.doc.resolve(from);
  const shared = $from.sharedDepth(to);
  for (let d = 1; d <= shared; d++) {
    const node = $from.node(d);
    // Never remove a table cell on its own; that would break the table grid.
    const role = node.type.spec.tableRole as string | undefined;
    if (node.type.spec.isolating || role === 'cell' || role === 'header_cell') continue;
    let all = true;
    let any = false;
    node.descendants((n) => {
      if (!all) return false;
      if (n.isInline) { any = true; if (!covered(n)) all = false; return false; }
      return true;
    });
    if (any && all) {
      try {
        tr.delete($from.before(d), $from.after(d));
        return;
      } catch { break; }
    }
  }
  try {
    tr.deleteRange(from, to);
  } catch {
    tr.delete(from, to);
  }
}

export type ChangeAction = 'accept' | 'reject';

/**
 * Accept or reject tracked changes in a single transaction (one undo step).
 * `ids === null` means every change in the document.
 */
export function resolveChanges(state: EditorState, ids: ReadonlySet<string> | null, action: ChangeAction): Transaction {
  const tr = state.tr;
  tr.setMeta(TRACK_CHANGES_PROCESSED, true);
  const { ins, del } = markTypes(state.doc);
  if (!ins || !del) return tr;
  const inScope = (m: Mark) => ids === null || ids.has(String(m.attrs.changeId));

  // accept → keep insertions (drop mark), remove deletions (drop content)
  // reject → keep deletions (drop mark), remove insertions (drop content)
  const keepType = action === 'accept' ? ins : del;
  const dropType = action === 'accept' ? del : ins;

  for (const r of rangesWithMark(state.doc, (m) => m.type === keepType && inScope(m))) {
    tr.removeMark(r.from, r.to, r.mark);
  }
  const dropPred = (m: Mark) => m.type === dropType && inScope(m);
  const runs = toRuns(state.doc, rangesWithMark(state.doc, dropPred));
  const covered = (n: PMNode) => n.marks.some(dropPred);
  for (let i = runs.length - 1; i >= 0; i--) deleteRun(tr, runs[i], covered);
  return tr;
}

/** Position range of a change (first..last node), for navigation. */
export function changeRange(doc: PMNode, id: string): Range | null {
  const { ins, del } = markTypes(doc);
  const ranges = rangesWithMark(doc, (m) => (m.type === ins || m.type === del) && m.attrs.changeId === id);
  if (ranges.length === 0) return null;
  return { from: Math.min(...ranges.map((r) => r.from)), to: Math.max(...ranges.map((r) => r.to)) };
}

/** Position range of a comment's highlighted text, or null when orphaned. */
export function commentRange(doc: PMNode, commentId: string): Range | null {
  const { hl } = markTypes(doc);
  const ranges = rangesWithMark(doc, (m) => m.type === hl && m.attrs.commentId === commentId);
  if (ranges.length === 0) return null;
  return { from: Math.min(...ranges.map((r) => r.from)), to: Math.max(...ranges.map((r) => r.to)) };
}

/** Comment ids that still have highlighted text in the document. */
export function anchoredCommentIds(doc: PMNode): Set<string> {
  const { hl } = markTypes(doc);
  const ids = new Set<string>();
  doc.descendants((node) => {
    if (!node.isInline) return true;
    for (const m of node.marks) if (m.type === hl) ids.add(String(m.attrs.commentId));
    return false;
  });
  return ids;
}

/** The comment id under a document position (the caret), if any. */
export function commentIdAt(doc: PMNode, pos: number): string | null {
  const { hl } = markTypes(doc);
  const $pos = doc.resolve(pos);
  for (const node of [$pos.nodeAfter, $pos.nodeBefore]) {
    const m = node?.marks.find((mk) => mk.type === hl);
    if (m) return String(m.attrs.commentId);
  }
  return null;
}

/**
 * The document as it should be published: every tracked change accepted and
 * every comment highlight removed (text kept).
 */
export function publishDoc(doc: PMNode): PMNode {
  const state = EditorState.create({ doc });
  const tr = resolveChanges(state, null, 'accept');
  const { hl } = markTypes(doc);
  if (hl) tr.removeMark(0, tr.doc.content.size, hl);
  return tr.doc;
}
