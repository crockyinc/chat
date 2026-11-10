import { createEditor } from '../editor/createEditor.js';
import { createToolbar, bindTableToolbar } from '../editor/toolbar.js';
import { openTableDialog, toggleEmojiPicker } from './composer.js';
import { icon, mountIcons } from './icons.js';
import { findSelectedCell } from '../editor/extensions/TableCellStyles.js';
import { insertMatrix, parseMatrixFromHtml } from '../editor/extensions/SpreadsheetPaste.js';
import { containsTable, parseDelimitedText, normalizeSpreadsheetHtml } from '../editor/clipboard.js';
import { absoluteUrl } from '../lib/backend.js';
import { sendWithPasswordPrompt } from './passwordPrompt.js';

/**
 * Full-screen composer. Same document as the small composer (parents sync the
 * HTML), but with room for spreadsheets: table structure toolbar, per-cell
 * formatting toolbar, Excel import dialog and image insertion.
 */
export function createEditorModal({ onSend, onUpload, onToast, getInitialHtml, onChange }) {
  const modal = document.getElementById('editorModal');
  const editorElement = document.getElementById('editorModalEditor');
  const toolbarElement = document.getElementById('editorModalToolbar');
  const tableToolbarElement = document.getElementById('tableToolbar');
  const cellToolbarElement = document.getElementById('cellToolbar');
  const sendButton = document.getElementById('editorModalSend');
  const clearButton = document.getElementById('editorModalClear');
  const closeButton = modal?.querySelector('[data-close="editorModal"]');
  const header = modal?.querySelector('.border-b');

  if (!modal || !editorElement) return null;

  // Extra buttons live in the modal header (kept out of the shared toolbar).
  const extra = document.createElement('div');
  extra.className = 'flex items-center gap-1';
  extra.innerHTML = `
    <button type="button" class="btn-ghost !text-xs" data-modal-action="import" title="Import a table from a file or pasted text">
      ${icon('paste', { size: 15 })}<span class="hidden sm:inline">Import table</span>
    </button>
    <button type="button" class="btn-ghost !text-xs" data-modal-action="image" title="Insert an image">
      ${icon('image', { size: 15 })}<span class="hidden sm:inline">Image</span>
    </button>
    <button type="button" class="btn-ghost !text-xs" data-modal-action="emoji" title="Emoji">
      ${icon('emoji', { size: 15 })}
    </button>`;
  header?.insertBefore(extra, header.children[1] || null);
  const imageInput = document.createElement('input');
  imageInput.type = 'file';
  imageInput.accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
  imageInput.multiple = true;
  imageInput.hidden = true;
  modal.appendChild(imageInput);

  const editor = createEditor({
    element: editorElement,
    placeholder: 'Write, paste a spreadsheet, or drop an image…',
    onUpdate: () => onChange?.(editor.getHTML()),
    onImagePaste: (files) => insertImages(files),
  });

  const toolbar = createToolbar({
    root: toolbarElement,
    editor,
    variant: 'full',
    scope: 'document',
    onChange: () => onChange?.(editor.getHTML()),
  });

  const cellToolbar = createToolbar({
    root: cellToolbarElement,
    editor,
    variant: 'full',
    scope: 'cell',
  });

  bindTableToolbar({ root: tableToolbarElement, editor, toolbar });

  // Show the cell toolbar whenever the cursor is in a table, like a spreadsheet.
  const syncCellToolbar = () => {
    const cell = findSelectedCell(editor);
    cellToolbarElement?.classList.toggle('hidden', !cell);
    cellToolbarElement?.classList.toggle('flex', Boolean(cell));
  };
  editor.on('selectionUpdate', syncCellToolbar);
  editor.on('transaction', syncCellToolbar);
  syncCellToolbar();

  /* ------------------------------------------------------------- open/close */

  let isOpen = false;

  function open(prefillHtml) {
    const html = prefillHtml ?? getInitialHtml?.() ?? '';
    editor.commands.setContent(html || '', { emitUpdate: false });
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    isOpen = true;
    document.body.style.overflow = 'hidden';
    setTimeout(() => editor.commands.focus('end'), 60);
  }

  function close({ revert = false } = {}) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.body.style.overflow = '';
    isOpen = false;
    if (revert) editor.commands.setContent(getInitialHtml?.() || '', { emitUpdate: false });
    else onChange?.(editor.getHTML());
  }

  const onKeyDown = (event) => {
    if (!isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close({ revert: true });
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  };
  document.addEventListener('keydown', onKeyDown);
  closeButton?.addEventListener('click', () => close({ revert: true }));

  /* ------------------------------------------------------------------ send */

  let sending = false;
  async function submit() {
    if (sending) return;
    const html = editor.isEmpty ? '' : editor.getHTML();
    if (!html) {
      onToast?.('Write something first');
      return;
    }

    let result;
    try {
      result = await sendWithPasswordPrompt(async (password) => {
        sending = true;
        sendButton.disabled = true;
        const original = sendButton.innerHTML;
        sendButton.innerHTML = `<span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>`;
        try {
          await onSend?.(html, password);
        } finally {
          sending = false;
          sendButton.disabled = false;
          sendButton.innerHTML = original;
        }
      });
    } catch (err) {
      onToast?.(err.message || 'Could not send', 'error');
      return;
    }

    if (!result.sent) return; // cancelled: keep the draft open

    editor.commands.clearContent(false);
    close();
    onToast?.('Sent');
  }

  sendButton?.addEventListener('click', submit);

  clearButton?.addEventListener('click', () => {
    editor.commands.clearContent(false);
    onChange?.('');
  });

  /* --------------------------------------------------------------- images */

  async function insertImages(files) {
    const images = [...files].filter((file) => file.type.startsWith('image/'));
    if (!images.length) return;
    try {
      const result = await onUpload(images);
      const attachments = result.attachments || [];
      if (!attachments.length) return;
      const html = attachments
        .map((att) => `<p><img src="${absoluteUrl(att.url)}" alt="${escapeAttr(att.filename || '')}" /></p>`)
        .join('');
      editor.chain().focus().insertContent(html).run();
    } catch (err) {
      onToast?.(err.message || 'Upload failed', 'error');
    }
  }

  extra.querySelector('[data-modal-action="image"]')?.addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', (event) => {
    insertImages(event.target.files || []);
    event.target.value = '';
  });
  extra.querySelector('[data-modal-action="emoji"]')?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleEmojiPicker(event.currentTarget, (emoji) => editor.chain().focus().insertContent(emoji).run());
  });
  extra.querySelector('[data-modal-action="import"]')?.addEventListener('click', () => openImportDialog());

  /* -------------------------------------------------------- import dialog */

  function openImportDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'fixed inset-0 z-[80] grid place-items-center bg-black/50 p-4 backdrop-blur-sm';
    dialog.innerHTML = `
      <div class="card w-full max-w-lg p-5">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-base font-bold">Import a spreadsheet table</h2>
          <button type="button" class="btn-icon" data-cancel>${icon('close', { size: 18 })}</button>
        </div>
        <p class="mb-2 text-xs leading-relaxed muted">
          Copy cells in Excel or Google Sheets and paste them below (tab separated), or choose an
          <code>.html</code>/<code>.xls</code> file exported from Excel. You can also just hit
          <kbd class="rounded border px-1">Ctrl</kbd>+<kbd class="rounded border px-1">V</kbd> in the editor.
        </p>
        <textarea data-text class="field h-32 font-mono text-xs" placeholder="Region&#9;Sales&#10;North&#9;1200"></textarea>
        <div class="mt-2 flex items-center justify-between">
          <label class="text-xs font-semibold muted">
            or file:
            <input type="file" data-file accept=".html,.htm,.xls,.csv,.tsv,.txt" class="ml-1 text-xs" />
          </label>
          <span data-error class="text-xs font-semibold text-red-500"></span>
        </div>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="btn-ghost" data-cancel>Cancel</button>
          <button type="button" class="btn-primary" data-insert>Insert table</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);
    const textarea = dialog.querySelector('[data-text]');
    const fileInput = dialog.querySelector('[data-file]');
    const error = dialog.querySelector('[data-error]');
    textarea.focus();

    const destroy = () => dialog.remove();
    dialog.querySelectorAll('[data-cancel]').forEach((btn) => btn.addEventListener('click', destroy));
    dialog.addEventListener('mousedown', (event) => {
      if (event.target === dialog) destroy();
    });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const text = await file.text();
      if (/\.(html?|xls)$/i.test(file.name)) {
        const matrix = parseMatrixFromHtml(normalizeSpreadsheetHtml(text)) || parseMatrixFromHtml(text);
        if (matrix) {
          insertMatrix(editor, matrix);
          destroy();
          return;
        }
        error.textContent = 'No table found in that file';
        return;
      }
      textarea.value = text;
    });

    dialog.querySelector('[data-insert]').addEventListener('click', () => {
      const raw = textarea.value.trim();
      if (!raw) {
        error.textContent = 'Nothing to import';
        return;
      }
      const matrix = parseDelimitedText(raw) || raw.split(/\r?\n/).map((line) => line.split(/,|\t/));
      const clean = matrix.filter((row) => row.some((cell) => String(cell).trim() !== ''));
      if (!clean.length) {
        error.textContent = 'Nothing to import';
        return;
      }
      if (clean.length > 3000) {
        error.textContent = 'That table is too large (max 3000 rows)';
        return;
      }
      insertMatrix(editor, clean);
      destroy();
    });
  }

  document.addEventListener('lm:open-full-editor', (event) => open(event.detail?.html));
  document.addEventListener('lm:open-table-dialog', () => {
    if (isOpen) openTableDialog(editor);
  });

  return {
    editor,
    toolbar,
    open,
    close: () => close({ revert: true }),
    isOpen: () => isOpen,
    getHtml: () => (editor.isEmpty ? '' : editor.getHTML()),
    setHtml(html) {
      editor.commands.setContent(html || '', { emitUpdate: false });
    },
    destroy() {
      document.removeEventListener('keydown', onKeyDown);
      editor.destroy();
    },
  };
}

const escapeAttr = (value = '') => String(value).replace(/"/g, '&quot;').replace(/</g, '&lt;');
export { containsTable, mountIcons };
