import express from 'express';
import { config, lanAddresses } from '../config.js';
import { authenticate, createSessionToken, timingSafeEqual } from '../security.js';
import { isOnline } from '../presence.js';

const SESSION_MAX_AGE = 90 * 24 * 60 * 60; // seconds

export function createAuthRouter({ db }) {
  const router = express.Router();

  /** Public room metadata; the join screen uses it to show the connection URL. */
  router.get('/room', (_req, res) => {
    res.json({
      name: config.roomName,
      requiresPassword: Boolean(config.roomPassword),
      lanUrls: lanAddresses().map((a) => `http://${a.address}:${config.port}`),
      port: config.port,
    });
  });

  /** Who am I? Used on boot; the client also keeps its own copy in localStorage. */
  router.get('/me', (req, res) => {
    const session = authenticate(req);
    if (!session) return res.status(401).json({ error: 'Not signed in' });
    const user = db.getUser(session.deviceId);
    if (!user) return res.status(401).json({ error: 'Unknown device' });
    res.json({
      deviceId: session.deviceId,
      displayName: user.displayName,
      online: isOnline(session.deviceId),
    });
  });

  /**
   * Identify this browser. `deviceId` is the UUID the browser generated with
   * crypto.randomUUID() and keeps in localStorage, so it survives restarts.
   */
  router.post('/identify', (req, res) => {
    const { deviceId, displayName = '', password = '' } = req.body || {};
    if (typeof deviceId !== 'string' || !/^[0-9a-zA-Z-]{8,64}$/.test(deviceId)) {
      return res.status(400).json({ error: 'A valid deviceId is required' });
    }
    if (config.roomPassword && !timingSafeEqual(password, config.roomPassword)) {
      return res.status(401).json({ error: 'Wrong room password' });
    }
    const name = String(displayName || '').trim();
    if (name.length > 60) return res.status(400).json({ error: 'Display name is too long (max 60 chars)' });

    const user = db.upsertUser({ deviceId, displayName: name });
    const token = createSessionToken(deviceId);
    res.setHeader(
      'Set-Cookie',
      `lm_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`,
    );
    res.json({ deviceId, displayName: user.displayName });
  });

  router.patch('/me', (req, res) => {
    const session = authenticate(req);
    if (!session) return res.status(401).json({ error: 'Not signed in' });
    const name = String(req.body?.displayName ?? '').trim();
    if (name.length > 60) return res.status(400).json({ error: 'Display name is too long (max 60 chars)' });
    const user = db.renameUser(session.deviceId, name);
    res.json({ deviceId: user.deviceId, displayName: user.displayName });
  });

  return router;
}
