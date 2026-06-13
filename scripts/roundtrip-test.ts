/**
 * Ad-hoc roundtrip review harness.
 *
 * Loads the real parser, serializer, and codec from the project, wires up the
 * same TipTap extension stack as use-editor.ts (minus React node views), and
 * runs a battery of markdown inputs through:
 *   markdown -> parseMarkoverFile -> markdownToHtml -> ProseMirror JSON
 *            -> Node.fromJSON -> prosemirrorToMarkdown -> serializeMarkoverFile
 *
 * Reports per-case status with a unified diff when the output drifts.
 */

import { JSDOM } from 'jsdom';

// JSDOM must be installed before importing anything that touches prosemirror DOMParser
const dom = new JSDOM('<!doctype html><html><body></body></html>');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = global as any;
g.window = dom.window;
g.document = dom.window.document;
g.DOMParser = dom.window.DOMParser;
g.Node = dom.window.Node;
g.HTMLElement = dom.window.HTMLElement;
g.Element = dom.window.Element;
g.navigator = dom.window.navigator;

import { generateJSON } from '@tiptap/html';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { MarkoverTaskList } from '../src/renderer/editor/extensions/markover-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Highlight from '@tiptap/extension-highlight';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';

import { MarkoverImage } from '../src/renderer/editor/extensions/image-editable';
import { MarkoverCodeBlock } from '../src/renderer/editor/extensions/code-block-lowlight';
import { KatexInline } from '../src/renderer/editor/extensions/katex-inline';
import { KatexBlock } from '../src/renderer/editor/extensions/katex-block';
import { MermaidBlock } from '../src/renderer/editor/extensions/mermaid-block';
import { FootnoteRef, FootnoteBlock } from '../src/renderer/editor/extensions/footnote';
import { FrontMatter } from '../src/renderer/editor/extensions/front-matter';
import { MarkovHighlight } from '../src/renderer/editor/extensions/markover-highlight';
import { MarkovInsert } from '../src/renderer/editor/extensions/markover-insert';
import { MarkovDelete } from '../src/renderer/editor/extensions/markover-delete';

import { markdownToHtml } from '../src/renderer/editor/markdown/parser';
import { prosemirrorToMarkdown } from '../src/renderer/editor/markdown/serializer';
import {
  parseMarkoverFile,
  serializeMarkoverFile,
} from '../src/shared/markover-codec';
import { Node as PMNode } from '@tiptap/pm/model';

// Mirror the editor stack from src/renderer/editor/use-editor.ts.
// Plain TableCell/TableHeader without the React-only AlignedTable extension
// (which uses parseHTML on real DOM nodes — jsdom handles that fine but we
// avoid React imports here).
const AlignedTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: null,
        parseHTML: (el: HTMLElement) => el.style.textAlign || null,
        renderHTML: (attrs: { align?: string | null }) =>
          attrs.align ? { style: `text-align: ${attrs.align}` } : {},
      },
    };
  },
});

const AlignedTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: null,
        parseHTML: (el: HTMLElement) => el.style.textAlign || null,
        renderHTML: (attrs: { align?: string | null }) =>
          attrs.align ? { style: `text-align: ${attrs.align}` } : {},
      },
    };
  },
});

const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    codeBlock: false,
  }),
  MarkoverCodeBlock,
  Underline,
  Link.configure({ openOnClick: false, autolink: true }),
  MarkoverImage,
  MarkoverTaskList,
  TaskItem.configure({ nested: true }),
  Highlight.configure({ multicolor: true }),
  Table.configure({ resizable: true }),
  TableRow,
  AlignedTableCell,
  AlignedTableHeader,
  KatexInline,
  KatexBlock,
  MermaidBlock,
  FootnoteRef,
  FootnoteBlock,
  FrontMatter,
  MarkovHighlight,
  MarkovInsert,
  MarkovDelete,
];

const schema = getSchema(extensions);

function roundtrip(rawMarkdown: string): string {
  const { cleanMarkdown, metadata } = parseMarkoverFile(rawMarkdown);
  const html = markdownToHtml(cleanMarkdown);
  const json = generateJSON(html, extensions);
  const doc = PMNode.fromJSON(schema, json);
  const out = prosemirrorToMarkdown(doc);
  return serializeMarkoverFile(out, metadata);
}

function serializeDoc(docJson: Record<string, unknown>): string {
  return prosemirrorToMarkdown(PMNode.fromJSON(schema, docJson));
}

interface Case {
  name: string;
  input: string;
  // Expected output after roundtrip. If omitted, we expect the input to roundtrip
  // verbatim (after a final newline is added by the serializer).
  expected?: string;
}

const cases: Case[] = [
  // === Basic inline formatting ===
  { name: 'plain text', input: 'hello world\n' },
  { name: 'bold (asterisks)', input: '**bold**\n' },
  { name: 'bold (underscores)', input: '__bold__\n', expected: '**bold**\n' },
  { name: 'italic (asterisks)', input: '*italic*\n', expected: '_italic_\n' },
  { name: 'italic (underscores)', input: '_italic_\n' },
  { name: 'strikethrough', input: '~~strike~~\n' },
  { name: 'inline code', input: '`code`\n' },
  { name: 'bold + italic', input: '**_both_**\n' },
  { name: 'italic with nested bold', input: '_italic **bold** italic_\n' },
  { name: 'bold mid-sentence', input: 'hello **bold** world\n' },
  { name: 'multiple bolds', input: '**one** plain **two**\n' },
  { name: 'bold at start', input: '**bold** then plain\n' },
  { name: 'bold at end', input: 'plain then **bold**\n' },
  { name: 'bold whole sentence', input: '**entire sentence is bold**\n' },
  { name: 'bold with selected trailing space', input: '**Bold **\n', expected: '**Bold** \n' },
  { name: 'bold with selected leading inter-word space', input: 'Hello** Bold**\n', expected: 'Hello **Bold**\n' },
  {
    name: 'escaped malformed bold from previous save',
    input: '\\*\\*Bold \\*\\*\n',
    expected: '**Bold** \n',
  },
  {
    name: 'escaped malformed bold with leading inter-word space from previous save',
    input: 'Hello\\*\\* Bold\\*\\*\n',
    expected: 'Hello **Bold**\n',
  },
  {
    name: 'text with literal asterisk',
    input: 'price\\*\n',
  },
  {
    name: 'plain word containing asterisk in middle',
    input: 'a\\*b\n',
  },
  { name: 'underline (HTML)', input: '<u>under</u>\n' },

  // === Headings ===
  { name: 'h1', input: '# Heading 1\n' },
  { name: 'h2', input: '## Heading 2\n' },
  { name: 'h3', input: '### Heading 3\n' },
  { name: 'h6', input: '###### Heading 6\n' },

  // === Lists ===
  { name: 'bullet list', input: '- one\n- two\n- three\n' },
  { name: 'ordered list', input: '1. one\n2. two\n3. three\n' },
  {
    name: 'task list',
    input: '- [ ] todo\n- [x] done\n',
  },
  {
    name: 'nested bullet list',
    input: '- outer\n  - inner\n  - inner2\n- outer2\n',
  },
  {
    name: 'loose list',
    input: '- item one\n\n  more text in item one\n\n- item two\n',
  },

  // === Block elements ===
  { name: 'blockquote', input: '> quoted\n' },
  { name: 'blockquote multi-line', input: '> line one\n> line two\n' },
  { name: 'horizontal rule', input: '---\n' },
  {
    name: 'fenced code block',
    input: '```js\nconst x = 1;\n```\n',
  },
  {
    name: 'fenced code block (no language)',
    input: '```\nplain code\n```\n',
  },

  // === Links and images ===
  { name: 'link', input: '[text](https://example.com)\n' },
  {
    name: 'link with title',
    input: '[text](https://example.com "Title")\n',
  },
  { name: 'image', input: '![alt](image.png)\n' },
  {
    name: 'image with title',
    input: '![alt](image.png "Title")\n',
  },

  // === Tables ===
  {
    name: 'simple table',
    input:
      '| H1 | H2 |\n| --- | --- |\n| A | B |\n| C | D |\n',
  },
  {
    name: 'aligned table',
    input:
      '| L | C | R |\n| :--- | :---: | ---: |\n| a | b | c |\n',
  },

  // === Math / Mermaid / Footnotes / Front matter ===
  { name: 'inline math', input: '$x^2$\n' },
  { name: 'block math', input: '$$\nx^2 + y^2 = z^2\n$$\n' },
  {
    name: 'mermaid block',
    input: '```mermaid\ngraph TD\nA-->B\n```\n',
  },
  {
    name: 'footnote',
    input: 'Reference[^1]\n\n[^1]: The footnote.\n',
  },
  {
    name: 'front matter',
    input: '---\ntitle: My Doc\nauthor: Peter\n---\n\nBody text.\n',
  },

  // === Markover codec ===
  {
    name: 'markover comment (file-level block)',
    input:
      'Hello world.\n\n<!-- markover:comment id="c1" author="Peter" date="2026-01-01" status="open" -->\nThis is a comment.\n<!-- /markover:comment -->\n',
  },
  {
    name: 'markover comment with reply',
    input:
      'Body.\n\n<!-- markover:comment id="c1" author="A" date="2026-01-01" status="open" -->\nQ?\n<!-- markover:reply id="r1" parent="c1" author="B" date="2026-01-02" -->\nA!\n<!-- /markover:reply -->\n<!-- /markover:comment -->\n',
  },
  {
    name: 'markover cspell:ignore',
    input: '<!-- cspell:ignore foo bar -->\n\nSome text with foo and bar.\n',
  },
  {
    name: 'markover file meta',
    input:
      'Body text.\n\n<!-- markover:meta\nversion: 1\nauthors:\n  - name: "Peter"\n    color: "#FF0000"\n-->\n',
  },
  {
    name: 'comment with quotes in author name',
    input:
      'Body.\n\n<!-- markover:comment id="c1" author="John &quot;JJ&quot; Smith" date="2026-01-01" status="open" -->\nNote.\n<!-- /markover:comment -->\n',
  },
  {
    name: 'markover inline highlight (comment ref)',
    input:
      'Before <span data-markov="hl" data-comment-id="c1">highlighted text</span> after.\n',
  },
  {
    name: 'markover tracked insertion',
    input:
      'Plain text <span data-markov="ins" data-change-id="i1" data-author="Peter" data-date="2026-01-01">inserted</span> here.\n',
  },
  {
    name: 'markover tracked deletion',
    input:
      'Plain text <span data-markov="del" data-change-id="d1" data-author="Peter" data-date="2026-01-01">deleted</span> here.\n',
  },

  // === Misc / realistic combinations ===
  {
    name: 'task list with multi-word labels',
    input: '- [ ] buy milk\n- [x] write code review\n',
  },
  {
    name: 'task list with bold label (issue #22)',
    input: '- [ ] **Task 1: Project scaffold**\n',
  },
  {
    name: 'task list with bold label and nested bullets (issue #22)',
    input: '- [ ] **Task 1: Project scaffold**\n  - Create the solution\n  - Add refs\n',
  },
  {
    name: 'two bold tasks each with nested bullets (issue #22)',
    input:
      '- [ ] **Task 1: Scaffold**\n  - Create solution\n\n- [ ] **Task 2: Settings**\n  - POCO with defaults\n',
  },
  {
    name: 'tight task list with nested bullets stays tight',
    input: '- [ ] a\n  - sub\n- [ ] b\n',
  },
  {
    name: 'task list with inline code label',
    input: '- [ ] configure `settings.json`\n',
  },
  {
    name: 'mixed checked/unchecked with formatting',
    input: '- [x] **done** item\n- [ ] _todo_ item\n',
  },
  {
    name: 'multi-paragraph footnote',
    input:
      'Ref[^1]\n\n[^1]: First line of footnote.\n',
  },
  {
    name: 'mixed bold/italic/code',
    input: 'normal **bold** _italic_ `code` and ~~strike~~ end.\n',
  },
  {
    name: 'list with bolded items',
    input: '- **first**\n- _second_\n- `third`\n',
  },
  {
    name: 'heading with inline formatting',
    input: '## My **bold** Heading\n',
  },

  // === Escaping ===
  { name: 'plain asterisks (escaped)', input: 'a \\*not bold\\* b\n' },
  { name: 'bracket characters', input: 'array \\[0\\] = 1\n' },

  // === Codec malformed-input (graceful degradation) ===
  {
    name: 'unmatched comment end marker is ignored',
    input: 'Body text.\n\n<!-- /markover:comment -->\n',
    expected: 'Body text.\n',
  },
  {
    name: 'comment block missing required attrs does not crash',
    input:
      'Body.\n\n<!-- markover:comment id="c1" -->\nOrphan note.\n<!-- /markover:comment -->\n',
    expected:
      'Body.\n\n<!-- markover:comment id="c1" author="" date="" status="open" -->\nOrphan note.\n<!-- /markover:comment -->\n',
  },
  {
    name: 'malformed file meta version falls back to 1',
    input: 'Body.\n\n<!-- markover:meta\nversion: abc\n-->\n',
    // parseInt('abc', 10) === NaN; NaN || 1 falls back to version 1.
    // The meta block is preserved with the corrected version field.
    expected: 'Body.\n\n<!-- markover:meta\nversion: 1\n-->\n',
  },
];

const serializationCases: { name: string; docJson: Record<string, unknown>; expected: string }[] = [
  {
    name: 'bold mark over trailing space',
    docJson: {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Bold ' }],
      }],
    },
    expected: '**Bold** \n',
  },
  {
    name: 'bold mark over leading space',
    docJson: {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', marks: [{ type: 'bold' }], text: ' Bold' }],
      }],
    },
    expected: ' **Bold**\n',
  },
];

function diff(a: string, b: string): string {
  if (a === b) return '';
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const out: string[] = [];
  const maxLen = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (aLines[i] !== bLines[i]) {
      if (aLines[i] !== undefined) out.push(`  expected: ${JSON.stringify(aLines[i])}`);
      if (bLines[i] !== undefined) out.push(`  got:      ${JSON.stringify(bLines[i])}`);
    }
  }
  return out.join('\n');
}

let passed = 0;
let failed = 0;
const failures: { name: string; input: string; expected: string; got: string }[] = [];

function normalize(s: string): string {
  // Collapse any trailing whitespace/newlines to a single trailing newline so we
  // ignore cosmetic blank-line drift and focus on content correctness.
  return s.replace(/\s+$/, '\n');
}

for (const c of cases) {
  const expected = c.expected ?? c.input;
  let got: string;
  try {
    got = roundtrip(c.input);
  } catch (err) {
    failed++;
    failures.push({
      name: c.name,
      input: c.input,
      expected,
      got: `THROWN: ${(err as Error).message}\n${(err as Error).stack}`,
    });
    continue;
  }
  if (normalize(got) === normalize(expected)) {
    passed++;
    console.log(`  PASS  ${c.name}`);
  } else {
    failed++;
    failures.push({ name: c.name, input: c.input, expected, got });
    console.log(`  FAIL  ${c.name}`);
  }
}

for (const c of serializationCases) {
  let got: string;
  try {
    got = serializeDoc(c.docJson);
  } catch (err) {
    failed++;
    failures.push({
      name: c.name,
      input: JSON.stringify(c.docJson),
      expected: c.expected,
      got: `THROWN: ${(err as Error).message}\n${(err as Error).stack}`,
    });
    continue;
  }
  if (normalize(got) === normalize(c.expected)) {
    passed++;
    console.log(`  PASS  ${c.name}`);
  } else {
    failed++;
    failures.push({ name: c.name, input: JSON.stringify(c.docJson), expected: c.expected, got });
    console.log(`  FAIL  ${c.name}`);
  }
}

// Codec metadata round-trip: literal quotes/ampersands in attribute values must
// survive serialize → parse (they can't be expressed as harness `cases` because a
// literal quote in a file is itself the malformed state escaping is meant to fix).
{
  const meta = {
    highlights: [], comments: [{
      id: 'c1', author: 'John "JJ" & Co', date: '2026-01-01',
      status: 'open' as const, content: 'note', replies: [],
    }],
    insertions: [], deletions: [],
    fileMeta: { version: 1, authors: [{ name: 'A "B"', color: '#fff' }] },
    cspellIgnores: [],
  };
  const file = serializeMarkoverFile('Body.\n', meta);
  const { metadata } = parseMarkoverFile(file);
  const ok = metadata.comments[0]?.author === 'John "JJ" & Co'
    && metadata.fileMeta?.authors[0]?.name === 'A "B"';
  if (ok) { passed++; console.log('  PASS  codec literal-quote attribute round-trip'); }
  else {
    failed++;
    failures.push({
      name: 'codec literal-quote attribute round-trip',
      input: JSON.stringify(meta.comments[0]),
      expected: 'John "JJ" & Co',
      got: JSON.stringify(metadata.comments[0]?.author),
    });
    console.log('  FAIL  codec literal-quote attribute round-trip');
  }
}

console.log(`\n${passed} passed, ${failed} failed (${cases.length + serializationCases.length} total)\n`);

if (failures.length > 0) {
  console.log('=== Failures ===\n');
  for (const f of failures) {
    console.log(`--- ${f.name} ---`);
    console.log(`input:    ${JSON.stringify(f.input)}`);
    console.log(`expected: ${JSON.stringify(f.expected)}`);
    console.log(`got:      ${JSON.stringify(f.got)}`);
    const d = diff(f.expected, f.got);
    if (d) console.log(d);
    console.log('');
  }
  process.exit(1);
}
