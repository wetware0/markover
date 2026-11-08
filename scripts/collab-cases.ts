/**
 * Headless behaviour tests for track changes and comments: drives the real
 * track-changes plugin (with prosemirror-history) through EditorState
 * transactions that mirror what the view produces for typing, Backspace,
 * Delete, typing over a selection, undo and paste. Invoked from
 * scripts/roundtrip-test.ts, which owns the JSDOM + schema setup.
 */
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { history, undo, redo } from '@tiptap/pm/history';
import { splitBlock, joinBackward, joinForward } from '@tiptap/pm/commands';
import { splitListItem } from '@tiptap/pm/schema-list';
import { addRowAfter, addColumnAfter, deleteRow, deleteColumn, deleteTable } from '@tiptap/pm/tables';
import { Slice, Fragment } from '@tiptap/pm/model';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import {
  createTrackChangesPlugin,
  stripCollaborationMarksFromSlice,
  movedCommentIds,
  trackNetChange,
} from '../src/renderer/editor/extensions/track-changes-plugin';
import type { TrackChangesConfig } from '../src/renderer/editor/extensions/track-changes-plugin';
import {
  collectChanges,
  resolveChanges,
  publishDoc,
  anchoredCommentIds,
  commentRange,
  commentIdAt,
} from '../src/renderer/collaboration/track-changes/track-changes-ops';
import { prosemirrorToMarkdown } from '../src/renderer/editor/markdown/serializer';

export interface CollabContext {
  schema: Schema;
  /** markdown (with markover markup) → ProseMirror doc, via the real parser */
  parse: (md: string) => PMNode;
  record: (name: string, error: string | null) => void;
}

class Session {
  state: EditorState;
  config: TrackChangesConfig = { enabled: true, author: 'Alice' };
  untracked = 0;
  private seq = 0;

  constructor(doc: PMNode) {
    this.state = EditorState.create({
      doc,
      plugins: [
        history(),
        createTrackChangesPlugin(() => this.config, {
          today: () => '2026-01-01',
          newId: () => `c${++this.seq}`,
          onUntrackedEdit: () => { this.untracked++; },
        }),
      ],
    });
  }

  dispatch = (tr: Transaction) => { this.state = this.state.apply(tr); };

  /** Put the caret at the end of the text `needle` (first occurrence), or select it. */
  find(needle: string): { from: number; to: number } {
    // Search per textblock so a needle may span differently-marked text nodes.
    let found: { from: number; to: number } | null = null;
    this.state.doc.descendants((n, pos) => {
      if (found) return false;
      if (!n.isTextblock) return true;
      const i = n.textContent.indexOf(needle);
      if (i >= 0) found = { from: pos + 1 + i, to: pos + 1 + i + needle.length };
      return false;
    });
    if (!found) throw new Error(`text ${JSON.stringify(needle)} not found in ${JSON.stringify(this.state.doc.textContent)}`);
    return found;
  }
  caret(pos: number) { this.dispatch(this.state.tr.setSelection(TextSelection.create(this.state.doc, pos))); }
  caretAfter(needle: string) { this.caret(this.find(needle).to); }
  caretBefore(needle: string) { this.caret(this.find(needle).from); }
  select(needle: string) {
    const r = this.find(needle);
    this.dispatch(this.state.tr.setSelection(TextSelection.create(this.state.doc, r.from, r.to)));
  }
  selectRange(from: number, to: number) {
    this.dispatch(this.state.tr.setSelection(TextSelection.create(this.state.doc, from, to)));
  }
  /** Each character is its own transaction, like slow typing. */
  type(text: string) { for (const ch of text) this.dispatch(this.state.tr.insertText(ch)); }
  backspace(n = 1) {
    for (let i = 0; i < n; i++) {
      const { from, to, empty } = this.state.selection;
      this.dispatch(empty ? this.state.tr.delete(from - 1, from) : this.state.tr.delete(from, to));
    }
  }
  del(n = 1) {
    for (let i = 0; i < n; i++) {
      const { from, to, empty } = this.state.selection;
      this.dispatch(empty ? this.state.tr.delete(from, from + 1) : this.state.tr.delete(from, to));
    }
  }
  undo() { undo(this.state, this.dispatch); }
  redo() { redo(this.state, this.dispatch); }
  changes() { return collectChanges(this.state.doc); }
  ins() { return this.changes().filter((c) => c.type === 'insertion'); }
  dels() { return this.changes().filter((c) => c.type === 'deletion'); }
  text() { return this.state.doc.textContent; }
  md() { return toMd(this.state.doc); }
}

function toMd(doc: PMNode): string {
  return prosemirrorToMarkdown(doc).replace(/\s+$/, '\n');
}

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) throw new Error(`${label}: expected ${w}, got ${g}`);
}

export function runCollabCases(ctx: CollabContext) {
  const { parse, schema } = ctx;
  const cases: Array<[string, () => void]> = [];
  const test = (name: string, fn: () => void) => cases.push([name, fn]);
  const summary = (s: Session) => s.changes().map((c) => `${c.type[0]}:${c.author}:${c.text}`);

  // --- insertion coalescing ---------------------------------------------

  test('tc: slow per-keystroke typing is ONE insertion', () => {
    const s = new Session(parse('Start.\n'));
    s.caretAfter('Start.');
    s.type(' hello world');
    eq('changes', summary(s), ['i:Alice: hello world']);
  });

  test('tc: typo correction mid-word stays ONE insertion', () => {
    const s = new Session(parse('Start.\n'));
    s.caretAfter('Start.');
    s.type(' helo');
    s.backspace();
    s.type('lo world');
    eq('text', s.text(), 'Start. hello world');
    eq('changes', summary(s), ['i:Alice: hello world']);
  });

  test('tc: moving away and back to the edge of own insertion extends it', () => {
    const s = new Session(parse('Alpha beta.\n'));
    s.caretAfter('Alpha');
    s.type(' one');
    s.caret(1);
    s.caretAfter('Alpha one');
    s.type(' two');
    s.caretBefore(' one two');
    s.type('!');
    eq('changes', summary(s), ['i:Alice:! one two']);
  });

  test('tc: typing inside own insertion keeps one id', () => {
    const s = new Session(parse('X\n'));
    s.caretAfter('X');
    s.type('helo');
    s.caret(s.find('helo').from + 3);
    s.type('l');
    eq('changes', summary(s), ['i:Alice:hello']);
  });

  test('tc: different authors stay separate even when adjacent', () => {
    const s = new Session(parse('X\n'));
    s.caretAfter('X');
    s.type('aaa');
    s.config.author = 'Bob';
    s.type('bbb');
    eq('changes', summary(s), ['i:Alice:aaa', 'i:Bob:bbb']);
  });

  test('tc: typing inside another author\'s insertion does not nest marks', () => {
    const s = new Session(parse('X\n'));
    s.caretAfter('X');
    s.type('aaaa');
    s.config.author = 'Bob';
    s.caret(s.find('aaaa').from + 2);
    s.type('b');
    const marksOnB = must(s.state.doc.nodeAt(s.find('b').from)).marks.map((m) => `${m.type.name}:${m.attrs.author}`);
    eq('marks on b', marksOnB, ['markovInsert:Bob']);
    eq('authors', s.ins().map((c) => c.author).sort(), ['Alice', 'Bob']);
  });

  test('tc: toggling tracking off mid-edit leaves later text untracked', () => {
    const s = new Session(parse('X\n'));
    s.caretAfter('X');
    s.type('on');
    s.config.enabled = false;
    s.type('off');
    s.config.enabled = true;
    s.type('again');
    eq('changes', summary(s), ['i:Alice:on', 'i:Alice:again']);
    eq('text', s.text(), 'Xonoffagain');
  });

  // --- deletion coalescing ----------------------------------------------

  test('tc: backspacing a word is ONE deletion, caret before the ghost', () => {
    const s = new Session(parse('Keep this word\n'));
    s.caretAfter('word');
    s.backspace(4);
    eq('text', s.text(), 'Keep this word');
    eq('changes', summary(s), ['d:Alice:word']);
    eq('caret', s.state.selection.from, s.find('word').from);
    s.type('text');
    eq('text after typing', s.text(), 'Keep this textword');
    eq('changes after typing', summary(s), ['i:Alice:text', 'd:Alice:word']);
  });

  test('tc: forward-deleting a word is ONE deletion, caret after the ghost', () => {
    const s = new Session(parse('word stays\n'));
    s.caretBefore('word');
    s.del(5);
    eq('changes', summary(s), ['d:Alice:word ']);
    eq('caret', s.state.selection.from, s.find('stays').from);
  });

  test('tc: Backspace over existing ghost text skips it and extends the deletion', () => {
    const s = new Session(parse('abc def\n'));
    s.caretAfter('def');
    s.backspace(3);
    s.caretAfter('def'); // caret back after the ghost
    s.backspace();
    eq('text', s.text(), 'abc def');
    eq('changes', summary(s), ['d:Alice: def']);
    eq('caret', s.state.selection.from, s.find(' def').from);
  });

  test('tc: deleting own pending insertion removes it outright', () => {
    const s = new Session(parse('X\n'));
    s.caretAfter('X');
    s.type('abcd');
    s.backspace(2);
    eq('text', s.text(), 'Xab');
    eq('changes', summary(s), ['i:Alice:ab']);
  });

  test('tc: range delete over own insertion + original text', () => {
    const s = new Session(parse('Hello\n'));
    s.caretAfter('Hello');
    s.type(' big');
    s.select('lo big');
    s.del();
    eq('text', s.text(), 'Hello');
    eq('changes', summary(s), ['d:Alice:lo']);
  });

  test('tc: deleting another author\'s insertion marks it deleted', () => {
    const s = new Session(parse('X\n'));
    s.caretAfter('X');
    s.type('bob');
    s.config.author = 'Carol';
    s.select('bob');
    s.del();
    eq('text', s.text(), 'Xbob');
    const marks = must(s.state.doc.nodeAt(s.find('bob').from)).marks.map((m) => `${m.type.name}:${m.attrs.author}`).sort();
    eq('marks', marks, ['markovDelete:Carol', 'markovInsert:Alice']);
  });

  test('tc: typing over a selection = adjacent deletion then insertion', () => {
    const s = new Session(parse('The cat sat\n'));
    s.select('cat');
    s.type('dog');
    eq('text', s.text(), 'The catdog sat');
    eq('changes', summary(s), ['d:Alice:cat', 'i:Alice:dog']);
    eq('caret', s.state.selection.from, s.find('dog').to);
  });

  test('tc: deletion keeps formatting and comment highlight of the ghost text', () => {
    const s = new Session(parse('A <span data-markov="hl" data-comment-id="k1">**bold**</span> word\n'));
    s.select('bold');
    s.del();
    const node = must(s.state.doc.nodeAt(s.find('bold').from));
    eq('marks', node.marks.map((m) => m.type.name).sort(), ['bold', 'markovDelete', 'markovHighlight']);
    eq('anchored', [...anchoredCommentIds(s.state.doc)], ['k1']);
  });

  test('tc: deletion across paragraphs restores structure as ONE change', () => {
    const s = new Session(parse('First para\n\nSecond para\n'));
    s.selectRange(s.find('para').from, s.find('Second').to);
    s.del();
    eq('blocks', s.state.doc.childCount, 2);
    eq('text', s.text(), 'First paraSecond para');
    eq('changes', summary(s), ['d:Alice:para ¶ Second']);
    const accepted = s.state.apply(resolveChanges(s.state, null, 'accept'));
    eq('accepted', accepted.doc.textContent, 'First  para');
    eq('accepted blocks', accepted.doc.childCount, 1);
    const rejected = s.state.apply(resolveChanges(s.state, null, 'reject'));
    eq('rejected md', toMd(rejected.doc), 'First para\n\nSecond para\n');
  });

  test('tc: deleting a whole paragraph then accepting leaves no empty line', () => {
    const s = new Session(parse('Keep\n\nDrop me\n\nTail\n'));
    const r = s.find('Drop me');
    s.selectRange(r.from - 1, r.to + 1);
    s.del();
    eq('blocks during review', s.state.doc.childCount, 3);
    const accepted = s.state.apply(resolveChanges(s.state, null, 'accept'));
    eq('accepted md', toMd(accepted.doc), 'Keep\n\nTail\n');
  });

  // --- tracked inline atoms (math, footnote refs) ------------------------

  const reopenEq = (s: Session) => {
    const reopened = collectChanges(parse(s.md()));
    eq('reopened', reopened.map((c) => [c.id, c.type, c.author, c.text]), s.changes().map((c) => [c.id, c.type, c.author, c.text]));
  };
  const accepted = (s: Session) => toMd(s.state.apply(resolveChanges(s.state, null, 'accept')).doc);
  const rejected = (s: Session) => toMd(s.state.apply(resolveChanges(s.state, null, 'reject')).doc);

  test('atoms: deleted inline math keeps its markup on save and reload', () => {
    const s = new Session(parse('Sum $x^2$ end\n'));
    // (find() offsets ignore the atom, which takes one position)
    s.selectRange(s.find('Sum').to, s.find(' end').from + 1);
    s.del();
    eq('changes', summary(s), ['d:Alice: [katexInline]']);
    eq('md', s.md(), 'Sum<span data-markov="del" data-change-id="c1" data-author="Alice" data-date="2026-01-01"> $x^2$</span> end\n');
    reopenEq(s);
    eq('reject', rejected(s), 'Sum $x^2$ end\n');
    eq('accept', accepted(s), 'Sum end\n');
  });

  test('atoms: inserted inline math and footnote ref round-trip as one insertion', () => {
    const s = new Session(parse('Text[^1] here.\n\n[^1]: Note.\n'));
    s.caretAfter('here');
    s.type(' ');
    s.dispatch(s.state.tr.replaceSelectionWith(schema.nodes.katexInline.create({ math: 'a+b' })));
    s.dispatch(s.state.tr.replaceSelectionWith(schema.nodes.footnoteRef.create({ id: '1', label: '1' })));
    eq('changes', summary(s), ['i:Alice: [katexInline][footnoteRef]']);
    eq('one span', (s.md().match(/data-markov="ins"/g) ?? []).length, 1);
    reopenEq(s);
    eq('reject', rejected(s).split('\n')[0], 'Text[^1] here.');
  });

  test('atoms: Backspace over a ghost inline atom extends the deletion', () => {
    const s = new Session(parse('ab $x$ cd\n'));
    s.caret(s.find('ab ').to + 1); // after the atom
    s.backspace(2);
    eq('text', s.text(), 'ab  cd');
    eq('changes', summary(s), ['d:Alice: [katexInline]']);
  });

  test('atoms: comment on inline math survives save and reload', () => {
    const s = new Session(parse('See <span data-markov="hl" data-comment-id="k1">$e=mc^2$ here</span> now\n'));
    eq('md', s.md(), 'See <span data-markov="hl" data-comment-id="k1">$e=mc^2$ here</span> now\n');
    eq('anchored', [...anchoredCommentIds(parse(s.md()))], ['k1']);
  });

  // --- code, math and Mermaid blocks --------------------------------------

  const CODE = 'Intro\n\n```js\ncode here\n```\n\nOutro\n';

  test('blocks: editing a code block keeps the original as a deleted block', () => {
    const s = new Session(parse(CODE));
    s.caretAfter('code');
    s.backspace();
    s.type('e!');
    eq('untracked events', s.untracked, 0);
    eq('changes', summary(s), ['d:Alice:[Code block] code here', 'i:Alice:[Code block] code! here']);
    reopenEq(s);
    eq('accept', accepted(s), 'Intro\n\n```js\ncode! here\n```\n\nOutro\n');
    eq('reject', rejected(s), CODE);
  });

  test('blocks: undo of a code block edit restores the plain block', () => {
    const s = new Session(parse(CODE));
    s.caretAfter('code');
    s.type('X');
    s.undo();
    eq('md', s.md(), CODE);
  });

  test('blocks: deleting a whole code block is tracked; accept/reject', () => {
    const s = new Session(parse(CODE));
    const r = s.find('code here');
    s.selectRange(r.from - 1, r.to + 1);
    s.del();
    eq('changes', summary(s), ['d:Alice:[Code block] code here']);
    reopenEq(s);
    eq('accept', accepted(s), 'Intro\n\nOutro\n');
    eq('reject', rejected(s), CODE);
  });

  test('blocks: deletion across text and a code block is ONE change', () => {
    const s = new Session(parse(CODE));
    s.selectRange(s.find('tro').from, s.find('Out').to);
    s.del();
    eq('changes', summary(s), ['d:Alice:tro ¶ [Code block] code here ¶ Out']);
    eq('untracked', s.untracked, 0);
    eq('reject', rejected(s), CODE);
    eq('accept', accepted(s), 'Inro\n');
  });

  const nodeDelete = (s: Session, typeName: string) => {
    let at = -1;
    s.state.doc.descendants((n, p) => { if (n.type.name === typeName && at < 0) at = p; return at < 0; });
    s.dispatch(s.state.tr.setSelection(NodeSelection.create(s.state.doc, at)));
    s.dispatch(s.state.tr.deleteSelection());
  };

  for (const [label, md, type, entry] of [
    ['math block', 'A\n\n$$\nx^2\n$$\n\nB\n', 'katexBlock', 'd:Alice:[Math block] x^2'],
    ['Mermaid diagram', 'A\n\n```mermaid\ngraph TD\n  a-->b\n```\n\nB\n', 'mermaidBlock', 'd:Alice:[Mermaid diagram] graph TD'],
    ['image', 'A\n\n![pic](img.png)\n\nB\n', 'image', 'd:Alice:[Image] pic'],
  ] as const) {
    test(`blocks: deleting a ${label} is tracked; save/reload; accept/reject`, () => {
      const s = new Session(parse(md));
      nodeDelete(s, type);
      eq('changes', summary(s), [entry]);
      eq('untracked', s.untracked, 0);
      reopenEq(s);
      eq('reject', rejected(s), md);
      eq('accept', accepted(s), 'A\n\nB\n');
    });
  }

  test('blocks: editing a math block from its editor = old deleted + new inserted', () => {
    const s = new Session(parse('A\n\n$$\nx^2\n$$\n'));
    let at = -1;
    s.state.doc.descendants((n, p) => { if (n.type.name === 'katexBlock') at = p; return true; });
    s.dispatch(s.state.tr.setNodeMarkup(at, undefined, { math: 'y^3' }));
    eq('changes', summary(s), ['d:Alice:[Math block] x^2', 'i:Alice:[Math block] y^3']);
    reopenEq(s);
    eq('reject', rejected(s), 'A\n\n$$\nx^2\n$$\n');
    eq('accept', accepted(s), 'A\n\n$$\ny^3\n$$\n');
  });

  test('blocks: inserting a code block is tracked; deleting your own removes it', () => {
    const s = new Session(parse('A\n\nB\n'));
    const pos = s.find('A').to + 1;
    s.dispatch(s.state.tr.insert(pos, schema.nodes.codeBlock.create({ language: 'py' }, schema.text('print(1)'))));
    eq('changes', summary(s), ['i:Alice:[Code block] print(1)']);
    s.caretAfter('print(1)');
    s.type('!');
    eq('free edits in own block', summary(s), ['i:Alice:[Code block] print(1)!']);
    reopenEq(s);
    eq('reject', rejected(s), 'A\n\nB\n');
    nodeDelete(s, 'codeBlock');
    eq('after delete', summary(s), []);
    eq('md', s.md(), 'A\n\nB\n');
  });

  test('blocks: publish applies pending block changes without markers', () => {
    const s = new Session(parse(CODE));
    s.caretAfter('code');
    s.type('X');
    const out = toMd(publishDoc(s.state.doc));
    eq('published', out, 'Intro\n\n```js\ncodeX here\n```\n\nOutro\n');
  });

  // --- paragraph splits and joins -----------------------------------------

  test('para: Enter is a tracked split; reject joins, accept keeps', () => {
    const s = new Session(parse('Hello world\n'));
    s.caretAfter('Hello');
    splitBlock(s.state, s.dispatch);
    eq('blocks', s.state.doc.childCount, 2);
    eq('changes', summary(s), ['i:Alice:¶']);
    reopenEq(s);
    eq('reject', rejected(s), 'Hello world\n');
    eq('accept', accepted(s), 'Hello\n\n world\n');
    // Markdown drops the space at the break on save; the change keeps it.
    const reloaded = new Session(parse(s.md()));
    eq('reloaded text', reloaded.state.doc.lastChild?.textContent, 'world');
    eq('reject after reload', rejected(reloaded), 'Hello world\n');
  });

  test('para: typing, Enter, typing is ONE insertion; reject restores', () => {
    const s = new Session(parse('Start\n'));
    s.caretAfter('Start');
    s.type(' more');
    splitBlock(s.state, s.dispatch);
    s.type('next');
    eq('changes', summary(s), ['i:Alice: more ¶ next']);
    reopenEq(s);
    eq('reject', rejected(s), 'Start\n');
    eq('accept', accepted(s), 'Start more\n\nnext\n');
  });

  test('para: Enter on an empty line survives save', () => {
    const s = new Session(parse('One\n'));
    s.caretAfter('One');
    splitBlock(s.state, s.dispatch);
    eq('changes', summary(s), ['i:Alice:¶']);
    eq('blocks after reload', parse(s.md()).childCount, 2);
    reopenEq(s);
    eq('reject', rejected(s), 'One\n');
  });

  test('para: Backspace at paragraph start is a tracked join', () => {
    const s = new Session(parse('One\n\nTwo\n'));
    s.caretBefore('Two');
    joinBackward(s.state, s.dispatch);
    eq('blocks', s.state.doc.childCount, 2);
    eq('changes', summary(s), ['d:Alice:¶']);
    eq('caret at end of One', s.state.selection.from, s.find('One').to);
    reopenEq(s);
    eq('accept', accepted(s), 'OneTwo\n');
    eq('reject', rejected(s), 'One\n\nTwo\n');
    s.backspace();
    eq('next Backspace deletes a character', summary(s), ['d:Alice:e ¶']);
  });

  test('para: Delete at paragraph end is a tracked join; caret moves on', () => {
    const s = new Session(parse('One\n\nTwo\n'));
    s.caretAfter('One');
    joinForward(s.state, s.dispatch);
    eq('blocks', s.state.doc.childCount, 2);
    eq('caret at start of Two', s.state.selection.from, s.find('Two').from);
    eq('accept', accepted(s), 'OneTwo\n');
  });

  test('para: removing an empty paragraph is tracked', () => {
    const s = new Session(parse('One\n'));
    s.config.enabled = false;
    s.caretAfter('One');
    splitBlock(s.state, s.dispatch);
    s.type('Two');
    s.caretBefore('Two');
    splitBlock(s.state, s.dispatch); // One / (empty) / Two
    s.config.enabled = true;
    s.caret(s.find('Two').from - 2); // inside the empty paragraph
    joinBackward(s.state, s.dispatch);
    eq('blocks', s.state.doc.childCount, 3);
    eq('changes', summary(s), ['d:Alice:¶']);
    eq('accept', accepted(s), 'One\n\nTwo\n');
  });

  test('para: joining away your own split is a real join', () => {
    const s = new Session(parse('Hello world\n'));
    s.caretAfter('Hello');
    splitBlock(s.state, s.dispatch);
    joinBackward(s.state, s.dispatch);
    eq('changes', summary(s), []);
    eq('md', s.md(), 'Hello world\n');
  });

  test('para: heading split and list item split reject to the original', () => {
    const h = new Session(parse('# Title here\n'));
    h.caretAfter('Title');
    splitBlock(h.state, h.dispatch);
    eq('heading changes', summary(h).length, 1);
    reopenEq(h);
    eq('heading reject', rejected(h), '# Title here\n');
    const l = new Session(parse('- one two\n- three\n'));
    l.caretAfter('one');
    splitListItem(schema.nodes.listItem)(l.state, l.dispatch);
    eq('list items', l.state.doc.firstChild?.childCount, 3);
    eq('list changes', summary(l), ['i:Alice:¶']);
    reopenEq(l);
    eq('list reject', rejected(l), '- one two\n- three\n');
    eq('list accept', accepted(l), '- one\n-  two\n- three\n');
  });

  // --- undo / redo --------------------------------------------------------

  test('tc: undo of tracked typing leaves no orphan marks; redo restores', () => {
    const s = new Session(parse('Base\n'));
    s.caretAfter('Base');
    s.type(' added');
    s.undo();
    eq('text after undo', s.text(), 'Base');
    eq('changes after undo', summary(s), []);
    s.redo();
    eq('changes after redo', summary(s), ['i:Alice: added']);
  });

  test('tc: undo of tracked deletion restores plain text', () => {
    const s = new Session(parse('Remove me\n'));
    s.caretAfter('me');
    s.backspace(2);
    // Each step back is a consistent state: never a half-applied ghost.
    s.undo();
    eq('text after 1st undo', s.text(), 'Remove me');
    eq('changes after 1st undo', summary(s), ['d:Alice:e']);
    s.undo();
    eq('text', s.text(), 'Remove me');
    eq('changes', summary(s), []);
    eq('md', s.md(), 'Remove me\n');
  });

  // --- accept / reject ----------------------------------------------------

  test('tc: accept/reject a single change by id', () => {
    const s = new Session(parse('One two\n'));
    s.caretAfter('two');
    s.type(' three');
    s.caretBefore('One');
    s.del(4);
    const [del] = s.dels();
    const [ins] = s.ins();
    s.dispatch(resolveChanges(s.state, new Set([del.id]), 'reject'));
    eq('after reject del', summary(s), ['i:Alice: three']);
    s.dispatch(resolveChanges(s.state, new Set([ins.id]), 'accept'));
    eq('after accept ins', summary(s), []);
    eq('md', s.md(), 'One two three\n');
  });

  test('tc: accept all and reject all are inverse outcomes', () => {
    const s = new Session(parse('The cat sat\n'));
    s.select('cat');
    s.type('dog');
    const a = s.state.apply(resolveChanges(s.state, null, 'accept'));
    const r = s.state.apply(resolveChanges(s.state, null, 'reject'));
    eq('accept', toMd(a.doc), 'The dog sat\n');
    eq('reject', toMd(r.doc), 'The cat sat\n');
  });

  test('tc: accepting a word deletion in a table cell keeps the table', () => {
    const s = new Session(parse('| A | B |\n| --- | --- |\n| one two | x |\n'));
    s.select('two');
    s.del();
    const a = s.state.apply(resolveChanges(s.state, null, 'accept'));
    eq('table kept', a.doc.firstChild?.type.name, 'table');
    eq('text', a.doc.textContent, 'ABone x');
  });

  test('tc: change list concatenates text across formatting', () => {
    const s = new Session(parse('plain **bold** tail\n'));
    s.selectRange(s.find('plain').to, s.find(' tail').from);
    s.del();
    eq('changes', summary(s), ['d:Alice: bold']);
  });

  // --- table structure ----------------------------------------------------

  const TABLE = '| A | B | C |\n| --- | --- | --- |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n';
  const grid = (doc: PMNode) => {
    const rows: string[] = [];
    doc.descendants((n) => {
      if (n.type.name !== 'tableRow') return true;
      const cells: string[] = [];
      n.forEach((c) => cells.push(c.textContent || '_'));
      rows.push(cells.join(','));
      return false;
    });
    return rows.join(' / ');
  };
  const tableCase = (
    name: string,
    cmd: (st: EditorState, d: (tr: Transaction) => void) => boolean,
    want: { during: string; label: string; accepted: string; rejected: string },
  ) => {
    test(`table: ${name} is one tracked change; accept/reject`, () => {
      const s = new Session(parse(TABLE));
      s.caretAfter('b1');
      eq('command ran', cmd(s.state, s.dispatch), true);
      eq('grid during review', grid(s.state.doc), want.during);
      const changes = s.changes();
      eq('one change', changes.length, 1);
      eq('kind', changes[0].type[0], want.label);
      eq('accepted', grid(s.state.apply(resolveChanges(s.state, new Set([changes[0].id]), 'accept')).doc), want.accepted);
      eq('rejected', grid(s.state.apply(resolveChanges(s.state, new Set([changes[0].id]), 'reject')).doc), want.rejected);
      // Pending state survives save → reopen.
      const reopened = collectChanges(parse(s.md()));
      eq('reopened', reopened.map((c) => [c.id, c.type, c.author, c.text]), changes.map((c) => [c.id, c.type, c.author, c.text]));
    });
  };
  const ORIGINAL = 'A,B,C / a1,b1,c1 / a2,b2,c2';
  tableCase('insert row', addRowAfter, {
    during: 'A,B,C / a1,b1,c1 / _,_,_ / a2,b2,c2', label: 'i', accepted: 'A,B,C / a1,b1,c1 / _,_,_ / a2,b2,c2', rejected: ORIGINAL,
  });
  tableCase('insert column', addColumnAfter, {
    during: 'A,B,_,C / a1,b1,_,c1 / a2,b2,_,c2', label: 'i', accepted: 'A,B,_,C / a1,b1,_,c1 / a2,b2,_,c2', rejected: ORIGINAL,
  });
  tableCase('delete row', deleteRow, {
    during: ORIGINAL, label: 'd', accepted: 'A,B,C / a2,b2,c2', rejected: ORIGINAL,
  });
  tableCase('delete column', deleteColumn, {
    during: ORIGINAL, label: 'd', accepted: 'A,C / a1,c1 / a2,c2', rejected: ORIGINAL,
  });
  tableCase('delete table', deleteTable, {
    during: ORIGINAL, label: 'd', accepted: '', rejected: ORIGINAL,
  });

  test('table: change labels name the unit', () => {
    const labels: string[] = [];
    for (const cmd of [addRowAfter, addColumnAfter, deleteRow, deleteColumn, deleteTable]) {
      const s = new Session(parse(TABLE));
      s.caretAfter('b1');
      cmd(s.state, s.dispatch);
      labels.push(s.changes()[0].text);
    }
    eq('labels', labels, [
      'Table row: _ | _ | _'.replace(/_/g, ''),
      'Table column:  |  | ',
      'Table row: a1 | b1 | c1',
      'Table column: B | b1 | b2',
      'Table: A | B | C | a1 | b1 | c1 | a2 | b2 | c2',
    ]);
  });

  test('table: deleting a row you inserted removes it outright', () => {
    const s = new Session(parse(TABLE));
    s.caretAfter('b1');
    addRowAfter(s.state, s.dispatch);
    // Caret into the first cell of the inserted row (doc > table > row > cell > p).
    const $b1 = s.state.doc.resolve(s.find('b1').from);
    s.caret($b1.after($b1.depth - 2) + 3);
    deleteRow(s.state, s.dispatch);
    eq('grid', grid(s.state.doc), ORIGINAL);
    eq('changes', s.changes().length, 0);
  });

  test('table: column inserted across a pending row deletion goes with that row', () => {
    const s = new Session(parse(TABLE));
    s.caretAfter('b1');
    deleteRow(s.state, s.dispatch);
    s.caretAfter('b2');
    addColumnAfter(s.state, s.dispatch);
    eq('changes', s.changes().map((c) => c.type).sort(), ['deletion', 'insertion']);
    const accepted = s.state.apply(resolveChanges(s.state, null, 'accept'));
    eq('accept all', grid(accepted.doc), 'A,B,_,C / a2,b2,_,c2');
    const rejected = s.state.apply(resolveChanges(s.state, null, 'reject'));
    eq('reject all', grid(rejected.doc), ORIGINAL);
  });

  test('table: undo of a tracked column delete restores the plain table', () => {
    const s = new Session(parse(TABLE));
    s.caretAfter('b1');
    deleteColumn(s.state, s.dispatch);
    s.undo();
    eq('grid', grid(s.state.doc), ORIGINAL);
    eq('changes', s.changes().length, 0);
  });

  test('table: publish applies pending row deletion', () => {
    const s = new Session(parse(TABLE));
    s.caretAfter('b1');
    deleteRow(s.state, s.dispatch);
    eq('published', grid(publishDoc(s.state.doc)), 'A,B,C / a2,b2,c2');
    eq('no markers', toMd(publishDoc(s.state.doc)).includes('data-markov'), false);
  });

  // --- persistence --------------------------------------------------------

  test('tc: coalesced marks round-trip with ids, authors, dates', () => {
    const s = new Session(parse('Base text here\n'));
    s.config.author = 'Ann "AJ" & Co';
    s.caretAfter('here');
    s.type(' more');
    s.caretAfter('text');
    s.backspace(4);
    const md = s.md();
    const reopened = collectChanges(parse(md));
    eq('reopened', reopened.map((c) => [c.id, c.type, c.author, c.date, c.text]),
      s.changes().map((c) => [c.id, c.type, c.author, c.date, c.text]));
    eq('one span per change', (md.match(/data-markov="(ins|del)"/g) ?? []).length, 2);
  });

  // --- comments -----------------------------------------------------------

  test('cm: typing inside a highlight keeps it in one piece', () => {
    const s = new Session(parse('Say <span data-markov="hl" data-comment-id="k1">hello there</span> now\n'));
    s.config.enabled = false;
    s.caret(s.find('hello').to);
    s.type(',');
    const r = must(commentRange(s.state.doc, 'k1'));
    eq('highlighted text', s.state.doc.textBetween(r.from, r.to), 'hello, there');
    eq('one span', (s.md().match(/data-markov="hl"/g) ?? []).length, 1);
  });

  test('cm: typing at the edge of a highlight does not extend it', () => {
    const s = new Session(parse('Say <span data-markov="hl" data-comment-id="k1">hello</span> now\n'));
    s.config.enabled = false;
    s.caretAfter('hello');
    s.type('!');
    const r = must(commentRange(s.state.doc, 'k1'));
    eq('highlighted text', s.state.doc.textBetween(r.from, r.to), 'hello');
  });

  test('cm: comment over a tracked insertion serializes nested spans and reloads', () => {
    const s = new Session(parse('Base\n'));
    s.caretAfter('Base');
    s.type(' added text');
    s.select('added');
    s.dispatch(s.state.tr.addMark(s.state.selection.from, s.state.selection.to, schema.marks.markovHighlight.create({ commentId: 'k2' })));
    const md = s.md();
    const re = parse(md);
    eq('comment anchored after reload', [...anchoredCommentIds(re)], ['k2']);
    eq('changes after reload', collectChanges(re).map((c) => c.text), [' added text']);
  });

  test('cm: deleting all commented text (untracked) orphans the thread', () => {
    const s = new Session(parse('Say <span data-markov="hl" data-comment-id="k1">hello</span> now\n'));
    s.config.enabled = false;
    s.select('hello');
    s.del();
    eq('anchored', [...anchoredCommentIds(s.state.doc)], []);
  });

  test('cm: caret lookup finds the comment under the cursor', () => {
    const doc = parse('Say <span data-markov="hl" data-comment-id="k1">hello</span> now\n');
    const s = new Session(doc);
    eq('inside', commentIdAt(s.state.doc, s.find('hello').from + 2), 'k1');
    eq('outside', commentIdAt(s.state.doc, s.find('now').to), null);
  });

  // --- publish & paste ----------------------------------------------------

  test('publish: accepts changes and strips nested highlight/ins/del spans', () => {
    const doc = parse(
      'A <span data-markov="ins" data-change-id="i1" data-author="A" data-date="2026-01-01"><span data-markov="hl" data-comment-id="k1">new</span> text</span>' +
      ' <span data-markov="del" data-change-id="d1" data-author="A" data-date="2026-01-01">old <span data-markov="hl" data-comment-id="k2">gone</span></span>end\n',
    );
    const out = toMd(publishDoc(doc));
    eq('published', out, 'A new text end\n');
  });

  test('paste: collaboration marks and ghost text are stripped', () => {
    const ins = schema.marks.markovInsert.create({ changeId: 'i1', author: 'A', date: 'd' });
    const del = schema.marks.markovDelete.create({ changeId: 'd1', author: 'A', date: 'd' });
    const hl = schema.marks.markovHighlight.create({ commentId: 'k1' });
    const bold = schema.marks.bold.create();
    const para = schema.nodes.paragraph.create(null, [
      schema.text('kept ', [ins, hl]),
      schema.text('gone', [del]),
      schema.text('bold', [bold, ins]),
    ]);
    const out = stripCollaborationMarksFromSlice(new Slice(Fragment.from(para), 1, 1), schema);
    const p = must(out.content.firstChild);
    eq('text', p.textContent, 'kept bold');
    const marks: string[] = [];
    p.forEach((n) => n.marks.forEach((m) => marks.push(m.type.name)));
    eq('marks', marks, ['bold']);
  });

  // --- IME composition ----------------------------------------------------

  test('ime: a composition is tracked as its net change, not its steps', () => {
    // While composing the plugin defers; afterwards it tracks start → end.
    // Intermediate steps replace text the composition itself inserted.
    const cfg: TrackChangesConfig = { enabled: true, author: 'Alice' };
    let seq = 0;
    const opts = { today: () => '2026-01-01', newId: () => `c${++seq}` };
    const start = EditorState.create({ doc: parse('The cat sat\n') });
    const sel = (st: EditorState, from: number, to: number) => st.apply(st.tr.setSelection(TextSelection.create(st.doc, from, to)));
    let st = sel(start, 5, 8); // "cat"
    const begin = st;
    for (const text of ['ね', 'ねこ', '猫']) {
      const { from, to } = st.selection;
      st = st.apply(st.tr.insertText(text, from, to));
      st = sel(st, 5, 5 + text.length);
    }
    const tr = must(trackNetChange(begin, st, cfg, opts));
    const done = st.apply(tr);
    eq('text', done.doc.textContent, 'The cat猫 sat');
    eq('changes', collectChanges(done.doc).map((c) => `${c.type[0]}:${c.text}`), ['d:cat', 'i:猫']);
    // Repeated characters: composing "a" after "a" is one insertion of "a".
    const s2 = EditorState.create({ doc: parse('aa\n') });
    const e2 = s2.apply(s2.tr.insertText('a', 3));
    const t2 = must(trackNetChange(s2, e2, cfg, opts));
    eq('repeat', collectChanges(e2.apply(t2).doc).map((c) => `${c.type[0]}:${c.text}`), ['i:a']);
  });

  // --- cut and paste keeps comments ---------------------------------------

  /** Cut the selection and paste it at `needle`'s end, as the view would. */
  const cutPaste = (s: Session, cut: string, pasteAfter: string) => {
    s.select(cut);
    const clip = s.state.doc.slice(s.state.selection.from, s.state.selection.to);
    s.dispatch(s.state.tr.deleteSelection());
    s.caretAfter(pasteAfter);
    const slice = stripCollaborationMarksFromSlice(clip, schema, movedCommentIds(clip, s.state.doc));
    s.dispatch(s.state.tr.replaceSelection(slice));
  };
  const COMMENTED = 'Start <span data-markov="hl" data-comment-id="k1">moved words</span> middle end\n';

  test('paste: cut and paste of commented text keeps the comment', () => {
    const s = new Session(parse(COMMENTED));
    s.config.enabled = false;
    cutPaste(s, 'moved words', 'end');
    eq('text', s.text(), 'Start  middle endmoved words');
    const r = must(commentRange(s.state.doc, 'k1'));
    eq('anchor', s.state.doc.textBetween(r.from, r.to), 'moved words');
  });

  test('paste: copy and paste of commented text does not duplicate the comment', () => {
    const s = new Session(parse(COMMENTED));
    s.config.enabled = false;
    s.select('moved words');
    const clip = s.state.doc.slice(s.state.selection.from, s.state.selection.to);
    s.caretAfter('end');
    s.dispatch(s.state.tr.replaceSelection(stripCollaborationMarksFromSlice(clip, schema, movedCommentIds(clip, s.state.doc))));
    const r = must(commentRange(s.state.doc, 'k1'));
    eq('anchor stays on the original', s.state.doc.textBetween(r.from, r.to), 'moved words');
  });

  test('paste: tracked cut and paste moves the comment with the text', () => {
    const s = new Session(parse(COMMENTED));
    cutPaste(s, 'moved words', 'end');
    eq('changes', summary(s), ['d:Alice:moved words', 'i:Alice:moved words']);
    // Accepting the move leaves the comment on the pasted text…
    const a = s.state.apply(resolveChanges(s.state, null, 'accept'));
    const ra = must(commentRange(a.doc, 'k1'));
    eq('after accept', a.doc.textBetween(ra.from, ra.to), 'moved words');
    eq('accepted text', a.doc.textContent, 'Start  middle endmoved words');
    // …and rejecting it leaves the comment where it was.
    const r = s.state.apply(resolveChanges(s.state, null, 'reject'));
    eq('after reject', toMd(r.doc), COMMENTED);
  });

  for (const [name, fn] of cases) {
    try {
      fn();
      ctx.record(name, null);
    } catch (err) {
      ctx.record(name, `${(err as Error).message}\n${(err as Error).stack ?? ''}`);
    }
  }
}
