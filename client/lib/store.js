/**
 * Chat state. Deliberately tiny: an ordered list of messages keyed by id, a
 * roster of devices, and subscriptions. No framework required.
 */
export function createStore() {
  const state = {
    messages: [],
    ids: new Set(),
    users: new Map(),
    me: null,
    filterAuthor: null,
    search: '',
    typing: new Map(),
    hasMore: false,
    connection: 'connecting',
    sending: false,
  };

  const listeners = new Map();

  function emit(event, detail) {
    for (const handler of listeners.get(event) || []) handler(detail);
  }

  function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => listeners.get(event)?.delete(handler);
  }

  function addMessage(message) {
    if (!message || state.ids.has(message.id)) return false;
    state.ids.add(message.id);
    // Insert in order (history pages can arrive out of order after a reconnect).
    const last = state.messages[state.messages.length - 1];
    if (!last || last.id < message.id) state.messages.push(message);
    else {
      const index = state.messages.findIndex((m) => m.id > message.id);
      state.messages.splice(index === -1 ? state.messages.length : index, 0, message);
    }
    emit('message', message);
    return true;
  }

  function addMessages(messages = [], { prepend = false } = {}) {
    const fresh = messages.filter((m) => m && !state.ids.has(m.id));
    if (!fresh.length) return [];
    for (const message of fresh) state.ids.add(message.id);
    if (prepend) state.messages.unshift(...fresh);
    else {
      for (const message of fresh) {
        const last = state.messages[state.messages.length - 1];
        if (!last || last.id < message.id) state.messages.push(message);
        else {
          const index = state.messages.findIndex((m) => m.id > message.id);
          state.messages.splice(index === -1 ? state.messages.length : index, 0, message);
        }
      }
    }
    state.messages.sort((a, b) => a.id - b.id);
    return fresh;
  }

  function removeMessage(id) {
    const index = state.messages.findIndex((m) => m.id === id);
    if (index === -1) return false;
    state.messages.splice(index, 1);
    state.ids.delete(id);
    emit('removed', id);
    return true;
  }

  function reset(messages) {
    state.messages = [];
    state.ids = new Set();
    addMessages(messages);
    emit('reset', state.messages);
  }

  function setUsers(users = []) {
    state.users = new Map(users.map((user) => [user.deviceId, user]));
    emit('users', users);
  }

  function upsertUser(user) {
    if (!user?.deviceId) return;
    const existing = state.users.get(user.deviceId) || {};
    state.users.set(user.deviceId, { ...existing, ...user, online: user.online ?? existing.online ?? true });
    emit('users', [...state.users.values()]);
  }

  function setTyping({ deviceId, displayName, isTyping }) {
    if (!deviceId) return;
    if (isTyping) {
      state.typing.set(deviceId, { displayName, at: Date.now() });
      // Auto-expire stale typing indicators.
      setTimeout(() => {
        const entry = state.typing.get(deviceId);
        if (entry && Date.now() - entry.at > 4500) {
          state.typing.delete(deviceId);
          emit('typing', [...state.typing.values()]);
        }
      }, 5000);
    } else {
      state.typing.delete(deviceId);
    }
    emit('typing', [...state.typing.values()]);
  }

  function visibleMessages() {
    const search = state.search.trim().toLowerCase();
    return state.messages.filter((message) => {
      if (state.filterAuthor && message.authorId !== state.filterAuthor) return false;
      if (!search) return true;
      return plainText(message).toLowerCase().includes(search);
    });
  }

  function plainText(message) {
    return `${message.authorName || ''} ${String(message.body || '').replace(/<[^>]+>/g, ' ')} ${message.attachment?.filename || ''}`;
  }

  return {
    state,
    on,
    emit,
    addMessage,
    addMessages,
    removeMessage,
    reset,
    setUsers,
    upsertUser,
    setTyping,
    visibleMessages,
  };
}
