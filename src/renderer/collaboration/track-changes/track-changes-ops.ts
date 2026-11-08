/**
 * Pure ProseMirror operations on tracked changes and comment highlights.
 * Kept free of React/TipTap so the headless test harness can exercise them.
 */
import { EditorState } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import type { Mark, MarkType, Node as PMNode } from '@tiptap/pm/model';
import { TRACK_CHANGES_PROCESSED, isTableCell } from '../../editor/extensions/track-changes-plugin';
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
  const cellsById = new Map<string, number[]>();
  doc.descendants((node, pos, parent) => {
    if (isTableCell(node)) {
      for (const [attr, type] of [['markovInsert', 'insertion'], ['markovDelete', 'deletion']] as const) {
        const c = node.attrs[attr] as CellChange | null;
        if (!c) continue;
        const key = `${type}:${c.changeId}`;
        if (!byId.has(key)) {
          byId.set(key, { id: c.changeId, type, author: c.author, date: c.date, text: '', from: pos, to: pos });
          cellsById.set(key, []);
        }
        cellsById.get(key)?.push(pos);
      }
      return true;
    }
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
  // Structural table changes: describe the unit (table / row / column) and
  // list its cell texts.
  for (const [key, positions] of cellsById) {
    const change = byId.get(key);
    if (!change || positions.length === 0) continue;
    const texts = positions.map((p) => doc.nodeAt(p)?.textContent ?? '');
    change.text = `${describeCells(doc, positions)}: ${texts.join(' | ')}`;
    const last = positions[positions.length - 1];
    change.to = Math.max(change.to ?? 0, last + (doc.nodeAt(last)?.nodeSize ?? 0));
  }
  return [...byId.values()];
}

interface CellChange { changeId: string; author: string; date: string }

/** "Table", "Table row(s)" or "Table column(s)" for a set of cell positions. */
function describeCells(doc: PMNode, positions: number[]): string {
  const set = new Set(positions);
  const tables = new Set<number>();
  const rows = new Map<number, number>(); // row pos -> cells in set
  for (const p of positions) {
    const $p = doc.resolve(p);
    const rowPos = $p.before($p.depth);
    rows.set(rowPos, (rows.get(rowPos) ?? 0) + 1);
    tables.add($p.before($p.depth - 1));
  }
  let wholeTables = true;
  for (const t of tables) {
    doc.nodeAt(t)?.descendants((n, rel) => {
      if (isTableCell(n) && !set.has(t + 1 + rel)) wholeTables = false;
      return !isTableCell(n);
    });
  }
  if (wholeTables) return tables.size > 1 ? 'Tables' : 'Table';
  let wholeRows = true;
  for (const [rowPos, count] of rows) {
    if ((doc.nodeAt(rowPos)?.childCount ?? 0) !== count) wholeRows = false;
  }
  if (wholeRows) return rows.size > 1 ? 'Table rows' : 'Table row';
  return positions.length / Math.max(1, rows.size) > 1 ? 'Table columns' : 'Table column';
}

/** Remove cells (by position), collapsing to whole rows or the whole table when fully covered. */
function dropCells(tr: Transaction, positions: Set<number>) {
  const byTable = new Map<number, number[]>();
  for (const p of positions) {
    const $p = tr.doc.resolve(p);
    const t = $p.before($p.depth - 1);
    byTable.set(t, [...(byTable.get(t) ?? []), p]);
  }
  const tablePositions = [...byTable.keys()].sort((a, b) => b - a);
  for (const tablePos of tablePositions) {
    const table = tr.doc.nodeAt(tablePos);
    if (!table) continue;
    const rowsInfo: Array<{ pos: number; size: number; cells: Array<{ pos: number; size: number; drop: boolean }> }> = [];
    table.forEach((row, rowOffset) => {
      const rowPos = tablePos + 1 + rowOffset;
      const cells: Array<{ pos: number; size: number; drop: boolean }> = [];
      row.forEach((cell, cellOffset) => {
        const cellPos = rowPos + 1 + cellOffset;
        cells.push({ pos: cellPos, size: cell.nodeSize, drop: positions.has(cellPos) });
      });
      rowsInfo.push({ pos: rowPos, size: row.nodeSize, cells });
    });
    if (rowsInfo.every((r) => r.cells.every((c) => c.drop))) {
      tr.delete(tablePos, tablePos + table.nodeSize);
      continue;
    }
    for (let r = rowsInfo.length - 1; r >= 0; r--) {
      const row = rowsInfo[r];
      if (row.cells.length > 0 && row.cells.every((c) => c.drop)) {
        tr.delete(row.pos, row.pos + row.size);
        continue;
      }
      for (let c = row.cells.length - 1; c >= 0; c--) {
        const cell = row.cells[c];
        if (cell.drop) tr.delete(cell.pos, cell.pos + cell.size);
      }
    }
  }
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

  // Table structure (cell attributes): settle these first. setNodeMarkup does
  // not shift positions; cell removals are applied bottom-up, and the text
  // runs below are mapped through them.
  const keepAttr = action === 'accept' ? 'markovInsert' : 'markovDelete';
  const dropAttr = action === 'accept' ? 'markovDelete' : 'markovInsert';
  const cellInScope = (c: CellChange | null) => !!c && (ids === null || ids.has(String(c.changeId)));
  const toDrop = new Set<number>();
  state.doc.descendants((node, pos) => {
    if (!isTableCell(node)) return !node.isInline;
    if (cellInScope(node.attrs[keepAttr] as CellChange | null)) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, [keepAttr]: null });
    }
    if (cellInScope(node.attrs[dropAttr] as CellChange | null)) toDrop.add(pos);
    return true;
  });
  if (toDrop.size > 0) dropCells(tr, toDrop);

  for (const r of rangesWithMark(state.doc, (m) => m.type === keepType && inScope(m))) {
    const from = tr.mapping.map(r.from, 1);
    const to = tr.mapping.map(r.to, -1);
    if (to > from) tr.removeMark(from, to, r.mark);
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
  const ranges: Range[] = rangesWithMark(doc, (m) => (m.type === ins || m.type === del) && m.attrs.changeId === id);
  doc.descendants((node, pos) => {
    if (!isTableCell(node)) return !node.isInline;
    const hit = [node.attrs.markovInsert, node.attrs.markovDelete].some((c) => (c as CellChange | null)?.changeId === id);
    // Inside the cell's first paragraph, so a text selection can resolve.
    if (hit) ranges.push({ from: pos + 2, to: pos + node.nodeSize - 2 });
    return false;
  });
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
