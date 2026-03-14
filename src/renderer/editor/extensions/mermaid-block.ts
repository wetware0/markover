import { Node, mergeAttributes } from '@tiptap/core';
import mermaid from 'mermaid';

mermaid.initialize({ startOnLoad: false, theme: 'default' });

let mermaidCounter = 0;

export const MermaidBlock = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      code: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-mermaid]',
        getAttrs: (el) => ({
          code: (el as HTMLElement).getAttribute('data-mermaid'),
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-mermaid': node.attrs.code,
        class: 'mermaid-block',
        contenteditable: 'false',
      }),
      ['pre', { class: 'mermaid-source' }, node.attrs.code],
    ];
  },

  addNodeView() {
    return ({ node, HTMLAttributes, getPos }) => {
      const dom = document.createElement('div');
      dom.setAttribute('data-mermaid', node.attrs.code);
      dom.classList.add('mermaid-block', 'markov-editable-node');
      dom.contentEditable = 'false';
      dom.title = 'Double-click to edit';
      Object.entries(HTMLAttributes).forEach(([key, value]) => {
        if (typeof value === 'string') dom.setAttribute(key, value);
      });

      const renderDiagram = async () => {
        const code = node.attrs.code as string;
        if (!code.trim()) {
          dom.textContent = '(empty diagram)';
          return;
        }
        try {
          const id = `mermaid-${++mermaidCounter}`;
          const { svg } = await mermaid.render(id, code);
          dom.innerHTML = svg;
        } catch {
          dom.innerHTML = `<pre class="mermaid-error">${code}</pre>`;
        }
      };

      dom.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent('markover:edit-node', {
          detail: { nodeType: 'mermaidBlock', code: node.attrs.code, getPos },
        }));
      });

      renderDiagram();
      return { dom };
    };
  },
});
