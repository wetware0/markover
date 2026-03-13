import { Plugin } from '@tiptap/pm/state';
import { Extension } from '@tiptap/core';

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

              const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
              if (images.length === 0) return false;

              event.preventDefault();

              const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });

              for (const file of images) {
                const reader = new FileReader();
                reader.onload = () => {
                  const src = reader.result as string;
                  const node = view.state.schema.nodes.image.create({
                    src,
                    alt: file.name,
                  });
                  const tr = view.state.tr.insert(pos?.pos ?? view.state.selection.from, node);
                  view.dispatch(tr);
                };
                reader.readAsDataURL(file);
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

                const reader = new FileReader();
                reader.onload = () => {
                  const src = reader.result as string;
                  editor.chain().focus().setImage({ src, alt: file.name }).run();
                };
                reader.readAsDataURL(file);
              }

              return true;
            },
          },
        },
      }),
    ];
  },
});
