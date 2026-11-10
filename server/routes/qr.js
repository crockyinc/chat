import express from 'express';
import QRCode from 'qrcode';
import { lanAddresses, config } from '../config.js';
import { authenticate } from '../security.js';

/**
 * QR code for "open the chat on your phone". Generated server-side so the
 * client needs no third-party QR library or CDN.
 */
export function qrRouter() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    if (!authenticate(req)) return res.status(401).json({ error: 'Not signed in' });
    const address = lanAddresses()[0]?.address;
    const fallback = `${req.protocol}://${req.get('host')}`;
    const target = address ? `http://${address}:${config.port}` : fallback;
    const url = typeof req.query.url === 'string' && /^https?:\/\//.test(req.query.url) ? req.query.url : target;
    try {
      const svg = await QRCode.toString(url, {
        type: 'svg',
        margin: 1,
        width: 240,
        color: { dark: '#0b1220', light: '#ffffff' },
      });
      res.type('image/svg+xml');
      res.setHeader('Cache-Control', 'no-store');
      res.send(svg);
    } catch {
      res.status(500).json({ error: 'Could not generate the QR code' });
    }
  });

  return router;
}
