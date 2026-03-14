import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { createLowlight, common } from 'lowlight';
import { CodeBlockView } from './CodeBlockView';

const lowlight = createLowlight(common);

export const MarkoverCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
}).configure({ lowlight });
