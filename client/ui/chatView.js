import { renderMessage, renderMessageList, formatTime, previewText, stripTags } from './messages.js';
import { icon, mountIcons } from './icons.js';
import { avatarColor, initialsFor, shortSerial } from '../lib/device.js';

/**
 * Renders the timeline and keeps the scroll position sane while messages
 * stream in. The heavy lifting (state) lives in the store; this module only
 * touches the DOM.
 */
export function createChatView({ store, elements, myId, onOpenImage, onDelete, onJump }) {
  const { list, scrollArea, emptyState, loadMoreWrap, loadMore, jumpBottom } = elements;
  let stickToBottom = true;
  let lastRenderedCount = 0;

  const nearBottom = () => scrollArea.scrollHeight - scrollArea.scrollTop - scrollArea.clientHeight < 120;

  scrollArea.addEventListener('scroll', () => {
    stickToBottom = nearBottom();
    jumpBottom?.classList.toggle('hidden', stickToBottom);
    if (scrollArea.scrollTop < 60) onJump?.(!lastRenderedCount === 0);
  });

  function render({ force = false } = {}) {
    const messages = store.visibleMessages();
    const shouldStick = force || stickToBottom;
    list.innerHTML = renderMessageList(messages, { myId });
    lastRenderedCount = messages.length;
    emptyState.classList.toggle('hidden', messages.length > 0);
    emptyState.classList.toggle('grid', messages.length === 0);
    loadMoreWrap.classList.toggle('hidden', !store.state.hasMore);
    if (shouldStick) scrollToBottom('auto');
    mountIcons(list);
  }

  function appendMessages(newMessages) {
    const messages = store.visibleMessages();
    if (!messages.length) return render();
    const wasNear = nearBottom();
    // Cheap path: if nothing is filtered, append only the new markup.
    const filtered = Boolean(store.state.search || store.state.filterAuthor);
    if (!filtered && lastRenderedCount < messages.length) {
      const newIds = new Set(newMessages.map((message) => message.id));
      const firstIndex = messages.findIndex((message) => newIds.has(message.id));
      const previous = firstIndex > 0 ? messages[firstIndex - 1] : null;
      let html = '';
      let prev = previous;
      let dayKey = prev ? new Date(prev.createdAt).toDateString() : null;
      for (const message of messages.slice(Math.max(firstIndex, 0))) {
        const key = new Date(message.createdAt).toDateString();
        const showDay = key !== dayKey;
        html += renderMessage(message, { myId, previous: prev, showDay });
        dayKey = key;
        prev = message;
      }
      list.insertAdjacentHTML('beforeend', html);
      mountIcons(list);
      lastRenderedCount += newMessages.length;
      emptyState.classList.add('hidden');
      emptyState.classList.remove('grid');
      if (wasNear) scrollToBottom('smooth');
      else jumpBottom?.classList.remove('hidden');
      return;
    }
    render();
  }

  function scrollToBottom(behavior = 'auto') {
    requestAnimationFrame(() => {
      // `scrollTo` options are not implemented everywhere; fall back to scrollTop.
      if (typeof scrollArea.scrollTo === 'function') {
        try {
          scrollArea.scrollTo({ top: scrollArea.scrollHeight, behavior });
        } catch {
          scrollArea.scrollTop = scrollArea.scrollHeight;
        }
      } else {
        scrollArea.scrollTop = scrollArea.scrollHeight;
      }
      jumpBottom?.classList.add('hidden');
    });
  }

  function prependHistory() {
    const before = scrollArea.scrollHeight;
    render({ force: false });
    const after = scrollArea.scrollHeight;
    scrollArea.scrollTop = after - before;
  }

  /* -------------------------------------------------------------- interactions */

  list.addEventListener('click', (event) => {
    const copy = event.target.closest('[data-copy-serial]');
    if (copy) {
      navigator.clipboard?.writeText(copy.dataset.copySerial).then(() => {
        const original = copy.textContent;
        copy.textContent = 'copied!';
        setTimeout(() => {
          copy.textContent = original;
        }, 900);
      });
      return;
    }

    const image = event.target.closest('[data-lightbox]');
    if (image) {
      onOpenImage?.(image.dataset.lightbox, image.dataset.filename);
      return;
    }

    const menu = event.target.closest('[data-menu-message]');
    if (menu) {
      openMessageMenu(menu, Number(menu.dataset.menuMessage));
    }
  });

  function openMessageMenu(anchor, id) {
    document.querySelectorAll('[data-msg-menu]').forEach((el) => el.remove());
    const message = store.state.messages.find((m) => m.id === id);
    if (!message) return;
    const rect = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.dataset.msgMenu = 'true';
    menu.className = 'card fixed z-[75] w-44 overflow-hidden p-1 text-sm';
    menu.style.left = `${Math.min(rect.left, window.innerWidth - 190)}px`;
    menu.style.top = `${rect.bottom + 6}px`;
    menu.innerHTML = `
      <button class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/10" data-copy-text>
        ${icon('copy', { size: 15 })} Copy text
      </button>
      <button class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/10" data-copy-html>
        ${icon('fileText', { size: 15 })} Copy as formatted
      </button>
      ${
        message.authorId === myId
          ? `<button class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10" data-delete>
              ${icon('trash', { size: 15 })} Delete message
            </button>`
          : ''
      }`;
    document.body.appendChild(menu);
    const close = (event) => {
      if (!menu.contains(event.target)) {
        menu.remove();
        document.removeEventListener('mousedown', close);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', close), 0);

    menu.querySelector('[data-copy-text]')?.addEventListener('click', () => {
      navigator.clipboard?.writeText(stripTags(message.body) || message.attachment?.filename || '');
      menu.remove();
    });
    menu.querySelector('[data-copy-html]')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([message.body || ''], { type: 'text/html' }),
            'text/plain': new Blob([stripTags(message.body)], { type: 'text/plain' }),
          }),
        ]);
      } catch {
        navigator.clipboard?.writeText(stripTags(message.body));
      }
      menu.remove();
    });
    menu.querySelector('[data-delete]')?.addEventListener('click', () => {
      menu.remove();
      onDelete?.(id);
    });
  }

  return {
    render,
    appendMessages,
    scrollToBottom,
    prependHistory,
    isNearBottom: nearBottom,
    resetScrollMemory() {
      stickToBottom = true;
      lastRenderedCount = 0;
    },
  };
}

export { formatTime, previewText, initialsFor, avatarColor, shortSerial };
