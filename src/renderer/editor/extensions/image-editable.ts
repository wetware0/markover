import Image from '@tiptap/extension-image';

/**
 * Convert a raw markdown image src to a URL the renderer can load.
 * - Already-resolved URLs (data:, http:, https:, file:) are used as-is.
 * - All local paths (relative, root-relative, absolute filesystem) are
 *   passed through the markover-asset: protocol so the main process can
 *   resolve them against the open file's directory and git root.
 */
function resolveImageSrc(src: string): string {
  if (!src) return src;
  if (/^(data:|https?:|file:)/i.test(src)) return src;
  return 'markover-asset://?src=' + encodeURIComponent(src);
}

/**
 * Extends TipTap's Image extension with:
 * - a `width` attribute (serialized as inline HTML when set)
 * - a custom node view that adds a blue hover outline and dispatches
 *   a `markover:edit-node` CustomEvent on double-click
 */
export const MarkoverImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('width') || null,
        renderHTML: (attrs) => (attrs.width ? { width: attrs.width as string } : {}),
      },
    };
  },

  addNodeView() {
    return ({ node, getPos }) => {
      const img = document.createElement('img');
      img.src = resolveImageSrc((node.attrs.src as string) || '');
      img.alt = (node.attrs.alt as string) || '';
      if (node.attrs.title) img.title = node.attrs.title as string;
      if (node.attrs.width) img.style.width = node.attrs.width as string;
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
      img.style.borderRadius = '0.25em';
      img.classList.add('markov-editable-node');
      img.title = (node.attrs.alt as string) || 'Double-click to edit';

      img.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        document.dispatchEvent(
          new CustomEvent('markover:edit-node', {
            detail: {
              nodeType: 'image',
              src: node.attrs.src,
              alt: node.attrs.alt || '',
              width: node.attrs.width || '',
              getPos,
            },
          }),
        );
      });

      return { dom: img };
    };
  },
});
