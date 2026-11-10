/**
 * SQLite persistence built on Node's built-in `node:sqlite` module
 * (Node >= 22.5). No native compilation, no external database, no cloud.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

let db = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  device_id    TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id   TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL CHECK (kind IN ('text','image','system')),
  body        TEXT NOT NULL DEFAULT '',
  attachment  TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

CREATE TABLE IF NOT EXISTS attachments (
  id         TEXT PRIMARY KEY,
  message_id INTEGER,
  filename   TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  width      INTEGER,
  height     INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
`;

export function openDatabase(file) {
  if (db) return db;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not opened yet');
  return db;
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

/* ------------------------------------------------------------------ users */

export function upsertUser({ deviceId, displayName, lastSeen = Date.now() }) {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO users (device_id, display_name, created_at, last_seen)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET
         display_name = CASE WHEN excluded.display_name <> '' THEN excluded.display_name
                             ELSE users.display_name END,
         last_seen = excluded.last_seen`,
    )
    .run(deviceId, displayName || '', now, lastSeen);
  return getUser(deviceId);
}

export function getUser(deviceId) {
  return rowToUser(getDb().prepare('SELECT * FROM users WHERE device_id = ?').get(deviceId));
}

export function renameUser(deviceId, displayName) {
  getDb()
    .prepare('UPDATE users SET display_name = ?, last_seen = ? WHERE device_id = ?')
    .run(displayName, Date.now(), deviceId);
  return getUser(deviceId);
}

export function touchUser(deviceId) {
  getDb().prepare('UPDATE users SET last_seen = ? WHERE device_id = ?').run(Date.now(), deviceId);
}

function rowToUser(row) {
  if (!row) return null;
  return {
    deviceId: row.device_id,
    displayName: row.display_name || '',
    createdAt: row.created_at,
    lastSeen: row.last_seen,
  };
}

/* --------------------------------------------------------------- messages */

const MESSAGE_SELECT = `
  SELECT m.*, a.id AS att_id, a.filename AS att_filename, a.mime AS att_mime,
         a.size AS att_size, a.width AS att_width, a.height AS att_height
  FROM messages m
  LEFT JOIN attachments a ON a.message_id = m.id
`;

export function insertMessage({ authorId, authorName, kind, body = '', attachment = null, createdAt = Date.now() }) {
  const database = getDb();
  try {
    return insertMessageUnsafe({ authorId, authorName, kind, body, attachment, createdAt, database });
  } catch (err) {
    console.error('[db] insertMessage failed', { authorId, authorName, kind, attachment, createdAt }, err.message);
    throw err;
  }
}

function insertMessageUnsafe({ authorId, authorName, kind, body, attachment, createdAt, database }) {
  const info = database
    .prepare(
      `INSERT INTO messages (author_id, author_name, kind, body, attachment, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(authorId, authorName || '', kind, body, attachment ? `/uploads/attachments/${attachment.id}` : null, createdAt);
  const messageId = Number(info.lastInsertRowid);

  if (attachment) {
    database
      .prepare(
        `INSERT INTO attachments (id, message_id, filename, mime, size, width, height, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        attachment.id,
        messageId,
        attachment.filename,
        attachment.mime,
        attachment.size,
        attachment.width ?? null,
        attachment.height ?? null,
        Date.now(),
      );
  }
  return getMessage(messageId);
}

export function getMessage(id) {
  return rowToMessage(getDb().prepare(`${MESSAGE_SELECT} WHERE m.id = ?`).get(id));
}

export function listMessages({ limit = 200, before = null } = {}) {
  const database = getDb();
  const rows = before
    ? database
        .prepare(`${MESSAGE_SELECT} WHERE m.id < ? ORDER BY m.id DESC LIMIT ?`)
        .all(before, limit)
    : database.prepare(`${MESSAGE_SELECT} ORDER BY m.id DESC LIMIT ?`).all(limit);
  return rows.map(rowToMessage).reverse();
}

export function deleteMessage(id) {
  return getDb().prepare('DELETE FROM messages WHERE id = ?').run(id).changes > 0;
}

export function pruneMessages(olderThanMs) {
  if (!olderThanMs || olderThanMs <= 0) return 0;
  const cutoff = Date.now() - olderThanMs;
  return getDb().prepare('DELETE FROM messages WHERE created_at < ?').run(cutoff).changes;
}

/* ------------------------------------------------------------ attachments */

export function getAttachment(id) {
  const row = getDb().prepare('SELECT * FROM attachments WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    messageId: row.message_id,
    filename: row.filename,
    mime: row.mime,
    size: row.size,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
    url: `/uploads/attachments/${row.id}`,
  };
}

function rowToMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    authorId: row.author_id,
    authorName: row.author_name || '',
    kind: row.kind,
    body: row.body,
    createdAt: row.created_at,
    attachment: row.att_id
      ? {
          id: row.att_id,
          filename: row.att_filename,
          mime: row.att_mime,
          size: row.att_size,
          width: row.att_width,
          height: row.att_height,
          url: `/uploads/attachments/${row.att_id}`,
        }
      : null,
  };
}
