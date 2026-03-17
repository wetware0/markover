import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { SearchOptions } from '../../store/find-replace-store';

export const findReplacePluginKey = new PluginKey<FindReplacePluginState>('findReplace');

export type SearchScope = 'text' | 'mermaid' | 'math';

export interface TextMatch {
  from: number;
  to: number;
}

export interface AtomMatch {
  nodePos: number;
  nodeSize: number;
}

export interface FindReplacePluginState {
  query: string;
  options: SearchOptions;
  matches: TextMatch[];
  atomMatches: AtomMatch[];
  currentIndex: number;
  decorations: DecorationSet;
  scope: SearchScope;
  regexError: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function detectScope(state: EditorState): SearchScope {
  const sel = state.selection;
  // NodeSelection: atom node is explicitly selected
  if (sel instanceof NodeSelection) {
    const name = sel.node.type.name;
    if (name === 'mermaidBlock') return 'mermaid';
    if (name === 'katexBlock' || name === 'katexInline') return 'math';
  }
  // Cursor adjacent to an atom node
  const nodeAt = state.doc.nodeAt(sel.from);
  if (nodeAt) {
    if (nodeAt.type.name === 'mermaidBlock') return 'mermaid';
    if (nodeAt.type.name === 'katexBlock' || nodeAt.type.name === 'katexInline') return 'math';
  }
  return 'text';
}

function buildPattern(query: string, options: SearchOptions): RegExp | null {
  if (!query) return null;
  try {
    const flags = options.matchCase ? 'g' : 'gi';
    if (options.regex) return new RegExp(query, flags);
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wb = options.wholeWord ? '\\b' : '';
    return new RegExp(`${wb}${escaped}${wb}`, flags);
  } catch {
    return null;
  }
}

function validateRegex(query: string, options: SearchOptions): string | null {
  if (!options.regex || !query) return null;
  try {
    new RegExp(query);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

function buildTextMatches(doc: PmNode, query: string, options: SearchOptions): TextMatch[] {
  const pattern = buildPattern(query, options);
  if (!pattern) return [];
  const matches: TextMatch[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    // Skip deleted ghost text (markovDelete). Inserted text (markovInsert) is
    // intentionally included — it is visible in the document and valid to search.
    if (node.marks.some((m) => m.type.name === 'markovDelete')) return;

    const text = node.text;
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const from = pos + m.index;
      const to = from + m[0].length;
      // Known limitation: matches that span text-node boundaries (e.g. bold within
      // a sentence) are checked per-node. A cross-boundary match may be missed or
      // partially included when inSelection is active.
      if (options.inSelection && options.selectionFrom !== undefined && options.selectionTo !== undefined) {
        if (from < options.selectionFrom || to > options.selectionTo) {
          if (m[0].length === 0) pattern.lastIndex++;
          continue;
        }
      }
      matches.push({ from, to });
      if (m[0].length === 0) pattern.lastIndex++;
    }
  });

  return matches;
}

function buildAtomMatches(doc: PmNode, query: string, options: SearchOptions, scope: 'mermaid' | 'math'): AtomMatch[] {
  const pattern = buildPattern(query, options);
  if (!pattern) return [];
  const nodeTypes = scope === 'mermaid' ? ['mermaidBlock'] : ['katexBlock', 'katexInline'];
  const attr = scope === 'mermaid' ? 'code' : 'math';
  const matches: AtomMatch[] = [];

  doc.descendants((node, pos) => {
    if (!nodeTypes.includes(node.type.name)) return;
    const value = (node.attrs[attr] as string) ?? '';
    pattern.lastIndex = 0;
    if (pattern.test(value)) {
      matches.push({ nodePos: pos, nodeSize: node.nodeSize });
    }
  });

  return matches;
}

function buildDecorations(
  doc: PmNode,
  matches: TextMatch[],
  atomMatches: AtomMatch[],
  currentIndex: number,
  scope: SearchScope,
): DecorationSet {
  const decos: Decoration[] = [];
  const otherStyle = 'background-color: rgba(253, 224, 71, 0.45);';
  const currentStyle =
    'background-color: rgba(59, 130, 246, 0.35); outline: 1.5px solid #3b82f6; border-radius: 2px;';

  if (scope === 'text') {
    matches.forEach((match, i) => {
      decos.push(
        Decoration.inline(match.from, match.to, {
          style: i === currentIndex ? currentStyle : otherStyle,
          class: i === currentIndex ? 'find-match-current' : 'find-match',
        }),
      );
    });
  } else {
    atomMatches.forEach((match, i) => {
      decos.push(
        Decoration.node(match.nodePos, match.nodePos + match.nodeSize, {
          style: i === currentIndex ? currentStyle : otherStyle,
          class: i === currentIndex ? 'find-match-current' : 'find-match',
        }),
      );
    });
  }

  return DecorationSet.create(doc, decos);
}

// ── Plugin ───────────────────────────────────────────────────────────────────

const defaultState: FindReplacePluginState = {
  query: '',
  options: { matchCase: false, wholeWord: false, regex: false, wrap: true, inSelection: false },
  matches: [],
  atomMatches: [],
  currentIndex: 0,
  decorations: DecorationSet.empty,
  scope: 'text',
  regexError: null,
};

export function createFindReplacePlugin(): Plugin {
  return new Plugin<FindReplacePluginState>({
    key: findReplacePluginKey,

    state: {
      init(): FindReplacePluginState {
        return { ...defaultState };
      },

      apply(tr, value, _oldState, newState): FindReplacePluginState {
        const meta = tr.getMeta(findReplacePluginKey) as
          | { type: 'setQuery'; query: string; options: SearchOptions; scope: SearchScope }
          | { type: 'setIndex'; index: number }
          | { type: 'clear' }
          | undefined;

        if (meta?.type === 'clear') {
          return { ...defaultState };
        }

        if (meta?.type === 'setQuery') {
          const { query, options, scope } = meta;
          const regexError = validateRegex(query, options);
          if (regexError) {
            return { ...value, query, options, scope, regexError, matches: [], atomMatches: [], currentIndex: 0, decorations: DecorationSet.empty };
          }
          const matches = scope === 'text' ? buildTextMatches(newState.doc, query, options) : [];
          const atomMatches = scope !== 'text' ? buildAtomMatches(newState.doc, query, options, scope) : [];
          const decorations = buildDecorations(newState.doc, matches, atomMatches, 0, scope);
          return { query, options, scope, matches, atomMatches, currentIndex: 0, decorations, regexError: null };
        }

        if (meta?.type === 'setIndex') {
          const index = meta.index;
          // TODO: perf — for large match sets, swap only the changed decorations
          // instead of rebuilding the full DecorationSet on every navigation step.
          const decorations = buildDecorations(newState.doc, value.matches, value.atomMatches, index, value.scope);
          return { ...value, currentIndex: index, decorations };
        }

        // Rebuild on document change if a query is active
        if (tr.docChanged && value.query) {
          const { query, options, scope } = value;
          const matches = scope === 'text' ? buildTextMatches(newState.doc, query, options) : [];
          const atomMatches = scope !== 'text' ? buildAtomMatches(newState.doc, query, options, scope) : [];
          const list = scope === 'text' ? matches : atomMatches;
          const newIndex = Math.min(value.currentIndex, Math.max(0, list.length - 1));
          const decorations = buildDecorations(newState.doc, matches, atomMatches, newIndex, scope);
          return { ...value, matches, atomMatches, currentIndex: newIndex, decorations };
        }

        if (tr.docChanged) {
          return { ...value, decorations: value.decorations.map(tr.mapping, tr.doc) };
        }

        return value;
      },
    },

    props: {
      decorations(state) {
        return findReplacePluginKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}

// ── Public helpers ────────────────────────────────────────────────────────────

export function getPluginState(state: EditorState): FindReplacePluginState | null {
  return findReplacePluginKey.getState(state) ?? null;
}

export { buildTextMatches, buildAtomMatches, buildDecorations, validateRegex };
