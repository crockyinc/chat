import { io } from 'socket.io-client';
import { backendOrigin } from './backend.js';

/**
 * Socket.io client with automatic reconnection and a small event bus.
 * Everything travels over the same origin — no external relay, ever.
 */
export function createSocket({ onStatus } = {}) {
  const socket = io(backendOrigin() || undefined, {
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    timeout: 8000,
  });

  const handlers = new Map();

  socket.on('connect', () => onStatus?.('online'));
  socket.on('disconnect', (reason) => onStatus?.(reason === 'io client disconnect' ? 'offline' : 'reconnecting'));
  socket.on('connect_error', (err) => {
    onStatus?.(err?.message === 'unauthorized' ? 'unauthorized' : 'reconnecting');
  });
  socket.io.on('reconnect_attempt', () => onStatus?.('reconnecting'));

  function on(event, handler) {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event).add(handler);
    socket.on(event, handler);
    return () => off(event, handler);
  }

  function off(event, handler) {
    handlers.get(event)?.delete(handler);
    socket.off(event, handler);
  }

  /** Promise-based emit with an ack; rejects on timeout or server error. */
  function call(event, payload, timeout = 10000) {
    return new Promise((resolve, reject) => {
      socket.timeout(timeout).emit(event, payload, (err, response) => {
        if (err) return reject(new Error('The server did not respond in time'));
        if (response && response.ok === false) {
          const error = new Error(response.error || 'Request failed');
          error.status = response.status;
          return reject(error);
        }
        resolve(response);
      });
    });
  }

  return {
    socket,
    on,
    off,
    call,
    get connected() {
      return socket.connected;
    },
    disconnect() {
      socket.disconnect();
    },
    /** Re-identify after the session is refreshed without a full reload. */
    refresh() {
      socket.disconnect();
      socket.connect();
    },
  };
}
