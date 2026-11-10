import { parseCookies, readSessionToken, sanitizePlainText } from './security.js';
import { addSocket, removeSocket, onlineDeviceIds, isOnline, onlineCount } from './presence.js';
import { createRateLimiter } from './security.js';
import { MessageError } from './messages-service.js';

/**
 * Socket.io wiring: authentication, live messaging, presence and typing
 * indicators. Transport is websocket + polling fallback, which works across a
 * LAN even when devices sleep/reconnect aggressively.
 */
export function attachRealtime({ io, db, messages, roomName }) {
  const allowSend = createRateLimiter({ points: 20, windowMs: 10_000 });

  io.use((socket, next) => {
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie || '');
      const session =
        readSessionToken(cookies.lm_session) ||
        readSessionToken(String(socket.handshake.auth?.token || ''));
      if (!session?.deviceId) return next(new Error('unauthorized'));
      socket.data.deviceId = session.deviceId;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  const roster = () => {
    const ids = onlineDeviceIds();
    const users = ids
      .map((id) => db.getUser(id))
      .filter(Boolean)
      .map((u) => ({ deviceId: u.deviceId, displayName: u.displayName, online: true }));
    return { users, count: users.length };
  };

  io.on('connection', (socket) => {
    const deviceId = socket.data.deviceId;
    const user = db.getUser(deviceId);
    if (!user) {
      socket.emit('server:error', { message: 'Unknown device. Please reload the page.' });
      socket.disconnect(true);
      return;
    }

    addSocket(deviceId, socket.id);
    db.touchUser(deviceId);

    socket.emit('hello', {
      room: roomName,
      me: { deviceId, displayName: user.displayName },
      online: onlineCount(),
      roster: roster(),
    });
    io.emit('presence:update', roster());

    /* ------------------------------------------------------------ sending */
    socket.on('message:send', (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (!allowSend(socket.id)) throw new MessageError('Slow down — too many messages', 429);
        const created = messages.createMessage(payload, deviceId);
        reply({ ok: true, clientId: payload?.clientId, messages: created });
      } catch (err) {
        const status = err.status || 400;
        reply({ ok: false, clientId: payload?.clientId, error: err.message, status });
        socket.emit('server:error', { message: err.message });
      }
    });

    socket.on('message:delete', (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        messages.deleteMessage(Number(payload?.id), deviceId);
        reply({ ok: true });
      } catch (err) {
        reply({ ok: false, error: err.message });
      }
    });

    /* ----------------------------------------------------------- presence */
    socket.on('profile:update', (payload, ack) => {
      const name = String(payload?.displayName ?? '').trim();
      if (name.length > 60) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Display name is too long (max 60 chars)' });
        return;
      }
      const updated = db.renameUser(deviceId, name);
      io.emit('presence:update', roster());
      socket.broadcast.emit('profile:changed', { deviceId, displayName: updated.displayName });
      if (typeof ack === 'function') ack({ ok: true, displayName: updated.displayName });
    });

    socket.on('typing', (payload) => {
      socket.broadcast.emit('typing', {
        deviceId,
        displayName: db.getUser(deviceId)?.displayName || '',
        isTyping: Boolean(payload?.isTyping),
      });
    });

    socket.on('message:history', (payload, ack) => {
      if (typeof ack !== 'function') return;
      const before = payload?.before ? Number(payload.before) : null;
      const limit = Math.min(Math.max(Number(payload?.limit) || 50, 1), 300);
      const { serializeMessage } = messages.serialize;
      const rows = db.listMessages({ limit, before });
      ack({ messages: rows.map(serializeMessage), hasMore: rows.length === limit });
    });

    socket.on('disconnect', () => {
      const wentOffline = removeSocket(deviceId, socket.id);
      if (wentOffline) {
        socket.broadcast.emit('typing', { deviceId, isTyping: false });
        io.emit('presence:update', roster());
      }
    });

    socket.on('error', () => {});
  });

  return { roster, isOnline };
}

export { sanitizePlainText };
