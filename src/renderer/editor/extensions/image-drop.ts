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

async function getDropPaths(filePath: string): Promise<{ relativePath: string; absolutePath: string }> {
  const absolutePath = filePath.replace(/\\/g, '/');
  const docPath = useEditorStore.getState().filePath;
  if (docPath) {
    const docDir = docPath.replace(/[/\\][^/\\]+$/, '');
    const relativePath = await window.electronAPI.getRelativePath(docDir, filePath);
    return { relativePath, absolutePath };
  }
  return { relativePath: '', absolutePath };
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
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
                  // Gather all options then show the Insert Image dialog
                  const base64Promise = readFileAsDataURL(file);
                  const pathPromise = nativePath
                    ? getDropPaths(nativePath)
                    : Promise.resolve({ relativePath: '', absolutePath: '' });

                  void Promise.all([base64Promise, pathPromise]).then(([base64Src, { relativePath, absolutePath }]) => {
                    document.dispatchEvent(
                      new CustomEvent('markover:image-drop', {
                        detail: {
                          fileName: file.name,
                          relativePath,
                          absolutePath,
                          base64Src,
                          hasNativePath: !!nativePath,
                          onConfirm: (src: string, alt: string) => {
                            insertImageAt(view, pos?.pos, src, alt);
                          },
                        },
                      }),
                    );
                  });
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
