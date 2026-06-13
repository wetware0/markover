// Line/block-level diff of two markdown strings → a markdown string with the
// existing markover ins/del span markers around changed blocks. The output flows
// through the unchanged parser (src/renderer/editor/markdown/parser.ts), which
// converts data-markov spans into track-change marks. Pure + deterministic.

function blocks(md: string): string[] {
  return md.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter((b) => b.length > 0);
}

type Op = { type: 'same' | 'del' | 'ins'; text: string };

// Longest-common-subsequence over blocks → a sequence of ops.
function diffBlocks(a: string[], b: string[]): Op[] {
  const m = a.length, n = b.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { ops.push({ type: 'same', text: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { ops.push({ type: 'del', text: a[i] }); i++; }
    else { ops.push({ type: 'ins', text: b[j] }); j++; }
  }
  while (i < m) { ops.push({ type: 'del', text: a[i] }); i++; }
  while (j < n) { ops.push({ type: 'ins', text: b[j] }); j++; }
  return ops;
}

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

export function toTrackedMarkdown(baseMd: string, headMd: string, author: string, date: string): string {
  const ops = diffBlocks(blocks(baseMd), blocks(headMd));
  const out: string[] = [];
  let counter = 0;
  for (const op of ops) {
    if (op.type === 'same') { out.push(op.text); continue; }
    const id = `pr${++counter}`;
    const kind = op.type === 'del' ? 'del' : 'ins';
    out.push(`<span data-markov="${kind}" data-change-id="${id}" data-author="${esc(author)}" data-date="${esc(date)}">${op.text}</span>`);
  }
  return out.join('\n\n') + '\n';
}
