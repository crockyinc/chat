import { api } from './lib/api.js';
import { createSocket } from './lib/socket.js';
import { createStore } from './lib/store.js';
import {
  getDeviceId,
  getDisplayName,
  setDisplayName,
  applyTheme,
  toggleTheme,
  initialsFor,
  avatarColor,
  shortSerial,
  getTheme,
} from './lib/device.js';
import { mountIcons, icon } from './ui/icons.js';
import { createToolbar, setToastHandler } from './editor/toolbar.js';
import { createChatView } from './ui/chatView.js';
import { createComposer } from './ui/composer.js';
import { createEditorModal } from './ui/editorModal.js';
import { formatBytes } from './ui/messages.js';

/* ------------------------------------------------------------------ boot */

const $ = (id) => document.getElementById(id);

const els = {
  app: $('app'),
  sidebar: $('sidebar'),
  sidebarToggle: $('sidebarToggle'),
  messageList: $('messageList'),
  scrollArea: $('scrollArea'),
  emptyState: $('emptyState'),
  loadMore: $('loadMore'),
  loadMoreWrap: $('loadMoreWrap'),
  jumpBottom: $('jumpBottom'),
  myAvatar: $('myAvatar'),
  myName: $('myName'),
  mySerial: $('mySerial'),
  profileCard: $('profileCard'),
  deviceList: $('deviceList'),
  onlineCount: $('onlineCount'),
  connDot: $('connDot'),
  connLabel: $('connLabel'),
  headerTitle: $('headerTitle'),
  headerSub: $('headerSub'),
  roomName: $('roomName'),
  typingBar: $('typingBar'),
  typingText: $('typingText'),
  searchInput: $('searchInput'),
  joinModal: $('joinModal'),
  joinForm: $('joinForm'),
  joinName: $('joinName'),
  joinSerial: $('joinSerial'),
  joinPassword: $('joinPassword'),
  passwordWrap: $('passwordWrap'),
  joinError: $('joinError'),
  profileModal: $('profileModal'),
  profileForm: $('profileForm'),
  profileName: $('profileName'),
  profileSerial: $('profileSerial'),
  profileAvatar: $('profileAvatar'),
  profileNamePreview: $('profileNamePreview'),
  infoModal: $('infoModal'),
  qrImage: $('qrImage'),
  lanUrlList: $('lanUrlList'),
  lightbox: $('lightbox'),
  lightboxImage: $('lightboxImage'),
  lightboxDownload: $('lightboxDownload'),
  toasts: $('toasts'),
};

setToastHandler((message) => toast(message));

const deviceId = getDeviceId();
const store = createStore();
let socket = null;
let composer = null;
let modalEditor = null;
let chatView = null;
let myProfile = { deviceId, displayName: getDisplayName() };
let signedIn = false;

/* ---------------------------------------------------------------- toasts */

function toast(message, tone = 'info') {
  const node = document.createElement('div');
  node.className = `pointer-events-auto flex w-full items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold shadow-panel ${
    tone === 'error' ? 'bg-red-600 text-white' : 'bg-[color:var(--panel-bg)] text-[color:var(--text)] border'
  }`;
  if (tone !== 'error') node.style.borderColor = 'var(--border)';
  node.innerHTML = `${icon(tone === 'error' ? 'alert' : 'check', { size: 16 })}<span class="flex-1">${escapeHtml(message)}</span>`;
  els.toasts.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .3s, transform .3s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 320);
  }, 2800);
}

const escapeHtml = (value = '') =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------------------------------------------------------------- identity */

function renderIdentity() {
  const name = myProfile.displayName || 'Set your name';
  if (els.myName) els.myName.textContent = name;
  if (els.mySerial) els.mySerial.textContent = `#${shortSerial(deviceId)}`;
  if (els.myAvatar) {
    els.myAvatar.textContent = initialsFor(myProfile.displayName, deviceId);
    els.myAvatar.style.background = avatarColor(deviceId);
  }
  if (els.profileAvatar) {
    els.profileAvatar.textContent = initialsFor(myProfile.displayName, deviceId);
    els.profileAvatar.style.background = avatarColor(deviceId);
  }
  if (els.profileNamePreview) els.profileNamePreview.textContent = myProfile.displayName || 'No display name';
  if (els.joinSerial) els.joinSerial.value = deviceId;
  if (els.profileSerial) els.profileSerial.value = deviceId;
  if (els.headerSub && signedIn) {
    els.headerSub.textContent = `${onlineLabel()}`;
  }
  document.title = myProfile.displayName ? `${myProfile.displayName} · LAN Messenger` : 'LAN Messenger';
}

function onlineLabel() {
  const online = [...store.state.users.values()].filter((u) => u.online).length;
  return online > 1 ? `${online} devices online` : 'Only you here — invite another device';
}

/* ------------------------------------------------------------ room metadata */

async function loadRoom() {
  try {
    const room = await api.room();
    if (els.roomName) els.roomName.textContent = room.name;
    if (els.headerTitle) els.headerTitle.textContent = room.name;
    if (room.requiresPassword) {
      els.passwordWrap?.removeAttribute('hidden');
    }
    return room;
  } catch {
    toast('Cannot reach the server', 'error');
    return null;
  }
}

/* -------------------------------------------------------------------- auth */

async function identify({ displayName, password }) {
  const result = await api.identify(deviceId, displayName, password);
  myProfile = { deviceId: result.deviceId, displayName: result.displayName || displayName || '' };
  setDisplayName(myProfile.displayName);
  signedIn = true;
  store.state.me = myProfile;
  renderIdentity();
}

async function boot() {
  applyTheme(getTheme());
  mountIcons(document);
  renderIdentity();
  bindGlobalUi();

  const room = await loadRoom();

  // Try to resume the existing session first.
  try {
    const me = await api.me();
    myProfile = { deviceId: me.deviceId, displayName: me.displayName };
    setDisplayName(me.displayName);
    signedIn = true;
    renderIdentity();
  } catch {
    signedIn = false;
  }

  if (!signedIn) {
    openJoin(room);
  } else {
    startChat();
  }
}

function openJoin(room) {
  els.joinModal.classList.remove('hidden');
  els.joinModal.classList.add('grid');
  els.joinName.value = getDisplayName();
  els.joinSerial.value = deviceId;
  if (room?.requiresPassword) els.passwordWrap.removeAttribute('hidden');
  setTimeout(() => els.joinName.focus(), 100);
}

els.joinForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  els.joinError.classList.add('hidden');
  try {
    await identify({ displayName: els.joinName.value, password: els.joinPassword.value });
    els.joinModal.classList.add('hidden');
    els.joinModal.classList.remove('grid');
    startChat();
  } catch (err) {
    els.joinError.textContent = err.message || 'Could not join';
    els.joinError.classList.remove('hidden');
  }
});

/* ------------------------------------------------------------------- chat */

function setConnection(status) {
  store.state.connection = status;
  const map = {
    online: ['text', 'Live · synced', 'bg-emerald-500'],
    reconnecting: ['text', 'Reconnecting…', 'bg-amber-500'],
    connecting: ['text', 'Connecting…', 'bg-amber-500'],
    unauthorized: ['text', 'Signed out', 'bg-red-500'],
    offline: ['text', 'Offline', 'bg-gray-400'],
  };
  const [, label, dot] = map[status] || map.connecting;
  if (els.connLabel) els.connLabel.textContent = label;
  if (els.connDot) els.connDot.className = `inline-block h-2 w-2 rounded-full ${dot}`;
  if (status === 'unauthorized') reconnectSession();
}

async function reconnectSession() {
  try {
    await identify({ displayName: myProfile.displayName, password: '' });
    socket?.refresh();
    loadHistory({ initial: true });
  } catch {
    toast('Session expired — reload the page', 'error');
  }
}

function startChat() {
  mountIcons(document);

  chatView = createChatView({
    store,
    elements: {
      list: els.messageList,
      scrollArea: els.scrollArea,
      emptyState: els.emptyState,
      loadMoreWrap: els.loadMoreWrap,
      loadMore: els.loadMore,
      jumpBottom: els.jumpBottom,
    },
    myId: deviceId,
    onOpenImage: openLightbox,
    onDelete: deleteMessage,
    onJump: () => loadOlderMessages(),
  });

  composer = createComposer({
    editorElement: $('composerEditor'),
    toolbarElement: $('composerToolbar'),
    cellToolbarElement: $('cellToolbarComposer'),
    onTyping: (isTyping) => socket?.socket?.emit('typing', { isTyping }),
    onUpload: (files) => api.upload(files),
    onSend: async (payload) => {
      if (payload.type === 'toast') return toast(payload.message, payload.tone);
      if (!socket?.connected) throw new Error('Not connected to the server');
      const body = payload.html;
      const text = body.replace(/<[^>]+>/g, '').trim();
      if (!text && !payload.attachmentIds.length) return;
      await socket.call('message:send', { body, attachmentIds: payload.attachmentIds });
      chatView.scrollToBottom('smooth');
    },
  });

  // Cell formatting toolbar for tables edited in the small composer.
  createToolbar({
    root: $('cellToolbarComposer'),
    editor: composer.editor,
    variant: 'compact',
    scope: 'cell',
  });
  const syncComposerCellToolbar = () => {
    const inCell = composer.editor.isActive('tableCell') || composer.editor.isActive('tableHeader');
    const host = $('cellToolbarComposer');
    if (!host) return;
    host.classList.toggle('hidden', !inCell);
    host.classList.toggle('flex', inCell);
  };
  composer.editor.on('selectionUpdate', syncComposerCellToolbar);

  modalEditor = createEditorModal({
    getInitialHtml: () => (composer?.editor.isEmpty ? '' : composer?.editor.getHTML()),
    onChange: (html) => composer?.setContent(html, { focus: false }),
    onUpload: (files) => api.upload(files),
    onToast: toast,
    onSend: async (html) => {
      if (!socket?.connected) throw new Error('Not connected to the server');
      await socket.call('message:send', { body: html, attachmentIds: [] });
      composer?.clear();
      chatView.scrollToBottom('smooth');
    },
  });

  connectSocket();
  loadHistory({ initial: true });
  renderIdentity();
  if (window.innerWidth >= 1024) composer.focus();
}

/* ----------------------------------------------------------------- socket */

function connectSocket() {
  socket = createSocket({ onStatus: setConnection });

  socket.on('hello', (payload) => {
    if (payload?.me?.displayName !== undefined && !myProfile.displayName && payload.me.displayName) {
      myProfile.displayName = payload.me.displayName;
      setDisplayName(myProfile.displayName);
      renderIdentity();
    }
    store.setUsers(payload?.roster?.users || []);
    renderDevices();
    updateHeader();
  });

  socket.on('presence:update', (payload) => {
    store.setUsers(payload?.users || []);
    renderDevices();
    updateHeader();
  });

  socket.on('message:new', (message) => {
    const added = store.addMessage(message);
    if (!added) return;
    renderNewMessages([message]);
    if (message.authorId !== deviceId) maybeNotify(message);
  });

  socket.on('message:deleted', ({ id }) => {
    store.removeMessage(id);
    document.querySelector(`[data-id="${id}"]`)?.remove();
    if (!store.state.messages.length) chatView.render();
  });

  socket.on('profile:changed', ({ deviceId: id, displayName }) => {
    store.upsertUser({ deviceId: id, displayName });
    // Refresh author labels for that device.
    document.querySelectorAll(`.msg-row[data-author="${CSS.escape(id)}"] .msg-author`).forEach((node) => {
      node.textContent = displayName || 'Unnamed device';
    });
    renderDevices();
  });

  socket.on('typing', (payload) => {
    if (payload.deviceId === deviceId) return;
    store.setTyping(payload);
  });

  socket.on('server:error', ({ message }) => toast(message, 'error'));

  store.on('typing', (entries) => {
    if (!els.typingBar) return;
    const others = entries.filter((entry) => entry && entry.displayName !== myProfile.displayName);
    els.typingBar.classList.toggle('hidden', !others.length);
    els.typingBar.classList.toggle('flex', others.length > 0);
    if (others.length && els.typingText) {
      const names = [...new Set(entries.map((entry) => entry.displayName || 'Someone'))];
      els.typingText.textContent = names.length === 1 ? `${names[0]} is typing…` : `${names.length} people are typing…`;
    }
  });
}

function renderNewMessages(messages) {
  chatView.appendMessages(messages);
  updateHeader();
}

function updateHeader() {
  if (!els.headerSub) return;
  const filter = store.state.filterAuthor;
  if (filter) {
    const user = store.state.users.get(filter);
    els.headerSub.innerHTML = `<button class="font-semibold text-brand-500" data-clear-filter>Showing ${escapeHtml(
      user?.displayName || `#${shortSerial(filter)}`,
    )} · clear</button>`;
    return;
  }
  els.headerSub.textContent = onlineLabel();
}

/* ---------------------------------------------------------------- history */

let loadingHistory = false;

async function loadHistory({ initial = false } = {}) {
  try {
    const result = initial ? await socket.call('message:history', { limit: 80 }) : await api.history(80);
    const messages = result.messages || [];
    if (initial) {
      store.reset(messages);
    } else {
      store.addMessages(messages);
    }
    store.state.hasMore = Boolean(result.hasMore);
    chatView.render({ force: initial });
    if (initial) chatView.scrollToBottom('auto');
  } catch (err) {
    if (initial) chatView.render();
    console.warn('history failed', err);
  }
}

async function loadOlderMessages() {
  if (loadingHistory) return;
  const oldest = store.state.messages[0];
  if (!oldest || !store.state.hasMore) return;
  loadingHistory = true;
  try {
    const result = await api.history(60, oldest.id);
    store.addMessages(result.messages || [], { prepend: true });
    store.state.hasMore = Boolean(result.hasMore);
    chatView.render();
    els.loadMoreWrap.classList.toggle('hidden', !store.state.hasMore);
  } catch (err) {
    toast(err.message || 'Could not load older messages', 'error');
  } finally {
    loadingHistory = false;
  }
}

els.loadMore?.addEventListener('click', loadOlderMessages);

/* ------------------------------------------------------------- send/delete */

async function deleteMessage(id) {
  try {
    await socket.call('message:delete', { id });
    toast('Message deleted');
  } catch (err) {
    toast(err.message || 'Could not delete', 'error');
  }
}

/* ----------------------------------------------------------------- devices */

function renderDevices() {
  const me = { deviceId, displayName: myProfile.displayName, online: true };
  const others = [...store.state.users.values()].filter((user) => user.deviceId !== deviceId);
  const all = [me, ...others];
  if (els.onlineCount) {
    const online = all.filter((u) => u.online || u.deviceId === deviceId).length;
    els.onlineCount.textContent = String(online);
  }
  if (!els.deviceList) return;
  els.deviceList.innerHTML = all
    .map((user) => {
      const active = store.state.filterAuthor === user.deviceId;
      const isMe = user.deviceId === deviceId;
      return `<button type="button" class="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition ${
        active ? 'bg-brand-50 dark:bg-brand-500/15' : 'hover:bg-black/5 dark:hover:bg-white/5'
      }" data-filter="${escapeHtml(user.deviceId)}" title="${
        isMe ? 'You' : 'Show only this device'
      }">
        <span class="relative grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
          style="background:${avatarColor(user.deviceId)}">${escapeHtml(initialsFor(user.displayName, user.deviceId))}
          <span class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[color:var(--panel-bg)] ${
            user.online || isMe ? 'bg-emerald-500' : 'bg-gray-400'
          }"></span>
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[13px] font-semibold">${escapeHtml(user.displayName || 'Unnamed device')}${
            isMe ? ' <span class="font-normal muted">(you)</span>' : ''
          }</span>
          <span class="block truncate font-mono text-[10.5px] muted">#${escapeHtml(shortSerial(user.deviceId))}</span>
        </span>
      </button>`;
    })
    .join('');
}

els.deviceList?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  const id = button.dataset.filter;
  if (id === deviceId) {
    store.state.filterAuthor = null;
  } else {
    store.state.filterAuthor = store.state.filterAuthor === id ? null : id;
  }
  renderDevices();
  chatView.render();
  updateHeader();
  els.sidebar.classList.add('max-lg:-translate-x-full');
  document.getElementById('sidebarBackdrop')?.classList.add('hidden');
});

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-clear-filter]')) {
    store.state.filterAuthor = null;
    renderDevices();
    chatView.render();
    updateHeader();
  }
});

/* --------------------------------------------------------------- search */

let searchTimer = null;
els.searchInput?.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    store.state.search = els.searchInput.value;
    chatView.render();
  }, 180);
});

/* -------------------------------------------------------------- lightbox */

function openLightbox(url, filename = 'image') {
  els.lightboxImage.src = url;
  els.lightboxImage.alt = filename;
  els.lightboxDownload.href = url;
  els.lightboxDownload.setAttribute('download', filename);
  els.lightbox.classList.remove('hidden');
  els.lightbox.classList.add('flex');
}

/* ------------------------------------------------------------- modals/ui */

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal._onClose?.();
  modal.classList.add('hidden');
  modal.classList.remove('grid');
  modal.classList.remove('flex');
}

function bindGlobalUi() {
  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => closeModal(button.dataset.close));
  });

  $('themeToggle')?.addEventListener('click', () => {
    toggleTheme();
    mountIcons(document);
  });

  const backdrop = $('sidebarBackdrop');
  const setSidebar = (open) => {
    els.sidebar.classList.toggle('max-lg:-translate-x-full', !open);
    backdrop?.classList.toggle('hidden', !open);
  };
  els.sidebarToggle?.addEventListener('click', () => {
    setSidebar(els.sidebar.classList.contains('max-lg:-translate-x-full'));
  });
  backdrop?.addEventListener('click', () => setSidebar(false));
  // (exposed for tests / LAN debugging)
  window.lm ??= {};
  window.lm.setSidebar = setSidebar;

  els.jumpBottom?.addEventListener('click', () => chatView?.scrollToBottom('smooth'));

  $('copySerialJoin')?.addEventListener('click', () => copySerial(deviceId));
  $('copySerialProfile')?.addEventListener('click', () => copySerial(deviceId));

  els.profileCard?.addEventListener('click', openProfile);
  $('infoButton')?.addEventListener('click', openInfo);
  $('infoButtonTop')?.addEventListener('click', openInfo);
  $('exportButton')?.addEventListener('click', () => {
    window.location.href = '/api/export';
  });

  els.profileForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = els.profileName.value.trim();
    try {
      const result = await api.rename(name);
      myProfile.displayName = result.displayName;
      setDisplayName(result.displayName);
      socket?.socket?.emit('profile:update', { displayName: result.displayName });
      renderIdentity();
      renderDevices();
      closeModal('profileModal');
      toast('Name updated');
    } catch (err) {
      toast(err.message || 'Could not save', 'error');
    }
  });

  els.profileName?.addEventListener('input', () => {
    if (els.profileNamePreview) els.profileNamePreview.textContent = els.profileName.value.trim() || 'No display name';
    if (els.profileAvatar) els.profileAvatar.textContent = initialsFor(els.profileName.value, deviceId);
  });

  els.lightbox?.addEventListener('click', (event) => {
    if (event.target === els.lightbox) closeModal('lightbox');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !els.lightbox.classList.contains('hidden')) closeModal('lightbox');
  });
}

async function copySerial(id) {
  try {
    await navigator.clipboard.writeText(id);
    toast('Device serial copied');
  } catch {
    toast('Copy failed', 'error');
  }
}

function openProfile() {
  els.profileName.value = myProfile.displayName || '';
  els.profileSerial.value = deviceId;
  els.profileNamePreview.textContent = myProfile.displayName || 'No display name';
  els.profileModal.classList.remove('hidden');
  els.profileModal.classList.add('grid');
  setTimeout(() => els.profileName.focus(), 50);
  els.profileModal._onClose = () => {
    renderIdentity();
  };
}

async function openInfo() {
  els.infoModal.classList.remove('hidden');
  els.infoModal.classList.add('grid');
  const room = await loadRoom();
  const urls = room?.lanUrls?.length ? room.lanUrls : [window.location.origin];
  els.lanUrlList.innerHTML = urls
    .map(
      (url) => `<button type="button" class="flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs font-mono hover:bg-black/5 dark:hover:bg-white/5"
        style="border-color:var(--border)" data-copy-url="${escapeHtml(url)}">
        ${icon('wifi', { size: 14 })}<span class="flex-1 truncate">${escapeHtml(url)}</span>${icon('copy', { size: 13 })}
      </button>`,
    )
    .join('');
  els.lanUrlList.querySelectorAll('[data-copy-url]').forEach((button) =>
    button.addEventListener('click', () => copySerial(button.dataset.copyUrl)),
  );
  if (urls[0]) {
    els.qrImage.src = `/api/qr?url=${encodeURIComponent(urls[0])}`;
    els.qrImage.hidden = false;
  }
}

/* ------------------------------------------------------- notifications */

let notifyPermissionAsked = false;
function maybeNotify(message) {
  if (document.visibilityState === 'visible') return;
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    const body = message.kind === 'image' ? 'Sent a photo' : String(message.body || '').replace(/<[^>]+>/g, ' ').slice(0, 120);
    new Notification(message.authorName || `#${shortSerial(message.authorId)}`, { body, icon: '/favicon.ico' });
  } else if (Notification.permission === 'default' && !notifyPermissionAsked) {
    notifyPermissionAsked = true;
    Notification.requestPermission().catch(() => {});
  }
}

/* ------------------------------------------------------------------ start */

boot();

// Expose a tiny debug handle (handy when testing over the LAN).
window.lm = { store, api, get socket() { return socket; }, get composer() { return composer; }, get editor() { return composer?.editor; } };
