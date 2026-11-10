import { sanitizeRichText, sanitizePlainText } from './security.js';
import { config } from './config.js';
import { serializeMessage } from './routes/messages.js';

export const MAX_ATTACHMENTS_PER_MESSAGE = 6;

export class MessageError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Normalises and validates a message payload coming from a client.
 * Rich text is sanitised server-side; images must reference files that were
 * uploaded first (so clients cannot point at arbitrary paths).
 */
export function normalizePayload(payload, { db, restoreAttachment }) {
  const body = sanitizeRichText(payload?.body || '');
  const rawIds = Array.isArray(payload?.attachmentIds) ? payload.attachmentIds : [];
  const ids = [...new Set(rawIds.filter((id) => typeof id === 'string'))].slice(0, MAX_ATTACHMENTS_PER_MESSAGE);

  const attachments = ids.map((id) => restoreAttachment(id)).filter(Boolean);
  if (ids.length && !attachments.length) throw new MessageError('Those images are no longer on the server', 410);

  const hasText = stripHtml(body).trim().length > 0;
  const hasMedia = attachments.length > 0;
  if (!hasText && !hasMedia) throw new MessageError('Message is empty');

  const kind = hasMedia && !hasText ? 'image' : 'text';

  return {
    kind,
    body,
    attachments,
    clientId: payload?.clientId ? sanitizePlainText(payload.clientId).slice(0, 64) : undefined,
  };
}

export function createMessagesService({ db, io, restoreAttachment, deleteAttachmentFile }) {
  function broadcastMessage(message) {
    io.emit('message:new', serializeMessage(message));
  }

  function createMessage(payload, deviceId) {
    const normalized = normalizePayload(payload, { db, restoreAttachment });
    const user = db.getUser(deviceId);
    if (!user) throw new MessageError('Unknown device — reconnect', 401);

    const created = [];
    if (normalized.attachments.length) {
      // One message row holds the text; each image becomes its own message row
      // so images flow into the timeline exactly like Messenger attachments.
      if (normalized.body && stripHtml(normalized.body).trim()) {
        created.push(
          db.insertMessage({
            authorId: deviceId,
            authorName: user.displayName,
            kind: 'text',
            body: normalized.body,
          }),
        );
      }
      for (const att of normalized.attachments) {
        created.push(
          db.insertMessage({
            authorId: deviceId,
            authorName: user.displayName,
            kind: 'image',
            body: '',
            attachment: att,
          }),
        );
      }
    } else {
      created.push(
        db.insertMessage({
          authorId: deviceId,
          authorName: user.displayName,
          kind: 'text',
          body: normalized.body,
        }),
      );
    }

    const messages = created.map((m) => db.getMessage(m.id));
    for (const m of messages) broadcastMessage(m);
    // Return the serialised shape so acknowledgements match broadcasts exactly
    // (attachment URLs are signed and must never leak an unsigned path).
    return messages.map(serializeMessage);
  }

  function deleteMessage(id, deviceId) {
    const existing = db.getMessage(id);
    if (!existing) throw new MessageError('Message not found', 404);
    if (existing.authorId !== deviceId) throw new MessageError('You can only delete your own messages', 403);
    const attachmentId = existing.attachment?.id;
    db.deleteMessage(id);
    if (attachmentId) deleteAttachmentFile?.(attachmentId);
    io.emit('message:deleted', { id, deviceId });
    return true;
  }

  return {
    createMessage,
    deleteMessage,
    broadcastMessage,
    serialize: { serializeMessage },
  };
}

export function stripHtml(html = '') {
  return String(html)
    .replace(/<img[^>]*>/gi, ' [image] ')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function messagePreview(message) {
  if (message.kind === 'image') return '📷 Photo';
  const text = stripHtml(message.body).replace(/\s+/g, ' ').trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

export { config };
