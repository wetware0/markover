import { Plugin } from '@tiptap/pm/state';
import { Extension } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { useEditorStore } from '../../store/editor-store';
import { getFileIconDataUri } from './file-icons';

async function resolveDroppedFilePath(filePath: string): Promise<string> {
  const docPath = useEditorStore.getState().filePath;
  if (docPath) {
    const docDir = docPath.replace(/[/\\][^/\\]+$/, ''); // dirname without Node
    return window.electronAPI.getRelativePath(docDir, filePath);
  }
  // No saved document — use the absolute path (normalised to forward slashes)
  return filePath.replace(/\\/g, '/');
}

function insertImageAt(view: EditorView, pos: number | undefined, src: string, alt: string, href?: string) {
  const attrs: Record<string, string | null> = { src, alt, href: href ?? null };
  const node = view.state.schema.nodes.image.create(attrs);
  const tr = view.state.tr.insert(pos ?? view.state.selection.from, node);
  view.dispatch(tr);
}

export const ImageDrop = Extension.create({
  name: 'imageDrop',

  addProseMirrorPlugins() {
    const { editor } = this;

    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            drop(view, event) {
              const files = event.dataTransfer?.files;
              if (!files || files.length === 0) return false;
              if (Array.from(files).every((f) => f.type === '')) return false;

              event.preventDefault();

              const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });

              for (const file of Array.from(files)) {
                const nativePath = window.electronAPI.getPathForFile(file);

                if (file.type.startsWith('image/')) {
                  // Insert as a plain image
                  if (nativePath) {
                    void resolveDroppedFilePath(nativePath).then((src) => {
                      insertImageAt(view, pos?.pos, src, file.name);
                    });
                  } else {
                    const reader = new FileReader();
                    reader.onload = () => {
                      insertImageAt(view, pos?.pos, reader.result as string, file.name);
                    };
                    reader.readAsDataURL(file);
                  }
                } else {
                  // Insert as a file-icon link: [![name](icon)](file)
                  if (nativePath) {
                    void resolveDroppedFilePath(nativePath).then((href) => {
                      const icon = getFileIconDataUri(file.name);
                      insertImageAt(view, pos?.pos, icon, file.name, href);
                    });
                  }
                }
              }

              return true;
            },

            paste(_view, event) {
              const items = event.clipboardData?.items;
              if (!items) return false;

              const imageItems = Array.from(items).filter((item) => item.type.startsWith('image/'));
              if (imageItems.length === 0) return false;

              event.preventDefault();

              for (const item of imageItems) {
                const file = item.getAsFile();
                if (!file) continue;

                const nativePath = window.electronAPI.getPathForFile(file);
                if (nativePath) {
                  void resolveDroppedFilePath(nativePath).then((src) => {
                    editor.chain().focus().setImage({ src, alt: file.name }).run();
                  });
                } else {
                  const reader = new FileReader();
                  reader.onload = () => {
                    editor.chain().focus().setImage({ src: reader.result as string, alt: file.name }).run();
                  };
                  reader.readAsDataURL(file);
                }
              }

              return true;
            },
          },
        },
      }),
    ];
  },
});
