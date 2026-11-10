import { Extension } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { writeRichClipboard } from './clipboard.js';

/** Prompted from the toolbar; keeps the dialog markup out of the editor. */
export function openLinkDialog(editor) {
  const modal = document.getElementById('linkModal');
  const input = document.getElementById('linkUrl');
  const newTab = document.getElementById('linkNewTab');
  const remove = document.getElementById('linkRemove');
  if (!modal) return;

  const previous = editor.getAttributes('link');
  input.value = previous.href || 'https://';
  newTab.checked = previous.target !== '_self';
  modal.classList.remove('hidden');
  modal.classList.add('grid');
  setTimeout(() => {
    input.focus();
    input.select();
  }, 20);

  const close = () => {
    modal.classList.add('hidden');
    modal.classList.remove('grid');
    form.removeEventListener('submit', onSubmit);
    remove.removeEventListener('click', onRemove);
  };
  const onSubmit = (event) => {
    event.preventDefault();
    const href = input.value.trim();
    const target = newTab.checked ? '_blank' : '_self';
    if (!href) editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href, target }).run();
    close();
  };
  const onRemove = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    close();
  };
  const form = document.getElementById('linkForm');
  form.addEventListener('submit', onSubmit);
  remove.addEventListener('click', onRemove);
  modal.dataset.closeHandler = 'link';
  modal._onClose = close;
}

/**
 * Keyboard + clipboard behaviour shared by both editors:
 *  - Ctrl/Cmd+K opens the link dialog
 *  - Ctrl/Cmd+Shift+V pastes *plain* text (no formatting, no table conversion)
 *  - while editing a header cell of a table, pressing Tab keeps moving right
 */
export const EditorBehavior = Extension.create({
  name: 'editorBehavior',

  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        openLinkDialog(this.editor);
        return true;
      },
      'Mod-Shift-v': () => {
        navigator.clipboard
          ?.readText()
          .then((text) => {
            if (text) this.editor.chain().focus().insertContent(text.replace(/\r?\n/g, '<br>')).run();
          })
          .catch(() => {});
        return true;
      },
      Escape: () => {
        // Let modals handle Escape first (they attach their own listener).
        return false;
      },
    };
  },

  addProseMirrorPlugins() {
    return [];
  },
});

/**
 * Copies the current selection as rich HTML so that pasting an entire Tiptap
 * table into Excel (or another chat) keeps its structure.
 */
export function copySelectionRich(editor) {
  const { from, to, empty } = editor.state.selection;
  if (empty) return false;
  const slice = editor.state.doc.slice(from, to);
  const holder = document.createElement('div');
  const fragment = editor.view.serializeForClipboard(slice);
  holder.appendChild(fragment.content.cloneNode(true));
  writeRichClipboard(holder.innerHTML, editor.state.doc.textBetween(from, to, '\n'));
  return true;
}

export { CellSelection };
