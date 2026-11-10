import express from 'express';
import { signAttachmentUrl } from '../security.js';

const LOCAL_ATTACHMENT = /(<img\b[^>]*?\bsrc=")\/uploads\/attachments\/([0-9a-f-]{36})(?:"|\.(?:png|jpe?g|webp|gif|avif)")/gi;

/**
 * Inline images pasted into rich text point at `/uploads/attachments/<id>`;
 * signed URLs are added on the way out so the raw id is never enough on its own.
 */
export function signInlineImages(html = '') {
  return String(html).replace(LOCAL_ATTACHMENT, (_match, prefix, id) => `${prefix}${signAttachmentUrl(id)}"`);
}

export function serializeMessage(message) {
  if (!message) return null;
  return {
    ...message,
    body: signInlineImages(message.body),
    attachment: message.attachment
      ? { ...message.attachment, url: signAttachmentUrl(message.attachment.id) }
      : null,
  };
}

export function messageRoutes({ db, emit }) {
  const router = express.Router();

  /** Paginated history, newest page first. */
  router.get('/', (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
    const before = req.query.before ? Number(req.query.before) : null;
    const messages = db.listMessages({ limit, before });
    res.json({ messages: messages.map(serializeMessage), hasMore: messages.length === limit });
  });

  /** REST fallback for posting (the socket is the primary path). */
  router.post('/', (req, res) => {
    try {
      const messages = emit.createMessage(req.body || {}, req.deviceId);
      res.status(201).json({ messages });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.getMessage(id);
    if (!existing) return res.status(404).json({ error: 'Message not found' });
    if (existing.authorId !== req.deviceId) {
      return res.status(403).json({ error: 'You can only delete your own messages' });
    }
    db.deleteMessage(id);
    emit.deleted(id);
    res.status(204).end();
  });

  return router;
}
