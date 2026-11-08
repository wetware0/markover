import React from 'react';
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';

const LANGUAGES = [
  '', 'bash', 'c', 'cpp', 'csharp', 'css', 'diff', 'dockerfile', 'go',
  'graphql', 'html', 'ini', 'java', 'javascript', 'json', 'kotlin',
  'latex', 'lua', 'makefile', 'markdown', 'nginx', 'php', 'plaintext',
  'powershell', 'python', 'r', 'ruby', 'rust', 'scala', 'scss', 'shell',
  'sql', 'swift', 'toml', 'typescript', 'xml', 'yaml',
];

/** Tracked insert/delete of the whole block (see block-changes.ts). */
function blockChangeProps(attrs: Record<string, unknown>): Record<string, string> {
  const props: Record<string, string> = {};
  const ins = attrs.markovInsert as { changeId?: string } | null;
  const del = attrs.markovDelete as { changeId?: string } | null;
  if (ins) props['data-markov-block-insert'] = 'true';
  if (del) props['data-markov-block-delete'] = 'true';
  const id = del?.changeId ?? ins?.changeId;
  if (id) props['data-change-id'] = id;
  return props;
}

export function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  const language = (node.attrs.language as string) || '';

  return (
    <NodeViewWrapper className="code-block-wrapper" {...blockChangeProps(node.attrs)}>
      <div
        className="flex items-center justify-between px-3 py-1 bg-gray-700 dark:bg-gray-950 rounded-t-md select-none"
        contentEditable={false}
      >
        <select
          value={language}
          onChange={(e) => updateAttributes({ language: e.target.value })}
          className="text-xs bg-transparent text-gray-300 outline-none cursor-pointer hover:text-white transition-colors"
        >
          {LANGUAGES.map((lang) => (
            <option key={lang} value={lang} className="bg-gray-800 text-gray-100">
              {lang || 'plaintext'}
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-500">click inside to edit</span>
      </div>
      <pre className="rounded-t-none !mt-0 !rounded-tl-none !rounded-tr-none">
        <NodeViewContent as="code" />
      </pre>
    </NodeViewWrapper>
  );
}
