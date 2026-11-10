import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  host: env.HOST || '0.0.0.0',
  root: ROOT,
  publicDir: path.join(ROOT, 'public'),
  uploadsDir: path.resolve(env.UPLOADS_DIR || path.join(ROOT, 'uploads')),
  dataDir: path.resolve(env.DATA_DIR || path.join(ROOT, 'data')),
  dbFile: path.resolve(env.DB_FILE || path.join(env.DATA_DIR || path.join(ROOT, 'data'), 'lan-messenger.db')),
  /** Maximum size of a single uploaded image (bytes). */
  maxUploadBytes: Number(env.MAX_UPLOAD_MB || 12) * 1024 * 1024,
  /** Maximum size of the JSON body used for text messages (bytes). */
  maxJsonBytes: Number(env.MAX_JSON_MB || 8) * 1024 * 1024,
  /** How many messages a newly connected device receives on join. */
  historyLimit: Number(env.HISTORY_LIMIT || 200),
  /** Messages older than this are pruned on startup (0 = keep forever). */
  retentionDays: Number(env.RETENTION_DAYS || 0),
  /** Optional shared room password. Empty string = open LAN mode. */
  roomPassword: env.ROOM_PASSWORD || '',
  roomName: env.ROOM_NAME || 'Local LAN Chat',
  /** Trust X-Forwarded-For (only needed behind a proxy). */
  trustProxy: env.TRUST_PROXY === '1',
};

export const paths = {
  ...config,
  attachmentsDir: path.join(config.uploadsDir, 'attachments'),
};

export function ensureDirs() {
  for (const dir of [config.uploadsDir, paths.attachmentsDir, config.dataDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * A stable per-install secret used to sign attachment URLs and auth cookies,
 * so nobody has to configure an API key. Kept on disk next to the database.
 */
export function installSecret() {
  ensureDirs();
  const file = path.join(config.dataDir, '.secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

/** All non-internal IPv4 addresses, useful for the "open this on your phone" hint. */
export function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) out.push({ name, address: addr.address });
    }
  }
  return out;
}
