import { createEditor } from '../editor/createEditor.js';
import { createToolbar } from '../editor/toolbar.js';
import { icon, mountIcons } from './icons.js';
import { formatBytes } from './messages.js';
import { readFileAsDataUrl } from '../editor/clipboard.js';
import { insertMatrix, focusFirstCell } from '../editor/extensions/SpreadsheetPaste.js';
import { sendWithPasswordPrompt } from './passwordPrompt.js';

const DRAFT_KEY = 'lm.draft';
const MAX_ATTACHMENTS = 6;
const MAX_FILE_BYTES = 12 * 1024 * 1024;

/**
 * The message composer: rich text + spreadsheet tables + image attachments.
 * It owns its Tiptap instance; the full-screen editor (editorModal.js) mirrors
 * the same document so people can expand while keeping their draft.
 */
export function createComposer({ onSend, onTyping, onUpload, editorElement, toolbarElement, cellToolbarElement }) {
  const composer = document.getElementById('composer');
  const sendButton = document.getElementById('sendButton');
  const attachButton = document.getElementById('attachButton');
  const emojiButton = document.getElementById('emojiButton');
  const tableButton = document.getElementById('tableButton');
  const fullscreenButton = document.getElementById('fullscreenButton');
  const fileInput = document.getElementById('fileInput');
  const tray = document.getElementById('attachmentTray');
  const draftState = document.getElementById('draftState');

  const attachments = [];
  let busy = false;

  const editor = createEditor({
    element: editorElement,
    placeholder: 'Write a message… paste a spreadsheet or an image',
    onUpdate: () => {
      refreshSendState();
      scheduleDraftSave();
      onTyping?.(true);
      scheduleTypingStop();
    },
    onImagePaste: (files) => addFiles(files),
  });

  const toolbar = createToolbar({
    root: toolbarElement,
    editor,
    variant: 'compact',
    scope: 'document',
    onChange: refreshSendState,
  });

  /* ---------------------------------------------------------- draft saving */

  let draftTimer = null;
  let typingTimer = null;

  function scheduleDraftSave() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try {
        const html = editor.isEmpty ? '' : editor.getHTML();
        if (html) localStorage.setItem(DRAFT_KEY, html);
        else localStorage.removeItem(DRAFT_KEY);
        if (draftState) {
          draftState.textContent = html ? 'Draft saved' : '';
          draftState.classList.toggle('hidden', !html);
        }
      } catch {
        /* storage disabled */
      }
    }, 450);
  }

  function scheduleTypingStop() {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => onTyping?.(false), 2200);
  }

  function restoreDraft() {
    try {
      const html = localStorage.getItem(DRAFT_KEY);
      if (html) {
        editor.commands.setContent(html, { emitUpdate: false });
        refreshSendState();
      }
    } catch {
      /* ignore */
    }
  }

  function clearDraftStorage() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    if (draftState) draftState.classList.add('hidden');
  }

  /* ------------------------------------------------------------- attachments */

  function addFiles(files) {
    const list = [...files].filter((file) => file.type.startsWith('image/'));
    const rejected = [];
    for (const file of list) {
      if (attachments.length >= MAX_ATTACHMENTS) {
        rejected.push('You can attach up to 6 images at a time');
        break;
      }
      if (file.size > MAX_FILE_BYTES) {
        rejected.push(`${file.name || 'Image'} is larger than 12 MB`);
        continue;
      }
      attachments.push({
        file,
        id: `pending-${Math.random().toString(36).slice(2)}`,
        preview: '',
        name: file.name || 'pasted-image.png',
        size: file.size,
      });
    }
    rejected.forEach((message) => onSend?.({ type: 'toast', message, tone: 'error' }));
    if (attachments.length) {
      renderTray();
      refreshSendState();
      Promise.all(
        attachments
          .filter((a) => !a.preview)
          .map((a) => readFileAsDataUrl(a.file).then((url) => {
            a.preview = url;
          })),
      ).then(renderTray);
      onTyping?.(true);
    }
  }

  function removeAttachment(id) {
    const index = attachments.findIndex((a) => a.id === id);
    if (index >= 0) attachments.splice(index, 1);
    renderTray();
    refreshSendState();
  }

  function renderTray() {
    if (!tray) return;
    if (!attachments.length) {
      tray.classList.add('hidden');
      tray.classList.remove('flex');
      tray.innerHTML = '';
      return;
    }
    tray.classList.remove('hidden');
    tray.classList.add('flex');
    tray.innerHTML = attachments
      .map(
        (a) => `<figure class="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border" style="border-color:var(--border)">
          ${
            a.preview
              ? `<img src="${a.preview}" alt="" class="h-full w-full object-cover" />`
              : `<div class="grid h-full w-full place-items-center bg-black/5 dark:bg-white/10">${icon('image', { size: 18 })}</div>`
          }
          <button type="button" class="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
            data-remove-attachment="${a.id}" title="Remove">${icon('close', { size: 12 })}</button>
          <figcaption class="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-[9px] font-semibold text-white">${formatBytes(
            a.size,
          )}</figcaption>
        </figure>`,
      )
      .join('');
    mountIcons(tray);
  }

  function refreshSendState() {
    const hasContent = !editor.isEmpty || attachments.length > 0;
    if (sendButton) sendButton.disabled = busy || !hasContent;
  }

  /* ------------------------------------------------------------------ send */

  function snapshot() {
    return {
      html: editor.isEmpty ? '' : editor.getHTML(),
      text: editor.getText(),
      attachments: attachments.map((a) => ({ ...a })),
    };
  }

  function setContent(html, { focus = true } = {}) {
    editor.commands.setContent(html || '', { emitUpdate: false });
    refreshSendState();
    if (focus) editor.commands.focus('end');
  }

  /** Uploads attachments once, so a password retry never re-uploads them. */
  let uploadedCache = null;
  async function ensureUploads() {
    if (!attachments.length) return [];
    if (uploadedCache) return uploadedCache;
    const result = await onUpload(attachments.map((a) => a.file));
    uploadedCache = (result.attachments || []).map((a) => a.id);
    return uploadedCache;
  }

  async function send() {
    if (busy) return;
    const html = editor.isEmpty ? '' : editor.getHTML();
    if (!html && !attachments.length) return;

    // The password prompt wraps the *whole* send, so a wrong password comes
    // back from the server (403) and the dialog asks again — the draft and any
    // uploaded images are reused instead of being thrown away.
    let result;
    try {
      result = await sendWithPasswordPrompt(async (password) => {
        busy = true;
        setSending(true);
        try {
          const attachmentIds = await ensureUploads();
          await onSend?.({ type: 'message', html, attachmentIds, password });
        } finally {
          busy = false;
          setSending(false);
        }
      });
    } catch (err) {
      onSend?.({ type: 'toast', message: err.message || 'Could not send', tone: 'error' });
      return;
    }

    if (!result.sent) {
      // Cancelled or too many wrong attempts: keep everything as it was.
      refreshSendState();
      return;
    }

    editor.commands.clearContent(false);
    attachments.length = 0;
    uploadedCache = null;
    renderTray();
    clearDraftStorage();
    refreshSendState();
    onTyping?.(false);
    editor.commands.focus();
  }

  function setSending(isSending) {
    if (!sendButton) return;
    sendButton.disabled = isSending;
    sendButton.innerHTML = isSending
      ? `<span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>`
      : '<span>Send</span>' + icon('send', { size: 16 });
  }

  /* ---------------------------------------------------------------- events */

  sendButton?.addEventListener('click', send);
  attachButton?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', (event) => {
    addFiles(event.target.files || []);
    event.target.value = '';
  });

  tray?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-attachment]');
    if (button) removeAttachment(button.dataset.removeAttachment);
  });

  // On touch devices the on-screen Enter key must insert a newline, not send.
  const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  editorElement.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || coarsePointer) return;
    event.preventDefault();
    send();
  });

  // Drag & drop onto the whole composer area.
  ['dragover', 'dragenter'].forEach((type) =>
    composer.addEventListener(type, (event) => {
      if (!event.dataTransfer?.types?.includes('Files')) return;
      event.preventDefault();
      composer.classList.add('drop-active');
    }),
  );
  ['dragleave', 'drop'].forEach((type) =>
    composer.addEventListener(type, (event) => {
      event.preventDefault();
      if (type === 'dragleave' && composer.contains(event.relatedTarget)) return;
      composer.classList.remove('drop-active');
    }),
  );
  composer.addEventListener('drop', (event) => {
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length) addFiles(files);
  });

  // Paste images anywhere in the composer surface.
  document.addEventListener('paste', (event) => {
    const active = document.activeElement;
    if (!composer.contains(active) && active !== editorElement) return;
    const files = [...(event.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      event.preventDefault();
      addFiles(files);
    }
  });

  document.addEventListener('lm:open-table-dialog', () => openTableDialog(editor));

  tableButton?.addEventListener('click', () => openTableDialog(editor));

  fullscreenButton?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('lm:open-full-editor'));
  });

  emojiButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleEmojiPicker(emojiButton, (emoji) => {
      editor.chain().focus().insertContent(emoji).run();
    });
  });

  window.addEventListener('beforeunload', () => {
    try {
      const html = editor.isEmpty ? '' : editor.getHTML();
      if (html) localStorage.setItem(DRAFT_KEY, html);
    } catch {
      /* ignore */
    }
  });

  restoreDraft();
  refreshSendState();

  return {
    editor,
    toolbar,
    addFiles,
    snapshot,
    setContent,
    send,
    focus: () => editor.commands.focus('end'),
    clear() {
      editor.commands.clearContent(false);
      attachments.length = 0;
      renderTray();
      clearDraftStorage();
      refreshSendState();
    },
    hasContent: () => !editor.isEmpty || attachments.length > 0,
    attachmentCount: () => attachments.length,
  };
}

/* ------------------------------------------------------------------ helpers */

/** Rows x columns dialog; `insert` is called with a matrix. */
export function openTableDialog(editor) {
  const modal = document.getElementById('tableModal');
  const form = document.getElementById('tableForm');
  if (!modal || !form) return;
  modal.classList.remove('hidden');
  modal.classList.add('grid');
  const rowsInput = document.getElementById('tableRows');
  const colsInput = document.getElementById('tableCols');
  const headerRow = document.getElementById('tableHeaderRow');
  rowsInput.focus();
  rowsInput.select();

  const close = () => {
    modal.classList.add('hidden');
    modal.classList.remove('grid');
    form.removeEventListener('submit', onSubmit);
  };
  const onSubmit = (event) => {
    event.preventDefault();
    const rows = Math.min(Math.max(Number(rowsInput.value) || 3, 1), 60);
    const cols = Math.min(Math.max(Number(colsInput.value) || 3, 1), 20);
    const withHeader = headerRow.checked;
    const before = editor.state.doc.content.size;
    editor
      .chain()
      .focus()
      .insertTable({ rows, cols, withHeaderRow: withHeader })
      .run();
    // Put the caret in the first cell so the table toolbars appear immediately.
    const tablePos = editor.state.doc.content.size !== before ? findTableStart(editor) : null;
    if (tablePos !== null) focusFirstCell(editor, tablePos);
    close();
  };
  form.addEventListener('submit', onSubmit);
  modal._onClose = close;
}

const EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤩', '🥳',
  '😅', '🙃', '😉', '🤔', '🤨', '😐', '🙄', '😴', '😮', '😢',
  '😭', '😤', '😡', '🤯', '😱', '🤗', '🤝', '👍', '👎', '👏',
  '🙏', '💪', '👋', '✌️', '🤙', '❤️', '🧡', '💛', '💚', '💙',
  '💜', '🖤', '🔥', '✨', '🎉', '🎊', '✅', '❌', '⚡', '💡',
  '📌', '📎', '📊', '📈', '📉', '🗂️', '📁', '🖼️', '🚀', '⏰',
];

export function toggleEmojiPicker(anchor, onPick) {
  const existing = document.getElementById('emojiPicker');
  if (existing && !existing.classList.contains('hidden')) {
    existing.classList.add('hidden');
    return;
  }
  const picker = existing || document.createElement('div');
  picker.id = 'emojiPicker';
  picker.className = 'card fixed z-[65] w-[300px] p-2';
  picker.innerHTML = `<div class="emoji-grid">${EMOJIS.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join('')}</div>`;
  if (!picker.isConnected) document.body.appendChild(picker);
  picker.classList.remove('hidden');
  const rect = anchor.getBoundingClientRect();
  picker.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 316))}px`;
  picker.style.top = `${Math.max(8, rect.top - 250)}px`;

  const onClick = (event) => {
    const button = event.target.closest('[data-emoji]');
    if (!button) return;
    onPick(button.dataset.emoji);
    picker.classList.add('hidden');
    document.removeEventListener('click', onOutside);
  };
  const onOutside = (event) => {
    if (!picker.contains(event.target) && event.target !== anchor) {
      picker.classList.add('hidden');
      document.removeEventListener('click', onOutside);
    }
  };
  picker.onclick = onClick;
  setTimeout(() => document.addEventListener('click', onOutside), 0);
}

/** Finds the position of the table containing (or nearest to) the selection. */
function findTableStart(editor) {
  const { selection } = editor.state;
  if (selection.node?.type?.name === 'table') return selection.from;
  for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
    const node = selection.$from.node(depth);
    if (node.type.name === 'table') return selection.$from.before(depth);
  }
  // Nothing selected inside a table: use the last table in the document.
  let last = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'table') last = pos;
  });
  return last;
}

export { insertMatrix };
