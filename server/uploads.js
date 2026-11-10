import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { paths, config } from './config.js';
import { authenticate, verifyAttachmentSignature } from './security.js';

export const IMAGE_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/avif', 'avif'],
]);

const EXT_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, paths.attachmentsDir),
  filename: (_req, file, cb) => {
    const id = crypto.randomUUID();
    const ext = IMAGE_TYPES.get(file.mimetype) || EXT_TYPES.get(path.extname(file.originalname).toLowerCase()) || 'bin';
    cb(null, `${id}.${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes, files: 6 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_TYPES.has(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error('Only PNG, JPG, WebP, GIF or AVIF images are allowed'), { status: 415 }));
  },
});

export function requireAuth(req, res, next) {
  const session = authenticate(req);
  if (!session?.deviceId) return res.status(401).json({ error: 'Not signed in' });
  req.deviceId = session.deviceId;
  next();
}

export function attachmentsRouter() {
  const router = express.Router();

  // Serve an attachment only when the signed URL checks out.
  router.get('/:id', (req, res) => {
    const { id } = req.params;
    const { exp, sig } = req.query;
    if (!verifyAttachmentSignature(id, exp, sig)) return res.status(403).send('Link expired — reload the chat.');
    const file = findAttachmentFile(id);
    if (!file) return res.status(404).send('Not found');
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(file.path).pipe(res);
  });

  return router;
}

/** Upload one or more images. Returns attachment metadata (not yet linked to a message). */
export function uploadRouter(onUploaded) {
  const router = express.Router();

  router.post('/', requireAuth, (req, res) => {
    upload.array('images', 6)(req, res, (err) => {
      if (err) {
        const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 400);
        const message =
          err.code === 'LIMIT_FILE_SIZE'
            ? `Image is larger than ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB`
            : err.message;
        return res.status(status).json({ error: message });
      }
      const files = req.files || [];
      if (!files.length) return res.status(400).json({ error: 'No image received' });
      const created = files.map((file) => {
        const id = path.basename(file.filename, path.extname(file.filename));
        const attachment = {
          id,
          filename: safeFilename(file.originalname || file.filename),
          mime: file.mimetype,
          size: file.size,
          file: file.filename,
          createdAt: Date.now(),
        };
        // The original filename is remembered in a tiny sidecar so the message
        // row (created later, when the client sends it) can still show it.
        fs.writeFileSync(
          path.join(paths.attachmentsDir, `${id}.json`),
          JSON.stringify({ filename: attachment.filename, uploadedBy: req.deviceId, uploadedAt: attachment.createdAt }),
        );
        onUploaded?.(attachment, req.deviceId);
        const { file: _file, ...client } = attachment;
        return { ...client, url: `/uploads/attachments/${id}` };
      });
      res.status(201).json({ attachments: created });
    });
  });

  return router;
}

export function findAttachmentFile(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  // (sidecars share the directory but use a .json extension, never matched here)
  for (const [ext, mime] of EXT_TYPES) {
    const file = path.join(paths.attachmentsDir, `${id}${ext}`);
    if (fs.existsSync(file)) return { path: file, mime };
  }
  return null;
}

export function restoreAttachment(id) {
  const found = findAttachmentFile(id);
  if (!found) return null;
  const sidecar = path.join(paths.attachmentsDir, `${id}.json`);
  let filename = path.basename(found.path);
  try {
    const meta = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
    if (meta?.filename) filename = safeFilename(meta.filename);
  } catch {
    /* no sidecar — fall back to the stored name */
  }
  return {
    id,
    filename,
    mime: found.mime,
    size: fs.statSync(found.path).size,
    file: path.basename(found.path),
  };
}

/** Deletes the stored file (and its metadata) for an attachment id. */
export function deleteAttachmentFile(id) {
  const found = findAttachmentFile(id);
  if (found) fs.rmSync(found.path, { force: true });
  fs.rm(path.join(paths.attachmentsDir, `${id}.json`), { force: true }, () => {});
}

/** Keeps display names short and free of path separators / control chars. */
export function safeFilename(name) {
  return String(name || 'image')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[\\/]/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 120) || 'image';
}
