import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server as SocketServer } from 'socket.io';

import { config, paths, ensureDirs, lanAddresses } from './config.js';
import * as repo from './db.js';
import { openDatabase, pruneMessages, closeDatabase } from './db.js';
import { createMessagesService } from './messages-service.js';
import { attachRealtime } from './realtime.js';
import { createAuthRouter } from './routes/auth.js';
import { messageRoutes } from './routes/messages.js';
import { requireAuth, uploadRouter, attachmentsRouter, restoreAttachment, deleteAttachmentFile } from './uploads.js';
import { qrRouter } from './routes/qr.js';
import { exportRouter } from './routes/export.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function createApp({ dbFile = config.dbFile, seed = null } = {}) {
  ensureDirs();
  openDatabase(dbFile);
  pruneMessages(config.retentionDays * 24 * 60 * 60 * 1000);
  // A thin repository object: routes and services only ever see queries.
  const db = repo;

  const app = express();
  const server = http.createServer(app);
  const io = new SocketServer(server, {
    maxHttpBufferSize: 2 * 1024 * 1024,
    cors: { origin: true, credentials: true },
  });

  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(express.json({ limit: config.maxJsonBytes }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // Basic security headers (no external CDNs are used anywhere, so this is strict).
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  const messages = createMessagesService({ db, io, restoreAttachment, deleteAttachmentFile });

  // API routes
  app.use('/api/auth', createAuthRouter({ db }));
  app.use('/api/messages', requireAuth, messageRoutes({ db, emit: messages }));
  app.use('/api/uploads', uploadRouter());
  app.use('/uploads/attachments', attachmentsRouter());
  app.use('/api/qr', qrRouter());
  app.use('/api/export', requireAuth, exportRouter({ db }));

  app.get('/api/health', (_req, res) =>
    res.json({ ok: true, uptime: process.uptime(), room: config.roomName, port: config.port }),
  );

  // Static client
  app.use(express.static(paths.publicDir, { maxAge: '1h', index: false }));
  app.use((_req, res) => res.sendFile(path.join(paths.publicDir, 'index.html')));

  attachRealtime({ io, db, messages, roomName: config.roomName });

  if (seed) seed({ db, messages });

  return { app, server, io, db, messages };
}

async function main() {
  const { server } = await createApp();
  server.listen(config.port, config.host, () => {
    const urls = [`http://localhost:${config.port}`, ...lanAddresses().map((a) => `http://${a.address}:${config.port}`)];
    console.log(`\n  ${config.roomName} is running — zero cloud, everything stays on this machine.`);
    for (const url of urls) console.log(`   →  ${url}`);
    console.log(`\n  Database: ${config.dbFile}`);
    console.log(`  Uploads:  ${paths.attachmentsDir}\n`);
  });

  const shutdown = () => {
    console.log('\nShutting down…');
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(here, 'index.js')) {
  main();
}
