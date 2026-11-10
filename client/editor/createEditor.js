import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TextStyle, Color, FontSize } from '@tiptap/extension-text-style';
import { Highlight } from '@tiptap/extension-highlight';
import { Table, TableRow } from '@tiptap/extension-table';
import { TextAlign } from '@tiptap/extension-text-align';
import { Underline } from '@tiptap/extension-underline';
import { Link } from '@tiptap/extension-link';
import { Image } from '@tiptap/extension-image';
import { Placeholder, CharacterCount } from '@tiptap/extensions';

import { StyledTableCell, StyledTableHeader } from './extensions/TableCellStyles.js';
import { SheetTable } from './extensions/SheetTable.js';
import { SpreadsheetPaste } from './extensions/SpreadsheetPaste.js';
import { EditorBehavior } from './hyperlink.js';

/**
 * Builds the shared Tiptap extension list.
 *
 * `editable: false` is used for read-only rendering of messages: it drops the
 * spreadsheet node view, the paste handlers and the placeholder plugin, so the
 * HTML matches what a plain browser would render.
 */
export function buildExtensions({ placeholder = '', editable = true } = {}) {
  const extensions = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: false,
      underline: false,
    }),
    Underline,
    TextStyle,
    Color.configure({ types: ['textStyle'] }),
    FontSize.configure({ types: ['textStyle'] }),
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Link.configure({
      openOnClick: false,
      autolink: false,
      linkOnPaste: false,
      protocols: ['http', 'https', 'mailto'],
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
    }),
    Image.configure({ inline: false, allowBase64: false, HTMLAttributes: { loading: 'lazy' } }),
    editable ? SheetTable : Table,
    TableRow,
    StyledTableCell,
    StyledTableHeader,
    SpreadsheetPaste,
    EditorBehavior,
    CharacterCount,
  ];

  if (editable) extensions.push(Placeholder.configure({ placeholder }));
  return extensions;
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.element
 * @param {string} [opts.content]
 * @param {string} [opts.placeholder]
 * @param {boolean} [opts.editable]
 * @param {(editor: import('@tiptap/core').Editor) => void} [opts.onUpdate]
 * @param {(files: File[]) => void} [opts.onImagePaste]  clipboard images / drops
 * @param {(editor: import('@tiptap/core').Editor) => void} [opts.onSelectionChange]
 */
export function createEditor({
  element,
  content = '',
  placeholder = '',
  editable = true,
  onUpdate,
  onImagePaste,
  onSelectionChange,
}) {
  return new Editor({
    element,
    content,
    editable,
    extensions: buildExtensions({ placeholder, editable }),
    // Tiptap's default floating menu is not used; we render our own toolbars.
    enableInputRules: true,
    enableContentCheck: false,
    editorProps: {
      attributes: {
        class: 'rich focus:outline-none',
        spellcheck: 'true',
        role: 'textbox',
        'aria-multiline': 'true',
      },
      handlePaste: (_view, event) => {
        if (!onImagePaste) return false;
        const items = [...(event.clipboardData?.items || [])];
        const files = items
          .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
          .map((item) => item.getAsFile())
          .filter(Boolean);
        if (!files.length) return false;
        event.preventDefault();
        onImagePaste(files);
        return true;
      },
      handleDrop: (_view, event) => {
        if (!onImagePaste) return false;
        const files = [...(event.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        onImagePaste(files);
        return true;
      },
    },
    onUpdate: ({ editor }) => onUpdate?.(editor),
    onSelectionUpdate: ({ editor }) => onSelectionChange?.(editor),
  });
}

/** Renders stored message HTML read-only (used in tests and exports). */
export function renderHtmlToEditor(element, html) {
  return createEditor({ element, content: html, editable: false });
}
